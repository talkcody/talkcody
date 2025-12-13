import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  scenario,
  toolCallScenario,
  outputScenario,
  runScenarios,
  ScenarioBuilder,
  type AgentConfig,
  type AgentResponse,
} from './scenario-builder';

// ============================================
// Test Helpers
// ============================================

function createMockAgentConfig(
  response: Partial<AgentResponse> = {}
): AgentConfig {
  return {
    runAgent: vi.fn().mockResolvedValue({
      output: response.output ?? 'Mock output',
      toolCalls: response.toolCalls ?? [],
      trace: response.trace,
    }),
    timeout: 5000,
  };
}

function createToolCallResponse(
  toolName: string,
  args: Record<string, unknown> = {}
): AgentResponse {
  return {
    output: `Calling ${toolName}`,
    toolCalls: [
      { toolCallId: 'tc-1', toolName, args },
    ],
  };
}

// ============================================
// ScenarioBuilder Tests
// ============================================

describe('ScenarioBuilder', () => {
  describe('基础场景构建', () => {
    it('should create empty scenario', () => {
      const s = scenario();
      const info = s.getInfo();
      expect(info.stepCount).toBe(0);
    });

    it('should set name and description', () => {
      const s = scenario('Test')
        .withDescription('A test scenario');
      const info = s.getInfo();
      expect(info.name).toBe('Test');
      expect(info.description).toBe('A test scenario');
    });

    it('should build user-agent scenario', () => {
      const s = scenario()
        .user('Hello')
        .agent();
      expect(s.getInfo().stepCount).toBe(2);
    });
  });

  describe('user step', () => {
    it('should record user message', async () => {
      const config = createMockAgentConfig();
      const result = await scenario()
        .user('Test message')
        .agent()
        .run(config);

      expect(result.success).toBe(true);
      expect(config.runAgent).toHaveBeenCalledWith('Test message');
    });

    it('should support multiple user messages', async () => {
      const config = createMockAgentConfig();
      // 第一轮对话
      await scenario()
        .user('First')
        .agent()
        .run(config);

      expect(config.runAgent).toHaveBeenCalledWith('First');
    });
  });

  describe('assertToolCalled', () => {
    it('should pass when tool is called', async () => {
      const config = createMockAgentConfig(createToolCallResponse('grep', { pattern: 'TODO' }));

      const result = await scenario()
        .user('Search TODO')
        .agent()
        .assertToolCalled('grep')
        .run(config);

      expect(result.success).toBe(true);
    });

    it('should fail when tool is not called', async () => {
      const config = createMockAgentConfig({ output: 'No tools', toolCalls: [] });

      const result = await scenario()
        .user('Search')
        .agent()
        .assertToolCalled('grep')
        .run(config);

      expect(result.success).toBe(false);
      expect(result.errorSummary).toContain("Tool 'grep' was not called");
    });

    it('should verify tool arguments', async () => {
      const config = createMockAgentConfig(createToolCallResponse('grep', { pattern: 'TODO' }));

      const result = await scenario()
        .user('Search')
        .agent()
        .assertToolCalled('grep', { pattern: 'TODO' })
        .run(config);

      expect(result.success).toBe(true);
    });

    it('should fail when arguments dont match', async () => {
      const config = createMockAgentConfig(createToolCallResponse('grep', { pattern: 'ERROR' }));

      const result = await scenario()
        .user('Search')
        .agent()
        .assertToolCalled('grep', { pattern: 'TODO' })
        .run(config);

      expect(result.success).toBe(false);
      expect(result.errorSummary).toContain('wrong args');
    });

    it('should support partial argument matching', async () => {
      const config = createMockAgentConfig(
        createToolCallResponse('grep', { pattern: 'TODO', path: '/src', ignoreCase: true })
      );

      // 只检查 pattern，其他参数忽略
      const result = await scenario()
        .user('Search')
        .agent()
        .assertToolCalled('grep', { pattern: 'TODO' })
        .run(config);

      expect(result.success).toBe(true);
    });
  });

  describe('assertToolNotCalled', () => {
    it('should pass when tool is not called', async () => {
      const config = createMockAgentConfig({ output: 'Simple response', toolCalls: [] });

      const result = await scenario()
        .user('What is TypeScript?')
        .agent()
        .assertToolNotCalled('writeFile')
        .run(config);

      expect(result.success).toBe(true);
    });

    it('should fail when tool is called', async () => {
      const config = createMockAgentConfig(createToolCallResponse('writeFile'));

      const result = await scenario()
        .user('Question')
        .agent()
        .assertToolNotCalled('writeFile')
        .run(config);

      expect(result.success).toBe(false);
      expect(result.errorSummary).toContain("should not have been called");
    });
  });

  describe('assertToolCallCount', () => {
    it('should verify exact tool call count', async () => {
      const config = createMockAgentConfig({
        output: 'Multiple calls',
        toolCalls: [
          { toolCallId: 'tc-1', toolName: 'grep', args: {} },
          { toolCallId: 'tc-2', toolName: 'readFile', args: {} },
        ],
      });

      const result = await scenario()
        .user('Search and read')
        .agent()
        .assertToolCallCount(2)
        .run(config);

      expect(result.success).toBe(true);
    });

    it('should fail when count doesnt match', async () => {
      const config = createMockAgentConfig({
        output: 'One call',
        toolCalls: [{ toolCallId: 'tc-1', toolName: 'grep', args: {} }],
      });

      const result = await scenario()
        .user('Search')
        .agent()
        .assertToolCallCount(2)
        .run(config);

      expect(result.success).toBe(false);
    });
  });

  describe('assertOutputContains', () => {
    it('should pass when output contains text', async () => {
      const config = createMockAgentConfig({ output: 'Found 5 TODO items' });

      const result = await scenario()
        .user('Search')
        .agent()
        .assertOutputContains('TODO')
        .run(config);

      expect(result.success).toBe(true);
    });

    it('should fail when text not found', async () => {
      const config = createMockAgentConfig({ output: 'No results' });

      const result = await scenario()
        .user('Search')
        .agent()
        .assertOutputContains('TODO')
        .run(config);

      expect(result.success).toBe(false);
      expect(result.errorSummary).toContain('does not contain');
    });
  });

  describe('assertOutputNotContains', () => {
    it('should pass when text is absent', async () => {
      const config = createMockAgentConfig({ output: 'Success' });

      const result = await scenario()
        .user('Do something')
        .agent()
        .assertOutputNotContains('error')
        .run(config);

      expect(result.success).toBe(true);
    });

    it('should fail when text is present', async () => {
      const config = createMockAgentConfig({ output: 'An error occurred' });

      const result = await scenario()
        .user('Do something')
        .agent()
        .assertOutputNotContains('error')
        .run(config);

      expect(result.success).toBe(false);
    });
  });

  describe('assertOutputMatches', () => {
    it('should match regex pattern', async () => {
      const config = createMockAgentConfig({ output: 'Found 42 files' });

      const result = await scenario()
        .user('Count files')
        .agent()
        .assertOutputMatches(/Found \d+ files/)
        .run(config);

      expect(result.success).toBe(true);
    });

    it('should support case insensitive', async () => {
      const config = createMockAgentConfig({ output: 'TYPESCRIPT is great' });

      const result = await scenario()
        .user('What is TS?')
        .agent()
        .assertOutputMatches(/typescript/i)
        .run(config);

      expect(result.success).toBe(true);
    });
  });

  describe('assertOutputNotEmpty', () => {
    it('should pass for non-empty output', async () => {
      const config = createMockAgentConfig({ output: 'Response' });

      const result = await scenario()
        .user('Question')
        .agent()
        .assertOutputNotEmpty()
        .run(config);

      expect(result.success).toBe(true);
    });

    it('should fail for empty output', async () => {
      const config = createMockAgentConfig({ output: '' });

      const result = await scenario()
        .user('Question')
        .agent()
        .assertOutputNotEmpty()
        .run(config);

      expect(result.success).toBe(false);
    });

    it('should fail for whitespace-only output', async () => {
      const config = createMockAgentConfig({ output: '   \n\t  ' });

      const result = await scenario()
        .user('Question')
        .agent()
        .assertOutputNotEmpty()
        .run(config);

      expect(result.success).toBe(false);
    });
  });

  describe('assertToolOrder', () => {
    it('should verify tool call order', async () => {
      const config = createMockAgentConfig({
        output: 'Done',
        toolCalls: [
          { toolCallId: 'tc-1', toolName: 'grep', args: {} },
          { toolCallId: 'tc-2', toolName: 'readFile', args: {} },
          { toolCallId: 'tc-3', toolName: 'writeFile', args: {} },
        ],
      });

      const result = await scenario()
        .user('Process')
        .agent()
        .assertToolOrder('grep', 'readFile', 'writeFile')
        .run(config);

      expect(result.success).toBe(true);
    });

    it('should fail when order is wrong', async () => {
      const config = createMockAgentConfig({
        output: 'Done',
        toolCalls: [
          { toolCallId: 'tc-1', toolName: 'writeFile', args: {} },
          { toolCallId: 'tc-2', toolName: 'readFile', args: {} },
        ],
      });

      const result = await scenario()
        .user('Process')
        .agent()
        .assertToolOrder('readFile', 'writeFile')
        .run(config);

      expect(result.success).toBe(false);
    });

    it('should allow non-adjacent tools in order', async () => {
      const config = createMockAgentConfig({
        output: 'Done',
        toolCalls: [
          { toolCallId: 'tc-1', toolName: 'grep', args: {} },
          { toolCallId: 'tc-2', toolName: 'glob', args: {} },
          { toolCallId: 'tc-3', toolName: 'readFile', args: {} },
        ],
      });

      // grep -> readFile (glob 在中间，但顺序正确)
      const result = await scenario()
        .user('Process')
        .agent()
        .assertToolOrder('grep', 'readFile')
        .run(config);

      expect(result.success).toBe(true);
    });
  });

  describe('custom assert', () => {
    it('should execute custom assertion', async () => {
      const config = createMockAgentConfig({
        output: 'Result: 42',
        toolCalls: [{ toolCallId: 'tc-1', toolName: 'calculate', args: { x: 6, y: 7 } }],
      });

      const result = await scenario()
        .user('Calculate 6 * 7')
        .agent()
        .assert(
          (state) => state.output.includes('42'),
          'Output should contain 42'
        )
        .run(config);

      expect(result.success).toBe(true);
    });

    it('should support async custom assertion', async () => {
      const config = createMockAgentConfig({ output: 'async test' });

      const result = await scenario()
        .user('Test')
        .agent()
        .assert(async (state) => {
          await new Promise((r) => setTimeout(r, 10));
          return state.output.includes('async');
        }, 'Async check')
        .run(config);

      expect(result.success).toBe(true);
    });
  });

  describe('wait step', () => {
    it('should wait specified time', async () => {
      const config = createMockAgentConfig();
      const startTime = performance.now();

      await scenario()
        .user('Test')
        .agent()
        .wait(100)
        .run(config);

      const elapsed = Math.ceil(performance.now() - startTime);
      expect(elapsed).toBeGreaterThanOrEqual(100);
    });
  });

  describe('timeout handling', () => {
    it('should timeout slow agent', async () => {
      const config: AgentConfig = {
        runAgent: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({ output: 'late', toolCalls: [] }), 200))
        ),
        timeout: 50,
      };

      const result = await scenario()
        .user('Test')
        .agent()
        .run(config);

      expect(result.success).toBe(false);
      expect(result.errorSummary).toContain('timeout');
    });
  });

  describe('stopOnFirstFailure option', () => {
    it('should stop on first failure by default', async () => {
      const config = createMockAgentConfig({ output: 'Test', toolCalls: [] });

      const result = await scenario()
        .user('Test')
        .agent()
        .assertToolCalled('grep') // Will fail
        .assertOutputContains('Test') // Would pass, but won't run
        .run(config);

      expect(result.success).toBe(false);
      // 只有 3 个步骤执行了 (user, agent, assertToolCalled)
      expect(result.steps.length).toBe(3);
    });

    it('should continue after failure when disabled', async () => {
      const config = createMockAgentConfig({ output: 'Test', toolCalls: [] });

      const result = await scenario()
        .user('Test')
        .agent()
        .assertToolCalled('grep') // Will fail
        .assertOutputContains('Test') // Will pass
        .run({ ...config, stopOnFirstFailure: false });

      // 所有步骤都执行了
      expect(result.steps.length).toBe(4);
      expect(result.steps[2].passed).toBe(false); // assertToolCalled
      expect(result.steps[3].passed).toBe(true);  // assertOutputContains
    });
  });

  describe('step duration tracking', () => {
    it('should track step durations', async () => {
      const config: AgentConfig = {
        runAgent: vi.fn().mockImplementation(
          () => new Promise((resolve) =>
            setTimeout(() => resolve({ output: 'done', toolCalls: [] }), 50)
          )
        ),
      };

      const result = await scenario()
        .user('Test')
        .agent()
        .run(config);

      const agentStep = result.steps.find((s) => s.step.type === 'agent');
      expect(agentStep?.duration).toBeGreaterThanOrEqual(50);
    });
  });
});

