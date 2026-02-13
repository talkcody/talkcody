import { describe, expect, it } from 'vitest';
import { validateS3SyncConfig } from './s3-sync-service';

describe('validateS3SyncConfig', () => {
  it('returns null for a valid config', () => {
    const err = validateS3SyncConfig({
      bucket: {
        endpoint: 'https://s3.example.com',
        region: 'us-east-1',
        bucket: 'my-bucket',
        pathStyle: true,
      },
      credentials: {
        accessKeyId: 'AKIA_TEST',
        secretAccessKey: 'SECRET_TEST',
      },
      keyPrefix: 'talkcody-sync',
    });

    expect(err).toBeNull();
  });

  it('returns an error for missing required fields', () => {
    const err = validateS3SyncConfig({
      bucket: {
        endpoint: '',
        region: '',
        bucket: '',
        pathStyle: false,
      },
      credentials: {
        accessKeyId: '',
        secretAccessKey: '',
      },
      keyPrefix: '',
    });

    expect(err).not.toBeNull();
  });
});

