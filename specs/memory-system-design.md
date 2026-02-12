# TalkCody Memory System Design Document

## 1. Overview

### 1.1 Background

TalkCody is a desktop AI coding application that currently manages conversations and messages through SQLite. However, the current system lacks a persistent memory mechanism, meaning each conversation starts without context from previous interactions. This limits the AI's ability to provide personalized and context-aware responses.

### 1.2 Goals

1. **Persistent Memory**: Enable TalkCody to remember important information across conversations
2. **Pluggable Storage**: Design a storage interface that supports multiple backends (SQLite default, vector DB optional)
3. **Extensibility**: Provide clear interfaces for future extensions (cloud storage, custom extractors, etc.)
4. **Multiple Memory Types**: Support semantic, episodic, and procedural memory
5. **AI-Assisted Extraction**: Automatically extract meaningful information from conversations

### 1.3 Non-Goals

- Real-time vector embeddings (can be added later as an extension)
- Cloud synchronization (future phase)
- Memory sharing between users

---

## 2. Architecture Overview

### 2.1 System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Application Layer                            │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐ │
│  │  MemoryStore    │  │ MemoryExtractor │  │ MemoryPromptService │ │
│  │  (Zustand)      │  │ (AI-assisted)   │  │ (Prompt Builder)    │ │
│  └────────┬────────┘  └────────┬────────┘  └──────────┬──────────┘ │
│           │                    │                      │            │
├───────────┼────────────────────┼──────────────────────┼────────────┤
│           ▼                    ▼                      ▼            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    MemoryManager                             │   │
│  │  - extractMemories()  - consolidateMemories()               │   │
│  │  - retrieveMemories() - getMemoryPrompt()                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
├──────────────────────────────┼──────────────────────────────────────┤
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                MemoryStorageAdapter (Interface)              │   │
│  │  - save()  - get()  - update()  - delete()                  │   │
│  │  - query() - search() - batch operations                    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│           ┌──────────────────┼──────────────────┐                  │
│           ▼                  ▼                  ▼                  │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐          │
│  │ SQLiteAdapter │  │ VectorAdapter │  │ CloudAdapter  │          │
│  │ (Default)     │  │ (Optional)    │  │ (Future)      │          │
│  └───────────────┘  └───────────────┘  └───────────────┘          │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                        Storage Layer                                 │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐          │
│  │ SQLite (libsql│  │ Vector DB     │  │ Cloud Storage │          │
│  │  - memories   │  │ (Optional)    │  │ (Future)      │          │
│  │  - memory_    │  │               │  │               │          │
│  │    namespaces │  │               │  │               │          │
│  └───────────────┘  └───────────────┘  └───────────────┘          │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Memory Lifecycle                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. CONVERSATION                                                 │
│     ┌──────────┐                                                 │
│     │ Messages │ ───▶ MemoryExtractor ───▶ Extracted Memories    │
│     └──────────┘                                                 │
│                                                                  │
│  2. EXTRACTION (AI-assisted)                                     │
│     ┌───────────────────┐                                        │
│     │ Extracted Memories│ ───▶ Consolidation ───▶ Final Memory   │
│     └───────────────────┘        (merge/update)                   │
│                                                                  │
│  3. STORAGE                                                      │
│     ┌────────────┐                                               │
│     │ Final Mem  │ ───▶ StorageAdapter.save() ───▶ Database      │
│     └────────────┘                                               │
│                                                                  │
│  4. RETRIEVAL                                                    │
│     ┌──────────┐     ┌──────────────┐     ┌──────────────┐       │
│     │ Context  │ ──▶ │StorageAdapter│ ──▶ │ Relevant Mem │       │
│     │ Query    │     │ .search()    │     │ ories        │       │
│     └──────────┘     └──────────────┘     └──────────────┘       │
│                                                                  │
│  5. INJECTION                                                    │
│     ┌──────────────┐     ┌─────────────┐     ┌────────────┐      │
│     │ Relevant Mem │ ──▶ │PromptBuilder│ ──▶ │ System     │      │
│     │ ories        │     │             │     │ Prompt     │      │
│     └──────────────┘     └─────────────┘     └────────────┘      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Type Definitions

### 3.1 Memory Types

```typescript
// src/types/memory.ts

/**
 * Memory type classification based on human memory research
 * @see https://langchain-ai.github.io/langmem/concepts/conceptual_guide/
 */
export type MemoryType = 'semantic' | 'episodic' | 'procedural';

/**
 * Memory importance level (0-1, higher = more important)
 * Used for retrieval ranking and memory consolidation
 */
export type MemoryImportance = number; // 0.0 - 1.0

/**
 * Memory metadata for additional context
 */
export interface MemoryMetadata {
  // Source information
  sourceConversationId?: string;
  sourceMessageId?: string;
  sourceProjectId?: string;
  
  // Extraction information
  extractedAt: number;
  extractionMethod: 'auto' | 'manual' | 'imported';
  
  // Access tracking
  lastAccessedAt?: number;
  accessCount: number;
  
  // Consolidation tracking
  consolidatedFrom?: string[]; // IDs of memories this was consolidated from
  lastConsolidatedAt?: number;
  
  // Custom attributes
  tags?: string[];
  category?: string;
}

/**
 * Core Memory entity
 */
export interface Memory {
  id: string;
  
  // Type classification
  type: MemoryType;
  
  // Content
  content: string;
  
  // Metadata
  metadata: MemoryMetadata;
  
  // Namespace for organization (e.g., ['user', 'project-123'])
  namespace: string[];
  
  // Importance score (0-1)
  importance: MemoryImportance;
  
  // Optional embedding for semantic search
  embedding?: number[];
  
  // Timestamps
  createdAt: number;
  updatedAt: number;
}

/**
 * Namespace for organizing memories
 * Examples:
 * - ['global'] - Global memories (user preferences)
 * - ['project', 'project-123'] - Project-specific memories
 * - ['conversation', 'conv-456'] - Conversation-specific memories
 */
export type MemoryNamespace = string[];

/**
 * Memory namespace constants
 */
export const MemoryNamespaces = {
  GLOBAL: ['global'] as MemoryNamespace,
  project: (projectId: string): MemoryNamespace => ['project', projectId],
  conversation: (conversationId: string): MemoryNamespace => ['conversation', conversationId],
} as const;
```

### 3.2 Semantic Memory (Facts & Knowledge)

```typescript
/**
 * Semantic memory stores facts and knowledge
 * 
 * Examples for TalkCody:
 * - User's preferred coding style
 * - User's frequently used libraries/frameworks
 * - Project-specific conventions
 * - User's technical background
 */
export interface SemanticMemory extends Memory {
  type: 'semantic';
  
  // Structured data for semantic memories
  structuredData?: {
    key: string;      // e.g., 'preferred_framework', 'coding_style'
    value: string;    // e.g., 'React', 'functional_components'
    confidence: number; // 0-1 confidence in this fact
  };
}

/**
 * User profile stored as semantic memory
 */
export interface UserProfileMemory extends Memory {
  type: 'semantic';
  
  profile: {
    name?: string;
    preferredName?: string;
    programmingLanguages?: string[];
    frameworks?: string[];
    codingStyle?: string;
    responsePreference?: 'concise' | 'detailed' | 'balanced';
    languagePreference?: 'en' | 'zh' | 'auto';
  };
}
```

### 3.3 Episodic Memory (Past Experiences)

```typescript
/**
 * Episodic memory stores past experiences and interactions
 * 
 * Examples for TalkCody:
 * - Successful code patterns used before
 * - Solutions to similar problems
 * - Learning from mistakes
 */
export interface EpisodicMemory extends Memory {
  type: 'episodic';
  
  // Episode context
  episode: {
    // What was the situation
    situation: string;
    
    // What action was taken
    action: string;
    
    // What was the outcome
    outcome: 'success' | 'partial' | 'failure';
    
    // Why did it work/fail
    reasoning?: string;
    
    // Key learnings
    learnings?: string[];
  };
}

/**
 * Code pattern memory - a specialized episodic memory
 */
export interface CodePatternMemory extends Memory {
  type: 'episodic';
  
  pattern: {
    description: string;
    codeSnippet?: string;
    language?: string;
    framework?: string;
    useCase: string;
    effectiveness: number; // 0-1 rating
  };
}
```

### 3.4 Procedural Memory (System Behavior)

```typescript
/**
 * Procedural memory stores behavioral patterns and preferences
 * 
 * Examples for TalkCody:
 * - Preferred workflow for code reviews
 * - Preferred commit message style
 * - Preferred testing approach
 */
export interface ProceduralMemory extends Memory {
  type: 'procedural';
  
  // Procedure definition
  procedure: {
    name: string;
    description: string;
    steps?: string[];
    triggers?: string[]; // When to apply this procedure
    priority?: number;
  };
}
```

---

## 4. Storage Adapter Interface

### 4.1 Core Interface

```typescript
// src/services/memory/interfaces/storage-adapter.ts

/**
 * Query filter for memory retrieval
 */
export interface MemoryQueryFilter {
  // Type filter
  types?: MemoryType[];
  
  // Namespace filter (exact match or prefix)
  namespace?: {
    value: MemoryNamespace;
    match: 'exact' | 'prefix';
  };
  
  // Time range
  createdAt?: {
    from?: number;
    to?: number;
  };
  
  // Importance range
  importance?: {
    min?: number;
    max?: number;
  };
  
  // Tag filter
  tags?: string[];
  
  // Category filter
  category?: string;
  
  // Source filter
  sourceConversationId?: string;
  sourceProjectId?: string;
  
  // Pagination
  limit?: number;
  offset?: number;
  
  // Sorting
  orderBy?: 'createdAt' | 'updatedAt' | 'importance' | 'accessCount';
  orderDirection?: 'asc' | 'desc';
}

/**
 * Search options for semantic search
 */
export interface SearchOptions {
  // Maximum results
  limit?: number;
  
  // Minimum similarity score (0-1) for vector search
  minScore?: number;
  
  // Include embedding in results
  includeEmbedding?: boolean;
  
  // Search within specific types
  types?: MemoryType[];
  
  // Search within specific namespace
  namespace?: MemoryNamespace;
  
  // Hybrid search weight (0 = keyword only, 1 = vector only)
  hybridWeight?: number;
}

/**
 * Search result with relevance score
 */
export interface MemorySearchResult {
  memory: Memory;
  score: number; // Relevance score (0-1)
  highlight?: string; // Matched text highlight
}

/**
 * Storage adapter interface - the core abstraction for pluggable storage
 * 
 * Implementations:
 * - SQLiteMemoryStorage: Default, uses libsql
 * - VectorMemoryStorage: Optional, for semantic search
 * - CloudMemoryStorage: Future, for cloud sync
 */
export interface MemoryStorageAdapter {
  // ============================================
  // Basic CRUD Operations
  // ============================================
  
  /**
   * Save a new memory
   * @returns The ID of the saved memory
   */
  save(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Promise<string>;
  
  /**
   * Get a memory by ID
   */
  get(id: string): Promise<Memory | null>;
  
  /**
   * Update an existing memory
   */
  update(id: string, updates: Partial<Memory>): Promise<void>;
  
  /**
   * Delete a memory by ID
   */
  delete(id: string): Promise<void>;
  
  // ============================================
  // Batch Operations
  // ============================================
  
  /**
   * Save multiple memories at once
   */
  saveBatch(memories: Array<Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>>): Promise<string[]>;
  
  /**
   * Delete multiple memories by IDs
   */
  deleteBatch(ids: string[]): Promise<void>;
  
  // ============================================
  // Query Operations
  // ============================================
  
  /**
   * Query memories with filters
   */
  query(filter: MemoryQueryFilter): Promise<Memory[]>;
  
  /**
   * Count memories matching filter
   */
  count(filter: Omit<MemoryQueryFilter, 'limit' | 'offset' | 'orderBy' | 'orderDirection'>): Promise<number>;
  
  // ============================================
  // Search Operations
  // ============================================
  
  /**
   * Search memories by text query
   * Implementations may use:
   * - Full-text search (SQLite FTS)
   * - Semantic search (vector embeddings)
   * - Hybrid search (both)
   */
  search(query: string, options?: SearchOptions): Promise<MemorySearchResult[]>;
  
  /**
   * Find similar memories (requires vector support)
   */
  findSimilar(memoryId: string, options?: { limit?: number; minScore?: number }): Promise<MemorySearchResult[]>;
  
  // ============================================
  // Namespace Operations
  // ============================================
  
  /**
   * Get all memories in a namespace
   */
  getByNamespace(namespace: MemoryNamespace): Promise<Memory[]>;
  
  /**
   * Delete all memories in a namespace
   */
  deleteByNamespace(namespace: MemoryNamespace): Promise<number>;
  
  // ============================================
  // Lifecycle Operations
  // ============================================
  
  /**
   * Initialize the storage (create tables, indexes, etc.)
   */
  initialize(): Promise<void>;
  
  /**
   * Close connections and cleanup
   */
  close(): Promise<void>;
  
  /**
   * Check if storage is ready
   */
  isReady(): boolean;
  
  // ============================================
  // Capability Queries
  // ============================================
  
  /**
   * Check if the adapter supports vector search
   */
  supportsVectorSearch(): boolean;
  
  /**
   * Get the adapter type name
   */
  readonly adapterType: string;
}
```

### 4.2 Storage Adapter Registry

```typescript
// src/services/memory/interfaces/adapter-registry.ts

/**
 * Storage adapter factory function
 */
export type StorageAdapterFactory = (config?: Record<string, unknown>) => MemoryStorageAdapter;

/**
 * Registry for storage adapters
 * Allows registration and retrieval of adapters by name
 */
export interface MemoryAdapterRegistry {
  /**
   * Register a storage adapter factory
   */
  register(name: string, factory: StorageAdapterFactory): void;
  
  /**
   * Get a storage adapter by name
   */
  get(name: string, config?: Record<string, unknown>): MemoryStorageAdapter;
  
  /**
   * Check if an adapter is registered
   */
  has(name: string): boolean;
  
  /**
   * List all registered adapter names
   */
  list(): string[];
  
  /**
   * Set the default adapter name
   */
  setDefault(name: string): void;
  
  /**
   * Get the default adapter
   */
  getDefault(): MemoryStorageAdapter;
}
```

---

## 5. Memory Manager Interface

### 5.1 Core Manager

```typescript
// src/services/memory/interfaces/memory-manager.ts

/**
 * Context for memory extraction
 */
export interface MemoryExtractionContext {
  // Current project ID
  projectId?: string;
  
  // Current conversation ID
  conversationId?: string;
  
  // User ID (for multi-user support in future)
  userId?: string;
  
  // Existing memories to consider for consolidation
  existingMemories?: Memory[];
  
  // Extraction instructions
  instructions?: string;
}

/**
 * Options for memory retrieval
 */
export interface MemoryRetrievalOptions {
  // Maximum number of memories to retrieve
  limit?: number;
  
  // Minimum importance threshold
  minImportance?: number;
  
  // Include specific types only
  types?: MemoryType[];
  
  // Include specific namespace
  namespace?: MemoryNamespace;
  
  // Include recent memories (in milliseconds)
  recentWithin?: number;
}

/**
 * Result of memory consolidation
 */
export interface ConsolidationResult {
  // Created memory (if any)
  created?: Memory;
  
  // Updated memories (if any)
  updated?: Memory[];
  
  // Deleted memory IDs (consolidated into others)
  deleted?: string[];
  
  // Whether any changes were made
  hasChanges: boolean;
}

/**
 * Memory manager interface
 * Orchestrates memory extraction, consolidation, and retrieval
 */
export interface MemoryManager {
  // ============================================
  // Extraction
  // ============================================
  
  /**
   * Extract memories from a conversation
   * Uses AI to identify important information
   */
  extractMemories(
    messages: UIMessage[],
    context?: MemoryExtractionContext
  ): Promise<Memory[]>;
  
  /**
   * Extract memories from a single message
   * Useful for real-time extraction
   */
  extractFromMessage(
    message: UIMessage,
    context?: MemoryExtractionContext
  ): Promise<Memory[]>;
  
  // ============================================
  // Consolidation
  // ============================================
  
  /**
   * Consolidate new memories with existing ones
   * - Merge similar memories
   * - Update existing memories
   * - Remove redundant memories
   */
  consolidateMemories(
    existingMemories: Memory[],
    newMemory: Memory
  ): Promise<ConsolidationResult>;
  
  /**
   * Run full consolidation pass
   * Useful for background maintenance
   */
  runConsolidation(namespace?: MemoryNamespace): Promise<void>;
  
  // ============================================
  // Retrieval
  // ============================================
  
  /**
   * Retrieve relevant memories for a context
   */
  retrieveMemories(
    query: string,
    options?: MemoryRetrievalOptions
  ): Promise<Memory[]>;
  
  /**
   * Get memories for prompt injection
   * Returns formatted memories ready for system prompt
   */
  getMemoriesForPrompt(
    namespace: MemoryNamespace,
    options?: MemoryRetrievalOptions
  ): Promise<Memory[]>;
  
  // ============================================
  // Prompt Building
  // ============================================
  
  /**
   * Build memory section for system prompt
   */
  buildMemoryPrompt(
    memories: Memory[],
    format?: 'compact' | 'detailed' | 'structured'
  ): string;
  
  // ============================================
  // Storage Operations
  // ============================================
  
  /**
   * Save memories to storage
   */
  saveMemories(memories: Memory[]): Promise<string[]>;
  
  /**
   * Delete memories by ID
   */
  deleteMemories(ids: string[]): Promise<void>;
  
  /**
   * Get memory by ID
   */
  getMemory(id: string): Promise<Memory | null>;
}
```

### 5.2 Memory Extractor Interface

```typescript
// src/services/memory/interfaces/memory-extractor.ts

/**
 * Extraction result from AI
 */
export interface ExtractionResult {
  // Extracted memories
  memories: Array<{
    type: MemoryType;
    content: string;
    importance: number;
    metadata?: Partial<MemoryMetadata>;
  }>;
  
  // Confidence in extraction (0-1)
  confidence: number;
  
  // Reasoning for extraction decisions
  reasoning?: string;
}

/**
 * Memory extractor interface
 * Responsible for AI-assisted memory extraction
 */
export interface MemoryExtractor {
  /**
   * Extract memories from messages
   */
  extract(
    messages: UIMessage[],
    context?: MemoryExtractionContext
  ): Promise<ExtractionResult>;
  
  /**
   * Extract memories with custom instructions
   */
  extractWithInstructions(
    messages: UIMessage[],
    instructions: string,
    context?: MemoryExtractionContext
  ): Promise<ExtractionResult>;
  
  /**
   * Check if extractor is ready
   */
  isReady(): boolean;
}
```

---

## 6. SQLite Storage Implementation

### 6.1 Database Schema

```sql
-- src-tauri/src/memory/schema.sql

-- Main memories table
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('semantic', 'episodic', 'procedural')),
  content TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  namespace TEXT NOT NULL,  -- JSON array as string: '["project", "123"]'
  metadata TEXT NOT NULL DEFAULT '{}',  -- JSON object
  embedding BLOB,  -- Optional vector embedding (for future use)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Namespace index for hierarchical queries
CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories(namespace);

-- Type index
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);

-- Importance index for ranking
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);

-- Time-based indexes
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories(updated_at DESC);

-- Full-text search virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  content='memories',
  content_rowid='rowid',
  tokenize='unicode61'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- Memory access log (for tracking access patterns)
CREATE TABLE IF NOT EXISTS memory_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  accessed_at INTEGER NOT NULL,
  access_type TEXT NOT NULL CHECK (access_type IN ('read', 'search', 'prompt')),
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_access_log_memory_id ON memory_access_log(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_access_log_accessed_at ON memory_access_log(accessed_at DESC);
```

### 6.2 TypeScript Adapter Implementation

```typescript
// src/services/memory/adapters/sqlite-adapter.ts

import type { Memory, MemoryQueryFilter, MemorySearchResult, SearchOptions } from '../interfaces';
import { MemoryStorageAdapter } from '../interfaces';

/**
 * SQLite-based memory storage adapter
 * Uses libsql via Tauri for persistent storage
 */
export class SQLiteMemoryStorage implements MemoryStorageAdapter {
  readonly adapterType = 'sqlite';
  private db: TursoClient | null = null;
  private ready = false;

  async initialize(): Promise<void> {
    // Initialize database connection and create tables
    this.db = await getDatabase();
    await this.createTables();
    this.ready = true;
  }

  async save(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const id = generateUUID();
    const now = Date.now();
    
    await this.db!.execute(`
      INSERT INTO memories (id, type, content, importance, namespace, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      memory.type,
      memory.content,
      memory.importance,
      JSON.stringify(memory.namespace),
      JSON.stringify(memory.metadata),
      now,
      now
    ]);
    
    return id;
  }

  async search(query: string, options?: SearchOptions): Promise<MemorySearchResult[]> {
    // Use FTS5 for full-text search
    const results = await this.db!.execute(`
      SELECT m.*, bm25(memories_fts) as score
      FROM memories m
      JOIN memories_fts ON m.rowid = memories_fts.rowid
      WHERE memories_fts MATCH ?
      ORDER BY score ASC
      LIMIT ?
    `, [query, options?.limit ?? 10]);
    
    // Convert BM25 score to 0-1 range
    return results.rows.map(row => ({
      memory: this.rowToMemory(row),
      score: this.normalizeScore(row.score)
    }));
  }

  // ... other methods
}
```

---

## 7. AI-Assisted Memory Extraction

### 7.1 Extraction Prompt Design

```typescript
// src/services/memory/prompts/extraction-prompt.ts

