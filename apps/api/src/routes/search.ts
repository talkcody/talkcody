// Search API route - Proxies Serper search requests with rate limiting

import { Hono } from 'hono';
import { getOptionalAuth, optionalAuthMiddleware } from '../middlewares/auth';
import { searchUsageService } from '../services/search-usage-service';
import type { HonoContext } from '../types/context';

const search = new Hono<HonoContext>();

// Serper API types
interface SerperSearchResult {
  title: string;
  link: string;
  snippet?: string;
}

interface SerperSearchResponse {
  organic?: SerperSearchResult[];
}

// Web search result format (frontend compatible)
interface WebSearchResult {
  title: string;
  url: string;
  content: string;
}

// Request body schema
interface SearchRequest {
  query: string;
  numResults?: number; // default 10, max 20
  type?: 'auto' | 'neural' | 'fast' | 'deep'; // default 'auto'
}

// Response schema
interface SearchResponse {
  results: WebSearchResult[];
  usage: {
    remaining: number;
    limit: number;
    used: number;
  };
}

/**
 * Get SERPER_API_KEY from environment
 */
function getSerperApiKey(env?: HonoContext['Bindings']): string | undefined {
  if (typeof Bun !== 'undefined') {
    return Bun.env.SERPER_API_KEY;
  }
  return env?.SERPER_API_KEY;
}

/**
 * Call Serper API
 */
async function callSerperApi(
  query: string,
  numResults: number,
  apiKey: string
): Promise<SerperSearchResponse> {
  const endpoint = 'https://google.serper.dev/search';

  const body = {
    q: query,
    num: numResults,
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Serper API error: ${response.status} - ${errorText}`);
  }

  return (await response.json()) as SerperSearchResponse;
}

/**
 * Transform Serper results to WebSearchResult format
 */
function transformSerperResults(serperResults: SerperSearchResult[]): WebSearchResult[] {
  return serperResults.map((result) => ({
    title: result.title,
    url: result.link,
    content: (result.snippet || '').substring(0, 10000),
  }));
}

/**
 * POST /api/search
 * Search endpoint with rate limiting
 */
search.post('/', optionalAuthMiddleware, async (c) => {
  // Get device ID from header (required)
  const deviceId = c.req.header('X-Device-ID');
  if (!deviceId) {
    return c.json(
      {
        error: 'Missing X-Device-ID header',
      },
      400
    );
  }

  // Get optional user ID from auth
  const auth = getOptionalAuth(c);
  const userId = auth?.userId;

  // Parse request body
  let requestBody: SearchRequest;
  try {
    requestBody = await c.req.json();
  } catch {
    return c.json(
      {
        error: 'Invalid JSON body',
      },
      400
    );
  }

  // Validate request
  if (!requestBody.query || typeof requestBody.query !== 'string') {
    return c.json(
      {
        error: 'Missing or invalid query parameter',
      },
      400
    );
  }

  const numResults = Math.min(requestBody.numResults || 10, 20);

  // Check rate limits
  try {
    const usageCheck = await searchUsageService.checkSearchLimits(deviceId, userId);

    if (!usageCheck.allowed) {
      return c.json(
        {
          error: usageCheck.reason || 'Rate limit exceeded',
          usage: {
            remaining: usageCheck.remaining,
            limit: usageCheck.limit,
            used: usageCheck.used,
          },
        },
        429
      );
    }

    // Get Serper API key
    const serperApiKey = getSerperApiKey(c.env);
    if (!serperApiKey) {
      console.error('SERPER_API_KEY is not configured');
      return c.json(
        {
          error: 'Search service not configured',
        },
        500
      );
    }

    // Call Serper API
    const serperResponse = await callSerperApi(requestBody.query, numResults, serperApiKey);

    // Transform results
    const results = transformSerperResults(serperResponse.organic || []);

    // Record usage
    await searchUsageService.recordSearch(deviceId, userId);

    // Get updated usage stats
    const stats = await searchUsageService.getSearchStats(deviceId, userId);

    // Return results with usage info
    const response: SearchResponse = {
      results,
      usage: {
        remaining: stats.remaining,
        limit: stats.limit,
        used: stats.used,
      },
    };

    return c.json(response, 200);
  } catch (error) {
    console.error('Search API error:', error);

    // Handle Serper API errors
    if (error instanceof Error && error.message.includes('Serper API error')) {
      return c.json(
        {
          error: 'Search provider error',
          details: error.message,
        },
        500
      );
    }

    return c.json(
      {
        error: 'Internal server error',
      },
      500
    );
  }
});

/**
 * GET /api/search/usage
 * Get search usage statistics
 */
search.get('/usage', optionalAuthMiddleware, async (c) => {
  const deviceId = c.req.header('X-Device-ID');
  if (!deviceId) {
    return c.json(
      {
        error: 'Missing X-Device-ID header',
      },
      400
    );
  }

  const auth = getOptionalAuth(c);
  const userId = auth?.userId;

  try {
    const stats = await searchUsageService.getSearchStats(deviceId, userId);
    return c.json(stats);
  } catch (error) {
    console.error('Failed to get search stats:', error);
    return c.json({ error: 'Failed to get search statistics' }, 500);
  }
});

/**
 * GET /api/search/health
 * Health check for search endpoint
 */
search.get('/health', async (c) => {
  const serperApiKey = getSerperApiKey(c.env);

  return c.json({
    status: serperApiKey ? 'ok' : 'not_configured',
    provider: 'serper',
    timestamp: new Date().toISOString(),
  });
});

export default search;
