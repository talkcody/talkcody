import remoteAgentsConfig from '@talkcody/shared/data/remote-agents-config.json';
import type {
  RemoteAgentConfig,
  RemoteAgentsConfiguration,
} from '@talkcody/shared/types/remote-agents';

export class RemoteAgentsService {
  getVersion(): { version: string } {
    return {
      version: (remoteAgentsConfig as RemoteAgentsConfiguration).version,
    };
  }

  getConfigs(): RemoteAgentsConfiguration {
    return remoteAgentsConfig as RemoteAgentsConfiguration;
  }

  getRemoteAgent(agentId: string): RemoteAgentConfig | null {
    const config = remoteAgentsConfig as RemoteAgentsConfiguration;
    return config.remoteAgents.find((agent) => agent.id === agentId) || null;
  }

  getRemoteAgentIds(): string[] {
    const config = remoteAgentsConfig as RemoteAgentsConfiguration;
    return config.remoteAgents.map((agent) => agent.id);
  }

  getRemoteAgentsCount(): number {
    const config = remoteAgentsConfig as RemoteAgentsConfiguration;
    return config.remoteAgents.length;
  }
}

export const remoteAgentsService = new RemoteAgentsService();
