// src/lib/tauri-fetch.ts
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logger } from './logger';

export interface ProxyRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  request_id?: number;
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

  // Extract headers with defaults
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': navigator.userAgent,
  };

  if (init?.headers) {
    const headerObj = new Headers(init.headers);
    headerObj.forEach((value, key) => {
      headers[key] = value;
    });
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

  const proxyRequest: ProxyRequest = {
    url,
    method,
    headers,
    body,
  };

  try {
    const response = await invoke<ProxyResponse>('proxy_fetch', { request: proxyRequest });

    return new Response(response.body, {
      status: response.status,
      headers: new Headers(response.headers),
    });
  } catch (error) {
    logger.error('[Simple Fetch] Error:', error);
    throw new Error(`Simple fetch failed: ${error}`);
  }
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
    const signal = init?.signal;

    // Generate request ID on client side to avoid race conditions
    // Use a random number between 1 and 1000000 plus timestamp to ensure uniqueness
    const requestId = Math.floor(Math.random() * 1000000) + (Date.now() % 1000000);

    const proxyRequest: ProxyRequest = {
      url,
      method,
      headers,
      body,
      request_id: requestId,
    };

    // Setup streaming infrastructure
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
      // Check for stream timeout every 60 seconds
      streamTimeoutId = setTimeout(() => {
        const timeSinceLastChunk = Date.now() - lastChunkTime;
        if (!closed && timeSinceLastChunk > 60000) {
          logger.error(
            `[Tauri Stream Fetch] Stream timeout: no data received for ${timeSinceLastChunk}ms`
          );
          close();
        }
      }, 60000);
    };

    const close = () => {
      if (closed) return;
      closed = true;
      if (streamTimeoutId) {
        clearTimeout(streamTimeoutId);
      }
      unlisten?.();
      writer.ready.then(() => {
        writer.close().catch((e) => logger.error('[Tauri Stream Fetch] Error closing writer:', e));
      });
    };

    // Handle abort signal
    if (signal) {
      signal.addEventListener('abort', () => close());
    }

    // Process a single stream event
    let chunkCount = 0;
    const processEvent = (payload: StreamEvent) => {
      const { chunk, status } = payload || {};

      if (chunk) {
        chunkCount++;
        resetStreamTimeout();
        writer.ready.then(() => {
          writer.write(new Uint8Array(chunk)).catch((e) => {
            logger.error('[Tauri Stream Fetch] Error writing chunk:', e);
          });
        });
      } else if (status === 0) {
        // End of stream
        logger.info(`[Tauri Stream Fetch] Stream ended (total chunks: ${chunkCount})`);
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
      logger.error('[Tauri Stream Fetch] Error:', error);
      close();
      throw new Error(`Tauri stream fetch failed: ${error}`);
    }
  };
}

/**
 * Singleton instance of streamFetch for convenient imports
 * Use this for streaming responses (AI chat completions, SSE)
 */
export const streamFetch = createStreamFetch();
