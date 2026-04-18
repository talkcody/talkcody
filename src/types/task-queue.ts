import type { MessageAttachment } from '@/types/agent';

export type QueuedTaskStatus = 'queued' | 'starting' | 'blocked' | 'cancelled';

export type QueuedTaskOrigin = 'composer_queue_button' | 'command';

export interface QueuedTaskDraft {
  id: string;
  projectId: string;
  sourceTaskId: string | null;
  status: QueuedTaskStatus;
  prompt: string;
  attachments: MessageAttachment[];
  createdAt: number;
  updatedAt: number;
  origin: QueuedTaskOrigin;
  queuePosition: number;
  agentId?: string;
  model?: string;
  repositoryPath?: string;
  selectedFile?: string | null;
  selectedFileContent?: string | null;
  planModeEnabled?: boolean;
  ralphLoopEnabled?: boolean;
  worktreeEnabled?: boolean;
  blockedReason?: string;
  materializedTaskId?: string;
}

export interface ProjectTaskQueueState {
  items: QueuedTaskDraft[];
  lastStartedAt?: number;
}

export interface QueueDraftSnapshot {
  projectId: string;
  sourceTaskId: string | null;
  prompt: string;
  attachments?: MessageAttachment[];
  origin?: QueuedTaskOrigin;
  agentId?: string;
  model?: string;
  repositoryPath?: string;
  selectedFile?: string | null;
  selectedFileContent?: string | null;
  planModeEnabled?: boolean;
  ralphLoopEnabled?: boolean;
  worktreeEnabled?: boolean;
}
