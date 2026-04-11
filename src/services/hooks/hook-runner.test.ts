import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bashExecutor } from '@/services/bash-executor';
import { hookRunner } from '@/services/hooks/hook-runner';

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('/app/data'),
  join: vi.fn().mockImplementation(async (...paths: string[]) => paths.join('/')),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn().mockResolvedValue(true),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: vi.fn().mockReturnValue('macos'),
}));

vi.mock('@/services/hooks/hook-config-service', () => ({
  hookConfigService: {
    loadConfigs: vi.fn(),
  },
}));

vi.mock('@/services/bash-executor', () => ({
  bashExecutor: {
    executeWithTimeout: vi.fn(),
  },
}));

/** Shared Stop hook config used across multiple tests */
const STOP_HOOK_CONFIG = {
  hooks: {
    Stop: [
      {
        matcher: '*',
        hooks: [{ type: 'command', command: 'bun run lint' }],
      },
    ],
  },
};

const STOP_INPUT = {
  session_id: 's1',
  cwd: '/workspace',
  permission_mode: 'default' as const,
  hook_event_name: 'Stop' as const,
};

describe('hookRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks when hook output decision is block', async () => {
    const { hookConfigService } = await import('@/services/hooks/hook-config-service');
    vi.mocked(hookConfigService.loadConfigs).mockResolvedValue({
      hooks: {
        PreToolUse: [
          {
            matcher: '*',
            hooks: [{ type: 'command', command: 'echo ok' }],
          },
        ],
      },
    });
    vi.mocked(bashExecutor.executeWithTimeout).mockResolvedValue({
      output: '{"decision":"block","reason":"no"}',
      error: '',
      exit_code: 0,
    });

    const summary = await hookRunner.runHooks(
      'PreToolUse',
      'bash',
      {
        session_id: 's1',
        cwd: '/workspace',
        permission_mode: 'default',
        hook_event_name: 'PreToolUse',
        tool_name: 'bash',
        tool_input: { command: 'ls' },
        tool_use_id: 'tool-1',
      },
      'task-1'
    );

    expect(summary.blocked).toBe(true);
    expect(summary.blockReason).toBe('no');
  });

  describe('Stop hook blockReason from lint output (exit code 2)', () => {
    it('uses stdout as blockReason when lint errors are written to stdout and stderr is empty', async () => {
      // Bug regression: lint tools (e.g. biome, eslint) write errors to stdout.
      // Previously only rawStderr was used, so blockReason became the fallback
      // string 'Hook blocked execution.' and the AI never saw the actual errors.
      const { hookConfigService } = await import('@/services/hooks/hook-config-service');
      vi.mocked(hookConfigService.loadConfigs).mockResolvedValue(STOP_HOOK_CONFIG);
      vi.mocked(bashExecutor.executeWithTimeout).mockResolvedValue({
        output: 'src/foo.ts:1:1 error: Missing semicolon',
        error: '',
        exit_code: 2,
      });

      const summary = await hookRunner.runHooks('Stop', '', STOP_INPUT, 'task-1');

      expect(summary.blocked).toBe(true);
      expect(summary.blockReason).toBe('src/foo.ts:1:1 error: Missing semicolon');
    });

    it('uses stderr as blockReason when only stderr has content', async () => {
      const { hookConfigService } = await import('@/services/hooks/hook-config-service');
      vi.mocked(hookConfigService.loadConfigs).mockResolvedValue(STOP_HOOK_CONFIG);
      vi.mocked(bashExecutor.executeWithTimeout).mockResolvedValue({
        output: '',
        error: 'command not found: bun',
        exit_code: 2,
      });

      const summary = await hookRunner.runHooks('Stop', '', STOP_INPUT, 'task-1');

      expect(summary.blocked).toBe(true);
      expect(summary.blockReason).toBe('command not found: bun');
    });

    it('combines stdout and stderr as blockReason when both have content', async () => {
      const { hookConfigService } = await import('@/services/hooks/hook-config-service');
      vi.mocked(hookConfigService.loadConfigs).mockResolvedValue(STOP_HOOK_CONFIG);
      vi.mocked(bashExecutor.executeWithTimeout).mockResolvedValue({
        output: 'lint error in foo.ts',
        error: 'process exited with code 2',
        exit_code: 2,
      });

      const summary = await hookRunner.runHooks('Stop', '', STOP_INPUT, 'task-1');

      expect(summary.blocked).toBe(true);
      expect(summary.blockReason).toBe('lint error in foo.ts\nprocess exited with code 2');
    });

    it('falls back to default message when both stdout and stderr are empty', async () => {
      const { hookConfigService } = await import('@/services/hooks/hook-config-service');
      vi.mocked(hookConfigService.loadConfigs).mockResolvedValue(STOP_HOOK_CONFIG);
      vi.mocked(bashExecutor.executeWithTimeout).mockResolvedValue({
        output: '',
        error: '',
        exit_code: 2,
      });

      const summary = await hookRunner.runHooks('Stop', '', STOP_INPUT, 'task-1');

      expect(summary.blocked).toBe(true);
      expect(summary.blockReason).toBe('Hook blocked execution.');
    });
  });
});
