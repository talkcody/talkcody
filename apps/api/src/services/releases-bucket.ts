import type { Env, R2Bucket } from '../types/env';
import { S3Bucket } from './s3-bucket';

function readEnvString(env: Env | undefined, key: keyof Env): string | undefined {
  const value = env?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readBunEnvString(key: string): string | undefined {
  if (typeof Bun === 'undefined') return undefined;
  const value = Bun.env[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function getReleasesBucket(env?: Env): R2Bucket | null {
  if (env?.RELEASES_BUCKET) return env.RELEASES_BUCKET;

  const bucket = readBunEnvString('RELEASES_S3_BUCKET');
  const endpoint = readBunEnvString('RELEASES_S3_ENDPOINT');
  const accessKeyId = readBunEnvString('RELEASES_S3_ACCESS_KEY_ID');
  const secretAccessKey = readBunEnvString('RELEASES_S3_SECRET_ACCESS_KEY');
  const region = readBunEnvString('RELEASES_S3_REGION') ?? 'us-east-1';

  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return null;

  const forcePathStyle =
    (readBunEnvString('RELEASES_S3_FORCE_PATH_STYLE') ?? '').toLowerCase() === 'true';

  return new S3Bucket({
    endpoint,
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    sessionToken: readBunEnvString('RELEASES_S3_SESSION_TOKEN'),
    forcePathStyle,
  });
}

export function getUploadsPublicBaseUrl(env?: Env): string {
  return (
    readEnvString(env, 'UPLOADS_PUBLIC_BASE_URL') ??
    readBunEnvString('UPLOADS_PUBLIC_BASE_URL') ??
    'https://cdn.talkcody.com'
  );
}
