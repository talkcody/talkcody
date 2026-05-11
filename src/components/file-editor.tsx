import type { Monaco } from '@monaco-editor/react';
import type { editor as monacoEditor } from 'monaco-editor';
import React from 'react';
import { useAICompletion } from '@/hooks/use-ai-completion';
import { useFileEditorState } from '@/hooks/use-file-editor-state';
import { useGitGutter } from '@/hooks/use-git-gutter';
import { useLsp } from '@/hooks/use-lsp';
import { useMonacoEditor } from '@/hooks/use-monaco-editor';
import { logger } from '@/lib/logger';
import { useRepositoryStore } from '@/stores/window-scoped-repository-store';
import type { FileEditorProps } from '@/types/file-editor';
import { FileEditorContent } from './file-editor/file-editor-content';
import { FileEditorEmptyState } from './file-editor/file-editor-empty-state';
import { FileEditorErrorState } from './file-editor/file-editor-error-state';
import { FileEditorHeader } from './file-editor/file-editor-header';
import { FileEditorLoadingState } from './file-editor/file-editor-loading-state';

export function FileEditor({
  filePath,
  fileContent,
  error,
  isLoading,
  hasUnsavedChanges: propHasUnsavedChanges,
  onContentChange,
  onFileSaved,
  lineNumber,
  onGlobalSearch,
}: FileEditorProps) {
  // Repository state
  const rootPath = useRepositoryStore((state) => state.rootPath);
  const selectFile = useRepositoryStore((state) => state.selectFile);

  // Handle cross-file navigation from Monaco editor
  const handleOpenFile = React.useCallback(
    (targetFilePath: string, targetLineNumber?: number) => {
      logger.debug('Cross-file navigation:', targetFilePath, targetLineNumber);
      selectFile(targetFilePath, targetLineNumber);
    },
    [selectFile]
  );

  // Editor state for Git gutter and LSP (using state instead of ref to trigger re-renders)
  const [editor, setEditor] = React.useState<monacoEditor.IStandaloneCodeEditor | null>(null);

  // AI completion logic
  const {
    isAICompleting,
    currentAICompletion,
    getCurrentCompletionState,
    clearAICompletion,
    requestAICompletion,
    acceptAICompletion,
    dismissAICompletion,
    shouldClearCompletion,
    cleanup: cleanupAI,
  } = useAICompletion(filePath);

  // File editor state
  const {
    currentContent,
    hasUnsavedChanges,
    isSaving,
    lastSavedTime,
    isUserTyping,
    handleContentChange: _handleContentChange,
    setUserAction,
    handleContentChangeWithCallback,
    saveFileInternal,
    cleanup: cleanupState,
  } = useFileEditorState({
    filePath,
    fileContent,
    onFileSaved,
    isAICompleting,
    currentAICompletion,
    onContentChange,
  });

  // LSP integration for type checking and language features
  const {
    isConnected: isLspConnected,
    openDocument,
    updateDocument,
    closeDocument,
  } = useLsp({
    editor,
    filePath,
    rootPath,
    enabled: true, // LSP is enabled by default
  });

  // Open document in LSP when editor mounts and content is available
  React.useEffect(() => {
    if (isLspConnected && editor && fileContent !== null && filePath) {
      openDocument(fileContent).catch((e) => {
        logger.debug('[LSP] Failed to open document:', e);
      });
    }
  }, [isLspConnected, editor, fileContent, filePath, openDocument]);

  // Update document in LSP when content changes (debounced)
  const updateDocumentTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (isLspConnected && currentContent !== null) {
      // Clear previous timeout
      if (updateDocumentTimeoutRef.current) {
        clearTimeout(updateDocumentTimeoutRef.current);
      }
      // Debounce updates to avoid overwhelming the LSP server
      updateDocumentTimeoutRef.current = setTimeout(() => {
        updateDocument(currentContent).catch((e) => {
          logger.debug('[LSP] Failed to update document:', e);
        });
      }, 300); // 300ms debounce
    }
    return () => {
      if (updateDocumentTimeoutRef.current) {
        clearTimeout(updateDocumentTimeoutRef.current);
      }
    };
  }, [isLspConnected, currentContent, updateDocument]);

  // Close document when file changes or component unmounts
  React.useEffect(() => {
    return () => {
      if (isLspConnected) {
        closeDocument().catch(() => {});
      }
    };
  }, [isLspConnected, closeDocument]);

  // Monaco editor setup
  const { handleEditorDidMount } = useMonacoEditor({
    filePath,
    fileContent,
    lineNumber,
    getCurrentCompletionState,
    clearAICompletion,
    requestAICompletion,
    acceptAICompletion,
    dismissAICompletion,
    shouldClearCompletion,
    setUserAction,
    isUserTyping,
    isAICompleting,
    onGlobalSearch,
    onOpenFile: handleOpenFile,
  });

  // Git gutter indicators (will run when editor state changes)
  useGitGutter(editor, filePath, rootPath);

  // Wrap handleEditorDidMount to capture editor in state
  const handleEditorDidMountWithGit = React.useCallback(
    (editorInstance: monacoEditor.IStandaloneCodeEditor, monaco: Monaco) => {
      setEditor(editorInstance);
      handleEditorDidMount(editorInstance, monaco);
    },
    [handleEditorDidMount]
  );

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      cleanupAI();
      cleanupState();
    };
  }, [cleanupAI, cleanupState]);

  // Handle different states
  if (!filePath) {
    return <FileEditorEmptyState />;
  }

  if (isLoading) {
    return <FileEditorLoadingState />;
  }

  if (error) {
    return <FileEditorErrorState error={error} />;
  }
  const displayHasUnsavedChanges =
    propHasUnsavedChanges !== undefined ? propHasUnsavedChanges : hasUnsavedChanges;

  return (
    <div className="flex h-full flex-1 flex-col">
      <FileEditorHeader
        currentAICompletion={currentAICompletion}
        filePath={filePath}
        hasUnsavedChanges={displayHasUnsavedChanges}
        isAICompleting={isAICompleting}
        isSaving={isSaving}
        lastSavedTime={lastSavedTime}
      />

      <FileEditorContent
        currentContent={currentContent}
        filePath={filePath}
        onContentChange={handleContentChangeWithCallback}
        onEditorDidMount={handleEditorDidMountWithGit}
        onSave={() => saveFileInternal(filePath, currentContent)}
      />
    </div>
  );
}
