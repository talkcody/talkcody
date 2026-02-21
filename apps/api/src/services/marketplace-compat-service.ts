// Legacy marketplace compatibility helpers for remote agents/skills

import type { MarketplaceAgent, MarketplaceSkill, SkillCategory, SkillTag } from '@talkcody/shared';
import type { RemoteAgentMetadata } from '@talkcody/shared/types/remote-agents';
import type { RemoteSkillConfig } from '@talkcody/shared/types/remote-skills';

export type MarketplaceSortBy = 'popular' | 'recent' | 'installs' | 'name';

export type SkillsMarketplaceSortBy =
  | 'popular'
  | 'recent'
  | 'downloads'
  | 'installs'
  | 'name'
  | 'rating'
  | 'updated';

const normalizeTimestamp = (value: unknown): string => {
  if (typeof value === 'string' && value.length > 0) return value;
  return new Date(0).toISOString();
};

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value : '');

const normalizeStringOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const normalizeBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const normalizeNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const normalizeRemoteAgent = (agent: RemoteAgentMetadata): MarketplaceAgent => {
  const agentAny = agent as Record<string, unknown>;
  const tagsRaw = agentAny.tags as string[] | undefined;
  const tagObjects = Array.isArray(tagsRaw)
    ? tagsRaw.map((tag) => ({ id: tag, name: tag, slug: tag, usageCount: 0 }))
    : [];

  const category = typeof agentAny.category === 'string' ? agentAny.category : '';
  const categoryObjects = category
    ? [
        {
          id: category,
          name: category,
          slug: category,
          description: '',
          icon: undefined,
          displayOrder: 0,
        },
      ]
    : [];

  return {
    id: normalizeString(agentAny.id),
    slug: normalizeString(agentAny.slug || agentAny.id),
    name: normalizeString(agentAny.name),
    description: normalizeString(agentAny.description),
    longDescription: normalizeString(agentAny.longDescription),
    author: {
      id: normalizeString(agentAny.authorId || ''),
      name: normalizeString(agentAny.authorName || ''),
      displayName: undefined,
      avatarUrl: normalizeStringOrNull(agentAny.authorAvatarUrl),
      bio: normalizeStringOrNull(agentAny.authorBio),
      website: normalizeStringOrNull(agentAny.authorWebsite),
      agentCount: normalizeNumber(agentAny.authorAgentCount, 0),
    },
    iconUrl: normalizeStringOrNull(agentAny.iconUrl),
    bannerUrl: normalizeStringOrNull(agentAny.bannerUrl),
    installCount: normalizeNumber(agentAny.installCount, 0),
    usageCount: normalizeNumber(agentAny.usageCount, 0),
    rating: normalizeNumber(agentAny.rating, 0),
    ratingCount: normalizeNumber(agentAny.ratingCount, 0),
    latestVersion: normalizeString(agentAny.latestVersion),
    categories: categoryObjects,
    tags: tagObjects,
    isFeatured: normalizeBoolean(agentAny.isFeatured, false),
    isPublished: normalizeBoolean(agentAny.isPublished, true),
    createdAt: normalizeTimestamp(agentAny.createdAt),
    updatedAt: normalizeTimestamp(agentAny.updatedAt),
    model: typeof agentAny.model === 'string' ? agentAny.model : undefined,
    systemPrompt: typeof agentAny.systemPrompt === 'string' ? agentAny.systemPrompt : undefined,
    rules: typeof agentAny.rules === 'string' ? agentAny.rules : undefined,
    outputFormat: typeof agentAny.outputFormat === 'string' ? agentAny.outputFormat : undefined,
  };
};

export const normalizeRemoteSkill = (skill: RemoteSkillConfig): MarketplaceSkill => {
  const skillAny = skill as Record<string, unknown>;
  const category = typeof skillAny.category === 'string' ? skillAny.category : '';

  const categories: SkillCategory[] = category
    ? [
        {
          id: category,
          name: category,
          slug: category,
          description: '',
          icon: undefined,
          displayOrder: 0,
        },
      ]
    : [];

  const tagsRaw = skillAny.tags as string[] | undefined;
  const tags: SkillTag[] = Array.isArray(tagsRaw)
    ? tagsRaw.map((tag) => ({ id: tag, name: tag, slug: tag, usageCount: 0 }))
    : [];

  return {
    id: normalizeString(skillAny.id),
    slug: normalizeString(skillAny.slug || skillAny.id),
    name: normalizeString(skillAny.name),
    description: normalizeString(skillAny.description),
    longDescription: normalizeString(skillAny.longDescription),
    author: {
      id: normalizeString(skillAny.authorId || ''),
      name: normalizeString(skillAny.authorName || ''),
      displayName: undefined,
      avatarUrl: normalizeStringOrNull(skillAny.authorAvatarUrl),
      bio: normalizeStringOrNull(skillAny.authorBio),
      website: normalizeStringOrNull(skillAny.authorWebsite),
      agentCount: normalizeNumber(skillAny.authorAgentCount, 0),
    },
    iconUrl: normalizeStringOrNull(skillAny.iconUrl),
    bannerUrl: normalizeStringOrNull(skillAny.bannerUrl),
    installCount: normalizeNumber(skillAny.installCount, 0),
    usageCount: normalizeNumber(skillAny.usageCount, 0),
    rating: normalizeNumber(skillAny.rating, 0),
    ratingCount: normalizeNumber(skillAny.ratingCount, 0),
    latestVersion: normalizeString(skillAny.latestVersion),
    categories,
    tags,
    isFeatured: normalizeBoolean(skillAny.isFeatured, false),
    isPublished: normalizeBoolean(skillAny.isPublished, true),
    createdAt: normalizeTimestamp(skillAny.createdAt),
    updatedAt: normalizeTimestamp(skillAny.updatedAt),
    systemPromptFragment:
      typeof skillAny.systemPromptFragment === 'string' ? skillAny.systemPromptFragment : undefined,
    workflowRules: typeof skillAny.workflowRules === 'string' ? skillAny.workflowRules : undefined,
    documentation: Array.isArray(skillAny.documentation)
      ? (skillAny.documentation as MarketplaceSkill['documentation'])
      : undefined,
    hasScripts: typeof skillAny.hasScripts === 'boolean' ? skillAny.hasScripts : undefined,
    compatibility: typeof skillAny.compatibility === 'string' ? skillAny.compatibility : undefined,
    metadata:
      skillAny.metadata && typeof skillAny.metadata === 'object'
        ? (skillAny.metadata as Record<string, string>)
        : null,
  };
};

