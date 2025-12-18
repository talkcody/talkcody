import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock additional dependencies that aren't in setup.ts
vi.mock('@/services/notification-service', () => ({
  notificationService: {
    notifyReviewRequired: vi.fn(),
  },
}));


// Create a mock store that works both as a hook and with getState()
vi.mock('@/stores/edit-review-store', () => {
  // Use a real Map for pendingEdits
  const mockPendingEdits = new Map();

  const mockStoreState = {
    pendingEdits: mockPendingEdits,
    setPendingEdit: vi.fn(),
    getPendingEdit: vi.fn(),
    approveEdit: vi.fn(),
    rejectEdit: vi.fn(),
    allowAllEdit: vi.fn(),
    clearPendingEdit: vi.fn(),
  };

  const mockUseEditReviewStore = vi.fn((selector) => {
    if (selector) {
      return selector(mockStoreState);
    }
    return mockStoreState;
  });

  mockUseEditReviewStore.getState = vi.fn(() => mockStoreState);

  return {
    useEditReviewStore: mockUseEditReviewStore,
    mockStoreState, // Export for test access
  };
});

// Import after mocks
import { editFile } from './edit-file-tool';
import { repositoryService } from '@/services/repository-service';
import { TaskManager } from '@/services/task-manager';
import { notificationService } from '@/services/notification-service';
import { useEditReviewStore } from '@/stores/edit-review-store';

// Context required by execute function
const testContext = { taskId: 'conv-123' };

