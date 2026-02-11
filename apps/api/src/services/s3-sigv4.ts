type AwsService = 's3';

export type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

export type AwsSigV4Config = {
  region: string;
  service: AwsService;
  credentials: AwsCredentials;
  now?: Date;
  payloadSha256?: string;
};

const textEncoder = new TextEncoder();

function toUint8Array(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function toHex(input: ArrayBuffer | Uint8Array): string {
  const bytes = toUint8Array(input);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

async function sha256Hex(input: string | ArrayBuffer | Uint8Array): Promise<string> {
  const data =
    typeof input === 'string'
      ? textEncoder.encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

async function hmacSha256Raw(
  key: string | ArrayBuffer | Uint8Array,
  data: string
): Promise<ArrayBuffer> {
  const keyBytes =
    typeof key === 'string'
      ? textEncoder.encode(key)
      : key instanceof Uint8Array
        ? key
        : new Uint8Array(key);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  return crypto.subtle.sign('HMAC', cryptoKey, textEncoder.encode(data));
}

async function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: AwsService
): Promise<ArrayBuffer> {
  const kDate = await hmacSha256Raw(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmacSha256Raw(kDate, region);
  const kService = await hmacSha256Raw(kRegion, service);
  return hmacSha256Raw(kService, 'aws4_request');
}

function toAmzDate(now: Date): { amzDate: string; dateStamp: string } {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mi = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');

  const dateStamp = `${yyyy}${mm}${dd}`;
  const amzDate = `${dateStamp}T${hh}${mi}${ss}Z`;
  return { amzDate, dateStamp };
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function canonicalizePath(pathname: string): string {
  if (!pathname) return '/';

  const segments = pathname.split('/').map((seg) => {
    if (!seg) return '';
    let decoded = seg;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      // Keep the segment as-is if it can't be decoded.
    }
    return encodeRfc3986(decoded);
  });

  const out = segments.join('/');
  return out.startsWith('/') ? out : `/${out}`;
}

function canonicalizeQuery(searchParams: URLSearchParams): string {
  const entries: Array<{ k: string; v: string }> = [];
  for (const [k, v] of searchParams.entries()) entries.push({ k, v });

  entries.sort((a, b) => {
    if (a.k < b.k) return -1;
    if (a.k > b.k) return 1;
    if (a.v < b.v) return -1;
    if (a.v > b.v) return 1;
    return 0;
  });

  return entries.map(({ k, v }) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`).join('&');
}

function canonicalizeHeaders(headers: Headers): {
  canonicalHeaders: string;
  signedHeaders: string;
} {
  const pairs: Array<{ key: string; value: string }> = [];

  for (const [rawKey, rawValue] of headers.entries()) {
    const key = rawKey.trim().toLowerCase();
    if (key === 'authorization') continue;
    const value = rawValue.replace(/\s+/g, ' ').trim();
    pairs.push({ key, value });
  }

  pairs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const canonicalHeaders = pairs.map(({ key, value }) => `${key}:${value}\n`).join('');
  const signedHeaders = pairs.map(({ key }) => key).join(';');
  return { canonicalHeaders, signedHeaders };
}

export async function buildCanonicalRequest(params: {
  method: string;
  url: URL;
  headers: Headers;
  payloadHash: string;
}): Promise<{ canonicalRequest: string; signedHeaders: string }> {
  const canonicalUri = canonicalizePath(params.url.pathname);
  const canonicalQuery = canonicalizeQuery(params.url.searchParams);
  const { canonicalHeaders, signedHeaders } = canonicalizeHeaders(params.headers);

  const canonicalRequest = [
    params.method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    params.payloadHash,
  ].join('\n');

  return { canonicalRequest, signedHeaders };
}

export async function signAwsRequest(params: {
  method: string;
  url: URL;
  headers?: HeadersInit;
  body?: ArrayBuffer | Uint8Array | string | ReadableStream;
  config: AwsSigV4Config;
}): Promise<{
  headers: Headers;
  amzDate: string;
  payloadHash: string;
  canonicalRequest: string;
}> {
  const now = params.config.now ?? new Date();
  const { amzDate, dateStamp } = toAmzDate(now);
  const { credentials, region, service } = params.config;

  const headers = new Headers(params.headers);
  headers.set('host', params.url.host);
  headers.set('x-amz-date', amzDate);

  if (credentials.sessionToken) {
    headers.set('x-amz-security-token', credentials.sessionToken);
  }

  let payloadHash = params.config.payloadSha256 ?? '';
  if (!payloadHash) {
    if (!params.body) {
      payloadHash = await sha256Hex('');
    } else if (params.body instanceof ReadableStream) {
      payloadHash = 'UNSIGNED-PAYLOAD';
    } else if (params.body instanceof Uint8Array) {
      payloadHash = await sha256Hex(params.body);
    } else if (typeof params.body === 'string') {
      payloadHash = await sha256Hex(params.body);
    } else {
      payloadHash = await sha256Hex(params.body);
    }
  }

  headers.set('x-amz-content-sha256', payloadHash);

  const { canonicalRequest, signedHeaders } = await buildCanonicalRequest({
    method: params.method,
    url: params.url,
    headers,
    payloadHash,
  });

  const canonicalRequestHash = await sha256Hex(canonicalRequest);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

  const signingKey = await deriveSigningKey(
    credentials.secretAccessKey,
    dateStamp,
    region,
    service
  );
  const signature = toHex(await hmacSha256Raw(signingKey, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  headers.set('Authorization', authorization);
  return { headers, amzDate, payloadHash, canonicalRequest };
}
