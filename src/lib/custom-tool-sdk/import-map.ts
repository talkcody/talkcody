import type { CustomToolDefinition } from '@/types/custom-tool';
import type { PlaygroundPermission } from '@/types/playground';

export type CustomToolModuleRegistry = Record<string, unknown>;

const moduleCache = new Map<string, unknown>();
const moduleRegistry: CustomToolModuleRegistry = {};

// Playground-specific module resolvers
const playgroundResolvers = new Map<string, (specifier: string) => Promise<unknown>>();
const playgroundModuleCache = new Map<string, unknown>();

const builtinLoaders = new Map<string, () => Promise<unknown>>([
  ['react', () => import('react')],
  ['react/jsx-runtime', () => import('react/jsx-runtime')],
  ['recharts', () => import('recharts')],
  ['zod', () => import('zod')],
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

export async function resolveCustomToolModule(alias: string): Promise<unknown> {
  if (moduleCache.has(alias)) {
    return moduleCache.get(alias);
  }

  if (alias in moduleRegistry) {
    const registered = moduleRegistry[alias];
    moduleCache.set(alias, registered);
    return registered;
  }

  const builtinLoader = builtinLoaders.get(alias);
  if (builtinLoader) {
    const loaded = await builtinLoader();
    moduleCache.set(alias, loaded);
    return loaded;
  }

  const internalModule = await loadInternalModule(alias);
  if (internalModule) {
    moduleCache.set(alias, internalModule);
    return internalModule;
  }

  return undefined;
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
