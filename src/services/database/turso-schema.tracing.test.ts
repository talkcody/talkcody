import type { Client } from '@libsql/client';
import { describe, expect, it } from 'vitest';
import { TursoSchema } from './turso-schema';

type ExecuteResult = {
  rows: unknown[];
};

class RecordingClient {
  readonly statements: string[] = [];

  async execute(sql: string, _args?: unknown[]): Promise<ExecuteResult> {
    this.statements.push(sql.trim());
    return { rows: [] };
  }
}

function expectStatement(statements: string[], snippet: string): void {
  const found = statements.some((statement) => statement.includes(snippet));
  expect(found).toBe(true);
}

describe('TursoSchema tracing tables', () => {
  it('creates tracing tables and indexes', async () => {
    const recorder = new RecordingClient();

    await TursoSchema.createTables(recorder as unknown as Client);

    const requiredStatements = [
      'CREATE TABLE IF NOT EXISTS traces',
      'CREATE TABLE IF NOT EXISTS spans',
      'CREATE TABLE IF NOT EXISTS span_events',
      'CREATE INDEX IF NOT EXISTS idx_spans_trace_id',
      'CREATE INDEX IF NOT EXISTS idx_spans_parent_span_id',
      'CREATE INDEX IF NOT EXISTS idx_span_events_span_id',
      'CREATE INDEX IF NOT EXISTS idx_traces_started_at',
      'CREATE INDEX IF NOT EXISTS idx_spans_started_at',
      'CREATE INDEX IF NOT EXISTS idx_span_events_timestamp',
      'CREATE INDEX IF NOT EXISTS idx_span_events_type',
      'reasoning_content TEXT DEFAULT NULL',
    ];

    for (const statement of requiredStatements) {
      expectStatement(recorder.statements, statement);
    }
  });
});
