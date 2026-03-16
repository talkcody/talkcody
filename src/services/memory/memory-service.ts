import { logger } from '@/lib/logger';
import {
  buildMemoryWorkspaceAudit,
  getInjectedIndexSlice,
  MEMORY_INDEX_INJECTION_LINE_LIMIT,
} from './memory-index-parser';
import {
  type MemoryMarkdownRepository,
  memoryMarkdownRepository,
} from './memory-markdown-repository';
import {
  type MemoryProjectionRepository,
  memoryProjectionRepository,
} from './memory-projection-repository';
import { type MemoryQueryService, memoryQueryService } from './memory-query-service';
import {
  GLOBAL_MEMORY_WORKSPACE_NAME,
  MEMORY_WORKSPACE_DIRECTORY_NAME,
  MEMORY_WORKSPACE_INDEX_FILE_NAME,
  PROJECT_MEMORY_WORKSPACE_NAME,
} from './memory-scope-config';
import type {
  MemoryContext,
  MemoryDocument,
  MemoryReadOptions,
  MemoryScope,
  MemorySearchOptions,
  MemorySearchResult,
  MemorySnapshot,
  MemoryTarget,
  MemoryWorkspace,
  MemoryWorkspaceAudit,
} from './memory-types';

export {
  GLOBAL_MEMORY_WORKSPACE_NAME,
  MEMORY_INDEX_INJECTION_LINE_LIMIT,
  MEMORY_WORKSPACE_DIRECTORY_NAME,
  MEMORY_WORKSPACE_INDEX_FILE_NAME,
  PROJECT_MEMORY_WORKSPACE_NAME,
};
export type {
  MemoryContext,
  MemoryDocument,
  MemoryReadOptions,
  MemoryScope,
  MemorySearchOptions,
  MemorySearchResult,
  MemorySnapshot,
  MemoryTarget,
  MemoryWorkspace,
  MemoryWorkspaceAudit,
} from './memory-types';

export class MemoryService {
  constructor(
    private readonly markdownRepository: MemoryMarkdownRepository = memoryMarkdownRepository,
    private readonly projectionRepository: MemoryProjectionRepository = memoryProjectionRepository,
    private readonly queryService: MemoryQueryService = memoryQueryService
  ) {}

  async getWorkspace(context: MemoryContext): Promise<MemoryWorkspace> {
    return await this.markdownRepository.getWorkspace(context);
  }

  async getIndex(context: MemoryContext): Promise<MemoryDocument> {
    return await this.markdownRepository.getIndex(context);
  }

  async saveIndex(context: MemoryContext, content: string): Promise<MemoryDocument> {
    const document = await this.markdownRepository.saveIndex(context, content);
    await this.syncProjection(context, { kind: 'index' }, document);
    return document;
  }

  async appendIndex(context: MemoryContext, content: string): Promise<MemoryDocument> {
    const document = await this.markdownRepository.appendIndex(context, content);
    await this.syncProjection(context, { kind: 'index' }, document);
    return document;
  }

  async getInjectedIndex(
    context: MemoryContext,
    maxLines = MEMORY_INDEX_INJECTION_LINE_LIMIT
  ): Promise<MemoryDocument> {
    const document = await this.getIndex(context);
    return {
      ...document,
      content: getInjectedIndexSlice(document.content, maxLines),
    };
  }

  async listTopics(context: MemoryContext): Promise<MemoryDocument[]> {
    return await this.markdownRepository.listTopics(context);
  }

  async getTopic(context: MemoryContext, fileName: string): Promise<MemoryDocument> {
    return await this.markdownRepository.getTopic(context, fileName);
  }

  async saveTopic(
    context: MemoryContext,
    fileName: string,
    content: string
  ): Promise<MemoryDocument> {
    const document = await this.markdownRepository.saveTopic(context, fileName, content);
    await this.syncProjection(context, { kind: 'topic', fileName }, document);
    return document;
  }

