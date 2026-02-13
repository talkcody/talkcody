import { invoke } from '@tauri-apps/api/core';

export type S3BucketConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  pathStyle: boolean;
};

export type S3CredentialsInput = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

export type S3SyncConfig = {
  bucket: S3BucketConfig;
  credentials: S3CredentialsInput;
  namespace?: string;
  keyPrefix: string;
};

export type S3SyncBackupResult = {
  namespace: string;
  latestKey: string;
  timestampKey: string;
  sha256: string;
  size: number;
  createdAtMs: number;
};

export function validateS3SyncConfig(config: S3SyncConfig): string | null {
  if (!config.bucket.endpoint.trim()) return 'Missing S3 endpoint';
  if (!config.bucket.region.trim()) return 'Missing S3 region';
  if (!config.bucket.bucket.trim()) return 'Missing S3 bucket';
  if (!config.credentials.accessKeyId.trim()) return 'Missing access key id';
  if (!config.credentials.secretAccessKey.trim()) return 'Missing secret access key';
  if (!config.keyPrefix.trim()) return 'Missing key prefix';
  return null;
}

export const s3SyncService = {
  async testConnection(config: S3SyncConfig): Promise<void> {
    await invoke('s3_sync_test_connection', { config });
  },

  async backup(config: S3SyncConfig): Promise<S3SyncBackupResult> {
    return await invoke<S3SyncBackupResult>('s3_sync_backup', { config });
  },

  async scheduleRestore(config: S3SyncConfig): Promise<string> {
    return await invoke<string>('s3_sync_schedule_restore', { config });
  },
};
