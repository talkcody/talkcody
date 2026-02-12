import { logger } from '@/lib/logger';
import { multiMCPAdapter } from '@/lib/mcp/multi-mcp-adapter';
import type { WebSearchResult, WebSearchSource } from './types';

const GLM_MCP_SERVER_ID = 'glm-coding-plan-search';

export class GLMSearch implements WebSearchSource {
  async search(query: string): Promise<WebSearchResult[]> {
    const tool = await multiMCPAdapter.getAdaptedTool(`${GLM_MCP_SERVER_ID}__webSearchPrime`);
    if (!tool) {
      throw new Error('GLM webSearchPrime tool not available');
    }

    // Execute the tool
    const result = await tool.execute({ search_query: query });
    logger.info('GLM webSearchPrime result:', result);

    // Helper function to parse GLM results from JSON string
    // GLM returns double-escaped JSON: "\"[{\\\"title\\\":\\\"...\\\",...}]\""
    // Need to JSON.parse twice to get the actual array
    const parseGLMResults = (jsonText: string): WebSearchResult[] | null => {
      try {
        let parsed = JSON.parse(jsonText);

        // If result is still a string, parse again (double-escaped JSON)
        if (typeof parsed === 'string') {
          logger.info('GLM: double-escaped JSON detected, parsing again');
          parsed = JSON.parse(parsed);
        }

        // GLM returns direct array with fields: refer, title, link, content
        if (Array.isArray(parsed)) {
          logger.info('GLM parsed results count:', parsed.length);
          return parsed.map((item: any) => ({
            title: item.title || item.name || 'Search Result',
            url: item.link || item.url || '',
            content: item.content || item.snippet || item.description || '',
          }));
        }

        // Also handle wrapped formats
        const items = parsed?.organic || parsed?.results || parsed?.data;
        if (Array.isArray(items)) {
          logger.info('GLM parsed wrapped results count:', items.length);
          return items.map((item: any) => ({
            title: item.title || item.name || 'Search Result',
            url: item.link || item.url || '',
            content: item.content || item.snippet || item.description || '',
          }));
        }
      } catch (e) {
        logger.warn('Failed to parse GLM JSON:', e);
      }
      return null;
    };

    // Priority 1: Check structuredContent.text (MCP standard format)
    if (result?.structuredContent?.text) {
      logger.info('GLM: trying structuredContent.text');
      const results = parseGLMResults(result.structuredContent.text);
      if (results && results.length > 0) {
        return results;
      }
    }

    // Priority 2: Check content[0].text (alternative MCP format)
    if (result?.content && Array.isArray(result.content) && result.content[0]?.text) {
      logger.info('GLM: trying content[0].text');
      const results = parseGLMResults(result.content[0].text);
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

    // Handle wrapped result structures
    if (result?.data && Array.isArray(result.data)) {
      return result.data.map((item: any) => ({
        title: item.title || item.name || 'Search Result',
        url: item.url || item.link || '',
        content: item.content || item.snippet || item.description || '',
      }));
    }

    if (result?.results && Array.isArray(result.results)) {
      return result.results.map((item: any) => ({
        title: item.title || item.name || 'Search Result',
        url: item.url || item.link || '',
        content: item.content || item.snippet || item.description || '',
      }));
    }

    logger.warn('GLM: no parseable results found in response');
    return [];
  }
}

/**
 * Check if GLM MCP server is available.
 * Note: This is a synchronous check that does NOT trigger MCP initialization.
 * If the MCP adapter hasn't been initialized yet (lazy-loaded), this will return false.
 * This is intentional — MCP initialization happens on first tool use or MCP page visit,
 * and GLM search is a lower-priority fallback provider.
 */
export function isGLMMCPAvailable(): boolean {
  try {
    const status = multiMCPAdapter.getServerStatus(GLM_MCP_SERVER_ID);
    return status.isConnected;
  } catch {
    return false;
  }
}
