// src/services/agents/tool-name-normalizer.ts
import { logger } from '@/lib/logger';
import { getAllToolNames } from '@/lib/tools';

/**
 * Validates if a tool name follows the required pattern for AI providers
 * Tool names must match: [a-zA-Z0-9_-]+
 */
export function isValidToolName(toolName: string): boolean {
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  return validPattern.test(toolName);
}

/**
 * Normalizes a tool name by removing invalid characters and mapping to known tool names
 *
 * This function handles cases where AI models return tool names with invalid characters
 * (e.g., "bash Tool" instead of "bash" or "bashTool")
 *
 * @param toolName - The tool name to normalize
 * @returns The normalized tool name, or null if it cannot be mapped to a valid tool
 */
export function normalizeToolName(toolName: string): string | null {
  // Remove all invalid characters (anything not alphanumeric, underscore, or hyphen)
  const cleaned = toolName.replace(/[^a-zA-Z0-9_-]/g, '');

  // If cleaning changed the name, log it
  if (cleaned !== toolName) {
    logger.warn('[ToolNameNormalizer] Invalid tool name detected, attempting to normalize', {
      originalToolName: toolName,
      cleanedName: cleaned,
    });
  }

  // Common mappings from AI-generated names to actual tool names
  // This handles cases like "bash Tool" -> "bash", "Bash Tool" -> "bash", etc.
  const commonMappings: Record<string, string> = {
    // Bash tool variations
    bash: 'bash',
    bashTool: 'bash',
    Bash: 'bash',
    BashTool: 'bash',
    bashtool: 'bash',
    BASH: 'bash',

    // Read file variations
    readFile: 'readFile',
    ReadFile: 'readFile',
    readfile: 'readFile',
    READFILE: 'readFile',
    readFileTool: 'readFile',
    ReadFileTool: 'readFile',

    // Write file variations
    writeFile: 'writeFile',
    WriteFile: 'writeFile',
    writefile: 'writeFile',
    WRITEFILE: 'writeFile',
    writeFileTool: 'writeFile',
    WriteFileTool: 'writeFile',

    // Edit file variations
    editFile: 'editFile',
    EditFile: 'editFile',
    editfile: 'editFile',
    EDITFILE: 'editFile',
    editFileTool: 'editFile',
    EditFileTool: 'editFile',

    // Glob tool variations
    glob: 'glob',
    globTool: 'glob',
    GlobTool: 'glob',
    Glob: 'glob',
    GLOB: 'glob',
    globtool: 'glob',

    // Code search variations
    codeSearch: 'codeSearch',
    CodeSearch: 'codeSearch',
    codesearch: 'codeSearch',
    CODESEARCH: 'codeSearch',
    codeSearchTool: 'codeSearch',
    CodeSearchTool: 'codeSearch',
    GrepTool: 'codeSearch',
    grep: 'codeSearch',
    Grep: 'codeSearch',

    // List files variations
    listFiles: 'listFiles',
    ListFiles: 'listFiles',
    listfiles: 'listFiles',
    LISTFILES: 'listFiles',
    listFilesTool: 'listFiles',
    ListFilesTool: 'listFiles',

    // Call agent variations
    callAgent: 'callAgent',
    CallAgent: 'callAgent',
    callagent: 'callAgent',
    CALLAGENT: 'callAgent',
    callAgentTool: 'callAgent',
    CallAgentTool: 'callAgent',
    callAgentV2: 'callAgentV2',
    CallAgentV2: 'callAgentV2',
    callagentv2: 'callAgentV2',
    CALLAGENTV2: 'callAgentV2',
    callAgentV2Tool: 'callAgentV2',
    CallAgentV2Tool: 'callAgentV2',

    // Todo write variations
    todoWrite: 'todoWrite',
    todoWriteTool: 'todoWrite',
    TodoWriteTool: 'todoWrite',
    TodoWrite: 'todoWrite',
    todowrite: 'todoWrite',
    TODOWRITE: 'todoWrite',
    todowritetool: 'todoWrite',

    // Web search variations
    webSearch: 'webSearch',
    webSearchTool: 'webSearch',
    WebSearchTool: 'webSearch',
    WebSearch: 'webSearch',
    websearch: 'webSearch',
    WEBSEARCH: 'webSearch',
    websearchtool: 'webSearch',

    // Web fetch variations
    webFetch: 'webFetch',
    webFetchTool: 'webFetch',
    WebFetchTool: 'webFetch',
    WebFetch: 'webFetch',
    webfetch: 'webFetch',
    WEBFETCH: 'webFetch',
    webfetchtool: 'webFetch',

    // Ask user questions variations
    askUserQuestions: 'askUserQuestions',
    askUserQuestionsTool: 'askUserQuestions',
    AskUserQuestionsTool: 'askUserQuestions',
    AskUserQuestions: 'askUserQuestions',
    askuserquestions: 'askUserQuestions',

    // Exit plan mode variations
    exitPlanMode: 'exitPlanMode',
    exitPlanModeTool: 'exitPlanMode',
    ExitPlanModeTool: 'exitPlanMode',
    ExitPlanMode: 'exitPlanMode',
    exitplanmode: 'exitPlanMode',

    // Get skill variations
    getSkill: 'getSkill',
    getSkillTool: 'getSkill',
    GetSkillTool: 'getSkill',
    GetSkill: 'getSkill',
    getskill: 'getSkill',

    // GitHub PR variations
    githubPR: 'githubPR',
    githubPRTool: 'githubPR',
    GithubPRTool: 'githubPR',
    GithubPR: 'githubPR',
    githubpr: 'githubPR',

    // Execute skill script variations
    executeSkillScript: 'executeSkillScript',
    executeSkillScriptTool: 'executeSkillScript',
    ExecuteSkillScriptTool: 'executeSkillScript',
    ExecuteSkillScript: 'executeSkillScript',
    executeskillscript: 'executeSkillScript',
  };

  // Try exact match first
  if (commonMappings[cleaned]) {
    const normalized = commonMappings[cleaned];
    logger.info('[ToolNameNormalizer] Successfully normalized tool name via mapping', {
      originalToolName: toolName,
      cleanedName: cleaned,
      normalizedName: normalized,
    });
    return normalized;
  }

  // Try case-insensitive match
  const lowerCleaned = cleaned.toLowerCase();
  for (const [key, value] of Object.entries(commonMappings)) {
    if (key.toLowerCase() === lowerCleaned) {
      logger.info(
        '[ToolNameNormalizer] Successfully normalized tool name via case-insensitive match',
        {
          originalToolName: toolName,
          cleanedName: cleaned,
          normalizedName: value,
        }
      );
      return value;
    }
  }

  // If it's an MCP tool (starts with a server ID prefix like "mcp__"), keep the cleaned version
  if (cleaned.startsWith('mcp__') || cleaned.includes('__')) {
    logger.info('[ToolNameNormalizer] Detected MCP tool, using cleaned name', {
      originalToolName: toolName,
      cleanedName: cleaned,
    });
    return cleaned;
  }

  // Check if the cleaned name matches any registered tool names
  const validToolNames = getAllToolNames();
  if (validToolNames.includes(cleaned as any)) {
    logger.info('[ToolNameNormalizer] Cleaned tool name matches a registered tool', {
      originalToolName: toolName,
      cleanedName: cleaned,
    });
    return cleaned;
  }

  logger.error('[ToolNameNormalizer] Unable to normalize tool name to a known tool', {
    originalToolName: toolName,
    cleanedName: cleaned,
    availableTools: validToolNames,
  });

  return null;
}
