// src/components/chat/file-preview.tsx
import { convertFileSrc } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { Download, FileText, Image, X } from 'lucide-react';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { logger } from '@/lib/logger';
import { getLocale, type SupportedLocale } from '@/locales';
import { useSettingsStore } from '@/stores/settings-store';
import type { MessageAttachment } from '@/types/agent';

interface FilePreviewProps {
  attachment: MessageAttachment;
  onRemove?: () => void;
  showRemove?: boolean;
}

export function FilePreview({ attachment, onRemove, showRemove = true }: FilePreviewProps) {
  const language = useSettingsStore((state) => state.language);
  const t = useMemo(() => getLocale((language || 'en') as SupportedLocale), [language]);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return Image;
    if (mimeType.includes('pdf')) return FileText;
    if (mimeType.includes('text')) return FileText;
    if (mimeType.includes('document') || mimeType.includes('word')) return FileText;
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return FileText;
    return FileText; // Default icon
  };

  // Get image source - support both base64 content and file path
  const getImageSrc = (): string | null => {
    if (attachment.content) {
      return `data:${attachment.mimeType};base64,${attachment.content}`;
    }
    if (attachment.filePath) {
      return convertFileSrc(attachment.filePath);
    }
    return null;
  };

  const handleDownload = async () => {
    try {
      // Use save dialog to let user choose save location
      const savePath = await save({
        defaultPath: attachment.filename,
        filters: [
          {
            name: 'Images',
            extensions: [attachment.filename.split('.').pop() || 'png'],
          },
        ],
      });

      if (!savePath) {
        return; // User cancelled
      }

      // Get image data based on source
      let imageData: Uint8Array;
      if (attachment.content) {
        // base64 content -> Uint8Array
        const binaryString = atob(attachment.content);
        imageData = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          imageData[i] = binaryString.charCodeAt(i);
        }
      } else if (attachment.filePath) {
        // Read from file path
        imageData = await readFile(attachment.filePath);
      } else {
        logger.error('No image data available for download');
        toast.error(t.Error.generic);
        return;
      }

      // Write file
      await writeFile(savePath, imageData);
      logger.info('Image downloaded successfully:', savePath);
      toast.success(t.Toast.success.saved);
    } catch (error) {
      logger.error('Failed to download image:', error);
      toast.error(t.Error.generic);
    }
  };

  if (attachment.type === 'image') {
    const imageSrc = getImageSrc();
    if (!imageSrc) {
      // Fallback to file preview if no image source available
      return null;
    }

    return (
      <div className="relative inline-block">
        {/* Image with click to enlarge */}
        <Dialog>
          <DialogTrigger asChild>
            <div className="relative overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 cursor-pointer hover:opacity-90 transition-opacity">
              <img
                alt={attachment.filename}
                className="max-h-48 max-w-xs object-contain"
                src={imageSrc}
                onError={(e) => logger.error('Image failed to load:', attachment.filename, e)}
              />
              {showRemove && onRemove && (
                <Button
                  className="absolute top-1 right-1 h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                  }}
                  size="icon"
                  type="button"
                  variant="destructive"
                >
                  <X size={12} />
                </Button>
              )}
            </div>
          </DialogTrigger>
          <DialogContent className="max-w-fit min-w-4/5">
            <DialogHeader>
              <DialogTitle>{attachment.filename}</DialogTitle>
            </DialogHeader>
            <div className="flex justify-center">
              <img
                src={imageSrc}
                alt={attachment.filename}
                className="max-w-full max-h-[70vh] object-contain rounded-lg"
              />
            </div>
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="size-4 mr-1" />
                {t.Common.download}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Filename and size with action buttons */}
        <div className="mt-1 flex items-center gap-2">
          <span className="max-w-xs truncate text-gray-500 dark:text-gray-400 text-xs">
            {attachment.filename} ({formatFileSize(attachment.size)})
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={handleDownload}
            title={t.Common.download}
          >
            <Download className="size-3" />
          </Button>
        </div>
      </div>
    );
  }

  // File preview
  const FileIcon = getFileIcon(attachment.mimeType);

  return (
    <div className="relative inline-block">
      <div className="relative flex min-w-[200px] max-w-xs items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3">
        <div className="flex-shrink-0">
          <FileIcon className="text-gray-600 dark:text-gray-400" size={24} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-gray-900 dark:text-white text-sm">
            {attachment.filename}
          </div>
          <div className="text-gray-500 dark:text-gray-400 text-xs">
            {formatFileSize(attachment.size)}
          </div>
        </div>
        {showRemove && onRemove && (
          <Button
            className="absolute right-1 bottom-1 h-6 w-6 hover:bg-red-100 dark:hover:bg-red-900/20"
            onClick={onRemove}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X className="text-red-600 dark:text-red-400" size={12} />
          </Button>
        )}
      </div>
    </div>
  );
}
