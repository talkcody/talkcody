/**
 * Tests for GitHub Importer API Rate Limit Fallback to Git Clone
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubImporter } from './github-importer';

// Mock Tauri APIs
vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: {
    create: vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue({ code: 0, stdout: 'git version 2.39.0', stderr: '' }),
    }),
  },
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn().mockResolvedValue(true),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readDir: vi.fn().mockResolvedValue([]),
  readTextFile: vi.fn().mockResolvedValue(''),
  readFile: vi.fn().mockResolvedValue(new Uint8Array()),
  remove: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
  dirname: vi.fn((path: string) => Promise.resolve(path.split('/').slice(0, -1).join('/'))),
}));

vi.mock('./agent-skill-service', () => ({
  getAgentSkillService: vi.fn().mockResolvedValue({
    getSkillsDirPath: vi.fn().mockResolvedValue('/mock/skills'),
  }),
}));

vi.mock('./skill-md-parser', () => ({
  SkillMdParser: {
    parse: vi.fn().mockReturnValue({
      frontmatter: {
        name: 'Test Skill',
        description: 'A test skill',
        metadata: {},
      },
      content: 'Test content',
    }),
    generate: vi.fn((frontmatter, content) => `---\nname: ${frontmatter.name}\n---\n${content}`),
  },
}));

describe('GitHubImporter Fallback Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  describe('isGitAvailable', () => {
    it('should return true when git is available', async () => {
      const { Command } = await import('@tauri-apps/plugin-shell');
      vi.mocked(Command.create).mockReturnValueOnce({
        execute: vi.fn().mockResolvedValue({ code: 0, stdout: 'git version 2.39.0', stderr: '' }),
      } as never);

      const result = await GitHubImporter.isGitAvailable();
      expect(result).toBe(true);
    });

    it('should return false when git is not available', async () => {
      const { Command } = await import('@tauri-apps/plugin-shell');
      vi.mocked(Command.create).mockReturnValueOnce({
        execute: vi.fn().mockRejectedValue(new Error('git not found')),
      } as never);

      const result = await GitHubImporter.isGitAvailable();
      expect(result).toBe(false);
    });

    it('should use direct git command without shell', async () => {
      const { Command } = await import('@tauri-apps/plugin-shell');
      const createSpy = vi.mocked(Command.create);
      createSpy.mockReturnValueOnce({
        execute: vi.fn().mockResolvedValue({ code: 0, stdout: 'git version 2.39.0', stderr: '' }),
      } as never);

      await GitHubImporter.isGitAvailable();

      // Should call git directly, not via exec-sh
      expect(createSpy).toHaveBeenCalledWith('git', ['--version']);
      expect(createSpy).not.toHaveBeenCalledWith('exec-sh', expect.anything());
    });
  });

  describe('fetchDirectoryContents - Rate Limit Handling', () => {
    it('should mark rate limit errors with isRateLimit flag', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
        }),
      } as Response);

      const repoInfo = {
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'skills',
      };

      try {
        await GitHubImporter.fetchDirectoryContents(repoInfo);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error & { isRateLimit?: boolean }).isRateLimit).toBe(true);
        expect((error as Error).message).toContain('GitHub API rate limit exceeded');
      }
    });

    it('should not mark non-rate-limit errors with isRateLimit flag', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      const repoInfo = {
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'skills',
      };

      try {
        await GitHubImporter.fetchDirectoryContents(repoInfo);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error & { isRateLimit?: boolean }).isRateLimit).toBeUndefined();
        expect((error as Error).message).toContain('Repository or path not found');
      }
    });
  });

  describe('scanGitHubDirectory - Fallback Logic', () => {
    it('should use API method when successful', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([
          {
            name: 'skill1',
            type: 'dir',
            path: 'skills/skill1',
          },
        ]),
      } as unknown as Response);

      // Mock the skill inspection
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([
          {
            name: 'SKILL.md',
            type: 'file',
            download_url: 'https://example.com/skill.md',
          },
        ]),
      } as unknown as Response);

      // Mock SKILL.md download
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: vi.fn().mockResolvedValue('---\nname: Test Skill\ndescription: Test\n---'),
      } as unknown as Response);

      const repoInfo = {
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'skills',
      };

      const result = await GitHubImporter.scanGitHubDirectory(repoInfo);

      expect(result.skills).toBeDefined();
      expect(result.tempClonePath).toBeUndefined();
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should fallback to git clone when rate limit is hit', async () => {
      const mockFetch = vi.mocked(global.fetch);
      const rateLimitError = new Error('GitHub API rate limit exceeded') as Error & {
        isRateLimit: boolean;
      };
      rateLimitError.isRateLimit = true;

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
        }),
      } as Response);

      const { Command } = await import('@tauri-apps/plugin-shell');
      const { readDir, readTextFile } = await import('@tauri-apps/plugin-fs');

      // Mock git available
      vi.mocked(Command.create).mockReturnValueOnce({
        execute: vi.fn().mockResolvedValue({ code: 0, stdout: 'git version 2.39.0', stderr: '' }),
      } as never);

      // Mock git clone commands
      vi.mocked(Command.create).mockReturnValue({
        execute: vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' }),
      } as never);

      // Mock directory reading
      vi.mocked(readDir).mockResolvedValueOnce([
        { name: 'skill1', isDirectory: true, isFile: false, isSymlink: false },
      ] as never);

      // Mock SKILL.md reading
      vi.mocked(readTextFile).mockResolvedValueOnce(
        '---\nname: Test Skill\ndescription: A test skill\n---\nContent'
      );

      // Mock file collection
      vi.mocked(readDir).mockResolvedValueOnce([
        { name: 'SKILL.md', isFile: true, isDirectory: false, isSymlink: false },
      ] as never);

      const repoInfo = {
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'skills',
      };

      const result = await GitHubImporter.scanGitHubDirectory(repoInfo);

      expect(result.skills).toBeDefined();
      expect(result.tempClonePath).toBeDefined();
      expect(result.tempClonePath).toContain('.temp-clone-');
    });

    it('should validate repository info to prevent command injection', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
        }),
      } as Response);

      const { Command } = await import('@tauri-apps/plugin-shell');
      vi.mocked(Command.create).mockReturnValue({
        execute: vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' }),
      } as never);

      const repoInfo = {
        owner: 'valid-owner',
        repo: 'valid-repo',
        branch: 'main; rm -rf /', // Malicious branch name
        path: 'skills',
      };

      // Should reject invalid branch names
      await expect(GitHubImporter.scanGitHubDirectory(repoInfo)).rejects.toThrow(
        'Invalid branch name',
      );
    });

    it('should throw error when rate limit is hit and git is not available', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
        }),
      } as Response);

      const { Command } = await import('@tauri-apps/plugin-shell');

      // Mock git not available
      vi.mocked(Command.create).mockReturnValueOnce({
        execute: vi.fn().mockRejectedValue(new Error('git not found')),
      } as never);

      const repoInfo = {
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'skills',
      };

      try {
        await GitHubImporter.scanGitHubDirectory(repoInfo);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('git is not available');
      }
    });
  });

  describe('scanGitHubDirectory - Single Skill Mode', () => {
    it('should detect and import a single skill directory via API', async () => {
      const mockFetch = vi.mocked(global.fetch);
      const { SkillMdParser } = await import('./skill-md-parser');

      // Override the parser mock for this test
      vi.mocked(SkillMdParser.parse).mockReturnValueOnce({
        frontmatter: {
          name: 'Changelog Generator',
          description: 'Generate changelogs',
          metadata: {},
        },
        content: 'Test content',
      });

      // First request: fetch directory contents with SKILL.md
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([
          {
            name: 'SKILL.md',
            path: 'changelog-generator/SKILL.md',
            type: 'file',
            download_url: 'https://example.com/skill.md',
          },
          {
            name: 'references',
            path: 'changelog-generator/references',
            type: 'dir',
          },
        ]),
      } as unknown as Response);

      // Second request: download SKILL.md content
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: vi
          .fn()
          .mockResolvedValue('---\nname: Changelog Generator\ndescription: Generate changelogs\n---'),
      } as unknown as Response);

      const repoInfo = {
        owner: 'ComposioHQ',
        repo: 'awesome-claude-skills',
        branch: 'master',
        path: 'changelog-generator',
      };

      const result = await GitHubImporter.scanGitHubDirectory(repoInfo);

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0]?.skillName).toBe('Changelog Generator');
      expect(result.skills[0]?.directoryName).toBe('changelog-generator');
      expect(result.skills[0]?.hasSkillMd).toBe(true);
      expect(result.skills[0]?.hasReferencesDir).toBe(true);
      expect(result.skills[0]?.isValid).toBe(true);
      expect(result.tempClonePath).toBeUndefined();
    });

    it('should detect and import a single skill directory via git clone', async () => {
      const mockFetch = vi.mocked(global.fetch);
      const { SkillMdParser } = await import('./skill-md-parser');

      // Override the parser mock for this test
      vi.mocked(SkillMdParser.parse).mockReturnValueOnce({
        frontmatter: {
          name: 'Changelog Generator',
          description: 'Generate changelogs',
          metadata: {},
        },
        content: 'Test content',
      });

      // Mock rate limit error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
        }),
      } as Response);

      const { Command } = await import('@tauri-apps/plugin-shell');
      const { readDir, readTextFile, exists } = await import('@tauri-apps/plugin-fs');

      // Mock git available
      vi.mocked(Command.create).mockReturnValueOnce({
        execute: vi.fn().mockResolvedValue({ code: 0, stdout: 'git version 2.39.0', stderr: '' }),
      } as never);

      // Mock git clone commands
      vi.mocked(Command.create).mockReturnValue({
        execute: vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' }),
      } as never);

      // Mock exists checks in order:
      // 1. scanPath exists check
      // 2. SKILL.md exists check (for single skill mode detection)
      // 3. SKILL.md exists check again (for reading)
      // 4. references directory exists check
      // 5. scripts directory exists check
      // 6. assets directory exists check
      vi.mocked(exists)
        .mockResolvedValueOnce(true) // scanPath
        .mockResolvedValueOnce(true) // SKILL.md detection
        .mockResolvedValueOnce(true) // SKILL.md for reading
        .mockResolvedValueOnce(true) // references
        .mockResolvedValueOnce(false) // scripts
        .mockResolvedValueOnce(false); // assets

      // Mock SKILL.md reading
      vi.mocked(readTextFile).mockResolvedValueOnce(
        '---\nname: Changelog Generator\ndescription: Generate changelogs\n---\nContent'
      );

      // Mock file collection
      vi.mocked(readDir).mockResolvedValueOnce([
        { name: 'SKILL.md', isFile: true, isDirectory: false, isSymlink: false },
      ] as never);

      const repoInfo = {
        owner: 'ComposioHQ',
        repo: 'awesome-claude-skills',
        branch: 'master',
        path: 'changelog-generator',
      };

      const result = await GitHubImporter.scanGitHubDirectory(repoInfo);

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0]?.skillName).toBe('Changelog Generator');
      expect(result.skills[0]?.directoryName).toBe('changelog-generator');
      expect(result.skills[0]?.hasSkillMd).toBe(true);
      expect(result.skills[0]?.hasReferencesDir).toBe(true);
      expect(result.skills[0]?.isValid).toBe(true);
      expect(result.tempClonePath).toBeDefined();
      expect(result.tempClonePath).toContain('.temp-clone-');
    });

    it('should handle batch mode when directory has no SKILL.md', async () => {
      const mockFetch = vi.mocked(global.fetch);
      const { SkillMdParser } = await import('./skill-md-parser');

      // First request: fetch directory contents without SKILL.md (batch mode)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([
          {
            name: 'skill1',
            path: 'skills/skill1',
            type: 'dir',
          },
          {
            name: 'skill2',
            path: 'skills/skill2',
            type: 'dir',
          },
        ]),
      } as unknown as Response);

      // Mock skill1 inspection
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([
          {
            name: 'SKILL.md',
            path: 'skills/skill1/SKILL.md',
            type: 'file',
            download_url: 'https://example.com/skill1.md',
          },
        ]),
      } as unknown as Response);

      vi.mocked(SkillMdParser.parse).mockReturnValueOnce({
        frontmatter: {
          name: 'Skill 1',
          description: 'First skill',
          metadata: {},
        },
        content: 'Skill 1 content',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: vi.fn().mockResolvedValue('---\nname: Skill 1\ndescription: First skill\n---'),
      } as unknown as Response);

      // Mock skill2 inspection
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([
          {
            name: 'SKILL.md',
            path: 'skills/skill2/SKILL.md',
            type: 'file',
            download_url: 'https://example.com/skill2.md',
          },
        ]),
      } as unknown as Response);

      vi.mocked(SkillMdParser.parse).mockReturnValueOnce({
        frontmatter: {
          name: 'Skill 2',
          description: 'Second skill',
          metadata: {},
        },
        content: 'Skill 2 content',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: vi.fn().mockResolvedValue('---\nname: Skill 2\ndescription: Second skill\n---'),
      } as unknown as Response);

      const repoInfo = {
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'skills',
      };

      const result = await GitHubImporter.scanGitHubDirectory(repoInfo);

      expect(result.skills).toHaveLength(2);
      expect(result.skills[0]?.skillName).toBe('Skill 1');
      expect(result.skills[1]?.skillName).toBe('Skill 2');
      expect(result.tempClonePath).toBeUndefined();
    });
  });
});
