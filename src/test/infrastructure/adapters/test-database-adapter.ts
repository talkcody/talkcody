/**
 * Test Database Adapter
 *
 * Uses bun:sqlite in memory mode to execute real SQL operations.
 * Provides an interface compatible with Tauri's db_* commands.
 */

import { Database } from 'bun:sqlite';

export interface DatabaseConfig {
  /** SQL statements to seed initial data */
  seedSql?: string[];
  /** Enable SQL logging for debugging */
  enableLogging?: boolean;
}

export interface ResultSet {
  rows: unknown[];
  rowsAffected?: number;
}

export class TestDatabaseAdapter {
  private db: Database;
  private logging: boolean;

  constructor(config: DatabaseConfig = {}) {
    this.db = new Database(':memory:');
    this.logging = config.enableLogging ?? false;

    // Enable foreign keys
    this.db.exec('PRAGMA foreign_keys = ON');

    // Initialize schema
    this.initializeSchema();

    // Insert default data
    this.insertDefaultData();

    // Run seed SQL if provided
    if (config.seedSql) {
      for (const sql of config.seedSql) {
        try {
          this.db.exec(sql);
        } catch (error) {
          console.error('Seed SQL error:', sql, error);
        }
      }
    }
  }

  /**
   * Initialize database schema (from turso-schema.ts, adapted for SQLite)
   */
  private initializeSchema(): void {
    const schemas = this.getSchemaStatements();

    for (const sql of schemas) {
      try {
        this.db.exec(sql);
      } catch (error) {
        console.error('Schema creation error:', sql, error);
      }
    }
  }

  /**
   * Handle db_connect command
   */
  connect(): void {
    // Already connected via constructor
  }

  /**
   * Handle db_execute command (INSERT, UPDATE, DELETE, CREATE, etc.)
   */
  execute(args: { sql: string; params?: unknown[] }): ResultSet {
    if (this.logging) {
      console.log('[DB Execute]', args.sql, args.params);
    }

    const sql = this.convertPlaceholders(args.sql);
    const params = args.params || [];

    try {
      const stmt = this.db.prepare(sql);
      const result = stmt.run(...params);

      return { rows: [], rowsAffected: result.changes };
    } catch (error) {
      if (this.logging) {
        console.error('[DB Execute Error]', sql, params, error);
      }
      throw error;
    }
  }

  /**
   * Handle db_query command (SELECT)
   */
  query(args: { sql: string; params?: unknown[] }): ResultSet {
    if (this.logging) {
      console.log('[DB Query]', args.sql, args.params);
    }

    const sql = this.convertPlaceholders(args.sql);
    const params = args.params || [];

    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params);

