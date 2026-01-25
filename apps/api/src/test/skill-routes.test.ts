// Skill API routes tests
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { DEFAULT_CATEGORIES } from '@talkcody/shared';
import { db } from '../db/client';
import { marketplaceSkills, users } from '../db/schema';
import { app } from '../index';
import { signToken } from '../lib/jwt';
import { clearDatabase, seedTestDatabase } from './fixtures';

let testUserId: string;
let authToken: string;
let testCategorySlug: string;

beforeAll(async () => {
  console.log('\n🔧 Setting up Skill Routes tests...\n');

  const _testData = await seedTestDatabase();

  // Get test user and create auth token
  const usersResult = await db.select().from(users).limit(1);
  if (usersResult.length === 0) {
    throw new Error('No test users found');
  }
  testUserId = usersResult[0].id;

  // Create a valid JWT token for testing
  const token = await signToken({
    userId: testUserId,
    username: usersResult[0].username,
    email: usersResult[0].email || undefined,
  });
  authToken = `Bearer ${token}`;

  testCategorySlug = DEFAULT_CATEGORIES[0].slug;

  console.log('✅ Skill Routes test setup complete\n');
});

afterAll(async () => {
  console.log('\n🧹 Cleaning up Skill Routes tests...\n');
  await clearDatabase();
  console.log('✅ Cleanup complete\n');
});

describe('POST /api/skills - Create Skill', () => {
  it('should create a new skill with valid data', async () => {
    const skillData = {
      name: `API Test Skill ${Date.now()}`,
      description: 'A skill created via API',
      longDescription: 'Detailed description of the skill',
      systemPromptFragment: 'You are a helpful assistant',
      workflowRules: 'Follow best practices',
      documentation: [
        {
          type: 'inline',
          title: 'Introduction',
          content: 'This is the introduction',
        },
      ],
      iconUrl: 'https://example.com/icon.png',
      categories: [testCategorySlug],
      tags: ['api', 'test'],
    };

    const res = await app.request('/api/skills', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken,
      },
      body: JSON.stringify(skillData),
    });

    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.skill).toBeDefined();
    expect(data.skill.name).toBe(skillData.name);
    expect(data.skill.description).toBe(skillData.description);
    expect(data.skill.isPublished).toBe(false);
  });

  it('should fail without authentication', async () => {
    const skillData = {
      name: 'Unauthorized Skill',
      description: 'Should fail',
      documentation: [],
      categories: [testCategorySlug],
      tags: [],
    };

    const res = await app.request('/api/skills', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(skillData),
    });

    expect(res.status).toBe(401);
  });

  it('should fail with missing required fields', async () => {
    const invalidData = {
      name: 'Missing Description',
      // Missing description and documentation
      categories: [testCategorySlug],
      tags: [],
    };

    const res = await app.request('/api/skills', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken,
      },
      body: JSON.stringify(invalidData),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Missing required fields');
  });
});

