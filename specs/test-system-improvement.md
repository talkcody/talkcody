# TalkCody 测试体系改进方案

> 创建日期: 2024-12
> 更新日期: 2025-12 (新增 AI SDK 调研内容)
> 状态: 草案

## 1. 概述

完善 talkcody 的测试体系，分四个阶段实施：
1. 测试基础设施完善
2. 可测试性架构重构
3. 核心模块测试补充
4. E2E 测试引入

## 2. 当前状态分析

### 2.1 测试现状

| 指标 | 数值 |
|-----|-----|
| 测试文件总数 | 106 个 |
| 测试框架 | Vitest + React Testing Library |
| 覆盖率阈值 | 15% (较低) |
| E2E 测试 | 无 |

### 2.2 测试分布

| 目录 | 测试文件数 | 覆盖率 |
|------|-----------|--------|
| src/components/ | 24 | ~15.6% |
| src/services/ | 15 | ~2.1% |
| src/hooks/ | 8 | ~27.6% |
| src/stores/ | 6 | ~33% |
| src/lib/ | 11 | ~16% |
| src/test/ (集成测试) | 30 | - |

### 2.3 主要问题

#### 问题 1: 关键模块无测试覆盖

| 模块 | 行数 | 风险级别 | 说明 |
|-----|------|---------|------|
| `stream-processor.ts` | 387 | 高 | 核心流处理，完全无测试 |
| `settings-store.ts` | 745 | 高 | 全局设置状态 |
| `bash-executor.ts` | - | 高 | 安全敏感的命令执行 |
| `ai-provider-service.ts` | - | 中 | AI 提供商管理 |
| `ai-completion-service.ts` | - | 中 | AI 补全服务 |
| 21 个无测试的 Hooks | - | 中 | 如 use-file-upload, use-git 等 |

#### 问题 2: 可测试性架构问题

1. **全局单例模式滥用** (25+ 个)
   ```typescript
   // 典型模式 - 难以在测试中 mock
   export const databaseService = new DatabaseService();
   export const llmService = new LLMService();
   export const modelService = new ModelService();
   ```

2. **Tauri API 深度耦合** (90+ 个文件)
   ```typescript
   // 直接调用 Tauri API
   import { invoke } from '@tauri-apps/api/core';
   import { readTextFile, writeFile } from '@tauri-apps/plugin-fs';
   ```

3. **Store 与服务层深度耦合** (11 个服务文件)
   ```typescript
   // 服务中直接调用 store
   useRepositoryStore.getState()
   useSettingsStore.getState()
   ```

4. **缺乏依赖注入**
   ```typescript
   // 硬编码依赖，无法替换
   constructor() {
     this.messageCompactor = new MessageCompactor(this);
     this.streamProcessor = new StreamProcessor();
   }
   ```

#### 问题 3: 测试基础设施不完善

- 无专门的 mock/fixture 目录
- 无 E2E 测试框架
- setup.ts 是唯一的全局设置文件 (237行)
- 覆盖率阈值过低 (15%)

---

## 3. 第一阶段：测试基础设施完善

**预计时间**: 1-2 周
**覆盖率目标**: 15% → 25%

### 3.1 目录结构重组

```
src/test/
├── setup.ts                    # 全局测试设置 (修改)
├── mocks/
│   ├── tauri/
│   │   ├── core.ts             # @tauri-apps/api/core mocks
│   │   ├── fs.ts               # @tauri-apps/plugin-fs mocks
│   │   ├── shell.ts            # @tauri-apps/plugin-shell mocks
│   │   └── index.ts            # 统一导出
│   ├── services/
│   │   ├── database.ts         # 数据库服务 mock
│   │   ├── ai-provider.ts      # AI 提供商服务 mock
│   │   └── index.ts
│   └── stores/
│       ├── settings-store.ts   # Settings store mock
│       └── index.ts
├── fixtures/
│   ├── messages/               # 测试消息数据
│   ├── stream-events/          # 流事件测试数据
│   └── tool-calls/             # 工具调用测试数据
└── utils/
    ├── render-with-providers.tsx  # 带 Provider 的渲染工具
    ├── mock-stream.ts          # 流模拟工具
    ├── wait-for-state.ts       # 状态等待工具
    └── index.ts
```

### 3.2 增强的 Mock 系统

#### 3.2.1 Tauri Mock 工厂

**文件**: `src/test/mocks/tauri/core.ts`

