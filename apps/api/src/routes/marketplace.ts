// Marketplace browsing routes (compatibility layer for legacy clients)
import { Hono } from 'hono';
import {
  filterAndSortRemoteAgents,
  normalizeRemoteAgent,
} from '../services/marketplace-compat-service';
import { remoteAgentsService } from '../services/remote-agents-service';

const marketplace = new Hono();

type SortBy = 'popular' | 'recent' | 'installs' | 'name';

const parseBool = (value: string | null | undefined): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

/**
 * List agents with filtering and sorting
 * GET /api/marketplace/agents?limit=20&offset=0&sortBy=popular&search=coding&categoryIds=cat1,cat2&tagIds=tag1,tag2&isFeatured=true
 */
marketplace.get('/agents', (c) => {
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const sortBy = (c.req.query('sortBy') || 'popular') as SortBy;
  const search = c.req.query('search') || undefined;
  const categoryIds = c.req.query('categoryIds')?.split(',').filter(Boolean);
  const tagIds = c.req.query('tagIds')?.split(',').filter(Boolean);
  const isFeatured = parseBool(c.req.query('isFeatured'));

  const configs = remoteAgentsService.getConfigs();
  const { paginated, total } = filterAndSortRemoteAgents(configs.remoteAgents, {
    limit,
    offset,
    sortBy,
    search,
    categoryIds,
    tagIds,
    isFeatured,
  });

  return c.json({
    count: total,
    total,
    limit,
    offset,
    agents: paginated.map(normalizeRemoteAgent),
  });
});

/**
 * Get featured agents
 * GET /api/marketplace/agents/featured?limit=10
 */
marketplace.get('/agents/featured', (c) => {
  const limit = parseInt(c.req.query('limit') || '10', 10);
  const configs = remoteAgentsService.getConfigs();
  const { paginated, total } = filterAndSortRemoteAgents(configs.remoteAgents, {
    limit,
    offset: 0,
    sortBy: 'popular',
    isFeatured: true,
  });

  return c.json({
    count: total,
    total,
    limit,
    offset: 0,
    agents: paginated.map(normalizeRemoteAgent),
  });
});

/**
 * Get agent by slug
 * GET /api/marketplace/agents/:slug
 */
marketplace.get('/agents/:slug', (c) => {
  const slug = c.req.param('slug');
  const configs = remoteAgentsService.getConfigs();
  const agent = configs.remoteAgents.find(
    (item) => (item as { slug?: string; id?: string }).slug === slug || item.id === slug
  );

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return c.json({ agent: normalizeRemoteAgent(agent) });
});

/**
 * Download agent (tracking disabled)
 * POST /api/marketplace/agents/:slug/download
 */
marketplace.get('/agents/:slug/download', (c) => {
  const slug = c.req.param('slug');
  const configs = remoteAgentsService.getConfigs();
  const agent = configs.remoteAgents.find(
    (item) => (item as { slug?: string; id?: string }).slug === slug || item.id === slug
  );

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return c.json({
    message: 'Download tracking disabled',
    agent: normalizeRemoteAgent(agent),
  });
});

/**
 * Install agent (tracking disabled)
 * POST /api/marketplace/agents/:slug/install
 */
marketplace.post('/agents/:slug/install', (c) => {
  const slug = c.req.param('slug');
  const configs = remoteAgentsService.getConfigs();
  const agent = configs.remoteAgents.find(
    (item) => (item as { slug?: string; id?: string }).slug === slug || item.id === slug
  );

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return c.json({
    message: 'Installation tracking disabled',
  });
});

/**
 * Get all categories
 * GET /api/marketplace/categories
 */
marketplace.get('/categories', (c) => {
  const configs = remoteAgentsService.getConfigs();
  const categories = new Map<
    string,
    {
      id: string;
      name: string;
      slug: string;
      description: string;
      icon?: string;
      displayOrder: number;
    }
  >();

  for (const agent of configs.remoteAgents) {
    const category = (agent as { category?: string }).category;
    if (category && !categories.has(category)) {
      categories.set(category, {
        id: category,
        name: category,
        slug: category,
        description: '',
        icon: undefined,
        displayOrder: 0,
      });
    }
  }

  return c.json({ categories: Array.from(categories.values()) });
});

/**
 * Get all tags
 * GET /api/marketplace/tags
 */
marketplace.get('/tags', (c) => {
  const configs = remoteAgentsService.getConfigs();
  const tags = new Map<string, { id: string; name: string; slug: string; usageCount: number }>();

  for (const agent of configs.remoteAgents) {
    const tagList = ((agent as { tags?: string[] }).tags || []) as string[];
    if (Array.isArray(tagList)) {
      for (const tag of tagList) {
        if (!tags.has(tag)) {
          tags.set(tag, { id: tag, name: tag, slug: tag, usageCount: 0 });
        }
      }
    }
  }

  return c.json({ tags: Array.from(tags.values()) });
});

export default marketplace;
