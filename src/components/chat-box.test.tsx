import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  forwardRef,
  useImperativeHandle,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runningTaskIds: [] as string[],
  currentTaskId: undefined as string | undefined,
  executionState: {
    isLoading: false,
    serverStatus: '',
    error: null as string | null,
  },
  messages: [] as Array<{ id: string; role: string; content: string; timestamp: Date }>,
  stopStreaming: vi.fn(),
  deleteMessagesFromIndex: vi.fn(),
  findMessageIndex: vi.fn(() => -1),
  createSnapshot: vi.fn(),
  enqueueDraft: vi.fn(),
  tryStartNextQueuedItem: vi.fn(),
  executeCommand: vi.fn(),
  parseCommand: vi.fn(() => ({ isValid: false, command: null, rawArgs: '' })),
  addUserMessage: vi.fn(),
  deleteMessageFromService: vi.fn(),
  initialOnDelete: undefined as undefined | ((messageId: string) => Promise<void> | void),
  latestOnDelete: undefined as undefined | ((messageId: string) => Promise<void> | void),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@tauri-apps/api/path', () => ({
  dirname: vi.fn(),
}));

vi.mock('@/locales', () => ({
  getLocale: () => ({
    Chat: {
      stop: 'Stop',
      compaction: {
        dialogTitle: 'Compaction',
        compacting: 'Compacting',
        stats: {
          originalMessages: 'Original',
          compactedMessages: 'Compacted',
          reductionPercent: 'Reduction',
          compressionRatio: 'Ratio',
        },
      },
    },
    Common: { loading: 'Loading', close: 'Close' },
    Settings: { hooks: { blockedPrompt: 'blocked' } },
  }),
}));

vi.mock('@/hooks/use-execution-state', () => ({
  useExecutionState: () => mocks.executionState,
}));

vi.mock('@/hooks/use-task', () => ({
  useMessages: () => ({
    messages: mocks.messages,
    stopStreaming: mocks.stopStreaming,
    deleteMessagesFromIndex: mocks.deleteMessagesFromIndex,
    findMessageIndex: mocks.findMessageIndex,
  }),
  useRunningTaskIds: () => mocks.runningTaskIds,
}));

vi.mock('@/hooks/use-task-queue', () => ({
  useTaskQueue: () => ({
    queueHead: null,
    queueCount: 0,
  }),
}));

vi.mock('@/hooks/use-tasks', () => ({
  useTasks: () => ({
    currentTaskId: mocks.currentTaskId,
    setError: vi.fn(),
    createTask: vi.fn(),
  }),
}));

vi.mock('@/services/task-queue-service', () => ({
  taskQueueService: {
    createSnapshot: mocks.createSnapshot,
    enqueueDraft: mocks.enqueueDraft,
    tryStartNextQueuedItem: mocks.tryStartNextQueuedItem,
  },
}));

vi.mock('@/services/task-service', () => ({
  taskService: {
    startNewTask: vi.fn(),
  },
}));

vi.mock('@/services/hooks/hook-service', () => ({
  hookService: {
    runUserPromptSubmit: vi.fn(),
    applyHookSummary: vi.fn(),
  },
}));

vi.mock('@/services/execution-service', () => ({
  executionService: {
    startExecution: vi.fn(),
    stopExecution: vi.fn(),
    isRunning: vi.fn(() => false),
    getRunningTaskIds: vi.fn(() => []),
  },
}));

vi.mock('@/providers/stores/provider-store', () => ({
  modelService: {
    getCurrentModel: vi.fn(),
  },
}));

vi.mock('@/providers/core/provider-utils', () => ({
  parseModelIdentifier: vi.fn(() => ({ providerId: 'test' })),
}));

vi.mock('@/services/agents/agent-registry', () => ({
  agentRegistry: {
    getWithResolvedTools: vi.fn(),
  },
}));

vi.mock('@/services/ai/ai-prompt-enhancement-service', () => ({
  aiPromptEnhancementService: {
    enhancePrompt: vi.fn(),
  },
}));

vi.mock('@/services/commands/command-executor', () => ({
  commandExecutor: {
    parseCommand: mocks.parseCommand,
    executeCommand: mocks.executeCommand,
  },
}));

vi.mock('@/services/commands/command-registry', () => ({
  commandRegistry: {
    initialize: vi.fn(),
  },
}));

vi.mock('@/services/database-service', () => ({
  databaseService: {},
}));

vi.mock('@/services/message-service', () => ({
  messageService: {
    addUserMessage: mocks.addUserMessage,
    deleteMessage: mocks.deleteMessageFromService,
  },
}));

vi.mock('@/services/prompt/preview', () => ({
  previewSystemPrompt: vi.fn(),
}));

vi.mock('@/services/workspace-root-service', () => ({
  getEffectiveWorkspaceRoot: vi.fn(),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({
      isAuthenticated: true,
    }),
  },
}));

vi.mock('@/stores/settings-store', () => {
  const settingsState = {
    language: 'en',
    project: 'project-a',
  };

  return {
    settingsManager: {
      getAgentId: vi.fn(),
    },
    useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
  };
});

vi.mock('@/stores/worktree-store', () => ({
  useWorktreeStore: {
    getState: () => ({
      acquireForTask: vi.fn(),
    }),
  },
}));

vi.mock('./ai-elements/task', () => ({
  Task: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TaskContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TaskScrollButton: () => null,
}));

vi.mock('./chat/file-changes-summary', () => ({
  FileChangesSummary: () => null,
}));

