export type TraceSummary = {
  id: string;
  startedAt: number;
  endedAt: number | null;
  metadata: Record<string, unknown> | null;
  spanCount: number;
};

export type OpenAiSubscriptionTraceMetrics = {
  websocketTurnCount: number;
  incrementalTurnCount: number;
  baselineTurnCount: number;
  httpFallbackCount: number;
};

export type SpanRecord = {
  id: string;
  traceId: string;
  parentSpanId: string | null;
  name: string;
  startedAt: number;
  endedAt: number | null;
  attributes: Record<string, unknown> | null;
};

export type SpanEventRecord = {
  id: string;
  spanId: string;
  timestamp: number;
  eventType: string;
  payload: unknown;
};

export type TraceDetail = {
  trace: TraceSummary;
  spans: SpanRecord[];
  eventsBySpanId: Record<string, SpanEventRecord[]>;
  openAiSubscriptionMetrics?: OpenAiSubscriptionTraceMetrics | null;
};