export const MEMORY_EXTRACTION_PROMPT = `
You are a memory extraction system for an AI coding assistant. Your task is to analyze conversations and extract important information that should be remembered for future interactions.

## Memory Types

1. **Semantic Memory** (Facts & Knowledge):
   - User's coding preferences and style
   - Frequently used libraries, frameworks, tools
   - Project-specific conventions and patterns
   - Technical background and expertise level

2. **Episodic Memory** (Past Experiences):
   - Successful solutions to problems
   - Code patterns that worked well
   - Mistakes to avoid in the future
   - Learning moments

3. **Procedural Memory** (Behavioral Patterns):
   - Preferred workflow steps
   - Response format preferences
   - Communication style preferences
   - Task execution patterns

## Extraction Guidelines

1. Only extract information that is:
   - Factual and not speculative
   - Useful for future interactions
   - Not already common knowledge

2. Assign importance scores:
   - 0.9-1.0: Critical preferences that define user's identity
   - 0.7-0.9: Strong preferences that affect most interactions
   - 0.5-0.7: Useful preferences that affect some interactions
   - 0.3-0.5: Minor preferences or context
   - 0.0-0.3: Trivial information (rarely extract)

3. Avoid extracting:
   - Temporary context (current file being edited)
   - Information specific to one task
   - Sensitive data (API keys, passwords)
   - Redundant information

## Output Format

Return a JSON object with extracted memories:
\`\`\`json
{
  "memories": [
    {
      "type": "semantic",
      "content": "User prefers functional React components with hooks",
      "importance": 0.8,
      "metadata": {
        "category": "coding_style"
      }
    }
  ],
  "confidence": 0.85,
  "reasoning": "User explicitly stated preference multiple times"
}
\`\`\`

## Conversation to Analyze

{conversation}
`;
```

### 7.2 Extraction Service

```typescript
// src/services/memory/memory-extractor-service.ts