```typescript
import { vi } from 'vitest';

export interface MockInvokeConfig {
  responses?: Record<string, unknown>;
  defaultBehavior?: 'resolve' | 'reject';
}

export function createMockInvoke(config: MockInvokeConfig = {}) {
  const mockResponses = new Map<string, unknown>();

  if (config.responses) {
    Object.entries(config.responses).forEach(([cmd, response]) => {
      mockResponses.set(cmd, response);
    });
  }

  const mockInvoke = vi.fn().mockImplementation(async (cmd: string, args?: unknown) => {
    if (mockResponses.has(cmd)) {
      const response = mockResponses.get(cmd);
      return typeof response === 'function' ? response(args) : response;
    }

    if (config.defaultBehavior === 'reject') {
      throw new Error(`No mock for command: ${cmd}`);
    }

    return undefined;
  });

  return {
    invoke: mockInvoke,
    setResponse: (cmd: string, response: unknown) => mockResponses.set(cmd, response),
    clearResponses: () => mockResponses.clear(),
  };
}
```

#### 3.2.2 Store Mock 工厂

**文件**: `src/test/mocks/stores/settings-store.ts`

```typescript
import { vi } from 'vitest';

export function createMockSettingsStore(overrides = {}) {
  const defaultState = {
    language: 'en',
    model: 'test-model',
    isInitialized: true,
    loading: false,
    error: null,
    apiKeys: {},
    ...overrides,
  };

  return {
    getState: vi.fn(() => defaultState),
    setState: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  };
}

export function mockUseSettingsStore(overrides = {}) {
  const store = createMockSettingsStore(overrides);
  vi.mock('@/stores/settings-store', () => ({
    useSettingsStore: store,
    settingsManager: {
      getCurrentRootPath: vi.fn().mockReturnValue('/test/root'),
      getCurrentConversationId: vi.fn().mockReturnValue('conv-123'),
      getApiKeys: vi.fn().mockResolvedValue({}),
      getApiKeysSync: vi.fn().mockReturnValue({}),
    },
  }));
  return store;
}
```

### 3.3 测试工具函数

#### 3.3.1 带 Provider 的渲染工具

**文件**: `src/test/utils/render-with-providers.tsx`

```typescript
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

interface ProvidersProps {
  children: ReactNode;
  initialState?: {
    settings?: Partial<SettingsState>;
    project?: Partial<ProjectState>;
  };
}

function AllProviders({ children, initialState }: ProvidersProps) {
  return <>{children}</>;
}

export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & { initialState?: ProvidersProps['initialState'] }
) {
  const { initialState, ...renderOptions } = options || {};

  return render(ui, {
    wrapper: ({ children }) => (
      <AllProviders initialState={initialState}>{children}</AllProviders>
    ),
    ...renderOptions,
  });
}
```

#### 3.3.2 流模拟工具

**文件**: `src/test/utils/mock-stream.ts`

```typescript
export interface StreamEvent {
  type: 'text-delta' | 'tool-call' | 'reasoning-start' | 'reasoning-delta' | 'reasoning-end' | 'finish';
  data: unknown;
}

export async function* createMockStream(events: StreamEvent[]) {
  for (const event of events) {
    yield event;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}

export function createStreamFixtures() {
  return {
    simpleTextResponse: [
      { type: 'text-delta', data: { text: 'Hello ' } },
      { type: 'text-delta', data: { text: 'World!' } },
      { type: 'finish', data: { finishReason: 'stop' } },
    ],
    withToolCall: [
      { type: 'text-delta', data: { text: 'Let me help you...' } },
      { type: 'tool-call', data: { toolCallId: 'tc-1', toolName: 'readFile', input: { path: '/test.ts' } } },
      { type: 'finish', data: { finishReason: 'tool-calls' } },
    ],
    withReasoning: [
      { type: 'reasoning-start', data: { id: 'r-1' } },
      { type: 'reasoning-delta', data: { id: 'r-1', text: 'Thinking about...' } },
      { type: 'reasoning-end', data: { id: 'r-1' } },
      { type: 'text-delta', data: { text: 'Here is the answer.' } },
      { type: 'finish', data: { finishReason: 'stop' } },
    ],
  };
}
```

### 3.4 覆盖率配置改进

**修改**: `vitest.config.ts`

```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'json', 'html', 'lcov', 'text-summary'],
  include: ['src/**/*.{ts,tsx}'],
  exclude: [
    'src/test/**',
    'src/**/*.test.{ts,tsx}',
    'src/types/**',
    'src/components/ui/**',
    'src/main.tsx',
    'src/vite-env.d.ts',
  ],
  thresholds: {
    // 第一阶段目标
    lines: 25,
    functions: 25,
    branches: 20,
    statements: 25,
  },
  all: true,
},
```

