// src/types/db-agent.ts
/**
 * Database Agent type definitions
 * These represent the Agent as stored in the database (snake_case fields)
 * See also: AgentDefinition in agent.ts for runtime representation
 */

export interface DbAgent {
  id: string;
  name: string;
  description: string;
  model_type: string; // Model type category (main_model, small_model, etc.)
  system_prompt: string;
  tools_config: string; // JSON string
  rules: string;
  output_format: string;
  is_hidden: boolean;
  is_default: boolean;
  is_enabled: boolean;
  dynamic_enabled?: boolean;
  dynamic_providers?: string; // JSON array
  dynamic_variables?: string; // JSON object
  dynamic_provider_settings?: string; // JSON object

  // Skills configuration
  default_skills?: string; // JSON array of skill IDs

  // Marketplace fields
  source_type: 'system' | 'local' | 'marketplace';
  marketplace_id?: string;
  marketplace_version?: string;
  forked_from_id?: string;
  forked_from_marketplace_id?: string;
  is_shared: boolean;
  last_synced_at?: number;
  icon_url?: string;
  author_name?: string;
  author_id?: string;
  categories: string; // JSON array
  tags: string; // JSON array

  created_at: number;
  updated_at: number;
  created_by: string;
  usage_count: number;
}

export interface CreateAgentData {
  id: string;
  name: string;
  description?: string;
  model_type: string; // Model type category
  system_prompt: string;
  tools_config?: string;
  rules?: string;
  output_format?: string;
  is_hidden?: boolean;
  is_default?: boolean;
  is_enabled?: boolean;
  created_by?: string;
  dynamic_enabled?: boolean;
  dynamic_providers?: string; // JSON array
  dynamic_variables?: string; // JSON object
  dynamic_provider_settings?: string; // JSON object

  // Skills configuration
  default_skills?: string; // JSON array of skill IDs

  // Marketplace fields
  source_type?: 'system' | 'local' | 'marketplace';
  marketplace_id?: string;
  marketplace_version?: string;
  forked_from_id?: string;
  forked_from_marketplace_id?: string;
  is_shared?: boolean;
  icon_url?: string;
  author_name?: string;
  author_id?: string;
  categories?: string; // JSON array
  tags?: string; // JSON array
}

// Type guard to check if data includes dynamic_provider_settings
export function hasDynamicProviderSettings(
  data: Record<string, unknown>
): data is Record<string, unknown> & { dynamic_provider_settings: string } {
  return 'dynamic_provider_settings' in data && typeof data.dynamic_provider_settings === 'string';
}

export interface UpdateAgentData {
  name?: string;
  description?: string;
  model?: string; // DEPRECATED: kept for backwards compatibility
  model_type?: string; // Model type category
  system_prompt?: string;
  tools_config?: string;
  rules?: string;
  output_format?: string;
  is_hidden?: boolean;
  is_default?: boolean;
  is_enabled?: boolean;
  dynamic_enabled?: boolean;
  dynamic_providers?: string; // JSON array
  dynamic_variables?: string; // JSON object
  dynamic_provider_settings?: string; // JSON object

  // Skills configuration
  default_skills?: string; // JSON array of skill IDs

  // Marketplace fields
  source_type?: 'system' | 'local' | 'marketplace';
  marketplace_id?: string;
  marketplace_version?: string;
  is_shared?: boolean;
  last_synced_at?: number;
  icon_url?: string;
  categories?: string; // JSON array
  tags?: string; // JSON array
}

// Type guard to check if update data includes dynamic_provider_settings
export function hasDynamicProviderSettingsUpdate(
  data: Record<string, unknown>
): data is Record<string, unknown> & { dynamic_provider_settings: string } {
  return 'dynamic_provider_settings' in data && typeof data.dynamic_provider_settings === 'string';
}

/**
 * @deprecated Use DbAgent instead
 */
export type Agent = DbAgent;
