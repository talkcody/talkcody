import { logger } from '@/lib/logger';
import {
  resolveNodeModuleEntry,
  resolveNodeModuleSubpathEntry,
  resolveToolRoot,
} from '@/services/tools/custom-tool-packager';
import type { CustomToolDefinition } from '@/types/custom-tool';
import type { PlaygroundPermission } from '@/types/playground';

export type CustomToolModuleRegistry = Record<string, unknown>;

const moduleCache = new Map<string, unknown>();
const moduleRegistry: CustomToolModuleRegistry = {};

// Playground-specific module resolvers
const playgroundResolvers = new Map<string, (specifier: string) => Promise<unknown>>();
const playgroundModuleCache = new Map<string, unknown>();

type Listener = (...args: unknown[]) => void;

type EventEmitterLike = {
  on: (event: string, listener: Listener) => EventEmitterLike;
  addListener: (event: string, listener: Listener) => EventEmitterLike;
  once: (event: string, listener: Listener) => EventEmitterLike;
  removeListener: (event: string, listener: Listener) => EventEmitterLike;
  off: (event: string, listener: Listener) => EventEmitterLike;
  removeAllListeners: (event?: string) => EventEmitterLike;
  emit: (event: string, ...args: unknown[]) => boolean;
  listeners: (event: string) => Listener[];
  listenerCount: (event: string) => number;
  setMaxListeners: (_count: number) => EventEmitterLike;
};

function createEventsModule() {
  class EventEmitterImpl implements EventEmitterLike {
    private events = new Map<string, Set<Listener>>();

    on(event: string, listener: Listener) {
      const list = this.events.get(event) ?? new Set<Listener>();
      list.add(listener);
      this.events.set(event, list);
      return this;
    }

    addListener(event: string, listener: Listener) {
      return this.on(event, listener);
    }

    once(event: string, listener: Listener) {
      const onceListener: Listener = (...args) => {
        this.removeListener(event, onceListener);
        listener(...args);
      };
      return this.on(event, onceListener);
    }

    removeListener(event: string, listener: Listener) {
      const list = this.events.get(event);
      if (list) {
        list.delete(listener);
        if (list.size === 0) {
          this.events.delete(event);
        }
      }
      return this;
    }

    off(event: string, listener: Listener) {
      return this.removeListener(event, listener);
    }

    removeAllListeners(event?: string) {
      if (event) {
        this.events.delete(event);
      } else {
        this.events.clear();
      }
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      const list = this.events.get(event);
      if (!list || list.size === 0) {
        return false;
      }
      for (const listener of list) {
        listener(...args);
      }
      return true;
    }

    listeners(event: string) {
      return Array.from(this.events.get(event) ?? []);
    }

    listenerCount(event: string) {
      return this.events.get(event)?.size ?? 0;
    }

    setMaxListeners(_count: number) {
      return this;
    }
  }

  const EventEmitter = EventEmitterImpl as unknown as {
    new (): EventEmitterLike;
    EventEmitter?: unknown;
  };
  EventEmitter.EventEmitter = EventEmitter;
  return EventEmitter;
}

const eventsModule = createEventsModule();

const builtinLoaders = new Map<string, () => Promise<unknown>>([
  ['react', () => import('react')],
  ['react/jsx-runtime', () => import('react/jsx-runtime')],
  ['recharts', () => import('recharts')],
  ['zod', () => import('zod')],
  ['events', async () => eventsModule],
]);

const internalModuleLoaders = import.meta.glob([
  '/src/**/*.{ts,tsx,js,jsx}',
  '!/src/**/*.test.{ts,tsx,js,jsx}',
  '!/src/**/*.spec.{ts,tsx,js,jsx}',
  '!/src/test/**',
]);

function buildInternalCandidates(specifier: string): string[] {
  if (!specifier.startsWith('@/')) {
    return [];
  }

  const relative = specifier.replace(/^@\//, '');
  const base = `/src/${relative}`;
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
  ];
}

async function loadInternalModule(specifier: string): Promise<unknown> {
  const candidates = buildInternalCandidates(specifier);
  for (const candidate of candidates) {
    const loader = internalModuleLoaders[candidate];
    if (loader) {
      return await loader();
    }
  }
  return undefined;
}

export function getCustomToolModuleRegistry() {
  return moduleRegistry;
}

export function __getInternalModuleLoaderKeys() {
  return Object.keys(internalModuleLoaders);
}

export function registerCustomToolModule(alias: string, moduleRef: unknown) {
  moduleRegistry[alias] = moduleRef;
  moduleCache.set(alias, moduleRef);
}

