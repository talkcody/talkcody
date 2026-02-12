export type ProviderOptions = Record<string, unknown> | null;

export type MessageContent = string | ContentPart[];

export type Message =
  | {
      role: 'system';
      content: string;
      providerOptions?: ProviderOptions;
    }
  | {
      role: 'user';
      content: MessageContent;
      providerOptions?: ProviderOptions;
    }
  | {
      role: 'assistant';
      content: MessageContent;
      providerOptions?: ProviderOptions;
    }
  | {
      role: 'tool';
      content: ContentPart[];
      providerOptions?: ProviderOptions;
    };

export type ContentPart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'image';
      image: string;
    }
  | {
      type: 'video';
      video: string;
      mimeType?: string;
    }
  | {
      type: 'tool-call';
      toolCallId: string;
      toolName: string;
      input: unknown;
      providerMetadata?: ProviderOptions;
    }
  | {
      type: 'tool-result';
      toolCallId: string;
      toolName: string;
      output: unknown;
    }
  | {
      type: 'reasoning';
      text: string;
      providerOptions?: ProviderOptions;
    };

export type ToolDefinition = {
  type: 'function';
  name: string;
  description?: string | null;
  parameters: unknown;
  strict: true;
};

export type TraceContext = {
  traceId: string;
  spanName: string;
  parentSpanId: string | null;
  metadata?: Record<string, string>;
};

export type StreamTextRequest = {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[] | null;
  stream?: boolean | null;
  temperature?: number | null;
  maxTokens?: number | null;
  topP?: number | null;
  topK?: number | null;
  providerOptions?: ProviderOptions;
  requestId?: string | null;
  traceContext?: TraceContext | null;
};

export type StreamResponse = {
  request_id: string;
};

export type StreamEvent =
  | { type: 'text-start' }
  | { type: 'text-delta'; text: string }
  | {
      type: 'tool-call';
      toolCallId: string;
      toolName: string;
      input: unknown;
      providerMetadata?: ProviderOptions;
    }
  | {
      type: 'reasoning-start';
      id: string;
      providerMetadata?: ProviderOptions;
    }
  | {
      type: 'reasoning-delta';
      id: string;
      text: string;
      providerMetadata?: ProviderOptions;
    }
  | {
      type: 'reasoning-end';
      id: string;
    }
  | {
      type: 'usage';
      input_tokens: number;
      output_tokens: number;
      total_tokens?: number | null;
      cached_input_tokens?: number | null;
      cache_creation_input_tokens?: number | null;
    }
  | { type: 'done'; finish_reason?: string | null }
  | { type: 'error'; message: string; name?: string }
  | { type: 'raw'; raw_value: string };

export type AvailableModel = {
  key: string;
  name: string;
  provider: string;
  providerName: string;
  imageInput: boolean;
  imageOutput: boolean;
  audioInput: boolean;
  videoInput: boolean;
  inputPricing?: string;
};

export type ProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyName: string;
  supportsOAuth: boolean;
  supportsCodingPlan: boolean;
  supportsInternational: boolean;
  codingPlanBaseUrl?: string | null;
  internationalBaseUrl?: string | null;
  headers?: Record<string, string> | null;
  extraBody?: unknown;
  authType: string;
};

export type TranscriptionRequest = {
  model: string;
  audioBase64: string;
  mimeType: string;
  language?: string | null;
  prompt?: string | null;
  temperature?: number | null;
  responseFormat?: string | null;
};

export type TranscriptionResponse = {
  text: string;
  language?: string | null;
  duration?: number | null;
};

// AI Services Types

export type CompletionContext = {
  fileContent: string;
  cursorPosition: number;
  fileName: string;
  language: string;
  model?: string | null;
};

export type CompletionRange = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

export type CompletionResult = {
  completion: string;
  range?: CompletionRange | null;
};

export type GitMessageContext = {
  userInput?: string | null;
  diffText: string;
  model?: string | null;
};

export type GitMessageResult = {
  message: string;
  suggestions?: string[] | null;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
};

export type CalculateCostRequest = {
  modelId: string;
  usage: TokenUsage;
  modelConfigs: Record<string, ModelConfig>;
};

export type CalculateCostResult = {
  cost: number;
};

export type TitleGenerationRequest = {
  userInput: string;
  language?: string | null;
  model?: string | null;
};

export type TitleGenerationResult = {
  title: string;
};

export type ContextCompactionRequest = {
  conversationHistory: string;
  model?: string | null;
};

export type ContextCompactionResult = {
  compressedSummary: string;
};

export type ModelConfig = {
  name: string;
  imageInput: boolean;
  imageOutput: boolean;
  audioInput: boolean;
  interleaved: boolean;
  providers: string[];
  providerMappings?: Record<string, string> | null;
  pricing?: ModelPricing | null;
  contextLength?: number | null;
};

export type ModelPricing = {
  input: string;
  output: string;
  cachedInput?: string | null;
  cacheCreation?: string | null;
};

export type PromptEnhancementRequest = {
  originalPrompt: string;
  projectPath?: string | null;
  conversationHistory?: string | null;
  enableContextExtraction: boolean;
  model?: string | null;
};

export type PromptEnhancementResult = {
  enhancedPrompt: string;
  extractedKeywords: string[];
  generatedQueries: string[];
  contextSnippetCount: number;
};
