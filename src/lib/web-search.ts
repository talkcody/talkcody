import { type GoogleGenerativeAIProviderMetadata, google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { aiProviderService } from '@/services/ai-provider-service';
import { settingsManager } from '@/stores/settings-store';
import { logger } from './logger';
import { GEMINI_25_FLASH_LITE, GPT5_MINI } from './models';
import { fetchWithTimeout } from './utils';

export interface TextSource {
  title: string;
  url: string;
  content: string;
  type?: string;
}

export interface ImageSource {
  title: string;
  url: string;
  image: string;
  type?: string;
}

export interface VideoSource {
  title: string;
  id: string;
}

export interface SearchResult {
  texts: TextSource[];
  images?: ImageSource[];
  videos?: VideoSource[];
}

export interface SearchOptions {
  categories?: string[];
  engines?: string[];
  language?: string;
  domains?: string[];
}

export enum SearchCategory {
  ALL = 'all',
  ACADEMIC = 'academic',
  IMAGES = 'images',
  VIDEOS = 'videos',
  NEWS = 'news',
  MUSIC = 'music',
}

export interface WebSearchSource {
  search(query: string): Promise<SearchResult>;
}

const tavilyUrl = 'https://api.tavily.com/search';

export interface GoogleSearchResult {
  text: string;
  sources: Array<{
    title?: string;
    url?: string;
    snippet?: string;
  }>;
  groundingMetadata?: GoogleGenerativeAIProviderMetadata['groundingMetadata'];
}

export async function googleSearch(query: string): Promise<GoogleSearchResult> {
  logger.info('searchGoogle:', query);

  try {
    const providerModel = aiProviderService.getProviderModel(GEMINI_25_FLASH_LITE);
    logger.info('Using provider model:', providerModel);

    const { text, sources, providerMetadata } = await generateText({
      model: providerModel,
      tools: {
        google_search: google.tools.googleSearch({ mode: 'MODE_DYNAMIC' }) as any,
      },
      prompt: query,
    });

    // Extract grounding metadata with proper type casting
    const metadata = providerMetadata?.google as GoogleGenerativeAIProviderMetadata | undefined;
    const groundingMetadata = metadata?.groundingMetadata;

    logger.info('searchGoogle result:', {
      text,
      sourcesCount: sources?.length || 0,
      hasGroundingMetadata: !!groundingMetadata,
    });

    return {
      text,
      sources: sources || [],
      groundingMetadata: groundingMetadata || null,
    };
  } catch (error) {
    logger.error('search-google error', error);
    throw error;
  }
}

export class TavilySearch implements WebSearchSource {
  private options: SearchOptions;

  constructor(params?: SearchOptions) {
    this.options = params || {};
  }

  async search(query: string): Promise<SearchResult> {
    logger.info('searchTavily: options', this.options);

    // Get Tavily API key from settings
    const apiKeys = await settingsManager.getApiKeys();
    const tavilyApiKey = apiKeys.tavily;

    if (!tavilyApiKey) {
      logger.error('Tavily API key not configured');
      throw new Error('Tavily API key is not configured. Please set it in Settings > API Keys.');
    }

    // Apply domain filtering if specified
    if (this.options.domains && this.options.domains.length > 0) {
      const siteQuery = this.options.domains.map((domain) => `site:${domain}`).join(' OR ');
      query = `${siteQuery} ${query}`;
    }

    logger.info('searchTavily:', tavilyUrl, query);

    let texts: TextSource[] = [];
    let images: ImageSource[] = [];
    const videos: VideoSource[] = [];

    try {
      const requestBody: any = {
        query: query.slice(0, 1000),
        search_depth: 'basic',
        include_answer: false,
        include_images: false,
        include_raw_content: false,
        max_results: 10,
      };

      // Handle different search categories
      if (this.options.categories && this.options.categories.length > 0) {
        const category = this.options.categories[0];
        switch (category) {
          case SearchCategory.IMAGES:
            requestBody.include_images = true;
            break;
          case SearchCategory.NEWS:
            requestBody.topic = 'news';
            break;
          case SearchCategory.VIDEOS:
            // Tavily doesn't have a specific video search, but we can modify the query
            query = `${query} video`;
            requestBody.query = query.slice(0, 2000);
            break;
          default:
            // General search - no additional parameters needed
            break;
        }
      }

      const response = await fetchWithTimeout(tavilyUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tavilyApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorDetails = await response.text();
        throw new Error(
          `Fetch failed with status code: ${response.status} and Details: ${errorDetails}`
        );
      }

      const jsonResponse = await response.json();

      // Process answer if available
      if (jsonResponse.answer) {
        texts.push({
          title: 'AI Answer',
          url: '',
          content: jsonResponse.answer,
        });
      }

      if (jsonResponse.results && Array.isArray(jsonResponse.results)) {
        texts = texts.concat(
          jsonResponse.results.map((result: any) => ({
            title: result.title || '',
            url: result.url || '',
            content: result.content || '',
          }))
        );
      }

      // Process images if available
      if (jsonResponse.images && Array.isArray(jsonResponse.images)) {
        images = images.concat(
          jsonResponse.images.map((image: any) => ({
            title: image.description || image.title || '',
            url: image.source_url || image.url || '',
            image: image.url || image.image_url || '',
          }))
        );
      }

      return { texts, images, videos };
    } catch (error) {
      logger.error('search-tavily error', error);
      return { texts, images, videos };
    }
  }
}
