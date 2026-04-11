import { vi } from 'vitest';

// Mock the invoke function from @tauri-apps/api/core
const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

const { mockSaveOutput } = vi.hoisted(() => ({
  mockSaveOutput: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

// Mock the settings manager
vi.mock('@/stores/settings-store', () => ({
  settingsManager: {
    getCurrentRootPath: vi.fn(() => '/test/root'),
    getAutoApproveEditsGlobal: vi.fn(() => false),
  },
  useSettingsStore: {
    getState: vi.fn(() => ({
      getReasoningEffort: vi.fn(() => 'medium'),
      getAutoApproveEditsGlobal: vi.fn(() => false),
      setAutoApproveEditsGlobal: vi.fn(),
    })),
  },
}));

vi.mock('@/services/workspace-root-service', () => ({
  getValidatedWorkspaceRoot: vi.fn().mockResolvedValue('/test/root'),
  getEffectiveWorkspaceRoot: vi.fn().mockResolvedValue('/test/root'),
}));

vi.mock('@/services/task-file-service', () => ({
  taskFileService: {
    saveOutput: mockSaveOutput,
  },
}));

// Mock the logger

import { describe, expect, it, beforeEach } from 'vitest';
import { type BashResult, bashTool } from '../lib/tools/bash-tool';

const _dummyToolCallOptions = {
  toolCallId: 'test-id',
  messages: [],
};

// Context required by execute function (now includes toolId)
const testContext = { taskId: 'test-task-id', toolId: 'tool-call-123' };

// Helper to create a mock shell result
function createMockShellResult(overrides: {
  code?: number;
  stdout?: string;
  stderr?: string;
  timed_out?: boolean;
  idle_timed_out?: boolean;
  pid?: number | null;
} = {}) {
  return {
    code: 0,
    stdout: '',
    stderr: '',
    timed_out: false,
    idle_timed_out: false,
    pid: null,
    ...overrides,
  };
}

describe('bashTool', () => {
  beforeEach(() => {
    mockInvoke.mockClear();
    mockSaveOutput.mockClear();
  });

  it('should use execution rootPath from tool context for cwd', async () => {
    mockInvoke.mockResolvedValue(createMockShellResult({
      code: 0,
      stdout: 'test output',
    }));

    if (!bashTool.execute) {
      throw new Error('bashTool.execute is not defined');
    }
    const result = (await bashTool.execute(
      { command: 'pwd' },
      { taskId: 'test-task-id', toolId: 'tool-call-123', rootPath: '/worktree/root' }
    )) as BashResult;

    expect(result.success).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('execute_user_shell', {
      command: 'pwd',
      cwd: '/worktree/root',
      timeoutMs: 300000,
      idleTimeoutMs: 60000,
    });
  });

  it('should execute a safe command successfully', async () => {
    mockInvoke.mockResolvedValue(createMockShellResult({
      code: 0,
      stdout: 'test output',
    }));

    if (!bashTool.execute) {
      throw new Error('bashTool.execute is not defined');
    }
    const result = (await bashTool.execute({ command: 'ls -l' }, testContext)) as BashResult;

    expect(result.success).toBe(true);
    expect(result.output).toBe('test output');
    expect(mockInvoke).toHaveBeenCalledWith('execute_user_shell', {
      command: 'ls -l',
      cwd: '/test/root',
      timeoutMs: 300000,
      idleTimeoutMs: 60000,
    });
  });

  it('should handle a command that fails', async () => {
    mockInvoke.mockResolvedValue(createMockShellResult({
      code: 1,
      stderr: 'error output',
    }));

    if (!bashTool.execute) {
      throw new Error('bashTool.execute is not defined');
    }
    const result = (await bashTool.execute({
      command: 'cat non_existent_file',
    }, testContext)) as BashResult;

    expect(result.success).toBe(false);
    expect(result.error).toBe('error output');
  });

  it('should block a dangerous command', async () => {
    if (!bashTool.execute) {
      throw new Error('bashTool.execute is not defined');
    }
    const result = (await bashTool.execute({
      command: 'rm -rf /',
    }, testContext)) as BashResult;

    expect(result.success).toBe(false);
    expect(result.message).toContain('Command blocked');
    expect(mockInvoke).not.toHaveBeenCalledWith('execute_user_shell', expect.objectContaining({
      command: 'rm -rf /',
    }));
  });

  it('should block another dangerous command pattern', async () => {
    if (!bashTool.execute) {
      throw new Error('bashTool.execute is not defined');
    }
    const result = (await bashTool.execute({
      command: 'sudo shutdown now',
    }, testContext)) as BashResult;
    expect(result.success).toBe(false);
    expect(result.message).toContain('Command blocked');
  });

  it('should allow a safe command that contains a dangerous keyword in a safe context', async () => {
    mockInvoke.mockResolvedValue(createMockShellResult({
      code: 0,
      stdout: 'file content',
    }));
    if (!bashTool.execute) {
      throw new Error('bashTool.execute is not defined');
    }
    const result = (await bashTool.execute({
      command: 'echo "remove this line"',
    }, testContext)) as BashResult;
    expect(result.success).toBe(true);
  });

  it('should block a command with dangerous redirection', async () => {
    if (!bashTool.execute) {
      throw new Error('bashTool.execute is not defined');
    }
    const result = (await bashTool.execute({
      command: 'echo "test" > /dev/sda',
    }, testContext)) as BashResult;
    expect(result.success).toBe(false);
    expect(result.message).toContain('Command blocked');
  });

  it('should block a dangerous command in a chain', async () => {
    if (!bashTool.execute) {
      throw new Error('bashTool.execute is not defined');
    }
    const result = (await bashTool.execute({
      command: 'ls && rm -rf /',
    }, testContext)) as BashResult;
    expect(result.success).toBe(false);
    expect(result.message).toContain('Command blocked');
  });

  // New tests for enhanced dangerous command detection
  describe('enhanced dangerous command detection', () => {
    it('should block rm -rf . (current directory)', async () => {
      if (!bashTool.execute) {
        throw new Error('bashTool.execute is not defined');
      }
      const result = (await bashTool.execute({
        command: 'rm -rf .',
      }, testContext)) as BashResult;
      expect(result.success).toBe(false);
      expect(result.message).toContain('Command blocked');
    });

    it('should block rm -r with relative path', async () => {
      if (!bashTool.execute) {
        throw new Error('bashTool.execute is not defined');
      }
      const result = (await bashTool.execute({
        command: 'rm -r folder',
      }, testContext)) as BashResult;
      expect(result.success).toBe(false);
      expect(result.message).toContain('Command blocked');
    });

    it('should block rm with wildcards', async () => {
      if (!bashTool.execute) {
        throw new Error('bashTool.execute is not defined');
      }
      const result = (await bashTool.execute({
        command: 'rm *.txt',
      }, testContext)) as BashResult;
      expect(result.success).toBe(false);
      expect(result.message).toContain('Command blocked');
    });

    it('should block find with -delete', async () => {
      if (!bashTool.execute) {
        throw new Error('bashTool.execute is not defined');
      }
      const result = (await bashTool.execute({
        command: 'find . -name "*.log" -delete',
      }, testContext)) as BashResult;
      expect(result.success).toBe(false);
      expect(result.message).toContain('Command blocked');
    });

    it('should block git clean -fd', async () => {
      if (!bashTool.execute) {
        throw new Error('bashTool.execute is not defined');
      }
      const result = (await bashTool.execute({
        command: 'git clean -fd',
      }, testContext)) as BashResult;
      expect(result.success).toBe(false);
      expect(result.message).toContain('Command blocked');
    });

    it('should block git reset --hard', async () => {
      if (!bashTool.execute) {
        throw new Error('bashTool.execute is not defined');
      }
      const result = (await bashTool.execute({
        command: 'git reset --hard',
      }, testContext)) as BashResult;
      expect(result.success).toBe(false);
      expect(result.message).toContain('Command blocked');
    });

    it('should block unlink command', async () => {
      if (!bashTool.execute) {
        throw new Error('bashTool.execute is not defined');
      }
      const result = (await bashTool.execute({
        command: 'unlink file.txt',
      }, testContext)) as BashResult;
      expect(result.success).toBe(false);
      expect(result.message).toContain('Command blocked');
    });

    it('should block shred command', async () => {
      if (!bashTool.execute) {
        throw new Error('bashTool.execute is not defined');
      }
      const result = (await bashTool.execute({
        command: 'shred -u secret.txt',
      }, testContext)) as BashResult;
      expect(result.success).toBe(false);
      expect(result.message).toContain('Command blocked');
    });

    it('should block find -exec rm', async () => {
      if (!bashTool.execute) {
        throw new Error('bashTool.execute is not defined');
      }
      const result = (await bashTool.execute({
        command: 'find . -type f -exec rm {} \\;',
      }, testContext)) as BashResult;
      expect(result.success).toBe(false);
      expect(result.message).toContain('Command blocked');
    });

    it('should block mv to /dev/null', async () => {
      if (!bashTool.execute) {
        throw new Error('bashTool.execute is not defined');
      }
      const result = (await bashTool.execute({
        command: 'mv important.txt /dev/null',
      }, testContext)) as BashResult;
      expect(result.success).toBe(false);
      expect(result.message).toContain('Command blocked');
    });
  });

  describe('idle timeout handling', () => {
    it('should return success when command completes with idle timeout (dev server scenario)', async () => {
      // Simulate a dev server that outputs and then becomes idle
      mockInvoke.mockResolvedValue(createMockShellResult({
        code: -1, // Process still running
        stdout: 'Next.js 16.0.0\n- Local: http://localhost:3000\nReady in 314ms',
        stderr: '',
        idle_timed_out: true,
        timed_out: false,
        pid: 12345,
      }));

      if (!bashTool.execute) {
        throw new Error('bashTool.execute is not defined');
      }
      const result = (await bashTool.execute({
        command: 'bun run dev',
      }, testContext)) as BashResult;

      expect(result.success).toBe(true);
      expect(result.idle_timed_out).toBe(true);
      expect(result.timed_out).toBe(false);
      expect(result.pid).toBe(12345);
      expect(result.output).toContain('localhost:3000');
      expect(result.message).toContain('running in background');
    });

    it('should return success when command completes with max timeout', async () => {
      mockInvoke.mockResolvedValue(createMockShellResult({
        code: -1,
        stdout: 'Long running output...',
        stderr: '',
        idle_timed_out: false,
        timed_out: true,
        pid: 67890,
      }));

      if (!bashTool.execute) {
        throw new Error('bashTool.execute is not defined');
      }
      const result = (await bashTool.execute({
        command: 'long-running-command',
      }, testContext)) as BashResult;

      expect(result.success).toBe(true);
      expect(result.idle_timed_out).toBe(false);
      expect(result.timed_out).toBe(true);
      expect(result.pid).toBe(67890);
      expect(result.message).toContain('timed out');
    });

    it('should include PID in result for background processes', async () => {
      mockInvoke.mockResolvedValue(createMockShellResult({
        code: -1,
        stdout: 'Server started',
        idle_timed_out: true,
        pid: 54321,
      }));

      if (!bashTool.execute) {
        throw new Error('bashTool.execute is not defined');
      }
      const result = (await bashTool.execute({
        command: 'npm run serve',
      }, testContext)) as BashResult;

      expect(result.pid).toBe(54321);
      expect(result.idle_timed_out).toBe(true);
    });

    it('should handle normal command completion (no timeout)', async () => {
      mockInvoke.mockResolvedValue(createMockShellResult({
        code: 0,
        stdout: 'Command output',
        stderr: '',
        idle_timed_out: false,
        timed_out: false,
        pid: 11111,
      }));

      if (!bashTool.execute) {
        throw new Error('bashTool.execute is not defined');
      }
      const result = (await bashTool.execute({
        command: 'echo hello',
      }, testContext)) as BashResult;

      expect(result.success).toBe(true);
      expect(result.idle_timed_out).toBe(false);
      expect(result.timed_out).toBe(false);
      expect(result.exit_code).toBe(0);
      expect(result.message).toBe('Command executed successfully');
    });

    it('should handle command with stderr but still successful (idle timeout)', async () => {
      // Some dev servers output warnings to stderr but are still running fine
      mockInvoke.mockResolvedValue(createMockShellResult({
        code: -1,
        stdout: 'Server running on http://localhost:8080',
        stderr: 'Warning: deprecated feature used',
        idle_timed_out: true,
        pid: 99999,
      }));

      if (!bashTool.execute) {
        throw new Error('bashTool.execute is not defined');
      }
      const result = (await bashTool.execute({
        command: 'node server.js',
      }, testContext)) as BashResult;

      expect(result.success).toBe(true);
      expect(result.idle_timed_out).toBe(true);
      expect(result.error).toBe('Warning: deprecated feature used');
    });
  });

  describe('large output file handling', () => {
    beforeEach(() => {
      mockInvoke.mockClear();
    });

    it('should pass toolId to bash executor', async () => {
      mockInvoke.mockResolvedValue(createMockShellResult({
        code: 0,
        stdout: 'test output',
      }));

      const contextWithToolId = { taskId: 'test-task-id', toolId: 'specific-tool-call-id' };

      if (!bashTool.execute) {
        throw new Error('bashTool.execute is not defined');
      }
      const result = (await bashTool.execute({ command: 'echo test' }, contextWithToolId)) as BashResult;

      expect(result.success).toBe(true);
    });

    it('should truncate large output to 10000 chars for full strategy commands', async () => {
      const largeOutput = 'x'.repeat(15000);
      mockInvoke.mockResolvedValue(createMockShellResult({
        code: 0,
        stdout: largeOutput,
      }));
      mockSaveOutput.mockResolvedValue('/test/root/.talkcody/output/task-123/tool-456_stdout.log');

      if (!bashTool.execute) {
        throw new Error('bashTool.execute is not defined');
      }
      const result = (await bashTool.execute(
        { command: 'ls -la' },
        { taskId: 'task-123', toolId: 'tool-456' }
      )) as BashResult;

      expect(result.success).toBe(true);
      expect(result.output).toContain('chars truncated');
      expect(result.output!.length).toBeLessThanOrEqual(10100);
      expect(result.outputFilePath).toBe('/test/root/.talkcody/output/task-123/tool-456_stdout.log');
      expect(mockSaveOutput).toHaveBeenCalledWith('task-123', 'tool-456', largeOutput, 'stdout');
    });

    it('should return minimal output for successful build commands', async () => {
      mockInvoke.mockResolvedValue(createMockShellResult({
        code: 0,
        stdout: 'Build completed successfully',
      }));

      if (!bashTool.execute) {
        throw new Error('bashTool.execute is not defined');
      }
      const result = (await bashTool.execute(
        { command: 'npm run build' },
        { taskId: 'task-123', toolId: 'tool-456' }
      )) as BashResult;

      expect(result.success).toBe(true);
      expect(result.output).toBe('(output truncated on success)');
    });

    it('should return full error for failed build commands', async () => {
      const errorOutput = 'Build failed: syntax error';
      mockInvoke.mockResolvedValue(createMockShellResult({
        code: 1,
        stderr: errorOutput,
      }));

      if (!bashTool.execute) {
        throw new Error('bashTool.execute is not defined');
      }
      const result = (await bashTool.execute(
        { command: 'npm run build' },
        { taskId: 'task-123', toolId: 'tool-456' }
      )) as BashResult;

      expect(result.success).toBe(false);
      expect(result.error).toBe(errorOutput);
    });
  });
});
