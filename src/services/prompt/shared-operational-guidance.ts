import type { AgentDefinition } from '@/types/agent';

function hasTool(agent: AgentDefinition, toolName: string): boolean {
  return Boolean(agent.tools && toolName in agent.tools);
}

export function buildSharedOperationalGuidance(agent: AgentDefinition): string {
  const hasMemoryRead = hasTool(agent, 'memoryRead');
  const hasMemoryWrite = hasTool(agent, 'memoryWrite');

  if (!hasMemoryRead && !hasMemoryWrite) {
    return '';
  }

  const bullets: string[] = [];

  if (hasMemoryRead) {
    bullets.push(
      '- When the task depends on recalling stored preferences, project facts, commands, conventions, or prior notes, proactively consider using `memoryRead`.'
    );
  }

  if (hasMemoryWrite) {
    bullets.push(
      '- When the user asks you to remember something, or when you discover a stable fact that will likely help future work, proactively consider using `memoryWrite`.'
    );
  }

  bullets.push(
    "- Follow the memory tools' own rules for scope selection, durability, and error handling."
  );

  return ['## Tool Activation Guidance', '', ...bullets].join('\n');
}
