import { act, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMTracingPage } from './llm-tracing-page';

class MockIntersectionObserver {
  public callback: IntersectionObserverCallback;
  public options?: IntersectionObserverInit;
  public observe = vi.fn();
  public unobserve = vi.fn();
  public disconnect = vi.fn();
  public takeRecords = vi.fn(() => []);

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    MockIntersectionObserver.lastInstance = this;
  }

  trigger(entries: IntersectionObserverEntry[] = []) {
    this.callback(entries, this as unknown as IntersectionObserver);
  }

  static lastInstance: MockIntersectionObserver | null = null;
}

const originalIntersectionObserver = globalThis.IntersectionObserver;

const {
  getTracesMock,
  getTraceDetailsMock,
  deleteOldTracesMock,
  setTraceEnabledMock,
} = vi.hoisted(() => ({
  getTracesMock: vi.fn(),
  getTraceDetailsMock: vi.fn(),
  deleteOldTracesMock: vi.fn(),
  setTraceEnabledMock: vi.fn(),
}));

vi.mock('@/services/database-service', () => ({
  databaseService: {
    getTraces: getTracesMock,
    getTraceDetails: getTraceDetailsMock,
    deleteOldTraces: deleteOldTracesMock,
  },
}));

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({
      trace_enabled: true,
      setTraceEnabled: setTraceEnabledMock,
    }),
}));

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    t: {
      Tracing: {
        title: 'Tracing',
        description: 'Inspect traces',
        listTitle: 'Traces',
        detailTitle: 'Trace Details',
        transportMetricsTitle: 'OpenAI Subscription Transport',
        websocketTurnCountLabel: 'WebSocket turns',
        incrementalTurnCountLabel: 'Incremental turns',
        baselineTurnCountLabel: 'Baseline turns',
        httpFallbackCountLabel: 'HTTP fallback turns',
        spansTitle: 'Spans',
        eventsTitle: 'Events',
        attributesLabel: 'Attributes',
        startedAtLabel: 'Started',
        durationLabel: 'Duration',
        spanCountLabel: 'Span Count',
        loadError: 'Failed to load trace data',
        emptyDescription: 'No traces recorded yet.',
        selectTrace: 'Select a trace to view details.',
        noSpans: 'No spans found for this trace.',
        noEvents: 'No events recorded.',
        toggleLabel: 'Toggle tracing',
        enabledLabel: 'Tracing on',
        disabledLabel: 'Tracing off',
        disabledTitle: 'Tracing is disabled',
        disabledBody: 'Turn tracing on.',
        disabledListHint: 'Tracing is disabled.',
        disabledTraceCountLabel: 'Tracing disabled',
        deleteOldTracesButton: 'Delete Old Traces',
        deleteOldTracesConfirm: 'Delete old traces?',
        deleteOldTracesSuccess: 'Deleted old traces successfully',
        deleteOldTracesError: 'Failed to delete old traces',
        deletingLabel: 'Deleting...',
      },
      Common: {
        refresh: 'Refresh',
        cancel: 'Cancel',
        delete: 'Delete',
        loading: 'Loading...',
      },
    },
  }),
}));

function createTraceSummary(id: string, startedAt: number, spanCount = 1) {
  return {
    id,
    startedAt,
    endedAt: startedAt + 5000,
    metadata: null,
    spanCount,
  };
}

function createTraceDetail(trace: ReturnType<typeof createTraceSummary>) {
  return {
    trace,
    spans: [],
    eventsBySpanId: {},
    openAiSubscriptionMetrics: null,
  };
}

function createSpan(
  id: string,
  name: string,
  startedAt: number,
  attributes: Record<string, unknown> | null = null
) {
  return {
    id,
    traceId: 'trace-id',
    parentSpanId: null,
    name,
    startedAt,
    endedAt: startedAt + 100,
    attributes,
  };
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
});

afterAll(() => {
  (globalThis as Record<string, unknown>).IntersectionObserver = originalIntersectionObserver;
});

afterEach(() => {
  MockIntersectionObserver.lastInstance = null;
});