  async appendTopic(
    context: MemoryContext,
    fileName: string,
    content: string
  ): Promise<MemoryDocument> {
    const document = await this.markdownRepository.appendTopic(context, fileName, content);
    await this.syncProjection(context, { kind: 'topic', fileName }, document);
    return document;
  }

  async renameTopic(
    context: MemoryContext,
    fromFileName: string,
    toFileName: string
  ): Promise<MemoryDocument> {
    const document = await this.markdownRepository.renameTopic(context, fromFileName, toFileName);
    await this.deleteProjection(context, { kind: 'topic', fileName: fromFileName });
    await this.syncProjection(context, { kind: 'topic', fileName: toFileName }, document);
    return document;
  }

  async deleteTopic(context: MemoryContext, fileName: string): Promise<void> {
    await this.markdownRepository.deleteTopic(context, fileName);
    await this.deleteProjection(context, { kind: 'topic', fileName });
  }

  async auditWorkspace(context: MemoryContext): Promise<MemoryWorkspaceAudit> {
    const [indexDocument, topics] = await Promise.all([
      this.getIndex(context),
      this.listTopics(context),
    ]);

    return buildMemoryWorkspaceAudit(
      indexDocument.content,
      topics.map((document) => document.fileName ?? '').filter(Boolean)
    );
  }

  async search(query: string, options: MemorySearchOptions = {}): Promise<MemorySearchResult[]> {
    return await this.queryService.search(query, {
      contexts: this.resolveSearchContexts(options),
      maxResults: options.maxResults,
    });
  }

  async getGlobalWorkspace(): Promise<MemoryWorkspace> {
    return await this.getWorkspace({ scope: 'global' });
  }

  async getProjectWorkspace(workspaceRoot?: string): Promise<MemoryWorkspace> {
    return await this.getWorkspace({ scope: 'project', workspaceRoot });
  }

  async getGlobalDocument(): Promise<MemoryDocument> {
    return await this.getIndex({ scope: 'global' });
  }

  async getProjectMemoryDocument(workspaceRoot?: string): Promise<MemoryDocument> {
    return await this.getIndex({ scope: 'project', workspaceRoot });
  }

  async getProjectDocument(workspaceRoot?: string): Promise<MemoryDocument> {
    return await this.getProjectMemoryDocument(workspaceRoot);
  }

  async getSnapshot(options: MemoryReadOptions = {}): Promise<MemorySnapshot> {
    const [global, project] = await Promise.all([
      this.getGlobalDocument(),
      this.getProjectMemoryDocument(options.workspaceRoot),
    ]);

    return { global, project };
  }

  async read(
    scope: MemoryScope | 'all',
    options: MemoryReadOptions = {}
  ): Promise<MemoryDocument[]> {
    const snapshot = await this.getSnapshot(options);
    if (scope === 'all') {
      return [snapshot.global, snapshot.project];
    }

    return [scope === 'global' ? snapshot.global : snapshot.project];
  }

  async getInjectedDocument(
    scope: MemoryScope,
    options: MemoryReadOptions = {},
    maxLines = MEMORY_INDEX_INJECTION_LINE_LIMIT
  ): Promise<MemoryDocument> {
    return await this.getInjectedIndex(
      scope === 'global'
        ? { scope: 'global' }
        : { scope: 'project', workspaceRoot: options.workspaceRoot },
      maxLines
    );
  }

  async listTopicDocuments(
    scope: MemoryScope,
    options: MemoryReadOptions = {}
  ): Promise<MemoryDocument[]> {
    return await this.listTopics(
      scope === 'global'
        ? { scope: 'global' }
        : { scope: 'project', workspaceRoot: options.workspaceRoot }
    );
  }

