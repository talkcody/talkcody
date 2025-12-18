import { z } from 'zod';
import { EditFileToolDoing } from '@/components/tools/edit-file-tool-doing';
import { GenericToolResult } from '@/components/tools/generic-tool-result';
import { createTool } from '@/lib/create-tool';
import { logger } from '@/lib/logger';
import { createPathSecurityError, isPathWithinProjectDirectory } from '@/lib/utils/path-security';
import { notificationService } from '@/services/notification-service';
import { repositoryService } from '@/services/repository-service';
import { normalizeFilePath } from '@/services/repository-utils';
import { TaskManager } from '@/services/task-manager';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';
import {
  type FileEditReviewResult,
  type PendingEdit,
  useEditReviewStore,
} from '@/stores/edit-review-store';
import { useFileChangesStore } from '@/stores/file-changes-store';
import { settingsManager } from '@/stores/settings-store';
import type { TaskSettings } from '@/types';
import {
  findSimilarText,
  fuzzyMatch,
  normalizeString,
  safeLiteralReplace,
  smartMatch,
} from '@/utils/text-replacement';

interface EditBlock {
  old_string: string;
  new_string: string;
  description?: string;
}

interface EditResult {
  editIndex: number;
  success: boolean;
  occurrences: number;
  matchType: 'exact' | 'smart' | 'none';
  error?: string;
}

/**
 * Applies multiple edits sequentially to the content
 */
function applyEditsSequentially(
  content: string,
  edits: EditBlock[],
  replace_all: boolean
): {
  finalContent: string;
  results: EditResult[];
  success: boolean;
} {
  let workingContent = content;
  const results: EditResult[] = [];

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    if (!edit) continue;
    const normalizedOldString = normalizeString(edit.old_string);
    const normalizedNewString = normalizeString(edit.new_string);

    // Try smart matching
    const matchResult = smartMatch(workingContent, normalizedOldString);

    if (matchResult.matchType === 'exact') {
      // Use exact match
      const replacement = safeLiteralReplace(
        workingContent,
        normalizedOldString,
        normalizedNewString,
        replace_all
      );
      workingContent = replacement.result;
      results.push({
        editIndex: i,
        success: true,
        occurrences: replacement.occurrences,
        matchType: 'exact',
      });
    } else if (matchResult.matchType === 'smart' && matchResult.correctedOldString) {
      // Use smart match with corrected old string
      const actualOldString = matchResult.correctedOldString;
      const replacement = safeLiteralReplace(
        matchResult.result,
        actualOldString,
        normalizedNewString,
        replace_all
      );
      workingContent = replacement.result;
      results.push({
        editIndex: i,
        success: true,
        occurrences: replacement.occurrences,
        matchType: 'smart',
      });
      logger.info(`Edit ${i + 1}: Used smart matching - corrected old_string formatting`);
    } else {
      // No match found
      results.push({
        editIndex: i,
        success: false,
        occurrences: 0,
        matchType: 'none',
        error: `Could not find exact match for edit ${i + 1}`,
      });
      return {
        finalContent: content, // Return original content on failure
        results,
        success: false,
      };
    }
  }

  return {
    finalContent: workingContent,
    results,
    success: true,
  };
}

/**
 * Generates detailed error message when an edit fails to match
 */
function generateEditErrorMessage(
  content: string,
  editIndex: number,
  edit: EditBlock,
  file_path: string
): string {
  const normalizedOldString = normalizeString(edit.old_string);
  const fuzzy = fuzzyMatch(content, normalizedOldString);
  const similarTexts = findSimilarText(content, normalizedOldString);

  let errorMsg = `Edit ${editIndex + 1} failed: Could not find exact match in ${file_path}.\n\n`;
  errorMsg += `❌ The old_string was not found exactly as provided.\n\n`;

  if (edit.description) {
    errorMsg += `📝 Edit description: ${edit.description}\n\n`;
  }

  // Check if the issue is with line ending format
  if (edit.old_string.includes('\\n')) {
    errorMsg += `🔍 Your old_string contains literal \\n characters. Try using actual line breaks instead.\n\n`;
    errorMsg += `💡 Suggested fix: Replace \\n with actual newlines in your old_string.\n\n`;
  }

  if (fuzzy.suggestion) {
    errorMsg += `💡 ${fuzzy.suggestion}\n\n`;
  }

  if (similarTexts.length > 0) {
    errorMsg += `🔍 Found similar text at these locations:\n`;
    for (const [i, text] of similarTexts.entries()) {
      errorMsg += `\n${i + 1}. ${text}\n`;
    }
    errorMsg += `\n💡 Copy the exact text from the file (including proper indentation) and use it as old_string.\n`;
  } else {
    errorMsg += `🔍 No similar text found. The content might have changed.\n`;
    errorMsg += `💡 Use readFile to verify the current file content and copy the exact text you want to replace.\n`;
  }

  // Try to provide a corrected suggestion if smart matching found something close
  const smartAttempt = smartMatch(content, edit.old_string);
  if (smartAttempt.matchType === 'smart' && smartAttempt.correctedOldString) {
    errorMsg += `\n📝 Suggested corrected old_string:\n`;
    errorMsg += `\`\`\`\n${smartAttempt.correctedOldString}\n\`\`\`\n`;
  }

  return errorMsg;
}

