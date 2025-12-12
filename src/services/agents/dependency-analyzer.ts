// src/services/agents/dependency-analyzer.ts

import type { ToolSet } from 'ai';
import { logger } from '@/lib/logger';
import { AgentDependencyAnalyzer, type AgentExecutionPlan } from './agent-dependency-analyzer';
import { type ExecutionPlan, ToolDependencyAnalyzer } from './tool-dependency-analyzer';
import type { ToolCallInfo } from './tool-executor';
import { normalizeToolName } from './tool-name-normalizer';

/**
 * Unified execution plan that can handle both tool and agent execution plans
 */
export type UnifiedExecutionPlan = ExecutionPlan | AgentExecutionPlan;

/**
 * Check if a plan is an agent execution plan
 */
export function isAgentExecutionPlan(plan: UnifiedExecutionPlan): plan is AgentExecutionPlan {
  // AgentExecutionPlan has stages with AgentExecutionStage type
  // ToolExecutionPlan has stages with ExecutionStage type
  // We can distinguish by checking if summary has agent-specific fields
  return 'stages' in plan && 'totalAgents' in plan.summary;
}

/**
 * DependencyAnalyzer is the main entry point for analyzing tool dependencies
 * It automatically selects the appropriate analyzer based on the tool types
 */
export class DependencyAnalyzer {
  private toolAnalyzer = new ToolDependencyAnalyzer();
  private agentAnalyzer = new AgentDependencyAnalyzer();

  /**
   * Analyze tool calls and generate an optimized execution plan
   *
   * Strategy:
   * 1. Check if all calls are agent calls (callAgent/callAgentV2)
   * 2. If yes, use AgentDependencyAnalyzer for optimized agent delegation
   * 3. If no, validate no mixed agent + other tools (strict isolation)
   * 4. Use ToolDependencyAnalyzer for regular tool execution
   */
  async analyzeDependencies(
    toolCalls: ToolCallInfo[],
    tools: ToolSet
  ): Promise<UnifiedExecutionPlan> {
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

    // Separate agent calls from other tools
    const { agentCalls, otherTools } = this.separateAgentCalls(toolCalls);

    // Pure agent calls - use AgentDependencyAnalyzer
    if (agentCalls.length > 0 && otherTools.length === 0) {
      logger.info('Using AgentDependencyAnalyzer for pure agent delegation', {
        agentCount: agentCalls.length,
        agents: agentCalls.map((c) => c.toolName),
      });
      return await this.agentAnalyzer.analyzeDependencies(agentCalls, tools);
    }

    // Mixed calls - validate and reject
    if (agentCalls.length > 0 && otherTools.length > 0) {
      this.validateNoMixedAgentCalls(agentCalls, otherTools);
    }

    // Pure tool calls - use ToolDependencyAnalyzer
    logger.info('Using ToolDependencyAnalyzer for regular tool execution', {
      toolCount: toolCalls.length,
      tools: toolCalls.map((c) => c.toolName),
    });
    return this.toolAnalyzer.analyzeDependencies(toolCalls, tools);
  }

  /**
   * Separate agent calls from other tools
   */
  private separateAgentCalls(toolCalls: ToolCallInfo[]): {
    agentCalls: ToolCallInfo[];
    otherTools: ToolCallInfo[];
  } {
    const agentCalls: ToolCallInfo[] = [];
    const otherTools: ToolCallInfo[] = [];

    for (const toolCall of toolCalls) {
      const normalizedToolName = normalizeToolName(toolCall.toolName);
      if (normalizedToolName) {
        toolCall.toolName = normalizedToolName;
      }

      if (toolCall.toolName === 'callAgent' || toolCall.toolName === 'callAgentV2') {
        agentCalls.push(toolCall);
      } else {
        otherTools.push(toolCall);
      }
    }

    return { agentCalls, otherTools };
  }

  /**
   * Validate that agent calls are not mixed with other tools
   * This enforces context isolation and prevents tool conflicts
   */
  private validateNoMixedAgentCalls(agentCalls: ToolCallInfo[], otherTools: ToolCallInfo[]): void {
    const errorMessage = `Context isolation violation: Agent calls cannot be mixed with other tools in the same response.

Found mixed calls:
- Agent calls: ${agentCalls.map((c) => c.toolName).join(', ')}
- Other tools: ${otherTools.map((c) => c.toolName).join(', ')}

Solution: Use separate responses for:
1. Information gathering (readFile, grepSearch, etc.)
2. Agent delegation (callAgent/callAgentV2)

This ensures clean context boundaries and prevents tool conflicts.`;

    logger.error('Mixed agent and tool calls detected', {
      agentCalls: agentCalls.map((c) => ({ name: c.toolName, id: c.toolCallId })),
      otherCalls: otherTools.map((c) => ({ name: c.toolName, id: c.toolCallId })),
    });

    throw new Error(errorMessage);
  }
}