import type { MemoryExtractor, ExtractionResult } from './interfaces';

export class AIMemoryExtractor implements MemoryExtractor {
  private llmService: LLMService;

  async extract(
    messages: UIMessage[],
    context?: MemoryExtractionContext
  ): Promise<ExtractionResult> {
    // Format conversation for analysis
    const conversationText = this.formatConversation(messages);
    
    // Build extraction prompt
    const prompt = MEMORY_EXTRACTION_PROMPT.replace('{conversation}', conversationText);
    
    // Add context-specific instructions
    if (context?.instructions) {
      prompt += `\n\nAdditional Instructions:\n${context.instructions}`;
    }
    
    // Call LLM for extraction
    const response = await this.llmService.complete({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3, // Lower temperature for more consistent extraction
    });
    
    // Parse and validate result
    return this.parseExtractionResult(response.content);
  }

  private formatConversation(messages: UIMessage[]): string {
    return messages.map(m => `[${m.role}]: ${m.content}`).join('\n\n');
  }
}
```

---

## 8. Integration with Existing Systems

### 8.1 LLM Service Integration

```typescript
// src/services/agents/llm-service.ts (modifications)

export class LLMService {
  private memoryManager: MemoryManager;

  async runAgentLoop(params: AgentLoopParams): Promise<void> {
    // 1. Retrieve relevant memories before starting
    const memories = await this.memoryManager.retrieveMemories(
      params.userMessage,
      { limit: 10, namespace: MemoryNamespaces.project(params.projectId) }
    );
    
    // 2. Build memory-enhanced system prompt
    const memoryPrompt = await this.memoryManager.buildMemoryPrompt(memories);
    const enhancedSystemPrompt = `${params.systemPrompt}\n\n${memoryPrompt}`;
    
    // 3. Run agent loop with enhanced context
    // ... existing logic ...
    
    // 4. Extract memories after conversation (background)
    this.extractMemoriesInBackground(params.conversationId, messages);
  }

