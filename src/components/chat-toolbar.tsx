import { ArrowDown, ArrowUp, FileSearch, Plus, Search, SquareTerminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/hooks/use-locale';
import {
  formatCost,
  formatTokens,
  getContextUsageBgColor,
  getContextUsageColor,
  useToolbarState,
} from '@/hooks/use-toolbar-state';
import { useExecutionStore } from '@/stores/execution-store';
import { ChatHistory } from './chat-history';
import { ProjectDropdown } from './project-dropdown';

interface ChatToolbarProps {
  currentTaskId?: string;
  onSettingsOpen?: () => void;
  isHistoryOpen: boolean;
  onHistoryOpenChange: (open: boolean) => void;
  onTaskSelect: (taskId: string) => void;
  onNewChat: () => void;
  // Project selector props
  currentProjectId?: string | null;
  onProjectSelect?: (projectId: string) => Promise<void>;
  onImportRepository?: () => Promise<void>;
  isLoadingProject?: boolean;
  rootPath?: string;
  isTerminalVisible?: boolean;
  onToggleTerminal?: () => void;
  // Search props
  onOpenFileSearch?: () => void;
  onOpenContentSearch?: () => void;
}

export function ChatToolbar({
  currentTaskId,
  isHistoryOpen,
  onSettingsOpen: _onSettingsOpen,
  onHistoryOpenChange,
  onTaskSelect,
  onNewChat,
  currentProjectId,
  onProjectSelect,
  onImportRepository,
  isLoadingProject,
  isTerminalVisible,
  onToggleTerminal,
  onOpenFileSearch,
  onOpenContentSearch,
}: ChatToolbarProps) {
  const t = useTranslation();
  const isMaxReached = useExecutionStore((state) => state.isMaxReached());
  const { modelName, cost, inputTokens, outputTokens, contextUsage } = useToolbarState();

  return (
    <div className="flex flex-shrink-0 items-center justify-between border-b bg-gray-50 px-3 py-2 dark:bg-gray-900">
      {/* Left: Project Dropdown */}
      <div className="flex min-w-0 flex-1 items-center">
        {onProjectSelect && onImportRepository && (
          <ProjectDropdown
            currentProjectId={currentProjectId || null}
            onProjectSelect={onProjectSelect}
            onImportRepository={onImportRepository}
            isLoading={isLoadingProject || false}
          />
        )}
      </div>

      {/* Center: Model, Plan Mode, Cost/Tokens */}
      <div className="flex items-center justify-center gap-3">
        {modelName && (
          <div className="flex items-center gap-1.5 rounded-md bg-blue-100 px-2 py-1 dark:bg-blue-900/30">
            <span className="font-medium text-blue-700 text-xs dark:text-blue-300">
              {t.Chat.toolbar.model}:
            </span>
            <span className="font-medium text-blue-900 text-xs dark:text-blue-100">
              {modelName}
            </span>
          </div>
        )}

        {(cost > 0 || inputTokens > 0 || outputTokens > 0) && (
          <div className="flex items-center gap-1.5 rounded-md bg-emerald-100 px-2 py-1 dark:bg-emerald-900/30">
            <span className="font-medium text-emerald-700 text-xs dark:text-emerald-300">
              {formatCost(cost)}
            </span>
            <span className="flex items-center text-emerald-600 text-xs dark:text-emerald-400">
              <ArrowUp className="h-3 w-3" />
              {formatTokens(inputTokens)} {t.Chat.toolbar.inputTokens}
            </span>
            <span className="flex items-center text-emerald-600 text-xs dark:text-emerald-400">
              <ArrowDown className="h-3 w-3" />
              {formatTokens(outputTokens)} {t.Chat.toolbar.outputTokens}
            </span>
          </div>
        )}

        {contextUsage > 0 && (
          <div
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 ${getContextUsageBgColor(contextUsage)}`}
          >
            <span className={`font-medium text-xs ${getContextUsageColor(contextUsage)}`}>
              Context: {contextUsage.toFixed(0)}%
            </span>
          </div>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
        {/* Search buttons */}
        {onOpenFileSearch && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="h-6 w-6 p-0 hover:bg-gray-200 dark:hover:bg-gray-700"
                onClick={onOpenFileSearch}
                size="sm"
                variant="ghost"
              >
                <FileSearch className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t.Chat.toolbar.searchFiles}</p>
            </TooltipContent>
          </Tooltip>
        )}
        {onOpenContentSearch && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="h-6 w-6 p-0 hover:bg-gray-200 dark:hover:bg-gray-700"
                onClick={onOpenContentSearch}
                size="sm"
                variant="ghost"
              >
                <Search className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t.Chat.toolbar.searchContent}</p>
            </TooltipContent>
          </Tooltip>
        )}
        {onToggleTerminal && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className={`h-6 w-6 p-0 hover:bg-gray-200 dark:hover:bg-gray-700 ${
                  isTerminalVisible ? 'bg-gray-200 dark:bg-gray-700' : ''
                }`}
                onClick={onToggleTerminal}
                size="sm"
                variant="ghost"
              >
                <SquareTerminal className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t.Chat.toolbar.toggleTerminal}</p>
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="h-6 w-6 p-0 hover:bg-gray-200 dark:hover:bg-gray-700"
              disabled={isMaxReached}
              onClick={onNewChat}
              size="sm"
              title={isMaxReached ? 'Maximum concurrent tasks reached' : undefined}
              variant="ghost"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t.Chat.newChat}</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <ChatHistory
                currentTaskId={currentTaskId}
                isOpen={isHistoryOpen}
                onTaskSelect={onTaskSelect}
                onNewChat={onNewChat}
                onOpenChange={onHistoryOpenChange}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t.Chat.chatHistory}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
