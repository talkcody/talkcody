import { z } from 'zod';
import { SearchToolDoing } from '@/components/tools/search-tool-doing';
import { SearchToolResult } from '@/components/tools/search-tool-result';
import { createTool } from '@/lib/create-tool';
import { logger } from '@/lib/logger';
import { settingsManager } from '@/stores/settings-store';
import { googleSearch, TavilySearch } from '../web-search';

export const webSearchTool = createTool({
  name: 'webSearch',
  description: `Search the web for comprehensive and up-to-date information.

Query Optimization Guidelines:
- Extract the core topic/entity from questions (e.g., "who is Elon Musk" → "Elon Musk", "what is React" → "React")
- For comparisons (e.g., "X vs Y"), search for both terms together to get comparison results
- Remove question words (who, what, when, where, why, how) but keep context words that add meaning
- Keep technical terms, version numbers, and specific qualifiers (e.g., "React 19 features" stays as-is)
- For "latest" or "recent" queries, include temporal keywords (e.g., "latest AI models 2025")
- Preserve programming language/framework context (e.g., "error handling in Rust" → "Rust error handling")
- For debugging queries, keep error messages and stack traces intact
- Use multiple searches only when topics are completely unrelated, not for comparisons`,
  inputSchema: z.object({
    query: z.string().min(1).max(100).describe('The search query'),
  }),
  canConcurrent: true,
  execute: async ({ query }) => {
    const apiKeys = await settingsManager.getApiKeys();
    const hasTavilyKey = !!apiKeys.tavily;
    // const isGPT5MiniAvailable = modelService.isModelAvailableSync(GPT5_MINI);
    // const isGemini25FlashAvailable = modelService.isModelAvailableSync(GEMINI_25_FLASH_LITE);
    const isGPT5MiniAvailable = false;
    const isGemini25FlashAvailable = false;
    logger.info('Web Search - Available Providers', {
      hasTavilyKey,
      isGPT5MiniAvailable,
      isGemini25FlashAvailable,
    });

    if (hasTavilyKey) {
      // Use Tavily Search
      logger.info('Using Tavily Search');
      const tavilySearch = new TavilySearch();
      const result = await tavilySearch.search(query);

      logger.info('tavily results', result.texts);

      return result.texts.map((text) => ({
        title: text.title,
        url: text.url,
        content: text.content,
      }));
    } else if (isGemini25FlashAvailable) {
      // Use Google Search with Grounding
      logger.info('Using Google Search with Grounding');
      const result = await googleSearch(query);

      logger.info('google search result', {
        text: result.text,
        sourcesCount: result.sources.length,
        hasGroundingMetadata: !!result.groundingMetadata,
      });

      // If we have sources, return them with the AI-generated text
      if (result.sources.length > 0) {
        return result.sources.map((source) => ({
          title: source.title || 'Google Search Result',
          url: source.url || '',
          content: source.snippet || result.text,
        }));
      }

      // Fallback to just the text if no sources
      return [
        {
          search_result: result.text,
        },
      ];
    } else {
      logger.warn('No web search provider available');
      return {
        error:
          'No web search provider available. please return the user_message to inform the user.',
        user_message:
          'Please configure Tavily API key in Settings > API Keys, you could refer to https://docs.tavily.com/documentation/quickstart',
      };
    }
  },
  renderToolDoing: ({ query }) => <SearchToolDoing query={query} />,
  renderToolResult: (result, { query } = {}) => <SearchToolResult results={result} query={query} />,
});
