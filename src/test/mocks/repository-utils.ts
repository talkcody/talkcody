// src/test/mocks/repository-utils.ts
// Centralized mock for ../services/repository-utils

import { vi } from 'vitest';

export const createMockNormalizeFilePath = () =>
  vi.fn().mockImplementation(async (root: string, path: string) => {
    // If path is already absolute (starts with /), return it as-is
    if (path.startsWith('/')) {
      return path;
    }
    // Otherwise, join with root
    return `${root}/${path}`;
  });

/**
 * Synchronously normalize a file path for comparison purposes.
 * This converts backslashes to forward slashes and handles Windows drive letters.
 */
export function normalizePathForComparison(path: string): string {
  if (!path) return path;

  // Convert backslashes to forward slashes
  let normalized = path.replace(/\\/g, '/');

  // Handle Windows drive letter - convert to lowercase for case-insensitive comparison
  if (/^[a-zA-Z]:\//.test(normalized)) {
    normalized = normalized.charAt(0).toLowerCase() + normalized.slice(1);
  }

  // Remove trailing slashes (except for root "/")
  normalized = normalized.replace(/\/$/, '');

  return normalized;
}

/**
 * Compare two file paths for equality, handling platform differences.
 */
export function arePathsEqual(path1: string, path2: string): boolean {
  if (!path1 || !path2) return path1 === path2;
  return normalizePathForComparison(path1) === normalizePathForComparison(path2);
}

export const mockRepositoryUtils = {
  normalizeFilePath: createMockNormalizeFilePath(),
  normalizePathForComparison,
  arePathsEqual,
};

/**
 * Mock module for vi.mock('../services/repository-utils', ...)
 */
export default mockRepositoryUtils;
