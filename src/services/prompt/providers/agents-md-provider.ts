// src/services/prompt/providers/agents-md-provider.ts
import type { PromptContextProvider, ResolveContext } from '@/types/prompt';

/**
 * Normalize path separators to forward slashes
 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Check if a path is a subdirectory of another path
 */
function isSubdirectory(parent: string, child: string): boolean {
  const normalizedParent = normalizePath(parent);
  const normalizedChild = normalizePath(child);

  // Ensure paths end without trailing slash for comparison
  const parentPath = normalizedParent.replace(/\/$/, '');
  const childPath = normalizedChild.replace(/\/$/, '');

  return childPath.startsWith(`${parentPath}/`) || childPath === parentPath;
}

/**
 * Get the parent directory path
 */
function getParentDirectory(path: string): string | null {
  const normalized = normalizePath(path);
  const parts = normalized.split('/').filter(Boolean);

  if (parts.length <= 1) {
    return null; // Already at root
  }

  const drivePrefixMatch = normalized.match(/^[A-Za-z]:/);
  const prefix = normalized.startsWith('//')
    ? '//'
    : normalized.startsWith('/')
      ? '/'
      : drivePrefixMatch
        ? drivePrefixMatch[0]
        : '';

  if (drivePrefixMatch && parts[0] === drivePrefixMatch[0]) {
    parts.shift();
  }

  parts.pop();

  if (parts.length === 0) {
    return prefix || null;
  }

  const separator = prefix && !prefix.endsWith('/') ? '/' : '';
  return `${prefix}${separator}${parts.join('/')}`;
}

/**
 * Calculate depth between two paths
 */
function getPathDepth(from: string, to: string): number {
  const normalizedFrom = normalizePath(from).replace(/\/$/, '');
  const normalizedTo = normalizePath(to).replace(/\/$/, '');

  if (!isSubdirectory(normalizedFrom, normalizedTo)) {
    return -1; // Not a subdirectory
  }

  if (normalizedFrom === normalizedTo) {
    return 0;
  }

  const relativePath = normalizedTo.substring(normalizedFrom.length + 1);
  return relativePath.split('/').filter(Boolean).length;
}

/**
 * List of markdown files to try in order of preference
 */
const MARKDOWN_FILES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'] as const;

export type MarkdownFileType = (typeof MARKDOWN_FILES)[number];

/**
 * Find hierarchical markdown files with fallback support
 */
async function findHierarchicalMarkdownFiles(
  ctx: ResolveContext,
  settings?: AgentsMdSettings
): Promise<Array<{ path: string; relativePath: string; fileType: MarkdownFileType }>> {
  const results: Array<{ path: string; relativePath: string; fileType: MarkdownFileType }> = [];
  const workspaceRoot = normalizePath(ctx.workspaceRoot);
  const maxDepth = settings?.maxDepth;
  const added = new Set<string>();

  const shouldIncludePath = (dirPath: string) => {
    if (maxDepth === undefined) return true;
    const depth = getPathDepth(workspaceRoot, dirPath);
    return depth !== -1 && depth <= maxDepth;
  };

  const tryAddMarkdownFile = async (dirPath: string) => {
    const relativeDir =
      dirPath === workspaceRoot ? '' : dirPath.substring(workspaceRoot.length + 1);

    for (const fileType of MARKDOWN_FILES) {
      const markdownRelativePath = relativeDir ? `${relativeDir}/${fileType}` : fileType;
      if (added.has(markdownRelativePath)) {
        return;
      }

      try {
        await ctx.readFile(workspaceRoot, markdownRelativePath);
        results.push({ path: dirPath, relativePath: markdownRelativePath, fileType });
        added.add(markdownRelativePath);
        return; // Stop after first match per directory (AGENTS → CLAUDE → GEMINI)
      } catch {
        // File doesn't exist at this level, continue trying other file types
      }
    }
  };

  if (shouldIncludePath(workspaceRoot)) {
    await tryAddMarkdownFile(workspaceRoot);
  }

  const startingPoints: string[] = [];

  if (ctx.currentWorkingDirectory) {
    startingPoints.push(normalizePath(ctx.currentWorkingDirectory));
  }

  if (ctx.recentFilePaths && ctx.recentFilePaths.length > 0) {
    for (const filePath of ctx.recentFilePaths) {
      const normalized = normalizePath(filePath);
      const dir = getParentDirectory(normalized);
      if (dir && !startingPoints.includes(dir)) {
        startingPoints.push(dir);
      }
    }
  }

  // For each starting point, walk up to workspace root
  for (const startPath of startingPoints) {
    if (!isSubdirectory(workspaceRoot, startPath)) {
      continue; // Skip if not within workspace
    }

    let currentPath = startPath;

    while (currentPath) {
      if (shouldIncludePath(currentPath)) {
        await tryAddMarkdownFile(currentPath);
      }

      if (currentPath === workspaceRoot) {
        break;
      }

      const parentPath = getParentDirectory(currentPath);
      if (!parentPath || parentPath === currentPath) {
        break;
      }
      currentPath = parentPath;
    }
  }

  // Sort results from root to deepest (so root comes first, then subdirectories)
  results.sort((a, b) => {
    const depthA = a.relativePath.split('/').length;
    const depthB = b.relativePath.split('/').length;
    return depthA - depthB;
  });

  return results;
}

/**
 * Merge multiple markdown file contents with source annotations
 */