// ============================================
// Factory Function Tests
// ============================================

describe('toolCallScenario', () => {
  it('should create tool call scenario', async () => {
    const config = createMockAgentConfig(createToolCallResponse('readFile', { path: '/test.ts' }));

    const result = await toolCallScenario(
      '读取文件',
      'readFile',
      { path: '/test.ts' }
    ).run(config);

    expect(result.success).toBe(true);
  });
});

describe('outputScenario', () => {
  it('should create output scenario with string', async () => {
    const config = createMockAgentConfig({ output: 'TypeScript is a language' });

    const result = await outputScenario(
      'What is TypeScript?',
      'TypeScript'
    ).run(config);

    expect(result.success).toBe(true);
  });

  it('should create output scenario with regex', async () => {
    const config = createMockAgentConfig({ output: 'Found 123 items' });

    const result = await outputScenario(
      'Count items',
      /Found \d+ items/
    ).run(config);

    expect(result.success).toBe(true);
  });
});

// ============================================
// runScenarios Tests
// ============================================

describe('runScenarios', () => {
  it('should run multiple scenarios', async () => {
    const config = createMockAgentConfig({ output: 'Success' });

    const scenarios = [
      scenario('Test 1').user('Q1').agent().assertOutputNotEmpty(),
      scenario('Test 2').user('Q2').agent().assertOutputNotEmpty(),
      scenario('Test 3').user('Q3').agent().assertOutputNotEmpty(),
    ];

    const report = await runScenarios(scenarios, config);

    expect(report.results.length).toBe(3);
    expect(report.passRate).toBe(1);
  });

  it('should calculate pass rate correctly', async () => {
    let callCount = 0;
    const config: AgentConfig = {
      runAgent: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          output: callCount === 2 ? '' : 'Success', // 第二个会失败
          toolCalls: [],
        });
      }),
      stopOnFirstFailure: false,
    };

    const scenarios = [
      scenario('Pass 1').user('Q1').agent().assertOutputNotEmpty(),
      scenario('Fail').user('Q2').agent().assertOutputNotEmpty(), // Will fail
      scenario('Pass 2').user('Q3').agent().assertOutputNotEmpty(),
    ];

    const report = await runScenarios(scenarios, config, { stopOnFirstFailure: false });

    expect(report.passRate).toBeCloseTo(2 / 3);
  });

  it('should stop on first failure when enabled', async () => {
    const config = createMockAgentConfig({ output: '', toolCalls: [] });

    const scenarios = [
      scenario('Fail').user('Q1').agent().assertOutputNotEmpty(),
      scenario('Skip').user('Q2').agent(),
    ];

    const report = await runScenarios(scenarios, config, { stopOnFirstFailure: true });

    expect(report.results.length).toBe(1);
  });

  it('should call progress callback', async () => {
    const config = createMockAgentConfig({ output: 'OK' });
    const onProgress = vi.fn();

    const scenarios = [
      scenario('Test 1').user('Q1').agent(),
      scenario('Test 2').user('Q2').agent(),
    ];

    await runScenarios(scenarios, config, { onProgress });

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2, expect.any(Object));
    expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2, expect.any(Object));
  });

  it('should track total duration', async () => {
    const config: AgentConfig = {
      runAgent: () => new Promise((r) =>
        setTimeout(() => r({ output: 'OK', toolCalls: [] }), 30)
      ),
    };

    const scenarios = [
      scenario('Test 1').user('Q1').agent(),
      scenario('Test 2').user('Q2').agent(),
    ];

    const report = await runScenarios(scenarios, config);

    expect(report.totalDuration).toBeGreaterThanOrEqual(60);
  });
});