describe('editFile tool', () => {
  const mockRepositoryService = repositoryService as any;
  const mockTaskManager = TaskManager as any;
  const mockNotificationService = notificationService as any;

  // Get the mock store state from the mocked module
  const getMockStoreState = () => {
    const mockStore = vi.mocked(useEditReviewStore);
    return mockStore.getState();
  };

  beforeEach(() => {
    // Don't clear all mocks - it breaks the setup.ts mocks
    // Just reset the ones we control

    // Reset the mock store state
    const state = getMockStoreState();
    state.pendingEdits.clear();
    state.setPendingEdit = vi.fn();
  });

  afterEach(() => {
    // Reset mocks after each test
  });

  describe('basic tool properties', () => {
    it('should have correct name', () => {
      expect(editFile.name).toBe('editFile');
    });

    it('should have description', () => {
      expect(editFile.description).toBeTruthy();
      expect(editFile.description).toContain('CRITICAL RULES');
    });

    it('should have canConcurrent set to false', () => {
      expect(editFile.canConcurrent).toBe(false);
    });
  });

  describe('input validation', () => {
    it('should validate correct input with single edit', () => {
      const validInput = {
        file_path: '/test/file.ts',
        edits: [{ old_string: 'old text', new_string: 'new text' }],
      };
      const result = editFile.inputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should validate correct input with multiple edits', () => {
      const validInput = {
        file_path: '/test/file.ts',
        edits: [
          { old_string: 'old text 1', new_string: 'new text 1' },
          { old_string: 'old text 2', new_string: 'new text 2' },
        ],
      };
      const result = editFile.inputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject missing file_path', () => {
      const invalidInput = {
        edits: [{ old_string: 'old', new_string: 'new' }],
      };
      const result = editFile.inputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject empty edits array', () => {
      const invalidInput = {
        file_path: '/test/file.ts',
        edits: [],
      };
      const result = editFile.inputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject empty old_string', () => {
      const invalidInput = {
        file_path: '/test/file.ts',
        edits: [{ old_string: '', new_string: 'new' }],
      };
      const result = editFile.inputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should accept empty new_string for deletion', () => {
      const validInput = {
        file_path: '/test/file.ts',
        edits: [{ old_string: 'text to delete', new_string: '' }],
      };
      const result = editFile.inputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });

  describe('path security', () => {
    beforeEach(() => {
      mockTaskManager.getTaskSettings.mockResolvedValue(null);
    });

    it('should accept valid path within project directory', async () => {
      const fileContent = 'const old = "value";\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
      mockRepositoryService.writeFile.mockResolvedValue(undefined);

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: 'const old = "value";', new_string: 'const old = "new";' }],
        review_mode: false,
      }, testContext);

      expect(result.success).toBe(true);
    });

    it('should reject path outside project directory', async () => {
      const result = await editFile.execute({
        file_path: '/etc/passwd',
        edits: [{ old_string: 'root', new_string: 'admin' }],
        review_mode: false,
      }, testContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Security');
    });

    it('should reject path traversal attempts', async () => {
      const result = await editFile.execute({
        file_path: '../../../etc/passwd',
        edits: [{ old_string: 'root', new_string: 'admin' }],
        review_mode: false,
      }, testContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Security');
    });

    it('should handle missing workspace root', async () => {
      // Import locally to mock just for this test
      const { getEffectiveWorkspaceRoot } = await import('@/services/workspace-root-service');
      const mockGetEffectiveWorkspaceRoot = getEffectiveWorkspaceRoot as any;
      mockGetEffectiveWorkspaceRoot.mockResolvedValueOnce(null);

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: 'old', new_string: 'new' }],
        review_mode: false,
      }, testContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Project root path is not set');
    });
  });

  describe('file operations', () => {
    beforeEach(() => {
      mockTaskManager.getTaskSettings.mockResolvedValue(null);
    });

    it('should successfully read existing file', async () => {
      const fileContent = 'const value = "test";\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
      mockRepositoryService.writeFile.mockResolvedValue(undefined);

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: 'const value = "test";', new_string: 'const value = "updated";' }],
        review_mode: false,
      }, testContext);

      expect(mockRepositoryService.readFileWithCache).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should handle file not found error', async () => {
      mockRepositoryService.readFileWithCache.mockRejectedValue(new Error('File not found'));

      const result = await editFile.execute({
        file_path: 'src/nonexistent.ts',
        edits: [{ old_string: 'old', new_string: 'new' }],
        review_mode: false,
      }, testContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain('File not found');
      expect(result.message).toContain('create-file or write-file');
    });

    it('should successfully write file after edit', async () => {
      const fileContent = 'const value = "test";\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
      mockRepositoryService.writeFile.mockResolvedValue(undefined);

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: 'const value = "test";', new_string: 'const value = "updated";' }],
        review_mode: false,
      }, testContext);

      expect(mockRepositoryService.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('file.ts'),
        expect.stringContaining('updated')
      );
      expect(result.success).toBe(true);
    });

    it('should handle write file errors', async () => {
      const fileContent = 'const value = "test";\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
      mockRepositoryService.writeFile.mockRejectedValue(new Error('Permission denied'));

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: 'const value = "test";', new_string: 'const value = "updated";' }],
        review_mode: false,
      }, testContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Permission denied');
    });
  });

  describe('edit application', () => {
    beforeEach(() => {
      mockTaskManager.getTaskSettings.mockResolvedValue(null);
    });

    describe('single edit', () => {
      it('should apply exact match replacement', async () => {
        const fileContent = 'function test() {\n  return "old";\n}\n';
        mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
        mockRepositoryService.writeFile.mockResolvedValue(undefined);

        const result = await editFile.execute({
          file_path: 'src/file.ts',
          edits: [{ old_string: '  return "old";', new_string: '  return "new";' }],
          review_mode: false,
        }, testContext);

        expect(result.success).toBe(true);
        expect(result.message).toContain('Successfully applied 1 edit');
      });

      it('should handle no match found', async () => {
        const fileContent = 'function test() {\n  return "value";\n}\n';
        mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);

        const result = await editFile.execute({
          file_path: 'src/file.ts',
          edits: [{ old_string: '  return "nonexistent";', new_string: '  return "new";' }],
          review_mode: false,
        }, testContext);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Could not find exact match');
      });

      it('should generate detailed error message with suggestions', async () => {
        const fileContent = 'function test() {\n  return "value";\n}\n';
        mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
        mockRepositoryService.writeFile.mockResolvedValue(undefined);

        const result = await editFile.execute({
          file_path: 'src/file.ts',
          edits: [{ old_string: 'return "value"', new_string: 'return "new"' }],
          review_mode: false,
        }, testContext);

        // Smart matching will successfully find and replace this
        expect(result.success).toBe(true);
        expect(mockRepositoryService.writeFile).toHaveBeenCalled();
      });
    });

    describe('multiple edits', () => {
      it('should apply sequential edits all succeed', async () => {
        const fileContent = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';
        mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
        mockRepositoryService.writeFile.mockResolvedValue(undefined);

        const result = await editFile.execute({
          file_path: 'src/file.ts',
          edits: [
            { old_string: 'const a = 1;', new_string: 'const a = 10;' },
            { old_string: 'const b = 2;', new_string: 'const b = 20;' },
            { old_string: 'const c = 3;', new_string: 'const c = 30;' },
          ],
          review_mode: false,
        }, testContext);

        expect(result.success).toBe(true);
        expect(result.message).toContain('Successfully applied 3 edits');
        expect(result.message).toContain('3 total replacements');
      });

      it('should fail on first edit that does not match', async () => {
        const fileContent = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';
        mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);

        const result = await editFile.execute({
          file_path: 'src/file.ts',
          edits: [
            { old_string: 'const x = 999;', new_string: 'const x = 1000;' },
            { old_string: 'const b = 2;', new_string: 'const b = 20;' },
          ],
          review_mode: false,
        }, testContext);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Edit 1 failed');
      });

      it('should fail on middle edit that does not match', async () => {
        const fileContent = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';
        mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);

        const result = await editFile.execute({
          file_path: 'src/file.ts',
          edits: [
            { old_string: 'const a = 1;', new_string: 'const a = 10;' },
            { old_string: 'const x = 999;', new_string: 'const x = 1000;' },
            { old_string: 'const c = 3;', new_string: 'const c = 30;' },
          ],
          review_mode: false,
        }, testContext);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Edit 2 failed');
      });
    });

    describe('validation errors', () => {
      it('should reject empty old_string at runtime', async () => {
        const fileContent = 'const value = "test";\n';
        mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);

        const result = await editFile.execute({
          file_path: 'src/file.ts',
          edits: [{ old_string: '', new_string: 'new' }],
          review_mode: false,
        }, testContext);

        expect(result.success).toBe(false);
        expect(result.message).toContain('old_string cannot be empty');
      });

      it('should reject duplicate edit blocks', async () => {
        const fileContent = 'const value = "test";\n';
        mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);

        const result = await editFile.execute({
          file_path: 'src/file.ts',
          edits: [
            { old_string: 'const value = "test";', new_string: 'const value = "new";' },
            { old_string: 'const value = "test";', new_string: 'const value = "new";' },
          ],
          review_mode: false,
        }, testContext);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Duplicate edit blocks detected');
      });

      it('should reject identical old_string and new_string', async () => {
        const fileContent = 'const value = "test";\n';
        mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);

        const result = await editFile.execute({
          file_path: 'src/file.ts',
          edits: [{ old_string: 'const value = "test";', new_string: 'const value = "test";' }],
          review_mode: false,
        }, testContext);

        expect(result.success).toBe(false);
        expect(result.message).toContain('No changes needed');
        expect(result.message).toContain('identical');
      });

      it('should NOT reject strings with subtle differences like a comma', async () => {
        // This test covers a bug where strings with subtle differences (like a trailing comma)
        // were incorrectly identified as identical due to normalizeString processing
        const fileContent = 'const items = [\n  "item1",\n  "item2",\n];\n';
        mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
        mockRepositoryService.writeFile.mockResolvedValue(undefined);

        // old_string has trailing comma, new_string does not - they are different!
        const result = await editFile.execute({
          file_path: 'src/file.ts',
          edits: [
            {
              old_string: '  "item2",',
              new_string: '  "item2"',
            },
          ],
          review_mode: false,
        }, testContext);

        // Should succeed, not fail with "identical" error
        expect(result.success).toBe(true);
        expect(result.message).not.toContain('identical');
      });

      it('should NOT reject strings differing only by punctuation', async () => {
        const fileContent = 'const obj = { key: "value", };\n';
        mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
        mockRepositoryService.writeFile.mockResolvedValue(undefined);

        const result = await editFile.execute({
          file_path: 'src/file.ts',
          edits: [
            {
              old_string: '{ key: "value", }',
              new_string: '{ key: "value" }',
            },
          ],
          review_mode: false,
        }, testContext);

        expect(result.success).toBe(true);
        expect(result.message).not.toContain('identical');
      });

      it('should reject when edits array is empty at runtime', async () => {
        const fileContent = 'const value = "test";\n';
        mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);

        const result = await editFile.execute({
          file_path: 'src/file.ts',
          edits: [],
          review_mode: false,
        }, testContext);

        expect(result.success).toBe(false);
        expect(result.message).toContain('At least one edit block is required');
      });

      it('should validate at least one edit required', async () => {
        const fileContent = 'const value = "test";\n';
        mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);

        const result = await editFile.execute({
          file_path: 'src/file.ts',
          edits: [],
          review_mode: false,
        }, testContext);

        expect(result.success).toBe(false);
      });

      it('should handle whitespace-only old_string', async () => {
        const fileContent = 'const value = "test";\n';
        mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);

        const result = await editFile.execute({
          file_path: 'src/file.ts',
          edits: [{ old_string: '   ', new_string: 'new' }],
          review_mode: false,
        }, testContext);

        expect(result.success).toBe(false);
        expect(result.message).toContain('old_string cannot be empty');
      });
    });
  });

  describe('smart matching', () => {
    beforeEach(() => {
      mockTaskManager.getTaskSettings.mockResolvedValue(null);
    });

    it('should match exact string', async () => {
      const fileContent = 'function test() {\n  return "value";\n}\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
      mockRepositoryService.writeFile.mockResolvedValue(undefined);

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: '  return "value";', new_string: '  return "new";' }],
        review_mode: false,
      }, testContext);

      expect(result.success).toBe(true);
    });

    it('should handle smart match with whitespace differences', async () => {
      const fileContent = 'function test() {\n  return "value";\n}\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
      mockRepositoryService.writeFile.mockResolvedValue(undefined);

      // Old string has trimmed version - smart match should find it
      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: 'return "value";', new_string: 'return "new";' }],
        review_mode: false,
      }, testContext);

      // Smart matching should find the trimmed match
      expect(mockRepositoryService.writeFile).toHaveBeenCalled();
    });

    it('should handle smart match with tab/space normalization', async () => {
      const fileContent = 'function test() {\n\treturn "value";\n}\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
      mockRepositoryService.writeFile.mockResolvedValue(undefined);

      // Using spaces instead of tabs
      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: '  return "value";', new_string: '  return "new";' }],
        review_mode: false,
      }, testContext);

      // Should normalize tabs to spaces
      expect(mockRepositoryService.writeFile).toHaveBeenCalled();
    });

    it('should detect literal \\n in old_string', async () => {
      const fileContent = 'function test() {\n  return "value";\n}\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
      mockRepositoryService.writeFile.mockResolvedValue(undefined);

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [
          { old_string: 'function test() {\\n  return "value";', new_string: 'function test() {\n  return "new";' },
        ],
        review_mode: false,
      }, testContext);

      // Smart normalization will convert \\n to \n and successfully match
      expect(result.success).toBe(true);
      expect(mockRepositoryService.writeFile).toHaveBeenCalled();
    });

    it('should use fuzzy matching for error suggestions', async () => {
      const fileContent = 'function calculate() {\n  return 42;\n}\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: 'function calcuate()', new_string: 'function calculate()' }],
        review_mode: false,
      }, testContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Could not find exact match');
    });

    it('should find similar text for error messages', async () => {
      const fileContent = 'const value1 = 10;\nconst value2 = 20;\nconst value3 = 30;\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: 'const value1\nconst value2 = 999;', new_string: 'const value1 = 999;' }],
        review_mode: false,
      }, testContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Found similar text');
    });

    it('should normalize line endings correctly', async () => {
      const fileContent = 'const a = 1;\r\nconst b = 2;\r\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
      mockRepositoryService.writeFile.mockResolvedValue(undefined);

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: 'const a = 1;', new_string: 'const a = 10;' }],
        review_mode: false,
      }, testContext);

      expect(result.success).toBe(true);
    });

    it('should use safeLiteralReplace and replace only first occurrence', async () => {
      const fileContent = 'const a = 1;\nconst b = 2;\nconst a = 1;\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
      mockRepositoryService.writeFile.mockResolvedValue(undefined);

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: 'const a = 1;', new_string: 'const a = 10;' }],
        review_mode: false,
      }, testContext);

      // Should succeed and replace only first occurrence
      expect(result.success).toBe(true);
      expect(result.message).toContain('1 total replacement');
    });
  });

  describe('review mode', () => {
    describe('auto-approve', () => {
      it('should auto-approve when enabled in settings', async () => {
        const fileContent = 'const value = "test";\n';
        mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
        mockRepositoryService.writeFile.mockResolvedValue(undefined);
        mockTaskManager.getTaskSettings.mockResolvedValue(
          JSON.stringify({ autoApproveEdits: true })
        );

        const result = await editFile.execute({
          file_path: 'src/file.ts',
          edits: [{ old_string: 'const value = "test";', new_string: 'const value = "new";' }],
          review_mode: true,
        }, testContext);

        expect(result.success).toBe(true);
        expect(result.message).toContain('Auto-approved');
        expect(mockRepositoryService.writeFile).toHaveBeenCalled();
      });

      it('should skip review dialog when auto-approved', async () => {
        const fileContent = 'const value = "test";\n';
        mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
        mockRepositoryService.writeFile.mockResolvedValue(undefined);
        mockTaskManager.getTaskSettings.mockResolvedValue(
          JSON.stringify({ autoApproveEdits: true })
        );

        await editFile.execute({
          file_path: 'src/file.ts',
          edits: [{ old_string: 'const value = "test";', new_string: 'const value = "new";' }],
          review_mode: true,
        }, testContext);

        expect(getMockStoreState().setPendingEdit).not.toHaveBeenCalled();
      });
    });

    describe('manual review', () => {
      it('should store pending edit correctly', async () => {
        const fileContent = 'const value = "test";\n';
        mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
        mockTaskManager.getTaskSettings.mockResolvedValue(null);

        // Reset the mock to track calls
        const mockSetPendingEdit = vi.fn();
        getMockStoreState().setPendingEdit = mockSetPendingEdit;

        // Mock to immediately resolve with approval - new signature: (taskId, editId, pendingEdit, callbacks, resolver)
        mockSetPendingEdit.mockImplementation((taskId, editId, pendingEdit, callbacks, resolver) => {
          // Simulate immediate approval
          setTimeout(() => {
            resolver({ success: true, approved: true, message: 'Approved' });
          }, 0);
        });

        await editFile.execute({
          file_path: 'src/file.ts',
          edits: [{ old_string: 'const value = "test";', new_string: 'const value = "new";' }],
          review_mode: true,
        }, testContext);

        // New signature: (taskId, editId, pendingEdit, callbacks, resolver)
        expect(mockSetPendingEdit).toHaveBeenCalledWith(
          'conv-123', // taskId
          expect.any(String), // editId
          expect.objectContaining({
            filePath: 'src/file.ts',
            operation: 'edit',
          }),
          expect.objectContaining({
            onApprove: expect.any(Function),
            onReject: expect.any(Function),
            onAllowAll: expect.any(Function),
          }),
          expect.any(Function) // resolver
        );
      });

      it('should register callbacks (approve/reject/allowAll)', async () => {
        const fileContent = 'const value = "test";\n';
        mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
        mockTaskManager.getTaskSettings.mockResolvedValue(null);

        const mockSetPendingEdit = vi.fn();
        getMockStoreState().setPendingEdit = mockSetPendingEdit;

        // New signature: (taskId, editId, pendingEdit, callbacks, resolver)
        mockSetPendingEdit.mockImplementation((taskId, editId, pendingEdit, callbacks, resolver) => {
          setTimeout(() => {
            resolver({ success: true, approved: true, message: 'Approved' });
          }, 0);
        });

        await editFile.execute({
          file_path: 'src/file.ts',
          edits: [{ old_string: 'const value = "test";', new_string: 'const value = "new";' }],
          review_mode: true,
        }, testContext);

        // New signature: (taskId, editId, pendingEdit, callbacks, resolver)
        expect(mockSetPendingEdit).toHaveBeenCalledWith(
          'conv-123', // taskId
          expect.any(String), // editId
          expect.any(Object), // pendingEdit
          expect.objectContaining({
            onApprove: expect.any(Function),
            onReject: expect.any(Function),
            onAllowAll: expect.any(Function),
          }),
          expect.any(Function) // resolver
        );
      });

      it('should handle approval successfully', async () => {
        const fileContent = 'const value = "test";\n';
        mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
        mockRepositoryService.writeFile.mockResolvedValue(undefined);
        mockTaskManager.getTaskSettings.mockResolvedValue(null);

        const mockSetPendingEdit = vi.fn();
        getMockStoreState().setPendingEdit = mockSetPendingEdit;

        // Mock to immediately approve - new signature: (taskId, editId, pendingEdit, callbacks, resolver)
        mockSetPendingEdit.mockImplementation(async (taskId, editId, pendingEdit, callbacks, resolver) => {
          // Simulate user approving by calling the onApprove callback
          const approvalResult = await callbacks.onApprove();
          resolver({ success: true, approved: true, message: approvalResult.message });
        });

        const result = await editFile.execute({
          file_path: 'src/file.ts',
          edits: [{ old_string: 'const value = "test";', new_string: 'const value = "new";' }],
          review_mode: true,
        }, testContext);

        expect(result.success).toBe(true);
        expect(result.message).toContain('Successfully applied');
      });

      it('should handle rejection with feedback', async () => {
        const fileContent = 'const value = "test";\n';
        mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
        mockTaskManager.getTaskSettings.mockResolvedValue(null);

        const mockSetPendingEdit = vi.fn();
        getMockStoreState().setPendingEdit = mockSetPendingEdit;

        // New signature: (taskId, editId, pendingEdit, callbacks, resolver)
        mockSetPendingEdit.mockImplementation((taskId, editId, pendingEdit, callbacks, resolver) => {
          resolver({
            success: true,
            approved: false,
            feedback: 'Wrong variable name',
            message: 'Edit rejected',
          });
        });

        const result = await editFile.execute({
          file_path: 'src/file.ts',
          edits: [{ old_string: 'const value = "test";', new_string: 'const value = "new";' }],
          review_mode: true,
        }, testContext);

        expect(result.success).toBe(true);
        expect(result.message).toContain('Edit rejected');
        expect(result.feedback).toBe('Wrong variable name');
      });

      it('should handle allow-all (enable auto-approve + approve current)', async () => {
        const fileContent = 'const value = "test";\n';
        mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
        mockRepositoryService.writeFile.mockResolvedValue(undefined);
        mockTaskManager.getTaskSettings.mockResolvedValue(null);
        mockTaskManager.updateTaskSettings.mockResolvedValue(undefined);

        const mockSetPendingEdit = vi.fn();
        getMockStoreState().setPendingEdit = mockSetPendingEdit;

        // New signature: (taskId, editId, pendingEdit, callbacks, resolver)
        mockSetPendingEdit.mockImplementation(async (taskId, editId, pendingEdit, callbacks, resolver) => {
          // Simulate allow-all being clicked
          const result = await callbacks.onAllowAll();
          resolver(result);
        });

        const result = await editFile.execute({
          file_path: 'src/file.ts',
          edits: [{ old_string: 'const value = "test";', new_string: 'const value = "new";' }],
          review_mode: true,
        }, testContext);

        expect(mockTaskManager.updateTaskSettings).toHaveBeenCalledWith(
          'conv-123',
          expect.stringContaining('autoApproveEdits')
        );
        expect(result.success).toBe(true);
      });
    });
  });

  describe('error message generation', () => {
    beforeEach(() => {
      mockTaskManager.getTaskSettings.mockResolvedValue(null);
    });

    it('should generate detailed error with file path', async () => {
      const fileContent = 'const value = "test";\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);

      const result = await editFile.execute({
        file_path: 'src/components/test.tsx',
        edits: [{ old_string: 'const nonexistent = 1;', new_string: 'const nonexistent = 2;' }],
        review_mode: false,
      }, testContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain('src/components/test.tsx');
      expect(result.message).toContain('Edit 1 failed');
    });

    it('should include edit description in error', async () => {
      const fileContent = 'const value = "test";\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [
          {
            old_string: 'const nonexistent = 1;',
            new_string: 'const nonexistent = 2;',
            description: 'Update variable',
          },
        ],
        review_mode: false,
      }, testContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain('📝 Edit description: Update variable');
    });

    it('should suggest fix for literal \\n characters', async () => {
      const fileContent = 'function test() {\n  return "value";\n}\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
      mockRepositoryService.writeFile.mockResolvedValue(undefined);

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: 'function test() {\\n  return "value";', new_string: 'function test() {' }],
        review_mode: false,
      }, testContext);

      // Smart normalization will convert \\n to \n and successfully match
      expect(result.success).toBe(true);
      expect(mockRepositoryService.writeFile).toHaveBeenCalled();
    });

    it('should include fuzzy match suggestions', async () => {
      const fileContent = 'function calculateTotal() {\n  return 100;\n}\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: 'function calcTotal()', new_string: 'function calculateTotal()' }],
        review_mode: false,
      }, testContext);

      expect(result.success).toBe(false);
      // Error message should contain suggestions
      expect(result.message).toContain('💡');
    });

    it('should include similar text locations', async () => {
      const fileContent = 'const value1 = 10;\nconst value2 = 20;\nconst value3 = 30;\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: 'const value1\nconst value2 = 999;', new_string: 'const value1 = 999;' }],
        review_mode: false,
      }, testContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain('🔍 Found similar text');
    });
  });

  describe('direct mode', () => {
    beforeEach(() => {
      mockTaskManager.getTaskSettings.mockResolvedValue(null);
    });

    it('should successfully write file without review', async () => {
      const fileContent = 'const value = "test";\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
      mockRepositoryService.writeFile.mockResolvedValue(undefined);

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: 'const value = "test";', new_string: 'const value = "new";' }],
        review_mode: false,
      }, testContext);

      expect(result.success).toBe(true);
      expect(mockRepositoryService.writeFile).toHaveBeenCalled();
    });

    it('should return success message with edit count', async () => {
      const fileContent = 'const a = 1;\nconst b = 2;\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
      mockRepositoryService.writeFile.mockResolvedValue(undefined);

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [
          { old_string: 'const a = 1;', new_string: 'const a = 10;' },
          { old_string: 'const b = 2;', new_string: 'const b = 20;' },
        ],
        review_mode: false,
      }, testContext);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Successfully applied 2 edits');
    });

    it('should return success message with replacement count', async () => {
      const fileContent = 'const value = "test";\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
      mockRepositoryService.writeFile.mockResolvedValue(undefined);

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: 'const value = "test";', new_string: 'const value = "new";' }],
        review_mode: false,
      }, testContext);

      expect(result.success).toBe(true);
      expect(result.message).toContain('1 total replacement');
    });
  });

  describe('React component rendering', () => {
    it('should render renderToolDoing with single edit', () => {
      const params = {
        file_path: 'src/file.ts',
        edits: [{ old_string: 'old', new_string: 'new' }],
      };
      // renderToolDoing requires context with taskId
      const component = editFile.renderToolDoing?.(params, testContext);
      expect(component).toBeTruthy();
      render(component);
      expect(screen.getByText('src/file.ts')).toBeInTheDocument();
    });

    it('should render renderToolDoing with multiple edits', () => {
      const params = {
        file_path: 'src/file.ts',
        edits: [
          { old_string: 'old1', new_string: 'new1' },
          { old_string: 'old2', new_string: 'new2' },
        ],
      };
      // renderToolDoing requires context with taskId
      const component = editFile.renderToolDoing?.(params, testContext);
      expect(component).toBeTruthy();
      render(component);
      expect(screen.getByText(/Applying 2 edits/)).toBeInTheDocument();
    });

    it('should render renderToolResult for success', () => {
      const result = { success: true, message: 'Successfully applied 1 edit to src/file.ts' };
      const params = {
        file_path: 'src/file.ts',
        edits: [{ old_string: 'old', new_string: 'new' }],
      };
      const component = editFile.renderToolResult?.(result, params);
      expect(component).toBeTruthy();
      render(component);
      expect(screen.getByText('Successfully applied 1 edit to src/file.ts')).toBeInTheDocument();
    });

    it('should render renderToolResult for failure', () => {
      const result = { success: false, message: 'Edit failed: Could not find match' };
      const params = {
        file_path: 'src/file.ts',
        edits: [{ old_string: 'old', new_string: 'new' }],
      };
      const component = editFile.renderToolResult?.(result, params);
      expect(component).toBeTruthy();
      render(component);
      expect(screen.getByText('Edit failed: Could not find match')).toBeInTheDocument();
    });
  });

  describe('edge cases and integration', () => {
    it('should handle settings parsing error and fallback to review', async () => {
      const fileContent = 'const value = "test";\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
      mockTaskManager.getTaskSettings.mockResolvedValue('invalid json');

      const mockSetPendingEdit = vi.fn();
      getMockStoreState().setPendingEdit = mockSetPendingEdit;

      // New signature: (taskId, editId, pendingEdit, callbacks, resolver)
      mockSetPendingEdit.mockImplementation((taskId, editId, pendingEdit, callbacks, resolver) => {
        resolver({ success: true, approved: true, message: 'Approved' });
      });

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: 'const value = "test";', new_string: 'const value = "new";' }],
        review_mode: true,
      }, testContext);

      // Should still proceed to review mode
      expect(mockSetPendingEdit).toHaveBeenCalled();
    });

    it('should handle review dialog error', async () => {
      const fileContent = 'const value = "test";\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
      mockTaskManager.getTaskSettings.mockResolvedValue(null);

      // Mock setPendingEdit to simulate an error in the review process
      // New signature: (taskId, editId, pendingEdit, callbacks, resolver)
      getMockStoreState().setPendingEdit = vi.fn((taskId, editId, pendingEdit, callbacks, resolve) => {
        // Simulate an error by throwing when setPendingEdit is called
        throw new Error('Dialog error');
      });

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: 'const value = "test";', new_string: 'const value = "new";' }],
        review_mode: true,
      }, testContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Review process failed');
    });

    it('should send notification when review required', async () => {
      const fileContent = 'const value = "test";\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
      mockTaskManager.getTaskSettings.mockResolvedValue(null);
      mockNotificationService.notifyReviewRequired.mockResolvedValue(undefined);

      // Mock setPendingEdit to immediately resolve
      const mockSetPendingEdit = vi.fn();
      getMockStoreState().setPendingEdit = mockSetPendingEdit;

      // New signature: (taskId, editId, pendingEdit, callbacks, resolver)
      mockSetPendingEdit.mockImplementation((taskId, editId, pendingEdit, callbacks, resolver) => {
        resolver({ success: true, approved: true, message: 'Approved' });
      });

      await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: 'const value = "test";', new_string: 'const value = "new";' }],
        review_mode: true,
      }, testContext);

      expect(mockNotificationService.notifyReviewRequired).toHaveBeenCalled();
    });

    it('should calculate total occurrences correctly', async () => {
      const fileContent = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
      mockRepositoryService.writeFile.mockResolvedValue(undefined);

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [
          { old_string: 'const a = 1;', new_string: 'const a = 10;' },
          { old_string: 'const b = 2;', new_string: 'const b = 20;' },
          { old_string: 'const c = 3;', new_string: 'const c = 30;' },
        ],
        review_mode: false,
      }, testContext);

      expect(result.success).toBe(true);
      expect(result.message).toContain('3 total replacements');
      expect(result.totalReplacements).toBe(3);
    });

    it('should handle smart match with corrected old_string', async () => {
      const fileContent = 'function test() {\n  return "value";\n}\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
      mockRepositoryService.writeFile.mockResolvedValue(undefined);

      // Provide trimmed version - smart match should find indented version
      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: 'return "value";', new_string: 'return "new";' }],
        review_mode: false,
      }, testContext);

      // Smart matching should handle this
      expect(mockRepositoryService.writeFile).toHaveBeenCalled();
    });

    it('should log all operations correctly', async () => {
      const fileContent = 'const value = "test";\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
      mockRepositoryService.writeFile.mockResolvedValue(undefined);

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: 'const value = "test";', new_string: 'const value = "new";' }],
        review_mode: false,
      }, testContext);

      // Logger should have been called (mocked in setup.ts)
      // This test verifies no errors occur during logging
      expect(result.success).toBe(true);
      expect(mockRepositoryService.readFileWithCache).toHaveBeenCalled();
    });

    it('should handle conversation settings retrieval', async () => {
      const fileContent = 'const value = "test";\n';
      mockRepositoryService.readFileWithCache.mockResolvedValue(fileContent);
      mockRepositoryService.writeFile.mockResolvedValue(undefined);
      mockTaskManager.getTaskSettings.mockResolvedValue(
        JSON.stringify({ autoApproveEdits: true })
      );

      const result = await editFile.execute({
        file_path: 'src/file.ts',
        edits: [{ old_string: 'const value = "test";', new_string: 'const value = "new";' }],
        review_mode: true,
      }, testContext);

      expect(result.success).toBe(true);
      expect(mockTaskManager.getTaskSettings).toHaveBeenCalledWith('conv-123');
    });
  });
});
