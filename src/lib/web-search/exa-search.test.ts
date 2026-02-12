import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExaSearch, isExaMCPAvailable } from './exa-search';

// Mock simpleFetch from tauri-fetch
const mockSimpleFetch = vi.fn();
vi.mock('@/lib/tauri-fetch', () => ({
  simpleFetch: (...args: unknown[]) => mockSimpleFetch(...args),
}));

describe('ExaSearch', () => {
  let exaSearch: ExaSearch;

  beforeEach(() => {
    exaSearch = new ExaSearch();
    mockSimpleFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('search', () => {
    it('should parse SSE response with plain text results', async () => {
      const plainTextResult = `Title: Test Article 1
Author: John Doe
Published Date: 2024-01-01
URL: https://example.com/article1
Text: This is the content of article 1.

Title: Test Article 2
Author: Jane Doe
Published Date: 2024-01-02
URL: https://example.com/article2
Text: This is the content of article 2.`;

      const sseResponse = `data: ${JSON.stringify({
        jsonrpc: '2.0',
        result: {
          content: [{ type: 'text', text: plainTextResult }],
        },
      })}`;

      mockSimpleFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => sseResponse,
      });

      const results = await exaSearch.search('test query');

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        title: 'Test Article 1',
        url: 'https://example.com/article1',
        content: 'This is the content of article 1.',
      });
      expect(results[1]).toEqual({
        title: 'Test Article 2',
        url: 'https://example.com/article2',
        content: 'This is the content of article 2.',
      });
    });

    it('should handle direct JSON response', async () => {
      const plainTextResult = `Title: Single Result
URL: https://example.com/single
Text: Single result content.`;

      const jsonResponse = JSON.stringify({
        jsonrpc: '2.0',
        result: {
          content: [{ type: 'text', text: plainTextResult }],
        },
      });

      mockSimpleFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => jsonResponse,
      });

      const results = await exaSearch.search('test');

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Search Results');
    });

    it('should return raw text as single result when parsing fails', async () => {
      const rawText = 'Some unparseable content without standard format';

      const sseResponse = `data: ${JSON.stringify({
        jsonrpc: '2.0',
        result: {
          content: [{ type: 'text', text: rawText }],
        },
      })}`;

      mockSimpleFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => sseResponse,
      });

      const results = await exaSearch.search('test');

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Search Results');
      expect(results[0].content).toBe(rawText);
    });

    it('should throw error on HTTP failure', async () => {
      mockSimpleFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(exaSearch.search('test')).rejects.toThrow('Exa MCP error (500)');
    });

    it('should throw error on MCP error response', async () => {
      const sseResponse = `data: ${JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Something went wrong',
        },
      })}`;

      mockSimpleFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => sseResponse,
      });

      await expect(exaSearch.search('test')).rejects.toThrow('Exa MCP error: Something went wrong');
    });

    it('should send correct request format', async () => {
      const sseResponse = `data: ${JSON.stringify({
        jsonrpc: '2.0',
        result: {
          content: [{ type: 'text', text: 'Title: Test\nURL: https://test.com\nText: Content' }],
        },
      })}`;

      mockSimpleFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => sseResponse,
      });

      await exaSearch.search('my query');

      expect(mockSimpleFetch).toHaveBeenCalledWith(
        'https://mcp.exa.ai/mcp',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
          },
        })
      );

      // Verify request body
      const callArgs = mockSimpleFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.method).toBe('tools/call');
      expect(body.params.name).toBe('web_search_exa');
      expect(body.params.arguments.query).toBe('my query');
    });
  });

  describe('isExaMCPAvailable', () => {
    it('should always return true', () => {
      expect(isExaMCPAvailable()).toBe(true);
    });
  });
});
