import swcWasmUrl from '@swc/wasm-web/wasm_bg.wasm?url';
import { resolveCustomToolModule } from '@/lib/custom-tool-sdk/import-map';
import type { CustomToolDefinition } from '@/types/custom-tool';

export interface CompileResult {
  code: string;
  sourceMap?: string;
}

export interface CompileOptions {
  filename: string;
}

let swcReady: Promise<typeof import('@swc/wasm-web')> | null = null;

async function ensureSwcReady() {
  if (!swcReady) {
    swcReady = (async () => {
      const swc = await import('@swc/wasm-web');
      await swc.default({ module_or_path: swcWasmUrl });
      return swc;
    })();
  }
  return swcReady;
}

export async function compileCustomTool(
  source: string,
  options: CompileOptions
): Promise<CompileResult> {
  const swc = await ensureSwcReady();

  const result = await swc.transform(source, {
    filename: options.filename,
    sourceMaps: true,
    minify: false,
    jsc: {
      target: 'es2020',
      parser: {
        syntax: 'typescript',
        tsx: options.filename.endsWith('.tsx'),
      },
      transform: {
        react: {
          runtime: 'automatic',
        },
      },
    },
    module: {
      type: 'commonjs',
    },
  });

  return {
    code: result.code,
    sourceMap: result.map,
  };
}

function extractRequireSpecifiers(source: string): string[] {
  const matches = new Set<string>();
  const pattern = /\brequire\((['"])([^'"]+)\1\)/g;
  let match = pattern.exec(source);
  while (match) {
    const specifier = match[2];
    if (specifier) {
      matches.add(specifier);
    }
    match = pattern.exec(source);
  }
  return Array.from(matches);
}

export async function createCustomToolModuleUrl(
  compiled: CompileResult,
  filename: string,
  baseDir?: string
): Promise<string> {
  const requiredSpecifiers = extractRequireSpecifiers(compiled.code);

  const module = `const __moduleCache = new Map();
const __baseDir = ${baseDir !== undefined ? JSON.stringify(baseDir) : 'undefined'};
const __require = async (specifier) => {
  if (__moduleCache.has(specifier)) {
    return __moduleCache.get(specifier);
  }
  const resolved = await window.__talkcodyResolveCustomToolModule(specifier, __baseDir);
  if (!resolved) {
    throw new Error(\`Custom tool import not found: \${specifier}\`);
  }
  __moduleCache.set(specifier, resolved);
  return resolved;
};
const __requireSync = (specifier) => {
  if (__moduleCache.has(specifier)) {
    return __moduleCache.get(specifier);
  }
  throw new Error(\`Custom tool import not found: \${specifier}\`);
};
const __preload = async () => {
  const specifiers = ${JSON.stringify(requiredSpecifiers)};
  for (const specifier of specifiers) {
    try {
      await __require(specifier);
    } catch {
      // Ignore preload failures to keep optional requires working.
    }
  }
};

const __load = async () => {
  await __preload();
  const exports = {};
  const module = { exports };
  const require = __requireSync;

  ${compiled.code}

  return module.exports?.default ?? module.exports;
};

export default await __load();
//# sourceURL=custom-tool:${filename}
`;

  const blob = new Blob([module], { type: 'text/javascript' });
  return URL.createObjectURL(blob);
}

export async function resolveCustomToolDefinition(
  moduleUrl: string
): Promise<CustomToolDefinition> {
  const module = await import(/* @vite-ignore */ moduleUrl);
  const resolved = (module as { default?: CustomToolDefinition }).default ?? module;
  return resolved as CustomToolDefinition;
}

export async function registerCustomToolModuleResolver(baseDir?: string) {
  if (typeof window === 'undefined') return;
  if ((window as any).__talkcodyResolveCustomToolModule) return;

  (window as any).__talkcodyResolveCustomToolModule = async (
    specifier: string,
    requestBaseDir?: string
  ) => {
    const effectiveBaseDir = requestBaseDir ?? baseDir;
    return await resolveCustomToolModule(specifier, effectiveBaseDir);
  };
}

export type CustomToolCompileResult = {
  definition: CustomToolDefinition;
  sourceMap?: string;
};
