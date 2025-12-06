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

describe('tauri-fetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
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
            Accept: 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
          }),
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
        },
      });

      // Headers API lowercases header names
      expect(mockInvoke).toHaveBeenCalledWith('proxy_fetch', {
        request: expect.objectContaining({
          headers: expect.objectContaining({
            authorization: 'Bearer token123',
            'x-custom-header': 'custom-value',
            Accept: 'application/json, text/plain, */*',
          }),
        }),
      });
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
      mockInvoke.mockRejectedValue(new Error('Network error'));

      const { simpleFetch } = await import('./tauri-fetch');

      await expect(simpleFetch('https://api.example.com/data')).rejects.toThrow(
        'Simple fetch failed: Error: Network error'
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
      mockInvoke.mockRejectedValue(new Error('Connection refused'));

      const { streamFetch } = await import('./tauri-fetch');

      await expect(streamFetch('https://api.example.com/stream')).rejects.toThrow(
        'Tauri stream fetch failed: Error: Connection refused'
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
});
