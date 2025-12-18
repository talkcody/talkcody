import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { isAbsolute, join } from '@tauri-apps/api/path';
import { globTool } from './glob-tool';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';

// Get the mocked functions
const mockInvoke = vi.mocked(invoke);
const mockIsAbsolute = vi.mocked(isAbsolute);
const mockJoin = vi.mocked(join);
const mockGetEffectiveWorkspaceRoot = vi.mocked(getEffectiveWorkspaceRoot);

// Use Node.js path.isAbsolute for realistic behavior validation
// This ensures our mock matches real behavior
function useRealisticIsAbsoluteMock() {
  mockIsAbsolute.mockImplementation(async (p: string) => path.isAbsolute(p));
}

describe('globTool', () => {
  const PROJECT_ROOT = '/test/root';

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEffectiveWorkspaceRoot.mockResolvedValue(PROJECT_ROOT);
    mockInvoke.mockResolvedValue([]);
    // Use realistic isAbsolute behavior based on Node.js path module
    useRealisticIsAbsoluteMock();
    // Use realistic join behavior
    mockJoin.mockImplementation(async (...paths: string[]) => path.join(...paths));
  });

  describe('basic tool properties', () => {
    it('should have correct name', () => {
      expect(globTool.name).toBe('glob');
    });

    it('should have description', () => {
      expect(globTool.description).toBeTruthy();
      expect(globTool.description).toContain('glob pattern');
    });

    it('should have canConcurrent set to true', () => {
      expect(globTool.canConcurrent).toBe(true);
    });
  });

  describe('input validation', () => {
    it('should validate correct input with pattern only', () => {
      const validInput = { pattern: '**/*.ts' };
      const result = globTool.inputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should validate correct input with pattern and path', () => {
      const validInput = { pattern: '**/*.ts', path: 'src' };
      const result = globTool.inputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject missing pattern', () => {
      const invalidInput = { path: 'src' };
      const result = globTool.inputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe('path handling - the isAbsolute async bug fix', () => {
    it('should use projectRoot when path is undefined', async () => {
      await globTool.execute({ pattern: '**/*.ts' });

      expect(mockInvoke).toHaveBeenCalledWith('search_files_by_glob', {
        pattern: '**/*.ts',
        path: PROJECT_ROOT,
      });
    });

    it('should use projectRoot when path is "." (current directory)', async () => {
      // This is the key test case for the bug fix
      // Before fix: isAbsolute(".") returned Promise (truthy), so !Promise = false
      // The else-if branch never executed, searchPath stayed as "."
      // After fix: await isAbsolute(".") returns false, so else-if executes
      // path.join(projectRoot, ".") returns projectRoot

      await globTool.execute({ pattern: '**/*.ts', path: '.' });

      // Verify isAbsolute was called (it should resolve to false for ".")
      expect(mockIsAbsolute).toHaveBeenCalledWith('.');

      // Verify Node.js path.isAbsolute behavior for "." is indeed false
      expect(path.isAbsolute('.')).toBe(false);

      // The search should use projectRoot, not "."
      // path.join("/test/root", ".") => "/test/root"
      expect(mockInvoke).toHaveBeenCalledWith('search_files_by_glob', {
        pattern: '**/*.ts',
        path: PROJECT_ROOT,
      });
    });

    it('should join relative path with projectRoot', async () => {
      await globTool.execute({ pattern: '**/*.ts', path: 'src/components' });

      expect(mockIsAbsolute).toHaveBeenCalledWith('src/components');
      expect(path.isAbsolute('src/components')).toBe(false);
      expect(mockJoin).toHaveBeenCalledWith(PROJECT_ROOT, 'src/components');
      expect(mockInvoke).toHaveBeenCalledWith('search_files_by_glob', {
        pattern: '**/*.ts',
        path: path.join(PROJECT_ROOT, 'src/components'),
      });
    });

    it('should use absolute path directly without joining', async () => {
      const absolutePath = '/absolute/path/to/search';

      await globTool.execute({ pattern: '**/*.ts', path: absolutePath });

      expect(mockIsAbsolute).toHaveBeenCalledWith(absolutePath);
      expect(path.isAbsolute(absolutePath)).toBe(true);
      // join should NOT be called for absolute paths
      expect(mockJoin).not.toHaveBeenCalled();
      expect(mockInvoke).toHaveBeenCalledWith('search_files_by_glob', {
        pattern: '**/*.ts',
        path: absolutePath,
      });
    });

    it('should handle ".." relative path correctly', async () => {
      await globTool.execute({ pattern: '**/*.ts', path: '../other-project' });

      expect(mockIsAbsolute).toHaveBeenCalledWith('../other-project');
      expect(path.isAbsolute('../other-project')).toBe(false);
      expect(mockJoin).toHaveBeenCalledWith(PROJECT_ROOT, '../other-project');
      // path.join("/test/root", "../other-project") => "/test/other-project"
      expect(mockInvoke).toHaveBeenCalledWith('search_files_by_glob', {
        pattern: '**/*.ts',
        path: path.join(PROJECT_ROOT, '../other-project'),
      });
    });

    it('should handle "./src" relative path correctly', async () => {
      await globTool.execute({ pattern: '**/*.ts', path: './src' });

      expect(mockIsAbsolute).toHaveBeenCalledWith('./src');
      expect(path.isAbsolute('./src')).toBe(false);
      expect(mockJoin).toHaveBeenCalledWith(PROJECT_ROOT, './src');
      // path.join("/test/root", "./src") => "/test/root/src"
      expect(mockInvoke).toHaveBeenCalledWith('search_files_by_glob', {
        pattern: '**/*.ts',
        path: path.join(PROJECT_ROOT, './src'),
      });
    });

    it('should demonstrate the bug behavior without await', async () => {
      // This test documents what the bug was:
      // If isAbsolute was NOT awaited, the Promise object itself would be truthy
      // So !Promise would always be false, and relative paths wouldn't be converted

      // Simulate the bug: isAbsolute returns a Promise, not awaited
      const promiseResult = isAbsolute('.');
      expect(promiseResult).toBeInstanceOf(Promise);
      expect(Boolean(promiseResult)).toBe(true); // Promise is truthy
      expect(!promiseResult).toBe(false); // !Promise is always false!

      // With await, we get the actual boolean
      const awaitedResult = await isAbsolute('.');
      expect(awaitedResult).toBe(false); // "." is not absolute
      expect(!awaitedResult).toBe(true); // Now the condition works correctly
    });
  });

  describe('error handling', () => {
    it('should return error when project root is not set and no path provided', async () => {
      mockGetEffectiveWorkspaceRoot.mockResolvedValue(null);

      const result = await globTool.execute({ pattern: '**/*.ts' });

      expect(result).toContain('Error: Project root path not set');
    });

    it('should return error when project root is not set and relative path provided', async () => {
      mockGetEffectiveWorkspaceRoot.mockResolvedValue(null);

      const result = await globTool.execute({ pattern: '**/*.ts', path: 'src' });

      expect(result).toContain('Error: Project root path not set');
    });

    it('should return error when invoke fails', async () => {
      mockInvoke.mockRejectedValue(new Error('Backend error'));

      const result = await globTool.execute({ pattern: '**/*.ts' });

      expect(result).toContain('Error: Failed to search files');
      expect(result).toContain('Backend error');
    });
  });

  describe('result formatting', () => {
    it('should return "No files found" message when results are empty', async () => {
      mockInvoke.mockResolvedValue([]);

      const result = await globTool.execute({ pattern: '**/*.ts' });

      expect(result).toContain('No files found');
    });

    it('should format results with relative paths and dates', async () => {
      const mockResults = [
        { path: `${PROJECT_ROOT}/src/index.ts`, is_directory: false, modified_time: 1700000000 },
        { path: `${PROJECT_ROOT}/src/utils.ts`, is_directory: false, modified_time: 1700000000 },
      ];
      mockInvoke.mockResolvedValue(mockResults);

      const result = await globTool.execute({ pattern: '**/*.ts' });

      expect(result).toContain('Found 2 file(s)');
      expect(result).toContain('src/index.ts');
      expect(result).toContain('src/utils.ts');
    });

    it('should mark directories with [DIR]', async () => {
      const mockResults = [
        { path: `${PROJECT_ROOT}/src`, is_directory: true, modified_time: 1700000000 },
      ];
      mockInvoke.mockResolvedValue(mockResults);

      const result = await globTool.execute({ pattern: 'src' });

      expect(result).toContain('[DIR]');
    });
  });
});
