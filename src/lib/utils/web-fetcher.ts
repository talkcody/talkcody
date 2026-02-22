import { logger } from '@/lib/logger';
import { taskFileService } from '@/services/task-file-service';
import { fetchWithTimeout } from '../utils';
import { readabilityExtractor } from './readability-extractor';

export interface WebFetchResult {
  title?: string;
  url: string;
  content: string;
  publishedDate?: string | null;
  filePath?: string;
  truncated?: boolean;
  contentLength?: number;
}

export async function fetchWithTavily(url: string): Promise<WebFetchResult> {
  const tavilyExtractUrl = 'https://api.tavily.com/extract';
  logger.info('fetchWithTavily:', url);

  const requestBody = {
    urls: [url],
    include_images: false,
  };

  const response = await fetchWithTimeout(tavilyExtractUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_TAVILY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorDetails = await response.text();
    logger.error('Tavily fetch error details', errorDetails);
    throw new Error(
      `Tavily fetch failed with status code: ${response.status}, Details: ${errorDetails}`
    );
  }

  const jsonResponse = await response.json();
  logger.info('fetchWithTavily response:', jsonResponse);

  // Process the first result from the results array
  if (
    jsonResponse.results &&
    Array.isArray(jsonResponse.results) &&
    jsonResponse.results.length > 0
  ) {
    const result = jsonResponse.results[0];
    return {
      url: result.url || url,
      content: result.raw_content || '',
      title: undefined, // Tavily doesn't provide title
      publishedDate: null,
    };
  }

  throw new Error('No results returned from Tavily API');
}

function validateUrl(url: string): void {
  if (!url?.startsWith('http')) {
    throw new Error('Invalid URL provided. URL must start with http or https');
  }
}

const MAX_INLINE_CONTENT_LENGTH = 10000;

function truncateContent(content: string): string {
  return content.slice(0, MAX_INLINE_CONTENT_LENGTH);
}

function sanitizeFileName(fileName: string): string {
  const safeName = fileName || 'web-fetch';
  return safeName
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\.\./g, '_')
    .trim();
}

function buildLargeContentMessage(filePath: string, contentLength: number): string {
  return [
    `Content is ${contentLength} characters and was saved to: ${filePath}.`,
    'You can use shell tools like `grep`, `less`, or `tail` to inspect the file.',
  ].join('\n');
}

async function handleLargeContent(
  result: WebFetchResult,
  context?: { taskId?: string; toolId?: string }
): Promise<WebFetchResult> {
  const contentLength = result.content.length;
  if (contentLength <= MAX_INLINE_CONTENT_LENGTH) {
    return { ...result, contentLength };
  }

  const taskId = context?.taskId;
  const toolId = context?.toolId;
  if (!taskId || !toolId) {
    const truncatedContent = truncateContent(result.content);
    return {
      ...result,
      content: [
        `Content is ${contentLength} characters. Returning first ${MAX_INLINE_CONTENT_LENGTH} characters.`,
        truncatedContent,
      ].join('\n\n'),
      truncated: true,
      contentLength,
    };
  }

  const fileName = sanitizeFileName(`${toolId}_web-fetch.txt`);
  const filePath = await taskFileService.writeFile('tool', taskId, fileName, result.content);

  return {
    ...result,
    content: buildLargeContentMessage(filePath, contentLength),
    filePath,
    truncated: true,
    contentLength,
  };
}

export async function fetchWebContent(
  url: string,
  context?: { taskId?: string; toolId?: string }
): Promise<WebFetchResult> {
  validateUrl(url);

  const result = await fetchWebContentInternal(url);
  return await handleLargeContent(result, context);
}

async function fetchWebContentInternal(url: string): Promise<WebFetchResult> {
  // Try Readability first
  try {
    logger.info('Attempting to fetch with Readability:', url);
    const readabilityResult = await readabilityExtractor.extract(url);
    if (readabilityResult) {
      logger.info('Successfully fetched with Readability');
      return {
        title: readabilityResult.title,
        url: readabilityResult.url,
        content: readabilityResult.content,
        publishedDate: null,
      };
    }
    throw new Error('Readability extraction returned null');
  } catch (readabilityError) {
    logger.warn('Readability fetch failed, falling back to Tavily:', readabilityError);

    // Fallback to Tavily
    try {
      logger.info('Attempting to fetch with Tavily:', url);
      const result = await fetchWithTavily(url);
      logger.info('Successfully fetched with Tavily (fallback)');
      return result;
    } catch (tavilyError) {
      logger.error('All fetch methods failed:', {
        readabilityError,
        tavilyError,
      });

      // All methods failed
      throw new Error(
        `Failed to fetch web content. Readability error: ${readabilityError instanceof Error ? readabilityError.message : 'Unknown error'}. Tavily error: ${tavilyError instanceof Error ? tavilyError.message : 'Unknown error'}`
      );
    }
  }
}
