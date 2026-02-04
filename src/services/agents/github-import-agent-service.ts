/**
 * GitHub Import Service for Agents
 * Wrapper for importing agents from GitHub using Markdown frontmatter
 */

import type { RemoteAgentConfig } from '@talkcody/shared/types/remote-agents';
import { logger } from '@/lib/logger';
import { simpleFetch } from '@/lib/tauri-fetch';
import type { AgentToolSet } from '@/types/agent';
import { isValidModelType, ModelType } from '@/types/model-types';

export interface ImportAgentFromGitHubOptions {
  repository: string; // e.g., "talkcody/agents"
  path: string; // e.g., "agents/coding" or "agents/coding/agent.md"
  agentId: string; // Unique ID for the agent (fallback)
  branch?: string; // Optional branch from GitHub URL
}

export type AgentMarkdownFrontmatter = {
  name?: string;
  description?: string;
  tools?: string[] | string;
  model?: string;
  role?: 'read' | 'write';
  canBeSubagent?: boolean;
  version?: string;
  category?: string;
};

export type ParsedAgentMarkdown = {
  frontmatter: AgentMarkdownFrontmatter;
  prompt: string;
};

const TOOL_ALIAS_MAP: Record<string, string> = {
  read: 'readFile',
  write: 'writeFile',
  multiedit: 'editFile',
  edit: 'editFile',
  glob: 'glob',
  grep: 'codeSearch',
  bash: 'bash',
  ls: 'listFiles',
  listfiles: 'listFiles',
  websearch: 'webSearch',
  webfetch: 'webFetch',
  todowrite: 'todoWrite',
  exitplanmode: 'exitPlanMode',
  skill: 'bash',
  task: 'explore',
  askuserquestion: 'askUserQuestions',
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function uniqueBranches(branch?: string): string[] {
  const candidates = [branch, 'main', 'master'].filter(Boolean) as string[];
  return Array.from(new Set(candidates));
}

function normalizeTools(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function mapToolsToIds(tools: string[]): string[] {
  return tools
    .map((tool) => {
      const normalized = tool.replace(/\s+/g, '').toLowerCase();
      return TOOL_ALIAS_MAP[normalized] || tool;
    })
    .map((tool) => tool.trim())
    .filter(Boolean);
}

function mapModelToType(value?: string): ModelType {
  if (!value) return ModelType.MAIN;
  if (isValidModelType(value)) {
    // Map message_compaction_model to main_model for compatibility with shared types
    if (value === ModelType.MESSAGE_COMPACTION) {
      return ModelType.MAIN;
    }
    return value;
  }
  const normalized = value.toLowerCase();
  if (normalized.includes('haiku') || normalized.includes('small')) {
    return ModelType.SMALL;
  }
  return ModelType.MAIN;
}

export function parseAgentFrontmatterYaml(yaml: string): AgentMarkdownFrontmatter {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  let currentKey: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    if (trimmed.startsWith('- ') && currentKey) {
      const value = trimmed
        .slice(2)
        .trim()
        .replace(/^["']|["']$/g, '');
      const existing = result[currentKey];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        result[currentKey] = [value];
      }
      continue;
    }

    const match = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1]?.trim() || '';
    let value: unknown = match[2]?.trim() || '';

    if (value === '') {
      currentKey = key;
      continue;
    }

    currentKey = null;

    if (value === 'true') {
      value = true;
    } else if (value === 'false') {
      value = false;
    } else if (typeof value === 'string') {
      value = value.replace(/^["']|["']$/g, '');
    }

    if (key === 'tools' && typeof value === 'string') {
      value = normalizeTools(value);
    }

    result[key] = value;
  }

  return result as AgentMarkdownFrontmatter;
}

export function parseAgentMarkdown(content: string): ParsedAgentMarkdown {
  const trimmed = content.trim();

  if (!trimmed.startsWith('---')) {
    throw new Error('Invalid agent markdown: Missing YAML frontmatter');
  }

  const lines = trimmed.split('\n');
  let frontmatterEndIndex = -1;

  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === '---') {
      frontmatterEndIndex = i;
      break;
    }
  }

  if (frontmatterEndIndex === -1) {
    throw new Error('Invalid agent markdown: Missing closing --- for YAML frontmatter');
  }

  const frontmatterLines = lines.slice(1, frontmatterEndIndex);
  const frontmatterYaml = frontmatterLines.join('\n');
  const markdownLines = lines.slice(frontmatterEndIndex + 1);
  const markdownContent = markdownLines.join('\n').trim();

  const frontmatter = parseAgentFrontmatterYaml(frontmatterYaml);

  return {
    frontmatter,
    prompt: markdownContent,
  };
}

function extractMarkdownPathsFromJson(html: string, basePath: string): string[] {
  try {
    // GitHub now embeds file list in JSON data within a script tag
    const jsonMatch = html.match(
      /<script\s+type="application\/json"\s+data-target="react-app\.embeddedData">\s*({.*?})\s*<\/script>/s
    );

    if (!jsonMatch) {
      return [];
    }

    const jsonContent = jsonMatch[1];
    if (!jsonContent) {
      return [];
    }

    const jsonData = JSON.parse(jsonContent);
    const treeItems = jsonData?.payload?.tree?.items;

    if (!Array.isArray(treeItems)) {
      return [];
    }

    const normalizedBase = basePath ? `${basePath.replace(/\/+$/, '')}` : '';
    const paths: string[] = [];

    for (const item of treeItems) {
      // Filter for markdown files only
      if (item.contentType === 'file' && item.path?.endsWith('.md')) {
        const filePath = item.path as string;
        // Apply basePath filter if specified
        if (
          !normalizedBase ||
          filePath === normalizedBase ||
          filePath.startsWith(`${normalizedBase}/`)
        ) {
          paths.push(filePath);
        }
      }
    }

    return paths;
  } catch {
    // If JSON parsing fails, return empty array and let fallback handle it
    return [];
  }
}

export function extractMarkdownPathsFromHtml(
  html: string,
  owner: string,
  repo: string,
  branch: string,
  basePath: string
): string[] {
  // Priority 1: Try new GitHub JSON format (embedded data)
  const jsonPaths = extractMarkdownPathsFromJson(html, basePath);
  if (jsonPaths.length > 0) {
    return jsonPaths;
  }

  // Priority 2: Fallback to legacy anchor tag format for compatibility
  const normalizedBase = basePath ? `${basePath.replace(/\/+$/, '')}/` : '';
  const pattern = new RegExp(`href="/${owner}/${repo}/blob/${branch}/([^"#]+\\.md)"`, 'g');
  const matches = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const filePath = match[1];
    if (!filePath) continue;
    if (normalizedBase && !filePath.startsWith(normalizedBase)) continue;
    matches.add(filePath);
  }

  return Array.from(matches.values());
}