### 3.5 增强 setup.ts

**修改**: `src/test/setup.ts`

```typescript
import { vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';

// 导入集中管理的 mocks
import { setupTauriMocks } from './mocks/tauri';
import { setupServiceMocks } from './mocks/services';
import { setupStoreMocks } from './mocks/stores';

// 设置所有 mocks
setupTauriMocks();
setupServiceMocks();
setupStoreMocks();

// 全局 beforeEach
beforeEach(() => {
  vi.clearAllMocks();
  if (globalThis.localStorage) {
    globalThis.localStorage.clear();
  }
});

// 全局 afterEach
afterEach(() => {
  vi.restoreAllMocks();
});

// Browser API mocks
globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

globalThis.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
  root: null,
  rootMargin: '',
  thresholds: [],
}));
```

---

## 4. 第二阶段：可测试性架构重构

**预计时间**: 2-3 周
**覆盖率目标**: 25% → 35%

### 4.1 服务容器模式

**新建**: `src/services/container.ts`

```typescript
import type { AIProviderService } from './ai-provider-service';
import type { DatabaseService } from './database-service';
import type { ModelService } from './model-service';

export interface ServiceContainer {
  aiProviderService: AIProviderService;
  databaseService: DatabaseService;
  modelService: ModelService;
  // ... 其他服务
}

let container: ServiceContainer | null = null;

export function getContainer(): ServiceContainer {
  if (!container) {
    // 延迟初始化，使用默认实现
    container = {
      aiProviderService: require('./ai-provider-service').aiProviderService,
      databaseService: require('./database-service').databaseService,
      modelService: require('./model-service').modelService,
    };
  }
  return container;
}

// 用于测试：允许注入 mock 服务
export function setContainer(newContainer: Partial<ServiceContainer>): void {
  container = { ...getContainer(), ...newContainer };
}

// 用于测试：重置容器
export function resetContainer(): void {
  container = null;
}
```

### 4.2 Tauri API 抽象层

**新建**: `src/lib/platform/tauri-adapter.ts`

```typescript
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export interface PlatformAdapter {
  invoke<T>(cmd: string, args?: unknown): Promise<T>;
  isDesktop(): boolean;
}

class TauriPlatformAdapter implements PlatformAdapter {
  async invoke<T>(cmd: string, args?: unknown): Promise<T> {
    return tauriInvoke<T>(cmd, args);
  }

  isDesktop(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  }
}

// 用于测试的 mock 适配器
export class MockPlatformAdapter implements PlatformAdapter {
  private responses = new Map<string, unknown>();

  setResponse(cmd: string, response: unknown): void {
    this.responses.set(cmd, response);
  }

  async invoke<T>(cmd: string, args?: unknown): Promise<T> {
    if (this.responses.has(cmd)) {
      const response = this.responses.get(cmd);
      return (typeof response === 'function' ? response(args) : response) as T;
    }
    throw new Error(`No mock response for command: ${cmd}`);
  }

  isDesktop(): boolean {
    return false;
  }
}

let adapter: PlatformAdapter = new TauriPlatformAdapter();

export function getPlatformAdapter(): PlatformAdapter {
  return adapter;
}

export function setPlatformAdapter(newAdapter: PlatformAdapter): void {
  adapter = newAdapter;
}
```

### 4.3 Store 解耦策略

**修改**: `src/services/agents/stream-processor.ts`

```typescript
import type { SupportedLocale } from '@/locales';
import { getLocale } from '@/locales';

export interface StreamProcessorConfig {
  getLanguage?: () => SupportedLocale;
}

function createDefaultConfig(): StreamProcessorConfig {
  return {
    getLanguage: () => {
      // 懒加载，避免循环依赖
      const { useSettingsStore } = require('@/stores/settings-store');
      return (useSettingsStore.getState().language || 'en') as SupportedLocale;
    },
  };
}

export class StreamProcessor {
  private readonly config: StreamProcessorConfig;

  constructor(config?: Partial<StreamProcessorConfig>) {
    this.config = { ...createDefaultConfig(), ...config };
  }

  private getTranslations() {
    const language = this.config.getLanguage?.() ?? 'en';
    return getLocale(language);
  }
  // ...
}
```

### 4.4 构造函数注入改进示例

**修改**: `src/services/ai-provider-service.ts`

