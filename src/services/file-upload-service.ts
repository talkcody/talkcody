// src/services/file-upload-service.ts
// Unified file upload service for images, documents, and clipboard handling

import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import clipboard from 'tauri-plugin-clipboard-api';
import { fileParser } from '@/lib/local-file-parser';
import { logger } from '@/lib/logger';
import { generateId } from '@/lib/utils';
import type { MessageAttachment } from '@/types/agent';
import { fileService } from './file-service';

/**
 * Unified service for handling all file uploads:
 * - Dialog-based image/document uploads
 * - Clipboard paste (3-tier fallback)
 * - Drag-and-drop
 */
class FileUploadService {
  // ============================================================================
  // MIME Type Detection
  // ============================================================================

  private readonly IMAGE_MIME_TYPES: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
  };

  private readonly DOCUMENT_MIME_TYPES: Record<string, string> = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    markdown: 'text/markdown',
    json: 'application/json',
    xml: 'application/xml',
    csv: 'text/csv',
    html: 'text/html',
    htm: 'text/html',
    // Programming languages
    js: 'application/javascript',
    ts: 'application/typescript',
    jsx: 'application/javascript',
    tsx: 'application/typescript',
    py: 'text/x-python',
    java: 'text/x-java',
    cpp: 'text/x-c++src',
    c: 'text/x-csrc',
    h: 'text/x-chdr',
    go: 'text/x-go',
    rs: 'text/x-rust',
    php: 'application/x-php',
    rb: 'text/x-ruby',
    swift: 'text/x-swift',
    kt: 'text/x-kotlin',
    scala: 'text/x-scala',
    sh: 'application/x-sh',
    bash: 'application/x-sh',
    sql: 'application/sql',
    r: 'text/x-r',
  };

  private readonly VIDEO_MIME_TYPES: Record<string, string> = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    flv: 'video/x-flv',
    wmv: 'video/x-ms-wmv',
    '3gp': 'video/3gpp',
    m4v: 'video/x-m4v',
    ogv: 'video/ogg',
  };

  // Max video file size: 100MB
  private readonly MAX_VIDEO_SIZE = 100 * 1024 * 1024;

  /**
   * Get MIME type from file extension
   */
  private getMimeType(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase();
    if (!extension) return 'application/octet-stream';

    // Check image types first
    if (this.IMAGE_MIME_TYPES[extension]) {
      return this.IMAGE_MIME_TYPES[extension];
    }

    // Then check document types
    if (this.DOCUMENT_MIME_TYPES[extension]) {
      return this.DOCUMENT_MIME_TYPES[extension];
    }

    return 'application/octet-stream';
  }

  /**
   * Check if file is an image based on extension
   */
  private isImageFile(filePath: string): boolean {
    const extension = filePath.split('.').pop()?.toLowerCase();
    return extension ? extension in this.IMAGE_MIME_TYPES : false;
  }

  /**
   * Check if file is a video based on extension
   */
  private isVideoFile(filePath: string): boolean {
    const extension = filePath.split('.').pop()?.toLowerCase();
    return extension ? extension in this.VIDEO_MIME_TYPES : false;
  }

  /**
   * Get video MIME type from file extension
   */
  private getVideoMimeType(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase();
    return extension ? this.VIDEO_MIME_TYPES[extension] || 'video/mp4' : 'video/mp4';
  }

  /**
   * Validate video file (size and format)
   */
  private validateVideoFile(filePath: string, size: number): { valid: boolean; error?: string } {
    if (size > this.MAX_VIDEO_SIZE) {
      return {
        valid: false,
        error: `Video file exceeds maximum size of 100MB (${(size / (1024 * 1024)).toFixed(1)}MB)`,
      };
    }

    if (!this.isVideoFile(filePath)) {
      const extension = filePath.split('.').pop()?.toLowerCase() || 'unknown';
      return {
        valid: false,
        error: `Unsupported video format: ${extension}. Supported formats: ${Object.keys(this.VIDEO_MIME_TYPES).join(', ')}`,
      };
    }

    return { valid: true };
  }

  // ============================================================================
  // Filename Extraction
  // ============================================================================

  /**
   * Extract filename from path (handles both Unix and Windows paths)
   */
  private extractFilename(filePath: string): string {
    const normalizedPath = filePath.replace(/\\/g, '/').replace(/\/+$/, '');
    if (!normalizedPath) return 'unknown';

    const unixParts = normalizedPath.split('/');
    const unixFilename = unixParts[unixParts.length - 1];

    return unixFilename || 'unknown';
  }

  // ============================================================================
  // Dialog-based Uploads
  // ============================================================================

  /**
   * Open dialog and upload selected image files
   */
  async uploadImagesFromDialog(): Promise<MessageAttachment[]> {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: 'Images',
            extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
          },
        ],
      });

      if (!selected) {
        return [];
      }

      const filePaths = Array.isArray(selected) ? selected : [selected];
      const attachments: MessageAttachment[] = [];

      for (const filePath of filePaths) {
        const filename = this.extractFilename(filePath);
        logger.info('Processing image from dialog:', filename);

        const copiedFilePath = await fileService.copyFileToAttachments(filePath, filename);
        const size = await fileService.getFileSize(copiedFilePath);
        const base64Data = await fileService.getFileBase64(copiedFilePath);
        const mimeType = this.getMimeType(filename);

        attachments.push({
          id: generateId(),
          type: 'image',
          filename,
          content: base64Data,
          filePath: copiedFilePath,
          mimeType,
          size,
        });

        logger.info('Image from dialog processed:', filename);
      }

      return attachments;
    } catch (error) {
      logger.error('Failed to upload images from dialog:', error);
      throw error;
    }
  }

  /**
   * Open dialog and upload selected document file
   */
  async uploadFileFromDialog(): Promise<MessageAttachment | null> {
    try {
      const supportedExtensions = fileParser.getSupportedExtensions();

      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'Documents',
            extensions: supportedExtensions,
          },
        ],
      });

      if (!selected || Array.isArray(selected)) {
        return null;
      }

      const filePath = selected;
      const filename = this.extractFilename(filePath);
      logger.info('Processing file from dialog:', filename);

      const copiedFilePath = await fileService.copyFileToAttachments(filePath, filename);
      const size = await fileService.getFileSize(copiedFilePath);
      const parsedContent = await fileService.parseFileContent(copiedFilePath);
      const mimeType = this.getMimeType(filename);

      const attachment: MessageAttachment = {
        id: generateId(),
        type: 'file',
        filename,
        content: parsedContent.content,
        filePath: copiedFilePath,
        mimeType,
        size,
      };

      logger.info('File from dialog processed:', filename);
      return attachment;
    } catch (error) {
      logger.error('Failed to upload file from dialog:', error);
      throw error;
    }
  }

  // ============================================================================
  // Blob/Binary Data Uploads
  // ============================================================================

  /**
   * Upload from Blob (used by clipboard and drag-drop)
   */
  async uploadFromBlob(blob: Blob): Promise<MessageAttachment | null> {
    try {
      logger.info('📋 uploadFromBlob - Starting, blob.size:', blob.size, 'blob.type:', blob.type);

      // Convert Blob to Uint8Array
      const arrayBuffer = await blob.arrayBuffer();
      const imageData = new Uint8Array(arrayBuffer);

      const mimeType = blob.type || 'image/png';

      const { filePath, filename } = await fileService.saveClipboardImage(imageData, mimeType);
      logger.info('📋 uploadFromBlob - Saved to:', filePath);

      const size = await fileService.getFileSize(filePath);
      const base64Data = await fileService.getFileBase64(filePath);

      const attachment: MessageAttachment = {
        id: generateId(),
        type: 'image',
        filename,
        content: base64Data,
        filePath,
        mimeType,
        size,
      };

      logger.info('📋 uploadFromBlob - Created attachment:', {
        filename: attachment.filename,
        contentLength: attachment.content?.length || 0,
        mimeType: attachment.mimeType,
        size: attachment.size,
      });

      return attachment;
    } catch (error) {
      logger.error('Failed to upload from blob:', error);
      return null;
    }
  }

  /**
   * Upload from file data (optimized - no round-trip)
   */
  async uploadFromFileData(
    fileData: Uint8Array,
    mimeType: string,
    originalFileName: string
  ): Promise<MessageAttachment | null> {
    try {
      logger.info('📁 uploadFromFileData - Starting, size:', fileData.length, 'type:', mimeType);

      // Directly convert to base64 without round-trip
      const base64Data = fileService.uint8ArrayToBase64Public(fileData);

      // Save to attachments directory for persistence
      const { filePath, filename: storedName } = await fileService.saveClipboardImage(
        fileData,
        mimeType
      );
      const displayName = originalFileName || storedName;

      const attachment: MessageAttachment = {
        id: generateId(),
        type: 'image',
        filename: displayName,
        content: base64Data,
        filePath,
        mimeType,
        size: fileData.length,
      };

      logger.info('📁 uploadFromFileData - Created attachment:', {
        filename: attachment.filename,
        contentLength: attachment.content?.length || 0,
        mimeType: attachment.mimeType,
        size: attachment.size,
      });

      return attachment;
    } catch (error) {
      logger.error('Failed to upload from file data:', error);
      return null;
    }
  }

  // ============================================================================
  // Video Uploads
  // ============================================================================

  /**
   * Open dialog and upload selected video files
   */
  async uploadVideosFromDialog(): Promise<MessageAttachment[]> {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: 'Videos',
            extensions: Object.keys(this.VIDEO_MIME_TYPES),
          },
        ],
      });

      if (!selected) {
        return [];
      }

      const filePaths = Array.isArray(selected) ? selected : [selected];
      const attachments: MessageAttachment[] = [];

      for (const filePath of filePaths) {
        const filename = this.extractFilename(filePath);
        logger.info('Processing video from dialog:', filename);

        const copiedFilePath = await fileService.copyFileToAttachments(filePath, filename);
        const size = await fileService.getFileSize(copiedFilePath);

        // Validate video file
        const validation = this.validateVideoFile(filePath, size);
        if (!validation.valid) {
          logger.error('Video validation failed:', validation.error);
          throw new Error(validation.error);
        }

        const mimeType = this.getVideoMimeType(filename);

        attachments.push({
          id: generateId(),
          type: 'video',
          filename,
          content: undefined, // Video content loaded on demand
          filePath: copiedFilePath,
          mimeType,
          size,
        });

        logger.info('Video from dialog processed:', filename);
      }

      return attachments;
    } catch (error) {
      logger.error('Failed to upload videos from dialog:', error);
      throw error;
    }
  }

  /**
   * Upload videos from file paths (used by drag-and-drop)
   */
  async uploadVideosFromPaths(filePaths: string[]): Promise<MessageAttachment[]> {
    const attachments: MessageAttachment[] = [];

    for (const filePath of filePaths) {
      if (!this.isVideoFile(filePath)) {
        logger.info('Skipping non-video file:', filePath);
        continue;
      }

      try {
        const filename = this.extractFilename(filePath);
        logger.info('Processing dropped video:', filename);

        const copiedFilePath = await fileService.copyFileToAttachments(filePath, filename);
        const size = await fileService.getFileSize(copiedFilePath);

        // Validate video file
        const validation = this.validateVideoFile(filePath, size);
        if (!validation.valid) {
          logger.error('Video validation failed:', validation.error);
          continue;
        }

        const mimeType = this.getVideoMimeType(filename);

        attachments.push({
          id: generateId(),
          type: 'video',
          filename,
          content: undefined, // Video content loaded on demand
          filePath: copiedFilePath,
          mimeType,
          size,
        });

        logger.info('✅ Drag-drop video uploaded:', filename);
      } catch (error) {
        logger.error('Failed to process dropped video:', filePath, error);
      }
    }

    return attachments;
  }

  // ============================================================================
  // Clipboard Paste Handler (3-tier fallback)
  // ============================================================================

  /**
   * Handle paste event with 3-tier fallback strategy:
   * 1. Web Clipboard API (browser-based images)
   * 2. File paths from clipboard (Finder/Explorer copied files)
   * 3. Image data from clipboard (screenshots)
   */
  async handlePasteEvent(
    e: React.ClipboardEvent<HTMLTextAreaElement>
  ): Promise<MessageAttachment[]> {
    const attachments: MessageAttachment[] = [];

    // Tier 1: Web Clipboard API
    const items = e.clipboardData?.items;
    if (items) {
      logger.info(
        'Checking Web Clipboard API, items:',
        Array.from(items).map((item) => ({
          kind: item.kind,
          type: item.type,
        }))
      );

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item) continue;
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          logger.info('Found image in web clipboard:', item.type);

          const blob = item.getAsFile();
          if (blob) {
            const attachment = await this.uploadFromBlob(blob);
            if (attachment) {
              logger.info('✅ Web Clipboard - Attachment created');
              attachments.push(attachment);
              return attachments; // Success, return early
            }
          }
        }
      }
    }

    // Tier 2: File paths from clipboard
    try {
      logger.info('Checking clipboard for file paths...');
      const filePaths = await clipboard.readFiles();

      if (filePaths && filePaths.length > 0) {
        logger.info('Found file paths in clipboard:', filePaths);

        for (const filePath of filePaths) {
          if (this.isImageFile(filePath)) {
            logger.info('Processing image file:', filePath);

            const fileName = this.extractFilename(filePath);
            const fileData = await readFile(filePath);
            const mimeType = this.getMimeType(filePath);

            const attachment = await this.uploadFromFileData(fileData, mimeType, fileName);
            if (attachment) {
              logger.info('✅ File path upload successful');
              attachments.push(attachment);
            }
          }
        }

        if (attachments.length > 0) {
          return attachments; // Success, return early
        }
      }
    } catch (error) {
      logger.info('Failed to read file paths (normal if not copying files):', error);
    }

    // Tier 3: Image data from clipboard
    try {
      logger.info('Trying to read image from clipboard...');
      const hasImage = await clipboard.hasImage();

      if (hasImage) {
        logger.info('Found image in clipboard');

        const blob = (await clipboard.readImageBinary('Blob')) as Blob;
        const attachment = await this.uploadFromBlob(blob);

        if (attachment) {
          logger.info('✅ Clipboard image - Attachment created');
          attachments.push(attachment);
          return attachments; // Success
        }
      }
    } catch (error) {
      logger.info('Failed to read image (normal if not an image):', error);
    }

    logger.info('No image found in any clipboard source');
    return attachments;
  }

  // ============================================================================
  // Drag-and-Drop Handler
  // ============================================================================

  /**
   * Upload files from file paths (used by drag-and-drop)
   * Supports both images and videos
   */
  async uploadFilesFromPaths(filePaths: string[]): Promise<MessageAttachment[]> {
    const attachments: MessageAttachment[] = [];

    for (const filePath of filePaths) {
      try {
        const fileName = this.extractFilename(filePath);

        // Handle images
        if (this.isImageFile(filePath)) {
          logger.info('Processing dropped image:', fileName);

          const fileData = await readFile(filePath);
          const mimeType = this.getMimeType(filePath);

          const blob = new Blob([fileData.buffer as ArrayBuffer], { type: mimeType });
          const attachment = await this.uploadFromBlob(blob);

          if (attachment) {
            logger.info('✅ Drag-drop image uploaded:', fileName);
            attachments.push(attachment);
          }
          continue;
        }

        // Handle videos
        if (this.isVideoFile(filePath)) {
          logger.info('Processing dropped video:', fileName);

          const copiedFilePath = await fileService.copyFileToAttachments(filePath, fileName);
          const size = await fileService.getFileSize(copiedFilePath);

          // Validate video file
          const validation = this.validateVideoFile(filePath, size);
          if (!validation.valid) {
            logger.error('Video validation failed:', validation.error);
            continue;
          }

          const mimeType = this.getVideoMimeType(fileName);

          attachments.push({
            id: generateId(),
            type: 'video',
            filename: fileName,
            content: undefined, // Video content loaded on demand
            filePath: copiedFilePath,
            mimeType,
            size,
          });

          logger.info('✅ Drag-drop video uploaded:', fileName);
          continue;
        }

        logger.info('Skipping unsupported file:', filePath);
      } catch (error) {
        logger.error('Failed to process dropped file:', filePath, error);
      }
    }

    return attachments;
  }

  /**
   * Upload images from file paths (used by drag-and-drop)
   * @deprecated Use uploadFilesFromPaths instead
   */
  async uploadImagesFromPaths(filePaths: string[]): Promise<MessageAttachment[]> {
    return this.uploadFilesFromPaths(filePaths);
  }
}

// Export singleton instance
export const fileUploadService = new FileUploadService();
