import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CompileResult,
  ExecutionRecord,
  ExecutionResult,
  PlaygroundConfig,
  PlaygroundStatus,
} from '@/types/playground';
import type { CustomToolDefinition } from '@/types/custom-tool';
import { usePlaygroundStore } from './playground-store';

const templateSource = 'export default {}';

let executionHistory: ExecutionRecord[] = [];
let status: PlaygroundStatus = 'idle';
let toolName = 'Untitled Tool';

const templates = [
  {
    id: 'basic',
    name: 'Basic Tool',
    description: 'Basic',
    category: 'basic' as const,
    sourceCode: templateSource,
  },
  {
    id: 'network',
    name: 'Network Tool',
    description: 'Network',
    category: 'network' as const,
    sourceCode: templateSource,
  },
];

// Define mock functions that will be used in vi.mock factory
const createToolPlaygroundServiceMock = () => ({
  initialize: vi.fn(
    (_nextSource: string, nextName: string, _nextConfig?: Partial<PlaygroundConfig>) => {
      toolName = nextName;
      status = 'idle';
    }
  ),
  updateSourceCode: vi.fn((_nextSource: string) => {
    status = 'idle';
  }),
  updateConfig: vi.fn((_updates: Partial<PlaygroundConfig>) => {
    status = 'idle';
  }),
  getTemplates: vi.fn(() => [...templates]),
  compileTool: vi.fn(async (): Promise<CompileResult> => {
    status = 'idle';
    return {
      success: true,
      duration: 1,
      tool: {
        name: toolName,
        description: 'mock tool',
        inputSchema: undefined as never,
        execute: async () => null,
        renderToolDoing: () => null,
        renderToolResult: () => null,
        canConcurrent: false,
      } as CustomToolDefinition,
    };
  }),
  executeTool: vi.fn(async (params: Record<string, unknown>): Promise<ExecutionResult> => {
    const result: ExecutionResult = { status: 'success', duration: 1, logs: [] };
    executionHistory.push({
      id: `exec_${executionHistory.length + 1}`,
      timestamp: Date.now(),
      params,
      result,
      grantedPermissions: [],
    });
    status = 'success';
    return result;
  }),
  getExecutionHistory: vi.fn(() => [...executionHistory]),
  clearExecutionHistory: vi.fn(() => {
    executionHistory = [];
  }),
  getStatus: vi.fn(() => status),
});

vi.mock('@/services/tools/tool-playground-service', () => {
  const templates = [
    {
      id: 'basic',
      name: 'Basic Tool',
      description: 'Basic',
      category: 'basic',
      sourceCode: 'export default {}',
    },
    {
      id: 'network',
      name: 'Network Tool',
      description: 'Network',
      category: 'network',
      sourceCode: 'export default {}',
    },
  ];

  let executionHistory: Array<{
    id: string;
    timestamp: number;
    params: Record<string, unknown>;
    result: { status: string; duration: number; logs: unknown[] };
    grantedPermissions: string[];
  }> = [];

  return {
    toolPlaygroundService: {
      initialize: vi.fn(),
      updateSourceCode: vi.fn(),
      updateConfig: vi.fn(),
      getTemplates: vi.fn(() => [...templates]),
      compileTool: vi.fn(async () => ({
        success: true,
        duration: 1,
        tool: {
          name: 'Untitled Tool',
          description: 'mock tool',
          inputSchema: undefined as never,
          execute: async () => null,
          renderToolDoing: () => null,
          renderToolResult: () => null,
          canConcurrent: false,
        },
      })),
      executeTool: vi.fn(async (params: Record<string, unknown>) => {
        const result = { status: 'success' as const, duration: 1, logs: [] };
        executionHistory.push({
          id: `exec_${executionHistory.length + 1}`,
          timestamp: Date.now(),
          params,
          result,
          grantedPermissions: [],
        });
        return result;
      }),
      getExecutionHistory: vi.fn(() => [...executionHistory]),
      clearExecutionHistory: vi.fn(() => {
        executionHistory = [];
      }),
      getStatus: vi.fn(() => 'idle'),
    },
  };
});

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Store reference to mock for resetting in beforeEach
let mockService: ReturnType<typeof createToolPlaygroundServiceMock>;

const initPlayground = () => {
  usePlaygroundStore.getState().initializePlayground(templateSource, 'Basic Tool', {
    allowedPermissions: ['net'],
    timeout: 30000,
    enableMocking: false,
  });
};

describe('Playground Store', () => {
  beforeEach(() => {
    executionHistory = [];
    status = 'idle';
    toolName = 'Untitled Tool';
    mockService = createToolPlaygroundServiceMock();
    vi.clearAllMocks();

    const store = usePlaygroundStore.getState();
    store.clearExecutionHistory();
    store.clearExecutionResult();
  });

  it('keeps execution history across template changes', async () => {
    const store = usePlaygroundStore.getState();
    initPlayground();

    store.clearExecutionHistory();
    store.initializeFromTemplate('basic');

    await store.compileTool();
    await store.executeTool({ message: 'hello' });

    const historyBefore = usePlaygroundStore.getState().executionHistory;
    expect(historyBefore.length).toBe(1);

    store.initializeFromTemplate('network');

    const historyAfter = usePlaygroundStore.getState().executionHistory;
    expect(historyAfter.length).toBe(1);
  });

  it('clears execution history explicitly', () => {
    const store = usePlaygroundStore.getState();
    initPlayground();

    store.clearExecutionHistory();
    expect(usePlaygroundStore.getState().executionHistory).toEqual([]);
  });

  it('clears auto-compile timeout on reinitialization', () => {
    const store = usePlaygroundStore.getState();
    initPlayground();

    // Schedule auto-compile
    store.autoCompile(1000);

    // Reinitialize should clear the pending timeout
    store.initializeFromTemplate('network');
    store.initializePlayground('new code', 'New Tool');

    // Calling clearAutoCompile again should not throw (no timeout to clear)
    expect(() => store.clearAutoCompile()).not.toThrow();
  });

  it('clearAutoCompile is available as a public method', () => {
    const store = usePlaygroundStore.getState();
    initPlayground();

    // Verify clearAutoCompile method exists and is callable
    expect(typeof store.clearAutoCompile).toBe('function');
    expect(() => store.clearAutoCompile()).not.toThrow();
  });
});