  private async extractMemoriesInBackground(
    conversationId: string,
    messages: UIMessage[]
  ): Promise<void> {
    // Don't await - run in background
    this.memoryManager.extractMemories(messages, {
      conversationId,
    }).catch(err => {
      logger.error('Failed to extract memories:', err);
    });
  }
}
```

### 8.2 Message Service Integration

```typescript
// src/services/message-service.ts (modifications)

export class MessageService {
  private memoryManager: MemoryManager;

  async addUserMessage(
    taskId: string,
    content: string,
    options?: AddMessageOptions
  ): Promise<string> {
    // ... existing logic ...
    
    // Check if message contains explicit memory commands
    if (this.containsMemoryCommand(content)) {
      await this.handleMemoryCommand(content, taskId);
    }
    
    return messageId;
  }

  private containsMemoryCommand(content: string): boolean {
    const commands = ['/remember', '/forget', '/recall'];
    return commands.some(cmd => content.startsWith(cmd));
  }

  private async handleMemoryCommand(content: string, taskId: string): Promise<void> {
    if (content.startsWith('/remember')) {
      const memoryContent = content.replace('/remember', '').trim();
      await this.memoryManager.saveMemories([{
        type: 'semantic',
        content: memoryContent,
        importance: 0.8,
        namespace: MemoryNamespaces.GLOBAL,
        metadata: { extractionMethod: 'manual' }
      }]);
    }
    // ... other commands
  }
}
```

### 8.3 Zustand Store

```typescript
// src/stores/memory-store.ts

