// src/hooks/use-skills.ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import { logger } from '@/lib/logger';
import {
  getAgentSkillService,
  getSkillService,
  type Skill,
  type SkillFilter,
  type SkillSortOption,
  type TaskSkill,
} from '@/services/skills';
import { useSkillsStore } from '@/stores/skills-store';
import type { AgentSkill, AgentSkillFrontmatter } from '@/types/agent-skills-spec';
import type { SkillContent } from '@/types/skill';

/**
 * Apply local filters and sorting to skills
 */
function applyLocalFilters(skills: Skill[], filter?: SkillFilter, sort?: SkillSortOption): Skill[] {
  if (!skills || !Array.isArray(skills)) {
    return [];
  }
  let result = [...skills];

  // Apply category filter
  if (filter?.category) {
    result = result.filter((skill) => skill.category === filter.category);
  }

  // Apply tags filter
  if (filter?.tags && filter.tags.length > 0) {
    result = result.filter((skill) =>
      filter.tags?.some((tag) => skill.metadata.tags.includes(tag))
    );
  }

  // Apply search filter
  if (filter?.search) {
    const searchLower = filter.search.toLowerCase();
    result = result.filter(
      (skill) =>
        skill.name.toLowerCase().includes(searchLower) ||
        skill.description.toLowerCase().includes(searchLower) ||
        skill.category.toLowerCase().includes(searchLower) ||
        skill.metadata.tags.some((tag) => tag.toLowerCase().includes(searchLower))
    );
  }

  // Apply isBuiltIn filter
  if (filter?.isBuiltIn !== undefined) {
    result = result.filter((skill) => skill.metadata.isBuiltIn === filter.isBuiltIn);
  }

  // Apply sorting
  if (sort) {
    switch (sort) {
      case 'name':
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'updated':
        result.sort((a, b) => b.metadata.updatedAt - a.metadata.updatedAt);
        break;
      case 'recent':
        result.sort((a, b) => b.metadata.createdAt - a.metadata.createdAt);
        break;
      case 'downloads':
        result.sort((a, b) => (b.marketplace?.downloads || 0) - (a.marketplace?.downloads || 0));
        break;
      case 'rating':
        result.sort((a, b) => (b.marketplace?.rating || 0) - (a.marketplace?.rating || 0));
        break;
      default:
        break;
    }
  }

  return result;
}

/**
 * Hook for managing skills
 * Now uses global store to prevent duplicate loading
 * Applies local filtering and sorting for better performance
 */
export function useSkills(filter?: SkillFilter, sort?: SkillSortOption) {
  const { skills: allSkills, isLoading, error, loadSkills, refreshSkills } = useSkillsStore();

  useEffect(() => {
    // Load all skills without filter (only once)
    loadSkills();
  }, [loadSkills]);

  // Apply local filtering and sorting
  const filteredSkills = useMemo(() => {
    return applyLocalFilters(allSkills, filter, sort);
  }, [allSkills, filter, sort]);

  const refresh = useCallback(() => {
    refreshSkills();
  }, [refreshSkills]);

  return {
    skills: filteredSkills,
    loading: isLoading,
    error: error ? new Error(error) : null,
    refresh,
  };
}

/**
 * Hook for managing a single skill
 */
