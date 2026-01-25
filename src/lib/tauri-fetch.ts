// src/lib/tauri-fetch.ts
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logger } from './logger';

// Network retry configuration
const MAX_NETWORK_RETRIES = 3;
const NETWORK_RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff: 1s, 2s, 4s

// Network error patterns that should trigger retry
const NETWORK_ERROR_PATTERNS = [
  'error sending request',
  'error decoding response',
  'load failed',
  'network error',
  'connection refused',
  'connection reset',
  'socket hang up',
];

const PRIVATE_IP_HEADER = 'x-talkcody-allow-private-ip';

/**
 * Check if an error is a network-related error that should trigger retry
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false;

  const message =
    typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);

  const lowerMessage = message.toLowerCase();
  return NETWORK_ERROR_PATTERNS.some((pattern) => lowerMessage.includes(pattern));
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ProxyRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  request_id?: number;
  allow_private_ip?: boolean;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface StreamResponse {
  request_id: number;
  status: number;
  headers: Record<string, string>;
}

type StreamEvent = {
  request_id?: number;
  chunk?: number[];
  status?: number;
};

/**
 * Tauri fetch function type that is compatible across different environments
 */
export type TauriFetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

/**
 * Extract common request parameters from fetch input and init
 */
function extractRequestParams(input: RequestInfo | URL, init?: RequestInit) {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method || 'GET';

  // Extract headers - start with empty object, then add defaults only if not provided
  const headers: Record<string, string> = {};

  // First, extract all headers from init (if provided)
  if (init?.headers) {
    const headerObj = new Headers(init.headers);
    headerObj.forEach((value, key) => {
      // Normalize header names to proper case for consistency
      headers[key] = value;
    });
  }

  // Add defaults only if not already set (case-insensitive check)
  const headerKeys = Object.keys(headers).map((k) => k.toLowerCase());
  if (!headerKeys.includes('accept')) {
    headers.Accept = 'application/json, text/plain, */*';
  }

  // Extract body
  let body: string | undefined;
  if (init?.body) {
    if (typeof init.body === 'string') {
      body = init.body;
    } else {
      // Convert other body types to string
      body = JSON.stringify(init.body);
    }
  }

  return { url, method, headers, body };
}

function popAllowPrivateIp(headers: Record<string, string>): boolean {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === PRIVATE_IP_HEADER) {
      const value = headers[key];
      delete headers[key];
      if (!value) {
        return false;
      }
      const normalized = value.toLowerCase();
      return normalized === 'true' || value === '1' || normalized === 'yes';
    }
  }

  return false;
}

/**
 * Check if the body is a type that cannot be serialized to string (FormData, Blob, ArrayBuffer, etc.)
 * These types require native fetch to handle properly (multipart/form-data encoding)
 */
function isUnsupportedBodyType(body: BodyInit | null | undefined): boolean {
  if (!body) return false;
  return (
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof URLSearchParams ||
    body instanceof ReadableStream
  );
}

/**
 * Simple HTTP fetch using Tauri's proxy_fetch command
 * Use this for non-streaming requests (GET, POST, etc. that return complete responses)
 *
 * This function waits for the entire response body before returning,
 * avoiding the race condition that occurs with stream_fetch for simple requests.
 *
 * Note: For FormData, Blob, ArrayBuffer, and other binary body types,
 * this function falls back to native fetch since Tauri's proxy_fetch
 * only supports string bodies.
 */
