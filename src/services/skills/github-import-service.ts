/**
 * GitHub Import Service
 * Wrapper for importing skills from GitHub using RemoteSkillConfig
 */

import { logger } from '@/lib/logger';
import type { GitHubSkillInfo } from './github-importer';
import { GitHubImporter } from './github-importer';

export interface ImportFromGitHubOptions {
  repository: string; // e.g., "talkcody/skills"
  path: string; // e.g., "skills/theme-factory"
  skillId: string; // Unique ID for the skill
  targetDir?: string; // Optional target directory for installed skills
}

/**
 * Import a skill from GitHub using simplified RemoteSkillConfig format
 */
export async function importSkillFromGitHub(options: ImportFromGitHubOptions): Promise<void> {
  const { repository, path, skillId, targetDir } = options;

  // Parse repository (format: "owner/repo")
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid repository format: ${repository}. Expected format: owner/repo`);
  }

  // Construct GitHub URL for discovering skills
  const branch = 'main'; // Default branch
  const githubUrl = `https://github.com/${repository}/tree/${branch}/${path}`;

  logger.info('Importing skill from GitHub:', {
    repository,
    path,
    skillId,
    githubUrl,
  });

  try {
    // Extract parent path and skill directory name
    const pathParts = path.split('/');
    const skillDirectoryName = pathParts.pop() || '';
    const parentPath = pathParts.join('/');

    // Construct repo info to scan the parent directory
    const repoInfo = {
      owner,
      repo,
      branch,
      path: parentPath,
    };

    // Scan the parent directory for skills
    const { skills, tempClonePath } = await GitHubImporter.scanGitHubDirectory(repoInfo, {
      targetSkillsDir: targetDir,
    });

    let skillInfo: GitHubSkillInfo | undefined;

    try {
      if (skills.length === 0) {
        throw new Error(`No valid skills found at ${githubUrl}`);
      }

      // Find the skill in the discovered list
      skillInfo = skills.find((s: GitHubSkillInfo) => s.directoryName === skillDirectoryName);

      // If not found in batch scan, try to fetch the specific skill directory directly
      // This handles cases where GitHub API pagination limits the batch scan results
      if (!skillInfo) {
        logger.info(`Skill ${skillDirectoryName} not found in batch scan, trying direct fetch...`);

        try {
          const directSkillPath = `${parentPath}/${skillDirectoryName}`;
          const directRepoInfo = {
            owner,
            repo,
            branch,
            path: directSkillPath,
          };

          // Try to fetch the specific skill directory contents
          const contents = await GitHubImporter.fetchDirectoryContents(directRepoInfo);

          // Check if this is a valid skill directory (has SKILL.md)
          const hasSkillMd = contents.some(
            (item) => item.name === 'SKILL.md' && item.type === 'file'
          );

          if (hasSkillMd) {
            // Extract directory info using inspectGitHubSkill logic
            const skillMdFile = contents.find(
              (item) => item.name === 'SKILL.md' && item.type === 'file'
            );

            if (skillMdFile?.download_url) {
              const skillMdContent = await GitHubImporter.fetchFileContent(
                skillMdFile.download_url
              );
              const { SkillMdParser } = await import('./skill-md-parser');
              const parsed = SkillMdParser.parse(skillMdContent, {
                validate: true,
                logWarnings: false,
              });

              skillInfo = {
                directoryName: skillDirectoryName,
                skillName: parsed.frontmatter.name,
                description: parsed.frontmatter.description,
                author: owner,
                repoUrl: `https://github.com/${owner}/${repo}`,
                hasSkillMd: true,
                hasReferencesDir: contents.some(
                  (item) => item.name === 'references' && item.type === 'dir'
                ),
                hasScriptsDir: contents.some(
                  (item) => item.name === 'scripts' && item.type === 'dir'
                ),
                hasAssetsDir: contents.some(
                  (item) => item.name === 'assets' && item.type === 'dir'
                ),
                files: await GitHubImporter.collectSkillFiles(directRepoInfo, contents),
                isValid: true,
              };

              logger.info(`Successfully found skill via direct fetch: ${skillDirectoryName}`);
            }
          }
        } catch (directFetchError) {
          logger.warn(`Direct fetch for ${skillDirectoryName} failed:`, directFetchError);
        }

        // If still not found after direct fetch, throw error
        if (!skillInfo) {
          throw new Error(
            `Skill not found at ${githubUrl}. Discovered skills: ${skills.map((s: GitHubSkillInfo) => s.directoryName).join(', ')}`
          );
        }
      }

      if (!skillInfo.isValid) {
        throw new Error(
          `Invalid skill at ${githubUrl}: ${skillInfo.error || 'Missing required files'}`
        );
      }

      // Import the skill (handles both API and git clone methods)
      if (skillInfo._clonedPath) {
        await GitHubImporter.importSkillFromLocalDirectory(
          skillInfo,
          skillInfo._clonedPath,
          targetDir
        );
      } else {
        await GitHubImporter.importSkillFromGitHub(skillInfo, targetDir);
      }
    } finally {
      // Clean up temp directory if it exists
      if (tempClonePath) {
        try {
          const { remove } = await import('@tauri-apps/plugin-fs');
          await remove(tempClonePath, { recursive: true });
          logger.info('Cleaned up temporary clone directory');
        } catch (cleanupError) {
          logger.warn('Failed to clean up temp directory:', cleanupError);
        }
      }
    }

    if (skillInfo) {
      logger.info('Successfully imported skill from GitHub:', {
        skillName: skillInfo.skillName,
        directoryName: skillInfo.directoryName,
      });
    }
  } catch (error) {
    logger.error('Failed to import skill from GitHub:', error);
    throw error;
  }
}