/**
 * Convert tool IDs to actual tool references by matching with available tools.
 * This is used after importing an agent from GitHub to resolve tool names to actual tool objects.
 * Uses dynamic import to avoid circular dependencies.
 */
export async function resolveAgentTools(agentConfig: RemoteAgentConfig): Promise<AgentToolSet> {
  const { getAvailableToolsForUISync } = await import('@/services/agents/tool-registry');
  const availableTools = getAvailableToolsForUISync();
  const toolIds = new Set(availableTools.map((tool) => tool.id));

  const resolvedTools: Record<string, unknown> = {};
  const toolList = Object.keys((agentConfig.tools || {}) as Record<string, unknown>);

  for (const toolId of toolList) {
    if (!toolIds.has(toolId)) continue;
    const match = availableTools.find((tool) => tool.id === toolId);
    if (match) {
      resolvedTools[toolId] = match.ref;
    }
  }

  return resolvedTools as AgentToolSet;
}

export function buildRemoteAgentConfig(params: {
  parsed: ParsedAgentMarkdown;
  repository: string;
  githubPath: string;
  fallbackId: string;
  defaultCategory?: string;
}): RemoteAgentConfig {
  const { parsed, repository, githubPath, fallbackId, defaultCategory = 'github' } = params;
  const name = parsed.frontmatter.name ? String(parsed.frontmatter.name).trim() : fallbackId;
  const description = parsed.frontmatter.description
    ? String(parsed.frontmatter.description).trim()
    : '';
  const prompt = parsed.prompt;

  if (!prompt) {
    throw new Error('Invalid agent markdown: Missing prompt content');
  }

  const toolNames = mapToolsToIds(normalizeTools(parsed.frontmatter.tools));
  const tools: Record<string, unknown> = {};
  for (const toolName of toolNames) {
    tools[toolName] = {};
  }

  // Default dynamic prompt configuration for GitHub-imported agents
  const dynamicPrompt: RemoteAgentConfig['dynamicPrompt'] = {
    enabled: true,
    providers: ['env', 'agents_md'],
    variables: {},
    providerSettings: {
      agents_md: {
        maxChars: 8000,
        searchStrategy: 'hierarchical',
      },
    },
  };

  return {
    id: slugify(name) || fallbackId,
    name,
    description,
    category: parsed.frontmatter.category ? String(parsed.frontmatter.category) : defaultCategory,
    repository,
    githubPath,
    modelType: mapModelToType(parsed.frontmatter.model) as RemoteAgentConfig['modelType'],
    systemPrompt: prompt,
    tools,
    role: parsed.frontmatter.role,
    canBeSubagent: parsed.frontmatter.canBeSubagent,
    version: parsed.frontmatter.version ? String(parsed.frontmatter.version) : undefined,
    dynamicPrompt,
  };
}

async function fetchMarkdownFile(rawUrl: string): Promise<string | null> {
  const response = await simpleFetch(rawUrl, { method: 'GET' });
  if (!response.ok) {
    return null;
  }
  return await response.text();
}

