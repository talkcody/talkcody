// Remote Agents API endpoint tests
import { describe, expect, it } from 'bun:test';
import { app } from '../index';

describe('Remote Agents API - Configs', () => {
  it('should return remote agent configs', async () => {
    const res = await app.request('/api/remote-agents/configs');

    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.remoteAgents).toBeDefined();
    expect(Array.isArray(data.remoteAgents)).toBe(true);

    if (data.remoteAgents.length > 0) {
      const agent = data.remoteAgents[0];
      expect(agent).toHaveProperty('id');
      expect(agent).toHaveProperty('name');
      expect(agent).toHaveProperty('description');
      expect(agent).toHaveProperty('category');
      expect(agent).toHaveProperty('repository');
      expect(agent).toHaveProperty('githubPath');
    }
  });
});

describe('Remote Agents API - Version', () => {
  it('should return version', async () => {
    const res = await app.request('/api/remote-agents/version');

    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty('version');
  });
});

describe('Remote Agents API - Get Agent by Id', () => {
  it('should return agent by id', async () => {
    const listRes = await app.request('/api/remote-agents/configs');
    const listData = await listRes.json();
    const agent = listData.remoteAgents[0];

    const res = await app.request(`/api/remote-agents/${agent.id}`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.id).toBe(agent.id);
  });

  it('should return 404 for unknown agent', async () => {
    const res = await app.request('/api/remote-agents/unknown-agent-id');
    expect(res.status).toBe(404);
  });
});

describe('Remote Agents API - List IDs', () => {
  it('should return ids list', async () => {
    const res = await app.request('/api/remote-agents');

    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty('count');
    expect(data).toHaveProperty('agents');
    expect(Array.isArray(data.agents)).toBe(true);
  });
});
