/**
 * GitHub Skills Importer
 *
 * Import skills from GitHub repositories using GitHub API
 * Supports importing skills from public repositories without authentication
 */

import { dirname, join } from '@tauri-apps/api/path';
import {
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  writeFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { Command } from '@tauri-apps/plugin-shell';
import { logger } from '@/lib/logger';
import { getAgentSkillService } from './agent-skill-service';
import { SkillMdParser } from './skill-md-parser';

/**
 * GitHub repository information parsed from URL
 */
export interface GitHubRepoInfo {
  owner: string; // Repository owner (e.g., "anthropics")
  repo: string; // Repository name (e.g., "skills")
  branch: string; // Branch name (e.g., "main")
  path: string; // Directory path (e.g., "skills")
}

/**
 * GitHub API response for directory contents
 */
interface GitHubContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string | null;
  type: 'file' | 'dir';
}

/**
 * Information about a skill discovered on GitHub
 */
export interface GitHubSkillInfo {
  directoryName: string;
  skillName: string;
  description: string;
  author: string; // Repository owner
  repoUrl: string; // Repository URL
  hasSkillMd: boolean;
  hasReferencesDir: boolean;
  hasScriptsDir: boolean;
  hasAssetsDir: boolean;
  files: Array<{
    path: string; // Relative path within skill directory
    downloadUrl: string;
    type: 'file' | 'dir';
  }>;
  isValid: boolean;
  error?: string;
  // Internal: path to cloned directory (used when imported via git clone)
  _clonedPath?: string;
}

