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
    bullets.push(
      '- The prompt already includes the first 200 lines of MEMORY.md. Treat that content as an index: use it first, read the full MEMORY.md only if the route you need is missing, and read the referenced topic file before answering from its facts.'
    );
  }

  if (hasMemoryWrite) {
    bullets.push(
      '- When the user asks you to remember something, or when you discover a stable fact that will likely help future work, proactively consider using `memoryWrite`.'
    );
    bullets.push(
      '- Keep MEMORY.md concise and synchronized with the topic files that exist. Store detailed facts in topic files, not in the index, and organize topics by stable subject rather than mixing unrelated memories together.'
    );
    bullets.push(
      '- Avoid duplicate memory. If a topic route or memory fact already exists, update the existing entry instead of writing another copy in MEMORY.md or the topic file.'
    );
  }

  bullets.push(
    "- Follow the memory tools' own rules for scope selection, durability, and error handling."
  );

  return ['## Tool Activation Guidance', '', ...bullets].join('\n');
}
