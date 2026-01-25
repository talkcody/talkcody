// Marketplace Skills hook for fetching and managing remote skills data
// Now uses JSON-based configuration instead of database

import { useCallback, useEffect, useState } from 'react';
import { logger } from '@/lib/logger';
import { remoteSkillsLoader } from '@/providers/remote-skills/remote-skills-loader';
import type { RemoteSkillConfig } from '@/types/remote-skills';
import type { SkillSortOption } from '@/types/skill';

export interface ListSkillsRequest {
  search?: string;
  category?: string;
  sort?: SkillSortOption;
  limit?: number;
  offset?: number;
}

interface UseMarketplaceSkillsReturn {
  skills: RemoteSkillConfig[];
  categories: string[];
  isLoading: boolean;
  error: string | null;
  loadSkills: (options?: ListSkillsRequest) => Promise<void>;
  getSkillById: (skillId: string) => RemoteSkillConfig | null;
  refresh: () => Promise<void>;
  installSkill: (slug: string, version: string) => Promise<void>;
}

export function useMarketplaceSkills(): UseMarketplaceSkillsReturn {
  const [allSkills, setAllSkills] = useState<RemoteSkillConfig[]>([]);
  const [skills, setSkills] = useState<RemoteSkillConfig[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load all skills from JSON
  const loadAllSkills = useCallback(async () => {
    try {
      const config = await remoteSkillsLoader.load();
      setAllSkills(config.remoteSkills);

      // Extract unique categories
      const uniqueCategories = Array.from(
        new Set(config.remoteSkills.map((skill) => skill.category))
      ).sort();
      setCategories(uniqueCategories);

      return config.remoteSkills;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load remote skills';
      setError(errorMsg);
      logger.error('Load remote skills error:', err);
      throw err;
    }
  }, []);

  // Filter and sort skills based on options
  const loadSkills = useCallback(
    async (options?: ListSkillsRequest) => {
      setIsLoading(true);
      setError(null);

      try {
        // Load all skills if not already loaded
        const skillsData = allSkills.length > 0 ? allSkills : await loadAllSkills();

        // Apply filters
        let filteredSkills = [...skillsData];

        // Category filter
        if (options?.category) {
          filteredSkills = filteredSkills.filter((skill) => skill.category === options.category);
        }

        // Search filter
        if (options?.search) {
          const query = options.search.toLowerCase();
          filteredSkills = filteredSkills.filter(
            (skill) =>
              skill.name.toLowerCase().includes(query) ||
              skill.description.toLowerCase().includes(query) ||
              skill.id.toLowerCase().includes(query)
          );
        }

        // Sort
        if (options?.sort) {
          filteredSkills = sortSkills(filteredSkills, options.sort);
        }

        // Pagination
        if (options?.offset !== undefined || options?.limit !== undefined) {
          const offset = options.offset || 0;
          const limit = options.limit || filteredSkills.length;
          filteredSkills = filteredSkills.slice(offset, offset + limit);
        }

        setSkills(filteredSkills);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMsg);
        logger.error('Load skills error:', err);
      } finally {
        setIsLoading(false);
      }
    },
    [allSkills, loadAllSkills]
  );

  // Get skill by ID
  const getSkillById = useCallback(
    (skillId: string): RemoteSkillConfig | null => {
      return allSkills.find((skill) => skill.id === skillId) || null;
    },
    [allSkills]
  );

  // Manual refresh
  const refresh = useCallback(async () => {
    remoteSkillsLoader.clearCache();
    await loadAllSkills();
    await loadSkills();
  }, [loadAllSkills, loadSkills]);

  // Listen for remote skills updates
  useEffect(() => {
    const handleUpdate = () => {
      logger.info('Remote skills updated, refreshing...');
      refresh().catch((err) => {
        logger.error('Failed to refresh after remote skills update:', err);
      });
    };

    window.addEventListener('remoteSkillsUpdated', handleUpdate);
    return () => window.removeEventListener('remoteSkillsUpdated', handleUpdate);
  }, [refresh]);

  // Load skills on mount
  useEffect(() => {
    loadSkills().catch((err) => {
      logger.error('Initial skills load failed:', err);
    });
  }, [loadSkills]);

  // Install skill - track installation with backend
  const installSkill = useCallback(async (_slug: string, _version: string): Promise<void> => {
    logger.info('Remote skill install tracking disabled');
  }, []);

  return {
    skills,
    categories,
    isLoading,
    error,
    loadSkills,
    getSkillById,
    refresh,
    installSkill,
  };
}

/**
 * Sort skills based on the specified option
 */
function sortSkills(skills: RemoteSkillConfig[], sortBy: SkillSortOption): RemoteSkillConfig[] {
  const sorted = [...skills];

  switch (sortBy) {
    case 'name':
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case 'recent':
    case 'updated':
      // For JSON-based system, we don't have timestamps
      // Fall back to alphabetical
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case 'downloads':
    case 'installs':
    case 'rating':
      // For JSON-based system, we don't have stats
      // Fall back to alphabetical
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    default:
      return sorted;
  }
}