```typescript
export interface AIProviderServiceDeps {
  modelService?: ModelService;
  settingsManager?: SettingsManager;
  logger?: typeof logger;
}

export class AIProviderService {
  private readonly deps: Required<AIProviderServiceDeps>;

  constructor(deps: AIProviderServiceDeps = {}) {
    this.deps = {
      // 默认使用全局单例（向后兼容）
      modelService: deps.modelService ?? require('./model-service').modelService,
      settingsManager: deps.settingsManager ?? require('@/stores/settings-store').settingsManager,
      logger: deps.logger ?? logger,
    };
    this.initializeProviders();
  }
}

// 保持向后兼容的默认导出
export const aiProviderService = new AIProviderService();
```

---

## 5. 第三阶段：核心模块测试补充

**预计时间**: 3-4 周
**覆盖率目标**: 35% → 50%

### 5.1 StreamProcessor 测试

**新建**: `src/services/agents/stream-processor.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StreamProcessor, type StreamProcessorCallbacks } from './stream-processor';

vi.mock('@/locales', () => ({
  getLocale: vi.fn(() => ({
    StreamProcessor: {
      status: {
        answering: 'Answering...',
        thinking: 'Thinking...',
        callingTool: (name: string) => `Calling ${name}...`,
      },
    },
  })),
}));

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: {
    getState: vi.fn(() => ({ language: 'en' })),
  },
}));

describe('StreamProcessor', () => {
  let processor: StreamProcessor;
  let callbacks: StreamProcessorCallbacks;

  beforeEach(() => {
    processor = new StreamProcessor();
    callbacks = {
      onChunk: vi.fn(),
      onStatus: vi.fn(),
      onAssistantMessageStart: vi.fn(),
    };
  });

  describe('state management', () => {
    it('should initialize with correct default state', () => {
      const state = processor.getState();
      expect(state.isAnswering).toBe(false);
      expect(state.toolCalls).toEqual([]);
      expect(state.fullText).toBe('');
    });

    it('should reset state correctly', () => {
      processor.processTextDelta('Hello', callbacks);
      processor.resetState();
      expect(processor.getState().toolCalls).toEqual([]);
    });

    it('should fully reset for new conversation', () => {
      processor.processTextDelta('Hello', callbacks);
      processor.fullReset();
      expect(processor.getState().fullText).toBe('');
    });
  });

  describe('text processing', () => {
    it('should process text-start event', () => {
      processor.processTextStart(callbacks);
      expect(callbacks.onStatus).toHaveBeenCalledWith('Answering...');
      expect(processor.getState().isAnswering).toBe(true);
    });

    it('should accumulate text deltas', () => {
      processor.processTextDelta('Hello ', callbacks);
      processor.processTextDelta('World!', callbacks);
      expect(processor.getFullText()).toBe('Hello World!');
    });
  });

  describe('tool call processing', () => {
    it('should collect tool calls', () => {
      const toolCall = {
        toolCallId: 'tc-1',
        toolName: 'readFile',
        input: { path: '/test.ts' },
      };
      processor.processToolCall(toolCall, callbacks);
      expect(processor.getToolCalls()).toHaveLength(1);
    });

    it('should skip duplicate tool calls', () => {
      const toolCall = { toolCallId: 'tc-1', toolName: 'readFile', input: {} };
      processor.processToolCall(toolCall, callbacks);
      processor.processToolCall(toolCall, callbacks);
      expect(processor.getToolCalls()).toHaveLength(1);
    });

    it('should decode HTML entities in input', () => {
      const toolCall = {
        toolCallId: 'tc-1',
        toolName: 'bash',
        input: { command: 'echo &quot;hello&quot;' },
      };
      processor.processToolCall(toolCall, callbacks);
      expect(processor.getToolCalls()[0].input).toEqual({ command: 'echo "hello"' });
    });
  });

  describe('reasoning processing', () => {
    it('should handle reasoning events', () => {
      processor.processReasoningStart('r-1', callbacks);
      expect(processor.getState().currentReasoningId).toBe('r-1');
      expect(callbacks.onStatus).toHaveBeenCalledWith('Thinking...');
    });

    it('should accumulate reasoning deltas', () => {
      const context = { suppressReasoning: false };
      processor.processReasoningStart('r-1', callbacks);
      processor.processReasoningDelta('r-1', 'Thinking...', context, callbacks);
      const block = processor.getState().reasoningBlocks.find(b => b.id === 'r-1');
      expect(block?.text).toBe('Thinking...');
    });
  });

  describe('error handling', () => {
    it('should track errors', () => {
      expect(processor.hasError()).toBe(false);
      processor.markError();
      expect(processor.hasError()).toBe(true);
      expect(processor.getConsecutiveToolErrors()).toBe(1);
    });
  });
});
```

### 5.2 Settings Store 测试

