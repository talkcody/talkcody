import { logger } from '@/lib/logger';
import { multiMCPAdapter } from '@/lib/mcp/multi-mcp-adapter';
import type { WebSearchResult, WebSearchSource } from './types';

const MINIMAX_MCP_SERVER_ID = 'minimax-coding-plan';

export class MiniMaxSearch implements WebSearchSource {
  async search(query: string): Promise<WebSearchResult[]> {
    const tool = await multiMCPAdapter.getAdaptedTool(`${MINIMAX_MCP_SERVER_ID}__web_search`);
    if (!tool) {
      throw new Error('MiniMax web_search tool not available');
    }

    // Execute the tool - the tool is an AI SDK tool object
    const result = await tool.execute({ query });
    logger.info('MiniMax web_search result:', result);

    // Helper function to parse organic results from JSON string
    const parseOrganicResults = (jsonText: string): WebSearchResult[] | null => {
      try {
        const parsed = JSON.parse(jsonText);
        if (parsed?.organic && Array.isArray(parsed.organic)) {
          logger.info('MiniMax parsed organic results count:', parsed.organic.length);
          return parsed.organic.map((item: any) => ({
            title: item.title || 'Search Result',
            url: item.link || item.url || '',
            content: item.snippet || item.description || '',
          }));
        }
      } catch (e) {
        logger.warn('Failed to parse MiniMax JSON:', e);
      }
      return null;
    };

    // Priority 1: Check structuredContent.text (MCP standard format)
    if (result?.structuredContent?.text) {
      logger.info('MiniMax: trying structuredContent.text');
      const results = parseOrganicResults(result.structuredContent.text);
      if (results && results.length > 0) {
        return results;
      }
    }

    // Priority 2: Check content[0].text (alternative MCP format)
    if (result?.content && Array.isArray(result.content) && result.content[0]?.text) {
      logger.info('MiniMax: trying content[0].text');
      const results = parseOrganicResults(result.content[0].text);
      if (results && results.length > 0) {
        return results;
      }
    }

    // Fallback: handle direct array format
    if (Array.isArray(result)) {
      return result.map((item: any) => ({
        title: item.title || item.name || 'Search Result',
        url: item.url || item.link || '',
        content: item.content || item.snippet || item.description || '',
      }));
    }

    // Handle wrapped result format
    if (result?.results && Array.isArray(result.results)) {
      return result.results.map((item: any) => ({
        title: item.title || item.name || 'Search Result',
        url: item.url || item.link || '',
        content: item.content || item.snippet || item.description || '',
      }));
    }

    logger.warn('MiniMax: no parseable results found in response');
    return [];
  }
}

/**
 * Check if MiniMax MCP server is available.
 * Note: This is a synchronous check that does NOT trigger MCP initialization.
 * If the MCP adapter hasn't been initialized yet (lazy-loaded), this will return false.
 * This is intentional — MCP initialization happens on first tool use or MCP page visit,
 * and MiniMax search is a lower-priority fallback provider.
 */
export function isMiniMaxMCPAvailable(): boolean {
  try {
    const status = multiMCPAdapter.getServerStatus(MINIMAX_MCP_SERVER_ID);
    return status.isConnected;
  } catch {
    return false;
  }
}
