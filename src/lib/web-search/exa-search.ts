import { logger } from '@/lib/logger';
import { simpleFetch } from '@/lib/tauri-fetch';
import type { WebSearchResult, WebSearchSource } from './types';

interface McpSearchRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: {
    name: string;
    arguments: {
      query: string;
      numResults?: number;
      livecrawl?: 'fallback' | 'preferred';
      type?: 'auto' | 'fast' | 'deep';
    };
  };
}

interface McpSearchResponse {
  jsonrpc: string;
  result?: {
    content: Array<{
      type: string;
      text: string;
    }>;
  };
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Parse Exa plain text format results
 * Format:
 * Title: ...
 * Author: ...
 * Published Date: ...
 * URL: ...
 * Text: ...
 */
function parseExaPlainText(text: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];

  // Split by "Title:" to get individual results
  const parts = text.split(/\n(?=Title:)/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || !trimmed.startsWith('Title:')) {
      continue;
    }

    // Extract fields using regex
    const titleMatch = trimmed.match(/^Title:\s*(.+?)(?:\n|$)/);
    const urlMatch = trimmed.match(/\nURL:\s*(.+?)(?:\n|$)/);
    const textMatch = trimmed.match(/\nText:\s*([\s\S]*?)(?=\n\nTitle:|$)/);

    if (titleMatch || urlMatch) {
      const title = titleMatch?.[1]?.trim() || 'Search Result';
      const url = urlMatch?.[1]?.trim() || '';
      // Get the text content, limit to first 500 chars for preview
      let content = textMatch?.[1]?.trim() || '';
      if (content.length > 500) {
        content = `${content.substring(0, 500)}...`;
      }

      results.push({ title, url, content });
    }
  }

  return results;
}

/**
 * Call Exa MCP endpoint directly without going through MCP SDK
 */
async function callExaMCPDirect(query: string, numResults: number): Promise<string> {
  const searchRequest: McpSearchRequest = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: {
      name: 'web_search_exa',
      arguments: {
        query,
        type: 'auto',
        numResults,
        livecrawl: 'fallback',
      },
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await simpleFetch(`https://mcp.exa.ai/mcp`, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(searchRequest),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Exa MCP error (${response.status}): ${errorText}`);
    }

    const responseText = await response.text();

    // Parse SSE response - look for "data: " lines
    const lines = responseText.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data: McpSearchResponse = JSON.parse(line.substring(6));
        if (data.result?.content?.[0]?.text) {
          return data.result.content[0].text;
        }
        if (data.error) {
          throw new Error(`Exa MCP error: ${data.error.message}`);
        }
      }
    }

    return responseText;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Exa search request timed out');
    }

    throw error;
  }
}

export class ExaSearch implements WebSearchSource {
  async search(query: string): Promise<WebSearchResult[]> {
    const t0 = performance.now();

    try {
      const resultText = await callExaMCPDirect(query, 10);
      const t1 = performance.now();
      logger.info(`[Exa] Search completed in ${(t1 - t0).toFixed(0)}ms`);

      // Parse the plain text result
      const results = parseExaPlainText(resultText);

      if (results.length > 0) {
        logger.info(`[Exa] Parsed ${results.length} results`);
        return results;
      }

      // If no structured results, return the raw text as a single result
      if (resultText.trim()) {
        logger.info('[Exa] Returning raw text as single result');
        return [
          {
            title: 'Search Results',
            url: '',
            content: resultText.length > 1000 ? `${resultText.substring(0, 1000)}...` : resultText,
          },
        ];
      }

      logger.warn('[Exa] No results found');
      return [];
    } catch (error) {
      const t1 = performance.now();
      logger.error(`[Exa] Search failed after ${(t1 - t0).toFixed(0)}ms:`, error);
      throw error;
    }
  }
}

/**
 * Check if Exa search is available (always true since we call the endpoint directly)
 */
export function isExaMCPAvailable(): boolean {
  // Always return true since we're calling the Exa MCP endpoint directly
  // without depending on the MCP server connection
  return true;
}