**新建**: `src/stores/settings-store.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('@/services/database-service', () => ({
  databaseService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    getDb: vi.fn().mockResolvedValue({
      execute: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
      select: vi.fn().mockResolvedValue([]),
    }),
  },
}));

describe('SettingsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('initialization', () => {
    it('should initialize with default values', async () => {
      const { useSettingsStore } = await import('./settings-store');
      const state = useSettingsStore.getState();
      expect(state.language).toBe('en');
      expect(state.isInitialized).toBe(false);
    });
  });

  describe('setters', () => {
    it('should set and persist language', async () => {
      const { useSettingsStore } = await import('./settings-store');
      await act(async () => {
        await useSettingsStore.getState().initialize();
        await useSettingsStore.getState().setLanguage('zh');
      });
      expect(useSettingsStore.getState().language).toBe('zh');
    });
  });

  describe('API keys', () => {
    it('should store and retrieve API keys', async () => {
      const { useSettingsStore } = await import('./settings-store');
      await act(async () => {
        await useSettingsStore.getState().initialize();
        await useSettingsStore.getState().setProviderApiKey('openai', 'sk-test');
      });
      expect(useSettingsStore.getState().getProviderApiKey('openai')).toBe('sk-test');
    });
  });
});
```

### 5.3 BashExecutor 测试增强

**修改**: `src/services/bash-executor.test.ts`

新增测试场景：
- 超长命令处理
- 特殊字符处理
- 超时/空闲超时
- 危险命令边界情况

### 5.4 AI 服务层测试

**新建**: `src/services/ai-provider-service.test.ts`

覆盖场景：
- Provider 初始化
- 模型解析（带/不带 provider 指定）
- Provider 不可用处理

---

## 6. 第四阶段：E2E 测试引入

**预计时间**: 2-3 周
**覆盖率目标**: 50% + E2E 关键流程

### 6.1 E2E 框架选择

选择 **Playwright** 作为 E2E 测试框架：
- 成熟度高，社区支持好
- 调试工具强大（UI 模式、trace viewer）
- 可与 Tauri webview 配合使用

### 6.2 Playwright 配置

**新建**: `playwright.config.ts`

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,  // Tauri 应用需要串行
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-results.json' }],
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'bun run dev',
    port: 1420,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
```

### 6.3 E2E 目录结构

```
e2e/
├── fixtures/
│   ├── test-project/           # 测试用示例项目
│   │   ├── src/index.ts
│   │   └── package.json
│   └── auth.json               # 认证状态 fixture
├── helpers/
│   ├── tauri-app.ts            # Tauri 应用启动/关闭
│   ├── mock-api.ts             # API mock 工具
│   └── selectors.ts            # 常用选择器
├── tests/
│   ├── chat-basic.spec.ts      # 基础聊天
│   ├── chat-history.spec.ts    # 聊天历史
│   ├── file-editing.spec.ts    # 文件编辑
│   └── settings.spec.ts        # 设置页面
└── global-setup.ts             # 全局设置
```

### 6.4 关键 E2E 测试

**新建**: `e2e/tests/chat-basic.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Basic Chat Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:1420');
    await page.waitForSelector('[data-testid="chat-input"]', { timeout: 30000 });
  });

  test('should display chat interface', async ({ page }) => {
    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="send-button"]')).toBeVisible();
  });

  test('should send a message', async ({ page }) => {
    const input = page.locator('[data-testid="chat-input"]');
    await input.fill('Hello, this is a test');
    await page.locator('[data-testid="send-button"]').click();
    await expect(
      page.locator('[data-testid="message-list"]').getByText('Hello, this is a test')
    ).toBeVisible({ timeout: 10000 });
  });

  test('should support multi-line input', async ({ page }) => {
    const input = page.locator('[data-testid="chat-input"]');
    await input.click();
    await page.keyboard.type('Line 1');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('Line 2');
    const value = await input.inputValue();
    expect(value).toContain('Line 1');
    expect(value).toContain('Line 2');
  });
});

test.describe('Chat History', () => {
  test('should persist messages after reload', async ({ page }) => {
    const input = page.locator('[data-testid="chat-input"]');
    await input.fill('Test persistence');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
    await page.reload();
    await page.waitForSelector('[data-testid="chat-input"]');
    await expect(
      page.locator('[data-testid="message-list"]').getByText('Test persistence')
    ).toBeVisible();
  });
});
```

### 6.5 CI 集成

**修改**: `.github/workflows/ci.yml`

```yaml
e2e-test:
  name: E2E Tests
  runs-on: macos-latest
  needs: [lint, type-check]
  steps:
    - uses: actions/checkout@v4
    - uses: oven-sh/setup-bun@v1
    - uses: actions-rs/toolchain@v1
      with:
        toolchain: stable
        profile: minimal
    - run: bun install --frozen-lockfile
    - run: bunx playwright install chromium --with-deps
    - run: bun run build
    - run: bunx playwright test
      env:
        CI: true
    - uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: playwright-report
        path: playwright-report/
