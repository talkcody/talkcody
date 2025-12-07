// src/services/database-service.ts

import { logger } from '@/lib/logger';
import { MCPServerService } from '@/lib/mcp/mcp-server-service';
import type { MessageAttachment } from '@/types/agent';
import { ConversationService } from './database/conversation-service';
import { ProjectService } from './database/project-service';
import { loadDatabase, type TursoClient } from './database/turso-client';
import { TursoDatabaseInit } from './database/turso-database-init';

// Re-export types
export type {
  Conversation,
  CreateMCPServerData,
  CreateProjectData,
  CreateTodoItem,
  MCPServer,
  Project,
  StoredAttachment,
  StoredMessage,
  TodoItem,
  UpdateMCPServerData,
  UpdateProjectData,
} from './database/types';

export class DatabaseService {
  private db: TursoClient | null = null;
  private initializationPromise: Promise<void> | null = null;
  private isInitialized = false;

  private projectService: ProjectService | null = null;
  private conversationService: ConversationService | null = null;
  private mcpServerService: MCPServerService | null = null;

  private async internalInitialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      this.db = await loadDatabase({
        filename: 'talkcody.db',
      });

      await TursoDatabaseInit.initialize(this.db);
      await TursoDatabaseInit.runMigrations(this.db);

      // Initialize services
      this.projectService = new ProjectService(this.db);
      this.conversationService = new ConversationService(this.db);
      this.mcpServerService = new MCPServerService(this.db);

