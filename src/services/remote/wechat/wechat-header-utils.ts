function randomUint32(): number {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return bytes[0] ?? Math.floor(Math.random() * 0xffffffff);
}

function createUuidFallback(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function createWechatUinHeader(): string {
  return btoa(String(randomUint32()));
}

export function createWechatClientId(prefix = 'talkcody-wx'): string {
  const suffix =
    typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : createUuidFallback();
  return `${prefix}-${Date.now()}-${suffix.slice(0, 8)}`;
}
