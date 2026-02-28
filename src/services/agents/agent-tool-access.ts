export interface ToolAccessRule {
  /** If set, only these agents may access the tool */
  allowAgents?: readonly string[];
  /** If set, these agents may NOT access the tool */
  denyAgents?: readonly string[];
}

export interface AgentAccessRule {
  /** If set, only these tools may be used by the agent */
  allowTools?: readonly string[];
  /** If set, these tools may NOT be used by the agent */
  denyTools?: readonly string[];
}

/**
 * Centralized Agent ↔ Tool access control configuration.
 *
 * Edit this config to control which agents can use which tools.
 * Rules are enforced in:
 * - UI (tool selection/hiding)
 * - Runtime (tool overrides + toolset loading)
 */
export const TOOL_ACCESS_RULES: Record<string, ToolAccessRule> = {
  callAgent: { allowAgents: ['planner', 'orchestrator'] },
};

export function isToolAllowedForAgent(agentId: string | undefined, toolId: string): boolean {
  const toolRule = TOOL_ACCESS_RULES[toolId];
  if (toolRule) {
    if (toolRule.allowAgents) return !!agentId && toolRule.allowAgents.includes(agentId);
    if (toolRule.denyAgents) return !toolRule.denyAgents.includes(agentId ?? '');
  }

  return true;
}

export function filterToolSetForAgent(
  agentId: string | undefined,
  tools: Record<string, unknown>
): { tools: Record<string, unknown>; removedToolIds: string[] } {
  const removedToolIds: string[] = [];
  const filtered: Record<string, unknown> = {};

  for (const [toolId, tool] of Object.entries(tools)) {
    if (!isToolAllowedForAgent(agentId, toolId)) {
      removedToolIds.push(toolId);
      continue;
    }
    filtered[toolId] = tool;
  }

  return { tools: filtered, removedToolIds };
}