      this.isInitialized = true;
      logger.info('Turso database initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Turso database:', error);
      throw error;
    }
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (!this.initializationPromise) {
      this.initializationPromise = this.internalInitialize();
    }

    return this.initializationPromise;
  }

  async getDb(): Promise<TursoClient> {
    await this.ensureInitialized();
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  // Project methods
  async createProject(data: import('./database/types').CreateProjectData): Promise<string> {
    await this.ensureInitialized();
    if (!this.projectService) throw new Error('Project service not initialized');
    return this.projectService.createProject(data);
  }

  async getProjects(): Promise<import('./database/types').Project[]> {
    await this.ensureInitialized();
    if (!this.projectService) throw new Error('Project service not initialized');
    return this.projectService.getProjects();
  }

  async getProject(projectId: string): Promise<import('./database/types').Project> {
    await this.ensureInitialized();
    if (!this.projectService) throw new Error('Project service not initialized');
    return this.projectService.getProject(projectId);
  }

  async updateProject(
    projectId: string,
    data: import('./database/types').UpdateProjectData
  ): Promise<void> {
    await this.ensureInitialized();
    if (!this.projectService) throw new Error('Project service not initialized');
    return this.projectService.updateProject(projectId, data);
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.projectService) throw new Error('Project service not initialized');
    return this.projectService.deleteProject(projectId);
  }

  async getProjectStats(projectId: string): Promise<{ conversationCount: number }> {
    await this.ensureInitialized();
    if (!this.projectService) throw new Error('Project service not initialized');
    return this.projectService.getProjectStats(projectId);
  }

  async getProjectByRootPath(rootPath: string): Promise<import('./database/types').Project | null> {
    await this.ensureInitialized();
    if (!this.projectService) throw new Error('Project service not initialized');
    return this.projectService.getProjectByRootPath(rootPath);
  }

  async createOrGetProjectForRepository(
    rootPath: string
  ): Promise<import('./database/types').Project> {
    await this.ensureInitialized();
    if (!this.projectService) throw new Error('Project service not initialized');
    return this.projectService.createOrGetProjectForRepository(rootPath);
  }

  async clearRepositoryPath(projectId: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.projectService) throw new Error('Project service not initialized');
    return this.projectService.clearRepositoryPath(projectId);
  }

  async getProjectByRepositoryPath(
    rootPath: string
  ): Promise<import('./database/types').Project | null> {
    await this.ensureInitialized();
    if (!this.projectService) throw new Error('Project service not initialized');
    return this.projectService.getProjectByRepositoryPath(rootPath);
  }

  // Conversation methods
  async createConversation(
    title: string,
    conversationId: string,
    projectId = 'default'
  ): Promise<string> {
    await this.ensureInitialized();
    if (!this.conversationService) throw new Error('Conversation service not initialized');
    return this.conversationService.createConversation(title, conversationId, projectId);
  }

  async getConversations(projectId?: string): Promise<import('./database/types').Conversation[]> {
    await this.ensureInitialized();
    if (!this.conversationService) throw new Error('Conversation service not initialized');
    return this.conversationService.getConversations(projectId);
  }

  async getConversationDetails(
    conversationId: string
  ): Promise<import('./database/types').Conversation | null> {
    await this.ensureInitialized();
    if (!this.conversationService) throw new Error('Conversation service not initialized');
    return this.conversationService.getConversationDetails(conversationId);
  }

  async updateConversationTitle(conversationId: string, title: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.conversationService) throw new Error('Conversation service not initialized');
    return this.conversationService.updateConversationTitle(conversationId, title);
  }

  async updateConversationProject(conversationId: string, projectId: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.conversationService) throw new Error('Conversation service not initialized');
    return this.conversationService.updateConversationProject(conversationId, projectId);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.conversationService) throw new Error('Conversation service not initialized');
    return this.conversationService.deleteConversation(conversationId);
  }

  // Message methods
  async saveMessage(
    conversationId: string,
    role: 'user' | 'assistant' | 'tool',
    content: string,
    positionIndex: number,
    assistant_id?: string,
    attachments?: MessageAttachment[],
    messageId?: string
  ): Promise<string> {
    await this.ensureInitialized();
    if (!this.conversationService) throw new Error('Conversation service not initialized');
    return this.conversationService.saveMessage(
      conversationId,
      role,
      content,
      positionIndex,
      assistant_id,
      attachments,
      messageId
    );
  }

  async getMessages(conversationId: string): Promise<import('./database/types').StoredMessage[]> {
    await this.ensureInitialized();
    if (!this.conversationService) throw new Error('Conversation service not initialized');
    return this.conversationService.getMessages(conversationId);
  }

  async getMessagesForPosition(
    conversationId: string,
    positionIndex: number
  ): Promise<import('./database/types').StoredMessage[]> {
    await this.ensureInitialized();
    if (!this.conversationService) throw new Error('Conversation service not initialized');
    return this.conversationService.getMessagesForPosition(conversationId, positionIndex);
  }

  async getAttachmentsForMessage(messageId: string): Promise<MessageAttachment[]> {
    await this.ensureInitialized();
    if (!this.conversationService) throw new Error('Conversation service not initialized');
    return this.conversationService.getAttachmentsForMessage(messageId);
  }

  async updateMessage(messageId: string, content: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.conversationService) throw new Error('Conversation service not initialized');
    return this.conversationService.updateMessage(messageId, content);
  }

  async saveAttachment(messageId: string, attachment: MessageAttachment): Promise<void> {
    await this.ensureInitialized();
    if (!this.conversationService) throw new Error('Conversation service not initialized');
    return this.conversationService.saveAttachment(messageId, attachment);
  }

  async getLatestUserMessageContent(conversationId: string): Promise<string | null> {
    await this.ensureInitialized();
    if (!this.conversationService) throw new Error('Conversation service not initialized');
    return this.conversationService.getLatestUserMessageContent(conversationId);
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.conversationService) throw new Error('Conversation service not initialized');
    return this.conversationService.deleteMessage(messageId);
  }

  async updateConversationUsage(
    conversationId: string,
    cost: number,
    inputToken: number,
    outputToken: number
  ): Promise<void> {
    await this.ensureInitialized();
    if (!this.conversationService) throw new Error('Conversation service not initialized');
    return this.conversationService.updateConversationUsage(
      conversationId,
      cost,
      inputToken,
      outputToken
    );
  }

  async updateConversationSettings(conversationId: string, settings: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.conversationService) throw new Error('Conversation service not initialized');
    return this.conversationService.updateConversationSettings(conversationId, settings);
  }

  async getConversationSettings(conversationId: string): Promise<string | null> {
    await this.ensureInitialized();
    if (!this.conversationService) throw new Error('Conversation service not initialized');
    return this.conversationService.getConversationSettings(conversationId);
  }

  // MCP Server methods
  async createMCPServer(data: import('./database/types').CreateMCPServerData): Promise<string> {
    await this.ensureInitialized();
    if (!this.mcpServerService) throw new Error('MCP Server service not initialized');
    return this.mcpServerService.createMCPServer(data);
  }

  async getMCPServers(): Promise<import('./database/types').MCPServer[]> {
    await this.ensureInitialized();
    if (!this.mcpServerService) throw new Error('MCP Server service not initialized');
    return this.mcpServerService.getMCPServers();
  }

  async getEnabledMCPServers(): Promise<import('./database/types').MCPServer[]> {
    await this.ensureInitialized();
    if (!this.mcpServerService) throw new Error('MCP Server service not initialized');
    return this.mcpServerService.getEnabledMCPServers();
  }

  async getMCPServer(id: string): Promise<import('./database/types').MCPServer | null> {
    await this.ensureInitialized();
    if (!this.mcpServerService) throw new Error('MCP Server service not initialized');
    return this.mcpServerService.getMCPServer(id);
  }

  async updateMCPServer(
    id: string,
    data: import('./database/types').UpdateMCPServerData
  ): Promise<void> {
    await this.ensureInitialized();
    if (!this.mcpServerService) throw new Error('MCP Server service not initialized');
    return this.mcpServerService.updateMCPServer(id, data);
  }

  async deleteMCPServer(id: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.mcpServerService) throw new Error('MCP Server service not initialized');
    return this.mcpServerService.deleteMCPServer(id);
  }

  async enableMCPServer(id: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.mcpServerService) throw new Error('MCP Server service not initialized');
    return this.mcpServerService.enableMCPServer(id);
  }

  async disableMCPServer(id: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.mcpServerService) throw new Error('MCP Server service not initialized');
    return this.mcpServerService.disableMCPServer(id);
  }

  async mcpServerExists(id: string): Promise<boolean> {
    await this.ensureInitialized();
    if (!this.mcpServerService) throw new Error('MCP Server service not initialized');
    return this.mcpServerService.serverExists(id);
  }

  // Active Skills methods
  async getActiveSkills(): Promise<string[]> {
    await this.ensureInitialized();
    const db = await this.getDb();
    const results = await db.select<{ skill_id: string }[]>(
      'SELECT skill_id FROM active_skills ORDER BY created_at ASC'
    );
    return results.map((row) => row.skill_id);
  }

  async setActiveSkills(skillIds: string[]): Promise<void> {
    await this.ensureInitialized();
    const db = await this.getDb();
    const now = Date.now();

    // Delete all existing active skills
    await db.execute('DELETE FROM active_skills');

    // Insert new active skills
    for (const skillId of skillIds) {
      await db.execute('INSERT INTO active_skills (skill_id, created_at) VALUES ($1, $2)', [
        skillId,
        now,
      ]);
    }

    logger.info(`Set ${skillIds.length} active skills`);
  }

  async addActiveSkill(skillId: string): Promise<void> {
    await this.ensureInitialized();
    const db = await this.getDb();
    const now = Date.now();

    try {
      await db.execute('INSERT INTO active_skills (skill_id, created_at) VALUES ($1, $2)', [
        skillId,
        now,
      ]);
      logger.info(`Added active skill: ${skillId}`);
    } catch (_error) {
      // Ignore if already exists (UNIQUE constraint violation)
      logger.debug(`Skill ${skillId} already active`);
    }
  }

  async removeActiveSkill(skillId: string): Promise<void> {
    await this.ensureInitialized();
    const db = await this.getDb();
    await db.execute('DELETE FROM active_skills WHERE skill_id = $1', [skillId]);
    logger.info(`Removed active skill: ${skillId}`);
  }
}

export const databaseService = new DatabaseService();