/**
 * GitHub Skills Importer Service
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Utility class for GitHub skill operations
export class GitHubImporter {
  /**
   * Parse GitHub URL to extract repository information
   *
   * Supported formats:
   * - https://github.com/owner/repo/tree/branch/path
   * - https://github.com/owner/repo/blob/branch/path
   * - https://api.github.com/repos/owner/repo/contents/path?ref=branch
   */
  static parseGitHubUrl(url: string): GitHubRepoInfo | null {
    try {
      const urlObj = new URL(url);

      // Handle API URL format
      if (urlObj.hostname === 'api.github.com') {
        // https://api.github.com/repos/owner/repo/contents/path?ref=branch
        const pathMatch = urlObj.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.*)$/);
        if (pathMatch) {
          const [, owner, repo, path] = pathMatch;
          const branch = urlObj.searchParams.get('ref') || 'main';
          return { owner: owner!, repo: repo!, branch, path: path || '' };
        }
      }

      // Handle standard GitHub URL format
      if (urlObj.hostname === 'github.com') {
        // https://github.com/owner/repo/tree/branch/path
        // https://github.com/owner/repo/blob/branch/path
        const pathMatch = urlObj.pathname.match(/^\/([^/]+)\/([^/]+)\/(tree|blob)\/([^/]+)\/(.*)$/);
        if (pathMatch) {
          const [, owner, repo, , branch, path] = pathMatch;
          return { owner: owner!, repo: repo!, branch: branch!, path: path || '' };
        }

        // https://github.com/owner/repo (default to main branch, root path)
        const simpleMatch = urlObj.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
        if (simpleMatch) {
          const [, owner, repo] = simpleMatch;
          return { owner: owner!, repo: repo!, branch: 'main', path: '' };
        }
      }

      return null;
    } catch (error) {
      logger.error('Failed to parse GitHub URL:', error);
      return null;
    }
  }

  /**
   * Check if git is available on the system
   */
  static async isGitAvailable(): Promise<boolean> {
    try {
      const result = await Command.create('git', ['--version']).execute();
      return result.code === 0;
    } catch (error) {
      logger.warn('Git not found:', error);
      return false;
    }
  }

  /**
   * Fetch directory contents from GitHub API
   * If rate limit is hit, automatically falls back to Git Clone method
   */
  static async fetchDirectoryContents(info: GitHubRepoInfo): Promise<GitHubContent[]> {
    const apiUrl = `https://api.github.com/repos/${info.owner}/${info.repo}/contents/${info.path}?ref=${info.branch}`;

    logger.info(`Fetching directory contents: ${apiUrl}`);

    const response = await fetch(apiUrl, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Repository or path not found');
      }
      if (response.status === 403) {
        const resetTime = response.headers.get('X-RateLimit-Reset');
        const resetDate = resetTime ? new Date(Number.parseInt(resetTime, 10) * 1000) : null;
        const rateLimitError = new Error(
          `GitHub API rate limit exceeded. ${resetDate ? `Resets at ${resetDate.toLocaleString()}` : 'Please try again later.'}`
        );
        // Mark this as a rate limit error for fallback handling
        (rateLimitError as Error & { isRateLimit: boolean }).isRateLimit = true;
        throw rateLimitError;
      }
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // GitHub API returns an array for directories, single object for files
    if (!Array.isArray(data)) {
      throw new Error('The URL does not point to a directory');
    }

    return data as GitHubContent[];
  }

  /**
   * Fetch file content from GitHub
   */
  static async fetchFileContent(downloadUrl: string): Promise<string> {
    const response = await fetch(downloadUrl);

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }

    return await response.text();
  }

  /**
   * Clone a GitHub repository using git sparse-checkout
   * This is used as a fallback when API rate limit is exceeded
   */
  static async cloneWithSparseCheckout(
    repoInfo: GitHubRepoInfo,
    targetPath: string
  ): Promise<void> {
    const repoUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}.git`;

    logger.info('Cloning repository with sparse checkout', {
      repo: repoUrl,
      branch: repoInfo.branch,
      path: repoInfo.path,
      targetPath,
    });

    try {
      // Validate repository info to prevent command injection
      if (!repoInfo.owner.match(/^[a-zA-Z0-9_-]+$/)) {
        throw new Error(`Invalid repository owner: ${repoInfo.owner}`);
      }
      if (!repoInfo.repo.match(/^[a-zA-Z0-9_.-]+$/)) {
        throw new Error(`Invalid repository name: ${repoInfo.repo}`);
      }
      if (!repoInfo.branch.match(/^[a-zA-Z0-9_/.-]+$/)) {
        throw new Error(`Invalid branch name: ${repoInfo.branch}`);
      }

      // Initialize git repository (use direct git commands, no shell)
      await Command.create('git', ['init'], { cwd: targetPath }).execute();

      // Add remote
      await Command.create('git', ['remote', 'add', 'origin', repoUrl], {
        cwd: targetPath,
      }).execute();

      // Enable sparse checkout
      await Command.create('git', ['config', 'core.sparseCheckout', 'true'], {
        cwd: targetPath,
      }).execute();

      // Set sparse checkout path (write to file directly)
      const sparseCheckoutPath = repoInfo.path ? `${repoInfo.path}/*` : '*';
      const sparseCheckoutFile = await join(targetPath, '.git/info/sparse-checkout');
      await writeTextFile(sparseCheckoutFile, `${sparseCheckoutPath}\n`);

      // Pull the specified branch
      const pullResult = await Command.create(
        'git',
        ['pull', '--depth=1', 'origin', repoInfo.branch],
        { cwd: targetPath }
      ).execute();

      if (pullResult.code !== 0) {
        throw new Error(`Git pull failed: ${pullResult.stderr}`);
      }

      logger.info('Successfully cloned repository with sparse checkout');
    } catch (error) {
      logger.error('Failed to clone repository:', error);
      throw new Error(`Failed to clone repository: ${error}`);
    }
  }

  /**
   * Scan a GitHub directory for skills using git clone (fallback method)
   * Note: Skills discovered this way will have _clonedPath set, and cleanup is caller's responsibility
   */
  static async scanGitHubDirectoryWithGit(repoInfo: GitHubRepoInfo): Promise<{
    skills: GitHubSkillInfo[];
    tempClonePath: string;
  }> {
    const skills: GitHubSkillInfo[] = [];

    // Create temporary directory for cloning
    const agentSkillService = await getAgentSkillService();
    const skillsDir = await agentSkillService.getSkillsDirPath();
    const tempClonePath = await join(skillsDir, `.temp-clone-${Date.now()}`);

    try {
      // Create temp directory
      await mkdir(tempClonePath, { recursive: true });

      // Clone repository
      await GitHubImporter.cloneWithSparseCheckout(repoInfo, tempClonePath);

      // Determine the path to scan
      const scanPath = repoInfo.path ? await join(tempClonePath, repoInfo.path) : tempClonePath;

      // Check if path exists
      if (!(await exists(scanPath))) {
        throw new Error(`Path not found after cloning: ${repoInfo.path}`);
      }

      // Check if this is a single skill directory (has SKILL.md)
      const skillMdPath = await join(scanPath, 'SKILL.md');
      const hasSkillMd = await exists(skillMdPath);

      if (hasSkillMd) {
        // Single skill mode - treat this directory as a skill
        logger.info('Detected single skill directory');

        const directoryName = repoInfo.path.split('/').pop() || 'skill';
        const skillInfo = await GitHubImporter.inspectLocalSkillDirectory(
          repoInfo,
          directoryName,
          scanPath
        );

        if (skillInfo.isValid) {
          // Store the cloned path for later import
          skillInfo._clonedPath = scanPath;
          skills.push(skillInfo);
        }
      } else {
        // Batch mode: scan subdirectories
        logger.info('Detected skills directory (batch mode)');

        // Read directory contents
        const entries = await readDir(scanPath);

        // Filter directories
        const directories = entries.filter((entry) => entry.isDirectory);

        logger.info(`Found ${directories.length} directories to scan`);

        // Scan each directory for skill structure
        for (const dir of directories) {
          try {
            const skillDirPath = await join(scanPath, dir.name);
            const skillInfo = await GitHubImporter.inspectLocalSkillDirectory(
              repoInfo,
              dir.name,
              skillDirPath
            );
            if (skillInfo.isValid) {
              // Store the cloned path for later import
              skillInfo._clonedPath = skillDirPath;
              skills.push(skillInfo);
            }
          } catch (error) {
            logger.warn(`Failed to inspect directory ${dir.name}:`, error);
          }
        }
      }

      return { skills, tempClonePath };
    } catch (error) {
      // Clean up on error
      try {
        const { remove } = await import('@tauri-apps/plugin-fs');
        await remove(tempClonePath, { recursive: true });
      } catch (cleanupError) {
        logger.warn('Failed to clean up temp directory after error:', cleanupError);
      }
      throw error;
    }
  }

  /**
   * Inspect a local skill directory (used after git clone)
   */
  static async inspectLocalSkillDirectory(
    repoInfo: GitHubRepoInfo,
    directoryName: string,
    skillDirPath: string
  ): Promise<GitHubSkillInfo> {
    const skillInfo: GitHubSkillInfo = {
      directoryName,
      skillName: '',
      description: '',
      author: repoInfo.owner,
      repoUrl: `https://github.com/${repoInfo.owner}/${repoInfo.repo}`,
      hasSkillMd: false,
      hasReferencesDir: false,
      hasScriptsDir: false,
      hasAssetsDir: false,
      files: [],
      isValid: false,
    };

    try {
      // Check for SKILL.md
      const skillMdPath = await join(skillDirPath, 'SKILL.md');
      if (!(await exists(skillMdPath))) {
        skillInfo.error = 'Missing SKILL.md';
        return skillInfo;
      }

      skillInfo.hasSkillMd = true;

      // Read and parse SKILL.md
      const skillMdContent = await readTextFile(skillMdPath);
      const parsed = SkillMdParser.parse(skillMdContent, { validate: true, logWarnings: false });

      skillInfo.skillName = parsed.frontmatter.name;
      skillInfo.description = parsed.frontmatter.description;

      // Check for optional directories
      const referencesPath = await join(skillDirPath, 'references');
      const scriptsPath = await join(skillDirPath, 'scripts');
      const assetsPath = await join(skillDirPath, 'assets');

      skillInfo.hasReferencesDir = await exists(referencesPath);
      skillInfo.hasScriptsDir = await exists(scriptsPath);
      skillInfo.hasAssetsDir = await exists(assetsPath);

      // Collect all files (we'll use the cloned files directly)
      skillInfo.files = await GitHubImporter.collectLocalFiles(skillDirPath, '');

      skillInfo.isValid = true;
    } catch (error) {
      skillInfo.error = `Failed to inspect skill: ${error}`;
      logger.warn(`Failed to inspect skill ${directoryName}:`, error);
    }

    return skillInfo;
  }

  /**
   * Recursively collect all files in a local directory
   */
  static async collectLocalFiles(
    basePath: string,
    relativePath: string
  ): Promise<Array<{ path: string; downloadUrl: string; type: 'file' | 'dir' }>> {
    const files: Array<{ path: string; downloadUrl: string; type: 'file' | 'dir' }> = [];
    const currentPath = relativePath ? await join(basePath, relativePath) : basePath;

    try {
      const entries = await readDir(currentPath);

      for (const entry of entries) {
        // Skip .git directory
        if (entry.name === '.git') continue;

        const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isFile) {
          files.push({
            path: entryRelativePath,
            downloadUrl: '', // We'll use local file path instead
            type: 'file',
          });
        } else if (entry.isDirectory) {
          const subFiles = await GitHubImporter.collectLocalFiles(basePath, entryRelativePath);
          files.push(...subFiles);
        }
      }
    } catch (error) {
      logger.warn(`Failed to read directory ${currentPath}:`, error);
    }

    return files;
  }

  /**
   * Scan a GitHub directory for skills
   * Automatically falls back to git clone if API rate limit is hit
   *
   * Returns both skills and optional tempClonePath that caller must clean up
   */
  static async scanGitHubDirectory(repoInfo: GitHubRepoInfo): Promise<{
    skills: GitHubSkillInfo[];
    tempClonePath?: string;
  }> {
    const skills: GitHubSkillInfo[] = [];

    try {
      const contents = await GitHubImporter.fetchDirectoryContents(repoInfo);

      // Check if this is a single skill directory (has SKILL.md)
      const hasSkillMd = contents.some((item) => item.name === 'SKILL.md' && item.type === 'file');

      if (hasSkillMd) {
        // Single skill mode - treat this directory as a skill
        logger.info('Detected single skill directory');

        const skillMdFile = contents.find(
          (item) => item.name === 'SKILL.md' && item.type === 'file'
        );
        if (!skillMdFile?.download_url) {
          throw new Error('SKILL.md file not found');
        }

        // Parse SKILL.md to get skill info
        const skillMdContent = await GitHubImporter.fetchFileContent(skillMdFile.download_url);
        const parsed = SkillMdParser.parse(skillMdContent, { validate: true, logWarnings: false });

        // Get directory name from path
        const directoryName = repoInfo.path.split('/').pop() || 'skill';

        const skillInfo: GitHubSkillInfo = {
          directoryName,
          skillName: parsed.frontmatter.name,
          description: parsed.frontmatter.description,
          author: repoInfo.owner,
          repoUrl: `https://github.com/${repoInfo.owner}/${repoInfo.repo}`,
          hasSkillMd: true,
          hasReferencesDir: contents.some(
            (item) => item.name === 'references' && item.type === 'dir'
          ),
          hasScriptsDir: contents.some((item) => item.name === 'scripts' && item.type === 'dir'),
          hasAssetsDir: contents.some((item) => item.name === 'assets' && item.type === 'dir'),
          files: await GitHubImporter.collectSkillFiles(repoInfo, contents),
          isValid: true,
        };

        skills.push(skillInfo);
      } else {
        // Batch mode: scan subdirectories
        logger.info('Detected skills directory (batch mode)');

        // Filter to only directories (potential skill directories)
        const directories = contents.filter((item) => item.type === 'dir');

        logger.info(`Found ${directories.length} directories to scan`);

        // Scan each directory for skill structure
        for (const dir of directories) {
          try {
            const skillInfo = await GitHubImporter.inspectGitHubSkill(repoInfo, dir);
            if (skillInfo.isValid) {
              skills.push(skillInfo);
            }
          } catch (error) {
            logger.warn(`Failed to inspect directory ${dir.name}:`, error);
          }
        }
      }

      return { skills };
    } catch (error) {
      // Check if this is a rate limit error
      const isRateLimit = (error as Error & { isRateLimit?: boolean }).isRateLimit;

      if (isRateLimit) {
        logger.warn('GitHub API rate limit exceeded, falling back to git clone method');

        // Check if git is available
        const gitAvailable = await GitHubImporter.isGitAvailable();
        if (!gitAvailable) {
          throw new Error(
            'GitHub API rate limit exceeded and git is not available. Please install git or wait for rate limit to reset.'
          );
        }

        // Fallback to git clone method
        logger.info('Using git clone method to fetch skills');
        return await GitHubImporter.scanGitHubDirectoryWithGit(repoInfo);
      }

      logger.error(`Failed to scan GitHub directory:`, error);
      throw error;
    }
  }

  /**
   * Inspect a potential skill directory on GitHub
   */
  static async inspectGitHubSkill(
    repoInfo: GitHubRepoInfo,
    directory: GitHubContent
  ): Promise<GitHubSkillInfo> {
    const skillInfo: GitHubSkillInfo = {
      directoryName: directory.name,
      skillName: '',
      description: '',
      author: repoInfo.owner,
      repoUrl: `https://github.com/${repoInfo.owner}/${repoInfo.repo}`,
      hasSkillMd: false,
      hasReferencesDir: false,
      hasScriptsDir: false,
      hasAssetsDir: false,
      files: [],
      isValid: false,
    };

    try {
      // Fetch directory contents
      const skillPath = repoInfo.path ? `${repoInfo.path}/${directory.name}` : directory.name;
      const skillDirInfo: GitHubRepoInfo = {
        ...repoInfo,
        path: skillPath,
      };

      const contents = await GitHubImporter.fetchDirectoryContents(skillDirInfo);

      // Check for SKILL.md (required)
      const skillMdFile = contents.find((item) => item.name === 'SKILL.md' && item.type === 'file');

      if (!skillMdFile || !skillMdFile.download_url) {
        skillInfo.error = 'Missing SKILL.md';
        return skillInfo;
      }

      skillInfo.hasSkillMd = true;

      // Download and parse SKILL.md to get name and description
      const skillMdContent = await GitHubImporter.fetchFileContent(skillMdFile.download_url);
      const parsed = SkillMdParser.parse(skillMdContent, { validate: true, logWarnings: false });

      skillInfo.skillName = parsed.frontmatter.name;
      skillInfo.description = parsed.frontmatter.description;

      // Check for optional directories
      skillInfo.hasReferencesDir = contents.some(
        (item) => item.name === 'references' && item.type === 'dir'
      );
      skillInfo.hasScriptsDir = contents.some(
        (item) => item.name === 'scripts' && item.type === 'dir'
      );
      skillInfo.hasAssetsDir = contents.some(
        (item) => item.name === 'assets' && item.type === 'dir'
      );

      // Collect all files for later download
      skillInfo.files = await GitHubImporter.collectSkillFiles(skillDirInfo, contents);

      skillInfo.isValid = true;
    } catch (error) {
      skillInfo.error = `Failed to inspect skill: ${error}`;
      logger.warn(`Failed to inspect skill ${directory.name}:`, error);
    }

    return skillInfo;
  }

  /**
   * Recursively collect all files in a skill directory
   */
  static async collectSkillFiles(
    repoInfo: GitHubRepoInfo,
    contents: GitHubContent[]
  ): Promise<Array<{ path: string; downloadUrl: string; type: 'file' | 'dir' }>> {
    const files: Array<{ path: string; downloadUrl: string; type: 'file' | 'dir' }> = [];

    for (const item of contents) {
      if (item.type === 'file' && item.download_url) {
        // Extract relative path (remove repo path prefix)
        const relativePath = item.path.split('/').slice(-1)[0] || item.name;
        files.push({
          path: relativePath,
          downloadUrl: item.download_url,
          type: 'file',
        });
      } else if (item.type === 'dir') {
        // Recursively fetch subdirectory contents
        try {
          const subDirInfo: GitHubRepoInfo = {
            ...repoInfo,
            path: item.path,
          };
          const subContents = await GitHubImporter.fetchDirectoryContents(subDirInfo);
          const subFiles = await GitHubImporter.collectSkillFiles(subDirInfo, subContents);

          // Prepend directory name to relative paths
          const dirName = item.name;
          for (const subFile of subFiles) {
            files.push({
              ...subFile,
              path: `${dirName}/${subFile.path}`,
            });
          }
        } catch (error) {
          logger.warn(`Failed to fetch subdirectory ${item.name}:`, error);
        }
      }
    }

    return files;
  }

  /**
   * Import a skill from a local cloned directory
   */
  static async importSkillFromLocalDirectory(
    skillInfo: GitHubSkillInfo,
    sourcePath: string
  ): Promise<void> {
    const agentSkillService = await getAgentSkillService();
    const skillsDir = await agentSkillService.getSkillsDirPath();
    const skillPath = await join(skillsDir, skillInfo.directoryName);

    // Check if skill already exists
    if (await exists(skillPath)) {
      throw new Error(`Skill "${skillInfo.skillName}" already exists`);
    }

    // Create skill directory
    await mkdir(skillPath, { recursive: true });

    logger.info(`Importing skill ${skillInfo.skillName} from local directory ${sourcePath}`);

    // Copy all files
    for (const file of skillInfo.files) {
      try {
        const sourceFilePath = await join(sourcePath, file.path);
        const targetFilePath = await join(skillPath, file.path);

        // Create parent directories if needed (use cross-platform dirname)
        const parentDir = await dirname(targetFilePath);
        if (!(await exists(parentDir))) {
          await mkdir(parentDir, { recursive: true });
        }

        // Special handling for SKILL.md - add author metadata
        if (file.path === 'SKILL.md') {
          const content = await readTextFile(sourceFilePath);
          const parsed = SkillMdParser.parse(content);
          const enhancedFrontmatter = {
            ...parsed.frontmatter,
            metadata: {
              ...parsed.frontmatter.metadata,
              author: skillInfo.author,
              source: 'github',
              importedFrom: skillInfo.repoUrl,
              importedAt: new Date().toISOString(),
            },
          };
          const enhancedContent = SkillMdParser.generate(enhancedFrontmatter, parsed.content);
          await writeTextFile(targetFilePath, enhancedContent);
        } else {
          // For other files, use binary copy to preserve binary assets
          const bytes = await readFile(sourceFilePath);
          await writeFile(targetFilePath, bytes);
        }

        logger.info(`Copied ${file.path}`);
      } catch (error) {
        logger.error(`Failed to copy ${file.path}:`, error);
        throw new Error(`Failed to copy file ${file.path}: ${error}`);
      }
    }

    logger.info(`Successfully imported skill ${skillInfo.skillName}`);
  }

  /**
   * Import a single skill from GitHub
   */
  static async importSkillFromGitHub(skillInfo: GitHubSkillInfo): Promise<void> {
    const agentSkillService = await getAgentSkillService();
    const skillsDir = await agentSkillService.getSkillsDirPath();
    const skillPath = await join(skillsDir, skillInfo.directoryName);

    // Check if skill already exists
    if (await exists(skillPath)) {
      throw new Error(`Skill "${skillInfo.skillName}" already exists`);
    }

    // Create skill directory
    await mkdir(skillPath, { recursive: true });

    logger.info(`Importing skill ${skillInfo.skillName} to ${skillPath}`);

    // Download all files
    for (const file of skillInfo.files) {
      try {
        const filePath = await join(skillPath, file.path);

        // Create parent directories if needed (use cross-platform dirname)
        const parentDir = await dirname(filePath);
        if (!(await exists(parentDir))) {
          await mkdir(parentDir, { recursive: true });
        }

        // Special handling for SKILL.md - add author metadata
        if (file.path === 'SKILL.md') {
          const content = await GitHubImporter.fetchFileContent(file.downloadUrl);
          const parsed = SkillMdParser.parse(content);
          const enhancedFrontmatter = {
            ...parsed.frontmatter,
            metadata: {
              ...parsed.frontmatter.metadata,
              author: skillInfo.author,
              source: 'github',
              importedFrom: skillInfo.repoUrl,
              importedAt: new Date().toISOString(),
            },
          };
          const enhancedContent = SkillMdParser.generate(enhancedFrontmatter, parsed.content);
          await writeTextFile(filePath, enhancedContent);
        } else {
          // For other files, download as binary to preserve binary assets (images, etc.)
          const response = await fetch(file.downloadUrl);
          if (!response.ok) {
            throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          await writeFile(filePath, bytes);
        }

        logger.info(`Downloaded ${file.path}`);
      } catch (error) {
        logger.error(`Failed to download ${file.path}:`, error);
        throw new Error(`Failed to download file ${file.path}: ${error}`);
      }
    }

    logger.info(`Successfully imported skill ${skillInfo.skillName}`);
  }

  /**
   * Import multiple skills from GitHub
   * @param skills Skills to import
   * @param tempClonePath Optional temporary clone path to clean up after import
   */
  static async importMultipleSkills(
    skills: GitHubSkillInfo[],
    tempClonePath?: string
  ): Promise<{ succeeded: string[]; failed: Array<{ name: string; error: string }> }> {
    const succeeded: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];

    try {
      for (const skill of skills) {
        try {
          // Check if this skill was from git clone (has _clonedPath)
          if (skill._clonedPath) {
            await GitHubImporter.importSkillFromLocalDirectory(skill, skill._clonedPath);
          } else {
            await GitHubImporter.importSkillFromGitHub(skill);
          }
          succeeded.push(skill.skillName);
        } catch (error) {
          logger.error(`Failed to import skill ${skill.skillName}:`, error);
          failed.push({
            name: skill.skillName,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      // Clean up temp clone directory if provided
      if (tempClonePath) {
        try {
          const { remove } = await import('@tauri-apps/plugin-fs');
          await remove(tempClonePath, { recursive: true });
          logger.info('Cleaned up temporary clone directory');
        } catch (error) {
          logger.warn('Failed to clean up temp directory:', error);
        }
      }
    }

    return { succeeded, failed };
  }
}
