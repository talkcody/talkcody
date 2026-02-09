// src/providers/custom/custom-provider-url.ts

const CUSTOM_PROVIDER_ENDPOINT_SUFFIXES = [
  '/chat/completions',
  '/completions',
  '/responses',
  '/messages',
  '/models',
];

const V1_SEGMENT = 'v1';

function hasV1Segment(baseUrl: string): boolean {
  return baseUrl.split('/').some((segment) => segment === V1_SEGMENT);
}

export function normalizeCustomProviderBaseUrl(baseUrl: string): string {
  let normalized = baseUrl.trim();

  if (!normalized) {
    return normalized;
  }

  normalized = normalized.replace(/\/+$/, '');

  for (const suffix of CUSTOM_PROVIDER_ENDPOINT_SUFFIXES) {
    if (normalized.endsWith(suffix)) {
      normalized = normalized.slice(0, -suffix.length).replace(/\/+$/, '');
      break;
    }
  }

  if (!hasV1Segment(normalized)) {
    normalized = `${normalized}/v1`;
  }

  return normalized;
}
