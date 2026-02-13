import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

// Mock Tauri APIs
const mockInvoke = vi.fn();
const mockListen = vi.fn();
const mockUnlisten = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

// Mock logger
vi.mock('./logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks are set up
import type { ProxyResponse } from './tauri-fetch';
import { logger } from './logger';

const mockLogger = logger as { warn: Mock; error: Mock; info: Mock };

describe('tauri-fetch', () => {
  beforeEach(() => {
    // Ensure real timers (fake timers from previous tests may interfere)
    vi.useRealTimers();
    vi.clearAllMocks();
    // Reset mock implementations
    mockInvoke.mockReset();
    mockListen.mockImplementation(() => Promise.resolve(mockUnlisten));
  });

  describe('simpleFetch (simple HTTP requests)', () => {
    it('should make a GET request and return response', async () => {
      const mockResponse: ProxyResponse = {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"data": "test"}',
      };

      mockInvoke.mockResolvedValue(mockResponse);

      // Re-import to get fresh module
      const { simpleFetch } = await import('./tauri-fetch');

      const response = await simpleFetch('https://api.example.com/data');

      expect(mockInvoke).toHaveBeenCalledWith('proxy_fetch', {
        request: expect.objectContaining({
          url: 'https://api.example.com/data',
          method: 'GET',
          allow_private_ip: false,
        }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toEqual({ data: 'test' });
    });

    it('should make a POST request with body', async () => {
      const mockResponse: ProxyResponse = {
        status: 201,
        headers: { 'content-type': 'application/json' },
        body: '{"id": 123}',
      };

      mockInvoke.mockResolvedValue(mockResponse);

      const { simpleFetch } = await import('./tauri-fetch');

      const response = await simpleFetch('https://api.example.com/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      });

      expect(mockInvoke).toHaveBeenCalledWith('proxy_fetch', {
        request: expect.objectContaining({
          url: 'https://api.example.com/data',
          method: 'POST',
          body: '{"name":"test"}',
          allow_private_ip: false,
        }),
      });

      expect(response.status).toBe(201);
    });

    it('should handle PUT request', async () => {
      const mockResponse: ProxyResponse = {
        status: 200,
        headers: {},
        body: '{"updated": true}',
      };

      mockInvoke.mockResolvedValue(mockResponse);

      const { simpleFetch } = await import('./tauri-fetch');

      await simpleFetch('https://api.example.com/data/1', {
        method: 'PUT',
        body: JSON.stringify({ name: 'updated' }),
      });

      expect(mockInvoke).toHaveBeenCalledWith('proxy_fetch', {
        request: expect.objectContaining({
          method: 'PUT',
        }),
      });
    });

    it('should handle DELETE request', async () => {
      const mockResponse: ProxyResponse = {
        status: 200,
        headers: {},
        body: '{"deleted": true}',
      };

      mockInvoke.mockResolvedValue(mockResponse);

      const { simpleFetch } = await import('./tauri-fetch');

      const response = await simpleFetch('https://api.example.com/data/1', {
        method: 'DELETE',
      });

      expect(response.status).toBe(200);
      expect(mockInvoke).toHaveBeenCalledWith('proxy_fetch', {
        request: expect.objectContaining({
          method: 'DELETE',
        }),
      });
    });

    it('should include default headers', async () => {
      const mockResponse: ProxyResponse = {
        status: 200,
        headers: {},
        body: '',
      };

      mockInvoke.mockResolvedValue(mockResponse);

      const { simpleFetch } = await import('./tauri-fetch');

      await simpleFetch('https://api.example.com/data');

      expect(mockInvoke).toHaveBeenCalledWith('proxy_fetch', {
        request: expect.objectContaining({
          headers: expect.objectContaining({
            accept: 'application/json, text/plain, */*',
          }),
          allow_private_ip: false,
        }),
      });
    });

    it('should merge custom headers with defaults', async () => {
      const mockResponse: ProxyResponse = {
        status: 200,
        headers: {},
        body: '',
      };

      mockInvoke.mockResolvedValue(mockResponse);

      const { simpleFetch } = await import('./tauri-fetch');

      await simpleFetch('https://api.example.com/data', {
        headers: {
          Authorization: 'Bearer token123',
          'X-Custom-Header': 'custom-value',
          'X-TalkCody-Allow-Private-IP': 'true',
        },
      });

      // Headers API lowercases header names
      expect(mockInvoke).toHaveBeenCalledWith('proxy_fetch', {
        request: expect.objectContaining({
          headers: expect.objectContaining({
            authorization: 'Bearer token123',
            'x-custom-header': 'custom-value',
            accept: 'application/json, text/plain, */*',
          }),
          allow_private_ip: true,
        }),
      });
    });

    it('should treat empty allow-private-ip header as false', async () => {
      const mockResponse: ProxyResponse = {
        status: 200,
        headers: {},
        body: '',
      };

      mockInvoke.mockResolvedValue(mockResponse);

      const { simpleFetch } = await import('./tauri-fetch');

      await simpleFetch('https://api.example.com/data', {
        headers: {
          'X-TalkCody-Allow-Private-IP': '',
        },
      });

      const request = mockInvoke.mock.calls[0]?.[1]?.request as {
        allow_private_ip: boolean;
        headers: Record<string, string>;
      };

      expect(request.allow_private_ip).toBe(false);
      expect(request.headers).not.toHaveProperty('x-talkcody-allow-private-ip');
    });

    it('should handle error responses (4xx)', async () => {
      const mockResponse: ProxyResponse = {
        status: 404,
        headers: {},
        body: '{"error": "Not found"}',
      };

      mockInvoke.mockResolvedValue(mockResponse);

      const { simpleFetch } = await import('./tauri-fetch');

      const response = await simpleFetch('https://api.example.com/missing');

      expect(response.status).toBe(404);
      expect(response.ok).toBe(false);
    });

    it('should handle error responses (5xx)', async () => {
      const mockResponse: ProxyResponse = {
        status: 500,
        headers: {},
        body: '{"error": "Internal server error"}',
      };

      mockInvoke.mockResolvedValue(mockResponse);

      const { simpleFetch } = await import('./tauri-fetch');

      const response = await simpleFetch('https://api.example.com/error');

      expect(response.status).toBe(500);
      expect(response.ok).toBe(false);
    });

    it('should throw error when invoke fails', async () => {
      // Use non-network error to avoid retry logic
      mockInvoke.mockRejectedValue(new Error('Invalid API key'));

      const { simpleFetch } = await import('./tauri-fetch');

      await expect(simpleFetch('https://api.example.com/data')).rejects.toThrow(
        'Simple fetch failed: Error: Invalid API key'
      );
    });

    it('should handle URL object input', async () => {
      const mockResponse: ProxyResponse = {
        status: 200,
        headers: {},
        body: '{}',
      };

      mockInvoke.mockResolvedValue(mockResponse);

      const { simpleFetch } = await import('./tauri-fetch');

      await simpleFetch(new URL('https://api.example.com/data'));

      expect(mockInvoke).toHaveBeenCalledWith('proxy_fetch', {
        request: expect.objectContaining({
          url: 'https://api.example.com/data',
          allow_private_ip: false,
        }),
      });
    });

    it('should handle response headers', async () => {
      const mockResponse: ProxyResponse = {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'abc123',
        },
        body: '{}',
      };

      mockInvoke.mockResolvedValue(mockResponse);

      const { simpleFetch } = await import('./tauri-fetch');

      const response = await simpleFetch('https://api.example.com/data');

      expect(response.headers.get('content-type')).toBe('application/json');
      expect(response.headers.get('x-request-id')).toBe('abc123');
    });

    it('should fall back to native fetch for FormData body', async () => {
      // Mock native fetch
      const mockNativeFetch = vi.fn().mockResolvedValue(
        new Response('{"success": true}', { status: 200 })
      );
      global.fetch = mockNativeFetch;

      const { simpleFetch } = await import('./tauri-fetch');

      const formData = new FormData();
      formData.append('file', new Blob(['test content']), 'test.txt');
      formData.append('model', 'whisper-1');

      const response = await simpleFetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-key',
        },
        body: formData,
      });

      // Should use native fetch, not Tauri invoke
      expect(mockNativeFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/audio/transcriptions',
        expect.objectContaining({
          method: 'POST',
          body: formData,
        })
      );
      expect(mockInvoke).not.toHaveBeenCalled();
      expect(response.status).toBe(200);
    });

    it('should fall back to native fetch for Blob body', async () => {
      const mockNativeFetch = vi.fn().mockResolvedValue(
        new Response('{}', { status: 200 })
      );
      global.fetch = mockNativeFetch;

      const { simpleFetch } = await import('./tauri-fetch');

      const blob = new Blob(['binary data'], { type: 'application/octet-stream' });

      await simpleFetch('https://api.example.com/upload', {
        method: 'POST',
        body: blob,
      });

      expect(mockNativeFetch).toHaveBeenCalled();
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('should fall back to native fetch for ArrayBuffer body', async () => {
      const mockNativeFetch = vi.fn().mockResolvedValue(
        new Response('{}', { status: 200 })
      );
      global.fetch = mockNativeFetch;

      const { simpleFetch } = await import('./tauri-fetch');

      const buffer = new ArrayBuffer(8);

      await simpleFetch('https://api.example.com/upload', {
        method: 'POST',
        body: buffer,
      });

      expect(mockNativeFetch).toHaveBeenCalled();
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('should fall back to native fetch for Uint8Array body', async () => {
      const mockNativeFetch = vi.fn().mockResolvedValue(
        new Response('{}', { status: 200 })
      );
      global.fetch = mockNativeFetch;

      const { simpleFetch } = await import('./tauri-fetch');

      const uint8Array = new Uint8Array([1, 2, 3, 4]);

      await simpleFetch('https://api.example.com/upload', {
        method: 'POST',
        body: uint8Array,
      });

      expect(mockNativeFetch).toHaveBeenCalled();
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('should fall back to native fetch for URLSearchParams body', async () => {
      const mockNativeFetch = vi.fn().mockResolvedValue(
        new Response('{}', { status: 200 })
      );
      global.fetch = mockNativeFetch;

      const { simpleFetch } = await import('./tauri-fetch');

      const params = new URLSearchParams();
      params.append('key', 'value');

      await simpleFetch('https://api.example.com/data', {
        method: 'POST',
        body: params,
      });

      expect(mockNativeFetch).toHaveBeenCalled();
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('should use Tauri invoke for string body (not fall back to native fetch)', async () => {
      const mockResponse: ProxyResponse = {
        status: 200,
        headers: {},
        body: '{"success": true}',
      };

      mockInvoke.mockResolvedValue(mockResponse);

      const mockNativeFetch = vi.fn();
      global.fetch = mockNativeFetch;

      const { simpleFetch } = await import('./tauri-fetch');

      await simpleFetch('https://api.example.com/data', {
        method: 'POST',
        body: JSON.stringify({ key: 'value' }),
      });

      // Should use Tauri invoke, not native fetch
      expect(mockInvoke).toHaveBeenCalled();
      expect(mockNativeFetch).not.toHaveBeenCalled();
    });

    it('should use Tauri invoke for requests without body', async () => {
      const mockResponse: ProxyResponse = {
        status: 200,
        headers: {},
        body: '{}',
      };

      mockInvoke.mockResolvedValue(mockResponse);

      const mockNativeFetch = vi.fn();
      global.fetch = mockNativeFetch;

      const { simpleFetch } = await import('./tauri-fetch');

      await simpleFetch('https://api.example.com/data');

      expect(mockInvoke).toHaveBeenCalled();
      expect(mockNativeFetch).not.toHaveBeenCalled();
    });
  });

  describe('streamFetch (streaming responses)', () => {
    it('should be a function', async () => {
      const { streamFetch } = await import('./tauri-fetch');

      expect(typeof streamFetch).toBe('function');
    });

    it('should invoke stream_fetch and set up event listener', async () => {
      // Mock random and date to ensure predictable request_id
      // requestId = Math.floor(Math.random() * 1000000) + (Date.now() % 1000000)
      // We want requestId = 42
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(42);

      const streamResponse = {
        request_id: 42,
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      };

      mockInvoke.mockResolvedValue(streamResponse);
      mockListen.mockImplementation(() => Promise.resolve(mockUnlisten));

      const { streamFetch } = await import('./tauri-fetch');

      const responsePromise = streamFetch('https://api.example.com/stream', {
        method: 'POST',
        body: JSON.stringify({ stream: true }),
      });

      const response = await responsePromise;

      expect(mockInvoke).toHaveBeenCalledWith('stream_fetch', {
        request: expect.objectContaining({
          url: 'https://api.example.com/stream',
          method: 'POST',
          allow_private_ip: false,
        }),
      });

      expect(mockListen).toHaveBeenCalledWith('stream-response-42', expect.any(Function));
      expect(response.status).toBe(200);

      randomSpy.mockRestore();
      dateSpy.mockRestore();
    });

    it('should return response with streaming body', async () => {
      const streamResponse = {
        request_id: 1,
        status: 200,
        headers: {},
      };

      mockInvoke.mockResolvedValue(streamResponse);

      const { streamFetch } = await import('./tauri-fetch');

      const response = await streamFetch('https://api.example.com/stream');

      expect(response.body).toBeDefined();
      expect(response.body).toBeInstanceOf(ReadableStream);
    });

    it('should handle error status codes', async () => {
      const streamResponse = {
        request_id: 1,
        status: 401,
        headers: {},
      };

      mockInvoke.mockResolvedValue(streamResponse);

      const { streamFetch } = await import('./tauri-fetch');

      const response = await streamFetch('https://api.example.com/unauthorized');

      expect(response.status).toBe(401);
      expect(response.ok).toBe(false);
    });

    it('should throw error when stream_fetch fails', async () => {
      // Use non-network error to avoid retry logic
      mockInvoke.mockRejectedValue(new Error('Invalid credentials'));

      const { streamFetch } = await import('./tauri-fetch');

      await expect(streamFetch('https://api.example.com/stream')).rejects.toThrow(
        'Tauri stream fetch failed: Error: Invalid credentials'
      );
    });

    it('should export streamFetch', async () => {
      const { streamFetch } = await import('./tauri-fetch');

      expect(typeof streamFetch).toBe('function');
    });
  });

  describe('extractRequestParams', () => {
    it('should handle Request object input', async () => {
      const mockResponse: ProxyResponse = {
        status: 200,
        headers: {},
        body: '{}',
      };

      mockInvoke.mockResolvedValue(mockResponse);

      const { simpleFetch } = await import('./tauri-fetch');

      // Create a Request object with a URL
      const request = new Request('https://api.example.com/data', {
        method: 'POST',
      });

      await simpleFetch(request);

      expect(mockInvoke).toHaveBeenCalledWith('proxy_fetch', {
        request: expect.objectContaining({
          url: 'https://api.example.com/data',
          allow_private_ip: false,
        }),
      });
    });

    it('should default to GET method', async () => {
      const mockResponse: ProxyResponse = {
        status: 200,
        headers: {},
        body: '{}',
      };

      mockInvoke.mockResolvedValue(mockResponse);

      const { simpleFetch } = await import('./tauri-fetch');

      await simpleFetch('https://api.example.com/data');

      expect(mockInvoke).toHaveBeenCalledWith('proxy_fetch', {
        request: expect.objectContaining({
          method: 'GET',
          allow_private_ip: false,
        }),
      });
    });

    it('should handle non-string body by JSON stringifying', async () => {
      const mockResponse: ProxyResponse = {
        status: 200,
        headers: {},
        body: '{}',
      };

      mockInvoke.mockResolvedValue(mockResponse);

      const { simpleFetch } = await import('./tauri-fetch');

      const bodyObject = { key: 'value', nested: { a: 1 } };

      await simpleFetch('https://api.example.com/data', {
        method: 'POST',
        // @ts-expect-error - Testing non-string body handling
        body: bodyObject,
      });

      expect(mockInvoke).toHaveBeenCalledWith('proxy_fetch', {
        request: expect.objectContaining({
          body: JSON.stringify(bodyObject),
          allow_private_ip: false,
        }),
      });
    });
  });

  describe('type exports', () => {
    it('should export ProxyRequest type', async () => {
      const { simpleFetch } = await import('./tauri-fetch');
      // If the import works and simpleFetch exists, types are properly exported
      expect(simpleFetch).toBeDefined();
    });

    it('should export ProxyResponse type', async () => {
      const { simpleFetch } = await import('./tauri-fetch');
      expect(simpleFetch).toBeDefined();
    });

    it('should export TauriFetchFunction type', async () => {
      const { streamFetch } = await import('./tauri-fetch');
      // TauriFetchFunction should accept RequestInfo | URL and optional RequestInit
      expect(typeof streamFetch).toBe('function');
    });
  });

  describe('isNetworkError', () => {
    it('should return true for "error sending request" message', async () => {
      const { isNetworkError } = await import('./tauri-fetch');

      expect(isNetworkError(new Error('error sending request for url'))).toBe(true);
      expect(isNetworkError({ message: 'Error sending request to server' })).toBe(true);
    });

    it('should return true for "error decoding response" message', async () => {
      const { isNetworkError } = await import('./tauri-fetch');

      expect(isNetworkError(new Error('error decoding response body'))).toBe(true);
    });

    it('should return true for "Load failed" message', async () => {
      const { isNetworkError } = await import('./tauri-fetch');

      expect(isNetworkError(new Error('Load failed'))).toBe(true);
      expect(isNetworkError({ message: 'load failed' })).toBe(true);
    });

    it('should return true for "network error" message', async () => {
      const { isNetworkError } = await import('./tauri-fetch');

      expect(isNetworkError(new Error('Network error occurred'))).toBe(true);
    });

    it('should return true for "connection refused" message', async () => {
      const { isNetworkError } = await import('./tauri-fetch');

      expect(isNetworkError(new Error('Connection refused'))).toBe(true);
    });

    it('should return true for "connection reset" message', async () => {
      const { isNetworkError } = await import('./tauri-fetch');

      expect(isNetworkError(new Error('Connection reset by peer'))).toBe(true);
    });

    it('should return true for "socket hang up" message', async () => {
      const { isNetworkError } = await import('./tauri-fetch');

      expect(isNetworkError(new Error('socket hang up'))).toBe(true);
    });

    it('should return false for non-network errors', async () => {
      const { isNetworkError } = await import('./tauri-fetch');

      expect(isNetworkError(new Error('Invalid JSON'))).toBe(false);
      expect(isNetworkError(new Error('Permission denied'))).toBe(false);
      expect(isNetworkError(new Error('File not found'))).toBe(false);
    });

    it('should return false for null/undefined', async () => {
      const { isNetworkError } = await import('./tauri-fetch');

      expect(isNetworkError(null)).toBe(false);
      expect(isNetworkError(undefined)).toBe(false);
    });

    it('should handle string errors', async () => {
      const { isNetworkError } = await import('./tauri-fetch');

      expect(isNetworkError('error sending request')).toBe(true);
      expect(isNetworkError('some other error')).toBe(false);
    });
  });

  describe('simpleFetch network retry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should retry on network error and succeed', async () => {
      const mockResponse: ProxyResponse = {
        status: 200,
        headers: {},
        body: '{"success": true}',
      };

      // First call fails with network error, second call succeeds
      mockInvoke
        .mockRejectedValueOnce(new Error('error sending request for url'))
        .mockResolvedValueOnce(mockResponse);

      const { simpleFetch } = await import('./tauri-fetch');

      const fetchPromise = simpleFetch('https://api.example.com/data');

      // Advance timer for the first retry delay
      await vi.advanceTimersByTimeAsync(1000);

      const response = await fetchPromise;

      expect(response.status).toBe(200);
      expect(mockInvoke).toHaveBeenCalledTimes(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Network error, retrying in 1000ms'),
        expect.any(Object)
      );
    });

    it('should retry multiple times before succeeding', async () => {
      const mockResponse: ProxyResponse = {
        status: 200,
        headers: {},
        body: '{"success": true}',
      };

      // First two calls fail, third succeeds
      mockInvoke
        .mockRejectedValueOnce(new Error('error sending request'))
        .mockRejectedValueOnce(new Error('connection refused'))
        .mockResolvedValueOnce(mockResponse);

      const { simpleFetch } = await import('./tauri-fetch');

      const fetchPromise = simpleFetch('https://api.example.com/data');

      // Advance timers for retries
      await vi.advanceTimersByTimeAsync(1000); // First retry
      await vi.advanceTimersByTimeAsync(2000); // Second retry

      const response = await fetchPromise;

      expect(response.status).toBe(200);
      expect(mockInvoke).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retries exceeded', async () => {
      // All calls fail with network error
      mockInvoke.mockRejectedValue(new Error('error sending request for url'));

      const { simpleFetch } = await import('./tauri-fetch');

      const fetchPromise = simpleFetch('https://api.example.com/data');

      // Attach error handler to prevent unhandled rejection
      let caughtError: Error | undefined;
      fetchPromise.catch((e) => {
        caughtError = e;
      });

      // Advance timers for all retries
      await vi.advanceTimersByTimeAsync(1000); // First retry
      await vi.advanceTimersByTimeAsync(2000); // Second retry
      await vi.advanceTimersByTimeAsync(4000); // Third retry

      // Wait for the promise to settle
      await vi.runAllTimersAsync();

      expect(caughtError).toBeDefined();
      expect(caughtError?.message).toContain('Simple fetch failed');

      // Initial attempt + 3 retries = 4 calls
      expect(mockInvoke).toHaveBeenCalledTimes(4);
    });

    it('should not retry for non-network errors', async () => {
      mockInvoke.mockRejectedValue(new Error('Invalid API key'));

      const { simpleFetch } = await import('./tauri-fetch');

      await expect(simpleFetch('https://api.example.com/data')).rejects.toThrow(
        'Simple fetch failed'
      );

      // Should only try once, no retries
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it('should use exponential backoff delays', async () => {
      const mockResponse: ProxyResponse = {
        status: 200,
        headers: {},
        body: '{}',
      };

      // All calls fail until the last one
      mockInvoke
        .mockRejectedValueOnce(new Error('error sending request'))
        .mockRejectedValueOnce(new Error('error sending request'))
        .mockRejectedValueOnce(new Error('error sending request'))
        .mockResolvedValueOnce(mockResponse);

      const { simpleFetch } = await import('./tauri-fetch');

      const fetchPromise = simpleFetch('https://api.example.com/data');

      // First retry after 1000ms
      await vi.advanceTimersByTimeAsync(1000);
      // Second retry after 2000ms
      await vi.advanceTimersByTimeAsync(2000);
      // Third retry after 4000ms
      await vi.advanceTimersByTimeAsync(4000);

      await fetchPromise;

      expect(mockLogger.warn).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('retrying in 1000ms'),
        expect.any(Object)
      );
      expect(mockLogger.warn).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('retrying in 2000ms'),
        expect.any(Object)
      );
      expect(mockLogger.warn).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('retrying in 4000ms'),
        expect.any(Object)
      );
    });
  });

  describe('streamFetch network retry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should retry on network error and succeed', async () => {
      const streamResponse = {
        request_id: 1,
        status: 200,
        headers: {},
      };

      // First call fails with network error, second call succeeds
      mockInvoke
        .mockRejectedValueOnce(new Error('error sending request for url'))
        .mockResolvedValueOnce(streamResponse);

      const { streamFetch } = await import('./tauri-fetch');

      const fetchPromise = streamFetch('https://api.example.com/stream');

      // Advance timer for the first retry delay
      await vi.advanceTimersByTimeAsync(1000);

      const response = await fetchPromise;

      expect(response.status).toBe(200);
      expect(mockInvoke).toHaveBeenCalledTimes(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Network error, retrying in 1000ms'),
        expect.any(Object)
      );
    });

    it('should throw after max retries exceeded', async () => {
      // All calls fail with network error
      mockInvoke.mockRejectedValue(new Error('error decoding response body'));

      const { streamFetch } = await import('./tauri-fetch');

      const fetchPromise = streamFetch('https://api.example.com/stream');

      // Attach error handler to prevent unhandled rejection
      let caughtError: Error | undefined;
      fetchPromise.catch((e) => {
        caughtError = e;
      });

      // Advance timers for all retries
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(4000);

      // Wait for the promise to settle
      await vi.runAllTimersAsync();

      expect(caughtError).toBeDefined();
      expect(caughtError?.message).toContain('Tauri stream fetch failed');

      // Initial attempt + 3 retries = 4 calls
      expect(mockInvoke).toHaveBeenCalledTimes(4);
    });

    it('should not retry for non-network errors', async () => {
      mockInvoke.mockRejectedValue(new Error('Unauthorized'));

      const { streamFetch } = await import('./tauri-fetch');

      await expect(streamFetch('https://api.example.com/stream')).rejects.toThrow(
        'Tauri stream fetch failed'
      );

      // Should only try once, no retries
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it('should generate new request_id for each retry attempt', async () => {
      const streamResponse = {
        request_id: 999,
        status: 200,
        headers: {},
      };

      // First call fails, second succeeds
      mockInvoke
        .mockRejectedValueOnce(new Error('connection refused'))
        .mockResolvedValueOnce(streamResponse);

      const { streamFetch } = await import('./tauri-fetch');

      const fetchPromise = streamFetch('https://api.example.com/stream');

      // Advance timer for the first retry delay
      await vi.advanceTimersByTimeAsync(1000);

      await fetchPromise;

      // Each call should have a different request_id
      const firstCallRequestId = (mockInvoke.mock.calls[0] as unknown[])[1];
      const secondCallRequestId = (mockInvoke.mock.calls[1] as unknown[])[1];

      expect(firstCallRequestId).not.toEqual(secondCallRequestId);
    });

    it('should set up new event listener for each retry attempt', async () => {
      const streamResponse = {
        request_id: 1,
        status: 200,
        headers: {},
      };

      // First call fails, second succeeds
      mockInvoke
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce(streamResponse);

      const { streamFetch } = await import('./tauri-fetch');

      const fetchPromise = streamFetch('https://api.example.com/stream');

      // Advance timer for the first retry delay
      await vi.advanceTimersByTimeAsync(1000);

      await fetchPromise;

      // Listen should be called twice (once for each attempt)
      expect(mockListen).toHaveBeenCalledTimes(2);
    });

    it('should cleanup resources on failed attempt before retry', async () => {
      const streamResponse = {
        request_id: 1,
        status: 200,
        headers: {},
      };

      mockInvoke
        .mockRejectedValueOnce(new Error('connection reset'))
        .mockResolvedValueOnce(streamResponse);

      const { streamFetch } = await import('./tauri-fetch');

      const fetchPromise = streamFetch('https://api.example.com/stream');

      // Advance timer for the first retry delay
      await vi.advanceTimersByTimeAsync(1000);

      await fetchPromise;

      // Unlisten should be called when cleaning up the failed attempt
      expect(mockUnlisten).toHaveBeenCalled();
    });
  });
});
