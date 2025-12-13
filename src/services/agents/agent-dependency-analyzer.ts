// src/services/agents/agent-dependency-analyzer.ts

import type { ToolSet } from 'ai';
import { logger } from '@/lib/logger';
import { getToolMetadata } from '@/lib/tools';
import type { AgentRole, ExecutionPhase } from '@/types/agent';
import type { ToolCallInfo } from './tool-executor';

export const MAX_PARALLEL_SUBAGENTS = 5;

/**
 * Agent role analysis result
 */
export interface AgentRoleAnalysis {
  /** Agent call info */
  agentCall: ToolCallInfo;
  /** Agent's primary role classification */
  role: AgentRole;
  /** Target files declared by the agent */
  targets: string[];
  /** Specific tool names in this agent */
  toolNames: string[];
}

/**
 * Execution group for agent calls
 */
export interface AgentExecutionGroup {
  /** Unique identifier for this group */
  id: string;
  /** Whether agents in this group can run concurrently */
  concurrent: boolean;
  /** Max concurrency cap for the group */
  maxConcurrency: number;
  /** Agent calls in this group */
  agentCalls: ToolCallInfo[];
  /** Target files for agent operations (if applicable) */
  targetFiles?: string[];
  /** Reason for this grouping (for logging/debugging) */
  reason: string;
  /** Agent role for this group */
  agentRole: AgentRole;
}

/**
 * Execution stage for agent execution plan
 */
export interface AgentExecutionStage {
  /** Stage name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Groups within this stage */
  groups: AgentExecutionGroup[];
  /** Execution phase type */
  phase: ExecutionPhase;
}

/**
 * Agent execution plan - optimized for agent delegation with tool-aware scheduling
 */
export interface AgentExecutionPlan {
  /** All execution stages */
  stages: AgentExecutionStage[];
  /** Summary statistics */
  summary: {
    totalAgents: number;
    totalStages: number;
    totalGroups: number;
    concurrentGroups: number;
    informationGatheringAgents: number;
    contentModificationAgents: number;
  };
}

/**
 * AgentDependencyAnalyzer handles pure agent delegation scenarios
 * Optimized for callAgentV2 tools with role-based scheduling
 */
export class AgentDependencyAnalyzer {
  /**
   * Analyze agent calls and generate an optimized execution plan
   *
   * Strategy:
   * 1. Analyze each agent's role classification (information-gathering vs content-modification vs mixed)
   * 2. Discovery Phase: Information-gathering agents run in parallel (ignore targets)
   * 3. Implementation Phase: Content-modification agents run with target-based conflict detection
   * 4. Mixed Phase: Mixed-operation agents run with careful dependency analysis
   * 5. Apply MAX_PARALLEL_SUBAGENTS limit per group
   */
  async analyzeDependencies(
    agentCalls: ToolCallInfo[],
    tools: ToolSet
  ): Promise<AgentExecutionPlan> {
    if (agentCalls.length === 0) {
      return {
        stages: [],
        summary: {
          totalAgents: 0,
          totalStages: 0,
          totalGroups: 0,
          concurrentGroups: 0,
          informationGatheringAgents: 0,
          contentModificationAgents: 0,
        },
      };
    }

    // Validate all calls are agent calls
    this.validateAgentCalls(agentCalls);

    // Analyze each agent's role classification
    const agentAnalyses = await this.analyzeAgentRoles(agentCalls);

    // Separate agents by role
    const informationGatheringAgents = agentAnalyses.filter(
      (a) => a.role === 'information-gathering'
    );
    const contentModificationAgents = agentAnalyses.filter(
      (a) => a.role === 'content-modification'
    );

    // Build execution stages
    const stages = this.buildExecutionStages(informationGatheringAgents, contentModificationAgents);

    const totalGroups = stages.reduce((sum, stage) => sum + stage.groups.length, 0);
    const concurrentGroups = stages.reduce(
      (sum, stage) => sum + stage.groups.filter((g) => g.concurrent).length,
      0
    );

    const plan: AgentExecutionPlan = {
      stages,
      summary: {
        totalAgents: agentCalls.length,
        totalStages: stages.length,
        totalGroups,
        concurrentGroups,
        informationGatheringAgents: informationGatheringAgents.length,
        contentModificationAgents: contentModificationAgents.length,
      },
    };

    this.logAgentExecutionPlan(plan);
    return plan;
  }