import { create } from 'zustand';

interface MemoryState {
  // Memories cache by namespace
  memoriesByNamespace: Map<string, Memory[]>;
  
  // Loading states
  isLoading: boolean;
  
  // Actions
  loadMemories: (namespace: MemoryNamespace) => Promise<void>;
  addMemory: (memory: Memory) => void;
  updateMemory: (id: string, updates: Partial<Memory>) => void;
  deleteMemory: (id: string) => void;
  
  // Search
  searchResults: MemorySearchResult[];
  search: (query: string) => Promise<void>;
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  memoriesByNamespace: new Map(),
  isLoading: false,
  searchResults: [],

  loadMemories: async (namespace) => {
    set({ isLoading: true });
    const memories = await memoryManager.getMemoriesForPrompt(namespace);
    set(state => {
      const newMap = new Map(state.memoriesByNamespace);
      newMap.set(namespace.join(':'), memories);
      return { memoriesByNamespace: newMap, isLoading: false };
    });
  },
  
  // ... other actions
}));
```

---

## 9. Configuration and Settings

### 9.1 Memory Settings

```typescript
// src/types/memory.ts

export interface MemorySettings {
  // Enable/disable memory system
  enabled: boolean;
  
  // Storage adapter to use
  storageAdapter: 'sqlite' | 'vector' | 'cloud';
  
