import type {
  MemoryContext,
  MemoryDocument,
  MemoryQueryOptions,
  MemorySearchResult,
  MemoryTarget,
} from './memory-types';

export interface MemoryProjectionRepository {
  isAvailable(): boolean;
  search(query: string, options: MemoryQueryOptions): Promise<MemorySearchResult[]>;
  syncDocument(
    context: MemoryContext,
    target: MemoryTarget,
    document: MemoryDocument
  ): Promise<void>;
  deleteDocument(context: MemoryContext, target: MemoryTarget): Promise<void>;
}

export class NoopMemoryProjectionRepository implements MemoryProjectionRepository {
  isAvailable(): boolean {
    return false;
  }

  async search(_query: string, _options: MemoryQueryOptions): Promise<MemorySearchResult[]> {
    return [];
  }

  async syncDocument(
    _context: MemoryContext,
    _target: MemoryTarget,
    _document: MemoryDocument
  ): Promise<void> {
    return;
  }

  async deleteDocument(_context: MemoryContext, _target: MemoryTarget): Promise<void> {
    return;
  }
}

export const memoryProjectionRepository = new NoopMemoryProjectionRepository();
