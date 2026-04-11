import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubImporter } from './github-importer';

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: {
    create: vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue({ code: 0, stdout: 'git version 2.39.0', stderr: '' }),
    }),
  },
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readDir: vi.fn(),
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
        name: 'test-skill',
        description: 'A test skill',
        metadata: {},
      },
      content: 'Test content',
    }),
    generate: vi.fn((frontmatter, content) => `---\nname: ${frontmatter.name}\n---\n${content}`),
  },
}));

describe('GitHubImporter local directory scan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats a selected skill directory as a single local skill', async () => {
    const { exists } = await import('@tauri-apps/plugin-fs');
    const inspectSpy = vi
      .spyOn(GitHubImporter, 'inspectLocalSkillDirectory')
      .mockResolvedValue({
        directoryName: 'demo-skill',
        skillName: 'demo-skill',
        description: 'Demo skill',
        author: 'local',
        repoUrl: '/Users/demo/demo-skill',
        importSource: 'github',
        importedFrom: '',
        hasSkillMd: true,
        hasReferencesDir: false,
        hasScriptsDir: false,
        hasAssetsDir: false,
        files: [],
        isValid: true,
      });

    vi.mocked(exists).mockImplementation(async (path: string) => path.endsWith('SKILL.md') || path === '/Users/demo/demo-skill');

    const result = await GitHubImporter.scanLocalDirectory('/Users/demo/demo-skill');

    expect(inspectSpy).toHaveBeenCalledWith(
      { owner: 'local', repo: 'local', branch: '', path: '' },
      'demo-skill',
      '/Users/demo/demo-skill'
    );
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toMatchObject({
      importSource: 'local',
      importedFrom: '/Users/demo/demo-skill',
      _clonedPath: '/Users/demo/demo-skill',
    });
  });

  it('scans child directories when a skills folder is selected', async () => {
    const { exists, readDir } = await import('@tauri-apps/plugin-fs');
    const inspectSpy = vi
      .spyOn(GitHubImporter, 'inspectLocalSkillDirectory')
      .mockResolvedValueOnce({
        directoryName: 'skill-one',
        skillName: 'skill-one',
        description: 'First skill',
        author: 'local',
        repoUrl: '/Users/demo/skills',
        importSource: 'github',
        importedFrom: '',
        hasSkillMd: true,
        hasReferencesDir: false,
        hasScriptsDir: false,
        hasAssetsDir: false,
        files: [],
        isValid: true,
      })
      .mockResolvedValueOnce({
        directoryName: 'skill-two',
        skillName: 'skill-two',
        description: 'Second skill',
        author: 'local',
        repoUrl: '/Users/demo/skills',
        importSource: 'github',
        importedFrom: '',
        hasSkillMd: true,
        hasReferencesDir: false,
        hasScriptsDir: false,
        hasAssetsDir: false,
        files: [],
        isValid: true,
      });

    vi.mocked(exists).mockImplementation(async (path: string) => path === '/Users/demo/skills');
    vi.mocked(readDir).mockResolvedValue([
      { name: 'skill-one', isDirectory: true, isFile: false },
      { name: 'skill-two', isDirectory: true, isFile: false },
    ] as never);

    const result = await GitHubImporter.scanLocalDirectory('/Users/demo/skills');

    expect(inspectSpy).toHaveBeenNthCalledWith(
      1,
      { owner: 'local', repo: 'local', branch: '', path: '' },
      'skill-one',
      '/Users/demo/skills/skill-one'
    );
    expect(inspectSpy).toHaveBeenNthCalledWith(
      2,
      { owner: 'local', repo: 'local', branch: '', path: '' },
      'skill-two',
      '/Users/demo/skills/skill-two'
    );
    expect(result.skills).toHaveLength(2);
    expect(result.skills[0]?.importedFrom).toBe('/Users/demo/skills/skill-one');
    expect(result.skills[1]?.importedFrom).toBe('/Users/demo/skills/skill-two');
  });
});
