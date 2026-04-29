import type {
  OpenAiSubscriptionTraceMetrics,
  SpanEventRecord,
  SpanRecord,
  TraceDetail,
  TraceSummary,
} from '@/types/trace';
import type { TursoClient } from './turso-client';

const DEFAULT_TRACE_LIMIT = 50;
const HTTP_REQUEST_BODY_EVENT = 'http.request.body';
const OPENAI_PROVIDER_KEY = 'gen_ai.system';
const OPENAI_MODEL_KEY = 'gen_ai.request.model';
const OPENAI_SUBSCRIPTION_PROVIDER = 'openai';
const HTTP_SSE_TRANSPORT = 'http-sse';
const WEBSOCKET_TRANSPORT = 'websocket';
const FULL_HISTORY_INPUT_MODE = 'full-history';
const INCREMENTAL_INPUT_MODE = 'incremental';
const PREVIOUS_RESPONSE_ID_KEY = 'previous_response_id';
const PREVIOUS_RESPONSE_ID_CAMEL_KEY = 'previousResponseId';

function safeJsonParse(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function toTraceSummary(row: {
  id: string;
  started_at: number;
  ended_at: number | null;
  metadata: string | null;
  span_count?: number | null;
}): TraceSummary {
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? null,
    metadata: safeJsonParse(row.metadata),
    spanCount: row.span_count ?? 0,
  };
}

function toSpanRecord(row: {
  id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string;
  started_at: number;
  ended_at: number | null;
  attributes: string | null;
}): SpanRecord {
  return {
    id: row.id,
    traceId: row.trace_id,
    parentSpanId: row.parent_span_id ?? null,
    name: row.name,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? null,
    attributes: safeJsonParse(row.attributes),
  };
}

