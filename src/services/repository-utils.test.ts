import { describe, expect, it } from 'vitest';
import {
  arePathsEqual,
  getFileExtension,
  getFileNameFromPath,
  getFullPath,
  getLanguageFromExtension,
  getRelativePath,
  isCodeFile,
  normalizePathForComparison,
  shouldSkipDirectory,
} from './repository-utils';

describe('repository-utils', () => {
  describe('normalizePathForComparison', () => {
    it('should convert backslashes to forward slashes', () => {
      // Note: Windows drive letters are lowercased for case-insensitive comparison
      expect(normalizePathForComparison('F:\\path\\to\\file.ts')).toBe('f:/path/to/file.ts');
      expect(normalizePathForComparison('path\\to\\file.ts')).toBe('path/to/file.ts');
    });

    it('should lowercase Windows drive letters', () => {
      expect(normalizePathForComparison('F:/path/to/file.ts')).toBe('f:/path/to/file.ts');
      expect(normalizePathForComparison('C:/Windows/System32')).toBe('c:/Windows/System32');
      expect(normalizePathForComparison('f:/path/to/file.ts')).toBe('f:/path/to/file.ts');
    });

    it('should remove trailing slashes', () => {
      expect(normalizePathForComparison('/path/to/dir/')).toBe('/path/to/dir');
      expect(normalizePathForComparison('F:/path/')).toBe('f:/path');
    });

    it('should handle Unix paths correctly', () => {
      expect(normalizePathForComparison('/usr/local/bin')).toBe('/usr/local/bin');
      expect(normalizePathForComparison('/home/user/file.txt')).toBe('/home/user/file.txt');
    });

    it('should handle empty and null paths', () => {
      expect(normalizePathForComparison('')).toBe('');
      expect(normalizePathForComparison(null as unknown as string)).toBe(null as unknown as string);
      expect(normalizePathForComparison(undefined as unknown as string)).toBe(undefined as unknown as string);
    });

    it('should handle Windows UNC paths', () => {
      expect(normalizePathForComparison('\\\\server\\share\\file.txt')).toBe('//server/share/file.txt');
    });
  });

  describe('arePathsEqual', () => {
    it('should consider paths with different separators as equal', () => {
      expect(arePathsEqual('F:/path/to/file.ts', 'F:\\path\\to\\file.ts')).toBe(true);
      expect(arePathsEqual('/usr/local/bin', '/usr/local/bin')).toBe(true);
    });

    it('should consider paths with different drive letter cases as equal', () => {
      expect(arePathsEqual('F:/path/to/file.ts', 'f:/path/to/file.ts')).toBe(true);
      expect(arePathsEqual('C:/Windows', 'c:/Windows')).toBe(true);
    });

    it('should handle mixed separator and case differences', () => {
      expect(arePathsEqual('F:\\path\\to\\file.ts', 'f:/path/to/file.ts')).toBe(true);
    });

    it('should return false for different paths', () => {
      expect(arePathsEqual('F:/path/to/file.ts', 'F:/path/to/other.ts')).toBe(false);
      expect(arePathsEqual('/usr/local/bin', '/usr/local/lib')).toBe(false);
    });

    it('should handle empty and null paths', () => {
      expect(arePathsEqual('', '')).toBe(true);
      expect(arePathsEqual('', '/path')).toBe(false);
      expect(arePathsEqual('/path', '')).toBe(false);
      expect(arePathsEqual(null as unknown as string, null as unknown as string)).toBe(true);
    });

    it('should handle real-world Windows paths from the bug report', () => {
      // This is the exact scenario from the bug report
      const normalizedPath = 'F:/cc_ws/test/analyze_efficiency.py';
      const originalPath = 'F:\\cc_ws\\test\\analyze_efficiency.py';
      expect(arePathsEqual(normalizedPath, originalPath)).toBe(true);
    });
  });

  describe('getFileNameFromPath', () => {
    it('should extract filename from Unix path', () => {
      expect(getFileNameFromPath('/path/to/file.ts')).toBe('file.ts');
    });

    it('should extract filename from Windows path', () => {
      expect(getFileNameFromPath('F:\\path\\to\\file.ts')).toBe('file.ts');
    });

    it('should handle paths with trailing separator', () => {
      expect(getFileNameFromPath('/path/to/dir/')).toBe('dir');
    });

    it('should return original path if empty or no separator', () => {
      expect(getFileNameFromPath('file.txt')).toBe('file.txt');
      expect(getFileNameFromPath('')).toBe('');
    });
  });

  describe('getFileExtension', () => {
    it('should extract extension from filename', () => {
      expect(getFileExtension('file.ts')).toBe('ts');
      expect(getFileExtension('file.test.tsx')).toBe('tsx');
    });

    it('should handle files without extension', () => {
      expect(getFileExtension('Makefile')).toBe('makefile');
      expect(getFileExtension('Dockerfile')).toBe('dockerfile');
    });

    it('should return empty string for empty filename', () => {
      expect(getFileExtension('')).toBe('');
    });
  });

  describe('getFullPath', () => {
    it('should combine base path with relative file path', () => {
      expect(getFullPath('/home/user', 'file.ts')).toBe('/home/user/file.ts');
    });

    it('should return absolute path as-is', () => {
      expect(getFullPath('/home/user', '/absolute/path/file.ts')).toBe('/absolute/path/file.ts');
    });

    it('should handle file path already containing base path', () => {
      expect(getFullPath('/home/user', '/home/user/file.ts')).toBe('/home/user/file.ts');
    });
  });

  describe('getRelativePath', () => {
    it('should extract relative path from full path', () => {
      expect(getRelativePath('/home/user/project/file.ts', '/home/user/project')).toBe('file.ts');
    });

    it('should return full path if not within repository', () => {
      expect(getRelativePath('/other/path/file.ts', '/home/user/project')).toBe('/other/path/file.ts');
    });

    it('should handle paths with different separators', () => {
      expect(getRelativePath('F:/project/file.ts', 'F:/project')).toBe('file.ts');
    });
  });

  describe('getLanguageFromExtension', () => {
    it('should map common extensions to languages', () => {
      expect(getLanguageFromExtension('file.ts')).toBe('typescript');
      expect(getLanguageFromExtension('file.tsx')).toBe('typescript');
      expect(getLanguageFromExtension('file.py')).toBe('python');
      expect(getLanguageFromExtension('file.rs')).toBe('rust');
    });

    it('should return "text" for unknown extensions', () => {
      expect(getLanguageFromExtension('file.xyz')).toBe('text');
    });
  });

  describe('isCodeFile', () => {
    it('should identify code files by extension', () => {
      expect(isCodeFile('file.ts')).toBe(true);
      expect(isCodeFile('file.py')).toBe(true);
      expect(isCodeFile('file.rs')).toBe(true);
    });

    it('should identify config files', () => {
      expect(isCodeFile('Dockerfile')).toBe(true);
      expect(isCodeFile('Makefile')).toBe(true);
    });

    it('should return false for non-code files', () => {
      expect(isCodeFile('file.pdf')).toBe(false);
      expect(isCodeFile('file.jpg')).toBe(false);
    });
  });

  describe('shouldSkipDirectory', () => {
    it('should skip common directories', () => {
      expect(shouldSkipDirectory('node_modules')).toBe(true);
      expect(shouldSkipDirectory('.git')).toBe(true);
      expect(shouldSkipDirectory('target')).toBe(true);
    });

    it('should skip hidden directories', () => {
      expect(shouldSkipDirectory('.vscode')).toBe(true);
      expect(shouldSkipDirectory('.idea')).toBe(true);
    });

    it('should not skip regular directories', () => {
      expect(shouldSkipDirectory('src')).toBe(false);
      expect(shouldSkipDirectory('docs')).toBe(false);
    });
  });
});
