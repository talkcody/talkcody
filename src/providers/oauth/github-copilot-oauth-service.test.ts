import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGitHubCopilotFetch,
  isVisionRequest,
} from './github-copilot-oauth-service';

// Create mock functions
const mockStreamFetch = vi.fn();
const mockGetGitHubCopilotOAuthToken = vi.fn();

// Mock dependencies
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/tauri-fetch', () => ({
  streamFetch: (...args: unknown[]) => mockStreamFetch(...args),
}));

vi.mock('./github-copilot-oauth-store', () => ({
  getGitHubCopilotOAuthToken: () => mockGetGitHubCopilotOAuthToken(),
}));

describe('github-copilot-oauth-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isVisionRequest', () => {
    it('should return false for empty body', () => {
      expect(isVisionRequest(null)).toBe(false);
      expect(isVisionRequest(undefined)).toBe(false);
      expect(isVisionRequest({})).toBe(false);
    });

    it('should return false for non-object body', () => {
      expect(isVisionRequest('string')).toBe(false);
      expect(isVisionRequest(123)).toBe(false);
      expect(isVisionRequest(true)).toBe(false);
    });

    it('should return false for text-only messages', () => {
      const body = {
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
      };
      expect(isVisionRequest(body)).toBe(false);
    });

    it('should return true when messages contain image_url', () => {
      const body = {
        messages: [
          { role: 'user', content: 'Hello' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is in this image?' },
              { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
            ],
          },
        ],
      };
      expect(isVisionRequest(body)).toBe(true);
    });

    it('should return true when input contains input_image', () => {
      const body = {
        input: [
          { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyze this' },
              { type: 'input_image', data: 'base64...' },
            ],
          },
        ],
      };
      expect(isVisionRequest(body)).toBe(true);
    });

    it('should return false when messages array is empty', () => {
      const body = {
        messages: [],
      };
      expect(isVisionRequest(body)).toBe(false);
    });

    it('should return false when content is string', () => {
      const body = {
        messages: [{ role: 'user', content: 'Just a string message' }],
      };
      expect(isVisionRequest(body)).toBe(false);
    });
  });

  describe('createGitHubCopilotFetch', () => {
    it('should add Copilot-Vision-Request header for vision requests', async () => {
      // Mock token
      mockGetGitHubCopilotOAuthToken.mockResolvedValue('test-token');

      // Mock streamFetch to capture headers
      mockStreamFetch.mockResolvedValue(new Response('{}', { status: 200 }));

      const fetchFn = createGitHubCopilotFetch();

      // Vision request body
      const visionBody = JSON.stringify({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is this?' },
              { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
            ],
          },
        ],
      });

      await fetchFn('https://api.githubcopilot.com/chat/completions', {
        method: 'POST',
        body: visionBody,
      });

      // Check that streamFetch was called with vision header
      expect(mockStreamFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.any(Headers),
        })
      );

      // Get the actual headers passed
      const callArgs = mockStreamFetch.mock.calls[0];
      const headers = callArgs[1]?.headers as Headers;

      expect(headers.get('Copilot-Vision-Request')).toBe('true');
    });

    it('should not add Copilot-Vision-Request header for non-vision requests', async () => {
      mockGetGitHubCopilotOAuthToken.mockResolvedValue('test-token');
      mockStreamFetch.mockResolvedValue(new Response('{}', { status: 200 }));

      const fetchFn = createGitHubCopilotFetch();

      // Non-vision request body
      const textBody = JSON.stringify({
        messages: [{ role: 'user', content: 'Hello, how are you?' }],
      });

      await fetchFn('https://api.githubcopilot.com/chat/completions', {
        method: 'POST',
        body: textBody,
      });

      const callArgs = mockStreamFetch.mock.calls[0];
      const headers = callArgs[1]?.headers as Headers;

      expect(headers.get('Copilot-Vision-Request')).toBeNull();
    });

    it('should handle requests without body', async () => {
      mockGetGitHubCopilotOAuthToken.mockResolvedValue('test-token');
      mockStreamFetch.mockResolvedValue(new Response('{}', { status: 200 }));

      const fetchFn = createGitHubCopilotFetch();

      await fetchFn('https://api.githubcopilot.com/models', {
        method: 'GET',
      });

      expect(mockStreamFetch).toHaveBeenCalled();
      const callArgs = mockStreamFetch.mock.calls[0];
      const headers = callArgs[1]?.headers as Headers;

      expect(headers.get('Copilot-Vision-Request')).toBeNull();
    });

    it('should add required Copilot headers', async () => {
      mockGetGitHubCopilotOAuthToken.mockResolvedValue('test-token');
      mockStreamFetch.mockResolvedValue(new Response('{}', { status: 200 }));

      const fetchFn = createGitHubCopilotFetch();

      await fetchFn('https://api.githubcopilot.com/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ messages: [] }),
      });

      const callArgs = mockStreamFetch.mock.calls[0];
      const headers = callArgs[1]?.headers as Headers;

      expect(headers.get('Authorization')).toBe('Bearer test-token');
      expect(headers.get('User-Agent')).toBe('GitHubCopilotChat/0.35.0');
      expect(headers.get('Editor-Version')).toBe('vscode/1.105.1');
      expect(headers.get('Editor-Plugin-Version')).toBe('copilot-chat/0.35.0');
      expect(headers.get('Copilot-Integration-Id')).toBe('vscode-chat');
    });

    it('should throw error when token is not available', async () => {
      mockGetGitHubCopilotOAuthToken.mockResolvedValue(null);

      const fetchFn = createGitHubCopilotFetch();

      await expect(
        fetchFn('https://api.githubcopilot.com/chat/completions', {
          method: 'POST',
        })
      ).rejects.toThrow('GitHub Copilot token not available');
    });

    it('should replace base URL correctly', async () => {
      mockGetGitHubCopilotOAuthToken.mockResolvedValue('test-token');
      mockStreamFetch.mockResolvedValue(new Response('{}', { status: 200 }));

      const fetchFn = createGitHubCopilotFetch();

      await fetchFn('https://api.githubcopilot.com/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ messages: [] }),
      });

      expect(mockStreamFetch).toHaveBeenCalledWith(
        'https://api.githubcopilot.com/chat/completions',
        expect.any(Object)
      );
    });

    it('should handle enterprise URL', async () => {
      mockGetGitHubCopilotOAuthToken.mockResolvedValue('test-token');
      mockStreamFetch.mockResolvedValue(new Response('{}', { status: 200 }));

      const fetchFn = createGitHubCopilotFetch('enterprise.github.com');

      await fetchFn('https://api.githubcopilot.com/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ messages: [] }),
      });

      // Should replace with enterprise base URL
      expect(mockStreamFetch).toHaveBeenCalledWith(
        'https://copilot-api.enterprise.github.com/chat/completions',
        expect.any(Object)
      );
    });
  });
});
