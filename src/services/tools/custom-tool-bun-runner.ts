import { join } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import { Command } from '@tauri-apps/plugin-shell';
import { logger } from '@/lib/logger';
import type { CustomToolDefinition } from '@/types/custom-tool';
import type { CustomToolPackageInfo } from '@/types/custom-tool-package';
import type { ToolExecuteContext } from '@/types/tool';

const RUNNER_FILENAME = '.talkcody-bun-runner.mjs';
const INPUT_PREFIX = '.talkcody-bun-input-';
const REACT_DIR = 'node_modules/react';
const REACT_RUNTIME_PATH = 'node_modules/react/jsx-runtime.js';
const REACT_PACKAGE_JSON = 'node_modules/react/package.json';

const RUNNER_SOURCE = String.raw`import { pathToFileURL } from 'url';

const writeStderr = (message) => {
  process.stderr.write(String(message) + '\n');
};

const safeStringify = (value) => {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const redirectConsole = () => {
  const handler = (...args) => {
    const message = args.map(safeStringify).join(' ');
    writeStderr(message);
  };
  console.log = handler;
  console.warn = handler;
  console.error = handler;
};

const registerAliases = () => {
  const makeStub = (name, contents) => ({
    path: name,
    namespace: 'talkcody',
    pluginData: { contents },
  });

  const customToolSdk = 'export const toolHelper = (def) => def;\\nexport default { toolHelper };\\n';
  const tauriFetch = 'export const simpleFetch = (...args) => fetch(...args);\\nexport default { simpleFetch };\\n';

  Bun.plugin({
    name: 'talkcody-alias',
    setup(build) {
      build.onResolve({ filter: new RegExp('^@/lib/custom-tool-sdk$') }, () =>
        makeStub('talkcody:custom-tool-sdk', customToolSdk)
      );
      build.onResolve({ filter: new RegExp('^@/lib/tauri-fetch$') }, () =>
        makeStub('talkcody:tauri-fetch', tauriFetch)
      );
      build.onResolve({ filter: new RegExp('^@/') }, (args) =>
        makeStub('talkcody:stub:' + args.path, 'export default {};')
      );
      build.onLoad({ filter: /.*/, namespace: 'talkcody' }, (args) => {
        return {
          contents: args.pluginData?.contents ?? 'export default {};',
          loader: 'js',
        };
      });
    },
  });
};

redirectConsole();
registerAliases();

const entryPath = process.env.TALKCODY_TOOL_ENTRY;
const inputPath = process.env.TALKCODY_TOOL_INPUT;

if (!entryPath || !inputPath) {
  writeStderr('Missing TALKCODY_TOOL_ENTRY or TALKCODY_TOOL_INPUT');
  process.exit(1);
}

try {
  const inputText = await Bun.file(inputPath).text();
  const parsed = inputText ? JSON.parse(inputText) : {};
  const params = parsed?.params ?? parsed ?? {};
  const context = parsed?.context ?? {
    taskId: process.env.TALKCODY_TOOL_TASK_ID ?? '',
    toolId: process.env.TALKCODY_TOOL_ID ?? '',
  };

  const mod = await import(pathToFileURL(entryPath).href);
  const tool = mod.default ?? mod;
  if (!tool || typeof tool.execute !== 'function') {
    throw new Error('Tool export does not include execute()');
  }

  const result = await tool.execute(params, context);
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  process.stdout.write(JSON.stringify({ ok: false, error: message, stack }));
  process.exit(1);
}
`;

async function ensureReactStub(rootDir: string): Promise<void> {
  const reactDir = await join(rootDir, REACT_DIR);
  if (await exists(reactDir)) {
    return;
  }

  await mkdir(reactDir, { recursive: true });

  const reactIndexPath = await join(rootDir, REACT_DIR, 'index.js');
  const runtimePath = await join(rootDir, REACT_RUNTIME_PATH);
  const packageJsonPath = await join(rootDir, REACT_PACKAGE_JSON);

  const reactIndex = `const React = {
  createElement: (...args) => ({ __jsx: args }),
  Fragment: 'Fragment',
};
module.exports = React;
module.exports.default = React;
`;

  const runtimeSource = `exports.jsx = (...args) => ({ __jsx: args });
exports.jsxs = (...args) => ({ __jsx: args });
exports.Fragment = 'Fragment';
`;

  const packageJson = JSON.stringify({
    name: 'react',
    version: '0.0.0-talkcody',
    main: 'index.js',
  });

  await writeTextFile(reactIndexPath, reactIndex);
  await writeTextFile(runtimePath, runtimeSource);
  await writeTextFile(packageJsonPath, packageJson);
}

async function ensureRunnerScript(rootDir: string): Promise<string> {
  const runnerPath = await join(rootDir, RUNNER_FILENAME);
  let needsWrite = true;

  if (await exists(runnerPath)) {
    try {
      const current = await readTextFile(runnerPath);
      if (current === RUNNER_SOURCE) {
        needsWrite = false;
      }
    } catch (error) {
      logger.warn('[CustomToolBunRunner] Failed to read runner script, rewriting', error);
    }
  }

  if (needsWrite) {
    await writeTextFile(runnerPath, RUNNER_SOURCE);
  }

  return runnerPath;
}

function buildInputPayload(
  params: Record<string, unknown>,
  context?: ToolExecuteContext
): Record<string, unknown> {
  return {
    params,
    context: context ? { taskId: context.taskId, toolId: context.toolId } : undefined,
  };
}

function parseRunnerOutput(stdout: string): { ok: boolean; result?: unknown; error?: string } {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { ok: false, error: 'Empty output from bun runner' };
  }

  const lines = trimmed.split('\n').filter(Boolean);
  const last = lines[lines.length - 1] ?? trimmed;

  try {
    const parsed = JSON.parse(last) as { ok: boolean; result?: unknown; error?: string };
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Failed to parse bun output: ${message}` };
  }
}

export async function executePackagedToolWithBun(
  definition: CustomToolDefinition,
  packageInfo: CustomToolPackageInfo,
  params: Record<string, unknown>,
  context?: ToolExecuteContext
): Promise<unknown> {
  const { rootDir, entryPath } = packageInfo;
  await ensureReactStub(rootDir);
  const runnerPath = await ensureRunnerScript(rootDir);

  const inputPath = await join(
    rootDir,
    `${INPUT_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );

  const payload = buildInputPayload(params, context);
  await writeTextFile(inputPath, JSON.stringify(payload));

  const command = Command.create('bun', [runnerPath], {
    cwd: rootDir,
    env: {
      TALKCODY_TOOL_ENTRY: entryPath,
      TALKCODY_TOOL_INPUT: inputPath,
      TALKCODY_TOOL_TASK_ID: context?.taskId ?? '',
      TALKCODY_TOOL_ID: definition.name,
    },
  });

  const startedAt = Date.now();
  try {
    const result = await command.execute();
    const duration = Date.now() - startedAt;

    const parsed = parseRunnerOutput(result.stdout ?? '');
    if (parsed.ok) {
      logger.info('[CustomToolBunRunner] Tool executed via bun', {
        toolName: definition.name,
        duration,
      });
      return parsed.result;
    }

    const errorMessage = parsed.error || result.stderr || 'Bun execution failed';
    logger.error('[CustomToolBunRunner] Tool execution failed', {
      toolName: definition.name,
      error: errorMessage,
      stderr: result.stderr,
      stdout: result.stdout,
    });
    throw new Error(errorMessage);
  } finally {
    try {
      await remove(inputPath);
    } catch (error) {
      logger.warn('[CustomToolBunRunner] Failed to clean up input file', error);
    }
  }
}
