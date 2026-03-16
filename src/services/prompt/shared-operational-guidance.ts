import { buildMemoryToolActivationGuidance } from '@/services/memory/memory-guidance';
import type { AgentDefinition } from '@/types/agent';

function hasTool(agent: AgentDefinition, toolName: string): boolean {
  return Boolean(agent.tools && toolName in agent.tools);
}

export function buildSharedOperationalGuidance(agent: AgentDefinition): string {
  return buildMemoryToolActivationGuidance({
    hasMemoryRead: hasTool(agent, 'memoryRead'),
    hasMemoryWrite: hasTool(agent, 'memoryWrite'),
  });
}
