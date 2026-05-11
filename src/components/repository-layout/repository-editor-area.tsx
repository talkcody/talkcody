import { Maximize2, Minimize2 } from 'lucide-react';
import type React from 'react';
import { memo } from 'react';
import { FileEditor } from '@/components/file-editor';
import { FileTabs } from '@/components/file-tabs';
import { TerminalPanel } from '@/components/terminal/terminal-panel';
import { Button } from '@/components/ui/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/hooks/use-locale';
import type { OpenFile } from '@/types/file-system';

interface RepositoryEditorAreaProps {
  editorAreaPanelId: string;
  fileEditorPanelId: string;
  terminalPanelId: string;
  showChatPanel: boolean;
  showEditor: boolean;
  showTerminal: boolean;
  hasOpenFiles: boolean;
  isEditorFullscreen: boolean;
  isTerminalFullscreen: boolean;
  openFiles: OpenFile[];
  activeFileIndex: number;
  currentFile: OpenFile | null | undefined;
  rootPath: string | null;
  onTabClose: (index: number) => void;
  onCloseOthers: (keepIndex: number) => void;
  onCloseAll: () => void;
  onCopyPath: (filePath: string) => void;
  onCopyRelativePath: (filePath: string, rootPath: string) => void;
  onAddFileToChat: (filePath: string, fileContent: string) => Promise<void>;
  onTabSelect: (index: number) => void;
  onContentChange: (content: string) => void;
  onToggleContentSearch: () => void;
  onToggleEditorFullscreen: () => void;
  onCopyTerminalToChat: (content: string) => void;
  onCloseTerminal: () => void;
  onToggleTerminalFullscreen: () => void;
}

export const RepositoryEditorArea = memo(function RepositoryEditorArea({
  editorAreaPanelId,
  fileEditorPanelId,
  terminalPanelId,
  showChatPanel,
  showEditor,
  showTerminal,
  hasOpenFiles,
  isEditorFullscreen,
  isTerminalFullscreen,
  openFiles,
  activeFileIndex,
  currentFile,
  rootPath,
  onTabClose,
  onCloseOthers,
  onCloseAll,
  onCopyPath,
  onCopyRelativePath,
  onAddFileToChat,
  onTabSelect,
  onContentChange,
  onToggleContentSearch,
  onToggleEditorFullscreen,
  onCopyTerminalToChat,
  onCloseTerminal,
  onToggleTerminalFullscreen,
}: RepositoryEditorAreaProps) {
  const t = useTranslation();

  return (
    <>
      <ResizablePanel
        id={editorAreaPanelId}
        order={2}
        className={showChatPanel ? 'border-r' : ''}
        defaultSize={isEditorFullscreen || isTerminalFullscreen ? '100%' : '40%'}
        minSize={'20%'}
        maxSize={'100%'}
      >
        <ResizablePanelGroup direction="vertical">
          {hasOpenFiles && showEditor && (
            <>
              <ResizablePanel
                id={fileEditorPanelId}
                order={1}
                defaultSize={isEditorFullscreen ? '100%' : showTerminal ? '60%' : '100%'}
                minSize={'20%'}
              >
                <div className="flex h-full flex-col">
                  <div className="flex items-center border-b">
                    <div className="flex-1 overflow-hidden">
                      <FileTabs
                        activeFileIndex={activeFileIndex}
                        onTabClose={onTabClose}
                        onCloseOthers={onCloseOthers}
                        onCloseAll={onCloseAll}
                        onCopyPath={onCopyPath}
                        onCopyRelativePath={onCopyRelativePath}
                        onAddFileToChat={onAddFileToChat}
                        onTabSelect={onTabSelect}
                        openFiles={openFiles}
                        rootPath={rootPath ?? undefined}
                      />
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 mr-1"
                          onClick={onToggleEditorFullscreen}
                        >
                          {isEditorFullscreen ? (
                            <Minimize2 className="h-3.5 w-3.5" />
                          ) : (
                            <Maximize2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        {isEditorFullscreen
                          ? t.RepositoryLayout.exitFullscreen
                          : t.RepositoryLayout.fullscreen}
                      </TooltipContent>
                    </Tooltip>
                  </div>

                  <div className="flex-1 overflow-auto">
                    <FileEditor
                      error={currentFile?.error || null}
                      fileContent={currentFile?.content || null}
                      filePath={currentFile?.path || null}
                      hasUnsavedChanges={currentFile?.hasUnsavedChanges}
                      isLoading={currentFile?.isLoading ?? false}
                      lineNumber={currentFile?.lineNumber}
                      onContentChange={onContentChange}
                      onGlobalSearch={onToggleContentSearch}
                    />
                  </div>
                </div>
              </ResizablePanel>

              {showTerminal && <ResizableHandle withHandle />}
            </>
          )}

          {showTerminal && (
            <ResizablePanel
              id={terminalPanelId}
              order={2}
              defaultSize={
                isTerminalFullscreen ? '100%' : hasOpenFiles && showEditor ? '40%' : '100%'
              }
              minSize={'15%'}
              maxSize={'100%'}
            >
              <TerminalPanel
                onCopyToChat={onCopyTerminalToChat}
                onClose={onCloseTerminal}
                onToggleFullscreen={onToggleTerminalFullscreen}
                isFullscreen={isTerminalFullscreen}
              />
            </ResizablePanel>
          )}
        </ResizablePanelGroup>
      </ResizablePanel>

      {showChatPanel && <ResizableHandle withHandle />}
    </>
  );
});