```

### 6.6 Package.json 脚本

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:debug": "playwright test --debug",
    "test:e2e:report": "playwright show-report",
    "test:all": "bun run test && bun run test:e2e"
  }
}
```

---

## 7. 实施时间线

| 阶段 | 任务 | 预计时间 | 覆盖率目标 |
|------|------|----------|-----------|
| 1 | 测试基础设施完善 | 1-2 周 | 15% → 25% |
| 2 | 可测试性架构重构 | 2-3 周 | 25% → 35% |
| 3 | 核心模块测试补充 | 3-4 周 | 35% → 50% |
| 4 | E2E 测试引入 | 2-3 周 | 50% + E2E |

**总预计时间**: 8-12 周

---

## 8. 关键文件清单

### 新建文件

| 文件路径 | 阶段 | 说明 |
|---------|------|------|
| `src/test/mocks/tauri/core.ts` | 1 | Tauri invoke mock |
| `src/test/mocks/tauri/fs.ts` | 1 | 文件系统 mock |
| `src/test/mocks/tauri/index.ts` | 1 | 统一导出 |
| `src/test/mocks/stores/settings-store.ts` | 1 | Store mock |
| `src/test/mocks/services/database.ts` | 1 | 数据库 mock |
| `src/test/utils/render-with-providers.tsx` | 1 | 渲染工具 |
| `src/test/utils/mock-stream.ts` | 1 | 流模拟工具 |
| `src/test/fixtures/messages/*.json` | 1 | 测试数据 |
| `src/services/container.ts` | 2 | 服务容器 |
| `src/lib/platform/tauri-adapter.ts` | 2 | 平台抽象层 |
| `src/services/agents/stream-processor.test.ts` | 3 | 流处理测试 |
| `src/stores/settings-store.test.ts` | 3 | Store 测试 |
| `src/services/ai-provider-service.test.ts` | 3 | AI 服务测试 |
| `playwright.config.ts` | 4 | E2E 配置 |
| `e2e/tests/chat-basic.spec.ts` | 4 | 基础聊天测试 |
| `e2e/helpers/tauri-app.ts` | 4 | Tauri 测试工具 |

### 修改文件

| 文件路径 | 阶段 | 修改内容 |
|---------|------|---------|
| `src/test/setup.ts` | 1 | 模块化 mock 引入 |
| `vitest.config.ts` | 1 | 覆盖率阈值提升 |
| `src/services/agents/stream-processor.ts` | 2 | 依赖注入改造 |
| `src/services/ai-provider-service.ts` | 2 | 构造函数注入 |
| `src/services/bash-executor.test.ts` | 3 | 增强边界测试 |
| `.github/workflows/ci.yml` | 4 | E2E 集成 |
| `package.json` | 4 | 新增 E2E 脚本 |

---

## 9. 预期成果

### 短期 (第一阶段)
- 结构化的 mock 管理系统
- 完善的测试工具函数
- 覆盖率提升至 25%

### 中期 (第二、三阶段)
- 核心模块测试覆盖
- 可测试性架构改进
- 覆盖率提升至 50%
- StreamProcessor、SettingsStore、BashExecutor 完整测试

### 长期 (全部阶段)
- Playwright E2E 测试覆盖关键用户流程
- CI/CD 完整集成
- 测试报告和覆盖率可视化
- 开发者可以自信地进行重构

---

## 10. 风险和注意事项

1. **Tauri 应用 E2E 测试的复杂性**
   - WebView 环境与普通浏览器有差异
   - 需要处理 Tauri API mock

2. **大型文件重构风险**
   - settings-store.ts (745行) 重构需谨慎
   - 建议增量改进，每次小步修改

3. **向后兼容**
   - 服务容器和依赖注入需保持现有 API 兼容
   - 使用默认参数保持单例行为

4. **CI 资源消耗**
   - E2E 测试增加 CI 时间
   - 考虑条件运行（仅 main 分支）

---

## 11. AI SDK 测试体系调研 (2025-12 新增)

