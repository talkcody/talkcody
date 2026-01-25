import { dirname, join } from '@tauri-apps/api/path';
import { exists, readTextFile } from '@tauri-apps/plugin-fs';
import { Command } from '@tauri-apps/plugin-shell';
import { logger } from '@/lib/logger';
import type {
  CustomToolPackageInfo,
  CustomToolPackageResolution,
} from '@/types/custom-tool-package';

const PACKAGE_JSON = 'package.json';
const INSTALL_MARKER = '.talkcody-install.json';

type InstallMarker = {
  lockfilePath: string;
  lockfileMtimeMs?: number;
};

type PackageJson = {
  name?: string;
  version?: string;
  main?: string;
  module?: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  talkcody?: { toolEntry?: string };
};

function hasDependenciesOnly(packageJson: PackageJson): boolean {
  const hasDeps = Boolean(
    packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0
  );
  const hasDevDeps = Boolean(
    packageJson.devDependencies && Object.keys(packageJson.devDependencies).length > 0
  );
  return hasDeps && !hasDevDeps;
}

function parseJson<T>(content: string, filePath: string): T {
  try {
    return JSON.parse(content) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${filePath}: ${detail}`);
  }
}

async function readPackageJson(packageJsonPath: string): Promise<PackageJson> {
  const content = await readTextFile(packageJsonPath);
  return parseJson<PackageJson>(content, packageJsonPath);
}

async function resolveToolEntry(rootDir: string, packageJson: PackageJson): Promise<string> {
  const entry = packageJson.talkcody?.toolEntry || 'tool.tsx';
  const entryPath = await join(rootDir, entry);
  if (!(await exists(entryPath))) {
    throw new Error(`Tool entry not found: ${entry}`);
  }
  return entryPath;
}

async function findLockfile(
  rootDir: string
): Promise<{ path: string; type: 'bun' | 'npm' } | null> {
  const bunLock = await join(rootDir, 'bun.lockb');
  if (await exists(bunLock)) {
    return { path: bunLock, type: 'bun' };
  }
  const npmLock = await join(rootDir, 'package-lock.json');
  if (await exists(npmLock)) {
    return { path: npmLock, type: 'npm' };
  }
  return null;
}

async function readInstallMarker(rootDir: string): Promise<InstallMarker | null> {
  try {
    const markerPath = await join(rootDir, INSTALL_MARKER);
    if (!(await exists(markerPath))) return null;
    const content = await readTextFile(markerPath);
    return parseJson<InstallMarker>(content, markerPath);
  } catch (error) {
    logger.warn('[CustomToolPackager] Failed to read install marker', error);
    return null;
  }
}

async function writeInstallMarker(rootDir: string, marker: InstallMarker): Promise<void> {
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  const markerPath = await join(rootDir, INSTALL_MARKER);
  await writeTextFile(markerPath, JSON.stringify(marker, null, 2));
}

async function getFileMtimeMs(filePath: string): Promise<number | undefined> {
  const { stat } = await import('@tauri-apps/plugin-fs');
  try {
    const info = await stat(filePath);
    if (typeof info.mtime === 'number') {
      return info.mtime;
    }
    if (info.mtime instanceof Date) {
      return info.mtime.getTime();
    }
  } catch (error) {
    logger.warn('[CustomToolPackager] Failed to stat lockfile', error);
  }
  return undefined;
}

function buildInstallCommand(lockfileType: 'bun' | 'npm'): { command: string; args: string[] } {
  if (lockfileType === 'bun') {
    return {
      command: 'bun',
      args: ['install', '--frozen-lockfile', '--ignore-scripts'],
    };
  }
  return {
    command: 'npm',
    args: ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
  };
}

export async function resolvePackagedTool(rootDir: string): Promise<CustomToolPackageResolution> {
  const packageJsonPath = await join(rootDir, PACKAGE_JSON);
  if (!(await exists(packageJsonPath))) {
    return { ok: false, error: 'package.json not found' };
  }

  const packageJson = await readPackageJson(packageJsonPath);
  if (!hasDependenciesOnly(packageJson)) {
    return { ok: false, error: 'package.json must declare dependencies only' };
  }
  if (packageJson.scripts && Object.keys(packageJson.scripts).length > 0) {
    return { ok: false, error: 'package.json scripts are not allowed for custom tools' };
  }

  const entryPath = await resolveToolEntry(rootDir, packageJson);
  const lockfile = await findLockfile(rootDir);
  if (!lockfile) {
    return { ok: false, error: 'Lockfile required (bun.lockb or package-lock.json)' };
  }

  const info: CustomToolPackageInfo = {
    rootDir,
    entryPath,
    packageJsonPath,
    lockfilePath: lockfile.path,
    lockfileType: lockfile.type,
    packageName: packageJson.name,
  };

  return { ok: true, info };
}

export async function ensureToolDependencies(info: CustomToolPackageInfo): Promise<{
  ok: boolean;
  error?: string;
}> {
  const marker = await readInstallMarker(info.rootDir);
  const lockfileMtime = await getFileMtimeMs(info.lockfilePath);

  if (marker && marker.lockfilePath === info.lockfilePath) {
    if (!lockfileMtime || marker.lockfileMtimeMs === lockfileMtime) {
      return { ok: true };
    }
  }

  const { command, args } = buildInstallCommand(info.lockfileType);

  try {
    logger.info('[CustomToolPackager] Installing tool dependencies', {
      toolRoot: info.rootDir,
      command,
      args,
    });

    const result = await Command.create(command, args, {
      cwd: info.rootDir,
      env: {
        npm_config_ignore_scripts: 'true',
      },
    }).execute();

    if (result.code !== 0) {
      return {
        ok: false,
        error: result.stderr || result.stdout || `Install failed with code ${result.code}`,
      };
    }

    await writeInstallMarker(info.rootDir, {
      lockfilePath: info.lockfilePath,
      lockfileMtimeMs: lockfileMtime,
    });

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

export async function getPackageRootFromEntry(entryPath: string): Promise<string | null> {
  let current = await dirname(entryPath);
  for (let i = 0; i < 5; i += 1) {
    const candidate = await join(current, PACKAGE_JSON);
    if (await exists(candidate)) {
      return current;
    }
    const parent = await dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export async function resolveToolRoot(baseDir?: string): Promise<string | undefined> {
  if (!baseDir) return undefined;

  const { normalize, dirname, join } = await import('@tauri-apps/api/path');
  const { exists: fsExists } = await import('@tauri-apps/plugin-fs');

  const normalizedBase = await normalize(baseDir);
  const normalizedSearch = normalizedBase.replace(/\\/g, '/');
  const nodeModulesMarker = '/node_modules/';

  // If baseDir is inside node_modules, prefer the parent tool root.
  const markerIndex = normalizedSearch.lastIndexOf(nodeModulesMarker);
  if (markerIndex !== -1) {
    const rootCandidate = normalizedSearch.slice(0, markerIndex);
    if (rootCandidate) {
      const normalizedRoot = await normalize(rootCandidate);
      const rootPackageJson = await join(normalizedRoot, PACKAGE_JSON);
      if (await fsExists(rootPackageJson)) {
        logger.info('[resolveToolRoot] baseDir is inside node_modules, using tool root', {
          baseDir: normalizedBase,
          toolRoot: normalizedRoot,
        });
        return normalizedRoot;
      }
    }
  }

  // Check if baseDir itself has package.json
  const packageJsonPath = await join(normalizedBase, PACKAGE_JSON);
  if (await fsExists(packageJsonPath)) {
    logger.info('[resolveToolRoot] package.json found directly at', normalizedBase);
    return normalizedBase;
  }

  // Try to find package.json by walking up from baseDir
  const root = await getPackageRootFromEntry(normalizedBase);
  if (root) {
    logger.info('[resolveToolRoot] package.json found via getPackageRootFromEntry:', root);
    return root;
  }

  // If still not found, search upward for node_modules parent
  // This handles cases where baseDir is a subdirectory of the tool root
  try {
    let current = normalizedBase;
    const maxDepth = 5;

    for (let i = 0; i < maxDepth; i++) {
      const nodeModulesPath = await join(current, 'node_modules');
      if (await fsExists(nodeModulesPath)) {
        logger.info('[resolveToolRoot] node_modules found at', current);
        // Found node_modules, search upward from here for package.json
        let searchDir = current;
        for (let j = 0; j < 3; j++) {
          const pkgPath = await join(searchDir, PACKAGE_JSON);
          if (await fsExists(pkgPath)) {
            logger.info('[resolveToolRoot] package.json found at', searchDir);
            return searchDir;
          }
          const parent = await dirname(searchDir);
          if (parent === searchDir) break;
          searchDir = parent;
        }
        // Even if no package.json found, return node_modules parent as fallback
        logger.info('[resolveToolRoot] returning node_modules parent as fallback:', current);
        return current;
      }
      const parent = await dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch (error) {
    logger.info('[resolveToolRoot] error in upward search:', error);
    // Ignore errors in upward search
  }

  logger.info('[resolveToolRoot] no tool root found for baseDir:', normalizedBase);
  return undefined;
}

export async function resolvePackageInfoFromEntry(
  entryPath: string
): Promise<CustomToolPackageInfo | null> {
  const rootDir = await getPackageRootFromEntry(entryPath);
  if (!rootDir) return null;
  const resolved = await resolvePackagedTool(rootDir);
  if (!resolved.ok) return null;
  return resolved.info;
}

export async function resolvePackageJson(modulePath: string): Promise<PackageJson | null> {
  try {
    const packageJsonPath = await join(modulePath, PACKAGE_JSON);
    if (!(await exists(packageJsonPath))) return null;
    const content = await readTextFile(packageJsonPath);
    return parseJson<PackageJson>(content, packageJsonPath);
  } catch (error) {
    logger.warn('[CustomToolPackager] Failed to read module package.json', error);
    return null;
  }
}

export async function resolveNodeModuleEntry(modulePath: string): Promise<string | null> {
  const packageJson = await resolvePackageJson(modulePath);
  if (!packageJson) return null;
  const entry = packageJson.module || packageJson.main || 'index.js';
  const candidate = await join(modulePath, entry);
  if (await exists(candidate)) {
    return candidate;
  }
  const fallback = await join(modulePath, 'index.js');
  if (await exists(fallback)) {
    return fallback;
  }
  return null;
}

const SUBPATH_EXTENSIONS = ['.js', '.cjs', '.mjs'] as const;

function buildSubpathCandidates(basePath: string): string[] {
  const withExtensions = SUBPATH_EXTENSIONS.map((ext) => `${basePath}${ext}`);
  const withIndex = SUBPATH_EXTENSIONS.map((ext) => `${basePath}/index${ext}`);
  return [...withExtensions, ...withIndex];
}

function normalizeExportKey(subpath: string): string {
  if (subpath.startsWith('./')) return subpath;
  return `./${subpath}`;
}

function resolveExportsTarget(exportsValue: unknown, exportKey: string): string | null {
  if (typeof exportsValue === 'string') {
    return exportsValue;
  }
  if (!exportsValue || typeof exportsValue !== 'object') {
    return null;
  }
  const record = exportsValue as Record<string, unknown>;

  // Exact match
  const direct = record[exportKey];
  if (direct !== undefined) {
    return resolveExportsTarget(direct, exportKey);
  }

  // Fallback to "." or key without "./" prefix
  const fallback = record['.'] ?? record[exportKey.replace(/^\.\//, '')];
  if (fallback !== undefined) {
    return resolveExportsTarget(fallback, exportKey);
  }

  // Try conditional exports: import, default, require (in order of preference for browser)
  // For ESM in browser, prefer 'import' then 'default'
  for (const condition of ['import', 'default', 'require'] as const) {
    const conditionValue = record[condition];
    if (conditionValue !== undefined) {
      // For object conditions, recursively resolve
      if (typeof conditionValue === 'object' && conditionValue !== null) {
        const nested = resolveExportsTarget(conditionValue, exportKey);
        if (nested) return nested;
      } else if (typeof conditionValue === 'string') {
        // Direct string value (like in mysql2's exports: { "./promise": "./promise.js", "import": "./promise.js" })
        return conditionValue;
      }
    }
  }

  // Last resort: return any string value found
  for (const value of Object.values(record)) {
    if (typeof value === 'string') {
      return value;
    }
    if (value && typeof value === 'object') {
      const nested = resolveExportsTarget(value, exportKey);
      if (nested) return nested;
    }
  }
  return null;
}

export async function resolveNodeModuleSubpathEntry(
  modulePath: string,
  subpath: string
): Promise<string | null> {
  if (!subpath) return null;
  const { normalize } = await import('@tauri-apps/api/path');

  const normalizedRoot = await normalize(modulePath);
  const safePrefix = normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`;

  const packageJson = await resolvePackageJson(modulePath);

  // First, try exports if available
  if (packageJson?.exports) {
    const exportKey = normalizeExportKey(subpath);
    const target = resolveExportsTarget(packageJson.exports, exportKey);
    if (target) {
      const exportTarget = await normalize(await join(modulePath, target));
      if (exportTarget.startsWith(safePrefix) && (await exists(exportTarget))) {
        return exportTarget;
      }
      const exportCandidates = buildSubpathCandidates(exportTarget);
      for (const candidate of exportCandidates) {
        if (candidate.startsWith(safePrefix) && (await exists(candidate))) {
          return candidate;
        }
      }
    }
  }

  const directPath = await normalize(await join(modulePath, subpath));

  if (directPath.startsWith(safePrefix) && (await exists(directPath))) {
    return directPath;
  }

  // Try with .js extension
  const withJs = await normalize(await join(modulePath, `${subpath}.js`));
  if (withJs.startsWith(safePrefix) && (await exists(withJs))) {
    return withJs;
  }

  // Try index.js
  const withIndex = await normalize(await join(modulePath, `${subpath}/index.js`));
  if (withIndex.startsWith(safePrefix) && (await exists(withIndex))) {
    return withIndex;
  }

  return null;
}
