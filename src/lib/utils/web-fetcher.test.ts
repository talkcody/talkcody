import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { taskFileService } from '@/services/task-file-service';
import * as utils from '../utils';
import { fetchWebContent, fetchWithTavily } from './web-fetcher';
import * as readabilityExtractorModule from './readability-extractor';

// Mock the fetchWithTimeout function
vi.mock('../utils', () => ({
  fetchWithTimeout: vi.fn(),
}));

const mockFetchWithTimeout = utils.fetchWithTimeout as Mock;

// Mock readability extractor
vi.mock('./readability-extractor', () => ({
  readabilityExtractor: {
    extract: vi.fn(),
  },
}));

vi.mock('@/services/task-file-service', () => ({
  taskFileService: {
    writeFile: vi.fn(),
  },
}));

const mockReadabilityExtract = readabilityExtractorModule.readabilityExtractor.extract as Mock;

// Set up environment variable for tests
const originalEnv = import.meta.env;

describe('web-fetcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (import.meta as any).env = {
      ...originalEnv,
      VITE_TAVILY_API_KEY: 'test-api-key',
    };
  });

  describe('fetchWithTavily', () => {
    it('should successfully fetch web content using Tavily', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          results: [
            {
              url: 'https://example.com',
              raw_content: 'Test content from Tavily',
            },
          ],
        }),
        text: vi.fn(),
      };

      mockFetchWithTimeout.mockResolvedValue(mockResponse as any);

      const result = await fetchWithTavily('https://example.com');

      expect(result).toEqual({
        url: 'https://example.com',
        content: 'Test content from Tavily',
        title: undefined,
        publishedDate: null,
      });

      expect(mockFetchWithTimeout).toHaveBeenCalledWith(
        'https://api.tavily.com/extract',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            urls: ['https://example.com'],
            include_images: false,
          }),
        })
      );
    });

    it('should handle empty raw_content', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          results: [
            {
              url: 'https://example.com',
              raw_content: '',
            },
          ],
        }),
        text: vi.fn(),
      };

      mockFetchWithTimeout.mockResolvedValue(mockResponse as any);

      const result = await fetchWithTavily('https://example.com');

      expect(result.content).toBe('');
    });

    it('should throw error when no results returned', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          results: [],
        }),
        text: vi.fn(),
      };

      mockFetchWithTimeout.mockResolvedValue(mockResponse as any);

      await expect(fetchWithTavily('https://example.com')).rejects.toThrow(
        'No results returned from Tavily API'
      );
    });

    it('should throw error when response is not ok', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        text: vi.fn().mockResolvedValue('Unauthorized'),
      };

      mockFetchWithTimeout.mockResolvedValue(mockResponse as any);

      await expect(fetchWithTavily('https://example.com')).rejects.toThrow(
        'Tavily fetch failed with status code: 401'
      );
    });
  });

  describe('fetchWebContent', () => {
    it('should successfully fetch with Readability (primary method)', async () => {
      mockReadabilityExtract.mockResolvedValueOnce({
        title: 'Test Page',
        url: 'https://example.com',
        content: 'Test content',
      });

      const result = await fetchWebContent('https://example.com');

      expect(result.title).toBe('Test Page');
      expect(result.content).toBe('Test content');
      expect(mockReadabilityExtract).toHaveBeenCalledTimes(1);
      expect(mockFetchWithTimeout).not.toHaveBeenCalled();
    });

    it('should save content to task file when content exceeds limit', async () => {
      const longContent = 'a'.repeat(10001);

      mockReadabilityExtract.mockResolvedValueOnce({
        title: 'Test Page',
        url: 'https://example.com',
        content: longContent,
      });

      (taskFileService.writeFile as Mock).mockResolvedValue('/test/root/.talkcody/tool/task-1/tool_web-fetch.txt');

      const result = await fetchWebContent('https://example.com', {
        taskId: 'task-1',
        toolId: 'tool',
      });

      expect(taskFileService.writeFile).toHaveBeenCalledWith(
        'tool',
        'task-1',
        'tool_web-fetch.txt',
        longContent
      );
      expect(result.filePath).toBe('/test/root/.talkcody/tool/task-1/tool_web-fetch.txt');
      expect(result.content).toContain('saved to');
      expect(result.content).toContain('grep');
      expect(result.truncated).toBe(true);
      expect(result.contentLength).toBe(10001);
    });

    it('should truncate content when task context is missing', async () => {
      const longContent = 'b'.repeat(10001);

      mockReadabilityExtract.mockResolvedValueOnce({
        title: 'Test Page',
        url: 'https://example.com',
        content: longContent,
      });

      const result = await fetchWebContent('https://example.com');

      expect(result.truncated).toBe(true);
      expect(result.contentLength).toBe(10001);
      expect(result.content).toContain('Returning first 10000 characters');
      expect(result.content).toContain(longContent.slice(0, 10000));
    });

    it('should fallback to Tavily when Readability returns null', async () => {
      const tavilySuccessResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          results: [
            {
              url: 'https://example.com',
              raw_content: 'Content from Tavily fallback',
            },
          ],
        }),
        text: vi.fn(),
      };

      mockReadabilityExtract.mockResolvedValueOnce(null);
      mockFetchWithTimeout.mockResolvedValueOnce(tavilySuccessResponse as any);

      const result = await fetchWebContent('https://example.com');

      expect(result.content).toBe('Content from Tavily fallback');
      expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);
      expect(mockReadabilityExtract).toHaveBeenCalledTimes(1);
    });

    it('should fallback to Tavily when Readability throws', async () => {
      const tavilySuccessResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          results: [
            {
              url: 'https://example.com',
              raw_content: 'Content from Tavily fallback',
            },
          ],
        }),
        text: vi.fn(),
      };

      mockReadabilityExtract.mockRejectedValueOnce(new Error('Readability error'));
      mockFetchWithTimeout.mockResolvedValueOnce(tavilySuccessResponse as any);

      const result = await fetchWebContent('https://example.com');

      expect(result.content).toBe('Content from Tavily fallback');
      expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);
      expect(mockReadabilityExtract).toHaveBeenCalledTimes(1);
    });

    it('should throw error when Readability and Tavily both fail', async () => {
      const mockErrorResponse = {
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('Server error'),
      };

      mockReadabilityExtract.mockResolvedValueOnce(null);
      mockFetchWithTimeout.mockResolvedValueOnce(mockErrorResponse as any);

      await expect(fetchWebContent('https://example.com')).rejects.toThrow(
        'Failed to fetch web content. Readability error:'
      );

      expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);
      expect(mockReadabilityExtract).toHaveBeenCalledTimes(1);
    });

    it('should throw error for invalid URL (no http)', async () => {
      await expect(fetchWebContent('example.com')).rejects.toThrow('Invalid URL provided');

      expect(mockFetchWithTimeout).not.toHaveBeenCalled();
    });

    it('should throw error for empty URL', async () => {
      await expect(fetchWebContent('')).rejects.toThrow('Invalid URL provided');

      expect(mockFetchWithTimeout).not.toHaveBeenCalled();
    });

    it('should accept https URLs', async () => {
      mockReadabilityExtract.mockResolvedValueOnce({
        title: 'Test',
        url: 'https://example.com',
        content: 'Content',
      });

      await expect(fetchWebContent('https://example.com')).resolves.toBeDefined();
    });

    it('should accept http URLs', async () => {
      mockReadabilityExtract.mockResolvedValueOnce({
        title: 'Test',
        url: 'http://example.com',
        content: 'Content',
      });

      await expect(fetchWebContent('http://example.com')).resolves.toBeDefined();
    });
  });
});