通过调研 [Vercel AI SDK](https://github.com/vercel/ai) 项目，发现以下值得 talkcody 借鉴的测试模式和最佳实践。

### 11.1 项目概览对比

| 维度 | AI SDK | talkcody |
|------|--------|----------|
| 测试框架 | Vitest 2.1.4 | Vitest 3.2.4 |
| E2E 测试 | Playwright | 无 |
| 环境测试 | Node/Edge/jsdom | 仅 jsdom |
| 覆盖率阈值 | 未明确设置 | 15% |
| 测试文件数 | 86+ 配置文件 | 99 测试文件 |
| API 测试 | MSW 测试服务器 | bun:test 集成测试 |

### 11.2 AI SDK 测试体系亮点

#### 11.2.1 多环境测试架构

AI SDK 使用分离的 vitest 配置文件针对不同运行时环境：

```
vitest.node.config.js   - Node.js 环境
vitest.edge.config.js   - Edge Runtime 环境
vitest.config.js        - jsdom 浏览器环境
```

**配置示例：**

```javascript
// vitest.node.config.js (Node.js 环境)
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts{,x}'],
    exclude: ['**/*.ui.test.ts{,x}', '**/*.e2e.test.ts{,x}'],
    typecheck: { enabled: true },
  },
});

// vitest.edge.config.js (Edge Runtime 环境)
export default defineConfig({
  test: {
    environment: 'edge-runtime',
    include: ['**/*.test.ts{,x}'],
    exclude: ['**/*.ui.test.ts{,x}', '**/*.e2e.test.ts{,x}'],
  },
});
```

**talkcody 借鉴：** 考虑区分 Tauri IPC 测试和纯前端测试的配置文件。

#### 11.2.2 清晰的测试命名规范

```
*.test.ts      - 单元测试（纯逻辑）
*.ui.test.tsx  - UI 组件测试 (jsdom)
*.e2e.test.ts  - E2E 测试 (Playwright)
*.ng.test.ts   - Angular 专用测试
```

**talkcody 当前状况：** 混用 `*.test.ts` 和 `*.test.tsx`，未区分测试类型。

**建议：** 逐步迁移到分离命名规范。

#### 11.2.3 专用测试服务器 (@ai-sdk/test-server)

AI SDK 创建了独立的 `@ai-sdk/test-server` 包，使用 MSW 实现：

```typescript
import { createTestServer, TestResponseController } from '@ai-sdk/test-server/with-vitest';

// 创建可控的测试服务器
const server = createTestServer({
  '/api/chat': {},
});

// 流式响应控制器 - 精确控制流事件
const controller = new TestResponseController();
server.urls['/api/chat'].response = {
  type: 'controlled-stream',
  controller,
};

// 精确控制流式数据
controller.write(formatStreamPart({ type: 'text-start', id: '0' }));
controller.write(formatStreamPart({ type: 'text-delta', delta: 'Hello' }));
controller.write(formatStreamPart({ type: 'text-end', id: '0' }));
controller.close();

// 在测试中等待和验证
await vi.waitFor(() => expect(chat.status).toBe('streaming'));
```

**对 AI 应用的重要性：** 流式响应是 AI 应用的核心，精确控制流事件对测试非常关键。

#### 11.2.4 完善的 Mock 模型库

```typescript
// 专门的 AI 模型 Mock
export class MockLanguageModelV2 implements LanguageModelV2 {
  // 记录所有调用参数，方便断言
  doGenerateCalls: Parameters<LanguageModelV2['doGenerate']>[0][] = [];
  doStreamCalls: Parameters<LanguageModelV2['doStream']>[0][] = [];

  constructor({
    doGenerate = notImplemented,
    doStream = notImplemented,
  } = {}) {
    this.doGenerate = async options => {
      this.doGenerateCalls.push(options);
      return typeof doGenerate === 'function' ? doGenerate(options) : doGenerate;
    };
    // ...
  }
}

// 实用工具函数
export function mockId(options?: { prefix?: string }) {
  let counter = 0;
  const prefix = options?.prefix ?? 'id';
  return () => `${prefix}-${counter++}`;
}

export function mockValues<T>(...values: T[]): () => T {
  let index = 0;
  return () => values[index++];
}
```

#### 11.2.5 TypeScript 类型检查集成

```javascript
// vitest 配置中启用类型检查
test: {
  typecheck: {
    enabled: true,  // 在测试中也进行类型检查
  },
}
```

#### 11.2.6 Fixture 文件对比测试

用于 Codemod 等转换测试：

```
__testfixtures__/
├── transform-name.input.ts   - 输入代码
└── transform-name.output.ts  - 期望输出
```

### 11.3 talkcody 具体改进建议

#### P0 优先级 - 立即可行

**1. 创建流式响应测试工具**

```typescript
// src/test/utils/test-stream-controller.ts
export class TestStreamController {
  private encoder = new TextEncoder();
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  createStream(): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start: (controller) => {
        this.controller = controller;
      }
    });
  }

  write(data: string) {
    this.controller?.enqueue(this.encoder.encode(data));
  }

  close() {
    this.controller?.close();
  }
}
```

**2. 增加 Mock 辅助函数**

```typescript
// src/test/utils/mock-helpers.ts
export function mockId(options?: { prefix?: string }) {
  let counter = 0;
  const prefix = options?.prefix ?? 'id';
  return () => `${prefix}-${counter++}`;
}

export function mockValues<T>(...values: T[]): () => T {
  let index = 0;
  return () => values[index++];
}
```

**3. 启用 TypeScript 类型检查**

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    typecheck: {
      enabled: true,
    },
  },
});
```

#### P1 优先级 - 中期改进

**4. 统一测试命名规范**

```
当前: *.test.ts / *.test.tsx (混用)
目标:
  *.test.ts      - 纯逻辑/服务测试
  *.ui.test.tsx  - React 组件/Hook 测试
  *.e2e.test.ts  - E2E 测试