  async getTopicDocument(
    scope: MemoryScope,
    fileName: string,
    options: MemoryReadOptions = {}
  ): Promise<MemoryDocument> {
    return await this.getTopic(
      scope === 'global'
        ? { scope: 'global' }
        : { scope: 'project', workspaceRoot: options.workspaceRoot },
      fileName
    );
  }

  async writeGlobal(content: string): Promise<MemoryDocument> {
    return await this.saveIndex({ scope: 'global' }, content);
  }

  async appendGlobal(content: string): Promise<MemoryDocument> {
    return await this.appendIndex({ scope: 'global' }, content);
  }

  async writeProjectMemoryDocument(
    workspaceRoot: string,
    content: string
  ): Promise<MemoryDocument> {
    return await this.saveIndex({ scope: 'project', workspaceRoot }, content);
  }

  async appendProjectMemoryDocument(
    workspaceRoot: string,
    content: string
  ): Promise<MemoryDocument> {
    return await this.appendIndex({ scope: 'project', workspaceRoot }, content);
  }

  async writeTopicDocument(
    scope: MemoryScope,
    fileName: string,
    content: string,
    options: MemoryReadOptions = {}
  ): Promise<MemoryDocument> {
    return await this.saveTopic(
      scope === 'global'
        ? { scope: 'global' }
        : { scope: 'project', workspaceRoot: options.workspaceRoot },
      fileName,
      content
    );
  }

  async appendTopicDocument(
    scope: MemoryScope,
    fileName: string,
    content: string,
    options: MemoryReadOptions = {}
  ): Promise<MemoryDocument> {
    return await this.appendTopic(
      scope === 'global'
        ? { scope: 'global' }
        : { scope: 'project', workspaceRoot: options.workspaceRoot },
      fileName,
      content
    );
  }

  async renameTopicDocument(
    scope: MemoryScope,
    fileName: string,
    nextFileName: string,
    options: MemoryReadOptions = {}
  ): Promise<MemoryDocument> {
    return await this.renameTopic(
      scope === 'global'
        ? { scope: 'global' }
        : { scope: 'project', workspaceRoot: options.workspaceRoot },
      fileName,
      nextFileName
    );
  }

  async deleteTopicDocument(
    scope: MemoryScope,
    fileName: string,
    options: MemoryReadOptions = {}
  ): Promise<void> {
    await this.deleteTopic(
      scope === 'global'
        ? { scope: 'global' }
        : { scope: 'project', workspaceRoot: options.workspaceRoot },
      fileName
    );
  }

  async getWorkspaceAudit(
    scope: MemoryScope,
    options: MemoryReadOptions = {}
  ): Promise<MemoryWorkspaceAudit> {
    return await this.auditWorkspace(
      scope === 'global'
        ? { scope: 'global' }
        : { scope: 'project', workspaceRoot: options.workspaceRoot }
    );
  }

  private resolveSearchContexts(options: MemorySearchOptions): MemoryContext[] {
    if (options.contexts && options.contexts.length > 0) {
      return options.contexts;
    }

    const scopes =
      options.scopes && options.scopes.length > 0 ? options.scopes : ['global', 'project'];
    return scopes.map((scope) =>
      scope === 'global'
        ? { scope: 'global' }
        : { scope: 'project', workspaceRoot: options.workspaceRoot }
    );
  }

  private async syncProjection(
    context: MemoryContext,
    target: MemoryTarget,
    document: MemoryDocument
  ): Promise<void> {
    try {
      await this.projectionRepository.syncDocument(context, target, document);
    } catch (error) {
      logger.warn('[MemoryService] Failed to sync memory projection', {
        scope: context.scope,
        target,
        error,
      });
    }
  }

  private async deleteProjection(context: MemoryContext, target: MemoryTarget): Promise<void> {
    try {
      await this.projectionRepository.deleteDocument(context, target);
    } catch (error) {
      logger.warn('[MemoryService] Failed to delete memory projection', {
        scope: context.scope,
        target,
        error,
      });
    }
  }
}

export const memoryService = new MemoryService();
