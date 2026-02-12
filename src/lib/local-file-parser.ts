// src/lib/file-parser.ts
import { extractText, getDocumentProxy } from 'unpdf';
import { logger } from '@/lib/logger';

export interface ParsedFileContent {
  content: string;
  type: 'text' | 'pdf' | 'markdown';
}

export class FileParser {
  /**
   * Parse file content based on file type
   */
  async parseFile(file: File): Promise<ParsedFileContent> {
    const fileType = this.getFileType(file);

    switch (fileType) {
      case 'text':
        return await this.parseTextFile(file);
      case 'pdf':
        return await this.parsePdfFile(file);
      case 'markdown':
        return await this.parseMarkdownFile(file);
      default:
        throw new Error(`Unsupported file type: ${file.type}`);
    }
  }

  /**
   * Parse file from file path (for files already saved)
   */
  async parseFileFromPath(filePath: string, fileData: Uint8Array): Promise<ParsedFileContent> {
    const extension = this.getExtensionFromPath(filePath);
    const mimeType = this.getMimeTypeFromExtension(extension);

    // Create a File object from the data
    const file = new File([fileData.buffer as ArrayBuffer], filePath, { type: mimeType });
    return await this.parseFile(file);
  }

  private getFileType(file: File): 'text' | 'pdf' | 'markdown' {
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.md') || fileName.endsWith('.markdown')) {
      return 'markdown';
    }

    if (file.type === 'application/pdf') {
      return 'pdf';
    }

    if (
      file.type === 'text/plain' ||
      fileName.endsWith('.txt') ||
      fileName.endsWith('.log') ||
      fileName.endsWith('.csv') ||
      fileName.endsWith('.json') ||
      fileName.endsWith('.xml') ||
      fileName.endsWith('.html') ||
      fileName.endsWith('.css') ||
      fileName.endsWith('.js') ||
      fileName.endsWith('.ts') ||
      fileName.endsWith('.jsx') ||
      fileName.endsWith('.tsx') ||
      fileName.endsWith('.py') ||
      fileName.endsWith('.java') ||
      fileName.endsWith('.cpp') ||
      fileName.endsWith('.c') ||
      fileName.endsWith('.php') ||
      fileName.endsWith('.rb') ||
      fileName.endsWith('.go') ||
      fileName.endsWith('.rs') ||
      fileName.endsWith('.sh') ||
      fileName.endsWith('.yaml') ||
      fileName.endsWith('.yml')
    ) {
      return 'text';
    }

    throw new Error(`Unsupported file type: ${file.type}`);
  }

  private async parseTextFile(file: File): Promise<ParsedFileContent> {
    const content = await file.text();
    return {
      content,
      type: 'text',
    };
  }

  private async parseMarkdownFile(file: File): Promise<ParsedFileContent> {
    const content = await file.text();
    return {
      content,
      type: 'markdown',
    };
  }

  private async parsePdfFile(file: File): Promise<ParsedFileContent> {
    try {
      // Get the array buffer from the file
      const buffer = await file.arrayBuffer();

      // Load the PDF file into a PDF.js document
      const pdf = await getDocumentProxy(new Uint8Array(buffer));

      // Extract the text from the PDF file
      const { totalPages, text } = await extractText(pdf, { mergePages: true });

      logger.info(`PDF parsed successfully: ${totalPages} pages`);

      return {
        content: text.trim(),
        type: 'pdf',
      };
    } catch (error) {
      logger.error('Error parsing PDF with unpdf:', error);
      throw new Error(
        `Failed to parse PDF: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private getExtensionFromPath(filePath: string): string {
    return filePath.split('.').pop()?.toLowerCase() || '';
  }

  private getMimeTypeFromExtension(extension: string): string {
    switch (extension) {
      case 'pdf':
        return 'application/pdf';
      case 'md':
      case 'markdown':
        return 'text/markdown';
      case 'txt':
        return 'text/plain';
      case 'json':
        return 'application/json';
      case 'xml':
        return 'application/xml';
      case 'html':
        return 'text/html';
      case 'css':
        return 'text/css';
      case 'js':
        return 'application/javascript';
      case 'ts':
        return 'application/typescript';
      default:
        return 'text/plain';
    }
  }

  /**
   * Check if file is supported
   */
  isFileSupported(file: File): boolean {
    try {
      this.getFileType(file);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get supported file extensions
   */
  getSupportedExtensions(): string[] {
    return [
      'txt',
      'md',
      'markdown',
      'pdf',
      'log',
      'csv',
      'json',
      'xml',
      'html',
      'css',
      'js',
      'ts',
      'jsx',
      'tsx',
      'py',
      'java',
      'cpp',
      'c',
      'php',
      'rb',
      'go',
      'rs',
      'sh',
      'yaml',
      'yml',
    ];
  }
}

export const fileParser = new FileParser();
