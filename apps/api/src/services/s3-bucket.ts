import type {
  R2Bucket,
  R2HTTPMetadata,
  R2ListOptions,
  R2Object,
  R2Objects,
  R2PutOptions,
} from '../types/env';
import { signAwsRequest } from './s3-sigv4';

export type S3BucketConfig = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  forcePathStyle?: boolean;
};

function ensureEndpointUrl(endpoint: string): URL {
  return new URL(endpoint.includes('://') ? endpoint : `https://${endpoint}`);
}

function encodeKeyPath(key: string): string {
  if (!key) return '/';
  const parts = key.split('/').map((part) => encodeURIComponent(part));
  return `/${parts.join('/')}`;
}

function normalizeEtag(etagHeader: string | null): { etag: string; httpEtag: string } {
  if (!etagHeader) return { etag: '', httpEtag: '' };
  const httpEtag = etagHeader;
  const etag = etagHeader.replace(/^\"|\"$/g, '');
  return { etag, httpEtag };
}

function emptyBodyStream(): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.close();
    },
  });
}

function buildObjectFromResponse(key: string, response: Response): R2Object {
  const { etag, httpEtag } = normalizeEtag(response.headers.get('etag'));
  const sizeHeader = response.headers.get('content-length');
  const lastModified = response.headers.get('last-modified');
  const version = response.headers.get('x-amz-version-id') ?? '';

  return {
    key,
    version,
    size: sizeHeader ? Number(sizeHeader) : 0,
    etag,
    httpEtag,
    uploaded: lastModified ? new Date(lastModified) : new Date(),
    httpMetadata: undefined,
    customMetadata: undefined,
    body: response.body ?? emptyBodyStream(),
    get bodyUsed() {
      return response.bodyUsed;
    },
    arrayBuffer: async () => response.arrayBuffer(),
    text: async () => response.text(),
    json: async <T = unknown>() => response.json() as Promise<T>,
    blob: async () => response.blob(),
  };
}