describe('PATCH /api/skills/:skillId - Update Skill', () => {
  let testSkillId: string;

  beforeEach(async () => {
    // Create a skill to update
    const skillData = {
      name: `Skill to Update via API ${Date.now()}`,
      description: 'Original description',
      documentation: [],
      categories: [testCategorySlug],
      tags: [],
    };

    const createRes = await app.request('/api/skills', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken,
      },
      body: JSON.stringify(skillData),
    });

    const createData = await createRes.json();
    testSkillId = createData.skill.id;
  });

  afterEach(async () => {
    // Clean up the test skill
    if (testSkillId) {
      try {
        await app.request(`/api/skills/${testSkillId}`, {
          method: 'DELETE',
          headers: { Authorization: authToken },
        });
      } catch (_e) {
        // Ignore errors if already deleted
      }
    }
  });

  it('should update skill successfully', async () => {
    const updates = {
      name: `Updated Skill Name ${Date.now()}${Math.random()}`,
      description: 'Updated description',
      tags: ['updated'],
    };

    const res = await app.request(`/api/skills/${testSkillId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken,
      },
      body: JSON.stringify(updates),
    });

    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.skill.name).toBe(updates.name);
    expect(data.skill.description).toBe(updates.description);
  });

  it('should fail to update non-existent skill', async () => {
    const res = await app.request('/api/skills/non-existent-id', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken,
      },
      body: JSON.stringify({ name: 'New Name' }),
    });

    expect(res.status).toBe(404);
  });
});

describe('POST /api/skills/:skillId/publish - Publish Skill', () => {
  let testSkillId: string;

  beforeEach(async () => {
    const skillData = {
      name: `Skill to Publish via API ${Date.now()}`,
      description: 'Test publishing',
      documentation: [],
      categories: [testCategorySlug],
      tags: [],
    };

    const createRes = await app.request('/api/skills', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken,
      },
      body: JSON.stringify(skillData),
    });

    const createData = await createRes.json();
    testSkillId = createData.skill.id;
  });

  afterEach(async () => {
    // Clean up the test skill
    if (testSkillId) {
      try {
        await app.request(`/api/skills/${testSkillId}`, {
          method: 'DELETE',
          headers: { Authorization: authToken },
        });
      } catch (_e) {
        // Ignore errors if already deleted
      }
    }
  });

  it('should publish skill successfully', async () => {
    const res = await app.request(`/api/skills/${testSkillId}/publish`, {
      method: 'POST',
      headers: {
        Authorization: authToken,
      },
    });

    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.skill.isPublished).toBe(true);
    expect(data.skill.publishedAt).toBeDefined();
  });

  it('should fail without authentication', async () => {
    const res = await app.request(`/api/skills/${testSkillId}/publish`, {
      method: 'POST',
    });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/skills/:skillId/unpublish - Unpublish Skill', () => {
  let testSkillId: string;

  beforeEach(async () => {
    const skillData = {
      name: `Skill to Unpublish via API ${Date.now()}`,
      description: 'Test unpublishing',
      documentation: [],
      categories: [testCategorySlug],
      tags: [],
    };

    const createRes = await app.request('/api/skills', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken,
      },
      body: JSON.stringify(skillData),
    });

    const createData = await createRes.json();
    testSkillId = createData.skill.id;

    // Publish first
    await app.request(`/api/skills/${testSkillId}/publish`, {
      method: 'POST',
      headers: {
        Authorization: authToken,
      },
    });
  });

  afterEach(async () => {
    // Clean up the test skill
    if (testSkillId) {
      try {
        await app.request(`/api/skills/${testSkillId}`, {
          method: 'DELETE',
          headers: { Authorization: authToken },
        });
      } catch (_e) {
        // Ignore errors if already deleted
      }
    }
  });

  it('should unpublish skill successfully', async () => {
    const res = await app.request(`/api/skills/${testSkillId}/unpublish`, {
      method: 'POST',
      headers: {
        Authorization: authToken,
      },
    });

    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.skill.isPublished).toBe(false);
  });
});

describe('DELETE /api/skills/:skillId - Delete Skill', () => {
  it('should delete skill successfully', async () => {
    // Create a skill to delete
    const skillData = {
      name: 'Skill to Delete via API',
      description: 'Will be deleted',
      documentation: [],
      categories: [testCategorySlug],
      tags: [],
    };

    const createRes = await app.request('/api/skills', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken,
      },
      body: JSON.stringify(skillData),
    });

    const createData = await createRes.json();
    const skillId = createData.skill.id;

    // Delete the skill
    const deleteRes = await app.request(`/api/skills/${skillId}`, {
      method: 'DELETE',
      headers: {
        Authorization: authToken,
      },
    });

    expect(deleteRes.status).toBe(200);

    const deleteData = await deleteRes.json();
    expect(deleteData.message).toContain('deleted successfully');

    // Verify skill is deleted
    const verifyRes = await db
      .select()
      .from(marketplaceSkills)
      .where(eq(marketplaceSkills.id, skillId))
      .limit(1);

    expect(verifyRes.length).toBe(0);
  });

  it('should fail to delete non-existent skill', async () => {
    const res = await app.request('/api/skills/non-existent-id', {
      method: 'DELETE',
      headers: {
        Authorization: authToken,
      },
    });

    expect(res.status).toBe(404);
  });
});

describe('POST /api/skills/:skillId/versions - Create Version', () => {
  let testSkillId: string;

  beforeEach(async () => {
    const skillData = {
      name: `Versioned Skill via API ${Date.now()}`,
      description: 'Test versioning',
      documentation: [],
      categories: [testCategorySlug],
      tags: [],
    };

    const createRes = await app.request('/api/skills', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken,
      },
      body: JSON.stringify(skillData),
    });

    const createData = await createRes.json();
    testSkillId = createData.skill.id;
  });

  afterEach(async () => {
    // Clean up the test skill
    if (testSkillId) {
      try {
        await app.request(`/api/skills/${testSkillId}`, {
          method: 'DELETE',
          headers: { Authorization: authToken },
        });
      } catch (_e) {
        // Ignore errors if already deleted
      }
    }
  });

  it('should create new version successfully', async () => {
    const versionData = {
      version: '1.1.0',
      systemPromptFragment: 'Updated prompt',
      changeLog: 'Added new features',
    };

    const res = await app.request(`/api/skills/${testSkillId}/versions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken,
      },
      body: JSON.stringify(versionData),
    });

    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.version.version).toBe('1.1.0');
    expect(data.version.changeLog).toBe(versionData.changeLog);
  });

  it('should fail with missing version or changeLog', async () => {
    const invalidData = {
      version: '1.2.0',
      // Missing changeLog
    };

    const res = await app.request(`/api/skills/${testSkillId}/versions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken,
      },
      body: JSON.stringify(invalidData),
    });

    expect(res.status).toBe(400);
  });

  it('should fail to create duplicate version', async () => {
    const versionData = {
      version: '1.0.0', // Already exists
      changeLog: 'Duplicate version',
    };

    const res = await app.request(`/api/skills/${testSkillId}/versions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken,
      },
      body: JSON.stringify(versionData),
    });

    expect(res.status).toBe(409);
  });
});
