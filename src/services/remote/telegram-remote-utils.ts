const TELEGRAM_COMMAND_PREFIX_RE = /^\/(\w+)(?:@\w+)?/i;
const DEFAULT_CHUNK_LIMIT = 4096;
const DEFAULT_DEDUP_TTL_MS = 5 * 60 * 1000;

type DedupEntry = {
  seenAt: number;
};

const dedupStore = new Map<string, DedupEntry>();

function cleanupDedup(now: number, ttlMs: number): void {
  for (const [key, entry] of dedupStore.entries()) {
    if (now - entry.seenAt > ttlMs) {
      dedupStore.delete(key);
    }
  }
}

export function isDuplicateTelegramMessage(
  chatId: number,
  messageId: number,
  ttlMs: number = DEFAULT_DEDUP_TTL_MS
): boolean {
  const now = Date.now();
  cleanupDedup(now, ttlMs);
  const key = `${chatId}:${messageId}`;
  if (dedupStore.has(key)) {
    return true;
  }
  dedupStore.set(key, { seenAt: now });
  return false;
}

export function normalizeTelegramCommand(input: string): string {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return trimmed;
  }
  const match = TELEGRAM_COMMAND_PREFIX_RE.exec(trimmed);
  if (!match) {
    return trimmed;
  }
  const command = match[1]?.toLowerCase() ?? '';
  const rest = trimmed.slice(match[0]?.length ?? 0).trim();
  return rest ? `/${command} ${rest}` : `/${command}`;
}

function splitByPreference(text: string, limit: number): string[] {
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    let sliceEnd = remaining.lastIndexOf('\n\n', limit);
    if (sliceEnd < 0) {
      sliceEnd = remaining.lastIndexOf('\n', limit);
    }
    if (sliceEnd < 0) {
      sliceEnd = remaining.lastIndexOf('. ', limit);
    }
    if (sliceEnd < 0 || sliceEnd < Math.floor(limit * 0.6)) {
      sliceEnd = limit;
    }

    chunks.push(remaining.slice(0, sliceEnd).trim());
    remaining = remaining.slice(sliceEnd).trim();
  }

  if (remaining.trim()) {
    chunks.push(remaining.trim());
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

export function splitTelegramText(text: string, limit: number = DEFAULT_CHUNK_LIMIT): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  const safeLimit = Math.max(256, Math.min(limit, DEFAULT_CHUNK_LIMIT));
  return splitByPreference(trimmed, safeLimit);
}
