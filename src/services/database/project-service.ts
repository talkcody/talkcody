// src/services/database/project-service.ts

import { timedMethod } from '@/lib/timer';
import { generateId } from '@/lib/utils';
import type { CreateProjectData, Project, UpdateProjectData } from '@/types';
import type { TursoClient } from './turso-client';

export class ProjectService {
  constructor(private db: TursoClient) {}

  @timedMethod('createProject')
  async createProject(data: CreateProjectData): Promise<string> {
    const projectId = generateId();
    const now = Date.now();

    await this.db.execute(
      'INSERT INTO projects (id, name, description, created_at, updated_at, context, rules, root_path) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [
        projectId,
        data.name,
        data.description || '',
        now,
        now,
        data.context || '',
        data.rules || '',
        data.root_path || null,
      ]
    );

    return projectId;
  }

  @timedMethod('getProjects')
  async getProjects(): Promise<Project[]> {
    const result = await this.db.select<Project[]>(
      'SELECT * FROM projects ORDER BY updated_at DESC'
    );

    return result;
  }

  async getProject(projectId: string): Promise<Project> {
    const result = await this.db.select<Project[]>('SELECT * FROM projects WHERE id = $1', [
      projectId,
    ]);

    const project = result[0];
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }

  @timedMethod('updateProject')
  async updateProject(projectId: string, data: UpdateProjectData): Promise<void> {
    const now = Date.now();
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }

    if (data.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(data.description);
    }

    if (data.context !== undefined) {
      updates.push(`context = $${paramIndex++}`);
      values.push(data.context);
    }

    if (data.rules !== undefined) {
      updates.push(`rules = $${paramIndex++}`);
      values.push(data.rules);
    }

    if (data.root_path !== undefined) {
      updates.push(`root_path = $${paramIndex++}`);
      values.push(data.root_path || null);
    }

    if (updates.length === 0) return;

    updates.push(`updated_at = $${paramIndex++}`);
    values.push(now);
    values.push(projectId);

    const sql = `UPDATE projects SET ${updates.join(', ')} WHERE id = $${paramIndex}`;

    await this.db.execute(sql, values);
  }

  @timedMethod('deleteProject')
  async deleteProject(projectId: string): Promise<void> {
    if (projectId === 'default') {
      throw new Error('Cannot delete default project');
    }

    // Move all conversations to default project before deleting
    await this.db.execute('UPDATE conversations SET project_id = $1 WHERE project_id = $2', [
      'default',
      projectId,
    ]);

    await this.db.execute('DELETE FROM projects WHERE id = $1', [projectId]);
  }

  async getProjectStats(projectId: string): Promise<{ taskCount: number }> {
    const taskResult = await this.db.select<{ count: number }[]>(
      'SELECT COUNT(*) as count FROM conversations WHERE project_id = $1',
      [projectId]
    );

    return {
      taskCount: taskResult[0]?.count || 0,
    };
  }

  @timedMethod('getProjectByRootPath')
  async getProjectByRootPath(rootPath: string): Promise<Project | null> {
    const result = await this.db.select<Project[]>('SELECT * FROM projects WHERE root_path = $1', [
      rootPath,
    ]);

    return result[0] || null;
  }

  @timedMethod('createOrGetProjectForRepository')
  async createOrGetProjectForRepository(rootPath: string): Promise<Project> {
    // First, check if a project already exists for this repository
    const existingProject = await this.getProjectByRootPath(rootPath);
    if (existingProject) {
      return existingProject;
    }

    // Extract repository name from path
    const pathSegments = rootPath.split(/[/\\]/);
    const repoName = pathSegments[pathSegments.length - 1] || 'Unnamed Repository';

    // Create a new project for this repository
    const projectId = await this.createProject({
      name: repoName,
      description: `Project for repository: ${rootPath}`,
      root_path: rootPath,
      context: '',
      rules: '',
    });

    // Return the newly created project
    return await this.getProject(projectId);
  }

  @timedMethod('clearRepositoryPath')
  async clearRepositoryPath(projectId: string): Promise<void> {
    // Use null to explicitly clear the field (undefined would be ignored by updateProject)
    await this.updateProject(projectId, { root_path: null as unknown as string });
  }

  @timedMethod('getProjectByRepositoryPath')
  async getProjectByRepositoryPath(rootPath: string): Promise<Project | null> {
    return await this.getProjectByRootPath(rootPath);
  }
}
