// Remote Skills API endpoint tests
import { describe, expect, it } from 'bun:test';
import { app } from '../index';

describe('Remote Skills API - Configs', () => {
  it('should return remote skill configs', async () => {
    const res = await app.request('/api/remote-skills/configs');

    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.remoteSkills).toBeDefined();
    expect(Array.isArray(data.remoteSkills)).toBe(true);

    if (data.remoteSkills.length > 0) {
      const skill = data.remoteSkills[0];
      expect(skill).toHaveProperty('id');
      expect(skill).toHaveProperty('name');
      expect(skill).toHaveProperty('description');
      expect(skill).toHaveProperty('category');
      expect(skill).toHaveProperty('repository');
      expect(skill).toHaveProperty('githubPath');
    }
  });
});

describe('Remote Skills API - Version', () => {
  it('should return version', async () => {
    const res = await app.request('/api/remote-skills/version');

    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty('version');
  });
});

describe('Remote Skills API - Categories', () => {
  it('should return categories', async () => {
    const res = await app.request('/api/remote-skills/categories');

    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.categories).toBeDefined();
    expect(Array.isArray(data.categories)).toBe(true);
  });
});

describe('Remote Skills API - Get Skill by Id', () => {
  it('should return skill by id', async () => {
    const listRes = await app.request('/api/remote-skills/configs');
    const listData = await listRes.json();
    const skill = listData.remoteSkills[0];

    const res = await app.request(`/api/remote-skills/${skill.id}`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.id).toBe(skill.id);
  });

  it('should return 404 for unknown skill', async () => {
    const res = await app.request('/api/remote-skills/unknown-skill-id');
    expect(res.status).toBe(404);
  });
});

describe('Remote Skills API - List IDs', () => {
  it('should return ids list', async () => {
    const res = await app.request('/api/remote-skills');

    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty('count');
    expect(data).toHaveProperty('skills');
    expect(Array.isArray(data.skills)).toBe(true);
  });
});
