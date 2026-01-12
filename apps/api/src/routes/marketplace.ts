// Marketplace browsing routes
import { Hono } from 'hono';
import { remoteAgentsService } from '../services/remote-agents-service';

const marketplace = new Hono();

/**
 * List agents with filtering and sorting
 * GET /api/marketplace/agents?limit=20&offset=0&sortBy=popular&search=coding&categoryIds=cat1,cat2&tagIds=tag1,tag2&isFeatured=true
 */
marketplace.get('/agents', (c) => {
  const configs = remoteAgentsService.getConfigs();
  return c.json({
    count: configs.remoteAgents.length,
    agents: configs.remoteAgents,
  });
});

/**
 * Get featured agents
 * GET /api/marketplace/agents/featured?limit=10
 */
marketplace.get('/agents/featured', (c) => {
  const configs = remoteAgentsService.getConfigs();
  const limit = parseInt(c.req.query('limit') || '10', 10);
  const agents = configs.remoteAgents.slice(0, limit);

  return c.json({
    count: agents.length,
    agents,
  });
});

/**
 * Get agent by slug
 * GET /api/marketplace/agents/:slug
 */
marketplace.get('/agents/:slug', (c) => {
  const slug = c.req.param('slug');
  const agent = remoteAgentsService.getRemoteAgent(slug);

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return c.json({ agent });
});

/**
 * Download agent (track statistics)
 * POST /api/marketplace/agents/:slug/download
 */
marketplace.get('/agents/:slug/download', (c) => {
  const slug = c.req.param('slug');
  const agent = remoteAgentsService.getRemoteAgent(slug);

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return c.json({
    message: 'Download tracking disabled',
    agent,
  });
});

/**
 * Install agent (tracking disabled)
 * POST /api/marketplace/agents/:slug/install
 */
marketplace.post('/agents/:slug/install', (c) => {
  const slug = c.req.param('slug');
  const agent = remoteAgentsService.getRemoteAgent(slug);

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
  const categories = new Set<string>();

  for (const agent of configs.remoteAgents) {
    if (agent.category) {
      categories.add(agent.category);
    }
  }

  return c.json({ categories: Array.from(categories) });
});

/**
 * Get all tags
 * GET /api/marketplace/tags
 */
marketplace.get('/tags', (c) => {
  return c.json({ tags: [] });
});

export default marketplace;