  // Extraction settings
  extraction: {
    // Enable automatic extraction
    autoExtract: boolean;
    
    // When to extract: 'after_conversation' | 'during_conversation'
    extractionMode: 'after_conversation' | 'during_conversation';
    
    // Minimum messages before extraction
    minMessagesForExtraction: number;
    
    // LLM to use for extraction
    extractionModel?: string;
  };
  
  // Retention settings
  retention: {
    // Maximum memories per namespace
    maxMemoriesPerNamespace: number;
    
    // Auto-delete old memories (days, 0 = never)
    autoDeleteAfterDays: number;
    
    // Importance threshold for auto-delete
    autoDeleteMinImportance: number;
  };
  
  // Retrieval settings
  retrieval: {
    // Maximum memories to inject into prompt
    maxMemoriesInPrompt: number;
    
    // Minimum importance for retrieval
    minImportanceForRetrieval: number;
    
    // Include memory types
    includedTypes: MemoryType[];
  };
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  enabled: true,
  storageAdapter: 'sqlite',
  extraction: {
    autoExtract: true,
    extractionMode: 'after_conversation',
    minMessagesForExtraction: 3,
  },
  retention: {
    maxMemoriesPerNamespace: 100,
    autoDeleteAfterDays: 0,
    autoDeleteMinImportance: 0.3,
  },
  retrieval: {
    maxMemoriesInPrompt: 10,
    minImportanceForRetrieval: 0.3,
    includedTypes: ['semantic', 'episodic', 'procedural'],
  },
};
```

---

## 10. File Structure

```
src/
├── types/
│   └── memory.ts                    # Memory type definitions
│
├── services/
│   └── memory/
│       ├── interfaces/
│       │   ├── index.ts
│       │   ├── storage-adapter.ts   # Storage adapter interface
│       │   ├── memory-manager.ts    # Manager interface
│       │   └── memory-extractor.ts  # Extractor interface
│       │
│       ├── adapters/
│       │   ├── index.ts
│       │   ├── sqlite-adapter.ts    # SQLite implementation
│       │   └── vector-adapter.ts    # Vector DB implementation (future)
│       │
│       ├── prompts/
│       │   └── extraction-prompt.ts # AI extraction prompts
│       │
│       ├── memory-manager.ts        # Main manager implementation
│       ├── memory-extractor.ts      # AI-assisted extraction
│       ├── memory-service.ts        # High-level service facade
│       └── index.ts
│
├── stores/
│   └── memory-store.ts              # Zustand store
│
└── components/
    └── memory/
        ├── memory-panel.tsx         # Memory management UI
        ├── memory-list.tsx          # Memory list component
        └── memory-item.tsx          # Individual memory display