function toSpanEventRecord(row: {
  id: string;
  span_id: string;
  timestamp: number;
  event_type: string;
  payload: string | null;
}): SpanEventRecord {
  let payload: unknown = null;
  if (row.payload) {
    try {
      payload = JSON.parse(row.payload);
    } catch {
      payload = row.payload;
    }
  }

  return {
    id: row.id,
    spanId: row.span_id,
    timestamp: row.timestamp,
    eventType: row.event_type,
    payload,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isOpenAiSubscriptionSpan(span: SpanRecord): boolean {
  const attributes = span.attributes;
  if (!attributes) {
    return false;
  }

  const provider = asString(attributes[OPENAI_PROVIDER_KEY]);
  if (provider !== OPENAI_SUBSCRIPTION_PROVIDER) {
    return false;
  }

  const model = asString(attributes[OPENAI_MODEL_KEY]);
  return model != null && model.length > 0;
}

function resolveOpenAiSubscriptionInputMode(
  payload: Record<string, unknown>,
  transport: string | null
): string | null {
  const explicitInputMode = asString(payload.input_mode) ?? asString(payload.inputMode);
  if (explicitInputMode) {
    return explicitInputMode;
  }

  const previousResponseId =
    asString(payload[PREVIOUS_RESPONSE_ID_KEY]) ??
    asString(payload[PREVIOUS_RESPONSE_ID_CAMEL_KEY]);
  if (previousResponseId) {
    return INCREMENTAL_INPUT_MODE;
  }

  if (transport === WEBSOCKET_TRANSPORT || transport === HTTP_SSE_TRANSPORT) {
    return FULL_HISTORY_INPUT_MODE;
  }

  return null;
}

function computeOpenAiSubscriptionTraceMetrics(
  spans: SpanRecord[],
  eventsBySpanId: Record<string, SpanEventRecord[]>
): OpenAiSubscriptionTraceMetrics | null {
  const llmSpans = spans.filter(isOpenAiSubscriptionSpan);
  if (llmSpans.length === 0) {
    return null;
  }

  const metrics: OpenAiSubscriptionTraceMetrics = {
    websocketTurnCount: 0,
    incrementalTurnCount: 0,
    baselineTurnCount: 0,
    httpFallbackCount: 0,
  };

  for (const span of llmSpans) {
    const requestEvent = (eventsBySpanId[span.id] ?? []).find(
      (event) => event.eventType === HTTP_REQUEST_BODY_EVENT
    );
    const payload = asRecord(requestEvent?.payload);
    if (!payload) {
      continue;
    }

    const transport = asString(payload.transport);
    if (transport === WEBSOCKET_TRANSPORT) {
      metrics.websocketTurnCount += 1;
    }
    if (transport === HTTP_SSE_TRANSPORT) {
      metrics.httpFallbackCount += 1;
    }

    const inputMode = resolveOpenAiSubscriptionInputMode(payload, transport);
    if (inputMode === INCREMENTAL_INPUT_MODE) {
      metrics.incrementalTurnCount += 1;
    } else if (inputMode === FULL_HISTORY_INPUT_MODE) {
      metrics.baselineTurnCount += 1;
    }
  }

  return metrics;
}

export class TraceService {
  constructor(private db: TursoClient) {}

  async ensureTrace(traceId: string, startedAt = Date.now()): Promise<void> {
    await this.db.execute(
      'INSERT OR IGNORE INTO traces (id, started_at, ended_at, metadata) VALUES ($1, $2, $3, $4)',
      [traceId, startedAt, null, null]
    );
  }

  async startSpan(input: {
    spanId: string;
    traceId: string;
    parentSpanId?: string | null;
    name: string;
    startedAt?: number;
    attributes?: Record<string, unknown> | null;
  }): Promise<void> {
    const startedAt = input.startedAt ?? Date.now();
    const attributes =
      input.attributes && Object.keys(input.attributes).length > 0
        ? JSON.stringify(input.attributes)
        : null;

    await this.ensureTrace(input.traceId, startedAt);

    await this.db.execute(
      'INSERT INTO spans (id, trace_id, parent_span_id, name, started_at, ended_at, attributes) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [
        input.spanId,
        input.traceId,
        input.parentSpanId ?? null,
        input.name,
        startedAt,
        null,
        attributes,
      ]
    );
  }

  async endSpan(spanId: string, endedAt = Date.now()): Promise<void> {
    await this.db.execute('UPDATE spans SET ended_at = $1 WHERE id = $2', [endedAt, spanId]);
  }

  async getTraces(limit = DEFAULT_TRACE_LIMIT, offset = 0): Promise<TraceSummary[]> {
    const rows = await this.db.select<
      Array<{
        id: string;
        started_at: number;
        ended_at: number | null;
        metadata: string | null;
        span_count: number | null;
      }>
    >(
      `SELECT
        t.id,
        COALESCE(MIN(s.started_at), t.started_at) AS started_at,
        COALESCE(MAX(s.ended_at), MAX(s.started_at), t.ended_at) AS ended_at,
        t.metadata,
        COUNT(s.id) AS span_count
      FROM traces t
      LEFT JOIN spans s ON s.trace_id = t.id
      GROUP BY t.id
      ORDER BY started_at DESC
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return rows.map(toTraceSummary);
  }

  async getTraceDetails(traceId: string): Promise<TraceDetail | null> {
    const traceRows = await this.db.select<
      Array<{
        id: string;
        started_at: number;
        ended_at: number | null;
        metadata: string | null;
        span_count: number | null;
      }>
    >(
      `SELECT
        t.id,
        COALESCE(MIN(s.started_at), t.started_at) AS started_at,
        COALESCE(MAX(s.ended_at), MAX(s.started_at), t.ended_at) AS ended_at,
        t.metadata,
        COUNT(s.id) AS span_count
      FROM traces t
      LEFT JOIN spans s ON s.trace_id = t.id
      WHERE t.id = $1
      GROUP BY t.id`,
      [traceId]
    );

    const traceRow = traceRows[0];
    if (!traceRow) {
      return null;
    }

    const spanRows = await this.db.select<
      Array<{
        id: string;
        trace_id: string;
        parent_span_id: string | null;
        name: string;
        started_at: number;
        ended_at: number | null;
        attributes: string | null;
      }>
    >(
      `SELECT
        id,
        trace_id,
        parent_span_id,
        name,
        started_at,
        ended_at,
        attributes
      FROM spans
      WHERE trace_id = $1
      ORDER BY started_at ASC`,
      [traceId]
    );

    const spans = spanRows.map(toSpanRecord);
    if (spans.length === 0) {
      return {
        trace: toTraceSummary(traceRow),
        spans,
        eventsBySpanId: {},
        openAiSubscriptionMetrics: null,
      };
    }

    const spanIds = spans.map((span) => span.id);
    const placeholders = spanIds.map((_, idx) => `$${idx + 1}`).join(',');
    const eventRows = await this.db.select<
      Array<{
        id: string;
        span_id: string;
        timestamp: number;
        event_type: string;
        payload: string | null;
      }>
    >(
      `SELECT
        id,
        span_id,
        timestamp,
        event_type,
        payload
      FROM span_events
      WHERE span_id IN (${placeholders})
      ORDER BY timestamp ASC`,
      spanIds
    );

    const eventsBySpanId: Record<string, SpanEventRecord[]> = {};
    for (const row of eventRows) {
      const event = toSpanEventRecord(row);
      const bucket = eventsBySpanId[event.spanId] ?? [];
      if (!eventsBySpanId[event.spanId]) {
        eventsBySpanId[event.spanId] = bucket;
      }
      bucket.push(event);
    }

    return {
      trace: toTraceSummary(traceRow),
      spans,
      eventsBySpanId,
      openAiSubscriptionMetrics: computeOpenAiSubscriptionTraceMetrics(spans, eventsBySpanId),
    };
  }

  async deleteOldTraces(cutoffTimestamp: number): Promise<void> {
    // Delete in proper order to respect foreign key constraints
    // 1. First delete span_events for spans belonging to old traces
    await this.db.execute(
      `DELETE FROM span_events WHERE span_id IN (
        SELECT id FROM spans WHERE trace_id IN (
          SELECT id FROM traces WHERE started_at < $1
        )
      )`,
      [cutoffTimestamp]
    );

    // 2. Then delete spans for old traces
    await this.db.execute(
      `DELETE FROM spans WHERE trace_id IN (
        SELECT id FROM traces WHERE started_at < $1
      )`,
      [cutoffTimestamp]
    );

    // 3. Finally delete the old traces
    await this.db.execute('DELETE FROM traces WHERE started_at < $1', [cutoffTimestamp]);
  }
}
