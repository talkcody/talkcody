import { ChevronDown, ChevronRight } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import InfiniteScroll from '@/components/ui/infinite-scroll';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useLocale } from '@/hooks/use-locale';
import { logger } from '@/lib/logger';
import { databaseService } from '@/services/database-service';
import { useSettingsStore } from '@/stores/settings-store';
import type {
  OpenAiSubscriptionTraceMetrics,
  SpanEventRecord,
  SpanRecord,
  TraceDetail,
  TraceSummary,
} from '@/types/trace';

const MAX_JSON_PREVIEW = 2000;
const MAX_PAYLOAD_HEIGHT = '24rem';
const TRACE_PAGE_SIZE = 10;

const formatTraceCount = (count: number) => `${count} trace${count !== 1 ? 's' : ''}`;

function formatTimestamp(value: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatDuration(startedAt: number, endedAt: number | null) {
  if (!endedAt || endedAt < startedAt) return '--';
  const durationMs = endedAt - startedAt;
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder.toFixed(1)}s`;
}

function formatDurationMs(durationMs: number) {
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder.toFixed(1)}s`;
}

function formatJsonPreview(value: unknown) {
  if (value == null) return '—';
  try {
    const serialized = JSON.stringify(value, null, 2);
    if (serialized.length <= MAX_JSON_PREVIEW) return serialized;
    return `${serialized.slice(0, MAX_JSON_PREVIEW)}...`;
  } catch {
    return String(value);
  }
}

function shouldShowFullPayload(event: SpanEventRecord) {
  return (
    event.eventType === 'http.request.body' ||
    event.eventType === 'http.response.body' ||
    event.eventType === 'gen_ai.response.body'
  );
}

function getSpanLabel(span: SpanRecord) {
  return span.name || span.id;
}

function isLlmStepSpan(span: SpanRecord) {
  return /^Step\d+-llm$/.test(span.name);
}

function getTransportMetricCards(
  metrics: OpenAiSubscriptionTraceMetrics,
  tracingLocale: ReturnType<typeof useLocale>['t']['Tracing']
) {
  return [
    {
      label: tracingLocale.websocketTurnCountLabel,
      value: metrics.websocketTurnCount,
    },
    {
      label: tracingLocale.incrementalTurnCountLabel,
      value: metrics.incrementalTurnCount,
    },
    {
      label: tracingLocale.baselineTurnCountLabel,
      value: metrics.baselineTurnCount,
    },
    {
      label: tracingLocale.httpFallbackCountLabel,
      value: metrics.httpFallbackCount,
    },
  ];
}

// Build span hierarchy tree
function buildSpanTree(spans: SpanRecord[]): SpanNode[] {
  const spanMap = new Map<string, SpanNode>();
  const roots: SpanNode[] = [];

  // First pass: create nodes
  for (const span of spans) {
    spanMap.set(span.id, {
      span,
      children: [],
      depth: 0,
    });
  }

  // Second pass: build hierarchy
  for (const span of spans) {
    const node = spanMap.get(span.id)!;
    if (span.parentSpanId && spanMap.has(span.parentSpanId)) {
      const parent = spanMap.get(span.parentSpanId)!;
      parent.children.push(node);
      node.depth = parent.depth + 1;
    } else {
      roots.push(node);
    }
  }

  // Sort by start time
  const sortByTime = (a: SpanNode, b: SpanNode) => a.span.startedAt - b.span.startedAt;
  roots.sort(sortByTime);
  for (const node of spanMap.values()) {
    node.children.sort(sortByTime);
  }

  return roots;
}

interface SpanNode {
  span: SpanRecord;
  children: SpanNode[];
  depth: number;
}