  /**
   * Analyze each agent's role classification based on agent definition
   */
  private async analyzeAgentRoles(agentCalls: ToolCallInfo[]): Promise<AgentRoleAnalysis[]> {
    const analyses: AgentRoleAnalysis[] = [];

    for (const agentCall of agentCalls) {
      const agentId = this.extractAgentId(agentCall);
      const targets = this.extractTargets(agentCall);

      let toolNames: string[] = [];
      let role: AgentRole = 'content-modification'; // Default to most restrictive for safety

      if (agentId) {
        try {
          // Get agent definition from registry
          const agentDefinition = await this.getAgentDefinition(agentId);

          if (agentDefinition) {
            // Use explicit role if defined
            if (agentDefinition.role) {
              role = agentDefinition.role;
            } else {
              // Fallback: analyze tools to infer role
              const agentTools = agentDefinition.tools || {};
              toolNames = Object.keys(agentTools);
              role = this.inferAgentRole(agentTools, agentId);
            }
          } else {
            logger.warn(`Agent definition not found for ${agentId}, treating as mixed-operations`);
          }
        } catch (error) {
          logger.warn(`Failed to analyze role for agent ${agentId}:`, error);
          // Fallback: treat as content-modification for safety
          role = 'content-modification';
        }
      } else {
        // No agent ID found, treat as content-modification for safety
        logger.warn('Agent call without agentId, treating as content-modification');
        role = 'content-modification';
      }

      analyses.push({
        agentCall,
        role,
        targets,
        toolNames,
      });
    }

    return analyses;
  }

  /**
   * Get agent definition from registry
   */
  private async getAgentDefinition(agentId: string) {
    try {
      const { agentRegistry } = await import('@/services/agents/agent-registry');
      return await agentRegistry.getWithResolvedTools(agentId);
    } catch (error) {
      logger.error(`Failed to get agent definition for ${agentId}:`, error);
      return null;
    }
  }

  /**
   * Infer agent role from tools when explicit role is not defined
   */
  private inferAgentRole(agentTools: ToolSet, agentId: string): AgentRole {
    const toolNames = Object.keys(agentTools);

    // Special case for known agents
    if (agentId === 'context-gatherer') {
      return 'information-gathering';
    }

    // Analyze tool categories to infer role
    const toolCategories = new Set<string>();
    let hasWriteTools = false;
    let hasReadTools = false;

    for (const toolName of toolNames) {
      try {
        const metadata = getToolMetadata(toolName);
        toolCategories.add(metadata.category);

        if (metadata.category === 'write' || metadata.category === 'edit') {
          hasWriteTools = true;
        } else if (metadata.category === 'read') {
          hasReadTools = true;
        }
      } catch (error) {
        logger.warn(`Failed to get metadata for tool ${toolName}:`, error);
        // Unknown tools are treated as potentially write-capable
        hasWriteTools = true;
      }
    }

    // Determine role based on tool analysis
    if (hasWriteTools) {
      // Any write capability means content-modification (includes mixed operations)
      return 'content-modification';
    } else if (hasReadTools) {
      return 'information-gathering';
    } else {
      // No clear categorization, default to content-modification for safety
      return 'content-modification';
    }
  }

  /**
   * Extract agent ID from agent call
   */
  private extractAgentId(agentCall: ToolCallInfo): string | null {
    const input = agentCall.input as { agentId?: string };
    return input?.agentId || null;
  }

  /**
   * Build execution stages based on agent role analysis
   */
  private buildExecutionStages(
    informationGatheringAgents: AgentRoleAnalysis[],
    contentModificationAgents: AgentRoleAnalysis[]
  ): AgentExecutionStage[] {
    const stages: AgentExecutionStage[] = [];

    // Read Stage: Information-gathering agents (all parallel, ignore targets)
    if (informationGatheringAgents.length > 0) {
      stages.push(this.createReadStage(informationGatheringAgents));
    }

    // Write-Edit Stage: Content-modification agents (target-based conflict detection)
    if (contentModificationAgents.length > 0) {
      stages.push(this.createWriteEditStage(contentModificationAgents));
    }

    return stages;
  }

  /**
   * Create read stage - information-gathering agents run in parallel
   */
  private createReadStage(informationGatheringAgents: AgentRoleAnalysis[]): AgentExecutionStage {
    const agentCalls = informationGatheringAgents.map((a) => a.agentCall);
    const allTargets = informationGatheringAgents.flatMap((a) => a.targets);

    return {
      name: 'read-stage',
      description: `Reading ${informationGatheringAgents.length} file(s) and gathering context`,
      phase: 'read-stage',
      groups: [
        {
          id: 'read-group-all',
          concurrent: true,
          maxConcurrency: Math.min(MAX_PARALLEL_SUBAGENTS, informationGatheringAgents.length),
          agentCalls: agentCalls,
          targetFiles: allTargets.length > 0 ? allTargets : undefined,
          reason: 'All read operations can run in parallel',
          agentRole: 'information-gathering',
        },
      ],
    };
  }

