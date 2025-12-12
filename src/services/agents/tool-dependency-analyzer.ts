// src/services/agents/tool-dependency-analyzer.ts

import type { ToolSet } from 'ai';
import { logger } from '@/lib/logger';
import { getToolMetadata, type ToolCategory } from '@/lib/tools';
import type { ToolCallInfo } from './tool-executor';

/**
 * Execution group - a set of tools that can be executed together
 */
export interface ExecutionGroup {
  /** Unique identifier for this group */
  id: string;
  /** Whether tools in this group can run concurrently */
  concurrent: boolean;
  /** Optional max concurrency cap for the group */
  maxConcurrency?: number;
  /** Tool calls in this group */
  tools: ToolCallInfo[];
  /** Target files for file operations (if applicable) */
  targetFiles?: string[];
  /** Reason for this grouping (for logging/debugging) */
  reason: string;
}

/**
 * Execution stage - a logical phase in the execution plan
 */
export interface ExecutionStage {
  /** Stage name (e.g., 'read-stage', 'write-stage') */
  name: string;
  /** Human-readable description */
  description: string;
  /** Groups within this stage */
  groups: ExecutionGroup[];
}

/**
 * Complete execution plan with multiple stages
 */
export interface ExecutionPlan {
  /** All execution stages */
  stages: ExecutionStage[];
  /** Summary statistics */
  summary: {
    totalTools: number;
    totalStages: number;
    totalGroups: number;
    concurrentGroups: number;
  };
}

/**
 * ToolDependencyAnalyzer analyzes tool calls and creates an optimized execution plan
 * Handles regular tools with read -> write/edit -> other execution phases
 */
export class ToolDependencyAnalyzer {
  /**
   * Analyze tool calls and generate an execution plan
   *
   * Strategy:
   * 1. Categorize tools by type (read, write, edit, other)
   * 2. Phase 1: Read operations (parallel)
   * 3. Phase 2: Write/Edit operations (sequential for user review)
   * 4. Phase 3: Other operations (based on canConcurrent flag)
   */
  analyzeDependencies(toolCalls: ToolCallInfo[], tools: ToolSet): ExecutionPlan {
    if (toolCalls.length === 0) {
      return {
        stages: [],
        summary: {
          totalTools: 0,
          totalStages: 0,
          totalGroups: 0,
          concurrentGroups: 0,
        },
      };
    }

    // Categorize tools by their category
    const categorized = this.categorizeToolCalls(toolCalls);

    // Build execution stages
    const stages: ExecutionStage[] = [];

    // Phase 1: Read operations
    if (categorized.read.length > 0) {
      stages.push(this.createReadStage(categorized.read));
    }

    // Phase 2: Write/Edit operations
    const writeEditTools = [...categorized.write, ...categorized.edit];
    if (writeEditTools.length > 0) {
      stages.push(this.createWriteEditStage(writeEditTools));
    }

    // Phase 3: Other operations
    if (categorized.other.length > 0) {
      stages.push(this.createOtherStage(categorized.other, tools));
    }

    // Calculate summary statistics
    const totalGroups = stages.reduce((sum, stage) => sum + stage.groups.length, 0);
    const concurrentGroups = stages.reduce(
      (sum, stage) => sum + stage.groups.filter((g) => g.concurrent).length,
      0
    );

    const plan: ExecutionPlan = {
      stages,
      summary: {
        totalTools: toolCalls.length,
        totalStages: stages.length,
        totalGroups,
        concurrentGroups,
      },
    };

    this.logExecutionPlan(plan);

    return plan;
  }

  /**
   * Categorize tool calls by their category
   */
  private categorizeToolCalls(
    toolCalls: ToolCallInfo[]
  ): Record<ToolCategory | 'read', ToolCallInfo[]> {
    return toolCalls.reduce<Record<ToolCategory | 'read', ToolCallInfo[]>>(
      (acc, toolCall) => {
        const category = getToolMetadata(toolCall.toolName).category;
        acc[category].push(toolCall);
        return acc;
      },
      { read: [], write: [], edit: [], other: [] }
    );
  }

  /**
   * Create read stage - all read operations run in parallel
   */
  private createReadStage(readTools: ToolCallInfo[]): ExecutionStage {
    const targetFiles = this.collectTargets(readTools);
    return {
      name: 'read-stage',
      description: `Reading ${readTools.length} file(s) and gathering context`,
      groups: [
        {
          id: 'read-group-all',
          concurrent: true,
          tools: readTools,
          targetFiles: targetFiles.length > 0 ? targetFiles : undefined,
          reason: 'All read operations can run in parallel',
        },
      ],
    };
  }

