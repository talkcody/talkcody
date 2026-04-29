/**
 * Agent Skill Service
 *
 * Manages skills according to Agent Skills Specification
 * https://agentskills.io/specification
 */

import {
  appDataDir,
  basename,
  dirname,
  homeDir,
  isAbsolute,
  join,
  normalize,
} from '@tauri-apps/api/path';
import {
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  writeFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { logger } from '@/lib/logger';
import type {
  AgentSkill,
  AgentSkillDirectory,
  AgentSkillFrontmatter,
  CreateSkillParams,
  UpdateSkillParams,
} from '@/types/agent-skills-spec';
import { AgentSkillValidator } from './agent-skill-validator';
import { ClaudeCodeImporter } from './claude-code-importer';
import { SkillMdParser } from './skill-md-parser';

/**
 * AgentSkillService
 *
 * Manages skills stored in the file system per Agent Skills Specification
 */
export class AgentSkillService {
  private skillsDir: string | null = null;

  /**
   * Initialize the service and ensure skills directory exists
   */
  async initialize(): Promise<void> {
    const appData = await appDataDir();
    this.skillsDir = await join(appData, 'skills');

    if (!(await exists(this.skillsDir))) {
      await mkdir(this.skillsDir, { recursive: true });
      logger.info(`Created skills directory: ${this.skillsDir}`);
    }
  }

  /**
   * Get the skills directory path
   */
  private async getSkillsDir(): Promise<string> {
    if (!this.skillsDir) {
      await this.initialize();
    }
    return this.skillsDir!;
  }

  /**
   * Get the home skills directory path
   */
  private async getHomeSkillsDir(): Promise<string> {
    const home = await homeDir();
    return await join(home, '.talkcody', 'skills');
  }

  /**
   * Get the skills directory path (public)
   */
  async getSkillsDirPath(): Promise<string> {
    return await this.getSkillsDir();
  }

  /**
   * Get the home skills directory path (public)
   */
  async getHomeSkillsDirPath(): Promise<string> {
    return await this.getHomeSkillsDir();
  }

  /**
   * Ensure home skills directory exists and return its path
   */
  async ensureHomeSkillsDirExists(): Promise<string> {
    const homeDirPath = await this.getHomeSkillsDir();
    if (!(await exists(homeDirPath))) {
      await mkdir(homeDirPath, { recursive: true });
      logger.info(`Created home skills directory: ${homeDirPath}`);
    }
    return homeDirPath;
  }

  /**
   * List all skills (with concurrent loading for better performance)
   */
  async listSkills(): Promise<AgentSkill[]> {
    const skillRoots = await this.getAllSkillRoots();
    const skillEntries = await this.listSkillEntries(skillRoots);

    // Concurrent loading: Load all skills in parallel
    const loadPromises = skillEntries.map((entry) =>
      this.loadSkill(entry.name, entry.baseDir).catch((error) => {
        logger.warn(`Failed to load skill ${entry.name}:`, error);
        return null;
      })
    );

    const loadedSkills = await Promise.all(loadPromises);

    // Filter out null values (failed loads)
    const skills = loadedSkills.filter((skill): skill is AgentSkill => skill !== null);

    logger.info(`Loaded ${skills.length} skills (${loadedSkills.length - skills.length} failed)`);

    return this.dedupeSkills(skills);
  }

  /**
   * Load a skill by directory name
   */
  async loadSkill(directoryName: string, baseDir?: string): Promise<AgentSkill | null> {
    const skillsDir = baseDir ?? (await this.getSkillsDir());
    const skillPath = await join(skillsDir, directoryName);

    if (!(await exists(skillPath))) {
      return null;
    }

    // Read SKILL.md
    const skillMdPath = await join(skillPath, 'SKILL.md');
    if (!(await exists(skillMdPath))) {
      logger.warn(`Skill directory ${directoryName} missing SKILL.md`);
      return null;
    }

    const skillMdContent = await readTextFile(skillMdPath);
    const parsed = SkillMdParser.parse(skillMdContent, { validate: true, logWarnings: true });

    // Validate directory name matches skill name
    const nameErrors = AgentSkillValidator.validateDirectoryMatch(
      directoryName,
      parsed.frontmatter.name
    );
    if (nameErrors.length > 0) {
      logger.error(`Skill ${directoryName} name mismatch:`, nameErrors);
      return null;
    }

    // Scan directory structure
    const directory = await this.scanDirectory(skillPath, directoryName);

    return {
      name: parsed.frontmatter.name,
      path: skillPath,
      frontmatter: parsed.frontmatter,
      content: parsed.content,
      directory,
    };
  }

  /**
   * Get skill by name, searching app data first and then discovered external roots.
   */
  async getSkillByName(name: string): Promise<AgentSkill | null> {
    const normalizedName = AgentSkillValidator.normalizeName(name);
    const skillRoots = await this.getAllSkillRoots();

    for (const baseDir of skillRoots) {
      const skill = await this.loadSkill(normalizedName, baseDir);
      if (skill) {
        return skill;
      }
    }

    return null;
  }

  /**
   * Load a skill by its absolute directory path.
   */
  async loadSkillByPath(skillPath: string): Promise<AgentSkill | null> {
    const normalizedSkillPath = await normalize(skillPath);
    if (!(await exists(normalizedSkillPath))) {
      return null;
    }

    const directoryName = await basename(normalizedSkillPath);
    const baseDir = await dirname(normalizedSkillPath);
    return await this.loadSkill(directoryName, baseDir);
  }

  private async getAllSkillRoots(): Promise<string[]> {
    const roots = [await this.getSkillsDir()];
    const claudeDirs = await ClaudeCodeImporter.getClaudeCodeSkillDirs();

    for (const directory of claudeDirs) {
      roots.push(directory.path);
    }

    const seen = new Set<string>();
    const dedupedRoots: string[] = [];

    for (const root of roots) {
      const normalizedRoot = await normalize(root);
      if (seen.has(normalizedRoot)) {
        continue;
      }
      seen.add(normalizedRoot);
      dedupedRoots.push(root);
    }

    return dedupedRoots;
  }

  private async listSkillEntries(
    skillRoots: string[]
  ): Promise<Array<{ name: string; baseDir: string }>> {
    const allEntries = await Promise.all(
      skillRoots.map(async (baseDir) => {
        try {
          const entries = await readDir(baseDir);
          return entries
            .filter((entry) => entry.isDirectory)
            .map((entry) => ({ name: entry.name, baseDir }));
        } catch (error) {
          logger.warn(`Failed to read skills directory ${baseDir}:`, error);
          return [];
        }
      })
    );

    return allEntries.flat();
  }

  private async dedupeSkills(skills: AgentSkill[]): Promise<AgentSkill[]> {
    const seen = new Set<string>();
    const deduped: AgentSkill[] = [];

    for (const skill of skills) {
      const normalizedPath = await normalize(skill.path);
      const key = `${skill.name}:${normalizedPath}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      deduped.push(skill);
    }

    return deduped;
  }

  /**
   * Create a new skill
   */
  async createSkill(params: CreateSkillParams): Promise<AgentSkill> {
    const skillsDir = await this.getSkillsDir();

    // Normalize and validate name
    const normalizedName = AgentSkillValidator.normalizeName(params.name);
    const validation = AgentSkillValidator.validate({
      name: normalizedName,
      description: params.description,
      compatibility: params.compatibility,
    });

    if (!validation.valid) {
      const errors = validation.errors.map((e) => e.message).join(', ');
      throw new Error(`Invalid skill: ${errors}`);
    }

    const skillPath = await join(skillsDir, normalizedName);

    if (await exists(skillPath)) {
      throw new Error(`Skill ${normalizedName} already exists`);
    }

    // Create directory
    await mkdir(skillPath, { recursive: true });

    // Create SKILL.md
    const skillMdContent = SkillMdParser.create({
      name: normalizedName,
      description: params.description,
      content: params.content,
      license: params.license,
      compatibility: params.compatibility,
      metadata: params.metadata,
    });

    await writeTextFile(await join(skillPath, 'SKILL.md'), skillMdContent);

    logger.info(`Created skill: ${normalizedName} at ${skillPath}`);

    // Load and return
    const skill = await this.loadSkill(normalizedName);
    if (!skill) {
      throw new Error('Failed to load newly created skill');
    }

    return skill;
  }

  /**
   * Update a skill's SKILL.md
   */
  async updateSkill(
    skillName: string,
    updates: UpdateSkillParams,
    frontmatterOverride?: Partial<AgentSkillFrontmatter>,
    skillPath?: string
  ): Promise<void> {
    const skill = skillPath
      ? await this.loadSkillByPath(skillPath)
      : await this.getSkillByName(skillName);
    if (!skill) {
      throw new Error(`Skill ${skillName} not found`);
    }

    const frontmatter: AgentSkillFrontmatter = {
      ...skill.frontmatter,
      description: updates.description ?? skill.frontmatter.description,
      license: updates.license ?? skill.frontmatter.license,
      compatibility: updates.compatibility ?? skill.frontmatter.compatibility,
      metadata: updates.metadata ?? skill.frontmatter.metadata,
    };

    // Apply frontmatter overrides (prevent name changes)
    if (frontmatterOverride) {
      if (frontmatterOverride.name && frontmatterOverride.name !== skill.directory.name) {
        throw new Error(
          'Skill renaming is not allowed. The skill name must match the directory name. ' +
            'To rename a skill, delete and recreate it with the new name.'
        );
      }
    }

    const content = updates.content ?? skill.content;
    const skillMdContent = SkillMdParser.generate(frontmatter, content);

    await writeTextFile(await join(skill.path, 'SKILL.md'), skillMdContent);

    logger.info(`Updated skill: ${skill.name}`);
  }

  /**
   * Delete a skill
   */
  async deleteSkill(skillName: string, skillPath?: string): Promise<void> {
    const skill = skillPath
      ? await this.loadSkillByPath(skillPath)
      : await this.getSkillByName(skillName);

    if (!skill) {
      throw new Error(`Skill ${skillName} not found`);
    }

    await remove(skill.path, { recursive: true });
    logger.info(`Deleted skill: ${skill.name}`);
  }

  /**
   * Get reference file content
   */
  async getReference(skillName: string, referenceFile: string): Promise<string> {
    const skill = await this.loadSkill(skillName);
    if (!skill) {
      throw new Error(`Skill ${skillName} not found`);
    }

    // Validate filename to prevent path traversal
    await this.validateSafeFilename(referenceFile, 'reference file');

    const refPath = await join(skill.path, 'references', referenceFile);
    if (!(await exists(refPath))) {
      throw new Error(`Reference ${referenceFile} not found in skill ${skillName}`);
    }

    return await readTextFile(refPath);
  }

  /**
   * Get asset file path
   */
  async getAssetPath(skillName: string, assetFile: string): Promise<string> {
    const skill = await this.loadSkill(skillName);
    if (!skill) {
      throw new Error(`Skill ${skillName} not found`);
    }

    // Validate filename to prevent path traversal
    await this.validateSafeFilename(assetFile, 'asset file');

    const assetPath = await join(skill.path, 'assets', assetFile);
    if (!(await exists(assetPath))) {
      throw new Error(`Asset ${assetFile} not found in skill ${skillName}`);
    }

    return assetPath;
  }

  /**
   * Get script file path
   */
  async getScriptPath(skillName: string, scriptFile: string): Promise<string> {
    const skill = await this.loadSkill(skillName);
    if (!skill) {
      throw new Error(`Skill ${skillName} not found`);
    }

    // Validate filename to prevent path traversal
    await this.validateSafeFilename(scriptFile, 'script file');

    const scriptPath = await join(skill.path, 'scripts', scriptFile);
    if (!(await exists(scriptPath))) {
      throw new Error(`Script ${scriptFile} not found in skill ${skillName}`);
    }

    return scriptPath;
  }

  /**
   * Add a reference file to a skill
   */
  async addReference(skillName: string, referenceFile: string, content: string): Promise<void> {
    const skill = await this.loadSkill(skillName);
    if (!skill) {
      throw new Error(`Skill ${skillName} not found`);
    }

    // Validate filename to prevent path traversal
    await this.validateSafeFilename(referenceFile, 'reference file');

    const referencesDir = await join(skill.path, 'references');
    if (!(await exists(referencesDir))) {
      await mkdir(referencesDir, { recursive: true });
    }

    const refPath = await join(referencesDir, referenceFile);
    await writeTextFile(refPath, content);

    logger.info(`Added reference ${referenceFile} to skill ${skillName}`);
  }

  /**
   * Add an asset file to a skill
   */
  async addAsset(skillName: string, assetFile: string, content: Uint8Array): Promise<void> {
    const skill = await this.loadSkill(skillName);
    if (!skill) {
      throw new Error(`Skill ${skillName} not found`);
    }

    // Validate filename to prevent path traversal
    await this.validateSafeFilename(assetFile, 'asset file');

    const assetsDir = await join(skill.path, 'assets');
    if (!(await exists(assetsDir))) {
      await mkdir(assetsDir, { recursive: true });
    }

    const assetPath = await join(assetsDir, assetFile);
    await writeFile(assetPath, content);

    logger.info(`Added asset ${assetFile} to skill ${skillName}`);
  }

  /**
   * Add a script file to a skill
   */
  async addScript(skillName: string, scriptFile: string, content: string): Promise<void> {
    const skill = await this.loadSkill(skillName);
    if (!skill) {
      throw new Error(`Skill ${skillName} not found`);
    }

    // Validate filename to prevent path traversal
    await this.validateSafeFilename(scriptFile, 'script file');

    const scriptsDir = await join(skill.path, 'scripts');
    if (!(await exists(scriptsDir))) {
      await mkdir(scriptsDir, { recursive: true });
    }

    const scriptPath = await join(scriptsDir, scriptFile);
    await writeTextFile(scriptPath, content);

    logger.info(`Added script ${scriptFile} to skill ${skillName}`);
  }

  // ==================== Private Helper Methods ====================

  /**
   * Validate that a filename is safe (no path traversal)
   *
   * This prevents path traversal attacks by rejecting:
   * - Absolute paths
   * - Paths with '..' (parent directory)
   * - Paths with '/' or '\\' (directory separators)
   * - Empty or whitespace-only filenames
   */
  private async validateSafeFilename(filename: string, fileType: string): Promise<void> {
    // Trim whitespace
    const trimmed = filename.trim();

    if (!trimmed) {
      throw new Error(`${fileType} name cannot be empty`);
    }

    // Check for absolute paths
    if (await isAbsolute(trimmed)) {
      throw new Error(`${fileType} name cannot be an absolute path: ${filename}`);
    }

    // Normalize the path to detect traversal attempts
    const normalized = await normalize(trimmed);

    // Check for parent directory references
    if (normalized.includes('..')) {
      throw new Error(
        `${fileType} name cannot contain parent directory references (..): ${filename}`
      );
    }

    // Check for path separators (must be a single filename)
    if (trimmed.includes('/') || trimmed.includes('\\')) {
      throw new Error(`${fileType} name cannot contain path separators: ${filename}`);
    }

    // Additional safety: check for common suspicious patterns
    const suspiciousPatterns = ['./', '.\\', '~'];
    for (const pattern of suspiciousPatterns) {
      if (trimmed.includes(pattern)) {
        throw new Error(`${fileType} name contains suspicious pattern: ${filename}`);
      }
    }
  }

  /**
   * Scan skill directory structure
   */
  private async scanDirectory(
    skillPath: string,
    directoryName: string
  ): Promise<AgentSkillDirectory> {
    const scriptsDir = await join(skillPath, 'scripts');
    const referencesDir = await join(skillPath, 'references');
    const assetsDir = await join(skillPath, 'assets');

    const directory: AgentSkillDirectory = {
      name: directoryName,
      path: skillPath,
      hasSkillMd: true, // Already validated
      hasScriptsDir: await exists(scriptsDir),
      hasReferencesDir: await exists(referencesDir),
      hasAssetsDir: await exists(assetsDir),
      scriptFiles: [],
      referenceFiles: [],
      assetFiles: [],
    };

    if (directory.hasScriptsDir) {
      directory.scriptFiles = await this.listFiles(scriptsDir);
    }

    if (directory.hasReferencesDir) {
      directory.referenceFiles = await this.listFiles(referencesDir);
    }

    if (directory.hasAssetsDir) {
      directory.assetFiles = await this.listFiles(assetsDir);
    }

    return directory;
  }

  /**
   * List files in a directory
   */
  private async listFiles(dirPath: string): Promise<string[]> {
    try {
      const entries = await readDir(dirPath);
      return entries.filter((e) => e.isFile).map((e) => e.name);
    } catch (error) {
      logger.warn(`Failed to list files in ${dirPath}:`, error);
      return [];
    }
  }
}

// Singleton instance
let instance: AgentSkillService | null = null;

/**
 * Get the AgentSkillService singleton instance
 */
export async function getAgentSkillService(): Promise<AgentSkillService> {
  if (!instance) {
    instance = new AgentSkillService();
    await instance.initialize();
  }
  return instance;
}