export async function resolveCustomToolModule(alias: string, baseDir?: string): Promise<unknown> {
  logger.info('[resolveCustomToolModule] resolving', { alias, baseDir });

  // Check cache first (use alias as key for bare specifiers, resolved path for relative)
  if (moduleCache.has(alias)) {
    logger.info('[resolveCustomToolModule] found in cache');
    const cached = moduleCache.get(alias);
    return await Promise.resolve(cached);
  }

  // Handle relative imports (./, ../)
  if (alias.startsWith('./') || alias.startsWith('../')) {
    logger.info('[resolveCustomToolModule] handling relative import');
    if (!baseDir) {
      throw new Error(`Relative import requires base directory: ${alias}`);
    }

    const resolvedPath = await resolveRelativePath(baseDir, alias);
    const cacheKey = `file:${resolvedPath}`;

    if (moduleCache.has(cacheKey)) {
      logger.info('[resolveCustomToolModule] relative import found in cache');
      const cached = moduleCache.get(cacheKey);
      return await Promise.resolve(cached);
    }

    const loadingPromise = loadAndCompileFile(resolvedPath).then((module) => {
      moduleCache.set(cacheKey, module);
      moduleCache.set(alias, module);
      return module;
    });
    moduleCache.set(cacheKey, loadingPromise);
    moduleCache.set(alias, loadingPromise);
    return await loadingPromise;
  }

  // Bare specifier handling (original logic)
  if (alias in moduleRegistry) {
    logger.info('[resolveCustomToolModule] found in module registry');
    const registered = moduleRegistry[alias];
    moduleCache.set(alias, registered);
    return registered;
  }

  const builtinLoader = builtinLoaders.get(alias);
  if (builtinLoader) {
    logger.info('[resolveCustomToolModule] using builtin loader');
    const loaded = await builtinLoader();
    moduleCache.set(alias, loaded);
    return loaded;
  }

  const internalModule = await loadInternalModule(alias);
  if (internalModule) {
    logger.info('[resolveCustomToolModule] found internal module');
    moduleCache.set(alias, internalModule);
    return internalModule;
  }

  if (baseDir) {
    logger.info('[resolveCustomToolModule] attempting node module resolution with baseDir', {
      baseDir,
    });
    const toolRoot = await resolveToolRoot(baseDir);
    logger.info('[resolveCustomToolModule] resolved tool root', { toolRoot });

    if (toolRoot) {
      const moduleCacheKey = `node:${toolRoot}:${alias}`;
      if (moduleCache.has(moduleCacheKey)) {
        logger.info('[resolveCustomToolModule] found in node module cache');
        const cached = moduleCache.get(moduleCacheKey);
        return await Promise.resolve(cached);
      }

      const isPackaged = await isPackagedToolRoot(toolRoot);
      if (isPackaged) {
        logger.warn('[resolveCustomToolModule] returning stub for packaged tool dependency', {
          alias,
          toolRoot,
        });
        const stub = createUnavailableModule(alias);
        moduleCache.set(moduleCacheKey, stub);
        moduleCache.set(alias, stub);
        return stub;
      }

      logger.info('[resolveCustomToolModule] calling resolveNodeModulePath', { toolRoot, alias });
      const modulePath = await resolveNodeModulePath(toolRoot, alias);
      logger.info('[resolveCustomToolModule] resolveNodeModulePath result', { modulePath });

      if (modulePath) {
        const loadingPromise = loadAndCompileFile(modulePath).then((module) => {
          moduleCache.set(moduleCacheKey, module);
          return module;
        });
        moduleCache.set(moduleCacheKey, loadingPromise);
        return await loadingPromise;
      }

      logger.info('[resolveCustomToolModule] resolveNodeModulePath returned null');
    } else {
      logger.info('[resolveCustomToolModule] resolveToolRoot returned undefined');
    }
  } else {
    logger.info('[resolveCustomToolModule] no baseDir provided');
  }

  logger.info('[resolveCustomToolModule] returning undefined');
  return undefined;
}

async function isPackagedToolRoot(toolRoot: string): Promise<boolean> {
  try {
    const { join } = await import('@tauri-apps/api/path');
    const { exists } = await import('@tauri-apps/plugin-fs');
    const packageJson = await join(toolRoot, 'package.json');
    const bunLock = await join(toolRoot, 'bun.lockb');
    const npmLock = await join(toolRoot, 'package-lock.json');
    return (await exists(packageJson)) && ((await exists(bunLock)) || (await exists(npmLock)));
  } catch (error) {
    logger.warn('[resolveCustomToolModule] failed to check packaged tool root', error);
    return false;
  }
}

