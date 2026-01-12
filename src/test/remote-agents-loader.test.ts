import { describe, expect, it } from 'vitest';
import { remoteAgentsLoader } from '@/providers/remote-agents/remote-agents-loader';

// Basic sanity check for loader default config

describe('remoteAgentsLoader', () => {
  it('loads default config with version and array', () => {
    const config = remoteAgentsLoader.getDefaultConfig();
    expect(config.version).toBeTruthy();
    expect(Array.isArray(config.remoteAgents)).toBe(true);
  });
});