function mergeMarkdownContents(
  files: Array<{ relativePath: string; content: string; fileType: MarkdownFileType }>,
  maxChars?: number
): string {
  if (files.length === 0) {
    return '';
  }

  if (files.length === 1) {
    const firstFile = files[0];
    if (firstFile) {
      return trimToMax(firstFile.content, maxChars);
    }
    return '';
  }

  // Build merged content with source annotations
  const sections = files.map(({ relativePath, content, fileType }) => {
    const source = relativePath === fileType ? 'Root' : relativePath.replace(`/${fileType}`, '');
    return `<!-- From: ${relativePath} (${source}) -->\n${content}`;
  });

  const merged = sections.join('\n\n---\n\n');

  // If within limit, return as is
  if (!maxChars || merged.length <= maxChars) {
    return merged;
  }

  // If too long, prioritize deeper (more specific) files
  // Keep subdirectory files and trim root if needed
  const reversed = [...files].reverse(); // Deepest first
  const prioritizedSections = reversed.map(({ relativePath, content, fileType }) => {
    const source = relativePath === fileType ? 'Root' : relativePath.replace(`/${fileType}`, '');
    return `<!-- From: ${relativePath} (${source}) -->\n${content}`;
  });

  let result = '';
  for (const section of prioritizedSections) {
    if (result.length + section.length + 10 <= maxChars) {
      result = result ? `${section}\n\n---\n\n${result}` : section;
    } else {
      // Trim this section to fit
      const remaining = maxChars - result.length - 50;
      if (remaining > 100) {
        const trimmed = `${section.substring(0, remaining)}\n...\n[trimmed]`;
        result = result ? `${trimmed}\n\n---\n\n${result}` : trimmed;
      }
      break;
    }
  }

  return result;
}

/**
 * Read markdown files with fallback support (AGENTS.md → CLAUDE.md → GEMINI.md)
 */
async function readMarkdownFiles(
  ctx: ResolveContext
): Promise<{ content: string; fileType: MarkdownFileType; relativePath: string } | undefined> {
  for (const fileType of MARKDOWN_FILES) {
    try {
      const content = await ctx.readFile(ctx.workspaceRoot, fileType);
      return { content, fileType, relativePath: fileType };
    } catch {
      // File doesn't exist, try next
    }
  }
  return;
}

function toSourcePath(workspaceRoot: string, relativePath: string): string {
  const normalizedRoot = normalizePath(workspaceRoot).replace(/\/$/, '');
  return relativePath ? `${normalizedRoot}/${relativePath}` : normalizedRoot;
}

function trimToMax(content: string, maxChars?: number): string {
  if (!maxChars || content.length <= maxChars) return content;
  const head = Math.floor(maxChars * 0.7);
  const tail = maxChars - head - 30; // leave space for marker
  return `${content.slice(0, head)}\n...\n[trimmed]\n...\n${content.slice(-Math.max(tail, 0))}`;
}

export type AgentsMdSearchStrategy = 'hierarchical' | 'root-only';

export type AgentsMdSettings = {
  maxChars?: number;
  // Search strategy for finding markdown files
  searchStrategy?: AgentsMdSearchStrategy;
  // Maximum depth for hierarchical search (0 = root only, undefined = no limit)
  maxDepth?: number;
};

export const AgentsMdProvider = (settings?: AgentsMdSettings): PromptContextProvider => ({
  id: 'agents_md',
  label: 'Project Instructions (AGENTS.md/CLAUDE.md/GEMINI.md)',
  description:
    'Injects hierarchical project instructions from AGENTS.md, CLAUDE.md, or GEMINI.md files in the workspace.',
  badges: ['Auto', 'Files', 'Local'],

  providedTokens() {
    return ['agents_md'];
  },

  canResolve(token: string) {
    return token === 'agents_md';
  },

  async resolve(_token: string, ctx: ResolveContext): Promise<string | undefined> {
    const result = await resolveAgentsMdContent(ctx, settings);
    return result?.value;
  },

  async resolveWithMetadata(_token: string, ctx: ResolveContext) {
    return await resolveAgentsMdContent(ctx, settings);
  },

  injection: {
    enabledByDefault: true,
    placement: 'append',
    sectionTitle: 'Project Instructions',
    sectionTemplate(values: Record<string, string>) {
      const content = values.agents_md || '';
      if (!content) return '';
      return ['## Project Instructions', '', `<project>\n${content}\n</project>`].join('\n');
    },
  },
});

async function resolveAgentsMdContent(
  ctx: ResolveContext,
  settings?: AgentsMdSettings
): Promise<
  { value: string; sources: Array<{ sourcePath: string; sectionKind: string }> } | undefined
> {
  const strategy = settings?.searchStrategy ?? 'hierarchical';
  const maxChars = settings?.maxChars ?? 8000;

  if (strategy === 'root-only') {
    const result = await readMarkdownFiles(ctx);
    if (!result) return;

    const content = result.content;
    if (!content.trim()) return;

    return {
      value: trimToMax(content, maxChars),
      sources: [
        {
          sourcePath: toSourcePath(ctx.workspaceRoot, result.relativePath),
          sectionKind: 'project_instructions',
        },
      ],
    };
  }

  if (strategy === 'hierarchical') {
    const foundFiles = await findHierarchicalMarkdownFiles(ctx, settings);

    if (foundFiles.length === 0) return;

    const files: Array<{ relativePath: string; content: string; fileType: MarkdownFileType }> = [];
    for (const { relativePath, fileType } of foundFiles) {
      try {
        const content = await ctx.readFile(ctx.workspaceRoot, relativePath);

        if (!content.trim()) {
          continue;
        }

        files.push({ relativePath, content, fileType });
      } catch {
        // Skip if read fails
      }
    }

    if (files.length === 0) return;
    return {
      value: mergeMarkdownContents(files, maxChars),
      sources: files.map((file) => ({
        sourcePath: toSourcePath(ctx.workspaceRoot, file.relativePath),
        sectionKind: 'project_instructions',
      })),
    };
  }

  return;
}
