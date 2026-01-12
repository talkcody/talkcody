// TalkCody Agent Marketplace API
// Built with Hono and Bun

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { checkDatabaseConnection } from './db/client';
import { errorHandler } from './middlewares/error-handler';
import agentRoutes from './routes/agents';
import analyticsRoutes from './routes/analytics';
// Import routes
import authRoutes from './routes/auth';
import marketplaceRoutes from './routes/marketplace';
import modelsRoutes from './routes/models';
import remoteAgentsRoutes from './routes/remote-agents';
import remoteSkillsRoutes from './routes/remote-skills';
import searchRoutes from './routes/search';
import shareRoutes from './routes/shares';
import skillRoutes from './routes/skills';
import skillsMarketplaceRoutes from './routes/skills-marketplace';
import talkcodyProviderRoutes from './routes/talkcody-provider';
import updatesRoutes from './routes/updates';
import userRoutes from './routes/users';
import type { HonoContext } from './types/context';

const app = new Hono<HonoContext>();

// Determine if running in development mode
const isDevelopment = typeof Bun !== 'undefined' ? Bun.env.NODE_ENV !== 'production' : false;

// CORS origins based on environment
const corsOrigins: string[] = [
  'tauri://localhost', // Tauri app always needs access
];

// Only allow localhost origins in development
if (isDevelopment) {
  corsOrigins.push('http://localhost:1420', 'http://localhost:5173');
}

// Global middlewares
app.use('*', logger());
app.use('*', prettyJSON());
app.use(
  '*',
  cors({
    origin: corsOrigins,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Device-ID'],
    exposeHeaders: ['X-TalkCody-Remaining-Tokens'],
  })
);

// Initialize database connection for Cloudflare Workers
app.use('*', async (c, next) => {
  if (c.env) {
    // Initialize DB with environment variables from Cloudflare Workers
    const { getDb } = await import('./db/client');
    getDb(c.env);
  }
  await next();
});

// Health check endpoint
app.get('/health', async (c) => {
  const dbHealthy = await checkDatabaseConnection(c.env);
  const runtime = typeof Bun !== 'undefined' ? 'bun' : 'cloudflare-workers';
  const version = typeof Bun !== 'undefined' ? Bun.version : 'n/a';

  return c.json({
    status: 'ok',
    runtime,
    version,
    database: dbHealthy ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

// API info
app.get('/', (c) => {
  return c.json({
    name: 'TalkCody Agent Marketplace API',
    version: '1.0.0',
    docs: '/api/docs',
    health: '/health',
  });
});

// API routes
app.route('/api/auth', authRoutes);
app.route('/api/marketplace', marketplaceRoutes);
app.route('/api/skills-marketplace', skillsMarketplaceRoutes);
app.route('/api/agents', agentRoutes);
app.route('/api/skills', skillRoutes);
app.route('/api/users', userRoutes);
app.route('/api/models', modelsRoutes);
app.route('/api/remote-skills', remoteSkillsRoutes);
app.route('/api/remote-agents', remoteAgentsRoutes);
app.route('/api/updates', updatesRoutes);
app.route('/api/analytics', analyticsRoutes);
app.route('/api/talkcody', talkcodyProviderRoutes);
app.route('/api/search', searchRoutes);
app.route('/api/shares', shareRoutes);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError(errorHandler);

// Conditional export based on runtime environment
// Check if we're running in Bun (local dev) or Cloudflare Workers
const isBunRuntime = typeof Bun !== 'undefined';

// Scheduled handler for cron triggers (Cloudflare Workers only)
export async function scheduled(
  event: ScheduledEvent,
  env: HonoContext['env'],
  _ctx: ExecutionContext
) {
  console.log('[Cron] Running scheduled task:', event.cron);

  try {
    // Initialize database
    const { getDb } = await import('./db/client');
    const { db } = getDb(env);

    // Import and run cleanup
    const { ShareService } = await import('./services/share-service');
    const shareService = new ShareService(db);
    const deletedCount = await shareService.cleanupExpiredShares();

    console.log(`[Cron] Cleaned up ${deletedCount} expired shares`);
  } catch (error) {
    console.error('[Cron] Failed to run cleanup:', error);
  }
}

// Export for Cloudflare Workers (when Bun is not available)
// Export for Bun runtime (when Bun is available)
export default isBunRuntime
  ? {
      port: parseInt(Bun.env.PORT || '3000', 10),
      fetch: app.fetch,
      development: Bun.env.NODE_ENV !== 'production',
    }
  : app;

// Also export the app explicitly for Cloudflare Workers compatibility
export { app };
