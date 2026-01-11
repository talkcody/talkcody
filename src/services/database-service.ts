// src/services/database-service.ts

import { logger } from '@/lib/logger';
import { MCPServerService } from '@/lib/mcp/mcp-server-service';
import type { MessageAttachment } from '@/types/agent';
import { ProjectService } from './database/project-service';
import { type RecentFile, RecentFilesService } from './database/recent-files-service';
import { type RecentProject, RecentProjectsService } from './database/recent-projects-service';
import { TaskService } from './database/task-service';
import { loadDatabase, type TursoClient } from './database/turso-client';
import { TursoDatabaseInit } from './database/turso-database-init';

// Re-export types
export type {
  CreateMCPServerData,
  CreateProjectData,
  CreateTodoItem,
  MCPServer,
  Project,
  StoredAttachment,
  StoredMessage,
  Task,
  TodoItem,
  UpdateMCPServerData,
  UpdateProjectData,
} from '@/types';

export class DatabaseService {
  private db: TursoClient | null = null;
  private initializationPromise: Promise<void> | null = null;
  private isInitialized = false;

  private projectService: ProjectService | null = null;
  private taskService: TaskService | null = null;
  private mcpServerService: MCPServerService | null = null;
  private recentFilesService: RecentFilesService | null = null;
  private recentProjectsService: RecentProjectsService | null = null;

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
      this.taskService = new TaskService(this.db);
      this.mcpServerService = new MCPServerService(this.db);
      this.recentFilesService = new RecentFilesService(this.db);
      this.recentProjectsService = new RecentProjectsService(this.db);

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
  async createProject(data: import('@/types').CreateProjectData): Promise<string> {
    await this.ensureInitialized();
    if (!this.projectService) throw new Error('Project service not initialized');
    return this.projectService.createProject(data);
  }

  async getProjects(): Promise<import('@/types').Project[]> {
    await this.ensureInitialized();
    if (!this.projectService) throw new Error('Project service not initialized');
    return this.projectService.getProjects();
  }

  async getProject(projectId: string): Promise<import('@/types').Project> {
    await this.ensureInitialized();
    if (!this.projectService) throw new Error('Project service not initialized');
    return this.projectService.getProject(projectId);
  }

