import { describe, expect, it } from 'vitest';
import {
  getToolMetadata,
  getToolLabel,
  getAllToolNames,
  isValidToolName,
  TOOL_DEFINITIONS,
  type ToolName,
} from '@/lib/tools';

/**
 * Test suite for tool registry functionality
 * This test focuses on the registry structure and metadata,
 * avoiding complex runtime dependencies
 */
describe('Tool Registry', () => {
  describe('TOOL_DEFINITIONS', () => {
    it('should have all required tools defined', () => {
      const requiredTools: ToolName[] = [
        'readFile',
        'glob',
        'codeSearch',
        'listFiles',
        'writeFile',
        'editFile',
        'bash',
        'callAgent',
        'callAgentV2',
        'todoWrite',
        'webSearch',
        'webFetch',
        'getSkill',
        'askUserQuestions',
        'exitPlanMode',
        'executeSkillScript',
        'githubPR',
      ];

      for (const toolName of requiredTools) {
        expect(TOOL_DEFINITIONS[toolName]).toBeDefined();
      }
    });

    it('should have proper structure for each tool definition', () => {
      for (const [toolName, definition] of Object.entries(TOOL_DEFINITIONS)) {
        expect(definition).toHaveProperty('tool');
        expect(definition).toHaveProperty('label');
        expect(definition).toHaveProperty('metadata');

        // Check metadata structure
        expect(definition.metadata).toHaveProperty('category');
        expect(definition.metadata).toHaveProperty('canConcurrent');
        expect(definition.metadata).toHaveProperty('fileOperation');

        // Check tool structure
        expect(definition.tool).toHaveProperty('description');
        expect(definition.tool).toHaveProperty('inputSchema');
        expect(definition.tool).toHaveProperty('execute');
        expect(typeof definition.tool.execute).toBe('function');
      }
    });

    it('should have file operation tools with getTargetFile function', () => {
      const fileOperationTools = Object.entries(TOOL_DEFINITIONS)
        .filter(([_, def]) => def.metadata.fileOperation);

      expect(fileOperationTools.length).toBeGreaterThan(0);

      for (const [_toolName, definition] of fileOperationTools) {
        if (definition.metadata.fileOperation) {
          expect(definition.metadata.getTargetFile).toBeDefined();
          expect(typeof definition.metadata.getTargetFile).toBe('function');
        }
      }
    });

    it('should use direct tool references instead of module paths', () => {
      // Verify that all tools are directly imported (not dynamic imports)
      for (const [toolName, definition] of Object.entries(TOOL_DEFINITIONS)) {
        // Tool should be a real object, not a string path
        expect(typeof definition.tool).toBe('object');
        expect(definition.tool).not.toBeNull();

        // Should not have old module/export properties
        expect(definition).not.toHaveProperty('module');
        expect(definition).not.toHaveProperty('export');
      }
    });
  });

  describe('getToolMetadata', () => {
    it('should return metadata for valid tool', () => {
      const metadata = getToolMetadata('readFile');

      expect(metadata).toBeDefined();
      expect(metadata.category).toBe('read');
      expect(metadata.canConcurrent).toBe(true);
      expect(metadata.fileOperation).toBe(true);
    });

    it('should return default metadata for unknown tool', () => {
      const metadata = getToolMetadata('unknownTool');

      expect(metadata).toBeDefined();
      expect(metadata.category).toBe('other');
      expect(metadata.canConcurrent).toBe(false);
      expect(metadata.fileOperation).toBe(false);
    });

    it('should have correct categories for different tools', () => {
      const readMetadata = getToolMetadata('readFile');
      const writeMetadata = getToolMetadata('writeFile');
      const editMetadata = getToolMetadata('editFile');
      const bashMetadata = getToolMetadata('bash');

      expect(readMetadata.category).toBe('read');
      expect(writeMetadata.category).toBe('write');
      expect(editMetadata.category).toBe('edit');
      expect(bashMetadata.category).toBe('other');
    });
  });

  describe('getToolLabel', () => {
    it('should return label for valid tool', () => {
      const label = getToolLabel('readFile');
      expect(label).toBe('Read File');
    });

    it('should return tool name for unknown tool', () => {
      const label = getToolLabel('unknownTool');
      expect(label).toBe('unknownTool');
    });

    it('should have proper labels for all tools', () => {
      const expectedLabels: Record<ToolName, string> = {
        readFile: 'Read File',
        glob: 'Glob',
        codeSearch: 'Code Search',
        listFiles: 'List Files',
        writeFile: 'Write File',
        editFile: 'Edit File',
        bash: 'Bash',
        callAgent: 'Call Agent',
        callAgentV2: 'Call Agent v2',
        todoWrite: 'Todo',
        webSearch: 'Web Search',
        webFetch: 'Web Fetch',
        getSkill: 'Get Skill',
        askUserQuestions: 'Ask User Questions',
        exitPlanMode: 'Exit Plan Mode',
        executeSkillScript: 'Execute Skill Script',
        githubPR: 'GitHub PR',
      };

      for (const [toolName, expectedLabel] of Object.entries(expectedLabels)) {
        const label = getToolLabel(toolName);
        expect(label).toBe(expectedLabel);
      }
    });
  });

  describe('getAllToolNames', () => {
    it('should return array of all tool names', () => {
      const names = getAllToolNames();

      expect(Array.isArray(names)).toBe(true);
      expect(names.length).toBeGreaterThan(0);
      expect(names).toContain('readFile');
      expect(names).toContain('writeFile');
      expect(names).toContain('bash');
    });

    it('should match TOOL_DEFINITIONS keys', () => {
      const names = getAllToolNames();
      const definitionKeys = Object.keys(TOOL_DEFINITIONS);

      expect(names.length).toBe(definitionKeys.length);
      expect(names.sort()).toEqual(definitionKeys.sort());
    });
  });

  describe('isValidToolName', () => {
    it('should return true for valid tool names', () => {
      expect(isValidToolName('readFile')).toBe(true);
      expect(isValidToolName('writeFile')).toBe(true);
      expect(isValidToolName('bash')).toBe(true);
      expect(isValidToolName('editFile')).toBe(true);
      expect(isValidToolName('callAgent')).toBe(true);
      expect(isValidToolName('callAgentV2')).toBe(true);
    });

    it('should return false for invalid tool names', () => {
      expect(isValidToolName('nonExistentTool')).toBe(false);
      expect(isValidToolName('')).toBe(false);
      expect(isValidToolName('randomString')).toBe(false);
    });

    it('should validate all registered tools as valid', () => {
      const allNames = getAllToolNames();
      for (const name of allNames) {
        expect(isValidToolName(name)).toBe(true);
      }
    });
  });

  describe('Tool Categories', () => {
    it('should categorize read tools correctly', () => {
      const readTools = ['readFile', 'glob', 'codeSearch', 'listFiles', 'githubPR'];

      for (const toolName of readTools) {
        const metadata = getToolMetadata(toolName);
        expect(metadata.category).toBe('read');
      }
    });

    it('should categorize write tools correctly', () => {
      const writeTools = ['writeFile'];

      for (const toolName of writeTools) {
        const metadata = getToolMetadata(toolName);
        expect(metadata.category).toBe('write');
      }
    });

    it('should categorize edit tools correctly', () => {
      const editTools = ['editFile'];

      for (const toolName of editTools) {
        const metadata = getToolMetadata(toolName);
        expect(metadata.category).toBe('edit');
      }
    });

    it('should categorize other tools correctly', () => {
      const otherTools = [
        'bash',
        'callAgent',
        'todoWrite',
        'webSearch',
        'webFetch',
        'getSkill',
        'askUserQuestions',
        'exitPlanMode',
        'executeSkillScript',
        'imageGeneration',
      ];

      for (const toolName of otherTools) {
        const metadata = getToolMetadata(toolName);
        expect(metadata.category).toBe('other');
      }
    });

    it('should have exactly 5 read tools', () => {
      const allNames = getAllToolNames();
      const readTools = allNames.filter(name => getToolMetadata(name).category === 'read');
      expect(readTools.length).toBe(5);
    });

    it('should have exactly 1 write tool', () => {
      const allNames = getAllToolNames();
      const writeTools = allNames.filter(name => getToolMetadata(name).category === 'write');
      expect(writeTools.length).toBe(1);
    });

    it('should have exactly 1 edit tool', () => {
      const allNames = getAllToolNames();
      const editTools = allNames.filter(name => getToolMetadata(name).category === 'edit');
      expect(editTools.length).toBe(1);
    });
  });

  describe('Concurrent Execution Metadata', () => {
    it('should mark read tools as concurrent', () => {
      const readTools = ['readFile', 'glob', 'codeSearch', 'listFiles', 'githubPR'];

      for (const toolName of readTools) {
        const metadata = getToolMetadata(toolName);
        expect(metadata.canConcurrent).toBe(true);
      }
    });

    it('should mark web tools as concurrent', () => {
      const webTools = ['webSearch', 'webFetch'];

      for (const toolName of webTools) {
        const metadata = getToolMetadata(toolName);
        expect(metadata.canConcurrent).toBe(true);
      }
    });

    it('should mark write/edit tools as non-concurrent', () => {
      const nonConcurrentTools = ['writeFile', 'editFile', 'bash'];

      for (const toolName of nonConcurrentTools) {
        const metadata = getToolMetadata(toolName);
        expect(metadata.canConcurrent).toBe(false);
      }
    });
  });

  describe('File Operation Metadata', () => {
    it('should mark file operation tools correctly', () => {
      const fileOpTools = ['readFile', 'writeFile', 'editFile'];

      for (const toolName of fileOpTools) {
        const metadata = getToolMetadata(toolName);
        expect(metadata.fileOperation).toBe(true);
      }
    });

    it('should mark non-file-operation tools correctly', () => {
      const nonFileOpTools = [
        'glob',
        'codeSearch',
        'listFiles',
        'bash',
        'callAgent',
        'todoWrite',
        'webSearch',
        'webFetch',
        'getSkill',
        'askUserQuestions',
        'exitPlanMode',
        'executeSkillScript',
        'githubPR',
        'imageGeneration',
      ];

      for (const toolName of nonFileOpTools) {
        const metadata = getToolMetadata(toolName);
        expect(metadata.fileOperation).toBe(false);
      }
    });

    it('should have exactly 3 file operation tools', () => {
      const allNames = getAllToolNames();
      const fileOpTools = allNames.filter(name => getToolMetadata(name).fileOperation);
      expect(fileOpTools.length).toBe(3);
    });
  });

  describe('Bug Fix Verification', () => {
    it('should not use dynamic imports with string paths', () => {
      // This test verifies the fix for the MIME type bug
      // All tools should be statically imported and directly referenced
      for (const [toolName, definition] of Object.entries(TOOL_DEFINITIONS)) {
        // Verify tool is a real object (not a promise or module reference)
        expect(definition.tool).toBeDefined();
        expect(typeof definition.tool).toBe('object');

        // Verify tool has required methods
        expect(definition.tool.execute).toBeDefined();
        expect(typeof definition.tool.execute).toBe('function');
      }
    });

    it('should have all tools available synchronously', () => {
      // After the fix, all tools should be available immediately
      // without needing to await dynamic imports
      const start = Date.now();

      for (const toolName of getAllToolNames()) {
        const definition = TOOL_DEFINITIONS[toolName as ToolName];
        expect(definition.tool).toBeDefined();
      }

      const elapsed = Date.now() - start;
      // Should be instant (< 10ms) since no async operations
      expect(elapsed).toBeLessThan(10);
    });
  });
});
