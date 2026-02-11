// Environment variables type definitions

export interface Env {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  JWT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI?: string;
  NODE_ENV?: string;
  RELEASES_BUCKET?: R2Bucket;
  // Bun runtime: use an S3-compatible bucket when R2 bindings are unavailable
  RELEASES_S3_ENDPOINT?: string;
  RELEASES_S3_BUCKET?: string;
  RELEASES_S3_REGION?: string;
  RELEASES_S3_ACCESS_KEY_ID?: string;
  RELEASES_S3_SECRET_ACCESS_KEY?: string;
  RELEASES_S3_SESSION_TOKEN?: string;
  RELEASES_S3_FORCE_PATH_STYLE?: string;
  // Public base URL for uploaded files (e.g., CDN). Defaults to https://cdn.talkcody.com
  UPLOADS_PUBLIC_BASE_URL?: string;
  TALKCODY_DAILY_TOKEN_LIMIT?: string;
  SERPER_API_KEY?: string;
}

// Cloudflare R2 Bucket type
export interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | string,
    options?: R2PutOptions
  ): Promise<R2Object>;
  delete(key: string): Promise<void>;
  list(options?: R2ListOptions): Promise<R2Objects>;
}

export interface R2Object {
  key: string;
  version: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
  body: ReadableStream;
  bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  blob(): Promise<Blob>;
}

export interface R2PutOptions {
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

export interface R2HTTPMetadata {
  contentType?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
}

export interface R2ListOptions {
  limit?: number;
  prefix?: string;
  cursor?: string;
  delimiter?: string;
  include?: ('httpMetadata' | 'customMetadata')[];
}

export interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes: string[];
}

declare global {
  namespace Bun {
    interface Env {
      TURSO_DATABASE_URL: string;
      TURSO_AUTH_TOKEN: string;
      JWT_SECRET: string;
      GITHUB_CLIENT_ID: string;
      GITHUB_CLIENT_SECRET: string;
      GOOGLE_CLIENT_ID: string;
      GOOGLE_CLIENT_SECRET: string;
      GOOGLE_REDIRECT_URI?: string;
      NODE_ENV?: string;
      RELEASES_S3_ENDPOINT?: string;
      RELEASES_S3_BUCKET?: string;
      RELEASES_S3_REGION?: string;
      RELEASES_S3_ACCESS_KEY_ID?: string;
      RELEASES_S3_SECRET_ACCESS_KEY?: string;
      RELEASES_S3_SESSION_TOKEN?: string;
      RELEASES_S3_FORCE_PATH_STYLE?: string;
      UPLOADS_PUBLIC_BASE_URL?: string;
      TALKCODY_DAILY_TOKEN_LIMIT?: string;
      SERPER_API_KEY?: string;
    }
  }
}