export const filterAndSortRemoteAgents = (
  agents: RemoteAgentMetadata[],
  options: {
    limit: number;
    offset: number;
    sortBy: MarketplaceSortBy;
    search?: string;
    categoryIds?: string[];
    tagIds?: string[];
    isFeatured?: boolean;
  }
) => {
  const { limit, offset, sortBy, search, categoryIds, tagIds, isFeatured } = options;

  let filtered = agents.filter((agent) => {
    const agentAny = agent as Record<string, unknown>;

    if (isFeatured !== undefined) {
      const featuredFlag = agentAny.isFeatured ?? false;
      if (featuredFlag !== isFeatured) return false;
    }

    if (search) {
      const term = search.toLowerCase();
      const name = normalizeString(agentAny.name).toLowerCase();
      const desc = normalizeString(agentAny.description).toLowerCase();
      const longDesc = normalizeString(agentAny.longDescription).toLowerCase();
      if (!name.includes(term) && !desc.includes(term) && !longDesc.includes(term)) {
        return false;
      }
    }

    if (categoryIds && categoryIds.length > 0) {
      const category = agentAny.category;
      if (!category || !categoryIds.includes(String(category))) return false;
    }

    if (tagIds && tagIds.length > 0) {
      const tags = (agentAny.tags || []) as string[];
      if (!Array.isArray(tags) || !tags.some((tag) => tagIds.includes(tag))) {
        return false;
      }
    }

    return true;
  });

  filtered = [...filtered].sort((a, b) => {
    const aAny = a as Record<string, unknown>;
    const bAny = b as Record<string, unknown>;

    switch (sortBy) {
      case 'recent': {
        const aDate = new Date(normalizeString(aAny.createdAt)).getTime();
        const bDate = new Date(normalizeString(bAny.createdAt)).getTime();
        return bDate - aDate;
      }
      case 'installs':
      case 'popular': {
        const aInstall = normalizeNumber(aAny.installCount, 0);
        const bInstall = normalizeNumber(bAny.installCount, 0);
        return bInstall - aInstall;
      }
      case 'name':
        return normalizeString(aAny.name).localeCompare(normalizeString(bAny.name));
      default:
        return 0;
    }
  });

  const total = filtered.length;
  const paginated = filtered.slice(offset, offset + limit);

  return { paginated, total };
};

export const filterAndSortRemoteSkills = (
  skills: RemoteSkillConfig[],
  options: {
    limit: number;
    offset: number;
    sortBy: SkillsMarketplaceSortBy;
    search?: string;
    categoryIds?: string[];
    tagIds?: string[];
    isFeatured?: boolean;
  }
) => {
  const { limit, offset, sortBy, search, categoryIds, tagIds, isFeatured } = options;

  let filtered = skills.filter((skill) => {
    const skillAny = skill as Record<string, unknown>;

    if (isFeatured !== undefined) {
      const featuredFlag = skillAny.isFeatured ?? false;
      if (featuredFlag !== isFeatured) return false;
    }

    if (search) {
      const term = search.toLowerCase();
      const name = normalizeString(skillAny.name).toLowerCase();
      const desc = normalizeString(skillAny.description).toLowerCase();
      const longDesc = normalizeString(skillAny.longDescription).toLowerCase();
      if (!name.includes(term) && !desc.includes(term) && !longDesc.includes(term)) {
        return false;
      }
    }

    if (categoryIds && categoryIds.length > 0) {
      const category = skillAny.category;
      if (!category || !categoryIds.includes(String(category))) return false;
    }

    if (tagIds && tagIds.length > 0) {
      const tags = (skillAny.tags || []) as string[];
      if (!Array.isArray(tags) || !tags.some((tag) => tagIds.includes(tag))) {
        return false;
      }
    }

    return true;
  });

  filtered = [...filtered].sort((a, b) => {
    const aAny = a as Record<string, unknown>;
    const bAny = b as Record<string, unknown>;

    switch (sortBy) {
      case 'recent': {
        const aDate = new Date(normalizeString(aAny.createdAt)).getTime();
        const bDate = new Date(normalizeString(bAny.createdAt)).getTime();
        return bDate - aDate;
      }
      case 'downloads':
      case 'installs':
      case 'popular': {
        const aInstall = normalizeNumber(aAny.installCount, 0);
        const bInstall = normalizeNumber(bAny.installCount, 0);
        return bInstall - aInstall;
      }
      case 'name':
        return normalizeString(aAny.name).localeCompare(normalizeString(bAny.name));
      case 'rating':
        return normalizeNumber(bAny.rating, 0) - normalizeNumber(aAny.rating, 0);
      case 'updated': {
        const aDate = new Date(normalizeString(aAny.updatedAt)).getTime();
        const bDate = new Date(normalizeString(bAny.updatedAt)).getTime();
        return bDate - aDate;
      }
      default:
        return 0;
    }
  });

  const total = filtered.length;
  const paginated = filtered.slice(offset, offset + limit);

  return { paginated, total };
};
