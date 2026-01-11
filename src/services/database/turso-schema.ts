import type { Client } from '@libsql/client';
import { logger } from '@/lib/logger';

export class TursoSchema {
  private constructor() {}

  /**
   * Create all database tables for the unified schema
   */
  static async createTables(db: Client): Promise<void> {
    await TursoSchema.createChatTables(db);
    await TursoSchema.createAgentTables(db);
    await TursoSchema.createSkillTables(db);
    await TursoSchema.createSettingsTables(db);
    await TursoSchema.createSchemaVersionTable(db);
    await TursoSchema.createIndexes(db);
    await TursoSchema.insertDefaultData(db);
  }

  /**
   * Chat-related tables (from chat_history.db)
   */
  private static async createChatTables(db: Client): Promise<void> {
    // Projects table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        context TEXT DEFAULT '',
        rules TEXT DEFAULT '',
        root_path TEXT DEFAULT NULL
      )
    `);

    // Conversations table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT 'default',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        message_count INTEGER DEFAULT 0,
        cost REAL DEFAULT 0,
        input_token INTEGER DEFAULT 0,
        output_token INTEGER DEFAULT 0,
        context_usage REAL DEFAULT NULL,
        settings TEXT DEFAULT NULL,
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
      )
    `);

    // Messages table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        assistant_id TEXT,
        position_index INTEGER DEFAULT 0,
        FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
      )
    `);

    // Message attachments table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS message_attachments (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        type TEXT NOT NULL,
        filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE
      )
    `);

    // MCP servers table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        protocol TEXT NOT NULL CHECK (protocol IN ('http', 'sse', 'stdio')),
        api_key TEXT DEFAULT NULL,
        headers TEXT DEFAULT '{}',
        stdio_command TEXT DEFAULT NULL,
        stdio_args TEXT DEFAULT '[]',
        stdio_env TEXT DEFAULT '{}',
        is_enabled BOOLEAN DEFAULT 1,
        is_built_in BOOLEAN DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Todos table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed')),
        priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
      )
    `);

    // Active skills table (global active skills)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS active_skills (
        skill_id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      )
    `);

    // Recent files table (tracks recently opened files per repository)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS recent_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        repository_path TEXT NOT NULL,
        opened_at INTEGER NOT NULL,
        UNIQUE(file_path, repository_path)
      )
    `);
  }

  /**
   * Agent-related tables (from agents.db)
   */
  private static async createAgentTables(db: Client): Promise<void> {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        model_type TEXT NOT NULL DEFAULT 'main_model',
        system_prompt TEXT NOT NULL,
        tools_config TEXT DEFAULT '{}',
        rules TEXT DEFAULT '',
        output_format TEXT DEFAULT '',
        is_hidden BOOLEAN DEFAULT 0,
        is_default BOOLEAN DEFAULT 0,
        is_enabled BOOLEAN DEFAULT 1,
        dynamic_enabled BOOLEAN DEFAULT 0,
        dynamic_providers TEXT DEFAULT '[]',
        dynamic_variables TEXT DEFAULT '{}',
        dynamic_provider_settings TEXT DEFAULT '{}',
        default_skills TEXT DEFAULT '[]',
        source_type TEXT DEFAULT 'local',
        marketplace_id TEXT,
        marketplace_version TEXT,
        forked_from_id TEXT,
        forked_from_marketplace_id TEXT,
        is_shared INTEGER DEFAULT 0,
        last_synced_at INTEGER,
        icon_url TEXT,
        author_name TEXT,
        author_id TEXT,
        categories TEXT DEFAULT '[]',
        tags TEXT DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        created_by TEXT DEFAULT 'system',
        usage_count INTEGER DEFAULT 0
      )
    `);
  }

  /**
   * Skill-related tables
   */
  private static async createSkillTables(db: Client): Promise<void> {
    // Skills table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        long_description TEXT,
        category TEXT NOT NULL,
        icon_url TEXT,
        system_prompt_fragment TEXT,
        workflow_rules TEXT,
        documentation TEXT,
        source_type TEXT DEFAULT 'local',
        marketplace_id TEXT,
        marketplace_version TEXT,
        forked_from_id TEXT,
        forked_from_marketplace_id TEXT,
        is_shared INTEGER DEFAULT 0,
        author_name TEXT,
        author_id TEXT,
        downloads INTEGER DEFAULT 0,
        rating REAL DEFAULT 0,
        last_synced_at INTEGER,
        is_built_in INTEGER DEFAULT 0,
        tags TEXT DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_used_at INTEGER,
        UNIQUE(marketplace_id)
      )
    `);

    // Conversation skills table (junction table)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS conversation_skills (
        conversation_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        priority INTEGER DEFAULT 0,
        activated_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
        PRIMARY KEY (conversation_id, skill_id)
      )
    `);
  }

  private static async createSettingsTables(db: Client): Promise<void> {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  /**
   * Schema version tracking table
   */
  private static async createSchemaVersionTable(db: Client): Promise<void> {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `);

    // Insert initial version if not exists
    const result = await db.execute('SELECT version FROM schema_version WHERE id = 1');
    if (result.rows.length === 0) {
      await db.execute('INSERT INTO schema_version (id, version, applied_at) VALUES (1, 1, ?)', [
        Date.now(),
      ]);
    }
  }

  /**
   * Create all database indexes
   */
  private static async createIndexes(db: Client): Promise<void> {
    // Projects indexes
    await db.execute(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_root_path
      ON projects (root_path) WHERE root_path IS NOT NULL
    `);

    // Conversations indexes
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations (project_id)'
    );

    // Messages indexes
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (conversation_id)'
    );
    await db.execute('CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (timestamp)');

    // Message attachments indexes
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON message_attachments (message_id)'
    );

    // MCP servers indexes
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_mcp_servers_is_enabled ON mcp_servers (is_enabled)'
    );
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_mcp_servers_is_built_in ON mcp_servers (is_built_in)'
    );
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_mcp_servers_protocol ON mcp_servers (protocol)'
    );
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled_builtin ON mcp_servers (is_enabled, is_built_in)'
    );

    // Todos indexes
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_todos_conversation_id ON todos (conversation_id)'
    );
    await db.execute('CREATE INDEX IF NOT EXISTS idx_todos_status ON todos (status)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_todos_created_at ON todos (created_at)');

    // Active skills indexes
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_active_skills_created_at ON active_skills (created_at)'
    );

    // Agents indexes
    await db.execute('CREATE INDEX IF NOT EXISTS idx_agents_is_hidden ON agents (is_hidden)');

    // Skills indexes
    await db.execute('CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_skills_marketplace ON skills(marketplace_id)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_skills_tags ON skills(tags)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name)');

    // Conversation skills indexes
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_conversation_skills_conversation ON conversation_skills(conversation_id)'
    );
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_conversation_skills_enabled ON conversation_skills(conversation_id, enabled)'
    );
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_conversation_skills_priority ON conversation_skills(conversation_id, priority DESC)'
    );

    // Recent files indexes
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_recent_files_repository ON recent_files(repository_path, opened_at DESC)'
    );
  }

  /**
   * Insert default data
   */
  private static async insertDefaultData(db: Client): Promise<void> {
    await TursoSchema.insertDefaultProject(db);
    await TursoSchema.insertBuiltInMCPServers(db);
  }

  /**
   * Insert default project
   */
  private static async insertDefaultProject(db: Client): Promise<void> {
    const now = Date.now();

    // Check if default project exists
    const result = await db.execute('SELECT id FROM projects WHERE id = ?', ['default']);

    if (result.rows.length === 0) {
      await db.execute(
        'INSERT INTO projects (id, name, description, created_at, updated_at, context, rules, root_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          'default',
          'Default Project',
          'Default project for all conversations',
          now,
          now,
          '',
          '',
          null,
        ]
      );
    }
  }

  /**
   * Insert built-in MCP servers
   */
  private static async insertBuiltInMCPServers(db: Client): Promise<void> {
    const now = Date.now();

    const builtInServers: Array<{
      id: string;
      name: string;
      url: string;
      protocol: string;
      stdio_command: string | null;
      stdio_args: string[] | null;
      headers?: Record<string, string>;
      stdio_env?: Record<string, string>;
    }> = [
      {
        id: 'context7',
        name: 'Context7',
        url: 'https://mcp.context7.com/mcp',
        protocol: 'http',
        stdio_command: null,
        stdio_args: null,
      },
      {
        id: 'github',
        name: 'GitHub MCP Server (Remote)',
        url: 'https://api.githubcopilot.com/mcp/',
        protocol: 'http',
        stdio_command: null,
        stdio_args: null,
      },
      {
        id: 'chrome-devtools',
        name: 'Chrome DevTools MCP',
        url: '',
        protocol: 'stdio',
        stdio_command: 'npx',
        stdio_args: ['chrome-devtools-mcp@latest', '--isolated'],
      },
      {
        id: 'sequential-thinking',
        name: 'Sequential Thinking',
        url: '',
        protocol: 'stdio',
        stdio_command: 'npx',
        stdio_args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
      },
      {
        id: 'minimax-coding-plan',
        name: 'MiniMax Coding Plan MCP',
        url: '',
        protocol: 'stdio',
        stdio_command: 'uvx',
        stdio_args: ['minimax-coding-plan-mcp', '-y'],
      },
      {
        id: 'glm-coding-plan-vision',
        name: 'GLM Coding Plan Vision',
        url: '',
        protocol: 'stdio',
        stdio_command: 'npx',
        stdio_args: ['-y', '@z_ai/mcp-server'],
        stdio_env: {
          Z_AI_API_KEY: '',
          Z_AI_MODE: 'ZHIPU',
        },
      },
    ];

    for (const server of builtInServers) {
      try {
        const result = await db.execute('SELECT id FROM mcp_servers WHERE id = ?', [server.id]);

        if (result.rows.length === 0) {
          await db.execute(
            `INSERT INTO mcp_servers (
              id, name, url, protocol, api_key, headers, stdio_command, stdio_args, stdio_env,
              is_enabled, is_built_in, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              server.id,
              server.name,
              server.url,
              server.protocol,
              null,
              JSON.stringify(server.headers || {}),
              server.stdio_command,
              JSON.stringify(server.stdio_args || []),
              JSON.stringify(server.stdio_env || {}),
              0, // All built-in MCP servers are disabled by default
              1,
              now,
              now,
            ]
          );

          logger.info(`Inserted built-in MCP server: ${server.id}`);
        }
        // If server already exists, don't update - preserve user's configuration
        // (headers, stdio_env contain user's API keys that should not be overwritten)
        // If built-in server definitions need to change, use migrations instead
      } catch (error) {
        logger.error(`Failed to insert/update built-in MCP server ${server.id}:`, error);
      }
    }
  }

  /**
   * Get current schema version
   */
  static async getSchemaVersion(db: Client): Promise<number> {
    const result = await db.execute('SELECT version FROM schema_version WHERE id = 1');
    if (result.rows.length > 0) {
      const row = result.rows[0];
      if (row) {
        return row.version as number;
      }
    }
    return 0;
  }

  /**
   * Update schema version
   */
  static async updateSchemaVersion(db: Client, version: number): Promise<void> {
    await db.execute('UPDATE schema_version SET version = ?, applied_at = ? WHERE id = 1', [
      version,
      Date.now(),
    ]);
  }
}