vi.mock('./chat/message-list', () => ({
  MessageList: ({ onDelete }: { onDelete?: (messageId: string) => Promise<void> | void }) => {
    if (!mocks.initialOnDelete && onDelete) {
      mocks.initialOnDelete = onDelete;
    }
    mocks.latestOnDelete = onDelete;

    return (
      <button onClick={() => onDelete?.('message-1')} type="button">
        delete-message
      </button>
    );
  },
}));

vi.mock('./talkcody-free-login-dialog', () => ({
  TalkCodyFreeLoginDialog: () => null,
}));

vi.mock('./ui/button', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('./ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('./chat/chat-input', () => ({
  ChatInput: forwardRef(function MockChatInput(
    props: {
      onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
      onQueueSubmit?: () => void;
      onSubmit?: (event: { preventDefault: () => void }) => void;
      showQueueAction?: boolean;
    },
    ref
  ) {
    useImperativeHandle(ref, () => ({
      addFileToChat: vi.fn(),
      appendToInput: vi.fn(),
    }));

    return (
      <div>
        <button
          onClick={() => props.onInputChange({ target: { value: 'queued prompt' } } as never)}
          type="button"
        >
          set-input
        </button>
        <button
          onClick={() => props.onInputChange({ target: { value: '/import-tasks tasks.md' } } as never)}
          type="button"
        >
          set-command
        </button>
        <button onClick={() => props.onSubmit?.({ preventDefault: vi.fn() })} type="button">
          submit-input
        </button>
        {props.showQueueAction ? (
          <button onClick={() => props.onQueueSubmit?.()} type="button">
            queue-action
          </button>
        ) : (
          <span>queue-hidden</span>
        )}
      </div>
    );
  }),
}));

import { ChatBox } from './chat-box';

describe('ChatBox queue action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runningTaskIds = [];
    mocks.currentTaskId = undefined;
    mocks.executionState = {
      isLoading: false,
      serverStatus: '',
      error: null,
    };
    mocks.messages = [];
    mocks.initialOnDelete = undefined;
    mocks.latestOnDelete = undefined;
    mocks.findMessageIndex.mockReturnValue(-1);
    mocks.createSnapshot.mockResolvedValue({
      projectId: 'project-a',
      sourceTaskId: null,
      prompt: 'queued prompt',
      origin: 'composer_queue_button',
    });
    mocks.enqueueDraft.mockResolvedValue({
      id: 'draft-1',
      projectId: 'project-a',
    });
    mocks.tryStartNextQueuedItem.mockResolvedValue(null);
    mocks.parseCommand.mockReturnValue({ isValid: false, command: null, rawArgs: '' });
    mocks.executeCommand.mockResolvedValue({ success: true });
  });

  it('shows the queue action when any task is running', () => {
    mocks.runningTaskIds = ['task-running'];

    render(<ChatBox />);

    expect(screen.getByRole('button', { name: 'queue-action' })).toBeInTheDocument();
  });

  it('enqueues from the composer and immediately checks whether the queued draft can start', async () => {
    mocks.runningTaskIds = ['task-running'];

    render(<ChatBox />);

    fireEvent.click(screen.getByRole('button', { name: 'set-input' }));
    fireEvent.click(screen.getByRole('button', { name: 'queue-action' }));

    await waitFor(() => {
      expect(mocks.createSnapshot).toHaveBeenCalledWith({
        projectId: 'project-a',
        sourceTaskId: null,
        prompt: 'queued prompt',
        attachments: undefined,
        repositoryPath: undefined,
        selectedFile: undefined,
        selectedFileContent: undefined,
      });
    });
    expect(mocks.enqueueDraft).toHaveBeenCalledWith({
      projectId: 'project-a',
      sourceTaskId: null,
      prompt: 'queued prompt',
      origin: 'composer_queue_button',
    });
    expect(mocks.tryStartNextQueuedItem).toHaveBeenCalledWith('project-a');
  });

  it('routes slash commands through commandExecutor.executeCommand', async () => {
    const parsedCommand = {
      isValid: true,
      rawArgs: 'tasks.md',
      command: {
        id: 'import-tasks',
        name: 'import-tasks',
        description: 'Import tasks',
        category: 'task',
        type: 'action',
        executor: vi.fn(),
        isBuiltIn: true,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
    mocks.parseCommand.mockReturnValue(parsedCommand);

    render(<ChatBox />);

    fireEvent.click(screen.getByRole('button', { name: 'set-command' }));
    fireEvent.click(screen.getByRole('button', { name: 'submit-input' }));

    await waitFor(() => {
      expect(mocks.executeCommand).toHaveBeenCalledWith(
        parsedCommand,
        expect.objectContaining({
          taskId: undefined,
          repositoryPath: undefined,
        })
      );
    });
  });

  it('blocks delete requests while the task is still loading', async () => {
    mocks.currentTaskId = 'task-1';
    mocks.executionState = {
      isLoading: true,
      serverStatus: 'Thinking...',
      error: null,
    };

    render(<ChatBox taskId="task-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'delete-message' }));

    await waitFor(() => {
      expect(mocks.deleteMessageFromService).not.toHaveBeenCalled();
    });
  });

  it('allows a previously captured delete callback to work after stop clears loading state', async () => {
    mocks.currentTaskId = 'task-1';
    mocks.executionState = {
      isLoading: true,
      serverStatus: 'Thinking...',
      error: null,
    };

    const { rerender } = render(<ChatBox taskId="task-1" />);

    const initialOnDelete = mocks.initialOnDelete;
    expect(initialOnDelete).toBeDefined();

    mocks.executionState = {
      isLoading: false,
      serverStatus: '',
      error: null,
    };

    rerender(<ChatBox taskId="task-1" />);

    await initialOnDelete?.('message-1');

    await waitFor(() => {
      expect(mocks.deleteMessageFromService).toHaveBeenCalledWith('task-1', 'message-1');
    });
  });
});
