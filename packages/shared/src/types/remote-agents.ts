/**
 * Remote Agents Configuration Types
 *
 * Simplified schema for remote agents stored in JSON format
 */

import type { ModelType } from './agent'

export interface RemoteAgentConfig {
  /** Unique identifier for the agent */
  id: string
  /** Display name of the agent */
  name: string
  /** Brief description of the agent */
  description?: string
  /** Category classification (single category) */
  category: string
  /** GitHub repository (e.g., "talkcody/agents") */
  repository: string
  /** Path within the GitHub repository (e.g., "agents/coding") */
  githubPath: string

  // AgentDefinition-compatible fields
  modelType: ModelType
  systemPrompt: string
  tools?: Record<string, unknown>
  hidden?: boolean
  rules?: string
  outputFormat?: string
  dynamicPrompt?: {
    enabled: boolean
    providers: string[]
    variables: Record<string, string>
    providerSettings?: Record<string, unknown>
  }
  defaultSkills?: string[]
  isBeta?: boolean
  role?: 'read' | 'write'
  canBeSubagent?: boolean
  version?: string
}

export interface RemoteAgentsConfiguration {
  /** ISO 8601 timestamp of the configuration version */
  version: string
  /** Array of remote agent configurations */
  remoteAgents: RemoteAgentConfig[]
}