  async updateProject(projectId: string, data: import('@/types').UpdateProjectData): Promise<void> {
    await this.ensureInitialized();
    if (!this.projectService) throw new Error('Project service not initialized');
    return this.projectService.updateProject(projectId, data);
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.projectService) throw new Error('Project service not initialized');
    return this.projectService.deleteProject(projectId);
  }

  async getProjectStats(projectId: string): Promise<{ taskCount: number }> {
    await this.ensureInitialized();
    if (!this.projectService) throw new Error('Project service not initialized');
    return this.projectService.getProjectStats(projectId);
  }

  async getProjectByRootPath(rootPath: string): Promise<import('@/types').Project | null> {
    await this.ensureInitialized();
    if (!this.projectService) throw new Error('Project service not initialized');
    return this.projectService.getProjectByRootPath(rootPath);
  }

  async createOrGetProjectForRepository(rootPath: string): Promise<import('@/types').Project> {
    await this.ensureInitialized();
    if (!this.projectService) throw new Error('Project service not initialized');
    return this.projectService.createOrGetProjectForRepository(rootPath);
  }

  async clearRepositoryPath(projectId: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.projectService) throw new Error('Project service not initialized');
    return this.projectService.clearRepositoryPath(projectId);
  }

  async getProjectByRepositoryPath(rootPath: string): Promise<import('@/types').Project | null> {
    await this.ensureInitialized();
    if (!this.projectService) throw new Error('Project service not initialized');
    return this.projectService.getProjectByRepositoryPath(rootPath);
  }

  // Task methods
  async createTask(title: string, taskId: string, projectId = 'default'): Promise<string> {
    await this.ensureInitialized();
    if (!this.taskService) throw new Error('Task service not initialized');
    return this.taskService.createTask(title, taskId, projectId);
  }

  async getTasks(projectId?: string): Promise<import('@/types').Task[]> {
    await this.ensureInitialized();
    if (!this.taskService) throw new Error('Task service not initialized');
    return this.taskService.getTasks(projectId);
  }

  async getTasksWithPagination(
    projectId?: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<import('@/types').Task[]> {
    await this.ensureInitialized();
    if (!this.taskService) throw new Error('Task service not initialized');
    return this.taskService.getTasksWithPagination(projectId, limit, offset);
  }

  async searchTasksWithPagination(
    searchTerm: string,
    projectId?: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<import('@/types').Task[]> {
    await this.ensureInitialized();
    if (!this.taskService) throw new Error('Task service not initialized');
    return this.taskService.searchTasksWithPagination(searchTerm, projectId, limit, offset);
  }

  async getTaskDetails(taskId: string): Promise<import('@/types').Task | null> {
    await this.ensureInitialized();
    if (!this.taskService) throw new Error('Task service not initialized');
    return this.taskService.getTaskDetails(taskId);
  }

  async updateTaskTitle(taskId: string, title: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.taskService) throw new Error('Task service not initialized');
    return this.taskService.updateTaskTitle(taskId, title);
  }

  async updateTaskProject(taskId: string, projectId: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.taskService) throw new Error('Task service not initialized');
    return this.taskService.updateTaskProject(taskId, projectId);
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.taskService) throw new Error('Task service not initialized');
    return this.taskService.deleteTask(taskId);
  }

  async saveMessage(
    taskId: string,
    role: 'user' | 'assistant' | 'tool',
    content: string,
    positionIndex: number,
    assistant_id?: string,
    attachments?: MessageAttachment[],
    messageId?: string
  ): Promise<string> {
    await this.ensureInitialized();
    if (!this.taskService) throw new Error('Task service not initialized');
    return this.taskService.saveMessage(
      taskId,
      role,
      content,
      positionIndex,
      assistant_id,
      attachments,
      messageId
    );
  }

  async getMessages(taskId: string): Promise<import('@/types').StoredMessage[]> {
    await this.ensureInitialized();
    if (!this.taskService) throw new Error('Task service not initialized');
    return this.taskService.getMessages(taskId);
  }

  async getAttachmentsForMessage(messageId: string): Promise<MessageAttachment[]> {
    await this.ensureInitialized();
    if (!this.taskService) throw new Error('Task service not initialized');
    return this.taskService.getAttachmentsForMessage(messageId);
  }

  async updateMessage(messageId: string, content: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.taskService) throw new Error('Task service not initialized');
    return this.taskService.updateMessage(messageId, content);
  }

  async saveAttachment(messageId: string, attachment: MessageAttachment): Promise<void> {
    await this.ensureInitialized();
    if (!this.taskService) throw new Error('Task service not initialized');
    return this.taskService.saveAttachment(messageId, attachment);
  }

  async getLatestUserMessageContent(taskId: string): Promise<string | null> {
    await this.ensureInitialized();
    if (!this.taskService) throw new Error('Task service not initialized');
    return this.taskService.getLatestUserMessageContent(taskId);
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.taskService) throw new Error('Task service not initialized');
    return this.taskService.deleteMessage(messageId);
  }

  async updateTaskUsage(
    taskId: string,
    cost: number,
    inputToken: number,
    outputToken: number,
    contextUsage?: number
  ): Promise<void> {
    await this.ensureInitialized();
    if (!this.taskService) throw new Error('Task service not initialized');
    return this.taskService.updateTaskUsage(taskId, cost, inputToken, outputToken, contextUsage);
  }

  async updateTaskSettings(taskId: string, settings: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.taskService) throw new Error('Task service not initialized');
    return this.taskService.updateTaskSettings(taskId, settings);
  }

  async getTaskSettings(taskId: string): Promise<string | null> {
    await this.ensureInitialized();
    if (!this.taskService) throw new Error('Task service not initialized');
    return this.taskService.getTaskSettings(taskId);
  }

  // MCP Server methods
  async createMCPServer(data: import('@/types').CreateMCPServerData): Promise<string> {
    await this.ensureInitialized();
    if (!this.mcpServerService) throw new Error('MCP Server service not initialized');
    return this.mcpServerService.createMCPServer(data);
  }

  async getMCPServers(): Promise<import('@/types').MCPServer[]> {
    await this.ensureInitialized();
    if (!this.mcpServerService) throw new Error('MCP Server service not initialized');
    return this.mcpServerService.getMCPServers();
  }

  async getEnabledMCPServers(): Promise<import('@/types').MCPServer[]> {
    await this.ensureInitialized();
    if (!this.mcpServerService) throw new Error('MCP Server service not initialized');
    return this.mcpServerService.getEnabledMCPServers();
  }

  async getMCPServer(id: string): Promise<import('@/types').MCPServer | null> {
    await this.ensureInitialized();
    if (!this.mcpServerService) throw new Error('MCP Server service not initialized');
    return this.mcpServerService.getMCPServer(id);
  }

  async updateMCPServer(id: string, data: import('@/types').UpdateMCPServerData): Promise<void> {
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

  // Recent Files methods
  async addRecentFile(filePath: string, repositoryPath: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.recentFilesService) throw new Error('Recent files service not initialized');
    return this.recentFilesService.addRecentFile(filePath, repositoryPath);
  }

  async getRecentFiles(repositoryPath: string, limit = 50): Promise<RecentFile[]> {
    await this.ensureInitialized();
    if (!this.recentFilesService) throw new Error('Recent files service not initialized');
    return this.recentFilesService.getRecentFiles(repositoryPath, limit);
  }

  async clearRecentFiles(repositoryPath: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.recentFilesService) throw new Error('Recent files service not initialized');
    return this.recentFilesService.clearRecentFiles(repositoryPath);
  }

  // Recent Projects methods (for dock menu)
  async trackProjectOpened(
    projectId: string,
    projectName: string,
    rootPath: string
  ): Promise<void> {
    await this.ensureInitialized();
    if (!this.recentProjectsService) throw new Error('Recent projects service not initialized');
    return this.recentProjectsService.trackProjectOpened(projectId, projectName, rootPath);
  }

  async getRecentProjects(limit = 5): Promise<RecentProject[]> {
    await this.ensureInitialized();
    if (!this.recentProjectsService) throw new Error('Recent projects service not initialized');
    return this.recentProjectsService.getRecentProjects(limit);
  }

  async removeRecentProject(projectId: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.recentProjectsService) throw new Error('Recent projects service not initialized');
    return this.recentProjectsService.removeProject(projectId);
  }

  async clearRecentProjects(): Promise<void> {
    await this.ensureInitialized();
    if (!this.recentProjectsService) throw new Error('Recent projects service not initialized');
    return this.recentProjectsService.clearRecentProjects();
  }
}

export type { RecentFile, RecentProject };

export const databaseService = new DatabaseService();