export function LLMTracingPage() {
  const { t } = useLocale();
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMoreTraces, setLoadingMoreTraces] = useState(false);
  const [hasMoreTraces, setHasMoreTraces] = useState(true);
  const [traceOffset, setTraceOffset] = useState(0);
  const [traceListScrollRoot, setTraceListScrollRoot] = useState<HTMLDivElement | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSpans, setExpandedSpans] = useState<Set<string>>(() => new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const traceEnabled = useSettingsStore((state) => state.trace_enabled);
  const setTraceEnabled = useSettingsStore((state) => state.setTraceEnabled);

  const loadTraces = useCallback(async () => {
    if (!traceEnabled) {
      setTraces([]);
      setSelectedTraceId(null);
      setDetail(null);
      setLoadingList(false);
      setLoadingMoreTraces(false);
      setHasMoreTraces(false);
      setTraceOffset(0);
      setError(null);
      return;
    }

    setLoadingList(true);
    setLoadingMoreTraces(false);
    setError(null);
    try {
      const list = await databaseService.getTraces(TRACE_PAGE_SIZE, 0);
      setTraces(list);
      setTraceOffset(list.length);
      setHasMoreTraces(list.length === TRACE_PAGE_SIZE);
      if (list.length > 0) {
        setSelectedTraceId((current) =>
          current && list.some((trace) => trace.id === current) ? current : (list[0]?.id ?? null)
        );
      } else {
        setSelectedTraceId(null);
        setDetail(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t.Tracing.loadError;
      setError(message);
      logger.error('Failed to load traces', err);
    } finally {
      setLoadingList(false);
    }
  }, [t.Tracing.loadError, traceEnabled]);

  const loadMoreTraces = useCallback(async () => {
    if (loadingList || loadingMoreTraces || !hasMoreTraces || !traceEnabled) {
      return;
    }

    setLoadingMoreTraces(true);
    setError(null);
    try {
      const list = await databaseService.getTraces(TRACE_PAGE_SIZE, traceOffset);
      setTraces((current) => {
        const existingIds = new Set(current.map((trace) => trace.id));
        return current.concat(list.filter((trace) => !existingIds.has(trace.id)));
      });
      setTraceOffset((current) => current + list.length);
      if (list.length < TRACE_PAGE_SIZE) {
        setHasMoreTraces(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t.Tracing.loadError;
      setError(message);
      logger.error('Failed to load more traces', err);
    } finally {
      setLoadingMoreTraces(false);
    }
  }, [
    hasMoreTraces,
    loadingList,
    loadingMoreTraces,
    t.Tracing.loadError,
    traceEnabled,
    traceOffset,
  ]);

  const loadTraceDetail = useCallback(
    async (traceId: string) => {
      if (!traceEnabled) {
        setDetail(null);
        setLoadingDetail(false);
        return;
      }

      setLoadingDetail(true);
      setError(null);
      try {
        const result = await databaseService.getTraceDetails(traceId);
        setDetail(result);
        // Expand root LLM spans by default to reduce initial render cost.
        if (result?.spans) {
          const rootSpanIds = result.spans
            .filter((span) => isLlmStepSpan(span) && !span.parentSpanId)
            .map((span) => span.id);
          setExpandedSpans(new Set(rootSpanIds));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : t.Tracing.loadError;
        setError(message);
        logger.error('Failed to load trace detail', err);
      } finally {
        setLoadingDetail(false);
      }
    },
    [t.Tracing.loadError, traceEnabled]
  );

  const handleDeleteOldTraces = useCallback(async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      // Calculate cutoff timestamp (3 days ago)
      const cutoffTimestamp = Date.now() - 3 * 24 * 60 * 60 * 1000;
      await databaseService.deleteOldTraces(cutoffTimestamp);
      logger.info('Deleted old traces successfully');
      setShowDeleteConfirm(false);
      // Reload traces after deletion
      await loadTraces();
    } catch (err) {
      const message = err instanceof Error ? err.message : t.Tracing.deleteOldTracesError;
      setDeleteError(message);
      logger.error('Failed to delete old traces', err);
    } finally {
      setIsDeleting(false);
    }
  }, [loadTraces, t.Tracing.deleteOldTracesError]);

  useEffect(() => {
    loadTraces();
  }, [loadTraces]);

  useEffect(() => {
    if (selectedTraceId && traceEnabled) {
      loadTraceDetail(selectedTraceId);
    }
  }, [selectedTraceId, traceEnabled, loadTraceDetail]);

  const selectedTrace = detail?.trace ?? null;
  const spanEventsMap = detail?.eventsBySpanId ?? {};
  const visibleSpans = useMemo(
    () => detail?.spans?.filter((span) => isLlmStepSpan(span)) ?? [],
    [detail?.spans]
  );

  // Build span tree for hierarchical display
  const spanTree = useMemo(() => {
    if (visibleSpans.length === 0) return [];
    return buildSpanTree(visibleSpans);
  }, [visibleSpans]);

  // Calculate timeline bounds
  const timelineBounds = useMemo(() => {
    if (visibleSpans.length === 0) return null;
    const start = Math.min(...visibleSpans.map((s) => s.startedAt));
    const end = Math.max(...visibleSpans.map((s) => s.endedAt ?? s.startedAt));
    return { start, end, duration: Math.max(end - start, 0) };
  }, [visibleSpans]);

  const traceTiming = useMemo(() => {
    if (timelineBounds) {
      return {
        startedAt: timelineBounds.start,
        endedAt: timelineBounds.end,
      };
    }
    return selectedTrace
      ? {
          startedAt: selectedTrace.startedAt,
          endedAt: selectedTrace.endedAt ?? null,
        }
      : null;
  }, [selectedTrace, timelineBounds]);

  const toggleSpanExpanded = useCallback((spanId: string) => {
    setExpandedSpans((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) {
        next.delete(spanId);
      } else {
        next.add(spanId);
      }
      return next;
    });
  }, []);

  const traceListContent = useMemo(() => {
    if (!traceEnabled) {
      return <div className="p-4 text-sm text-muted-foreground">{t.Tracing.disabledListHint}</div>;
    }

    if (loadingList) {
      return (
        <div className="space-y-2 p-4">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      );
    }

    if (error) {
      return <div className="p-4 text-sm text-red-600 dark:text-red-400">{error}</div>;
    }

    if (traces.length === 0) {
      return <div className="p-4 text-sm text-muted-foreground">{t.Tracing.emptyDescription}</div>;
    }

    return (
      <div className="space-y-1 p-2">
        {traces.map((trace) => {
          const isSelected = trace.id === selectedTraceId;
          return (
            <button
              key={trace.id}
              type="button"
              className={`w-full rounded-lg border px-3 py-2.5 text-left transition-all duration-200 ${
                isSelected
                  ? 'border-blue-500/50 bg-gradient-to-r from-blue-500/10 to-blue-500/5 text-blue-700 shadow-sm dark:border-blue-400/50 dark:from-blue-500/20 dark:to-blue-500/10 dark:text-blue-200'
                  : 'border-transparent hover:border-gray-200 hover:bg-gray-50/80 dark:hover:border-gray-800 dark:hover:bg-gray-900/80'
              }`}
              onClick={() => setSelectedTraceId(trace.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs text-foreground">{trace.id}</span>
                <Badge
                  variant={isSelected ? 'default' : 'secondary'}
                  className="text-[10px] px-1.5 py-0 h-5 shrink-0"
                >
                  {trace.spanCount} spans
                </Badge>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="truncate">{formatTimestamp(trace.startedAt)}</span>
                <span className="shrink-0 ml-2 font-medium">
                  {formatDuration(trace.startedAt, trace.endedAt)}
                </span>
              </div>
            </button>
          );
        })}
        {traceListScrollRoot && hasMoreTraces && (
          <InfiniteScroll
            hasMore={hasMoreTraces}
            isLoading={loadingMoreTraces}
            next={loadMoreTraces}
            root={traceListScrollRoot}
            threshold={1}
          >
            <div className="flex h-8 items-center justify-center px-3 py-2">
              {loadingMoreTraces ? (
                <span className="text-xs text-muted-foreground">{t.Common.loading}</span>
              ) : (
                <span aria-hidden="true" className="block h-2 w-full" />
              )}
            </div>
          </InfiniteScroll>
        )}
      </div>
    );
  }, [
    error,
    hasMoreTraces,
    loadingList,
    loadingMoreTraces,
    loadMoreTraces,
    selectedTraceId,
    t.Common.loading,
    t.Tracing.disabledListHint,
    t.Tracing.emptyDescription,
    traceEnabled,
    traceListScrollRoot,
    traces,
  ]);

  // Render span tree node recursively
  const renderSpanNode = useCallback(
    (node: SpanNode): React.ReactNode => {
      const span = node.span;
      const isExpanded = expandedSpans.has(span.id);
      const hasChildren = node.children.length > 0;
      const events = spanEventsMap[span.id] ?? [];

      return (
        <div key={span.id} className="select-none">
          <div
            className="flex items-center gap-1.5 py-1.5 px-2 hover:bg-accent/60 rounded-md cursor-pointer transition-colors group"
            style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
            onClick={() => toggleSpanExpanded(span.id)}
          >
            {hasChildren ? (
              isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground transition-transform" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground transition-transform" />
              )
            ) : (
              <span className="w-3.5" />
            )}
            <span className="text-xs font-medium text-foreground">{getSpanLabel(span)}</span>
            <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0 h-4">
              {formatDuration(span.startedAt, span.endedAt)}
            </Badge>
          </div>
          {isExpanded && (
            <div className="mt-1 animate-in slide-in-from-top-1 duration-150">
              <Card className="ml-5 border-muted shadow-sm">
                <CardHeader className="py-2.5 px-3 space-y-1">
                  <CardDescription className="font-mono text-[10px] text-muted-foreground">
                    {span.id}
                  </CardDescription>
                  <div className="text-[11px] text-muted-foreground">
                    Started: {formatTimestamp(span.startedAt)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-0 px-3 pb-3">
                  {span.attributes && Object.keys(span.attributes).length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
                        {t.Tracing.attributesLabel}
                      </div>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2.5 text-[11px]">
                        {formatJsonPreview(span.attributes)}
                      </pre>
                    </div>
                  )}
                  <div>
                    <div className="text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
                      {t.Tracing.eventsTitle} ({events.length})
                    </div>
                    {events.length === 0 ? (
                      <div className="text-[11px] text-muted-foreground py-2">
                        {t.Tracing.noEvents}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {events.map((event) => (
                          <TraceEventRow key={event.id} event={event} />
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
              {node.children.map((child) => renderSpanNode(child))}
            </div>
          )}
        </div>
      );
    },
    [expandedSpans, spanEventsMap, t.Tracing, toggleSpanExpanded]
  );

  const allSpans = useMemo(() => {
    if (!spanTree.length) return [];
    const flattenSpans = (nodes: SpanNode[], result: SpanNode[] = []) => {
      for (const node of nodes) {
        result.push(node);
        flattenSpans(node.children, result);
      }
      return result;
    };

    return flattenSpans(spanTree);
  }, [spanTree]);

  // Render timeline view
  const renderTimelineView = useCallback(() => {
    if (!visibleSpans.length || !timelineBounds) {
      return (
        <div className="py-8 text-sm text-muted-foreground text-center">{t.Tracing.noSpans}</div>
      );
    }

    const { start, duration } = timelineBounds;

    return (
      <div className="space-y-4">
        <div className="relative bg-muted/30 rounded-lg p-3">
          {/* Time markers */}
          <div className="relative h-5 border-b border-border mb-3">
            {[0, 25, 50, 75, 100].map((pct) => (
              <div
                key={pct}
                className="absolute text-[10px] text-muted-foreground transform -translate-x-1/2"
                style={{ left: `${pct}%` }}
              >
                {formatDurationMs((duration * pct) / 100)}
              </div>
            ))}
          </div>

          {/* Span bars */}
          <div className="space-y-1.5">
            {allSpans.map((node) => {
              const span = node.span;
              const spanStart = span.startedAt - start;
              const spanDuration = (span.endedAt ?? span.startedAt) - span.startedAt;
              const leftPercent = (spanStart / duration) * 100;
              const widthPercent = Math.max((spanDuration / duration) * 100, 0.5);

              return (
                <div
                  key={span.id}
                  className="flex items-center gap-2 py-1 hover:bg-accent/50 rounded transition-colors"
                  style={{ paddingLeft: `${node.depth * 12}px` }}
                >
                  <div
                    className="w-28 truncate text-[11px] font-medium text-foreground"
                    title={getSpanLabel(span)}
                  >
                    {getSpanLabel(span)}
                  </div>
                  <div className="flex-1 relative h-5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="absolute h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all shadow-sm"
                      style={{
                        left: `${Math.min(leftPercent, 100)}%`,
                        width: `${Math.min(widthPercent, 100 - leftPercent)}%`,
                      }}
                      title={`${getSpanLabel(span)}: ${formatDurationMs(spanDuration)}`}
                    />
                  </div>
                  <div className="w-14 text-[10px] text-muted-foreground text-right font-medium">
                    {formatDurationMs(spanDuration)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Span details */}
        <div className="mt-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            {t.Tracing.spansTitle}
          </h4>
          <div className="space-y-1">{spanTree.map((node) => renderSpanNode(node))}</div>
        </div>
      </div>
    );
  }, [
    visibleSpans.length,
    timelineBounds,
    t.Tracing.noSpans,
    t.Tracing.spansTitle,
    allSpans,
    renderSpanNode,
    spanTree,
  ]);

  const detailContent = useMemo(() => {
    if (!traceEnabled) {
      return (
        <div className="mx-auto w-full max-w-4xl space-y-3 p-6">
          <div className="rounded-lg border border-dashed border-muted bg-muted/30 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{t.Tracing.disabledTitle}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t.Tracing.disabledBody}</p>
          </div>
        </div>
      );
    }

    if (loadingDetail) {
      return (
        <div className="space-y-4 p-6">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      );
    }

    if (!selectedTrace) {
      return <div className="p-6 text-sm text-muted-foreground">{t.Tracing.selectTrace}</div>;
    }

    const startedAt = traceTiming?.startedAt ?? selectedTrace.startedAt;
    const endedAt = traceTiming?.endedAt ?? selectedTrace.endedAt;
    const transportMetricCards = detail?.openAiSubscriptionMetrics
      ? getTransportMetricCards(detail.openAiSubscriptionMetrics, t.Tracing)
      : [];

    return (
      <div className="mx-auto w-full max-w-6xl space-y-5 p-4">
        {/* Trace Header */}
        <div className="bg-gradient-to-br from-card to-card/80 rounded-xl border p-4 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-foreground">{t.Tracing.detailTitle}</h2>
              <p className="mt-1 font-mono text-xs text-muted-foreground truncate">
                {selectedTrace.id}
              </p>
            </div>
            <Badge variant="outline" className="shrink-0 text-xs">
              {selectedTrace.spanCount} spans
            </Badge>
          </div>
          <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-foreground">
                {t.Tracing.startedAtLabel}:
              </span>
              <span className="text-xs">{formatTimestamp(startedAt)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-foreground">
                {t.Tracing.durationLabel}:
              </span>
              <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                {formatDuration(startedAt, endedAt ?? null)}
              </span>
            </div>
          </div>
          {transportMetricCards.length > 0 && (
            <div className="mt-4 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
                {t.Tracing.transportMetricsTitle}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {transportMetricCards.map((metric) => (
                  <div
                    key={metric.label}
                    className="rounded-md border border-border/60 bg-background/80 px-3 py-2"
                  >
                    <div className="text-[11px] text-muted-foreground">{metric.label}</div>
                    <div className="mt-1 text-lg font-semibold text-foreground">{metric.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Span Content */}
        <div className="bg-card rounded-xl border shadow-sm">
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold">{t.Tracing.spansTitle}</h3>
          </div>
          <div className="p-4">
            {visibleSpans.length ? (
              renderTimelineView()
            ) : (
              <div className="text-sm text-muted-foreground py-8 text-center">
                {t.Tracing.noSpans}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }, [
    detail,
    loadingDetail,
    renderTimelineView,
    selectedTrace,
    traceEnabled,
    traceTiming,
    t.Tracing,
    visibleSpans.length,
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center justify-between border-b bg-card px-4 py-3">
        <div>
          <h1 className="text-xl font-bold">{t.Tracing.title}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{t.Tracing.description}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {traceEnabled ? t.Tracing.enabledLabel : t.Tracing.disabledLabel}
            </span>
            <Switch
              checked={traceEnabled}
              onCheckedChange={setTraceEnabled}
              aria-label={t.Tracing.toggleLabel}
            />
          </div>
          <Button onClick={loadTraces} disabled={loadingList || !traceEnabled} size="sm">
            {t.Common.refresh}
          </Button>
          <Button
            onClick={() => setShowDeleteConfirm(true)}
            disabled={!traceEnabled}
            size="sm"
            variant="destructive"
          >
            {t.Tracing.deleteOldTracesButton}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="w-80 min-h-0 min-w-[320px] max-w-[400px] border-r bg-card/50">
          <div className="flex h-full min-h-0 flex-col">
            <div className="border-b px-3 py-2.5 bg-card">
              <h2 className="text-sm font-semibold text-foreground">{t.Tracing.listTitle}</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {traceEnabled ? formatTraceCount(traces.length) : t.Tracing.disabledTraceCountLabel}
              </p>
            </div>
            <div
              ref={setTraceListScrollRoot}
              data-testid="trace-list-scroll-container"
              className="min-h-0 flex-1 overflow-auto"
            >
              {traceListContent}
            </div>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
          <ScrollArea className="flex-1">{detailContent}</ScrollArea>
        </div>
      </div>

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.Tracing.deleteOldTracesButton}</DialogTitle>
            <DialogDescription>{t.Tracing.deleteOldTracesConfirm}</DialogDescription>
          </DialogHeader>
          {deleteError && <div className="text-sm text-destructive py-2">{deleteError}</div>}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteConfirm(false)}
              disabled={isDeleting}
            >
              {t.Common.cancel}
            </Button>
            <Button variant="destructive" onClick={handleDeleteOldTraces} disabled={isDeleting}>
              {isDeleting ? t.Tracing.deletingLabel : t.Common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const TraceEventRow = memo(function TraceEventRow({ event }: { event: SpanEventRecord }) {
  const showFullPayload = shouldShowFullPayload(event);
  const payloadPreview = showFullPayload
    ? JSON.stringify(event.payload, null, 2)
    : formatJsonPreview(event.payload);

  return (
    <details className="rounded-md border border-muted bg-card/50 px-2.5 py-1.5 text-[11px] group">
      <summary className="flex cursor-pointer items-center justify-between gap-2 list-none">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 shrink-0 font-normal">
            {event.eventType}
          </Badge>
          <span className="text-muted-foreground text-[10px] truncate">
            {formatTimestamp(event.timestamp)}
          </span>
        </div>
        <span className="text-muted-foreground/60 text-[10px] truncate max-w-[150px] font-mono">
          {event.id}
        </span>
      </summary>
      <pre
        className="mt-2 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2.5 text-[11px] border border-muted/50"
        style={{ maxHeight: MAX_PAYLOAD_HEIGHT }}
      >
        {payloadPreview}
      </pre>
    </details>
  );
});

TraceEventRow.displayName = 'TraceEventRow';
