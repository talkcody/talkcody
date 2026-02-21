// Skills Marketplace browsing routes (compatibility layer for legacy clients)
import { Hono } from 'hono';
import { optionalAuthMiddleware } from '../middlewares/auth';
import {
  filterAndSortRemoteSkills,
  normalizeRemoteSkill,
} from '../services/marketplace-compat-service';
import { remoteSkillsService } from '../services/remote-skills-service';

const skillsMarketplace = new Hono();

/**
 * List skills with filtering and sorting
 * GET /api/skills-marketplace/skills?limit=20&offset=0&sortBy=popular&search=xxxx&categoryIds=cat1,cat2&tagIds=tag1,tag2&isFeatured=true
 */
skillsMarketplace.get('/skills', optionalAuthMiddleware, (c) => {
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const sortBy = (c.req.query('sortBy') || 'popular') as
    | 'popular'
    | 'recent'
    | 'downloads'
    | 'installs'
    | 'name'
    | 'rating'
    | 'updated';
  const search = c.req.query('search') || undefined;
  const categoryIds = c.req.query('categoryIds')?.split(',').filter(Boolean);
  const tagIds = c.req.query('tagIds')?.split(',').filter(Boolean);
  const isFeatured = c.req.query('isFeatured') ? c.req.query('isFeatured') === 'true' : undefined;

  const configs = remoteSkillsService.getConfigs();
  const { paginated, total } = filterAndSortRemoteSkills(configs.remoteSkills, {
    limit,
    offset,
    sortBy,
    search,
    categoryIds,
    tagIds,
    isFeatured,
  });

  return c.json({
    skills: paginated.map(normalizeRemoteSkill),
    total,
    limit,
    offset,
  });
});

/**
 * Get featured skills
 * GET /api/skills-marketplace/skills/featured?limit=10
 */
skillsMarketplace.get('/skills/featured', (c) => {
  const limit = parseInt(c.req.query('limit') || '10', 10);
  const configs = remoteSkillsService.getConfigs();
  const { paginated, total } = filterAndSortRemoteSkills(configs.remoteSkills, {
    limit,
    offset: 0,
    sortBy: 'popular',
    isFeatured: true,
  });

  return c.json({
    skills: paginated.map(normalizeRemoteSkill),
    total,
    limit,
    offset: 0,
  });
});

/**
 * Get skill by slug
 * GET /api/skills-marketplace/skills/:slug
 */
skillsMarketplace.get('/skills/:slug', (c) => {
  const slug = c.req.param('slug');
  const configs = remoteSkillsService.getConfigs();
  const skill = configs.remoteSkills.find(
    (item) => (item as { slug?: string; id?: string }).slug === slug || item.id === slug
  );

  if (!skill) {
    return c.json({ error: 'Skill not found' }, 404);
  }

  return c.json({ skill: normalizeRemoteSkill(skill) });
});

/**
 * Download skill (tracking disabled)
 * POST /api/skills-marketplace/skills/:slug/download
 */
skillsMarketplace.post('/skills/:slug/download', optionalAuthMiddleware, (c) => {
  const slug = c.req.param('slug');
  const configs = remoteSkillsService.getConfigs();
  const skill = configs.remoteSkills.find(
    (item) => (item as { slug?: string; id?: string }).slug === slug || item.id === slug
  );

  if (!skill) {
    return c.json({ error: 'Skill not found' }, 404);
  }

  return c.json({
    message: 'Download tracking disabled',
    skill: normalizeRemoteSkill(skill),
  });
});

/**
 * Install skill (tracking disabled)
 * POST /api/skills-marketplace/skills/:slug/install
 * Body: { version: "1.0.0" }
 */
skillsMarketplace.post('/skills/:slug/install', optionalAuthMiddleware, async (c) => {
  const slug = c.req.param('slug');
  const body = await c.req.json().catch(() => ({}));
  const version = (body as { version?: string }).version;

  if (!version) {
    return c.json({ error: 'Version is required' }, 400);
  }

  const configs = remoteSkillsService.getConfigs();
  const skill = configs.remoteSkills.find(
    (item) => (item as { slug?: string; id?: string }).slug === slug || item.id === slug
  );

  if (!skill) {
    return c.json({ error: 'Skill not found' }, 404);
  }

  return c.json({
    message: 'Installation tracking disabled',
  });
});

/**
 * Get all categories
 * GET /api/skills-marketplace/categories
 */
skillsMarketplace.get('/categories', (c) => {
  const configs = remoteSkillsService.getConfigs();
  const categories = new Map<
    string,
    {
      id: string;
      name: string;
      slug: string;
      description?: string;
      icon?: string;
      displayOrder: number;
    }
  >();

  for (const skill of configs.remoteSkills) {
    const category = (skill as { category?: string }).category;
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
 * GET /api/skills-marketplace/tags
 */
skillsMarketplace.get('/tags', (c) => {
  const configs = remoteSkillsService.getConfigs();
  const tags = new Map<string, { id: string; name: string; slug: string; usageCount: number }>();

  for (const skill of configs.remoteSkills) {
    const tagList = ((skill as { tags?: string[] }).tags || []) as string[];
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

export default skillsMarketplace;