  /**
   * Create write/edit stage - all operations run sequentially
   * Edit/write tools require user review, so they must be executed one at a time
   */
  private createWriteEditStage(writeEditTools: ToolCallInfo[]): ExecutionStage {
    const groupedByFile = new Map<string, ToolCallInfo[]>();
    const noFileTools: ToolCallInfo[] = [];

    for (const toolCall of writeEditTools) {
      const target = this.extractTargets(toolCall)[0];
      if (target) {
        groupedByFile.set(target, [...(groupedByFile.get(target) ?? []), toolCall]);
      } else {
        noFileTools.push(toolCall);
      }
    }

    const groups: ExecutionGroup[] = [];

    if (groupedByFile.size > 0) {
      const groupedTools = Array.from(groupedByFile.values()).flat();
      const targetFiles = Array.from(groupedByFile.keys());
      groups.push({
        id: 'write-edit-group-sequential',
        concurrent: false,
        tools: groupedTools,
        targetFiles,
        reason: `Operations on ${targetFiles.length} file(s) require sequential user review`,
      });
    }

    if (noFileTools.length > 0) {
      groups.push({
        id: 'write-edit-group-no-file',
        concurrent: false,
        tools: noFileTools,
        reason: 'Write/edit operations without file targets run serially',
      });
    }

    return {
      name: 'write-edit-stage',
      description: `Writing/editing ${writeEditTools.length} file(s) sequentially`,
      groups,
    };
  }

  /**
   * Create other stage - based on canConcurrent flag
   */
  private createOtherStage(otherTools: ToolCallInfo[], tools: ToolSet): ExecutionStage {
    const groups: ExecutionGroup[] = [];
    let currentConcurrentGroup: ExecutionGroup | null = null;
    let groupCounter = 0;

    for (const toolCall of otherTools) {
      const metadata = getToolMetadata(toolCall.toolName);
      const tool = tools[toolCall.toolName] as { canConcurrent?: boolean } | undefined;
      const canConcurrent = tool?.canConcurrent ?? metadata.canConcurrent ?? false;
      const concurrencySource = tool?.canConcurrent !== undefined ? 'tool' : 'metadata';
      const targets = this.extractTargets(toolCall);

      if (!canConcurrent) {
        groups.push({
          id: `other-group-${++groupCounter}`,
          concurrent: false,
          tools: [toolCall],
          targetFiles: targets.length > 0 ? targets : undefined,
          reason: `Tool marked as non-concurrent (${concurrencySource})`,
        });
        currentConcurrentGroup = null;
        continue;
      }

      const hasConflict: boolean = Boolean(
        currentConcurrentGroup?.concurrent &&
          targets.length > 0 &&
          (currentConcurrentGroup.targetFiles || []).some((target) => targets.includes(target))
      );

      if (!currentConcurrentGroup || !currentConcurrentGroup.concurrent || hasConflict) {
        const reason: string = hasConflict
          ? `Concurrent tool with conflicting declared targets; starting new group (${concurrencySource})`
          : targets.length > 0
            ? `Concurrent tools with declared targets (${concurrencySource})`
            : `Tools marked as concurrent (${concurrencySource})`;

        currentConcurrentGroup = {
          id: `other-group-${++groupCounter}`,
          concurrent: true,
          tools: [toolCall],
          targetFiles: targets.length > 0 ? targets : undefined,
          reason,
        };
        groups.push(currentConcurrentGroup);
        continue;
      }

      currentConcurrentGroup.tools.push(toolCall);
      if (targets.length > 0) {
        currentConcurrentGroup.targetFiles = this.mergeTargets(
          currentConcurrentGroup.targetFiles,
          targets
        );
      }
    }

    return {
      name: 'other-stage',
      description: `Executing ${otherTools.length} other operation(s)`,
      groups,
    };
  }

  /**
   * Log execution plan for debugging
   */
  private logExecutionPlan(plan: ExecutionPlan): void {
    logger.info('Generated execution plan', {
      summary: plan.summary,
      stages: plan.stages.map((stage) => ({
        name: stage.name,
        description: stage.description,
        groups: stage.groups.map((group) => ({
          id: group.id,
          concurrent: group.concurrent,
          maxConcurrency: group.maxConcurrency,
          toolCount: group.tools.length,
          tools: group.tools.map((t) => t.toolName),
          reason: group.reason,
          targetFiles: group.targetFiles,
        })),
      })),
    });
  }

  /**
   * Extract declared targets from a tool call, combining tool metadata and input hints
   */
  private extractTargets(toolCall: ToolCallInfo): string[] {
    const metadata = getToolMetadata(toolCall.toolName);
    const targets = new Set<string>();

    const addTargets = (values: string | string[] | null | undefined) => {
      if (!values) return;
      const items = Array.isArray(values) ? values : [values];
      for (const value of items) {
        const trimmed = value?.trim?.();
        if (trimmed && trimmed.length > 0) {
          targets.add(trimmed);
        }
      }
    };

    addTargets(metadata.getTargetFile?.(toolCall.input as Record<string, unknown>));
    const inputTargets = (toolCall.input as { targets?: unknown })?.targets;
    addTargets(
      Array.isArray(inputTargets)
        ? (inputTargets as unknown as string[])
        : typeof inputTargets === 'string'
          ? [inputTargets]
          : null
    );

    return Array.from(targets);
  }

  /**
   * Merge and deduplicate targets
   */
  private mergeTargets(existing: string[] | undefined, additional: string[]): string[] {
    const merged = new Set<string>([...(existing || []), ...additional]);
    return Array.from(merged);
  }

  /**
   * Collect unique targets from a list of tool calls
   */
  private collectTargets(toolCalls: ToolCallInfo[]): string[] {
    return Array.from(new Set(toolCalls.flatMap((toolCall) => this.extractTargets(toolCall))));
  }
}
