// src/services/repository-utils.ts
import { join, normalize } from '@tauri-apps/api/path';

const WINDOWS_PATH_REGEX = /^[a-zA-Z]:[\\/]/;

const PATH_SEPARATOR_REGEX = /[\\/]+/;

function normalizeSeparators(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Synchronously normalize a file path for comparison purposes.
 * This converts backslashes to forward slashes and handles Windows drive letters.
 * Note: This is for comparison only, not for actual file system operations.
 * @param path - The file path to normalize
 * @returns Normalized path string
 */
export function normalizePathForComparison(path: string): string {
  if (!path) return path;

  // Convert backslashes to forward slashes
  let normalized = path.replace(/\\/g, '/');

  // Handle Windows drive letter - convert to lowercase for case-insensitive comparison
  // e.g., "F:/path" and "f:/path" should be considered equal
  if (/^[a-zA-Z]:\//.test(normalized)) {
    normalized = normalized.charAt(0).toLowerCase() + normalized.slice(1);
  }

  // Remove trailing slashes (except for root "/")
  normalized = normalized.replace(/\/$/, '');

  return normalized;
}

/**
 * Compare two file paths for equality, handling platform differences.
 * Works on both Windows and Unix-like systems.
 * @param path1 - First file path
 * @param path2 - Second file path
 * @returns True if paths are equivalent
 */
export function arePathsEqual(path1: string, path2: string): boolean {
  if (!path1 || !path2) return path1 === path2;
  return normalizePathForComparison(path1) === normalizePathForComparison(path2);
}

/**
 * Normalize file path by handling relative paths and path normalization
 * @param rootPath - The root directory path
 * @param filePath - The file path (can be relative or absolute)
 * @returns Normalized absolute file path
 */
export async function normalizeFilePath(rootPath: string, filePath: string): Promise<string> {
  const isAbsolute =
    filePath.startsWith('/') ||
    WINDOWS_PATH_REGEX.test(filePath) ||
    filePath.startsWith('\\\\') ||
    filePath.startsWith('//') ||
    filePath.startsWith('\\\\?\\');

  if (isAbsolute) {
    return await normalize(filePath);
  }
  // If filePath is relative, join it with rootPath to form absolute path
  filePath = await join(rootPath, filePath);
  // Normalize the path to handle cases like '../' or './'
  return await normalize(filePath);
}

export function getFileNameFromPath(path: string): string {
  const normalizedPath = normalizeSeparators(path).replace(/\/+$/, '');
  if (!normalizedPath) return path;

  return normalizedPath.split(PATH_SEPARATOR_REGEX).filter(Boolean).pop() || path;
}

export function getFileExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
}

export function getFullPath(basePath: string, filePath: string): string {
  // Normalize paths to handle different separators
  const normalizedBasePath = normalizeSeparators(basePath).replace(/\/$/, '');
  const normalizedFilePath = normalizeSeparators(filePath);

  // Check if filePath already contains basePath
  if (
    normalizedFilePath.startsWith(`${normalizedBasePath}/`) ||
    normalizedFilePath === normalizedBasePath
  ) {
    return filePath; // Return original filePath as it already contains full path
  }

  // Check if filePath is an absolute path
  if (normalizedFilePath.startsWith('/') || /^[a-zA-Z]:/.test(normalizedFilePath)) {
    return filePath; // Return as-is if it's already an absolute path
  }

  // Combine basePath with relative filePath
  return `${normalizedBasePath}/${normalizedFilePath.replace(/^\//, '')}`;
}

/**
 * Map file extension to language identifier
 */
export function getLanguageFromExtension(filename: string): string {
  const ext = getFileExtension(filename);
  const languageMap: { [key: string]: string } = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    cpp: 'cpp',
    h: 'cpp',
    c: 'c',
    css: 'css',
    scss: 'scss',
    html: 'html',
    json: 'json',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sh: 'bash',
    toml: 'toml',
    sql: 'sql',
    graphql: 'graphql',
    vue: 'vue',
    svelte: 'svelte',
  };
  return languageMap[ext] || 'text';
}

export function shouldSkipDirectory(name: string): boolean {
  const skipDirs = [
    'node_modules',
    'target',
    'dist',
    'build',
    '.git',
    '.svn',
    '.hg',
    '.vscode',
    '.idea',
    '__pycache__',
    '.pytest_cache',
    'coverage',
    '.nyc_output',
  ];

  return name.startsWith('.') || skipDirs.includes(name);
}

/**
 * Check if file is a code file based on extension
 */
export function isCodeFile(filename: string): boolean {
  const codeExtensions = [
    'js',
    'jsx',
    'ts',
    'tsx',
    'vue',
    'svelte',
    'py',
    'rs',
    'go',
    'java',
    'cpp',
    'c',
    'h',
    'hpp',
    'css',
    'scss',
    'sass',
    'less',
    'styl',
    'html',
    'htm',
    'xml',
    'svg',
    'json',
    'yaml',
    'yml',
    'toml',
    'ini',
    'cfg',
    'md',
    'mdx',
    'txt',
    'log',
    'sh',
    'bash',
    'zsh',
    'fish',
    'ps1',
    'sql',
    'graphql',
    'proto',
    'dockerfile',
    'makefile',
    'rakefile',
    'rb',
    'php',
    'swift',
    'kt',
    'scala',
    'dart',
    'elm',
    'clj',
    'ex',
    'exs',
  ];

  const ext = getFileExtension(filename);
  const hasValidExtension = codeExtensions.includes(ext);
  const isConfigFile = ['dockerfile', 'makefile', 'rakefile', 'gemfile'].includes(
    filename.toLowerCase()
  );

  return hasValidExtension || isConfigFile;
}

/**
 * Get relative path by removing repository path prefix
 */
export function getRelativePath(fullPath: string, repositoryPath: string): string {
  const normalizedFullPath = normalizeSeparators(fullPath);
  const normalizedRepositoryPath = normalizeSeparators(repositoryPath).replace(/\/$/, '');

  if (normalizedFullPath.startsWith(`${normalizedRepositoryPath}/`)) {
    return normalizedFullPath.substring(normalizedRepositoryPath.length + 1);
  }
  return fullPath;
}