function createUnavailableModule(specifier: string): unknown {
  const stub = new Proxy(() => undefined, {
    get: () => undefined,
    apply: () => undefined,
    construct: () => ({}),
  });

  logger.warn('[resolveCustomToolModule] returning noop stub for packaged tool dependency', {
    specifier,
  });

  return stub;
}

export function isCustomToolDefinition(value: unknown): value is CustomToolDefinition {
  return Boolean(value) && typeof value === 'object' && 'name' in (value as object);
}

// ==================== Playground Module Support ====================

/**
 * Register a playground-specific module resolver
 */
export function registerPlaygroundResolver(
  playgroundId: string,
  resolver: (specifier: string) => Promise<unknown>
): void {
  playgroundResolvers.set(playgroundId, resolver);
}

/**
 * Unregister a playground resolver
 */
export function unregisterPlaygroundResolver(playgroundId: string): void {
  playgroundResolvers.delete(playgroundId);
  playgroundModuleCache.clear();
}

/**
 * Create a playground-specific module resolver
 * This resolver provides sandbox-aware module loading
 */
export function createPlaygroundModuleResolver(options: {
  permissions?: PlaygroundPermission[];
  mockFetch?: boolean;
  timeout?: number;
  playgroundId: string;
}): (specifier: string) => Promise<unknown> {
  const { permissions = [], mockFetch = false, timeout = 30000, playgroundId } = options;

  // Store resolver for later use
  const resolver = async (specifier: string) => {
    // Check playground-specific cache first
    const cacheKey = `${playgroundId}:${specifier}`;
    if (playgroundModuleCache.has(cacheKey)) {
      return playgroundModuleCache.get(cacheKey);
    }

    // Resolve module
    const module = await resolveModuleWithPermissions(specifier, permissions, mockFetch, timeout);

    // Cache the result
    if (module !== undefined) {
      playgroundModuleCache.set(cacheKey, module);
    }

    return module;
  };

  registerPlaygroundResolver(playgroundId, resolver);
  return resolver;
}

/**
 * Resolve module with permission checks
 */
async function resolveModuleWithPermissions(
  specifier: string,
  permissions: PlaygroundPermission[],
  mockFetch: boolean,
  timeout: number
): Promise<unknown> {
  // Check if it's a permission-sensitive module
  if (specifier === '@/lib/tauri-fetch') {
    if (!permissions.includes('net')) {
      throw new Error(`Permission denied: 'net' permission required for ${specifier}`);
    }

    const { simpleFetch } = await import('@/lib/tauri-fetch');

    if (mockFetch) {
      // Return a mock fetch that returns sample data
      return {
        simpleFetch: async (url: string, init?: RequestInit) => {
          console.log(`[Mock Fetch] ${url}`, init);
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ mock: true, url }),
            json: async () => ({ mock: true, url }),
          } as Response;
        },
      };
    }

    // Wrap with timeout
    return {
      simpleFetch: async (url: string, init?: RequestInit) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
          const response = await simpleFetch(url, {
            ...init,
            signal: controller.signal,
          });
          return response;
        } finally {
          clearTimeout(timeoutId);
        }
      },
    };
  }

  // For other modules, use the default resolver
  return await resolveCustomToolModule(specifier);
}

/**
 * Clear playground module cache for a specific playground
 */
export function clearPlaygroundCache(playgroundId: string): void {
  for (const key of playgroundModuleCache.keys()) {
    if (key.startsWith(`${playgroundId}:`)) {
      playgroundModuleCache.delete(key);
    }
  }
}

/**
 * Get playground cache size (for debugging)
 */
export function getPlaygroundCacheSize(playgroundId?: string): number {
  if (playgroundId) {
    let count = 0;
    for (const key of playgroundModuleCache.keys()) {
      if (key.startsWith(`${playgroundId}:`)) {
        count++;
      }
    }
    return count;
  }
  return playgroundModuleCache.size;
}

const RELATIVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;

function hasKnownExtension(filePath: string): boolean {
  return RELATIVE_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

function buildRelativeCandidates(resolvedPath: string): string[] {
  if (hasKnownExtension(resolvedPath)) {
    return [resolvedPath];
  }

  const withExtensions = RELATIVE_EXTENSIONS.map((ext) => `${resolvedPath}${ext}`);
  const withIndex = RELATIVE_EXTENSIONS.map((ext) => `${resolvedPath}/index${ext}`);
  return [...withExtensions, ...withIndex];
}

async function resolveRelativePath(baseDir: string, specifier: string): Promise<string> {
  const { join, normalize } = await import('@tauri-apps/api/path');
  const { exists } = await import('@tauri-apps/plugin-fs');

  const resolvedPath = await normalize(await join(baseDir, specifier));
  const candidates = buildRelativeCandidates(resolvedPath);

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }

  throw new Error(`File not found: ${resolvedPath}`);
}