src-tauri/
└── src/
    └── memory/
        ├── mod.rs
        ├── schema.rs                # Database schema
        └── commands.rs              # Tauri commands
```

---

## 11. Implementation Phases

### Phase 1: Core Types and Interfaces (Day 1)
- Define all TypeScript types
- Define storage adapter interface
- Define memory manager interface
- Define extractor interface

### Phase 2: SQLite Storage (Day 2-3)
- Create Rust schema and commands
- Implement SQLite adapter in TypeScript
- Add database migrations
- Write unit tests

### Phase 3: Memory Manager (Day 3-4)
- Implement memory manager
- Implement consolidation logic
- Implement retrieval logic
- Write unit tests

### Phase 4: AI Extraction (Day 4-5)
- Design extraction prompts
- Implement AI extractor
- Integrate with LLM service
- Test extraction quality

### Phase 5: Integration (Day 5-6)
- Integrate with LLM service
- Integrate with message service
- Create Zustand store
- Add settings support

### Phase 6: UI and i18n (Day 6-7)
- Create memory management UI
- Add i18n support (en/zh)
- Write component tests

### Phase 7: Testing and Polish (Day 7-8)
- Comprehensive testing
- Performance optimization
- Documentation
- Code review

---

## 12. Future Extensions

### 12.1 Vector Search (Phase 2)
- Add embedding generation
- Implement vector adapter
- Support semantic search
- Hybrid search (keyword + vector)

### 12.2 Cloud Sync (Phase 3)
- Cloud storage adapter
- Memory synchronization
- Multi-device support

### 12.3 Memory Sharing (Phase 4)
- Team memory namespaces
- Memory templates
- Marketplace for memory packs

### 12.4 Advanced Features
- Memory visualization graph
- Memory export/import
- Memory analytics dashboard
- Custom extraction rules

---

## 13. References

- [LangMem Conceptual Guide](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)
- [LangChain Memory for Agents](https://blog.langchain.com/memory-for-agents/)
- [Mem0 - Memory Layer for AI Apps](https://mem0.ai/)
- [CoALA Paper - Cognitive Architectures for Language Agents](https://arxiv.org/abs/2309.02427)