export const editFile = createTool({
  name: 'editFile',
  description: `Edit an existing file with one or more text replacements.

CRITICAL RULES:
1. All old_string values must match EXACTLY - including spaces, tabs, and newlines
2. Use readFile tool FIRST to see the exact content
3. Include 3-5 lines of context before and after each change
4. For file creation, use write-file tool instead

HOW TO CHOOSE THE NUMBER OF EDITS:

Single Edit (edits.length = 1):
✅ One isolated change
✅ Simple fix or update in one location
✅ Experimental/uncertain replacement
✅ When you need to verify the result before continuing

Example: "Add an import statement" → 1 edit

Multiple Edits (edits.length = 2-10):
✅ Related changes to the same file
✅ Batch updates with similar patterns (e.g., rename all occurrences)
✅ Refactoring that touches multiple parts (imports + function + types)
✅ You're confident all replacements will work

Example: "Add import + update function + update type" → 3 edits

IMPORTANT: Maximum 10 edits per call. For larger refactorings, make multiple calls.

Best practice workflow:
1. Use readFile to see current content
2. Identify all changes you want to make to this file
3. For each change, copy EXACT text with context
4. Create edit block(s) with old_string and new_string
5. Call edit-file with your edit(s)`,

  inputSchema: z.object({
    file_path: z.string().describe('The absolute path of file you want to edit'),
    edits: z
      .array(
        z.object({
          old_string: z
            .string()
            .min(1)
            .describe(
              'EXACT text to replace. Must match perfectly including whitespace. Include 3-5 lines of context.'
            ),
          new_string: z
            .string()
            .describe('Replacement text. Can be empty to delete. Must have correct indentation.'),
        })
      )
      .min(1)
      .describe(
        'Array of edit blocks. Use 1 edit for simple changes. Use multi edits for related changes to the same file.'
      ),
  }),
  canConcurrent: false,
  execute: async ({ file_path, edits, review_mode = true }, context) => {
    try {
      const rootPath = await getEffectiveWorkspaceRoot(context?.taskId);
      if (!rootPath) {
        return {
          success: false,
          file_path,
          message: 'Project root path is not set.',
        };
      }
      logger.info(
        `editFile: rootPath=${rootPath}, file_path=${file_path}, taskId=${context?.taskId}`
      );
      const fullPath = await normalizeFilePath(rootPath, file_path);

      // Security check: Ensure file path is within the current project directory
      const isPathSecure = await isPathWithinProjectDirectory(fullPath, rootPath);
      if (!isPathSecure) {
        const securityError = createPathSecurityError(fullPath, rootPath);
        logger.error(`editFile: Security violation - ${securityError}`);
        return {
          success: false,
          file_path,
          message: securityError,
        };
      }

      logger.info('Editing file:', fullPath);
      logger.info('Number of edits:', edits.length);

      // Validate edits
      if (edits.length === 0) {
        throw new Error('At least one edit block is required.');
      }

      // Check for empty old_strings
      for (let i = 0; i < edits.length; i++) {
        if (!edits[i].old_string || edits[i].old_string.trim().length === 0) {
          throw new Error(
            `Edit ${i + 1}: old_string cannot be empty. Use write-file or create-file for new content.`
          );
        }
      }

      // Check for duplicate edits
      const uniqueEdits = new Set(edits.map((e: EditBlock) => `${e.old_string}::${e.new_string}`));
      if (uniqueEdits.size !== edits.length) {
        throw new Error(
          'Duplicate edit blocks detected. Each edit should be unique. Remove duplicate edits.'
        );
      }

      let currentContent: string;
      try {
        currentContent = await repositoryService.readFileWithCache(fullPath);
        currentContent = normalizeString(currentContent);
      } catch (error) {
        logger.error('Error reading file:', error);
        throw new Error(
          `File not found: ${file_path}. This tool only edits existing files. Use create-file or write-file for new files.`
        );
      }

      // Validate that old_string and new_string are different for each edit
      // Compare original strings directly, not normalized versions
      // This ensures we don't falsely treat strings with subtle differences as identical
      for (let i = 0; i < edits.length; i++) {
        if (edits[i].old_string === edits[i].new_string) {
          throw new Error(
            `Edit ${i + 1}: No changes needed. The old_string and new_string are identical.`
          );
        }
      }

      // Apply edits sequentially
      const applyResult = applyEditsSequentially(currentContent, edits, false);

      if (!applyResult.success) {
        // Find the failed edit
        const failedResult = applyResult.results.find((r) => !r.success);
        if (failedResult) {
          const failedEdit = edits[failedResult.editIndex];
          const errorMsg = generateEditErrorMessage(
            currentContent,
            failedResult.editIndex,
            failedEdit,
            file_path
          );
          throw new Error(errorMsg);
        }
        throw new Error('Failed to apply edits. Please check your edit blocks and try again.');
      }

      const finalContent = applyResult.finalContent;

      if (currentContent === finalContent) {
        throw new Error(
          'No changes applied. The content is identical after all replacements. This should not happen - please report this issue.'
        );
      }

      // Calculate total occurrences
      const totalOccurrences = applyResult.results.reduce(
        (sum, result) => sum + result.occurrences,
        0
      );

      // Check if auto-approve is enabled for this task
      const taskId = context?.taskId;
      if (!taskId) {
        throw new Error('taskId is required for editFile tool');
      }
      const settingsJson = await TaskManager.getTaskSettings(taskId);

      if (settingsJson) {
        try {
          const settings: TaskSettings = JSON.parse(settingsJson);
          if (settings.autoApproveEdits === true) {
            // Auto-approve is enabled, directly write the file
            await repositoryService.writeFile(fullPath, finalContent);
            const successMessage = `Successfully applied ${edits.length} edit${edits.length > 1 ? 's' : ''} to ${file_path} (${totalOccurrences} total replacement${totalOccurrences > 1 ? 's' : ''}) [Auto-approved]`;
            logger.info(successMessage);

            // Track the file change
            useFileChangesStore
              .getState()
              .addChange(taskId, file_path, 'edit', currentContent, finalContent);

            return {
              success: true,
              message: successMessage,
              type: 'success',
              editsApplied: edits.length,
              totalReplacements: totalOccurrences,
            };
          }
        } catch (error) {
          logger.error('Failed to parse conversation settings:', error);
          // Continue to review mode if settings parsing fails
        }
      }

      // Handle review mode internally
      if (review_mode) {
        const editId = `edit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const pendingEdit: PendingEdit = {
          id: editId,
          filePath: file_path,
          originalContent: currentContent,
          newContent: finalContent,
          operation: 'edit',
          timestamp: Date.now(),
          metadata:
            edits.length > 1
              ? {
                  editCount: edits.length,
                  edits: edits.map((edit: EditBlock, i: number) => ({
                    index: i + 1,
                    description: edit.description || `Edit ${i + 1}`,
                    occurrences: applyResult.results[i]?.occurrences || 0,
                    matchType: applyResult.results[i]?.matchType || 'none',
                  })),
                }
              : undefined,
        };

        // Create callbacks for approval/rejection/allowAll
        const callbacks = {
          onApprove: async () => {
            await repositoryService.writeFile(fullPath, finalContent);
            const message = `Successfully applied ${edits.length} edit${edits.length > 1 ? 's' : ''} to ${file_path} (${totalOccurrences} total replacement${totalOccurrences > 1 ? 's' : ''})`;
            logger.info(message);

            // Track the file change
            useFileChangesStore
              .getState()
              .addChange(taskId, file_path, 'edit', currentContent, finalContent);

            return { success: true, message };
          },
          onReject: async (feedback: string) => {
            logger.info(`Edit rejected for ${file_path}: ${feedback}`);
            return {
              success: true,
              message: `Edit rejected. Feedback: ${feedback}`,
              feedback,
            };
          },
          onAllowAll: async () => {
            // 1. Update conversation settings to enable auto-approve
            const newSettings: TaskSettings = { autoApproveEdits: true };
            await TaskManager.updateTaskSettings(taskId, JSON.stringify(newSettings));
            logger.info(`Auto-approve enabled for conversation ${taskId}`);

            // 2. Approve current edit
            await repositoryService.writeFile(fullPath, finalContent);
            const message = `Successfully applied ${edits.length} edit${edits.length > 1 ? 's' : ''} to ${file_path} (${totalOccurrences} total replacement${totalOccurrences > 1 ? 's' : ''}). All future edits in this conversation will be auto-approved.`;
            logger.info(message);

            // Track the file change
            useFileChangesStore
              .getState()
              .addChange(taskId, file_path, 'edit', currentContent, finalContent);

            return { success: true, message };
          },
        };

        // Handle review inline using the store
        try {
          // Send notification if window is not focused
          await notificationService.notifyReviewRequired();

          // Create a Promise that will be resolved when user reviews the edit
          const reviewResult = await new Promise<FileEditReviewResult>((resolve) => {
            logger.info('[EditFileTool] Creating Promise and setting pending edit in store');

            // Store the pending edit, callbacks, and resolver in the store
            // The UI component (FileEditReviewCard) will call the store methods which will resolve this Promise
            // Pass taskId to support concurrent pending edits for multiple tasks
            useEditReviewStore
              .getState()
              .setPendingEdit(taskId, editId, pendingEdit, callbacks, resolve);
          });

          // Type guard to ensure reviewResult has the expected structure
          if (
            typeof reviewResult === 'object' &&
            reviewResult !== null &&
            'success' in reviewResult
          ) {
            // Check the result format from FileEditReviewCard
            if (reviewResult.success && reviewResult.approved) {
              // User approved - return success
              return {
                success: true,
                message:
                  reviewResult.message ||
                  `Successfully applied ${edits.length} edit${edits.length > 1 ? 's' : ''} to ${file_path}`,
                type: 'success',
                editsApplied: edits.length,
                totalReplacements: totalOccurrences,
              };
            }
            // User rejected with feedback
            const feedback = reviewResult.feedback || 'Edit rejected by user';
            logger.info(`Edit rejected for ${file_path}: ${feedback}`);

            return {
              success: true,
              message: `Edit rejected. Feedback: ${feedback}`,
              feedback,
              type: 'user_feedback',
            };
          }
          // Handle unexpected review result format
          logger.error('Unexpected review result format:', reviewResult);
          return {
            success: false,
            message: 'Unexpected review result format',
            type: 'error',
          };
        } catch (error) {
          logger.error('Error in review process:', error);
          return {
            success: false,
            message: `Review process failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            type: 'error',
          };
        }
      }

      // Direct mode (no review)
      try {
        await repositoryService.writeFile(fullPath, finalContent);
        const successMessage = `Successfully applied ${edits.length} edit${edits.length > 1 ? 's' : ''} to ${file_path} (${totalOccurrences} total replacement${totalOccurrences > 1 ? 's' : ''})`;
        logger.info(successMessage);

        // Track the file change (taskId was validated earlier)
        useFileChangesStore
          .getState()
          .addChange(taskId, file_path, 'edit', currentContent, finalContent);

        return {
          success: true,
          message: successMessage,
          type: 'success',
          editsApplied: edits.length,
          totalReplacements: totalOccurrences,
        };
      } catch (error) {
        const errorMessage = `Failed to write file: ${error instanceof Error ? error.message : 'Unknown error'}`;
        logger.error(errorMessage);

        return {
          success: false,
          message: errorMessage,
          type: 'error',
        };
      }
    } catch (error) {
      logger.error('Error editing file:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return {
        success: false,
        message: `Failed to edit file:\n\n${errorMessage}`,
        type: 'error',
      };
    }
  },

  renderToolDoing: ({ file_path, edits }, context) => {
    // Use the responsive wrapper component that subscribes to the store
    return <EditFileToolDoing file_path={file_path} edits={edits} taskId={context?.taskId || ''} />;
  },

  renderToolResult: (result) => {
    return <GenericToolResult success={result?.success ?? false} message={result?.message} />;
  },
});
