// src/services/database/agent-service.ts

import type { Agent, CreateAgentData, DbAgent, UpdateAgentData } from '@/types';
import { agentDatabaseService } from '../agent-database-service';

export class AgentService {
  async createAgent(data: CreateAgentData): Promise<Agent> {
    const db = await agentDatabaseService.getDb();
    const now = Date.now();

    const agentData = {
      id: data.id,
      name: data.name,
      description: data.description || '',
      model_type: data.model_type,
      system_prompt: data.system_prompt,
      tools_config: data.tools_config || '{}',
      rules: data.rules || '',
      output_format: data.output_format || '',
      is_hidden: data.is_hidden ?? false,
      is_default: data.is_default ?? false,
      is_enabled: data.is_enabled !== undefined ? data.is_enabled : true,
      dynamic_enabled: data.dynamic_enabled ?? false,
      dynamic_providers: data.dynamic_providers ?? '[]',
      dynamic_variables: data.dynamic_variables ?? '{}',
      dynamic_provider_settings: data.dynamic_provider_settings ?? '{}',

      // Marketplace fields (publish disabled)
      source_type: data.source_type || 'local',
      marketplace_id: undefined,
      marketplace_version: undefined,
      forked_from_id: data.forked_from_id ?? undefined,
      forked_from_marketplace_id: data.forked_from_marketplace_id ?? undefined,
      is_shared: false,
      icon_url: data.icon_url ?? undefined,
      author_name: undefined,
      author_id: undefined,
      categories: data.categories || '[]',
      tags: data.tags || '[]',

      created_at: now,
      updated_at: now,
      created_by: data.created_by || 'system',
      usage_count: 0,
    };

    await db.execute(
      `INSERT INTO agents (
        id, name, description, model_type, system_prompt, tools_config,
        rules, output_format, is_hidden, is_default, is_enabled,
        dynamic_enabled, dynamic_providers, dynamic_variables, dynamic_provider_settings,
        source_type, marketplace_id, marketplace_version, forked_from_id, forked_from_marketplace_id,
        is_shared, icon_url, author_name, author_id, categories, tags,
        created_at, updated_at, created_by, usage_count
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15,
        $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26,
        $27, $28, $29, $30
      )`,
      [
        agentData.id,
        agentData.name,
        agentData.description,
        agentData.model_type,
        agentData.system_prompt,
        agentData.tools_config,
        agentData.rules,
        agentData.output_format,
        agentData.is_hidden,
        agentData.is_default,
        agentData.is_enabled,
        agentData.dynamic_enabled,
        agentData.dynamic_providers,
        agentData.dynamic_variables,
        agentData.dynamic_provider_settings ?? '{}',
        agentData.source_type,
        agentData.marketplace_id,
        agentData.marketplace_version,
        agentData.forked_from_id,
        agentData.forked_from_marketplace_id,
        agentData.is_shared,
        agentData.icon_url,
        agentData.author_name,
        agentData.author_id,
        agentData.categories,
        agentData.tags,
        agentData.created_at,
        agentData.updated_at,
        agentData.created_by,
        agentData.usage_count,
      ]
    );

    return agentData as unknown as Agent;
  }

  async updateAgent(id: string, data: UpdateAgentData): Promise<Agent | null> {
    const db = await agentDatabaseService.getDb();
    const now = Date.now();

    // Build dynamic update query
    const updates: string[] = [];
    const values: (string | boolean | number | null)[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(data.description);
    }
    if (data.model !== undefined) {
      updates.push(`model = $${paramIndex++}`);
      values.push(data.model);
    }
    if (data.model_type !== undefined) {
      updates.push(`model_type = $${paramIndex++}`);
      values.push(data.model_type);
    }
    if (data.system_prompt !== undefined) {
      updates.push(`system_prompt = $${paramIndex++}`);
      values.push(data.system_prompt);
    }
    if (data.tools_config !== undefined) {
      updates.push(`tools_config = $${paramIndex++}`);
      values.push(data.tools_config);
    }
    if (data.rules !== undefined) {
      updates.push(`rules = $${paramIndex++}`);
      values.push(data.rules);
    }
    if (data.output_format !== undefined) {
      updates.push(`output_format = $${paramIndex++}`);
      values.push(data.output_format);
    }
    if (data.is_hidden !== undefined) {
      updates.push(`is_hidden = $${paramIndex++}`);
      values.push(data.is_hidden);
    }
    if (data.is_default !== undefined) {
      updates.push(`is_default = $${paramIndex++}`);
      values.push(data.is_default);
    }
    if (data.is_enabled !== undefined) {
      updates.push(`is_enabled = $${paramIndex++}`);
      values.push(data.is_enabled);
    }
    if (data.dynamic_enabled !== undefined) {
      updates.push(`dynamic_enabled = $${paramIndex++}`);
      values.push(data.dynamic_enabled);
    }
    if (data.dynamic_providers !== undefined) {
      updates.push(`dynamic_providers = $${paramIndex++}`);
      values.push(data.dynamic_providers);
    }
    if (data.dynamic_variables !== undefined) {
      updates.push(`dynamic_variables = $${paramIndex++}`);
      values.push(data.dynamic_variables);
    }
    if (data.dynamic_provider_settings !== undefined) {
      updates.push(`dynamic_provider_settings = $${paramIndex++}`);
      values.push(data.dynamic_provider_settings);
    }

    // Marketplace fields (publish disabled)
    if (data.source_type !== undefined) {
      updates.push(`source_type = $${paramIndex++}`);
      values.push(data.source_type);
    }
    if (data.marketplace_id !== undefined || data.marketplace_version !== undefined) {
      updates.push(`marketplace_id = $${paramIndex++}`);
      values.push(null);
      updates.push(`marketplace_version = $${paramIndex++}`);
      values.push(null);
    }
    if (data.is_shared !== undefined) {
      updates.push(`is_shared = $${paramIndex++}`);
      values.push(false);
    }
    if (data.last_synced_at !== undefined) {
      updates.push(`last_synced_at = $${paramIndex++}`);
      values.push(data.last_synced_at);
    }
    if (data.icon_url !== undefined) {
      updates.push(`icon_url = $${paramIndex++}`);
      values.push(data.icon_url);
    }
    if (data.categories !== undefined) {
      updates.push(`categories = $${paramIndex++}`);
      values.push(data.categories);
    }
    if (data.tags !== undefined) {
      updates.push(`tags = $${paramIndex++}`);
      values.push(data.tags);
    }

    if (updates.length === 0) {
      return this.getAgent(id);
    }

    updates.push(`updated_at = $${paramIndex++}`);
    values.push(now);
    values.push(id);

    const query = `UPDATE agents SET ${updates.join(', ')} WHERE id = $${paramIndex}`;
    await db.execute(query, values);

    return this.getAgent(id);
  }