  /**
   * Create write-edit stage - content-modification agents grouped by target conflicts
   */
  private createWriteEditStage(
    contentModificationAgents: AgentRoleAnalysis[]
  ): AgentExecutionStage {
    const groups = this.groupAgentsByTargets(contentModificationAgents, 'content-modification');

    return {
      name: 'write-edit-stage',
      description: `Writing/editing ${contentModificationAgents.length} file(s) sequentially`,
      phase: 'write-edit-stage',
      groups,
    };
  }

  /**
   * Group agents by target conflicts
   */
  private groupAgentsByTargets(
    agents: AgentRoleAnalysis[],
    role: AgentRole
  ): AgentExecutionGroup[] {
    const groups: AgentExecutionGroup[] = [];
    let currentConcurrentGroup: AgentExecutionGroup | null = null;
    let groupCounter = 0;

    const rolePrefix = 'write-edit';

    for (const agentAnalysis of agents) {
      const { agentCall, targets } = agentAnalysis;
      const hasTargets = targets.length > 0;
      const missingTargets = agentCall.toolName === 'callAgentV2' && !hasTargets;

      if (missingTargets) {
        // callAgentV2 without targets - run sequentially for safety
        groups.push({
          id: `${rolePrefix}-group-${++groupCounter}`,
          concurrent: false,
          maxConcurrency: 1,
          agentCalls: [agentCall],
          reason: 'callAgentV2 without declared targets; running sequentially for safety',
          agentRole: role,
        });
        currentConcurrentGroup = null;
        continue;
      }

      // Check for target conflicts with current concurrent group
      const hasConflict = this.hasTargetConflict(currentConcurrentGroup, targets);

      if (!currentConcurrentGroup || hasConflict) {
        // Start new concurrent group
        const reason = hasConflict
          ? `${role} agents with conflicting declared targets; starting new group`
          : hasTargets
            ? `${role} agents with declared targets`
            : `${role} agents without target conflicts`;

        currentConcurrentGroup = {
          id: `${rolePrefix}-group-${++groupCounter}`,
          concurrent: true,
          maxConcurrency: MAX_PARALLEL_SUBAGENTS,
          agentCalls: [agentCall],
          targetFiles: hasTargets ? targets : undefined,
          reason,
          agentRole: role,
        };
        groups.push(currentConcurrentGroup);
        continue;
      }

      // Add to current concurrent group
      currentConcurrentGroup.agentCalls.push(agentCall);
      if (hasTargets) {
        currentConcurrentGroup.targetFiles = this.mergeTargets(
          currentConcurrentGroup.targetFiles,
          targets
        );
      }
    }

    return groups;
  }

  /**
   * Check if there's a target conflict with the current group
   */
  private hasTargetConflict(currentGroup: AgentExecutionGroup | null, targets: string[]): boolean {
    if (!currentGroup?.concurrent || targets.length === 0) {
      return false;
    }

    const groupTargets = currentGroup.targetFiles || [];
    return targets.some((target) => groupTargets.includes(target));
  }

  /**
   * Extract declared targets from an agent call
   */
  private extractTargets(agentCall: ToolCallInfo): string[] {
    const metadata = getToolMetadata(agentCall.toolName);
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

    // Get targets from metadata
    addTargets(metadata.getTargetFile?.(agentCall.input as Record<string, unknown>));

    // Get targets from input
    const inputTargets = (agentCall.input as { targets?: unknown })?.targets;
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
   * Validate that all calls are agent calls
   */
  private validateAgentCalls(toolCalls: ToolCallInfo[]): void {
    const nonAgentCalls = toolCalls.filter(
      (call) => call.toolName !== 'callAgentV2' && call.toolName !== 'callAgent'
    );

    if (nonAgentCalls.length > 0) {
      throw new Error(
        `AgentDependencyAnalyzer can only handle agent calls. Found non-agent tools: ${nonAgentCalls
          .map((c) => c.toolName)
          .join(', ')}`
      );
    }
  }

  /**
   * Log agent execution plan for debugging
   */
  private logAgentExecutionPlan(plan: AgentExecutionPlan): void {
    logger.info('Generated role-based agent execution plan', {
      summary: plan.summary,
      stages: plan.stages.map((stage) => ({
        name: stage.name,
        description: stage.description,
        phase: stage.phase,
        groups: stage.groups.map((group) => ({
          id: group.id,
          concurrent: group.concurrent,
          maxConcurrency: group.maxConcurrency,
          agentCount: group.agentCalls.length,
          agents: group.agentCalls.map((a) => a.toolName),
          reason: group.reason,
          targetFiles: group.targetFiles,
          agentRole: group.agentRole,
        })),
      })),
    });
  }
}