```

**5. 分离测试配置文件**

```javascript
// vitest.unit.config.ts
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/*.ui.test.tsx', '**/*.e2e.test.ts'],
  }
});

// vitest.ui.config.ts
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.ui.test.tsx'],
  }
});
```

#### P2 优先级 - 长期规划

**6. 创建专用 AI 服务 Mock 模块**

```typescript
// src/test/mocks/mock-ai-service.ts
export class MockAIService {
  generateCalls: Array<{ prompt: string; options: any }> = [];
  streamCalls: Array<{ prompt: string }> = [];

  async generate(prompt: string, options: any) {
    this.generateCalls.push({ prompt, options });
    return this.mockResponse;
  }

  setMockResponse(response: any) {
    this.mockResponse = response;
  }
}
```

**7. Tauri 多环境测试配置**

```javascript
// vitest.tauri.config.ts
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.tauri.test.ts'],
    setupFiles: ['./src/test/tauri-setup.ts'],
  }
});
```

### 11.4 AI SDK 测试示例参考

**Angular/React 组件测试示例：**

```typescript
import { createTestServer, TestResponseController } from '@ai-sdk/test-server/with-vitest';
import { mockId } from '@ai-sdk/provider-utils/test';

const server = createTestServer({ '/api/chat': {} });

describe('Chat Component', () => {
  let chat: Chat;

  beforeEach(() => {
    chat = new Chat({ generateId: mockId() });
  });

  it('should correctly manage streamed response', async () => {
    server.urls['/api/chat'].response = {
      type: 'stream-chunks',
      chunks: [
        formatStreamPart({ type: 'text-start', id: '0' }),
        formatStreamPart({ type: 'text-delta', id: '0', delta: 'Hello' }),
        formatStreamPart({ type: 'text-delta', id: '0', delta: ', world' }),
        formatStreamPart({ type: 'text-end', id: '0' }),
      ],
    };

    await chat.sendMessage({ parts: [{ text: 'hi', type: 'text' }] });

    expect(chat.messages.at(1)).toStrictEqual(
      expect.objectContaining({
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hello, world', state: 'done' }],
      }),
    );
  });

  it('should track status changes', async () => {
    const controller = new TestResponseController();
    server.urls['/api/chat'].response = { type: 'controlled-stream', controller };

    const sendPromise = chat.sendMessage({ text: 'hi' });

    await vi.waitFor(() => expect(chat.status).toBe('submitted'));
    controller.write(formatStreamPart({ type: 'text-start', id: '0' }));
    await vi.waitFor(() => expect(chat.status).toBe('streaming'));
    controller.close();
    await sendPromise;
    expect(chat.status).toBe('ready');
  });
});
```

### 11.5 总结

AI SDK 作为成熟的开源项目，其测试体系的核心优势：

| 优势 | 重要性 | talkcody 当前状态 |
|-----|--------|-----------------|
| 流式响应测试工具 | 高 | 无专用工具 |
| 清晰的命名规范 | 中 | 混用 |
| Mock 工具库 | 中 | 基础 mock |
| TypeScript 类型检查 | 中 | 未启用 |
| E2E 测试 | 中 | 无 |
| 多环境测试 | 低 | 仅 jsdom |

**建议实施顺序：**
1. 流式响应测试工具（对 AI 应用最关键）
2. Mock 辅助函数
3. TypeScript 类型检查
4. 命名规范统一
5. E2E 测试引入
