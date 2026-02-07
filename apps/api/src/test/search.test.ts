// Search API endpoint tests

import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { app } from '../index';
import { db } from '../db/client';
import { analyticsEvents, searchUsage } from '../db/schema';

// Test device and user IDs
const TEST_DEVICE_ID = 'test-search-device-123';
const TEST_DEVICE_ID_2 = 'test-search-device-456';

// Mock Serper API response
const mockSerperResponse = {
  organic: [
    {
      title: 'Test Result 1',
      link: 'https://example.com/1',
      snippet:
        'This is test content for result 1. It contains relevant information about the search query.',
    },
    {
      title: 'Test Result 2',
      link: 'https://example.com/2',
      snippet: 'This is test content for result 2. It also contains useful information.',
    },
  ],
};

// Mock fetch for Serper API
const originalFetch = global.fetch;
let fetchMock: ReturnType<typeof mock>;

beforeAll(async () => {
  console.log('\n🔧 Setting up search API test environment...\n');

  // Set test SERPER_API_KEY
  Bun.env.SERPER_API_KEY = 'test-serper-api-key';

  // Create tables if they don't exist
  try {
    // Create analytics_events table
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id TEXT PRIMARY KEY NOT NULL,
        device_id TEXT(255) NOT NULL,
        event_type TEXT(50) NOT NULL,
        session_id TEXT(255) NOT NULL,
        os_name TEXT(50),
        os_version TEXT(50),
        app_version TEXT(50),
        country TEXT(10),
        created_at INTEGER NOT NULL
      )
    `);

    // Create search_usage table
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS search_usage (
        id TEXT PRIMARY KEY NOT NULL,
        device_id TEXT(255) NOT NULL,
        user_id TEXT(255),
        search_count INTEGER DEFAULT 1 NOT NULL,
        usage_date TEXT(10) NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    
    await db.run(sql`
      CREATE INDEX IF NOT EXISTS search_usage_device_date_idx 
      ON search_usage (device_id, usage_date)
    `);
    
    await db.run(sql`
      CREATE INDEX IF NOT EXISTS search_usage_user_date_idx 
      ON search_usage (user_id, usage_date)
    `);
    
    await db.run(sql`
      CREATE INDEX IF NOT EXISTS search_usage_date_idx 
      ON search_usage (usage_date)
    `);
  } catch (error) {
    // Tables may already exist, continue
  }

  // Insert test analytics events to verify devices
  try {
    await db.insert(analyticsEvents).values([
      {
        deviceId: TEST_DEVICE_ID,
        eventType: 'session_start',
        sessionId: 'test-session-123',
        osName: 'macOS',
        appVersion: '1.0.0',
      },
      {
        deviceId: TEST_DEVICE_ID_2,
        eventType: 'session_start',
        sessionId: 'test-session-456',
        osName: 'Windows',
        appVersion: '1.0.0',
      },
    ]);
  } catch (error) {
    // Events may already exist, continue
  }

  // Mock fetch to intercept Serper API calls
  fetchMock = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    // Mock Serper API
    if (url.includes('google.serper.dev/search')) {
      return Promise.resolve(
        new Response(JSON.stringify(mockSerperResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }

    // For other URLs, use original fetch
    return originalFetch(input, init);
  });

  global.fetch = fetchMock;

  // Clean up test data
  await db.delete(searchUsage).where(eq(searchUsage.deviceId, TEST_DEVICE_ID));
  await db.delete(searchUsage).where(eq(searchUsage.deviceId, TEST_DEVICE_ID_2));
  await db.delete(analyticsEvents).where(eq(analyticsEvents.deviceId, TEST_DEVICE_ID));
  await db.delete(analyticsEvents).where(eq(analyticsEvents.deviceId, TEST_DEVICE_ID_2));

  console.log('✅ Test environment ready\n');
});

afterAll(async () => {
  console.log('\n🧹 Cleaning up search API test environment...\n');

  // Restore original fetch
  global.fetch = originalFetch;

  // Clean up test data
  await db.delete(searchUsage).where(eq(searchUsage.deviceId, TEST_DEVICE_ID));
  await db.delete(searchUsage).where(eq(searchUsage.deviceId, TEST_DEVICE_ID_2));

  console.log('✅ Cleanup complete\n');
});

beforeEach(async () => {
  // Clean up before each test
  await db.delete(searchUsage).where(eq(searchUsage.deviceId, TEST_DEVICE_ID));
  await db.delete(searchUsage).where(eq(searchUsage.deviceId, TEST_DEVICE_ID_2));

  // Ensure analytics events exist for test devices
  const existing = await db
    .select()
    .from(analyticsEvents)
    .where(eq(analyticsEvents.deviceId, TEST_DEVICE_ID))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(analyticsEvents).values([
      {
        deviceId: TEST_DEVICE_ID,
        eventType: 'session_start',
        sessionId: 'test-session-123',
        osName: 'macOS',
        appVersion: '1.0.0',
      },
      {
        deviceId: TEST_DEVICE_ID_2,
        eventType: 'session_start',
        sessionId: 'test-session-456',
        osName: 'Windows',
        appVersion: '1.0.0',
      },
    ]);
  }

  // Reset mock call count
  fetchMock.mockClear();
});

describe('Search API - POST /api/search', () => {
  it('should reject invalid device ID', async () => {
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': 'invalid-device-id-12345',
      },
      body: JSON.stringify({
        query: 'test query',
      }),
    });

    expect(res.status).toBe(429);

    const data = await res.json();
    expect(data.error).toContain('Invalid device ID');
  });

  it('should return search results for valid request', async () => {
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': TEST_DEVICE_ID,
      },
      body: JSON.stringify({
        query: 'test query',
      }),
    });

    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.results).toBeDefined();
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.usage).toBeDefined();
    expect(data.usage.remaining).toBe(99); // 100 - 1 = 99
    expect(data.usage.limit).toBe(100);
    expect(data.usage.used).toBe(1);

    // Check result structure
    const result = data.results[0];
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('url');
    expect(result).toHaveProperty('content');
  });

  it('should require X-Device-ID header', async () => {
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: 'test query',
      }),
    });

    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain('X-Device-ID');
  });

  it('should require valid JSON body', async () => {
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': TEST_DEVICE_ID,
      },
      body: 'invalid json',
    });

    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain('Invalid JSON');
  });

  it('should require query parameter', async () => {
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': TEST_DEVICE_ID,
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain('query');
  });

  it('should support numResults parameter', async () => {
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': TEST_DEVICE_ID,
      },
      body: JSON.stringify({
        query: 'test query',
        numResults: 5,
      }),
    });

    expect(res.status).toBe(200);
  });

  it('should support type parameter', async () => {
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': TEST_DEVICE_ID,
      },
      body: JSON.stringify({
        query: 'test query',
        type: 'fast',
      }),
    });

    expect(res.status).toBe(200);
  });

  it('should limit numResults to 20', async () => {
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': TEST_DEVICE_ID,
      },
      body: JSON.stringify({
        query: 'test query',
        numResults: 100, // Should be capped at 20
      }),
    });

    expect(res.status).toBe(200);
  });
});

describe('Search API - Rate Limiting', () => {
  it('should track search usage', async () => {
    // First search
    const res1 = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': TEST_DEVICE_ID,
      },
      body: JSON.stringify({ query: 'test 1' }),
    });

    const data1 = await res1.json();
    expect(data1.usage.used).toBe(1);
    expect(data1.usage.remaining).toBe(99);

    // Second search
    const res2 = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': TEST_DEVICE_ID,
      },
      body: JSON.stringify({ query: 'test 2' }),
    });

    const data2 = await res2.json();
    expect(data2.usage.used).toBe(2);
    expect(data2.usage.remaining).toBe(98);
  });

  it('should enforce rate limit for anonymous users', async () => {
    // Simulate 100 searches already made
    const today = new Date().toISOString().split('T')[0];
    await db.insert(searchUsage).values({
      deviceId: TEST_DEVICE_ID,
      searchCount: 100,
      usageDate: today,
    });

    // 101st search should be denied
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': TEST_DEVICE_ID,
      },
      body: JSON.stringify({ query: 'test' }),
    });

    expect(res.status).toBe(429);

    const data = await res.json();
    expect(data.error).toContain('limit exceeded');
    expect(data.usage).toBeDefined();
    expect(data.usage.remaining).toBe(0);
    expect(data.usage.used).toBe(100);
  });

  it('should isolate usage by device ID', async () => {
    // Device 1 makes 50 searches
    const today = new Date().toISOString().split('T')[0];
    await db.insert(searchUsage).values({
      deviceId: TEST_DEVICE_ID,
      searchCount: 50,
      usageDate: today,
    });

    // Device 2 should have independent limit
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': TEST_DEVICE_ID_2,
      },
      body: JSON.stringify({ query: 'test' }),
    });

    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.usage.used).toBe(1);
    expect(data.usage.remaining).toBe(99);
  });

  it('should handle concurrent requests correctly', async () => {
    // Make 5 concurrent requests
    const requests = Array.from({ length: 5 }, (_, i) =>
      app.request('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': TEST_DEVICE_ID,
        },
        body: JSON.stringify({ query: `test ${i}` }),
      })
    );

    const responses = await Promise.all(requests);

    // All should succeed
    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    // Final usage should be 5
    const finalRes = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': TEST_DEVICE_ID,
      },
      body: JSON.stringify({ query: 'final test' }),
    });

    const finalData = await finalRes.json();
    expect(finalData.usage.used).toBe(6);
  });
});

describe('Search API - GET /api/search/usage', () => {
  it('should return usage statistics', async () => {
    const res = await app.request('/api/search/usage', {
      method: 'GET',
      headers: {
        'X-Device-ID': TEST_DEVICE_ID,
      },
    });

    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.date).toBeDefined();
    expect(data.used).toBe(0);
    expect(data.limit).toBe(100);
    expect(data.remaining).toBe(100);
    expect(data.isAuthenticated).toBe(false);
  });

  it('should require X-Device-ID header', async () => {
    const res = await app.request('/api/search/usage', {
      method: 'GET',
    });

    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain('X-Device-ID');
  });

  it('should show updated usage after searches', async () => {
    // Make 3 searches
    for (let i = 0; i < 3; i++) {
      await app.request('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': TEST_DEVICE_ID,
        },
        body: JSON.stringify({ query: `test ${i}` }),
      });
    }

    // Check usage
    const res = await app.request('/api/search/usage', {
      method: 'GET',
      headers: {
        'X-Device-ID': TEST_DEVICE_ID,
      },
    });

    const data = await res.json();
    expect(data.used).toBe(3);
    expect(data.remaining).toBe(97);
  });
});

describe('Search API - GET /api/search/health', () => {
  it('should return health status', async () => {
    const res = await app.request('/api/search/health', {
      method: 'GET',
    });

    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.status).toBeDefined();
    expect(data.provider).toBe('serper');
    expect(data.timestamp).toBeDefined();
  });
});

describe('Search API - Integration', () => {
  it('should handle full search workflow', async () => {
    // 1. Check initial usage
    const usageRes1 = await app.request('/api/search/usage', {
      method: 'GET',
      headers: {
        'X-Device-ID': TEST_DEVICE_ID,
      },
    });
    const usage1 = await usageRes1.json();
    expect(usage1.used).toBe(0);

    // 2. Make a search
    const searchRes = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': TEST_DEVICE_ID,
      },
      body: JSON.stringify({
        query: 'latest AI news',
        numResults: 10,
      }),
    });

    expect(searchRes.status).toBe(200);
    const searchData = await searchRes.json();
    expect(searchData.results.length).toBeGreaterThan(0);
    expect(searchData.usage.used).toBe(1);

    // 3. Check updated usage
    const usageRes2 = await app.request('/api/search/usage', {
      method: 'GET',
      headers: {
        'X-Device-ID': TEST_DEVICE_ID,
      },
    });
    const usage2 = await usageRes2.json();
    expect(usage2.used).toBe(1);
    expect(usage2.remaining).toBe(99);
  });
});
