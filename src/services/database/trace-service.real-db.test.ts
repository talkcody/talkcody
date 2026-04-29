/**
 * TraceService Tests
 *
 * Uses real database operations with in-memory SQLite.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TraceService } from './trace-service';
import { TestDatabaseAdapter } from '@/test/infrastructure/adapters/test-database-adapter';
import { mockLogger } from '@/test/mocks';

vi.mock('@/lib/logger', () => mockLogger);

describe('TraceService', () => {
  let db: TestDatabaseAdapter;
  let service: TraceService;

  beforeEach(() => {
    db = new TestDatabaseAdapter();
    service = new TraceService(db.getTursoClientAdapter());
  });

  afterEach(() => {
    db.close();
  });

  it('uses span timing for trace summary when spans exist', async () => {
    const traceId = 'trace-1';
    const spanId = 'span-1';

    db.rawExecute(
      'INSERT INTO traces (id, started_at, ended_at, metadata) VALUES (?, ?, ?, ?)',
      [traceId, 1111, 2222, null]
    );
    db.rawExecute(
      'INSERT INTO spans (id, trace_id, parent_span_id, name, started_at, ended_at, attributes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [spanId, traceId, null, 'llm.stream_completion', 5000, 8000, '{}']
    );

    const traces = await service.getTraces();
    const trace = traces.find((item) => item.id === traceId);

    expect(trace).toBeDefined();
    expect(trace?.startedAt).toBe(5000);
    expect(trace?.endedAt).toBe(8000);
    expect(trace?.spanCount).toBe(1);
  });

  it('falls back to trace timing when no spans exist', async () => {
    const traceId = 'trace-2';

    db.rawExecute(
      'INSERT INTO traces (id, started_at, ended_at, metadata) VALUES (?, ?, ?, ?)',
      [traceId, 3000, 4000, null]
    );

    const traces = await service.getTraces();
    const trace = traces.find((item) => item.id === traceId);

    expect(trace).toBeDefined();
    expect(trace?.startedAt).toBe(3000);
    expect(trace?.endedAt).toBe(4000);
    expect(trace?.spanCount).toBe(0);
  });

  it('uses span timing for trace detail when spans exist', async () => {
    const traceId = 'trace-3';
    const spanId = 'span-3';

    db.rawExecute(
      'INSERT INTO traces (id, started_at, ended_at, metadata) VALUES (?, ?, ?, ?)',
      [traceId, 1000, 2000, null]
    );
    db.rawExecute(
      'INSERT INTO spans (id, trace_id, parent_span_id, name, started_at, ended_at, attributes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [spanId, traceId, null, 'llm.stream_completion', 7000, 9000, '{}']
    );

    const detail = await service.getTraceDetails(traceId);

    expect(detail).not.toBeNull();
    expect(detail?.trace.startedAt).toBe(7000);
    expect(detail?.trace.endedAt).toBe(9000);
    expect(detail?.trace.spanCount).toBe(1);
  });

  it('creates and closes tool spans with ensureTrace', async () => {
    const traceId = 'trace-tool-1';
    const spanId = 'span-tool-1';

    await service.startSpan({
      spanId,
      traceId,
      name: 'Step1-tool-bash',
      startedAt: 1234,
      attributes: { toolName: 'bash' },
    });

    await service.endSpan(spanId, 2345);

    const detail = await service.getTraceDetails(traceId);

    expect(detail).not.toBeNull();
    expect(detail?.trace.spanCount).toBe(1);
    expect(detail?.spans[0]?.name).toBe('Step1-tool-bash');
    expect(detail?.spans[0]?.startedAt).toBe(1234);
    expect(detail?.spans[0]?.endedAt).toBe(2345);
  });

  it('stores null attributes when span attributes are omitted', async () => {
    const traceId = 'trace-tool-2';
    const spanId = 'span-tool-2';

    await service.startSpan({
      spanId,
      traceId,
      name: 'Step1-tool-glob',
      startedAt: 3456,
    });

    const detail = await service.getTraceDetails(traceId);

    expect(detail?.spans[0]?.attributes).toBeNull();
  });

  it('computes transport counters for openai subscription traces', async () => {
    const traceId = 'trace-openai-subscription';
    const websocketBaselineSpanId = 'span-openai-baseline';
    const websocketIncrementalSpanId = 'span-openai-incremental';
    const httpFallbackSpanId = 'span-openai-http';

    db.rawExecute(
      'INSERT INTO traces (id, started_at, ended_at, metadata) VALUES (?, ?, ?, ?)',
      [traceId, 1000, 2000, null]
    );

    db.rawExecute(
      'INSERT INTO spans (id, trace_id, parent_span_id, name, started_at, ended_at, attributes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        websocketBaselineSpanId,
        traceId,
        null,
        'Step1-llm',
        1100,
        1200,
        JSON.stringify({
          'gen_ai.system': 'openai',
          'gen_ai.request.model': 'gpt-5.4',
        }),
      ]
    );
    db.rawExecute(
      'INSERT INTO spans (id, trace_id, parent_span_id, name, started_at, ended_at, attributes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        websocketIncrementalSpanId,
        traceId,
        null,
        'Step2-llm',
        1300,
        1400,
        JSON.stringify({
          'gen_ai.system': 'openai',
          'gen_ai.request.model': 'gpt-5.4',
        }),
      ]
    );
    db.rawExecute(
      'INSERT INTO spans (id, trace_id, parent_span_id, name, started_at, ended_at, attributes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        httpFallbackSpanId,
        traceId,
        null,
        'Step3-llm',
        1500,
        1600,
        JSON.stringify({
          'gen_ai.system': 'openai',
          'gen_ai.request.model': 'gpt-5.4',
        }),
      ]
    );

    db.rawExecute(
      'INSERT INTO span_events (id, span_id, timestamp, event_type, payload) VALUES (?, ?, ?, ?, ?)',
      [
        'event-openai-baseline',
        websocketBaselineSpanId,
        1101,
        'http.request.body',
        JSON.stringify({ transport: 'websocket', input_mode: 'full-history' }),
      ]
    );
    db.rawExecute(
      'INSERT INTO span_events (id, span_id, timestamp, event_type, payload) VALUES (?, ?, ?, ?, ?)',
      [
        'event-openai-incremental',
        websocketIncrementalSpanId,
        1301,
        'http.request.body',
        JSON.stringify({ transport: 'websocket', input_mode: 'incremental' }),
      ]
    );
    db.rawExecute(
      'INSERT INTO span_events (id, span_id, timestamp, event_type, payload) VALUES (?, ?, ?, ?, ?)',
      [
        'event-openai-http',
        httpFallbackSpanId,
        1501,
        'http.request.body',
        JSON.stringify({ transport: 'http-sse', input_mode: 'full-history' }),
      ]
    );

    const detail = await service.getTraceDetails(traceId);

    expect(detail?.openAiSubscriptionMetrics).toEqual({
      websocketTurnCount: 2,
      incrementalTurnCount: 1,
      baselineTurnCount: 2,
      httpFallbackCount: 1,
    });
  });

  it('infers incremental websocket turns from previous_response_id when input mode metadata is absent', async () => {
    const traceId = 'trace-openai-subscription-inferred';
    const websocketBaselineSpanId = 'span-openai-inferred-baseline';
    const websocketIncrementalSpanId = 'span-openai-inferred-incremental';
    const httpFallbackSpanId = 'span-openai-inferred-http';

    db.rawExecute(
      'INSERT INTO traces (id, started_at, ended_at, metadata) VALUES (?, ?, ?, ?)',
      [traceId, 2000, 3000, null]
    );

    for (const [spanId, name, startedAt, endedAt] of [
      [websocketBaselineSpanId, 'Step1-llm', 2100, 2200],
      [websocketIncrementalSpanId, 'Step2-llm', 2300, 2400],
      [httpFallbackSpanId, 'Step3-llm', 2500, 2600],
    ] as const) {
      db.rawExecute(
        'INSERT INTO spans (id, trace_id, parent_span_id, name, started_at, ended_at, attributes) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          spanId,
          traceId,
          null,
          name,
          startedAt,
          endedAt,
          JSON.stringify({
            'gen_ai.system': 'openai',
            'gen_ai.request.model': 'gpt-5.4',
          }),
        ]
      );
    }

    db.rawExecute(
      'INSERT INTO span_events (id, span_id, timestamp, event_type, payload) VALUES (?, ?, ?, ?, ?)',
      [
        'event-openai-inferred-baseline',
        websocketBaselineSpanId,
        2101,
        'http.request.body',
        JSON.stringify({ transport: 'websocket', input: [{ role: 'user', content: 'hello' }] }),
      ]
    );
    db.rawExecute(
      'INSERT INTO span_events (id, span_id, timestamp, event_type, payload) VALUES (?, ?, ?, ?, ?)',
      [
        'event-openai-inferred-incremental',
        websocketIncrementalSpanId,
        2301,
        'http.request.body',
        JSON.stringify({
          transport: 'websocket',
          previous_response_id: 'resp_123',
          input: [{ type: 'function_call_output', call_id: 'call_1', output: 'ok' }],
        }),
      ]
    );
    db.rawExecute(
      'INSERT INTO span_events (id, span_id, timestamp, event_type, payload) VALUES (?, ?, ?, ?, ?)',
      [
        'event-openai-inferred-http',
        httpFallbackSpanId,
        2501,
        'http.request.body',
        JSON.stringify({ transport: 'http-sse', input: [{ role: 'user', content: 'retry' }] }),
      ]
    );

    const detail = await service.getTraceDetails(traceId);

    expect(detail?.openAiSubscriptionMetrics).toEqual({
      websocketTurnCount: 2,
      incrementalTurnCount: 1,
      baselineTurnCount: 2,
      httpFallbackCount: 1,
    });
  });
});

