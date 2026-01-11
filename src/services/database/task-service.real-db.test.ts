/**
 * TaskService Tests with Real Database
 *
 * This test demonstrates how to use the new test infrastructure
 * with real database operations instead of mocks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskService } from './task-service';
import { TestDatabaseAdapter } from '@/test/infrastructure/adapters/test-database-adapter';
import { mockLogger } from '@/test/mocks';

vi.mock('@/lib/logger', () => mockLogger);

vi.mock('@/lib/timer', () => ({
  timedMethod: () => (_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor) =>
    descriptor,
}));

// Mock file service (we don't want real file operations for attachments)
vi.mock('@/services/file-service', () => ({
  fileService: {
    deleteAttachmentFile: vi.fn().mockResolvedValue(undefined),
    getFileBase64: vi.fn().mockResolvedValue('base64content'),
  },
}));

describe('TaskService with Real Database', () => {
  let db: TestDatabaseAdapter;
  let taskService: TaskService;

  beforeEach(() => {
    // Create a real in-memory database for each test
    db = new TestDatabaseAdapter({ enableLogging: false });
    taskService = new TaskService(db.getTursoClientAdapter());
  });

  afterEach(() => {
    db.close();
  });

  describe('createTask', () => {
    it('should create a task and persist to database', async () => {
      const taskId = 'task-001';
      const title = 'Test Task';

      const result = await taskService.createTask(title, taskId, 'default');

      expect(result).toBe(taskId);

      // Verify the task was actually inserted into the database
      const rows = db.rawQuery<{ id: string; title: string; project_id: string }>(
        'SELECT id, title, project_id FROM conversations WHERE id = ?',
        [taskId]
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(taskId);
      expect(rows[0]?.title).toBe(title);
      expect(rows[0]?.project_id).toBe('default');
    });

    it('should set correct timestamps on creation', async () => {
      const before = Date.now();
      await taskService.createTask('Test Task', 'task-002', 'default');
      const after = Date.now();

      const rows = db.rawQuery<{ created_at: number; updated_at: number }>(
        'SELECT created_at, updated_at FROM conversations WHERE id = ?',
        ['task-002']
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.created_at).toBeGreaterThanOrEqual(before);
      expect(rows[0]?.created_at).toBeLessThanOrEqual(after);
      expect(rows[0]?.updated_at).toBe(rows[0]?.created_at);
    });

    it('should initialize message_count to 0', async () => {
      await taskService.createTask('Test Task', 'task-003', 'default');

      const rows = db.rawQuery<{ message_count: number }>(
        'SELECT message_count FROM conversations WHERE id = ?',
        ['task-003']
      );

      expect(rows[0]?.message_count).toBe(0);
    });
  });

  describe('getTasks', () => {
    it('should return all tasks', async () => {
      await taskService.createTask('Task 1', 'task-a', 'default');
      await taskService.createTask('Task 2', 'task-b', 'default');
      await taskService.createTask('Task 3', 'task-c', 'default');

      const tasks = await taskService.getTasks();

      expect(tasks).toHaveLength(3);
    });

    it('should filter tasks by project_id', async () => {
      // Create a second project first
      db.rawExecute(
        'INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ['project-2', 'Project 2', '', Date.now(), Date.now()]
      );

      await taskService.createTask('Task in Default', 'task-d1', 'default');
      await taskService.createTask('Task in Project 2', 'task-p2', 'project-2');

      const defaultTasks = await taskService.getTasks('default');
      const project2Tasks = await taskService.getTasks('project-2');

      expect(defaultTasks).toHaveLength(1);
      expect(defaultTasks[0]?.title).toBe('Task in Default');

      expect(project2Tasks).toHaveLength(1);
      expect(project2Tasks[0]?.title).toBe('Task in Project 2');
    });

    it('should return tasks ordered by updated_at DESC', async () => {
      await taskService.createTask('First', 'task-1', 'default');
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));
      await taskService.createTask('Second', 'task-2', 'default');
      await new Promise((resolve) => setTimeout(resolve, 10));
      await taskService.createTask('Third', 'task-3', 'default');

      const tasks = await taskService.getTasks();

      expect(tasks[0]?.title).toBe('Third');
      expect(tasks[1]?.title).toBe('Second');
      expect(tasks[2]?.title).toBe('First');
    });
  });

  describe('updateTaskTitle', () => {
    it('should update the task title', async () => {
      await taskService.createTask('Original Title', 'task-upd', 'default');

      await taskService.updateTaskTitle('task-upd', 'New Title');

      const rows = db.rawQuery<{ title: string }>('SELECT title FROM conversations WHERE id = ?', [
        'task-upd',
      ]);

      expect(rows[0]?.title).toBe('New Title');
    });

    it('should update the updated_at timestamp', async () => {
      await taskService.createTask('Title', 'task-upd2', 'default');

      const beforeUpdate = db.rawQuery<{ updated_at: number }>(
        'SELECT updated_at FROM conversations WHERE id = ?',
        ['task-upd2']
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      await taskService.updateTaskTitle('task-upd2', 'New Title');

      const afterUpdate = db.rawQuery<{ updated_at: number }>(
        'SELECT updated_at FROM conversations WHERE id = ?',
        ['task-upd2']
      );

      expect(afterUpdate[0]?.updated_at).toBeGreaterThan(beforeUpdate[0]?.updated_at ?? 0);
    });
  });

  describe('saveMessage', () => {
    it('should save a message to the task', async () => {
      await taskService.createTask('Task', 'task-msg', 'default');

      const messageId = await taskService.saveMessage('task-msg', 'user', 'Hello world', 0);

      expect(messageId).toBeDefined();

      const messages = db.rawQuery<{ role: string; content: string }>(
        'SELECT role, content FROM messages WHERE conversation_id = ?',
        ['task-msg']
      );

      expect(messages).toHaveLength(1);
      expect(messages[0]?.role).toBe('user');
      expect(messages[0]?.content).toBe('Hello world');
    });

    it('should increment message_count', async () => {
      await taskService.createTask('Task', 'task-msg2', 'default');

      await taskService.saveMessage('task-msg2', 'user', 'Message 1', 0);
      await taskService.saveMessage('task-msg2', 'assistant', 'Message 2', 1);

      const rows = db.rawQuery<{ message_count: number }>(
        'SELECT message_count FROM conversations WHERE id = ?',
        ['task-msg2']
      );

      expect(rows[0]?.message_count).toBe(2);
    });

    it('should use provided messageId if given', async () => {
      await taskService.createTask('Task', 'task-msg3', 'default');

      const customId = 'my-custom-id';
      const returnedId = await taskService.saveMessage(
        'task-msg3',
        'user',
        'Hello',
        0,
        undefined,
        undefined,
        customId
      );

      expect(returnedId).toBe(customId);

      const messages = db.rawQuery<{ id: string }>('SELECT id FROM messages WHERE id = ?', [
        customId,
      ]);

      expect(messages).toHaveLength(1);
    });
  });

  describe('getMessages', () => {
    it('should return messages ordered by timestamp', async () => {
      await taskService.createTask('Task', 'task-get', 'default');

      await taskService.saveMessage('task-get', 'user', 'First', 0);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await taskService.saveMessage('task-get', 'assistant', 'Second', 1);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await taskService.saveMessage('task-get', 'user', 'Third', 2);

      const messages = await taskService.getMessages('task-get');

      expect(messages).toHaveLength(3);
      expect(messages[0]?.content).toBe('First');
      expect(messages[1]?.content).toBe('Second');
      expect(messages[2]?.content).toBe('Third');
    });
  });

  describe('deleteTask', () => {
    it('should delete task and all associated messages', async () => {
      await taskService.createTask('Task to Delete', 'task-del', 'default');
      await taskService.saveMessage('task-del', 'user', 'Message 1', 0);
      await taskService.saveMessage('task-del', 'assistant', 'Message 2', 1);

      // Verify task and messages exist
      let tasks = db.rawQuery('SELECT * FROM conversations WHERE id = ?', ['task-del']);
      let messages = db.rawQuery('SELECT * FROM messages WHERE conversation_id = ?', ['task-del']);
      expect(tasks).toHaveLength(1);
      expect(messages).toHaveLength(2);

      // Delete the task
      await taskService.deleteTask('task-del');

      // Verify task and messages are deleted
      tasks = db.rawQuery('SELECT * FROM conversations WHERE id = ?', ['task-del']);
      messages = db.rawQuery('SELECT * FROM messages WHERE conversation_id = ?', ['id-del']); // Wait, checking id-del here? The original test had this but let's fix it to task-del
      // Original code said: messages = db.rawQuery('SELECT * FROM messages WHERE conversation_id = ?', ['task-del']);
      // Re-reading original... it was 'task-del'. I made a typo in my thoughts.
      messages = db.rawQuery('SELECT * FROM messages WHERE conversation_id = ?', ['task-del']);
      expect(tasks).toHaveLength(0);
      expect(messages).toHaveLength(0);
    });
  });

  describe('concurrent operations', () => {
    it('should handle concurrent saveMessage and updateTitle without conflicts', async () => {
      await taskService.createTask('Initial Title', 'task-concurrent', 'default');

      // Execute operations concurrently
      await Promise.all([
        taskService.saveMessage('task-concurrent', 'user', 'Concurrent message', 0),
        taskService.updateTaskTitle('task-concurrent', 'Updated Title'),
      ]);

      // Verify both operations succeeded
      const task = await taskService.getTaskDetails('task-concurrent');
      const messages = await taskService.getMessages('task-concurrent');

      expect(task?.title).toBe('Updated Title');
      expect(messages).toHaveLength(1);
      expect(messages[0]?.content).toBe('Concurrent message');
    });
  });

  describe('updateTaskUsage', () => {
    it('should accumulate usage values', async () => {
      await taskService.createTask('Task', 'task-usage', 'default');

      await taskService.updateTaskUsage('task-usage', 0.01, 100, 50, 40);
      await taskService.updateTaskUsage('task-usage', 0.02, 200, 100, 60);

      const rows = db.rawQuery<{
        cost: number;
        input_token: number;
        output_token: number;
        context_usage: number | null;
      }>('SELECT cost, input_token, output_token, context_usage FROM conversations WHERE id = ?', [
        'task-usage',
      ]);

      expect(rows[0]?.cost).toBeCloseTo(0.03, 5);
      expect(rows[0]?.input_token).toBe(300);
      expect(rows[0]?.output_token).toBe(150);
      expect(rows[0]?.context_usage).toBe(60);
    });
  });
});
