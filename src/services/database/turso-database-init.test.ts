import { describe, expect, it } from 'vitest';
import { TursoDatabaseInit } from './turso-database-init';

type ExecuteResult = {
  rows: Array<Record<string, unknown>>;
};

class MigrationDb {
  readonly statements: string[] = [];

  constructor(private readonly messagesReasoningColumnExists: boolean) {}

  async execute(sql: string): Promise<ExecuteResult> {
    const normalized = sql.trim();
    this.statements.push(normalized);

    if (normalized.includes("pragma_table_info('messages')")) {
      return {
        rows: [{ count: this.messagesReasoningColumnExists ? 1 : 0 }],
      };
    }

    if (normalized.includes('pragma_table_info')) {
      return { rows: [{ count: 1 }] };
    }

    if (normalized.includes("sqlite_master")) {
      return { rows: [{ name: 'existing_table' }] };
    }

    return { rows: [] };
  }
}

describe('TursoDatabaseInit message reasoning migration', () => {
  it('adds reasoning_content column when missing', async () => {
    const db = new MigrationDb(false);

    await TursoDatabaseInit.runMigrations(db as never);

    expect(
      db.statements.some((statement) =>
        statement.includes('ALTER TABLE messages ADD COLUMN reasoning_content TEXT DEFAULT NULL')
      )
    ).toBe(true);
  });

  it('does not add reasoning_content column when it already exists', async () => {
    const db = new MigrationDb(true);

    await TursoDatabaseInit.runMigrations(db as never);

    expect(
      db.statements.some((statement) =>
        statement.includes('ALTER TABLE messages ADD COLUMN reasoning_content TEXT DEFAULT NULL')
      )
    ).toBe(false);
  });
});