export async function simpleFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // For FormData, Blob, ArrayBuffer etc., use native fetch
  // These types cannot be serialized to string and require proper multipart encoding
  if (isUnsupportedBodyType(init?.body)) {
    logger.info('[Simple Fetch] Using native fetch for unsupported body type');
    return fetch(input, init);
  }

  const { url, method, headers, body } = extractRequestParams(input, init);
  const allowPrivateIp = popAllowPrivateIp(headers);

  const proxyRequest: ProxyRequest = {
    url,
    method,
    headers,
    body,
    allow_private_ip: allowPrivateIp,
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_NETWORK_RETRIES; attempt++) {
    try {
      const response = await invoke<ProxyResponse>('proxy_fetch', { request: proxyRequest });

      return new Response(response.body, {
        status: response.status,
        headers: new Headers(response.headers),
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if this is a retryable network error
      if (isNetworkError(error) && attempt < MAX_NETWORK_RETRIES) {
        const delay = NETWORK_RETRY_DELAYS[attempt] ?? 4000;
        logger.warn(
          `[Simple Fetch] Network error, retrying in ${delay}ms (${attempt + 1}/${MAX_NETWORK_RETRIES})`,
          { url, error: lastError.message }
        );
        await sleep(delay);
        continue;
      }

      // Non-retryable error or max retries reached
      logger.error('[Simple Fetch] Error:', error);
      throw new Error(`Simple fetch failed: ${error}`);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError ?? new Error('Simple fetch failed: unknown error');
}

/**
 * Create a streaming fetch function that uses Tauri's Rust backend with true streaming
 * This bypasses webview CORS restrictions and enables real-time streaming via Tauri events
 *
 * Use this for SSE (Server-Sent Events) or chunked transfer encoding responses,
 * such as AI chat completions that stream tokens incrementally.
 */
function createStreamFetch(): TauriFetchFunction {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const { url, method, headers, body } = extractRequestParams(input, init);
    const allowPrivateIp = popAllowPrivateIp(headers);
    const signal = init?.signal;

    let lastError: Error | undefined;

    // Retry loop for network errors
    for (let attempt = 0; attempt <= MAX_NETWORK_RETRIES; attempt++) {
      // Generate request ID on client side to avoid race conditions
      // Use a random number between 1 and 1000000 plus timestamp to ensure uniqueness
      const requestId = Math.floor(Math.random() * 1000000) + (Date.now() % 1000000);

      const proxyRequest: ProxyRequest = {
        url,
        method,
        headers,
        body,
        request_id: requestId,
        allow_private_ip: allowPrivateIp,
      };

      // Setup streaming infrastructure (fresh for each attempt)
      let unlisten: UnlistenFn | undefined;

      const ts = new TransformStream();
      const writer = ts.writable.getWriter();

      let closed = false;
      let lastChunkTime = Date.now();
      let streamTimeoutId: ReturnType<typeof setTimeout> | undefined;

      const resetStreamTimeout = () => {
        lastChunkTime = Date.now();
        if (streamTimeoutId) {
          clearTimeout(streamTimeoutId);
        }
        // Check for stream timeout every 300000 seconds
        streamTimeoutId = setTimeout(() => {
          const timeSinceLastChunk = Date.now() - lastChunkTime;
          if (!closed && timeSinceLastChunk > 300000) {
            logger.error(
              `[Tauri Stream Fetch] Stream timeout: no data received for ${timeSinceLastChunk}ms`
            );
            close();
          }
        }, 300000);
      };

      const close = () => {
        if (closed) return;
        closed = true;
        if (streamTimeoutId) {
          clearTimeout(streamTimeoutId);
        }
        unlisten?.();
        writer.ready.then(() => {
          writer
            .close()
            .catch((e) => logger.error('[Tauri Stream Fetch] Error closing writer:', e));
        });
      };

      // Handle abort signal
      if (signal) {
        signal.addEventListener('abort', () => close());
      }

      // Process a single stream event
      const processEvent = (payload: StreamEvent) => {
        const { chunk, status } = payload || {};

        if (chunk) {
          resetStreamTimeout();
          writer.ready.then(() => {
            writer.write(new Uint8Array(chunk)).catch((e) => {
              logger.error('[Tauri Stream Fetch] Error writing chunk:', e);
            });
          });
        } else if (status !== undefined) {
          // EndPayload received, close the stream
          close();
        }
      };

      try {
        // Register listener BEFORE invoking the command to avoid race conditions
        const eventName = `stream-response-${requestId}`;
        unlisten = await listen<StreamEvent>(eventName, (event) => {
          processEvent(event.payload);
        });

        // Invoke stream_fetch with the pre-generated request_id
        const response = await invoke<StreamResponse>('stream_fetch', { request: proxyRequest });
        const { status, headers: responseHeaders } = response;

        // Start the stream timeout
        resetStreamTimeout();

        // Create Response object with streaming body
        const streamingResponse = new Response(ts.readable, {
          status,
          headers: new Headers(responseHeaders),
        });

        // Auto-close on error status
        if (status >= 300) {
          setTimeout(close, 100);
        }

        return streamingResponse;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        close();

        // Check if this is a retryable network error
        if (isNetworkError(error) && attempt < MAX_NETWORK_RETRIES) {
          const delay = NETWORK_RETRY_DELAYS[attempt] ?? 4000;
          logger.warn(
            `[Tauri Stream Fetch] Network error, retrying in ${delay}ms (${attempt + 1}/${MAX_NETWORK_RETRIES})`,
            { url, error: lastError.message }
          );
          await sleep(delay);
          continue;
        }

        // Non-retryable error or max retries reached
        logger.error('[Tauri Stream Fetch] Error:', error);
        throw new Error(`Tauri stream fetch failed: ${error}`);
      }
    }

    // This should never be reached, but TypeScript needs it
    throw lastError ?? new Error('Tauri stream fetch failed: unknown error');
  };
}

export const streamFetch = createStreamFetch();
