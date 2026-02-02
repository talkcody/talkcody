import type { Message as ModelMessage, ProviderOptions } from '@/services/llm/types';
import type { ModelType } from './model-types';
import type { OutputFormatType } from './output-format';
import type { ToolInput, ToolOutput, ToolWithUI } from './tool';

/**
 * Custom tool set type that accepts our ToolWithUI objects.
 * This is used for AgentDefinition.tools which stores ToolWithUI instances.
 * When passed to the AI SDK, these are converted appropriately.
 */
export type AgentToolSet = Record<string, ToolWithUI>;

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | ToolMessageContent[];
  timestamp: Date;
  isStreaming?: boolean;
  assistantId?: string;
  attachments?: MessageAttachment[];
  toolCallId?: string;
  toolName?: string;
  parentToolCallId?: string; // For nested tool messages - indicates this message belongs to a parent tool
  nestedTools?: UIMessage[]; // For parent tools - stores nested tool messages
  renderDoingUI?: boolean; // For tool-call messages - indicates whether UI should render "doing" state
  taskId?: string; // Task ID for tools that need to identify their execution context (e.g., exitPlanMode)
  outputFormat?: OutputFormatType; // Selected output format for assistant messages
}

export interface ToolMessageContent {
  type: 'tool-call' | 'tool-result';
  toolCallId: string;
  toolName: string;
  input?: ToolInput;
  output?: ToolOutput;
  providerMetadata?: ProviderOptions;
}

export interface MessageAttachment {
  id: string;
  type: 'image' | 'file' | 'code';
  filename: string;
  content?: string;
  filePath: string;
  mimeType: string;
  size: number;
}

export interface ConvertMessagesOptions {
  rootPath?: string;
  systemPrompt?: string;
  model?: string;
  providerId?: string;
}

export interface AgentLoopOptions {
  messages: UIMessage[];
  model: string;
  systemPrompt?: string;
  tools?: AgentToolSet;
  isThink?: boolean;
  isSubagent?: boolean;
  suppressReasoning?: boolean;
  maxIterations?: number;
  compression?: Partial<CompressionConfig>;
  agentId?: string; // Agent identifier for special handling (e.g., image-generator)
  freshContext?: boolean; // Skip cached compaction and compression for fresh-context loops
}

export interface AgentLoopState {
  messages: ModelMessage[];
  currentIteration: number;
  isComplete: boolean;
  lastFinishReason?: string;
  lastRequestTokens: number; // Total tokens from the last AI request (not cumulative)
  unknownFinishReasonCount?: number; // Counter for unknown finish reasons to prevent infinite loops
  rawChunks?: unknown[]; // Raw chunks from provider for debugging
  hasSkillScripts?: boolean; // Flag to track if skills with scripts have been loaded
}

export interface AgentLoopCallbacks {
  onChunk: (chunk: string) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
  onStatus?: (status: string) => void;
  onToolMessage?: (message: UIMessage) => void;
  onAssistantMessageStart?: () => void;
  onAttachment?: (attachment: MessageAttachment) => void;
  onStepFinish?: (result: AgentLoopState) => void | Promise<void>;
  onToolCall?: (toolName: string, args: ToolInput) => void | Promise<void>;
  onToolResult?: (toolName: string, result: ToolOutput) => void | Promise<void>;
}

// Message compression types
export interface CompressionConfig {
  enabled: boolean;
  preserveRecentMessages: number;
  compressionModel: string;
  compressionThreshold: number; // 0.0 to 1.0, percentage of context window
}

export interface CompressionSection {
  title: string;
  content: string;
}

export interface CompressionResult {
  compressedSummary: string;
  sections: CompressionSection[];
  preservedMessages: ModelMessage[];
  originalMessageCount: number;
  compressedMessageCount: number;
  compressionRatio: number;
}

export interface MessageCompactionOptions {
  messages: ModelMessage[];
  config: CompressionConfig;
  systemPrompt?: string;
}

export type DynamicPromptConfig = {
  enabled: boolean;
  providers: string[];
  variables: Record<string, string>;
  providerSettings?: Record<string, unknown>;
};

/**
 * Agent role classification based on primary function
 */
export type AgentRole =
  | 'read' // Primarily reads and analyzes existing content
  | 'write'; // Primarily creates, edits, or deletes content (includes mixed operations)

/**
 * Execution phase types for better semantic naming
 */
export type ExecutionPhase =
  | 'read-stage' // Information gathering phase
  | 'write-edit-stage'; // Content modification phase

export interface AgentDefinition {
  id: string;
  name: string;
  description?: string;
  modelType: ModelType; // Model type category (main_model, small_model, etc.)
  systemPrompt: string | (() => Promise<string>) | (() => string);
  tools?: AgentToolSet;
  hidden?: boolean; // if true, not shown to users
  rules?: string;
  outputFormat?: string;
  isDefault?: boolean; // if true, it's a system default agent (loaded from code, not persisted to database)
  version?: string; // version number for system agents (e.g., "2.1.0")
  dynamicPrompt?: DynamicPromptConfig;
  defaultSkills?: string[]; // array of skill IDs
  isBeta?: boolean; // if true, show beta badge in UI
  role?: AgentRole; // Primary function classification for dependency analysis
  canBeSubagent?: boolean; // if false, cannot be called via callAgent. Default: true
}
