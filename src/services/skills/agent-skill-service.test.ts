import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSkillService } from './agent-skill-service';

const mockExistingPaths = new Set<string>();
const mockTextFiles = new Map<string, string>();

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('/mock/app-data'),
  basename: vi.fn(async (filePath: string) => path.posix.basename(filePath)),
  dirname: vi.fn(async (filePath: string) => path.posix.dirname(filePath)),
  homeDir: vi.fn().mockResolvedValue('/mock/home'),
  isAbsolute: vi.fn(async (filePath: string) => path.isAbsolute(filePath)),
  join: vi.fn(async (...parts: string[]) => path.posix.join(...parts)),
  normalize: vi.fn(async (filePath: string) => path.posix.normalize(filePath)),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(async (filePath: string) =>
    mockExistingPaths.has(path.posix.normalize(filePath))
  ),  mkdir: vi.fn(),
  readDir: vi.fn(async () => []),
  readFile: vi.fn(),
  readTextFile: vi.fn(async (filePath: string) => {
    const normalizedPath = path.posix.normalize(filePath);
    const content = mockTextFiles.get(normalizedPath);
    if (content === undefined) {
      throw new Error(`Unexpected readTextFile: ${normalizedPath}`);
    }
    return content;
  }),
  remove: vi.fn(),
  writeFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock('@/services/workspace-root-service', () => ({
  getEffectiveWorkspaceRoot: vi.fn().mockResolvedValue('/mock/workspace'),
}));

import { remove, writeTextFile } from '@tauri-apps/plugin-fs';

function addSkillAt(skillDir: string, description: string) {
  const normalizedDir = path.posix.normalize(skillDir);
  const skillMdPath = path.posix.join(normalizedDir, 'SKILL.md');

  mockExistingPaths.add(normalizedDir);
  mockExistingPaths.add(skillMdPath);
  mockTextFiles.set(
    skillMdPath,
    `---\nname: ${path.posix.basename(normalizedDir)}\ndescription: ${description}\n---\n\n# ${description}\n`
  );
}

describe('AgentSkillService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistingPaths.clear();
    mockTextFiles.clear();

    mockExistingPaths.add('/mock/app-data/skills');
    mockExistingPaths.add('/mock/home/.claude/skills');
    mockExistingPaths.add('/mock/home/.talkcody/skills');
    mockExistingPaths.add('/mock/workspace/.talkcody/skills');
  });

  it('finds a project-local skill by name across discovered roots', async () => {
    addSkillAt('/mock/workspace/.talkcody/skills/release-talkcody', 'Project release skill');

    const service = new AgentSkillService();
    const skill = await service.getSkillByName('release-talkcody');

    expect(skill?.name).toBe('release-talkcody');
    expect(skill?.path).toBe('/mock/workspace/.talkcody/skills/release-talkcody');
    expect(skill?.frontmatter.description).toBe('Project release skill');
  });

  it('updates the exact skill path when editing a project-local skill', async () => {
    addSkillAt('/mock/workspace/.talkcody/skills/release-talkcody', 'Project release skill');

    const service = new AgentSkillService();
    await service.updateSkill(
      'release-talkcody',
      { description: 'Updated project release skill' },
      undefined,
      '/mock/workspace/.talkcody/skills/release-talkcody'
    );

    expect(writeTextFile).toHaveBeenCalledWith(
      '/mock/workspace/.talkcody/skills/release-talkcody/SKILL.md',
      expect.stringContaining('description: Updated project release skill')
    );
  });

  it('deletes the exact skill path when removing a project-local skill', async () => {
    addSkillAt('/mock/workspace/.talkcody/skills/release-talkcody', 'Project release skill');

    const service = new AgentSkillService();
    await service.deleteSkill(
      'release-talkcody',
      '/mock/workspace/.talkcody/skills/release-talkcody'
    );

    expect(remove).toHaveBeenCalledWith('/mock/workspace/.talkcody/skills/release-talkcody', {
      recursive: true,
    });
  });
});
