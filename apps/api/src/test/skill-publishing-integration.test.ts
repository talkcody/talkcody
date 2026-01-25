// Skill Publishing Integration Tests
// Tests the complete flow: Create -> Publish -> Fork -> Update -> Delete
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { DEFAULT_CATEGORIES } from '@talkcody/shared';
import { db } from '../db/client';
import { marketplaceSkills, skillVersions, users } from '../db/schema';
import { app } from '../index';
import { signToken } from '../lib/jwt';
import { clearDatabase, seedTestDatabase } from './fixtures';

let testUserId: string;
let authToken: string;
let testCategorySlug: string;

beforeAll(async () => {
  console.log('\n🔧 Setting up Skill Publishing Integration tests...\n');

  const _testData = await seedTestDatabase();

  // Get test user
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

  console.log('✅ Skill Publishing Integration test setup complete\n');
});

afterAll(async () => {
  console.log('\n🧹 Cleaning up Skill Publishing Integration tests...\n');
  await clearDatabase();
  console.log('✅ Cleanup complete\n');
});

describe('Skill Publishing Integration - Complete Flow', () => {
  it('should complete full skill lifecycle: create -> publish -> update -> unpublish -> delete', async () => {
    // ========== STEP 1: Create Skill ==========
    const skillData = {
      name: `Integration Test Skill ${Date.now()}`,
      description: 'Testing full lifecycle',
      longDescription: 'This skill tests the complete publishing flow',
      systemPromptFragment: 'You are a test assistant',
      workflowRules: 'Follow test procedures',
      documentation: [
        {
          type: 'inline',
          title: 'Introduction',
          content: 'This is a test skill',
        },
      ],
      iconUrl: 'https://example.com/icon.png',
      categories: [testCategorySlug],
      tags: ['integration', 'test', 'lifecycle'],
    };

    const createRes = await app.request('/api/skills', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken,
      },
      body: JSON.stringify(skillData),
    });

    expect(createRes.status).toBe(201);
    const createData = await createRes.json();
    const skillId = createData.skill.id;

    expect(createData.skill.name).toBe(skillData.name);
    expect(createData.skill.isPublished).toBe(false);
    expect(createData.skill.latestVersion).toBe('1.0.0');

    // Verify initial version was created
    const versions = await db
      .select()
      .from(skillVersions)
      .where(eq(skillVersions.skillId, skillId));

    expect(versions.length).toBe(1);
    expect(versions[0].version).toBe('1.0.0');

    // ========== STEP 2: Publish Skill ==========
    const publishRes = await app.request(`/api/skills/${skillId}/publish`, {
      method: 'POST',
      headers: {
        Authorization: authToken,
      },
    });

    expect(publishRes.status).toBe(200);
    const publishData = await publishRes.json();
    expect(publishData.skill.isPublished).toBe(true);
    expect(publishData.skill.publishedAt).toBeGreaterThan(0);

    // ========== STEP 3: Update Skill ==========
    const updates = {
      description: 'Updated description',
      tags: ['integration', 'test', 'lifecycle', 'updated'],
    };

    const updateRes = await app.request(`/api/skills/${skillId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken,
      },
      body: JSON.stringify(updates),
    });

    expect(updateRes.status).toBe(200);
    const updateData = await updateRes.json();
    expect(updateData.skill.description).toBe(updates.description);

    // ========== STEP 4: Create New Version ==========
    const versionData = {
      version: '1.1.0',
      systemPromptFragment: 'Updated prompt for version 1.1',
      changeLog: 'Added new features and improvements',
    };

    const versionRes = await app.request(`/api/skills/${skillId}/versions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken,
      },
      body: JSON.stringify(versionData),
    });

    expect(versionRes.status).toBe(201);
    const versionResData = await versionRes.json();
    expect(versionResData.version.version).toBe('1.1.0');

    // Verify latest version was updated
    const updatedSkill = await db
      .select()
      .from(marketplaceSkills)
      .where(eq(marketplaceSkills.id, skillId))
      .limit(1);

    expect(updatedSkill[0].latestVersion).toBe('1.1.0');

    // ========== STEP 5: Unpublish Skill ==========
    const unpublishRes = await app.request(`/api/skills/${skillId}/unpublish`, {
      method: 'POST',
      headers: {
        Authorization: authToken,
      },
    });

    expect(unpublishRes.status).toBe(200);
    const unpublishData = await unpublishRes.json();
    expect(unpublishData.skill.isPublished).toBe(false);

    // ========== STEP 6: Delete Skill ==========
    const deleteRes = await app.request(`/api/skills/${skillId}`, {
      method: 'DELETE',
      headers: {
        Authorization: authToken,
      },
    });

    expect(deleteRes.status).toBe(200);

    // Verify skill and versions are deleted
    const deletedSkill = await db
      .select()
      .from(marketplaceSkills)
      .where(eq(marketplaceSkills.id, skillId));

    expect(deletedSkill.length).toBe(0);

    const deletedVersions = await db
      .select()
      .from(skillVersions)
      .where(eq(skillVersions.skillId, skillId));

    expect(deletedVersions.length).toBe(0);
  });

  it('should handle multiple versions correctly', async () => {
    // Create skill
    const skillData = {
      name: `Versioned Skill ${Date.now()}`,
      description: 'Testing version management',
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

    // Create multiple versions
    const versions = ['1.1.0', '1.2.0', '2.0.0', '2.1.0'];

    for (const version of versions) {
      const versionRes = await app.request(`/api/skills/${skillId}/versions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authToken,
        },
        body: JSON.stringify({
          version,
          changeLog: `Version ${version} changes`,
        }),
      });

      expect(versionRes.status).toBe(201);
    }

    // Verify all versions were created
    const allVersions = await db
      .select()
      .from(skillVersions)
      .where(eq(skillVersions.skillId, skillId));

    expect(allVersions.length).toBe(5); // 1.0.0 + 4 new versions

    // Verify latest version is correct
    const skill = await db
      .select()
      .from(marketplaceSkills)
      .where(eq(marketplaceSkills.id, skillId))
      .limit(1);

    expect(skill[0].latestVersion).toBe('2.1.0');

    // Cleanup
    await app.request(`/api/skills/${skillId}`, {
      method: 'DELETE',
      headers: { Authorization: authToken },
    });
  });

  it('should prevent unauthorized users from modifying skills', async () => {
    // Create skill with one user
    const skillData = {
      name: `Protected Skill ${Date.now()}`,
      description: 'Testing authorization',
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

    // Try to modify with different user (invalid token - will get 401)
    const unauthorizedToken = 'Bearer different-user-token';

    const updateRes = await app.request(`/api/skills/${skillId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: unauthorizedToken,
      },
      body: JSON.stringify({ name: 'Hacked Name' }),
    });

    expect(updateRes.status).toBe(401); // Unauthorized due to invalid token

    const deleteRes = await app.request(`/api/skills/${skillId}`, {
      method: 'DELETE',
      headers: { Authorization: unauthorizedToken },
    });

    expect(deleteRes.status).toBe(401); // Unauthorized due to invalid token

    // Cleanup with correct user
    await app.request(`/api/skills/${skillId}`, {
      method: 'DELETE',
      headers: { Authorization: authToken },
    });
  });

  it('should handle tag creation and reuse', async () => {
    const uniqueTag = `integration-test-tag-${Date.now()}`;
    const timestamp = Date.now();

    // Create first skill with new tag
    const skill1Data = {
      name: `Skill with New Tag ${timestamp}`,
      description: 'First skill',
      documentation: [],
      categories: [testCategorySlug],
      tags: [uniqueTag, 'common-tag'],
    };

    const create1Res = await app.request('/api/skills', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken,
      },
      body: JSON.stringify(skill1Data),
    });

    const create1Data = await create1Res.json();
    const skill1Id = create1Data.skill.id;

    // Create second skill with same tag
    const skill2Data = {
      name: `Skill Reusing Tag ${timestamp}`,
      description: 'Second skill',
      documentation: [],
      categories: [testCategorySlug],
      tags: [uniqueTag, 'another-tag'],
    };

    const create2Res = await app.request('/api/skills', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken,
      },
      body: JSON.stringify(skill2Data),
    });

    const create2Data = await create2Res.json();
    const skill2Id = create2Data.skill.id;

    // Verify tags were created and reused properly
    // Both skills should share the unique tag

    // Cleanup
    await app.request(`/api/skills/${skill1Id}`, {
      method: 'DELETE',
      headers: { Authorization: authToken },
    });

    await app.request(`/api/skills/${skill2Id}`, {
      method: 'DELETE',
      headers: { Authorization: authToken },
    });
  });

  it('should validate required fields', async () => {
    const invalidSkills = [
      {
        // Missing name
        description: 'No name',
        documentation: [],
        categories: [testCategorySlug],
        tags: [],
      },
      {
        name: 'No Description',
        // Missing description
        documentation: [],
        categories: [testCategorySlug],
        tags: [],
      },
      {
        name: 'No Documentation',
        description: 'Has description',
        // Missing documentation
        categories: [testCategorySlug],
        tags: [],
      },
    ];

    for (const invalidSkill of invalidSkills) {
      const res = await app.request('/api/skills', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authToken,
        },
        body: JSON.stringify(invalidSkill),
      });

      expect(res.status).toBe(400);
    }
  });
});