/**
 * Import agents from GitHub using Markdown frontmatter format
 */
export async function importAgentFromGitHub(
  options: ImportAgentFromGitHubOptions
): Promise<RemoteAgentConfig[]> {
  const { repository, path, agentId, branch } = options;

  const [owner, repo] = repository.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid repository format: ${repository}. Expected format: owner/repo`);
  }

  const branches = uniqueBranches(branch);
  const githubUrl = `https://github.com/${repository}/tree/${branches[0]}/${path}`;

  logger.info('Importing agent from GitHub:', {
    repository,
    path,
    agentId,
    githubUrl,
  });

  const isMarkdownPath = path.toLowerCase().endsWith('.md');

  try {
    if (isMarkdownPath) {
      const branchAttempts: Array<{ branch: string; success: boolean; status: string }> = [];
      for (const currentBranch of branches) {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${currentBranch}/${path}`;
        const content = await fetchMarkdownFile(rawUrl);
        if (!content) {
          branchAttempts.push({ branch: currentBranch, success: false, status: 'fetch failed' });
          continue;
        }

        try {
          const parsed = parseAgentMarkdown(content);
          const agentConfig = buildRemoteAgentConfig({
            parsed,
            repository,
            githubPath: path,
            fallbackId: agentId,
          });

          logger.info('Successfully imported agent from GitHub:', {
            agentId: agentConfig.id,
            agentName: agentConfig.name,
          });

          return [agentConfig];
        } catch (parseError) {
          branchAttempts.push({
            branch: currentBranch,
            success: false,
            status: `parse error: ${parseError}`,
          });
        }
      }

      const errorDetails = branchAttempts
        .map((attempt) => `- Branch "${attempt.branch}": ${attempt.status}`)
        .join('\n');
      throw new Error(`Failed to fetch agent markdown from GitHub. Details:\n${errorDetails}`);
    }

    const branchAttempts: Array<{
      branch: string;
      responseOk: boolean;
      markdownPathsCount: number;
      parseErrors: Array<{ path: string; error: unknown }>;
    }> = [];

    for (const currentBranch of branches) {
      const directoryUrl = `https://github.com/${owner}/${repo}/tree/${currentBranch}/${path}`;
      const response = await simpleFetch(directoryUrl, { method: 'GET' });
      if (!response.ok) {
        branchAttempts.push({
          branch: currentBranch,
          responseOk: false,
          markdownPathsCount: 0,
          parseErrors: [],
        });
        continue;
      }

      const html = await response.text();
      const markdownPaths = extractMarkdownPathsFromHtml(html, owner, repo, currentBranch, path);

      if (markdownPaths.length === 0) {
        branchAttempts.push({
          branch: currentBranch,
          responseOk: true,
          markdownPathsCount: 0,
          parseErrors: [],
        });
        continue;
      }

      const agents: RemoteAgentConfig[] = [];
      const parseErrors: Array<{ path: string; error: unknown }> = [];

      for (const markdownPath of markdownPaths) {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${currentBranch}/${markdownPath}`;
        const content = await fetchMarkdownFile(rawUrl);
        if (!content) {
          logger.warn('Failed to download agent markdown:', { rawUrl });
          continue;
        }

        try {
          const parsed = parseAgentMarkdown(content);
          const agentConfig = buildRemoteAgentConfig({
            parsed,
            repository,
            githubPath: markdownPath,
            fallbackId: markdownPath.split('/').pop()?.replace(/\.md$/i, '') || agentId,
          });
          agents.push(agentConfig);
        } catch (parseError) {
          logger.warn('Skipping invalid agent markdown file:', {
            markdownPath,
            error: parseError,
          });
          parseErrors.push({ path: markdownPath, error: parseError });
        }
      }

      if (agents.length > 0) {
        logger.info('Successfully imported agents from GitHub:', {
          count: agents.length,
        });
        return agents;
      }

      branchAttempts.push({
        branch: currentBranch,
        responseOk: true,
        markdownPathsCount: markdownPaths.length,
        parseErrors,
      });
    }

    // Build detailed error message
    const errorDetails = branchAttempts
      .map((attempt) => {
        const status = attempt.responseOk
          ? attempt.markdownPathsCount === 0
            ? 'no markdown files found in directory'
            : `found ${attempt.markdownPathsCount} markdown files, all invalid`
          : 'failed to fetch directory';
        const parseErrorSummary =
          attempt.parseErrors.length > 0
            ? ` (parse errors: ${attempt.parseErrors.map((e) => e.path).join(', ')})`
            : '';
        return `- Branch "${attempt.branch}": ${status}${parseErrorSummary}`;
      })
      .join('\n');

    throw new Error(
      `No valid agent markdown files found in the specified directory. Details:\n${errorDetails}`
    );
  } catch (error) {
    logger.error('Failed to import agent from GitHub:', error);
    throw error;
  }
}
