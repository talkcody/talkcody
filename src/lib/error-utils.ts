import { InvalidToolInputError, NoSuchToolError } from 'ai';
import { useProviderStore } from '@/providers/stores/provider-store';

// HTTP status codes for error handling
export const HTTP_STATUS = {
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const;

// Error handling utilities
export type DetailedErrorInfo = {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  status?: number;
  statusText?: string;
  cause?: unknown;
  causeChain?: Array<{ name: string; message: string; stack?: string }>;
  provider?: string;
  model?: string;
  toolName?: string;
  toolInput?: unknown;
  availableTools?: string[];
  requestId?: string;
  timestamp: string;
  context?: {
    iteration?: number;
    messageCount?: number;
    phase?: string;
  };
  rawError?: string; // Serialized complete error object for debugging
};

export type ErrorContext = {
  provider?: string;
  model?: string;
  iteration?: number;
  messageCount?: number;
  phase?: string;
  toolName?: string;
  toolInput?: unknown;
};

/**
 * Recursively extracts the error cause chain
 */
function extractCauseChain(
  error: unknown,
  maxDepth: number = 5
): Array<{ name: string; message: string; stack?: string }> {
  const chain: Array<{ name: string; message: string; stack?: string }> = [];
  let current = error;
  let depth = 0;

  while (current && depth < maxDepth) {
    const currentError = current as Record<string, unknown>;

    // Get the cause from the current error
    const cause = currentError?.cause as Record<string, unknown> | undefined;
    if (!cause) break;

    // Extract info from the cause
    const causeInfo = {
      name: String(cause?.name || cause?.constructor?.name || 'Unknown'),
      message: String(cause?.message || String(cause)),
      stack: cause?.stack as string | undefined,
    };

    chain.push(causeInfo);
    current = cause;
    depth++;
  }

  return chain;
}

/**
 * Safely serializes an error object for debugging
 */
function serializeError(error: unknown): string {
  try {
    const errorObj = error as Record<string, unknown>;
    const serialized: Record<string, unknown> = {};

    // Handle DOMException and other browser-specific errors
    if (error instanceof Error) {
      serialized.name = errorObj.name;
      serialized.message = errorObj.message;
      if (errorObj.stack) {
        serialized.stack = errorObj.stack;
      }

      // Special handling for DOMException
      if (errorObj.code !== undefined) {
        serialized.code = errorObj.code;
      }

      // Include enhanced fetch context if available
      if (errorObj.context) {
        serialized.context = errorObj.context;
      }
    }

    // Get all own properties (including non-enumerable ones)
    const allKeys = new Set([...Object.getOwnPropertyNames(errorObj), ...Object.keys(errorObj)]);

    for (const key of allKeys) {
      // Skip already processed properties
      if (key === 'name' || key === 'message' || key === 'stack') {
        continue;
      }

      try {
        const value = errorObj[key];
        // Skip functions and symbols
        if (typeof value === 'function' || typeof value === 'symbol') {
          continue;
        }

        // Handle circular references and complex objects
        if (value && typeof value === 'object') {
          try {
            // Try to stringify to check for circular refs
            JSON.stringify(value);
            serialized[key] = value;
          } catch {
            // If circular or too complex, use string representation
            serialized[key] = String(value);
          }
        } else {
          serialized[key] = value;
        }
      } catch {
        // Skip properties that can't be accessed
      }
    }

    // Recursively include cause if present
    if (errorObj.cause) {
      try {
        serialized.cause = JSON.parse(serializeError(errorObj.cause));
      } catch {
        serialized.cause = String(errorObj.cause);
      }
    }

    return JSON.stringify(serialized, null, 2);
  } catch {
    return String(error);
  }
}

/**
 * Extracts comprehensive error details from any error object
 */
export function extractErrorDetails(error: unknown, context?: ErrorContext): DetailedErrorInfo {
  const errorObj = error as Record<string, unknown>;
  const errorInfo: DetailedErrorInfo = {
    name: String(errorObj?.name || errorObj?.constructor?.name || 'Unknown Error'),
    message: String(errorObj?.message || String(error)),
    timestamp: new Date().toISOString(),
    context,
  };

  // Extract stack trace
  if (errorObj?.stack) {
    errorInfo.stack = String(errorObj.stack);
  }

  // Extract HTTP/API error details
  if (errorObj?.status !== undefined && errorObj?.status !== null) {
    errorInfo.status = Number(errorObj.status);
  }
  if (errorObj?.statusText) {
    errorInfo.statusText = String(errorObj.statusText);
  }
  if (errorObj?.code) {
    errorInfo.code = String(errorObj.code);
  }

  // Extract provider/model context
  if (context?.provider) {
    errorInfo.provider = context.provider;
  }
  if (context?.model) {
    errorInfo.model = context.model;
  }

  // Extract tool-specific error details
  if (NoSuchToolError.isInstance(error)) {
    errorInfo.toolName = String(errorObj.toolName);
    errorInfo.availableTools = errorObj.availableTools as string[];
  }
  if (InvalidToolInputError.isInstance(error)) {
    errorInfo.toolName = String(errorObj.toolName);
    errorInfo.toolInput = errorObj.toolInput;
  }
  if (context?.toolName) {
    errorInfo.toolName = context.toolName;
  }
  if (context?.toolInput) {
    errorInfo.toolInput = context.toolInput;
  }

  // Extract additional error properties
  if (errorObj?.cause) {
    errorInfo.cause = errorObj.cause;
    // Extract the full cause chain
    errorInfo.causeChain = extractCauseChain(error);
  }
  if (errorObj?.requestId) {
    errorInfo.requestId = String(errorObj.requestId);
  }

  // Extract response data for API errors
  const response = errorObj?.response as Record<string, unknown> | undefined;
  if (response?.data) {
    errorInfo.message = `${errorInfo.message} | Response: ${JSON.stringify(response.data)}`;
  }
  if (response?.status) {
    errorInfo.status = Number(response.status);
  }
  if (response?.statusText) {
    errorInfo.statusText = String(response.statusText);
  }

  // Serialize the complete error object for debugging
  try {
    errorInfo.rawError = serializeError(error);
  } catch {
    // If serialization fails, just skip it
  }

  return errorInfo;
}

/**
 * Formats error details for comprehensive logging
 */
export function formatErrorForLogging(errorInfo: DetailedErrorInfo): string {
  const parts = [
    `[${errorInfo.name}] ${errorInfo.message}`,
    errorInfo.provider && `Provider: ${errorInfo.provider}`,
    errorInfo.model && `Model: ${errorInfo.model}`,
    errorInfo.status && `Status: ${errorInfo.status}`,
    errorInfo.statusText && `Status Text: ${errorInfo.statusText}`,
    errorInfo.code && `Code: ${errorInfo.code}`,
    errorInfo.toolName && `Tool: ${errorInfo.toolName}`,
    errorInfo.availableTools && `Available Tools: [${errorInfo.availableTools.join(', ')}]`,
    errorInfo.context?.iteration && `Iteration: ${errorInfo.context.iteration}`,
    errorInfo.context?.phase && `Phase: ${errorInfo.context.phase}`,
    errorInfo.requestId && `Request ID: ${errorInfo.requestId}`,
  ].filter(Boolean);

  let formatted = parts.join(' | ');

  if (errorInfo.toolInput) {
    formatted += ` | Tool Input: ${JSON.stringify(errorInfo.toolInput)}`;
  }

  // Add cause chain if available
  if (errorInfo.causeChain && errorInfo.causeChain.length > 0) {
    formatted += '\n\nCause Chain:';
    errorInfo.causeChain.forEach((cause, index) => {
      formatted += `\n  ${index + 1}. [${cause.name}] ${cause.message}`;
      if (cause.stack) {
        // Show first 3 lines of stack trace for each cause
        const stackLines = cause.stack.split('\n').slice(0, 3);
        formatted += `\n     ${stackLines.join('\n     ')}`;
      }
    });
  } else if (errorInfo.cause) {
    // Fallback for simple cause
    formatted += ` | Cause: ${JSON.stringify(errorInfo.cause)}`;
  }

  // Add diagnostic hints for common errors
  if (errorInfo.name === 'TypeError' && errorInfo.message === 'Load failed') {
    formatted +=
      '\n\nDiagnostic Hint: "Load failed" typically indicates a network error. Possible causes:';
    formatted += '\n  - Network timeout (request took too long)';
    formatted += '\n  - DNS resolution failure';
    formatted += '\n  - SSL/TLS certificate error';
    formatted += '\n  - CORS policy blocking the request';
    formatted += '\n  - API endpoint is unreachable';
    formatted += '\n  Check the Cause Chain above for more details.';
  }

  if (errorInfo.stack) {
    formatted += `\n\nStack Trace:\n${errorInfo.stack}`;
  }

  // Add raw error for debugging if available
  if (errorInfo.rawError) {
    formatted += `\n\nRaw Error Object:\n${errorInfo.rawError}`;
  }

  return formatted;
}

/**
 * Gets provider-specific error information
 */
export function getProviderErrorContext(model: string): {
  provider?: string;
  model?: string;
} {
  try {
    const providerModel = useProviderStore.getState().getProviderModel(model);
    return {
      provider: providerModel?.provider || 'unknown',
      model,
    };
  } catch {
    return { model };
  }
}

/**
 * Creates an error context object with common information
 */
export function createErrorContext(
  model: string,
  options?: {
    iteration?: number;
    messageCount?: number;
    phase?: string;
    toolName?: string;
    toolInput?: unknown;
  }
): ErrorContext {
  const providerContext = getProviderErrorContext(model);
  return {
    ...providerContext,
    ...options,
  };
}

/**
 * Handles HTTP status code specific error logic
 */
export function createHttpStatusError(
  errorDetails: DetailedErrorInfo,
  _formattedError: string
): Error | null {
  switch (errorDetails.status) {
    case HTTP_STATUS.UNAUTHORIZED:
      return new Error(
        `Authentication failed for ${errorDetails.provider || 'provider'}: ${errorDetails.message}. Please check your API key configuration.`
      );
    case HTTP_STATUS.TOO_MANY_REQUESTS:
      return new Error(
        `Rate limit exceeded for ${errorDetails.provider || 'provider'}: ${errorDetails.message}. Please wait before retrying.`
      );
    case HTTP_STATUS.PAYMENT_REQUIRED:
      return new Error(
        `Quota exceeded or payment required for ${errorDetails.provider || 'provider'}: ${errorDetails.message}. Please check your account billing.`
      );
    default:
      if (errorDetails.status && errorDetails.status >= HTTP_STATUS.INTERNAL_SERVER_ERROR) {
        return new Error(
          `Server error from ${errorDetails.provider || 'provider'} (${errorDetails.status}): ${errorDetails.message}. This may be a temporary issue.`
        );
      }
      return null;
  }
}

/**
 * Utility function to extract and format error in one call
 */
export function extractAndFormatError(
  error: unknown,
  context?: ErrorContext
): {
  errorDetails: DetailedErrorInfo;
  formattedError: string;
} {
  const errorDetails = extractErrorDetails(error, context);
  const formattedError = formatErrorForLogging(errorDetails);
  return { errorDetails, formattedError };
}

export function isContextLengthExceededError(error: unknown): boolean {
  const matchesContextOverflow = (candidate: unknown): boolean => {
    if (!candidate || typeof candidate !== 'object') return false;
    const record = candidate as Record<string, unknown>;
    return (
      record.type === 'invalid_request_error' &&
      record.code === 'context_length_exceeded' &&
      typeof record.message === 'string'
    );
  };

  const candidates = [
    error,
    (error as { error?: unknown })?.error,
    (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error,
    (error as { response?: { error?: unknown } })?.response?.error,
    (error as { data?: { error?: unknown } })?.data?.error,
    (error as { cause?: unknown })?.cause,
  ];

  for (const candidate of candidates) {
    if (matchesContextOverflow(candidate)) {
      return true;
    }
  }

  if (error instanceof Error && error.message.includes('context_length_exceeded')) {
    return true;
  }

  if (typeof error === 'string' && error.includes('context_length_exceeded')) {
    return true;
  }

  try {
    const serialized = JSON.stringify(error);
    if (serialized?.includes('context_length_exceeded')) {
      return true;
    }
  } catch {
    // Ignore serialization errors.
  }

  return false;
}
