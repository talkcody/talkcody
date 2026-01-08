import { Circle, Copy, FileText, MessageSquarePlus, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { getRelativePath } from '@/services/repository-utils';
import type { OpenFile } from '@/types/file-system';

interface FileTabsProps {
  openFiles: OpenFile[];
  activeFileIndex: number;
  onTabSelect: (index: number) => void;
  onTabClose: (index: number) => void;
  onCloseOthers?: (keepIndex: number) => void;
  onCloseAll?: () => void;
  onCopyPath?: (filePath: string) => void;
  onCopyRelativePath?: (filePath: string, rootPath: string) => void;
  onAddFileToChat?: (filePath: string, fileContent: string) => Promise<void>;
  rootPath?: string;
}

export function FileTabs({
  openFiles,
  activeFileIndex,
  onTabSelect,
  onTabClose,
  onCloseOthers,
  onCloseAll,
  onCopyPath,
  onCopyRelativePath,
  onAddFileToChat,
  rootPath,
}: FileTabsProps) {
  const [_contextMenuTabIndex, setContextMenuTabIndex] = useState<number | null>(null);
  const tabRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    const activeTab = tabRefs.current.get(activeFileIndex);
    if (activeTab) {
      activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [activeFileIndex]);

  if (openFiles.length === 0) {
    return null;
  }

  const getFileName = (path: string) => {
    // Handle both Windows and Unix paths
    return path.split(/[/\\]/).pop() || path;
  };

  const handleTabClick = (index: number, event: React.MouseEvent) => {
    event.preventDefault();
    onTabSelect(index);
  };

  const handleCloseClick = (index: number, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onTabClose(index);
  };

  const handleMiddleClick = (index: number, event: React.MouseEvent) => {
    if (event.button === 1) {
      // Middle mouse button
      event.preventDefault();
      onTabClose(index);
    }
  };

  const handleContextMenuClose = (index: number) => {
    onTabClose(index);
    setContextMenuTabIndex(null);
  };

  const handleContextMenuCloseOthers = (keepIndex: number) => {
    if (onCloseOthers) {
      onCloseOthers(keepIndex);
    }
    setContextMenuTabIndex(null);
  };

  const handleContextMenuCloseAll = () => {
    if (onCloseAll) {
      onCloseAll();
    }
    setContextMenuTabIndex(null);
  };

  const handleCopyPath = (filePath: string) => {
    if (onCopyPath) {
      onCopyPath(filePath);
    } else {
      navigator.clipboard.writeText(filePath);
      toast.success('Path copied to clipboard');
    }
    setContextMenuTabIndex(null);
  };

  const handleCopyRelativePath = (filePath: string) => {
    if (onCopyRelativePath && rootPath) {
      onCopyRelativePath(filePath, rootPath);
    } else if (rootPath) {
      const relativePath = getRelativePath(filePath, rootPath);
      navigator.clipboard.writeText(relativePath);
      toast.success('Relative path copied to clipboard');
    }
    setContextMenuTabIndex(null);
  };

  const handleAddFileToChat = async (filePath: string, fileContent: string | null) => {
    if (onAddFileToChat && fileContent) {
      try {
        await onAddFileToChat(filePath, fileContent);
        toast.success('File added to chat');
      } catch (_error) {
        toast.error('Failed to add file to chat');
      }
    }
    setContextMenuTabIndex(null);
  };

  const canCloseOthers = openFiles.length > 1;
  const canCloseAll = openFiles.length > 0;

  return (
    <div className="flex-shrink-0 border-b bg-gray-50 dark:bg-gray-900">
      <div className="scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600 flex overflow-x-auto">
        {openFiles.map((file, index) => {
          const isActive = index === activeFileIndex;
          const fileName = getFileName(file.path);
          const hasUnsavedChanges = file.hasUnsavedChanges;

          return (
            <ContextMenu key={file.path}>
              <ContextMenuTrigger asChild>
                <div
                  ref={(el) => {
                    if (el) {
                      tabRefs.current.set(index, el);
                    } else {
                      tabRefs.current.delete(index);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    'group flex cursor-pointer select-none items-center border-gray-200 border-r dark:border-gray-700',
                    isActive
                      ? 'border-b-0 bg-white dark:bg-gray-950'
                      : 'bg-gray-50 hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-800'
                  )}
                  onClick={(e) => handleTabClick(index, e)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleTabClick(index, e as unknown as React.MouseEvent);
                    }
                  }}
                  onMouseDown={(e) => handleMiddleClick(index, e)}
                  onContextMenu={() => setContextMenuTabIndex(index)}
                  title={file.path}
                >
                  <div className="flex min-w-0 flex-1 items-center px-3 py-2">
                    <FileText className="mr-2 h-4 w-4 flex-shrink-0 text-gray-500 dark:text-gray-400" />
                    <span className="whitespace-nowrap text-sm">{fileName}</span>
                    {hasUnsavedChanges && (
                      <Circle className="ml-1 h-2 w-2 flex-shrink-0 fill-blue-500 text-blue-500" />
                    )}
                  </div>
                  <Button
                    className={cn(
                      'mr-1 h-6 w-6 p-0 opacity-0 transition-opacity group-hover:opacity-100',
                      isActive && 'opacity-100'
                    )}
                    onClick={(e) => handleCloseClick(index, e)}
                    size="sm"
                    variant="ghost"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-48">
                <ContextMenuItem
                  onClick={() => handleContextMenuClose(index)}
                  className="cursor-pointer"
                >
                  Close
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => handleContextMenuCloseOthers(index)}
                  disabled={!canCloseOthers}
                  className="cursor-pointer"
                >
                  Close Others
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={handleContextMenuCloseAll}
                  disabled={!canCloseAll}
                  className="cursor-pointer"
                >
                  Close All
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onClick={() => handleCopyPath(file.path)}
                  className="cursor-pointer"
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copy Path
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => handleCopyRelativePath(file.path)}
                  disabled={!rootPath}
                  className="cursor-pointer"
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copy Relative Path
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onClick={() => handleAddFileToChat(file.path, file.content)}
                  disabled={!file.content || !onAddFileToChat}
                  className="cursor-pointer"
                >
                  <MessageSquarePlus className="mr-2 h-4 w-4" />
                  Add to Chat
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
    </div>
  );
}
