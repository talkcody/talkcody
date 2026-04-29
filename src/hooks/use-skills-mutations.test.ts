// useSkills hook mutations tests

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as skillDatabaseServiceModule from '@/services/database/skill-database-service';
import * as databaseServiceModule from '@/services/database-service';
import * as forkSkillModule from '@/services/skills/fork-skill';
import { useSkillMutations } from './use-skills';

// Mock the agent skills service
vi.mock('@/services/skills/agent-skill-service', () => ({
  getAgentSkillService: vi.fn(),
}));

// Mock logger

// Mock database service
vi.mock('@/services/database-service', () => ({
  databaseService: {
    getDb: vi.fn(),
  },
}));

// Mock skill database service
vi.mock('@/services/database/skill-database-service', () => {
  // Define a class that can be instantiated
  class MockSkillDatabaseService {
    getSkillById = vi.fn();
    updateSkill = vi.fn();
    deleteSkill = vi.fn();
    listSkills = vi.fn();
  }
  return {
    SkillDatabaseService: MockSkillDatabaseService,
  };
});

// Mock fork skill service
vi.mock('@/services/skills/fork-skill', () => ({
  forkSkill: vi.fn(),
}));

describe('useSkillMutations', () => {
  let mockAgentSkillService: any;
  let getAgentSkillServiceMock: any;

  beforeEach(async () => {
    mockAgentSkillService = {
      createSkill: vi.fn(),
      updateSkill: vi.fn(),
      deleteSkill: vi.fn(),
      getSkillByName: vi.fn(),
      loadSkill: vi.fn(),
      loadSkillByPath: vi.fn(),
      listSkills: vi.fn(),
    };

    const agentSkillServiceModule = await import('@/services/skills/agent-skill-service');
    getAgentSkillServiceMock = vi.mocked(agentSkillServiceModule.getAgentSkillService);
    getAgentSkillServiceMock.mockResolvedValue(mockAgentSkillService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createSkill', () => {
    it('should create a skill successfully', async () => {
      const mockAgentSkill = {
        name: 'New Skill',
        path: '/path/to/skill',
        frontmatter: {
          name: 'New Skill',
          description: 'A new skill',
          metadata: {
            category: 'Development',
            tags: 'tag1,tag2',
          },
        },
        content: '# New Skill\n\nA new skill',
        directory: {
          name: 'new-skill',
          path: '/path/to/skill',
          hasSkillMd: true,
          hasScriptsDir: false,
          hasReferencesDir: false,
          hasAssetsDir: false,
          scriptFiles: [],
          referenceFiles: [],
          assetFiles: [],
        },
      };

      mockAgentSkillService.createSkill.mockResolvedValue(mockAgentSkill);

      const { result } = renderHook(() => useSkillMutations());

      const skillData = {
        name: 'New Skill',
        description: 'A new skill',
        category: 'Development',
        content: { systemPromptFragment: '# New Skill\n\nA new skill' },
        tags: ['tag1', 'tag2'],
      };

      let createdSkill;
      await waitFor(async () => {
        createdSkill = await result.current.createSkill(skillData);
      });

      expect(mockAgentSkillService.createSkill).toHaveBeenCalledWith({
        name: 'New Skill',
        description: 'A new skill',
        content: '# New Skill\n\nA new skill',
        metadata: {
          category: 'Development',
          tags: 'tag1,tag2',
        },
      });
      expect(createdSkill).toEqual({
        id: 'new-skill',
        name: 'New Skill',
        description: 'A new skill',
        category: 'Development',
        content: {
          systemPromptFragment: '# New Skill\n\nA new skill',
        },
        localPath: '/path/to/skill',
        metadata: {
          tags: ['tag1', 'tag2'],
          isBuiltIn: false,
          sourceType: 'local',
          createdAt: expect.any(Number),
          updatedAt: expect.any(Number),
        },
      });
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should handle skill creation with string content', async () => {
      const mockAgentSkill = {
        name: 'String Content Skill',
        path: '/path/to/skill',
        frontmatter: {
          name: 'String Content Skill',
          description: 'A skill with string content',
          metadata: {
            category: 'other',
            tags: '',
          },
        },
        content: 'String content here',
        directory: {
          name: 'string-content-skill',
          path: '/path/to/skill',
          hasSkillMd: true,
          hasScriptsDir: false,
          hasReferencesDir: false,
          hasAssetsDir: false,
          scriptFiles: [],
          referenceFiles: [],
          assetFiles: [],
        },
      };

      mockAgentSkillService.createSkill.mockResolvedValue(mockAgentSkill);

      const { result } = renderHook(() => useSkillMutations());

      const skillData = {
        name: 'String Content Skill',
        description: 'A skill with string content',
        category: 'other',
        content: 'String content here',
        tags: [],
      };

      let createdSkill;
      await waitFor(async () => {
        createdSkill = await result.current.createSkill(skillData);
      });

      // Tags is empty array, so metadata.tags should not be included
      expect(mockAgentSkillService.createSkill).toHaveBeenCalledWith({
        name: 'String Content Skill',
        description: 'A skill with string content',
        content: 'String content here',
        metadata: {
          category: 'other',
        },
      });
      expect(createdSkill).toEqual({
        id: 'string-content-skill',
        name: 'String Content Skill',
        description: 'A skill with string content',
        category: 'other',
        content: {
          systemPromptFragment: 'String content here',
        },
        localPath: '/path/to/skill',
        metadata: {
          tags: [],
          isBuiltIn: false,
          sourceType: 'local',
          createdAt: expect.any(Number),
          updatedAt: expect.any(Number),
        },
      });
    });

    it('should handle create skill errors', async () => {
      const error = new Error('Failed to create skill');
      mockAgentSkillService.createSkill.mockRejectedValue(error);

      const { result } = renderHook(() => useSkillMutations());

      try {
        await result.current.createSkill({ name: 'Test' } as any);
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err).toBe(error);
      }

      await waitFor(() => {
        expect(result.current.error).toBe(error);
        expect(result.current.loading).toBe(false);
      });
    });

    it('should set loading state during creation', async () => {
      const mockAgentSkill = {
        name: 'Test',
        path: '/path/to/skill',
        frontmatter: {
          name: 'Test',
          description: 'Test skill',
          metadata: {
            category: 'other',
            tags: '',
          },
        },
        content: '# Test',
        directory: {
          name: 'test',
          path: '/path/to/skill',
          hasSkillMd: true,
          hasScriptsDir: false,
          hasReferencesDir: false,
          hasAssetsDir: false,
          scriptFiles: [],
          referenceFiles: [],
          assetFiles: [],
        },
      };

      mockAgentSkillService.createSkill.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockAgentSkill), 100))
      );

      const { result } = renderHook(() => useSkillMutations());

      const createPromise = result.current.createSkill({ name: 'Test', description: 'Test skill', category: 'other', content: '# Test', tags: [] } as any);

      // Should be loading - wait for state update
      await waitFor(() => {
        expect(result.current.loading).toBe(true);
      });

      await createPromise;

      // Should not be loading after completion
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });
  });

  describe('updateSkill', () => {
    it('should update a skill successfully', async () => {
      const existingAgentSkill = {
        name: 'Original Skill',
        path: '/path/to/skill',
        frontmatter: {
          name: 'Original Skill',
          description: 'Original description',
          metadata: {
            category: 'Development',
            tags: 'tag1,tag2',
          },
        },
        content: '# Original Skill',
        directory: {
          name: 'original-skill',
          path: '/path/to/skill',
          hasSkillMd: true,
          hasScriptsDir: false,
          hasReferencesDir: false,
          hasAssetsDir: false,
          scriptFiles: [],
          referenceFiles: [],
          assetFiles: [],
        },
      };

      const updatedAgentSkill = {
        ...existingAgentSkill,
        name: 'Updated Skill',
        frontmatter: {
          ...existingAgentSkill.frontmatter,
          name: 'Updated Skill',
          description: 'Updated description',
          metadata: {
            ...existingAgentSkill.frontmatter.metadata,
            category: 'Development',
            tags: 'tag1,tag2,tag3',
          },
        },
      };

      mockAgentSkillService.getSkillByName.mockResolvedValue(existingAgentSkill);
      mockAgentSkillService.updateSkill.mockResolvedValue(undefined);
      mockAgentSkillService.loadSkillByPath.mockResolvedValue(updatedAgentSkill);

      const { result } = renderHook(() => useSkillMutations());

      const updates = {
        name: 'Updated Skill',
        description: 'Updated description',
        tags: ['tag1', 'tag2', 'tag3'],
      };

      let updatedSkill;
      await waitFor(async () => {
        updatedSkill = await result.current.updateSkill('original-skill', updates);
      });

      expect(mockAgentSkillService.getSkillByName).toHaveBeenCalledWith('original-skill');
      expect(mockAgentSkillService.updateSkill).toHaveBeenCalledWith(
        'Original Skill',
        expect.objectContaining({
          description: 'Updated description',
          metadata: expect.objectContaining({
            category: 'Development',
            tags: 'tag1,tag2,tag3',
          }),
        }),
        expect.objectContaining({
          description: 'Original description',
          metadata: expect.objectContaining({
            category: 'Development',
            tags: 'tag1,tag2',
          }),
          name: 'Updated Skill',
        }),
        '/path/to/skill'
      );
      expect(updatedSkill).toEqual({
        id: 'original-skill',
        name: 'Updated Skill',
        description: 'Updated description',
        category: 'Development',
        content: {
          systemPromptFragment: '# Original Skill',
        },
        localPath: '/path/to/skill',
        metadata: {
          tags: ['tag1', 'tag2', 'tag3'],
          isBuiltIn: false,
          sourceType: 'local',
          createdAt: expect.any(Number),
          updatedAt: expect.any(Number),
        },
      });
      // Verify the name was updated in the returned skill
      expect(updatedSkill.name).toBe('Updated Skill');
      expect(result.current.error).toBeNull();
    });

    it('should resolve project-local skills by path when updating', async () => {
      const existingAgentSkill = {
        name: 'release-talkcody',
        path: '/workspace/.talkcody/skills/release-talkcody',
        frontmatter: {
          name: 'release-talkcody',
          description: 'Project-local skill',
          metadata: {
            category: 'Release',
            tags: 'release',
          },
        },
        content: '# Release Skill',
        directory: {
          name: 'release-talkcody',
          path: '/workspace/.talkcody/skills/release-talkcody',
          hasSkillMd: true,
          hasScriptsDir: false,
          hasReferencesDir: false,
          hasAssetsDir: false,
          scriptFiles: [],
          referenceFiles: [],
          assetFiles: [],
        },
      };

      mockAgentSkillService.loadSkillByPath
        .mockResolvedValueOnce(existingAgentSkill)
        .mockResolvedValueOnce(existingAgentSkill);
      mockAgentSkillService.updateSkill.mockResolvedValue(undefined);

      const { result } = renderHook(() => useSkillMutations());

      await waitFor(async () => {
        await result.current.updateSkill(
          'release-talkcody',
          { description: 'Updated project skill' },
          '/workspace/.talkcody/skills/release-talkcody'
        );
      });

      expect(mockAgentSkillService.loadSkillByPath).toHaveBeenNthCalledWith(
        1,
        '/workspace/.talkcody/skills/release-talkcody'
      );
      expect(mockAgentSkillService.getSkillByName).not.toHaveBeenCalled();
      expect(mockAgentSkillService.updateSkill).toHaveBeenCalledWith(
        'release-talkcody',
        expect.objectContaining({ description: 'Updated project skill' }),
        expect.any(Object),
        '/workspace/.talkcody/skills/release-talkcody'
      );
    });

    it('should handle update skill errors when skill not found', async () => {
      mockAgentSkillService.getSkillByName.mockResolvedValue(null);

      const { result } = renderHook(() => useSkillMutations());

      try {
        await result.current.updateSkill('non-existent', {});
        expect(true).toBe(false);
      } catch (err) {
        expect((err as Error).message).toContain('not found');
      }

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });
    });

    it('should handle update skill errors', async () => {
      const existingAgentSkill = {
        name: 'Test Skill',
        path: '/path/to/skill',
        frontmatter: {
          name: 'Test Skill',
          description: 'Test',
          metadata: {
            category: 'other',
            tags: '',
          },
        },
        content: '# Test',
        directory: {
          name: 'test-skill',
          path: '/path/to/skill',
          hasSkillMd: true,
          hasScriptsDir: false,
          hasReferencesDir: false,
          hasAssetsDir: false,
          scriptFiles: [],
          referenceFiles: [],
          assetFiles: [],
        },
      };

      mockAgentSkillService.getSkillByName.mockResolvedValue(existingAgentSkill);
      mockAgentSkillService.updateSkill.mockRejectedValue(new Error('Update failed'));

      const { result } = renderHook(() => useSkillMutations());

      try {
        await result.current.updateSkill('test-skill', { description: 'New desc' });
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
      }

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });
    });
  });

  describe('deleteSkill', () => {
    it('should delete a skill successfully', async () => {
      const mockAgentSkill = {
        name: 'Test Skill',
        path: '/path/to/skill',
        frontmatter: {
          name: 'Test Skill',
          description: 'Test',
          metadata: {
            category: 'other',
            tags: '',
          },
        },
        content: '# Test',
        directory: {
          name: 'test-skill',
          path: '/path/to/skill',
          hasSkillMd: true,
          hasScriptsDir: false,
          hasReferencesDir: false,
          hasAssetsDir: false,
          scriptFiles: [],
          referenceFiles: [],
          assetFiles: [],
        },
      };

      mockAgentSkillService.getSkillByName.mockResolvedValue(mockAgentSkill);
      mockAgentSkillService.deleteSkill.mockResolvedValue(undefined);

      const { result } = renderHook(() => useSkillMutations());

      await waitFor(async () => {
        await result.current.deleteSkill('test-skill');
      });

      expect(mockAgentSkillService.getSkillByName).toHaveBeenCalledWith('test-skill');
      expect(mockAgentSkillService.deleteSkill).toHaveBeenCalledWith('Test Skill', '/path/to/skill');
      expect(result.current.error).toBeNull();
    });

    it('should resolve project-local skills by path when deleting', async () => {
      const mockAgentSkill = {
        name: 'release-talkcody',
        path: '/workspace/.talkcody/skills/release-talkcody',
        frontmatter: {
          name: 'release-talkcody',
          description: 'Project-local skill',
          metadata: {
            category: 'Release',
            tags: '',
          },
        },
        content: '# Release Skill',
        directory: {
          name: 'release-talkcody',
          path: '/workspace/.talkcody/skills/release-talkcody',
          hasSkillMd: true,
          hasScriptsDir: false,
          hasReferencesDir: false,
          hasAssetsDir: false,
          scriptFiles: [],
          referenceFiles: [],
          assetFiles: [],
        },
      };

      mockAgentSkillService.loadSkillByPath.mockResolvedValue(mockAgentSkill);
      mockAgentSkillService.deleteSkill.mockResolvedValue(undefined);

      const { result } = renderHook(() => useSkillMutations());

      await waitFor(async () => {
        await result.current.deleteSkill(
          'release-talkcody',
          '/workspace/.talkcody/skills/release-talkcody'
        );
      });

      expect(mockAgentSkillService.loadSkillByPath).toHaveBeenCalledWith(
        '/workspace/.talkcody/skills/release-talkcody'
      );
      expect(mockAgentSkillService.getSkillByName).not.toHaveBeenCalled();
      expect(mockAgentSkillService.deleteSkill).toHaveBeenCalledWith(
        'release-talkcody',
        '/workspace/.talkcody/skills/release-talkcody'
      );
      expect(result.current.error).toBeNull();
    });

    it('should handle delete skill errors when skill not found', async () => {
      mockAgentSkillService.getSkillByName.mockResolvedValue(null);

      const { result } = renderHook(() => useSkillMutations());

      try {
        await result.current.deleteSkill('non-existent');
        expect(true).toBe(false);
      } catch (err) {
        expect((err as Error).message).toContain('not found');
      }

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });
    });

    it('should handle delete skill errors', async () => {
      const mockAgentSkill = {
        name: 'System Skill',
        path: '/path/to/skill',
        frontmatter: {
          name: 'System Skill',
          description: 'Test',
          metadata: {
            category: 'other',
            tags: '',
          },
        },
        content: '# System Skill',
        directory: {
          name: 'system-skill',
          path: '/path/to/skill',
          hasSkillMd: true,
          hasScriptsDir: false,
          hasReferencesDir: false,
          hasAssetsDir: false,
          scriptFiles: [],
          referenceFiles: [],
          assetFiles: [],
        },
      };

      const error = new Error('Cannot delete system skill');
      mockAgentSkillService.getSkillByName.mockResolvedValue(mockAgentSkill);
      mockAgentSkillService.deleteSkill.mockRejectedValue(error);

      const { result } = renderHook(() => useSkillMutations());

      try {
        await result.current.deleteSkill('system-skill');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBe(error);
      }

      await waitFor(() => {
        expect(result.current.error).toBe(error);
      });
    });
  });

  describe('forkSkill', () => {
    it('should fork a skill successfully', async () => {
      const mockDb = {};

      vi.mocked(databaseServiceModule.databaseService.getDb).mockResolvedValue(mockDb as any);
      vi.mocked(forkSkillModule.forkSkill).mockResolvedValue('forked-skill-id');

      const { result } = renderHook(() => useSkillMutations());

      const forkedSkillId = await result.current.forkSkill('source-skill-1');

      expect(forkedSkillId).toBe('forked-skill-id');
      expect(result.current.error).toBeNull();
      expect(databaseServiceModule.databaseService.getDb).toHaveBeenCalled();
      expect(forkSkillModule.forkSkill).toHaveBeenCalledWith(
        'source-skill-1',
        expect.objectContaining({
          getSkillById: expect.any(Function),
          updateSkill: expect.any(Function),
          deleteSkill: expect.any(Function),
          listSkills: expect.any(Function),
        })
      );
    });

    it('should handle fork skill errors', async () => {
      const mockDb = {};

      vi.mocked(databaseServiceModule.databaseService.getDb).mockResolvedValue(mockDb as any);
      vi.mocked(forkSkillModule.forkSkill).mockResolvedValue(null);

      const { result } = renderHook(() => useSkillMutations());

      try {
        await result.current.forkSkill('non-existent-skill');
        expect(true).toBe(false);
      } catch (err) {
        expect((err as Error).message).toContain('Failed to fork skill');
      }

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });
    });
  });

  describe('loading and error states', () => {
    it('should reset error when starting new mutation', async () => {
      const error = new Error('Previous error');
      const mockAgentSkill = {
        name: 'Test 2',
        path: '/path/to/skill',
        frontmatter: {
          name: 'Test 2',
          description: 'Test skill',
          metadata: {
            category: 'other',
            tags: '',
          },
        },
        content: '# Test 2',
        directory: {
          name: 'test-2',
          path: '/path/to/skill',
          hasSkillMd: true,
          hasScriptsDir: false,
          hasReferencesDir: false,
          hasAssetsDir: false,
          scriptFiles: [],
          referenceFiles: [],
          assetFiles: [],
        },
      };

      mockAgentSkillService.createSkill
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(mockAgentSkill);

      const { result } = renderHook(() => useSkillMutations());

      // First call fails
      try {
        await result.current.createSkill({ name: 'Test', description: 'Test', category: 'other', content: '# Test', tags: [] } as any);
      } catch (_err) {
        // Expected
      }

      await waitFor(() => {
        expect(result.current.error).toBe(error);
      });

      // Second call succeeds
      await waitFor(async () => {
        await result.current.createSkill({ name: 'Test 2', description: 'Test skill', category: 'other', content: '# Test 2', tags: [] } as any);
      });

      // Error should be reset
      await waitFor(() => {
        expect(result.current.error).toBeNull();
      });
    });

    it('should not be loading initially', () => {
      const { result } = renderHook(() => useSkillMutations());

      expect(result.current.loading).toBe(false);
    });

    it('should have no error initially', () => {
      const { result } = renderHook(() => useSkillMutations());

      expect(result.current.error).toBeNull();
    });
  });

  describe('concurrent mutations', () => {
    it('should handle multiple sequential mutations correctly', async () => {
      const mockAgentSkill1 = {
        name: 'Skill1',
        path: '/path/to/Skill1',
        frontmatter: {
          name: 'Skill1',
          description: '',
          metadata: {
            category: 'other',
            tags: '',
          },
        },
        content: '# Skill1',
        directory: {
          name: 'skill1',
          path: '/path/to/Skill1',
          hasSkillMd: true,
          hasScriptsDir: false,
          hasReferencesDir: false,
          hasAssetsDir: false,
          scriptFiles: [],
          referenceFiles: [],
          assetFiles: [],
        },
      };

      const mockAgentSkill2 = {
        name: 'Skill2',
        path: '/path/to/Skill2',
        frontmatter: {
          name: 'Skill2',
          description: '',
          metadata: {
            category: 'other',
            tags: '',
          },
        },
        content: '# Skill2',
        directory: {
          name: 'skill2',
          path: '/path/to/Skill2',
          hasSkillMd: true,
          hasScriptsDir: false,
          hasReferencesDir: false,
          hasAssetsDir: false,
          scriptFiles: [],
          referenceFiles: [],
          assetFiles: [],
        },
      };

      mockAgentSkillService.createSkill
        .mockResolvedValueOnce(mockAgentSkill1)
        .mockResolvedValueOnce(mockAgentSkill2);

      const { result } = renderHook(() => useSkillMutations());

      // Test multiple sequential calls work correctly
      const skill1 = await result.current.createSkill({ name: 'Skill1', description: '', category: 'other', content: '# Skill1', tags: [] } as any);
      expect(skill1.id).toBe('skill1');

      const skill2 = await result.current.createSkill({ name: 'Skill2', description: '', category: 'other', content: '# Skill2', tags: [] } as any);
      expect(skill2.id).toBe('skill2');
    });
  });
});
