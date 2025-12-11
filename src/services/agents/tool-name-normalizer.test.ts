// src/services/agents/tool-name-normalizer.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidToolName, normalizeToolName } from './tool-name-normalizer';

// Mock logger to avoid Tauri dependencies
vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock getAllToolNames to avoid importing the entire tools module
// Note: These are the TOOL_DEFINITIONS keys (now without Tool suffix)
vi.mock('@/lib/tools', () => ({
  getAllToolNames: vi.fn(() => [
    'readFile',
    'writeFile',
    'editFile',
    'glob',
    'codeSearch',
    'listFiles',
    'bash',
    'callAgent',
    'callAgentV2',
    'todoWrite',
    'webSearch',
    'webFetch',
    'askUserQuestions',
    'exitPlanMode',
    'getSkill',
    'executeSkillScript',
    'githubPR',
  ]),
}));

describe('ToolNameNormalizer', () => {
  describe('isValidToolName', () => {
    it('should return true for valid tool names', () => {
      expect(isValidToolName('bash')).toBe(true);
      expect(isValidToolName('bashTool')).toBe(true);
      expect(isValidToolName('readFile')).toBe(true);
      expect(isValidToolName('read_file')).toBe(true);
      expect(isValidToolName('read-file')).toBe(true);
      expect(isValidToolName('mcp__chrome-devtools__click')).toBe(true);
      expect(isValidToolName('tool123')).toBe(true);
      expect(isValidToolName('Tool_Name-123')).toBe(true);
    });

    it('should return false for invalid tool names with spaces', () => {
      expect(isValidToolName('bash Tool')).toBe(false);
      expect(isValidToolName('read File')).toBe(false);
      expect(isValidToolName('write File Tool')).toBe(false);
    });

    it('should return false for invalid tool names with special characters', () => {
      expect(isValidToolName('bash@tool')).toBe(false);
      expect(isValidToolName('read.file')).toBe(false);
      expect(isValidToolName('write$file')).toBe(false);
      expect(isValidToolName('tool()')).toBe(false);
      expect(isValidToolName('tool#name')).toBe(false);
    });

    it('should return false for empty or whitespace-only names', () => {
      expect(isValidToolName('')).toBe(false);
      expect(isValidToolName(' ')).toBe(false);
      expect(isValidToolName('   ')).toBe(false);
    });
  });

  describe('normalizeToolName', () => {
    it('should return valid tool names unchanged', () => {
      expect(normalizeToolName('bash')).toBe('bash');
      expect(normalizeToolName('readFile')).toBe('readFile');
      expect(normalizeToolName('writeFile')).toBe('writeFile');
      expect(normalizeToolName('editFile')).toBe('editFile');
    });

    it('should normalize "bash Tool" to "bash"', () => {
      expect(normalizeToolName('bash Tool')).toBe('bash');
      expect(normalizeToolName('Bash Tool')).toBe('bash');
      expect(normalizeToolName('BASH TOOL')).toBe('bash');
    });

    it('should normalize bash variations with Tool suffix to bash', () => {
      expect(normalizeToolName('bashTool')).toBe('bash');
      expect(normalizeToolName('BashTool')).toBe('bash');
      expect(normalizeToolName('bashtool')).toBe('bash');
    });

    it('should normalize read file variations', () => {
      expect(normalizeToolName('read File')).toBe('readFile');
      expect(normalizeToolName('Read File')).toBe('readFile');
      expect(normalizeToolName('readfile')).toBe('readFile');
      expect(normalizeToolName('ReadFile')).toBe('readFile');
      expect(normalizeToolName('read File Tool')).toBe('readFile');
    });

    it('should normalize write file variations', () => {
      expect(normalizeToolName('write File')).toBe('writeFile');
      expect(normalizeToolName('Write File')).toBe('writeFile');
      expect(normalizeToolName('writefile')).toBe('writeFile');
      expect(normalizeToolName('WriteFile')).toBe('writeFile');
    });

    it('should normalize edit file variations', () => {
      expect(normalizeToolName('edit File')).toBe('editFile');
      expect(normalizeToolName('Edit File')).toBe('editFile');
      expect(normalizeToolName('editfile')).toBe('editFile');
      expect(normalizeToolName('EditFile')).toBe('editFile');
    });

    it('should normalize glob tool variations', () => {
      expect(normalizeToolName('glob Tool')).toBe('glob');
      expect(normalizeToolName('Glob Tool')).toBe('glob');
      expect(normalizeToolName('glob')).toBe('glob');
      expect(normalizeToolName('Glob')).toBe('glob');
      expect(normalizeToolName('globTool')).toBe('glob');
      expect(normalizeToolName('GlobTool')).toBe('glob');
    });

    it('should normalize code search variations', () => {
      expect(normalizeToolName('code Search')).toBe('codeSearch');
      expect(normalizeToolName('Code Search')).toBe('codeSearch');
      expect(normalizeToolName('codesearch')).toBe('codeSearch');
      expect(normalizeToolName('Grep Tool')).toBe('codeSearch');
      expect(normalizeToolName('grep')).toBe('codeSearch');
    });

    it('should normalize call agent variations', () => {
      expect(normalizeToolName('call Agent')).toBe('callAgent');
      expect(normalizeToolName('Call Agent')).toBe('callAgent');
      expect(normalizeToolName('callagent')).toBe('callAgent');
      expect(normalizeToolName('callAgentV2 Tool')).toBe('callAgentV2');
      expect(normalizeToolName('CallAgentV2')).toBe('callAgentV2');
      expect(normalizeToolName('call agent v2')).toBe('callAgentV2');
    });

    it('should normalize todo write variations', () => {
      expect(normalizeToolName('todo Write Tool')).toBe('todoWrite');
      expect(normalizeToolName('Todo Write Tool')).toBe('todoWrite');
      expect(normalizeToolName('todoWrite')).toBe('todoWrite');
      expect(normalizeToolName('todoWriteTool')).toBe('todoWrite');
      expect(normalizeToolName('TodoWriteTool')).toBe('todoWrite');
    });

    it('should normalize web search variations', () => {
      expect(normalizeToolName('web Search Tool')).toBe('webSearch');
      expect(normalizeToolName('Web Search Tool')).toBe('webSearch');
      expect(normalizeToolName('webSearch')).toBe('webSearch');
      expect(normalizeToolName('webSearchTool')).toBe('webSearch');
      expect(normalizeToolName('WebSearchTool')).toBe('webSearch');
    });

    it('should normalize web fetch variations', () => {
      expect(normalizeToolName('web Fetch Tool')).toBe('webFetch');
      expect(normalizeToolName('Web Fetch Tool')).toBe('webFetch');
      expect(normalizeToolName('webFetch')).toBe('webFetch');
      expect(normalizeToolName('webFetchTool')).toBe('webFetch');
      expect(normalizeToolName('WebFetchTool')).toBe('webFetch');
    });

    it('should normalize askUserQuestions variations', () => {
      expect(normalizeToolName('askUserQuestions')).toBe('askUserQuestions');
      expect(normalizeToolName('askUserQuestionsTool')).toBe('askUserQuestions');
      expect(normalizeToolName('AskUserQuestions')).toBe('askUserQuestions');
    });

    it('should normalize exitPlanMode variations', () => {
      expect(normalizeToolName('exitPlanMode')).toBe('exitPlanMode');
      expect(normalizeToolName('exitPlanModeTool')).toBe('exitPlanMode');
      expect(normalizeToolName('ExitPlanMode')).toBe('exitPlanMode');
    });

    it('should normalize getSkill variations', () => {
      expect(normalizeToolName('getSkill')).toBe('getSkill');
      expect(normalizeToolName('getSkillTool')).toBe('getSkill');
      expect(normalizeToolName('GetSkill')).toBe('getSkill');
    });

    it('should normalize githubPR variations', () => {
      expect(normalizeToolName('githubPR')).toBe('githubPR');
      expect(normalizeToolName('githubPRTool')).toBe('githubPR');
      expect(normalizeToolName('GithubPR')).toBe('githubPR');
    });

    it('should normalize executeSkillScript variations', () => {
      expect(normalizeToolName('executeSkillScript')).toBe('executeSkillScript');
      expect(normalizeToolName('executeSkillScriptTool')).toBe('executeSkillScript');
      expect(normalizeToolName('ExecuteSkillScript')).toBe('executeSkillScript');
    });

    it('should handle MCP tool names', () => {
      expect(normalizeToolName('mcp__chrome-devtools__click')).toBe('mcp__chrome-devtools__click');
      expect(normalizeToolName('mcp__ chrome devtools __ click')).toBe('mcp__chromedevtools__click');
    });

    it('should remove special characters and normalize', () => {
      expect(normalizeToolName('bash@Tool')).toBe('bash');
      expect(normalizeToolName('read.File')).toBe('readFile');
      expect(normalizeToolName('write$File')).toBe('writeFile');
    });

    it('should return null for unrecognized tool names', () => {
      expect(normalizeToolName('unknown Tool Name')).toBe(null);
      expect(normalizeToolName('invalid@#$%^tool')).toBe(null);
      expect(normalizeToolName('completely_random_name')).toBe(null);
    });

    it('should handle empty or whitespace-only input', () => {
      expect(normalizeToolName('')).toBe(null);
      expect(normalizeToolName('   ')).toBe(null);
    });

    it('should handle case variations correctly', () => {
      expect(normalizeToolName('BASH')).toBe('bash');
      expect(normalizeToolName('BashTool')).toBe('bash');
      expect(normalizeToolName('bashtool')).toBe('bash');
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle the specific error case from bug report', () => {
      // The error showed toolName: "bash Tool"
      expect(normalizeToolName('bash Tool')).toBe('bash');
    });

    it('should handle AI models that add descriptive suffixes', () => {
      // "bash command tool" becomes "bashcommandtool" which doesn't have a mapping
      expect(normalizeToolName('bash command tool')).toBe(null);
      expect(normalizeToolName('file reader tool')).toBe(null); // No exact match for this variation
    });

    it('should handle mixed case with spaces', () => {
      expect(normalizeToolName('Bash TOOL')).toBe('bash');
      expect(normalizeToolName('READ file')).toBe('readFile');
      expect(normalizeToolName('WRITE FILE')).toBe('writeFile');
    });
  });
});
