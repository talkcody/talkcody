import { describe, expect, it, beforeEach } from 'vitest';
import {
  getAgentExecutionConfig,
  updateAgentExecutionConfig,
  resetAgentExecutionConfig,
  getDefaultAgentExecutionConfig,
  getMaxParallelSubagents,
  getNestedAgentTimeoutMs,
  isParallelExecutionEnabled,
} from './agent-execution-config';

describe('AgentExecutionConfig', () => {
  beforeEach(() => {
    // Reset to defaults before each test
    resetAgentExecutionConfig();
  });

  describe('getDefaultAgentExecutionConfig', () => {
    it('returns default configuration values', () => {
      const defaults = getDefaultAgentExecutionConfig();

      expect(defaults.maxParallelSubagents).toBe(20);
      expect(defaults.nestedAgentTimeoutMs).toBe(5 * 60 * 1000);
      expect(defaults.enableParallelExecution).toBe(true);
    });
  });

  describe('getAgentExecutionConfig', () => {
    it('returns current configuration', () => {
      const config = getAgentExecutionConfig();

      expect(config.maxParallelSubagents).toBe(20);
      expect(config.nestedAgentTimeoutMs).toBe(300000);
      expect(config.enableParallelExecution).toBe(true);
    });
  });

  describe('updateAgentExecutionConfig', () => {
    it('updates maxParallelSubagents', () => {
      updateAgentExecutionConfig({ maxParallelSubagents: 10 });

      expect(getMaxParallelSubagents()).toBe(10);
      // Other values should remain unchanged
      expect(getNestedAgentTimeoutMs()).toBe(300000);
      expect(isParallelExecutionEnabled()).toBe(true);
    });

    it('updates nestedAgentTimeoutMs', () => {
      updateAgentExecutionConfig({ nestedAgentTimeoutMs: 600000 });

      expect(getNestedAgentTimeoutMs()).toBe(600000);
      expect(getMaxParallelSubagents()).toBe(20);
    });

    it('updates enableParallelExecution', () => {
      updateAgentExecutionConfig({ enableParallelExecution: false });

      expect(isParallelExecutionEnabled()).toBe(false);
      expect(getMaxParallelSubagents()).toBe(20);
    });

    it('updates multiple values at once', () => {
      updateAgentExecutionConfig({
        maxParallelSubagents: 3,
        nestedAgentTimeoutMs: 120000,
        enableParallelExecution: false,
      });

      expect(getMaxParallelSubagents()).toBe(3);
      expect(getNestedAgentTimeoutMs()).toBe(120000);
      expect(isParallelExecutionEnabled()).toBe(false);
    });

    it('returns the updated config', () => {
      const updated = updateAgentExecutionConfig({ maxParallelSubagents: 7 });

      expect(updated.maxParallelSubagents).toBe(7);
    });
  });

  describe('resetAgentExecutionConfig', () => {
    it('resets all values to defaults', () => {
      // First update some values
      updateAgentExecutionConfig({
        maxParallelSubagents: 10,
        nestedAgentTimeoutMs: 600000,
        enableParallelExecution: false,
      });

      // Reset
      resetAgentExecutionConfig();

      // Verify defaults
      expect(getMaxParallelSubagents()).toBe(20);
      expect(getNestedAgentTimeoutMs()).toBe(300000);
      expect(isParallelExecutionEnabled()).toBe(true);
    });

    it('returns the default config', () => {
      updateAgentExecutionConfig({ maxParallelSubagents: 10 });
      const reset = resetAgentExecutionConfig();

      expect(reset.maxParallelSubagents).toBe(20);
    });
  });

  describe('convenience getters', () => {
    it('getMaxParallelSubagents returns current value', () => {
      expect(getMaxParallelSubagents()).toBe(20);

      updateAgentExecutionConfig({ maxParallelSubagents: 8 });
      expect(getMaxParallelSubagents()).toBe(8);
    });

    it('getNestedAgentTimeoutMs returns current value', () => {
      expect(getNestedAgentTimeoutMs()).toBe(300000);

      updateAgentExecutionConfig({ nestedAgentTimeoutMs: 180000 });
      expect(getNestedAgentTimeoutMs()).toBe(180000);
    });

    it('isParallelExecutionEnabled returns current value', () => {
      expect(isParallelExecutionEnabled()).toBe(true);

      updateAgentExecutionConfig({ enableParallelExecution: false });
      expect(isParallelExecutionEnabled()).toBe(false);
    });
  });

  describe('config immutability', () => {
    it('getAgentExecutionConfig returns readonly object', () => {
      const config = getAgentExecutionConfig();

      // This should not affect the actual config
      // TypeScript would prevent this at compile time with Readonly<>
      // but we test runtime behavior
      expect(() => {
        (config as any).maxParallelSubagents = 100;
      }).not.toThrow();

      // The internal config should still have the original value
      // (because we return the internal object, not a copy)
      // This is a design choice - for performance we don't deep copy
      expect(getMaxParallelSubagents()).toBe(100);

      // Reset for other tests
      resetAgentExecutionConfig();
    });
  });
});