async function resolveNodeModulePath(toolRoot: string, specifier: string): Promise<string | null> {
  logger.info('[resolveNodeModulePath] starting resolution', { toolRoot, specifier });

  if (specifier.includes(':')) {
    logger.info('[resolveNodeModulePath] specifier contains colon, returning null');
    return null;
  }
  if (specifier.startsWith('/') || specifier.startsWith('.')) {
    logger.info('[resolveNodeModulePath] specifier is absolute or relative, returning null');
    return null;
  }

  const { join, normalize } = await import('@tauri-apps/api/path');
  const { exists } = await import('@tauri-apps/plugin-fs');

  if (specifier.includes('/')) {
    const parts = specifier.split('/');
    const isScoped = specifier.startsWith('@');
    const moduleName = isScoped ? parts.slice(0, 2).join('/') : parts[0];
    const subpath = isScoped ? parts.slice(2).join('/') : parts.slice(1).join('/');

    logger.info('[resolveNodeModulePath] split specifier', {
      specifier,
      moduleName,
      subpath,
      isScoped,
    });

    if (!moduleName) {
      logger.info('[resolveNodeModulePath] empty module name, returning null');
      return null;
    }

    const moduleRoot = await normalize(await join(toolRoot, 'node_modules', moduleName));
    logger.info('[resolveNodeModulePath] checking module root', { moduleRoot });

    if (!(await exists(moduleRoot))) {
      logger.info('[resolveNodeModulePath] module root does not exist');
      return null;
    }

    if (subpath) {
      const exportSubpath = subpath.startsWith('./') ? subpath : `./${subpath}`;
      logger.info('[resolveNodeModulePath] trying to resolve subpath', { subpath, exportSubpath });

      const resolved = await resolveNodeModuleSubpathEntry(moduleRoot, exportSubpath);
      if (resolved) {
        logger.info('[resolveNodeModulePath] resolved via resolveNodeModuleSubpathEntry', {
          resolved,
        });
        return resolved;
      }

      const legacyResolved = await resolveNodeModuleSubpathEntry(moduleRoot, subpath);
      if (legacyResolved) {
        logger.info('[resolveNodeModulePath] resolved via legacy resolveNodeModuleSubpathEntry', {
          legacyResolved,
        });
        return legacyResolved;
      }

      logger.info('[resolveNodeModulePath] subpath resolution failed');
    }

    const scopedEntry = await resolveNodeModuleEntry(moduleRoot);
    if (scopedEntry) {
      logger.info('[resolveNodeModulePath] resolved via resolveNodeModuleEntry', { scopedEntry });
      return scopedEntry;
    }
  }

  // No subpath or subpath resolution failed, try to resolve as a flat module
  const moduleRoot = await normalize(await join(toolRoot, 'node_modules', specifier));
  logger.info('[resolveNodeModulePath] trying flat module resolution', { moduleRoot });

  if (!(await exists(moduleRoot))) {
    logger.info('[resolveNodeModulePath] flat module root does not exist');
    return null;
  }

  const entry = await resolveNodeModuleEntry(moduleRoot);
  if (entry) {
    logger.info('[resolveNodeModulePath] resolved via resolveNodeModuleEntry (flat)', { entry });
    return entry;
  }

  const fallback = await join(moduleRoot, 'index.js');
  if (await exists(fallback)) {
    logger.info('[resolveNodeModulePath] found fallback index.js', { fallback });
    return fallback;
  }

  logger.info('[resolveNodeModulePath] all resolution attempts failed');
  return null;
}

async function loadAndCompileFile(filePath: string): Promise<unknown> {
  const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');
  const { compileCustomTool, createCustomToolModuleUrl, resolveCustomToolDefinition } =
    await import('@/services/tools/custom-tool-compiler');

  if (!(await exists(filePath))) {
    throw new Error(`File not found: ${filePath}`);
  }

  const { basename, dirname } = await import('@tauri-apps/api/path');
  const filename = await basename(filePath);
  const fileDir = await dirname(filePath);

  const sourceCode = await readTextFile(filePath);
  const compiled = await compileCustomTool(sourceCode, { filename });
  const moduleUrl = await createCustomToolModuleUrl(compiled, filename, fileDir);
  const definition = await resolveCustomToolDefinition(moduleUrl);

  return definition;
}