      return { rows };
    } catch (error) {
      if (this.logging) {
        console.error('[DB Query Error]', sql, params, error);
      }
      throw error;
    }
  }

  /**
   * Handle db_batch command (multiple statements in transaction)
   */
  batch(args: { statements: Array<[string, unknown[]]> }): ResultSet[] {
    if (this.logging) {
      console.log('[DB Batch]', args.statements.length, 'statements');
    }

    const results: ResultSet[] = [];

    const transaction = this.db.transaction(() => {
      for (const [sql, params] of args.statements) {
        const convertedSql = this.convertPlaceholders(sql);
        const stmt = this.db.prepare(convertedSql);
        const result = stmt.run(...params);
        results.push({ rows: [], rowsAffected: result.changes });
      }
    });

    transaction();

    return results;
  }

  /**
   * Execute raw SQL query (for test assertions)
   */
  rawQuery<T = unknown>(sql: string, params?: unknown[]): T[] {
    const convertedSql = this.convertPlaceholders(sql);
    const stmt = this.db.prepare(convertedSql);
    return stmt.all(...(params || [])) as T[];
  }

  /**
   * Execute raw SQL statement (for test setup)
   */
  rawExecute(sql: string, params?: unknown[]): void {
    const convertedSql = this.convertPlaceholders(sql);
    const stmt = this.db.prepare(convertedSql);
    stmt.run(...(params || []));
  }

  /**
   * Reset database to initial state (clear all data, keep schema)
   */
  reset(): void {
    const tables = this.rawQuery<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );

    // Disable foreign keys temporarily
    this.db.exec('PRAGMA foreign_keys = OFF');

    for (const { name } of tables) {
      this.db.exec(`DELETE FROM ${name}`);
    }

    // Re-enable foreign keys
    this.db.exec('PRAGMA foreign_keys = ON');

    // Re-insert default data
    this.insertDefaultData();
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Get the underlying bun:sqlite Database instance (for advanced usage)
   */
  getDatabase(): Database {
    return this.db;
  }

  /**
   * Get an adapter that implements the TursoClient interface.
   * This allows using the test database with services that expect TursoClient.
   */
  getTursoClientAdapter(): TursoClientAdapter {
    return new TursoClientAdapter(this);
  }

  /**
   * Convert libsql parameter placeholders ($1, $2) to SQLite placeholders (?)
   */
  private convertPlaceholders(sql: string): string {
    // Replace $1, $2, etc. with ?
    return sql.replace(/\$\d+/g, '?');
  }

  /**
   * Get schema SQL statements adapted for SQLite
   */
  private getSchemaStatements(): string[] {
    return [
      // Projects table
      `CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        context TEXT DEFAULT '',
        rules TEXT DEFAULT '',
        root_path TEXT DEFAULT NULL
      )`,

      // Conversations table
      `CREATE TABLE IF NOT EXISTS conversations (
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
      )`,

      // Messages table
      `CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        assistant_id TEXT,
        position_index INTEGER DEFAULT 0,
        FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
      )`,

      // Message attachments table
      `CREATE TABLE IF NOT EXISTS message_attachments (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        type TEXT NOT NULL,
        filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE
      )`,

      // MCP servers table
      `CREATE TABLE IF NOT EXISTS mcp_servers (
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
      )`,

      // Todos table
      `CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed')),
        priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
      )`,

      // Active skills table
      `CREATE TABLE IF NOT EXISTS active_skills (
        skill_id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      )`,

      // Recent files table
      `CREATE TABLE IF NOT EXISTS recent_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        repository_path TEXT NOT NULL,
        opened_at INTEGER NOT NULL,
        UNIQUE(file_path, repository_path)
      )`,

      // Recent projects table (for dock menu)
      `CREATE TABLE IF NOT EXISTS recent_projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL UNIQUE,
        project_name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        opened_at INTEGER NOT NULL
      )`,

      // Agents table
      `CREATE TABLE IF NOT EXISTS agents (
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
      )`,

      // Skills table
      `CREATE TABLE IF NOT EXISTS skills (
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
      )`,

      // Conversation skills table
      `CREATE TABLE IF NOT EXISTS conversation_skills (
        conversation_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        priority INTEGER DEFAULT 0,
        activated_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
        PRIMARY KEY (conversation_id, skill_id)
      )`,

      // Settings table
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,

      // Schema version table
      `CREATE TABLE IF NOT EXISTS schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL,
        applied_at INTEGER NOT NULL
      )`,

      // Indexes
      'CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations (project_id)',
      'CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (conversation_id)',
      'CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON message_attachments (message_id)',
      'CREATE INDEX IF NOT EXISTS idx_mcp_servers_is_enabled ON mcp_servers (is_enabled)',
      'CREATE INDEX IF NOT EXISTS idx_todos_conversation_id ON todos (conversation_id)',
      'CREATE INDEX IF NOT EXISTS idx_todos_status ON todos (status)',
      'CREATE INDEX IF NOT EXISTS idx_agents_is_hidden ON agents (is_hidden)',
      'CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category)',
      'CREATE INDEX IF NOT EXISTS idx_conversation_skills_conversation ON conversation_skills(conversation_id)',
      'CREATE INDEX IF NOT EXISTS idx_recent_files_repository ON recent_files(repository_path, opened_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_recent_projects_opened_at ON recent_projects(opened_at DESC)',
    ];
  }

  /**
   * Insert default data
   */
  private insertDefaultData(): void {
    const now = Date.now();

    // Insert default project
    const insertProject = this.db.prepare(
      `INSERT OR IGNORE INTO projects (id, name, description, created_at, updated_at, context, rules, root_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertProject.run(
      'default',
      'Default Project',
      'Default project for all conversations',
      now,
      now,
      '',
      '',
      null
    );

    // Insert schema version
    const insertVersion = this.db.prepare(
      `INSERT OR IGNORE INTO schema_version (id, version, applied_at)
       VALUES (?, ?, ?)`
    );
    insertVersion.run(1, 1, now);
  }
}

/**
 * Adapter that wraps TestDatabaseAdapter to implement TursoClient interface.
 * This allows using the test database with services like TaskService.
 */
export class TursoClientAdapter {
  private adapter: TestDatabaseAdapter;
  private initialized = true;

  constructor(adapter: TestDatabaseAdapter) {
    this.adapter = adapter;
  }

  async initialize(): Promise<void> {
    // Already initialized
  }

  async execute(sql: string, params?: unknown[]): Promise<ResultSet> {
    return this.adapter.execute({ sql, params });
  }

  async select<T = unknown[]>(sql: string, params?: unknown[]): Promise<T> {
    const result = this.adapter.query({ sql, params });
    return result.rows as T;
  }

  async batch(statements: Array<{ sql: string; params?: unknown[] }>): Promise<ResultSet[]> {
    const stmts: Array<[string, unknown[]]> = statements.map((s) => [s.sql, s.params || []]);
    return this.adapter.batch({ statements: stmts });
  }

  async close(): Promise<void> {
    // Managed by TestDatabaseAdapter
  }

  getClient(): unknown {
    return {};
  }
}