describe('LLMTracingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads traces in batches of 10 and uses the list scroll container as the infinite scroll root', async () => {
    const firstPage = Array.from({ length: 10 }, (_, index) =>
      createTraceSummary(`trace-${String(index + 1).padStart(2, '0')}`, 1710000000000 - index * 1000)
    );
    const secondPage = [createTraceSummary('trace-11', 1709999989000)];

    getTracesMock.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage);
    getTraceDetailsMock.mockResolvedValue(createTraceDetail(firstPage[0]));

    render(<LLMTracingPage />);

    await waitFor(() => {
      expect(getTracesMock).toHaveBeenNthCalledWith(1, 10, 0);
    });

    expect(screen.queryByText('trace-11')).not.toBeInTheDocument();

    const scrollContainer = screen.getByTestId('trace-list-scroll-container');
    expect(scrollContainer).toHaveClass('overflow-auto');

    await waitFor(() => {
      expect(MockIntersectionObserver.lastInstance?.options?.root).toBe(scrollContainer);
    });

    await act(async () => {
      MockIntersectionObserver.lastInstance?.trigger([
        { isIntersecting: true } as IntersectionObserverEntry,
      ]);
    });

    await waitFor(() => {
      expect(getTracesMock).toHaveBeenNthCalledWith(2, 10, 10);
    });

    await waitFor(() => {
      expect(screen.getByText('trace-11')).toBeInTheDocument();
    });
  });

  it('shows transport counters only for openai subscription traces', async () => {
    const trace = createTraceSummary('trace-openai', 1710000000000, 2);

    getTracesMock.mockResolvedValue([trace]);
    getTraceDetailsMock.mockResolvedValue({
      trace,
      spans: [],
      eventsBySpanId: {},
      openAiSubscriptionMetrics: {
        websocketTurnCount: 3,
        incrementalTurnCount: 2,
        baselineTurnCount: 1,
        httpFallbackCount: 0,
      },
    });

    render(<LLMTracingPage />);

    await waitFor(() => {
      expect(screen.getByText('OpenAI Subscription Transport')).toBeInTheDocument();
    });

    expect(screen.getByText('WebSocket turns')).toBeInTheDocument();
    expect(screen.getByText('Incremental turns')).toBeInTheDocument();
    expect(screen.getByText('Baseline turns')).toBeInTheDocument();
    expect(screen.getByText('HTTP fallback turns')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('shows only llm step spans in the trace detail UI', async () => {
    const trace = createTraceSummary('trace-filtered', 1710000000000, 2);

    getTracesMock.mockResolvedValue([trace]);
    getTraceDetailsMock.mockResolvedValue({
      trace,
      spans: [
        createSpan('span-llm', 'Step1-llm', 1710000000000, { model: 'gpt-5' }),
        createSpan('span-tool', 'Step1-tool-glob', 1710000000100, {
          toolCallId: 'call_123',
          toolName: 'glob',
          stepNumber: 1,
        }),
      ],
      eventsBySpanId: {},
      openAiSubscriptionMetrics: null,
    });

    render(<LLMTracingPage />);

    await waitFor(() => {
      expect(screen.getAllByText('Step1-llm').length).toBeGreaterThan(0);
    });

    expect(screen.queryByText('Step1-tool-glob')).not.toBeInTheDocument();
    expect(screen.queryByText('call_123')).not.toBeInTheDocument();
  });

  it('hides transport counters for non-openai traces', async () => {
    const trace = createTraceSummary('trace-other', 1710000010000);

    getTracesMock.mockResolvedValue([trace]);
    getTraceDetailsMock.mockResolvedValue({
      trace,
      spans: [],
      eventsBySpanId: {},
      openAiSubscriptionMetrics: null,
    });

    render(<LLMTracingPage />);

    await waitFor(() => {
      expect(screen.getByText('Trace Details')).toBeInTheDocument();
    });

    expect(screen.queryByText('OpenAI Subscription Transport')).not.toBeInTheDocument();
  });
});
