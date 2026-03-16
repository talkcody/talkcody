import { MEMORY_INDEX_INJECTION_LINE_LIMIT } from './memory-index-parser';

export function buildMemoryReadGuidance(target: 'index' | 'topic' | 'topics' | 'audit'): string[] {
  if (target === 'index') {
    return [
      'This reads the full MEMORY.md file for the selected scope, not just the first 200 injected lines.',
      'MEMORY.md is only the routing index. Do not assume that referenced topic files have already been read.',
      'If the injected index did not contain the route you need, inspect the full MEMORY.md contents here, then call memoryRead again with target="topic" and the exact file_name.',
    ];
  }

  if (target === 'topics') {
    return [
      'This result shows which topic files exist right now.',
      'If you need the full contents of one topic file, call memoryRead again with target="topic" and that file_name.',
    ];
  }

  if (target === 'audit') {
    return [
      'Audit results describe index-to-topic alignment only. They do not include actual topic-file contents.',
    ];
  }

  return [
    "You have read a concrete topic file. You can now rely on that file's contents in your answer.",
  ];
}

export function buildMemoryWriteGuidance(target: 'index' | 'topic'): string[] {
  if (target === 'topic') {
    return [
      'You updated a topic file, not the routing index.',
      'Use one topic file for one stable subject area. Update an existing topic when the new fact belongs to the same subject, and create a new topic only when the memory has a distinct long-term retrieval purpose.',
      'If this topic should be discoverable later, ensure MEMORY.md mentions it and explains when that topic should be read.',
      'Do not add the same memory twice. If the fact already exists in the topic file, revise the existing note instead of appending a duplicate.',
    ];
  }

  return [
    'You updated MEMORY.md, which is only the routing index.',
    'Prefer replace when updating MEMORY.md as a whole. Use append only when adding a clearly new route, not when revising an existing topic entry.',
    'Keep detailed facts in topic files rather than expanding MEMORY.md into a long knowledge dump.',
    'Do not add duplicate topic routes. If MEMORY.md already mentions a topic, revise that entry instead of writing another one.',
  ];
}

export function buildAutoMemoryGuidance(enabledProviderIds: Set<string>): string {
  const hasIndexedMemory =
    enabledProviderIds.has('global_memory') || enabledProviderIds.has('project_memory');

  if (!hasIndexedMemory) {
    return '';
  }

  return [
    'Auto memory guidance:',
    '- Each memory scope is a markdown workspace with a MEMORY.md index and optional topic .md files.',
    `- Only the first ${MEMORY_INDEX_INJECTION_LINE_LIMIT} lines of each MEMORY.md are injected automatically.`,
    '- Start with the injected MEMORY.md lines. If they do not show the route you need, read the full MEMORY.md before concluding the memory is missing.',
    '- Treat MEMORY.md as a routing index, not the detailed memory payload. If it points to a relevant topic file, read that topic file before answering from memory.',
    "- Never claim that you know a topic file's contents unless you have actually read that topic file.",
    '- When writing memory, keep MEMORY.md synchronized with topic files, keep each topic focused on one stable subject, and avoid writing duplicate topic routes or duplicate memory facts.',
    '- Save durable observations such as user preferences, repository conventions, architecture notes, commands, and recurring workflows.',
    '- Do not save temporary task state, secrets, credentials, one-off troubleshooting noise, or instructions that belong in project instruction files.',
  ].join('\n');
}

export function buildMemoryToolActivationGuidance(options: {
  hasMemoryRead: boolean;
  hasMemoryWrite: boolean;
}): string {
  if (!options.hasMemoryRead && !options.hasMemoryWrite) {
    return '';
  }

  const bullets: string[] = [];

  if (options.hasMemoryRead) {
    bullets.push(
      '- When the task depends on recalling stored preferences, project facts, commands, conventions, or prior notes, proactively consider using `memoryRead`.'
    );
    bullets.push(
      '- The prompt already includes the first 200 lines of MEMORY.md. Treat that content as an index: use it first, read the full MEMORY.md only if the route you need is missing, and read the referenced topic file before answering from its facts.'
    );
  }

  if (options.hasMemoryWrite) {
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
