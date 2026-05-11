import { useTranslation } from '@/hooks/use-locale';
import { projectIndexer } from '@/services/project-indexer';
import { repositoryService } from '@/services/repository-service';
import { getRelativePath } from '@/services/repository-utils';
import { useRepositoryStore } from '@/stores/window-scoped-repository-store';
import type { AICompletionState } from '@/types/file-editor';
import { formatLastSavedTime } from '@/utils/monaco-utils';

interface FileEditorHeaderProps {
  filePath: string;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  isAICompleting: boolean;
  currentAICompletion: AICompletionState | null;
  lastSavedTime: Date | null;
}

export function FileEditorHeader({
  filePath,
  hasUnsavedChanges,
  isSaving,
  isAICompleting,
  currentAICompletion,
  lastSavedTime,
}: FileEditorHeaderProps) {
  const t = useTranslation();
  const fileName = repositoryService.getFileNameFromPath(filePath);
  const language = repositoryService.getLanguageFromExtension(fileName);
  // Subscribe to indexed state from store for automatic re-renders
  const isIndexed = useRepositoryStore((state) => state.indexedFiles.has(filePath));
  const rootPath = useRepositoryStore((state) => state.rootPath);
  const isIndexable = projectIndexer.isSupported(language);

  // Display relative path if rootPath is available, otherwise show file name
  const displayPath = rootPath ? getRelativePath(filePath, rootPath) : fileName;

  return (
    <div className="flex h-[42px] flex-shrink-0 items-center border-b bg-gray-50 px-3 dark:bg-gray-900">
      <div className="flex min-w-0 flex-1 items-center justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex items-center gap-2 truncate font-medium text-sm" title={filePath}>
            {displayPath}
          </div>
          {hasUnsavedChanges && (
            <span className="flex flex-shrink-0 items-center gap-1">
              <span
                className="h-2 w-2 animate-pulse rounded-full bg-orange-500"
                title={t.FileEditor.autoSaving}
              />
              {isSaving && <span className="text-gray-500 text-xs">{t.FileEditor.saving}</span>}
            </span>
          )}
          {isAICompleting && (
            <span className="flex flex-shrink-0 items-center gap-1">
              <span className="text-blue-500 text-xs">{t.FileEditor.aiAnalyzing}</span>
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            </span>
          )}
          {currentAICompletion && (
            <span className="flex-shrink-0 rounded bg-green-100 px-2 py-0.5 text-green-600 text-xs dark:bg-green-900 dark:text-green-400">
              {t.FileEditor.aiSuggestion}
            </span>
          )}
          {lastSavedTime && !hasUnsavedChanges && (
            <span className="flex-shrink-0 text-green-600 text-xs dark:text-green-400">
              {t.FileEditor.savedAt(formatLastSavedTime(lastSavedTime))}
            </span>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="rounded bg-gray-200 px-2 py-0.5 text-xs dark:bg-gray-700">
            {language}
          </span>
          {isIndexable && (
            <span
              className={`rounded px-2 py-0.5 text-xs ${
                isIndexed
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
              }`}
              title={isIndexed ? t.FileEditor.codeNavigationEnabled : t.FileEditor.notIndexedYet}
            >
              {isIndexed ? t.FileEditor.indexed : t.FileEditor.notIndexed}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
