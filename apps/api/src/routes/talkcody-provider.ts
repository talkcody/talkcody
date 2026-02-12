import { Hono } from 'hono';
import { authMiddleware, getAuth } from '../middlewares/auth';
import { userUsageService } from '../services/user-usage-service';
import type { HonoContext } from '../types/context';

const talkcodyProvider = new Hono<HonoContext>();

const ALLOWED_MODELS = ['MiniMax-M2.1', 'MiniMax-M2.5'];

function getUpstreamApiUrl(env?: HonoContext['Bindings']): string | undefined {
  if (typeof Bun !== 'undefined') {
    return Bun.env.TALKCODY_UPSTREAM_API;
  }
  return env?.TALKCODY_UPSTREAM_API;
}

function getUpstreamApiKey(env?: HonoContext['Bindings']): string | undefined {
  if (typeof Bun !== 'undefined') {
    return Bun.env.TALKCODY_UPSTREAM_API_KEY;
  }
  return env?.TALKCODY_UPSTREAM_API_KEY;
}

/**
 * Messages endpoint - Anthropic compatible
 * POST /api/talkcody/v1/messages
 */
talkcodyProvider.post('/v1/messages', authMiddleware, async (c) => {
  const { userId } = getAuth(c);

  // Check usage limits
  const usageCheck = await userUsageService.checkUsageLimits(userId, 'talkcody', c.env);

  if (!usageCheck.allowed) {
    return c.json(
      {
        type: 'error',
        error: {
          type: 'rate_limit_error',
          message: usageCheck.reason || 'Usage limit exceeded',
        },
      },
      429
    );
  }

  // Get upstream API configuration
  const upstreamApiUrl = getUpstreamApiUrl(c.env);
  const upstreamApiKey = getUpstreamApiKey(c.env);
  if (!upstreamApiUrl || !upstreamApiKey) {
    console.error('TALKCODY_UPSTREAM_API or TALKCODY_UPSTREAM_API_KEY is not configured');
    return c.json(
      {
        type: 'error',
        error: {
          type: 'api_error',
          message: 'Provider not configured',
        },
      },
      500
    );
  }

  try {
    const body = await c.req.json();

    // Validate model
    if (body.model && !ALLOWED_MODELS.includes(body.model as string)) {
      return c.json(
        {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: `Model not allowed. Available models: ${ALLOWED_MODELS.join(', ')}`,
          },
        },
        400
      );
    }

    // Forward request to upstream Anthropic-compatible API
    const response = await fetch(`${upstreamApiUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': upstreamApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    // Handle error responses (non-2xx status)
    if (!response.ok) {
      const errorData = await response.json();
      return c.json(errorData, response.status as 400 | 401 | 403 | 404 | 429 | 500);
    }

    // Handle streaming response
    if (body.stream) {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const reader = response.body?.getReader();

      // Track tokens for usage recording (Anthropic format)
      let inputTokens = 0;
      let outputTokens = 0;

      // Helper function to parse SSE line and extract token counts
      const parseSSELine = (line: string): { inputTokens?: number; outputTokens?: number } => {
        if (!line.startsWith('data: ')) return {};
        try {
          const data = JSON.parse(line.slice(6));
          // Anthropic streaming format:
          // - message_start: { message: { usage: { input_tokens } } }
          // - message_delta (end): { usage: { output_tokens } }
          return {
            inputTokens: data.message?.usage?.input_tokens ?? data.usage?.input_tokens,
            outputTokens: data.usage?.output_tokens,
          };
        } catch {
          // Ignore parse errors for non-JSON data lines
          return {};
        }
      };

      // Process stream in background with waitUntil to ensure completion
      const streamProcessing = (async () => {
        try {
          const decoder = new TextDecoder();
          let buffer = '';

          while (reader) {
            const { done, value } = await reader.read();
            if (done) break;

            // Decode and buffer the text
            buffer += decoder.decode(value, { stream: true });

            // Parse SSE data to extract token counts
            // Look for usage info in the stream (Anthropic format)
            // message_delta event contains usage: { output_tokens: xxx }
            // message_start event contains usage: { input_tokens: xxx }
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
              const parsed = parseSSELine(line);
              if (parsed.inputTokens !== undefined) inputTokens = parsed.inputTokens;
              if (parsed.outputTokens !== undefined) outputTokens = parsed.outputTokens;
            }

            await writer.write(value);
          }

          // Process any remaining content in buffer after stream ends
          // This handles the case where the last SSE event doesn't have a trailing newline
          if (buffer.trim()) {
            const parsed = parseSSELine(buffer);
            if (parsed.inputTokens !== undefined) inputTokens = parsed.inputTokens;
            if (parsed.outputTokens !== undefined) outputTokens = parsed.outputTokens;
          }
        } catch (error) {
          console.error('Stream processing error:', error);
        } finally {
          await writer.close();

          try {
            await userUsageService.recordUsage(
              userId,
              'talkcody',
              (body.model as string) || 'unknown',
              { input: inputTokens, output: outputTokens },
              c.env,
              usageCheck.used?.dailyTokens ?? 0
            );
          } catch (error) {
            console.error('Failed to record usage:', error);
          }
        }
      })();

      // Use waitUntil to ensure stream processing completes in Cloudflare Workers
      if (c.executionCtx?.waitUntil) {
        c.executionCtx.waitUntil(streamProcessing);
      }

      return new Response(readable, {
        status: response.status,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-TalkCody-Remaining-Tokens': String(usageCheck.remaining?.dailyTokens || 0),
        },
      });
    }

    // Handle non-streaming response
    const data = await response.json();

    // Record usage and get remaining tokens (Anthropic format: input_tokens, output_tokens)
    const usage = data.usage || {};
    const { remainingDailyTokens } = await userUsageService.recordUsage(
      userId,
      'talkcody',
      (body.model as string) || 'unknown',
      { input: usage.input_tokens || 0, output: usage.output_tokens || 0 },
      c.env,
      usageCheck.used?.dailyTokens ?? 0
    );

    return c.json(data, 200, {
      'X-TalkCody-Remaining-Tokens': String(remainingDailyTokens),
    });
  } catch (error) {
    console.error('TalkCody provider error:', error);
    return c.json(
      {
        type: 'error',
        error: {
          type: 'api_error',
          message: 'Internal server error',
        },
      },
      500
    );
  }
});

/**
 * Get usage statistics
 * GET /api/talkcody/usage
 */
talkcodyProvider.get('/usage', authMiddleware, async (c) => {
  const { userId } = getAuth(c);

  try {
    const stats = await userUsageService.getUsageStats(userId, 'talkcody', c.env);
    return c.json(stats);
  } catch (error) {
    console.error('Failed to get usage stats:', error);
    return c.json({ error: 'Failed to get usage statistics' }, 500);
  }
});

/**
 * List available models
 * GET /api/talkcody/models
 */
talkcodyProvider.get('/models', async (c) => {
  return c.json({
    object: 'list',
    data: ALLOWED_MODELS.map((id) => ({
      id,
      object: 'model',
      created: Date.now(),
      owned_by: 'talkcody',
      permission: [],
      root: id,
      parent: null,
    })),
  });
});

talkcodyProvider.get('/health', async (c) => {
  const upstreamApiUrl = getUpstreamApiUrl(c.env);
  const upstreamApiKey = getUpstreamApiKey(c.env);

  return c.json({
    status: upstreamApiUrl && upstreamApiKey ? 'ok' : 'not_configured',
    provider: 'talkcody',
    models: ALLOWED_MODELS.length,
    timestamp: new Date().toISOString(),
  });
});

export default talkcodyProvider;
