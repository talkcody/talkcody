import { z } from 'zod';
import { GenericToolDoing } from '@/components/tools/generic-tool-doing';
import { GenericToolResult } from '@/components/tools/generic-tool-result';
import { createTool } from '@/lib/create-tool';
import { logger } from '@/lib/logger';
import { generateId } from '@/lib/utils';
import { getLocale, type SupportedLocale } from '@/locales';
import { fileService } from '@/services/file-service';
import { llmClient } from '@/services/llm/llm-client';
import type { ImageGenerationRequest } from '@/services/llm/types';
import { useSettingsStore } from '@/stores/settings-store';
import type { MessageAttachment } from '@/types/agent';

export const imageGenerationTool = createTool({
  name: 'imageGeneration',
  description: `Generate images using AI image generation models.

Size recommendations for presentations:
- "1024x1024" (1:1) - Square slides
- "1792x1024" (16:9 approx) - Landscape slides (best for PPT)
- "1024x1792" (9:16) - Portrait slides

Quality options:
- "standard" - Standard quality (faster, cheaper)
- "hd" or "high" - High quality (better results)`,
  inputSchema: z.object({
    prompt: z
      .string()
      .min(1)
      .max(4000)
      .describe(
        'Detailed description of the image to generate. Be specific about style, colors, composition, and content.'
      ),
    size: z
      .string()
      .optional()
      .describe(
        'Optional: Image size. Supported: "1024x1024" (square), "1792x1024" (landscape/best for PPT), "1024x1792" (portrait). Default: "1024x1024"'
      ),
    quality: z
      .string()
      .optional()
      .describe(
        'Optional: Image quality - "standard" (default) or "hd"/"high" (better quality, slower)'
      ),
    n: z
      .number()
      .min(1)
      .max(4)
      .optional()
      .describe('Optional: Number of images to generate (1-4). Default: 1'),
  }),
  canConcurrent: false, // Image generation is resource-intensive, don't run concurrently
  execute: async ({ prompt, size, quality, n }, _context) => {
    try {
      logger.info('Image generation requested', { prompt: prompt.slice(0, 100), size, n });

      // Build request
      const request: ImageGenerationRequest = {
        model: '', // Empty string lets Rust backend auto-select
        prompt,
        size: size || '1024x1024',
        quality: quality === 'high' ? 'hd' : quality || 'standard',
        n: n || 1,
        responseFormat: 'url', // Prefer URLs to avoid large base64 payloads
        providerOptions: null,
        requestId: null,
      };

      // Call Rust backend
      const response = await llmClient.generateImage(request);

      logger.info('Image generation completed', {
        provider: response.provider,
        imageCount: response.images.length,
        requestId: response.requestId,
      });

      const normalizeBase64Image = (base64Data: string): string => {
        let updated = base64Data.trim();
        if (updated.startsWith('data:')) {
          updated = updated.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
        }
        return updated.replace(/\s+/g, '');
      };

      const decodeBase64ToBytes = (base64Data: string): Uint8Array => {
        const normalized = normalizeBase64Image(base64Data);
        const binaryString = atob(normalized);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
      };

      const extensionFromMimeType = (mimeType: string): string => {
        const lower = mimeType.toLowerCase();
        if (lower.includes('png')) return 'png';
        if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
        if (lower.includes('gif')) return 'gif';
        if (lower.includes('webp')) return 'webp';
        return 'png';
      };

      const timestamp = Date.now();
      const savedImages: Array<{
        filePath: string;
        filename: string;
        size: number;
        mimeType: string;
        revisedPrompt?: string | null;
        url?: string | null;
      }> = [];
      const attachments: MessageAttachment[] = [];

      for (const [index, img] of response.images.entries()) {
        try {
          let bytes: Uint8Array | null = null;
          let mimeType = img.mimeType || 'image/png';

          if (img.url) {
            logger.info(
              `[imageGeneration] Downloading image from URL via backend: ${img.url.substring(0, 100)}...`
            );
            try {
              // Use backend download to bypass browser CORS restrictions
              const downloadResponse = await llmClient.downloadImage({ url: img.url });
              bytes = new Uint8Array(downloadResponse.data);
              mimeType = downloadResponse.mimeType;
              logger.info(
                `[imageGeneration] Downloaded ${bytes.length} bytes via backend, MIME: ${mimeType}`
              );

              // Check if downloaded data looks like an image (check magic bytes)
              if (bytes.length > 4) {
                const magic = Array.from(bytes.slice(0, 4))
                  .map((b) => b.toString(16).padStart(2, '0'))
                  .join(' ');
                logger.info(`[imageGeneration] File magic bytes: ${magic}`);
              }
            } catch (downloadError) {
              logger.error(`[imageGeneration] Backend download error:`, {
                error:
                  downloadError instanceof Error ? downloadError.message : String(downloadError),
                url: img.url.substring(0, 100),
              });
              throw downloadError;
            }
          } else if (img.b64Json) {
            bytes = decodeBase64ToBytes(img.b64Json);
          } else {
            logger.warn('Image generation response missing data', { index });
            continue;
          }

          const extension = extensionFromMimeType(mimeType);
          const filename = `generated-${timestamp}-${index + 1}.${extension}`;
          logger.info(`[imageGeneration] Saving image as ${filename}, mimeType: ${mimeType}`);
          const filePath = await fileService.saveGeneratedImage(bytes, filename);
          logger.info(`[imageGeneration] Image saved to: ${filePath}`);

          savedImages.push({
            filePath,
            filename,
            size: bytes.length,
            mimeType,
            revisedPrompt: img.revisedPrompt,
            url: img.url,
          });

          attachments.push({
            id: generateId(),
            type: 'image',
            filename,
            filePath,
            mimeType,
            size: bytes.length,
          });
        } catch (error) {
          logger.error('Failed to save generated image:', error);
        }
      }

      if (savedImages.length === 0) {
        return {
          success: false,
          error: 'No images saved',
          images: [],
          count: 0,
        };
      }

      return {
        success: true,
        provider: response.provider,
        images: savedImages,
        count: savedImages.length,
        attachments,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Image generation failed:', error);

      return {
        success: false,
        error: errorMessage,
        images: [],
        count: 0,
      };
    }
  },
  renderToolDoing: ({ prompt, n }) => (
    <GenericToolDoing
      operation="generate"
      target={`${n || 1} image(s)`}
      details={`Generating: ${prompt.slice(0, 60)}...`}
    />
  ),
  renderToolResult: (result) => {
    const t = getLocale((useSettingsStore.getState().language || 'en') as SupportedLocale);
    const success = result?.success && result.images.length > 0;
    const message = success
      ? `Generated ${result.count} image(s) using ${result.provider}. Files saved locally.`
      : result?.error || t.ImageGeneration.errors.noImages;

    return <GenericToolResult success={success} message={message} />;
  },
});
