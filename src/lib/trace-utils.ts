/**
 * Trace ID utilities for frontend observability
 * Format: "YYYYMMDDhhmmssfff-uuid" (same as Rust backend)
 * Example: "20260131143025012-a1b2c3d4"
 */
import { generateId } from './utils';

/**
 * Generates a span ID (16 hex characters)
 */
export function generateSpanId(): string {
  return generateId().slice(0, 16);
}

/**
 * Interface for trace context to be passed through the request chain
 * Uses camelCase to match Rust serde expectations
 */
export interface TraceContext {
  /** Unique trace ID for the entire request chain */
  traceId: string;
  /** Human-readable name for this span */
  spanName: string;
  /** Parent span ID for nested spans (null if root) */
  parentSpanId: string | null;
  /** Optional metadata for backend tracing */
  metadata?: Record<string, string>;
}

/**
 * Creates a trace context for LLM operations
 * @param traceId The trace ID (should be taskId for agent loop traces)
 * @param model The model identifier (used in span name)
 * @param stepNumber The agent loop step number (1-based)
 * @param parentSpanId Optional parent span ID for nested spans
 * @returns TraceContext object
 */
export function createLlmTraceContext(
  traceId: string,
  model: string,
  stepNumber?: number,
  parentSpanId?: string | null,
  metadata?: Record<string, string>
): TraceContext {
  const stepLabel = typeof stepNumber === 'number' && stepNumber > 0 ? stepNumber : null;
  const spanName = stepLabel ? `Step${stepLabel}-llm` : `chat ${model}`;
  const context = {
    traceId: traceId,
    spanName,
    parentSpanId: parentSpanId ?? null,
    metadata,
  };
  return context;
}