  async deleteAgent(id: string): Promise<boolean> {
    const db = await agentDatabaseService.getDb();
    const result = await db.execute('DELETE FROM agents WHERE id = $1', [id]);
    return (result.rowsAffected || 0) > 0;
  }

  async getAgent(id: string): Promise<Agent | null> {
    const db = await agentDatabaseService.getDb();
    const results = await db.select<DbAgent[]>('SELECT * FROM agents WHERE id = $1', [id]);
    const first = results[0];
    if (!first) return null;
    return this.normalizeAgent(first);
  }

  async listAgents(options?: {
    includeHidden?: boolean;
    enabledOnly?: boolean;
    defaultOnly?: boolean;
    onlyUserAgents?: boolean; // NEW: Filter for user agents only (is_default = false)
  }): Promise<Agent[]> {
    const db = await agentDatabaseService.getDb();

    let query = 'SELECT * FROM agents';
    const conditions: string[] = [];
    const values: (string | boolean)[] = [];
    let paramIndex = 1;

    if (options?.enabledOnly) {
      conditions.push(`is_enabled = $${paramIndex++}`);
      values.push(true);
    }

    if (!options?.includeHidden) {
      conditions.push(`is_hidden = $${paramIndex++}`);
      values.push(false);
    }

    if (options?.defaultOnly) {
      conditions.push(`is_default = $${paramIndex++}`);
      values.push(true);
    }

    if (options?.onlyUserAgents) {
      conditions.push(`is_default = $${paramIndex++}`);
      values.push(false); // Only user agents (not system defaults)
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY is_default DESC, usage_count DESC, created_at DESC';

    const results = await db.select<DbAgent[]>(query, values);
    return results.map((agent) => this.normalizeAgent(agent));
  }

  async incrementUsageCount(id: string): Promise<void> {
    const db = await agentDatabaseService.getDb();
    await db.execute(
      'UPDATE agents SET usage_count = usage_count + 1, updated_at = $1 WHERE id = $2',
      [Date.now(), id]
    );
  }

  async getAgentsByCreator(createdBy: string): Promise<Agent[]> {
    const db = await agentDatabaseService.getDb();
    const results = await db.select<DbAgent[]>(
      'SELECT * FROM agents WHERE created_by = $1 ORDER BY created_at DESC',
      [createdBy]
    );
    return results.map((agent) => this.normalizeAgent(agent));
  }

  async agentExists(id: string): Promise<boolean> {
    const db = await agentDatabaseService.getDb();
    const results = await db.select<{ count: number }[]>(
      'SELECT COUNT(*) as count FROM agents WHERE id = $1',
      [id]
    );
    return (results[0]?.count ?? 0) > 0;
  }

  private normalizeAgent(agent: DbAgent): Agent {
    const toBool = (value: unknown, fallback = false) => {
      if (value === true || value === 'true' || value === 1 || value === '1') return true;
      if (value === false || value === 'false' || value === 0 || value === '0') return false;
      return fallback;
    };

    return {
      ...agent,
      is_hidden: toBool(agent.is_hidden),
      is_default: toBool(agent.is_default),
      is_enabled: toBool(agent.is_enabled, true),
      dynamic_enabled: toBool(agent.dynamic_enabled),
      is_shared: toBool(agent.is_shared),
      source_type: agent.source_type ?? 'local',
      categories: agent.categories ?? '[]',
      tags: agent.tags ?? '[]',
    } as Agent;
  }
}

export const agentService = new AgentService();
