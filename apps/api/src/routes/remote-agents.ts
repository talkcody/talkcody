import { Hono } from 'hono';
import { remoteAgentsService } from '../services/remote-agents-service';
import type { HonoContext } from '../types/context';

const remoteAgents = new Hono<HonoContext>();

remoteAgents.get('/version', (c) => {
  const version = remoteAgentsService.getVersion();
  return c.json(version);
});

remoteAgents.get('/configs', (c) => {
  const configs = remoteAgentsService.getConfigs();
  return c.json(configs);
});

remoteAgents.get('/:agentId', (c) => {
  const agentId = c.req.param('agentId');
  const agent = remoteAgentsService.getRemoteAgent(agentId);

  if (!agent) {
    return c.json({ error: 'Remote agent not found' }, 404);
  }

  return c.json(agent);
});

remoteAgents.get('/', (c) => {
  const ids = remoteAgentsService.getRemoteAgentIds();
  const count = remoteAgentsService.getRemoteAgentsCount();

  return c.json({
    count,
    agents: ids,
  });
});

export default remoteAgents;