export function useSkill(skillId: string | null) {
  const [skill, setSkill] = useState<Skill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadSkill = useCallback(async () => {
    if (!skillId) {
      setSkill(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const service = await getSkillService();
      const result = await service.getSkill(skillId);
      setSkill(result);
    } catch (err) {
      logger.error('Failed to load skill:', err);
      setError(err instanceof Error ? err : new Error('Failed to load skill'));
    } finally {
      setLoading(false);
    }
  }, [skillId]);

  useEffect(() => {
    loadSkill();
  }, [loadSkill]);

  const refresh = useCallback(() => {
    loadSkill();
  }, [loadSkill]);

  return {
    skill,
    loading,
    error,
    refresh,
  };
}

/**
 * Hook for managing task skills
 */
export function useTaskSkills(taskId: string | null) {
  const [taskSkills, setTaskSkills] = useState<TaskSkill[]>([]);
  const [skills, setActiveSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadTaskSkills = useCallback(async () => {
    if (!taskId) {
      setTaskSkills([]);
      setActiveSkills([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const service = await getSkillService();

      // Load task-skill associations
      const ts = await service.getTaskSkills(taskId);
      setTaskSkills(ts);

      // Load full skill data for active skills
      const activeSkillIds = ts
        .filter((t: TaskSkill) => t.enabled)
        .map((t: TaskSkill) => t.skillId);
      const skillsData: Skill[] = [];
      for (const skillId of activeSkillIds) {
        const skill = await service.getSkill(skillId);
        if (skill) {
          skillsData.push(skill);
        }
      }
      setActiveSkills(skillsData);
    } catch (err) {
      logger.error('Failed to load task skills:', err);
      setError(err instanceof Error ? err : new Error('Failed to load task skills'));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    loadTaskSkills();
  }, [loadTaskSkills]);

  const enableSkill = useCallback(
    async (skillId: string, priority?: number) => {
      if (!taskId) return;

      try {
        const service = await getSkillService();
        await service.enableSkillForTask(taskId, skillId, priority);
        await loadTaskSkills();
      } catch (err) {
        logger.error('Failed to enable skill:', err);
        throw err;
      }
    },
    [taskId, loadTaskSkills]
  );

  const disableSkill = useCallback(
    async (skillId: string) => {
      if (!taskId) return;

      try {
        const service = await getSkillService();
        await service.disableSkillForTask(taskId, skillId);
        await loadTaskSkills();
      } catch (err) {
        logger.error('Failed to disable skill:', err);
        throw err;
      }
    },
    [taskId, loadTaskSkills]
  );

  const toggleSkill = useCallback(
    async (skillId: string) => {
      if (!taskId) return false;

      try {
        const service = await getSkillService();
        const enabled = await service.toggleSkillForTask(taskId, skillId);
        await loadTaskSkills();
        return enabled;
      } catch (err) {
        logger.error('Failed to toggle skill:', err);
        throw err;
      }
    },
    [taskId, loadTaskSkills]
  );

  const setTaskSkillsList = useCallback(
    async (skillIds: string[]) => {
      if (!taskId) return;

      try {
        const service = await getSkillService();
        await service.setTaskSkills(taskId, skillIds);
        await loadTaskSkills();
      } catch (err) {
        logger.error('Failed to set task skills:', err);
        throw err;
      }
    },
    [taskId, loadTaskSkills]
  );

  const refresh = useCallback(() => {
    loadTaskSkills();
  }, [loadTaskSkills]);

  return {
    taskSkills,
    skills,
    loading,
    error,
    enableSkill,
    disableSkill,
    toggleSkill,
    setSkills: setTaskSkillsList,
    refresh,
  };
}

/** @deprecated Use useTaskSkills instead */
export const useConversationSkills = useTaskSkills;

/**
 * Convert AgentSkill to Skill format
 */
function agentSkillToSkill(agentSkill: AgentSkill): Skill {
  // Extract content from SKILL.md body
  const content: SkillContent = {};
  if (agentSkill.content) {
    content.systemPromptFragment = agentSkill.content;
  }

  // Extract tags from metadata
  const tags = agentSkill.frontmatter.metadata?.tags
    ? typeof agentSkill.frontmatter.metadata.tags === 'string'
      ? agentSkill.frontmatter.metadata.tags.split(',').map((t) => t.trim())
      : []
    : [];

  return {
    id: agentSkill.directory.name,
    name: agentSkill.name,
    description: agentSkill.frontmatter.description,
    category: agentSkill.frontmatter.metadata?.category || 'other',
    license: agentSkill.frontmatter.license,
    compatibility: agentSkill.frontmatter.compatibility,
    content,
    localPath: agentSkill.path,
    metadata: {
      tags,
      isBuiltIn: false,
      sourceType: 'local',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  };
}

/**
 * Hook for CRUD operations on skills
 */
export function useSkillMutations() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const createSkill = useCallback(
    async (data: {
      name: string;
      description: string;
      category: string;
      tags?: string[];
      content: string | SkillContent;
      license?: string;
      compatibility?: string;
      metadata?: { tags: string[] };
    }) => {
      try {
        setLoading(true);
        setError(null);

        // Use AgentSkillService to create skills
        const agentService = await getAgentSkillService();

        // Prepare content from input (content is required in CreateSkillParams)
        let content: string = '';
        if (typeof data.content === 'string') {
          content = data.content;
        } else if (data.content?.systemPromptFragment) {
          content = data.content.systemPromptFragment;
        }

        // Build metadata with tags (only include tags if not empty)
        const metadata: Record<string, string> = {
          category: data.category || 'other',
        };
        const tagsArray =
          data.tags && data.tags.length > 0
            ? data.tags
            : data.metadata?.tags && data.metadata.tags.length > 0
              ? data.metadata.tags
              : [];
        if (tagsArray.length > 0) {
          metadata.tags = tagsArray.join(',');
        }

        const agentSkill = await agentService.createSkill({
          name: data.name,
          description: data.description,
          content,
          license: data.license,
          compatibility: data.compatibility,
          metadata,
        });

        logger.info(`Created skill: ${data.name}`);

        // Convert AgentSkill to Skill format for return
        const skill = agentSkillToSkill(agentSkill);
        return skill;
      } catch (err) {
        logger.error('Failed to create skill:', err);
        const error = err instanceof Error ? err : new Error('Failed to create skill');
        setError(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const updateSkill = useCallback(
    async (
      id: string,
      data: {
        name?: string;
        description?: string;
        category?: string;
        tags?: string[];
        content?: string | SkillContent;
        license?: string;
        compatibility?: string;
        metadata?: { tags: string[] };
      },
      localPath?: string
    ) => {
      try {
        setLoading(true);
        setError(null);

        // Use AgentSkillService to update skills
        const agentService = await getAgentSkillService();

        // Resolve the existing skill using the exact path when available.
        const existingSkill = localPath
          ? await agentService.loadSkillByPath(localPath)
          : await agentService.getSkillByName(id);
        if (!existingSkill) {
          throw new Error(`Skill with name ${id} not found`);
        }

        // Prepare updates
        const updates: {
          description?: string;
          content?: string;
          metadata?: Record<string, string>;
        } = {};

        if (data.description !== undefined) {
          updates.description = data.description;
        }

        if (data.content !== undefined) {
          if (typeof data.content === 'string') {
            updates.content = data.content;
          } else if (data.content?.systemPromptFragment) {
            updates.content = data.content.systemPromptFragment;
          }
        }

        // Build metadata with tags (only include tags if not empty)
        const tags = data.tags || data.metadata?.tags || [];
        const category = data.category || existingSkill.frontmatter.metadata?.category || 'other';
        const metadata: Record<string, string> = {
          ...existingSkill.frontmatter.metadata,
          category,
        };
        if (tags.length > 0) {
          metadata.tags = tags.join(',');
        }

        // Update frontmatter with license and compatibility if provided
        const finalFrontmatter: Partial<AgentSkillFrontmatter> = {
          ...existingSkill.frontmatter,
        };
        if (data.name && data.name !== existingSkill.name) {
          finalFrontmatter.name = data.name;
        }
        if (data.license !== undefined) {
          finalFrontmatter.license = data.license || undefined;
        }
        if (data.compatibility !== undefined) {
          finalFrontmatter.compatibility = data.compatibility || undefined;
        }

        updates.metadata = metadata;

        // Update the skill using its resolved location
        await agentService.updateSkill(
          existingSkill.name,
          updates,
          finalFrontmatter,
          existingSkill.path
        );

        logger.info(`Updated skill: ${existingSkill.name}`);

        // Reload the updated skill from the same path
        const updatedSkill = await agentService.loadSkillByPath(existingSkill.path);
        if (!updatedSkill) {
          throw new Error('Failed to reload updated skill');
        }

        // Convert AgentSkill to Skill format for return
        const skill = agentSkillToSkill(updatedSkill);
        return skill;
      } catch (err) {
        logger.error('Failed to update skill:', err);
        const error = err instanceof Error ? err : new Error('Failed to update skill');
        setError(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const deleteSkill = useCallback(async (id: string, localPath?: string) => {
    try {
      setLoading(true);
      setError(null);

      // Use AgentSkillService to delete skills
      const agentService = await getAgentSkillService();

      // Resolve the exact skill to avoid missing project-local skills.
      const skill = localPath
        ? await agentService.loadSkillByPath(localPath)
        : await agentService.getSkillByName(id);
      if (!skill) {
        throw new Error(`Skill with name ${id} not found`);
      }

      // Delete the skill using its resolved path
      await agentService.deleteSkill(skill.name, skill.path);
      logger.info(`Deleted skill: ${skill.name}`);
    } catch (err) {
      logger.error('Failed to delete skill:', err);
      const error = err instanceof Error ? err : new Error('Failed to delete skill');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const forkSkill = useCallback(async (id: string) => {
    try {
      setLoading(true);
      setError(null);
      const { forkSkill } = await import('@/services/skills/fork-skill');
      const { SkillDatabaseService } = await import('@/services/database/skill-database-service');
      const { databaseService } = await import('@/services/database-service');
      const db = await databaseService.getDb();
      const dbService = new SkillDatabaseService(db);
      const newSkillId = await forkSkill(id, dbService);
      if (!newSkillId) {
        throw new Error('Failed to fork skill');
      }
      return newSkillId;
    } catch (err) {
      logger.error('Failed to fork skill:', err);
      const error = err instanceof Error ? err : new Error('Failed to fork skill');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    createSkill,
    updateSkill,
    deleteSkill,
    forkSkill,
    loading,
    error,
  };
}