export function parseListObjectsV2Xml(xml: string): {
  keys: Array<{ key: string; size: number; etag: string; lastModified: Date }>;
  truncated: boolean;
  nextContinuationToken?: string;
  commonPrefixes: string[];
} {
  const unescapeXml = (s: string) => s.replaceAll('&quot;', '"').replaceAll('&amp;', '&');

  const keys: Array<{ key: string; size: number; etag: string; lastModified: Date }> = [];

  const contentsRe = /<Contents>([\s\S]*?)<\/Contents>/g;
  for (const match of xml.matchAll(contentsRe)) {
    const block = match[1] ?? '';
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(block)?.[1];
    if (!key) continue;

    const sizeStr = /<Size>([\s\S]*?)<\/Size>/.exec(block)?.[1] ?? '0';
    const etagRaw = /<ETag>([\s\S]*?)<\/ETag>/.exec(block)?.[1] ?? '';
    const lastModifiedStr = /<LastModified>([\s\S]*?)<\/LastModified>/.exec(block)?.[1] ?? '';

    keys.push({
      key: unescapeXml(key),
      size: Number(sizeStr),
      etag: unescapeXml(etagRaw).replace(/^\"|\"$/g, ''),
      lastModified: lastModifiedStr ? new Date(lastModifiedStr) : new Date(0),
    });
  }

  const truncatedStr = /<IsTruncated>(true|false)<\/IsTruncated>/.exec(xml)?.[1] ?? 'false';
  const truncated = truncatedStr === 'true';
  const nextContinuationToken = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(
    xml
  )?.[1];

  const commonPrefixes: string[] = [];
  const prefixesRe = /<CommonPrefixes>\s*<Prefix>([\s\S]*?)<\/Prefix>\s*<\/CommonPrefixes>/g;
  for (const match of xml.matchAll(prefixesRe)) {
    const prefix = match[1];
    if (prefix) commonPrefixes.push(unescapeXml(prefix));
  }

  return {
    keys,
    truncated,
    nextContinuationToken: nextContinuationToken ? unescapeXml(nextContinuationToken) : undefined,
    commonPrefixes,
  };
}

export class S3Bucket implements R2Bucket {
  private config: S3BucketConfig;

  constructor(config: S3BucketConfig) {
    this.config = config;
  }

  private buildUrl(key: string, query?: Record<string, string | undefined>): URL {
    const endpointUrl = ensureEndpointUrl(this.config.endpoint);

    const baseHost = this.config.forcePathStyle
      ? endpointUrl.host
      : `${this.config.bucket}.${endpointUrl.host}`;

    const basePath = this.config.forcePathStyle ? `/${this.config.bucket}` : '';

    const url = new URL(`${endpointUrl.protocol}//${baseHost}${basePath}`);
    url.pathname = `${basePath}${encodeKeyPath(key)}`;

    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, v);
      }
    }

    return url;
  }

  private async signedFetch(
    method: string,
    url: URL,
    init?: {
      body?: ArrayBuffer | Uint8Array | string | ReadableStream;
      headers?: HeadersInit;
    }
  ): Promise<Response> {
    const { headers } = await signAwsRequest({
      method,
      url,
      headers: init?.headers,
      body: init?.body,
      config: {
        region: this.config.region,
        service: 's3',
        credentials: {
          accessKeyId: this.config.accessKeyId,
          secretAccessKey: this.config.secretAccessKey,
          sessionToken: this.config.sessionToken,
        },
      },
    });

    return fetch(url, { method, headers, body: init?.body });
  }

  async get(key: string): Promise<R2Object | null> {
    const url = this.buildUrl(key);
    const res = await this.signedFetch('GET', url);

    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3 GET failed: ${res.status} ${res.statusText}`);

    return buildObjectFromResponse(key, res);
  }

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | string,
    options?: R2PutOptions
  ): Promise<R2Object> {
    const url = this.buildUrl(key);
    const headers: Record<string, string> = {};
    const httpMetadata: R2HTTPMetadata | undefined = options?.httpMetadata;

    if (httpMetadata?.contentType) headers['content-type'] = httpMetadata.contentType;
    if (httpMetadata?.cacheControl) headers['cache-control'] = httpMetadata.cacheControl;
    if (httpMetadata?.contentDisposition)
      headers['content-disposition'] = httpMetadata.contentDisposition;
    if (httpMetadata?.contentEncoding) headers['content-encoding'] = httpMetadata.contentEncoding;
    if (httpMetadata?.contentLanguage) headers['content-language'] = httpMetadata.contentLanguage;

    // NOTE: R2 customMetadata maps to x-amz-meta-* headers in S3. We only forward string values.
    if (options?.customMetadata) {
      for (const [k, v] of Object.entries(options.customMetadata)) {
        headers[`x-amz-meta-${k}`] = v;
      }
    }

    const res = await this.signedFetch('PUT', url, { body: value, headers });
    if (!res.ok) throw new Error(`S3 PUT failed: ${res.status} ${res.statusText}`);
    return buildObjectFromResponse(key, res);
  }

  async delete(key: string): Promise<void> {
    const url = this.buildUrl(key);
    const res = await this.signedFetch('DELETE', url);
    if (res.status === 404) return;
    if (!res.ok) throw new Error(`S3 DELETE failed: ${res.status} ${res.statusText}`);
  }

  async list(options?: R2ListOptions): Promise<R2Objects> {
    const url = this.buildUrl('', {
      'list-type': '2',
      prefix: options?.prefix,
      delimiter: options?.delimiter,
      'max-keys': options?.limit !== undefined ? String(options.limit) : undefined,
      'continuation-token': options?.cursor,
    });

    const res = await this.signedFetch('GET', url);
    if (!res.ok) throw new Error(`S3 LIST failed: ${res.status} ${res.statusText}`);

    const xml = await res.text();
    const parsed = parseListObjectsV2Xml(xml);

    return {
      objects: parsed.keys.map((k) => ({
        key: k.key,
        version: '',
        size: k.size,
        etag: k.etag,
        httpEtag: k.etag ? `"${k.etag}"` : '',
        uploaded: k.lastModified,
        httpMetadata: undefined,
        customMetadata: undefined,
        body: emptyBodyStream(),
        bodyUsed: false,
        arrayBuffer: async () => new ArrayBuffer(0),
        text: async () => '',
        json: async <T = unknown>() => ({}) as T,
        blob: async () => new Blob([]),
      })),
      truncated: parsed.truncated,
      cursor: parsed.nextContinuationToken,
      delimitedPrefixes: parsed.commonPrefixes,
    };
  }
}
