/**
 * TaskService Tests
 *
 * Uses real database operations with in-memory SQLite for accurate testing.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
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

describe('TaskService', () => {
  let db: TestDatabaseAdapter;
  let taskService: TaskService;

  beforeEach(() => {
    db = new TestDatabaseAdapter();
    taskService = new TaskService(db.getTursoClientAdapter());
  });

  afterEach(() => {
    db.close();
  });

  describe('createTask', () => {
    it('should create task with correct fields', async () => {
      const title = 'Test Task';
      const taskId = 'test-id-123';
      const projectId = 'default';

      const result = await taskService.createTask(title, taskId, projectId);

      expect(result).toBe(taskId);

      // Verify actual database state
      const rows = db.rawQuery<{ id: string; title: string; project_id: string; message_count: number }>(
        'SELECT id, title, project_id, message_count FROM conversations WHERE id = ?',
        [taskId]
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(taskId);
      expect(rows[0]?.title).toBe(title);
      expect(rows[0]?.project_id).toBe(projectId);
      expect(rows[0]?.message_count).toBe(0);
    });

    it('should use default project_id if not provided', async () => {
      await taskService.createTask('No project', 'no-project-id');

      const rows = db.rawQuery<{ project_id: string }>(
        'SELECT project_id FROM conversations WHERE id = ?',
        ['no-project-id']
      );

      expect(rows[0]?.project_id).toBe('default');
    });

    it('should handle duplicate task ID error', async () => {
      await taskService.createTask('Task 1', 'duplicate-id');

      await expect(taskService.createTask('Task 2', 'duplicate-id')).rejects.toThrow();
    });
  });

  describe('getTasks', () => {
    it('should return all tasks ordered by updated_at DESC', async () => {
      await taskService.createTask('Task 1', 'id-1');
      // Delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));
      await taskService.createTask('Task 2', 'id-2');

      const tasks = await taskService.getTasks();

      expect(tasks).toHaveLength(2);
      expect(tasks[0]?.id).toBe('id-2');
      expect(tasks[1]?.id).toBe('id-1');
    });

    it('should filter tasks by project_id', async () => {
      await taskService.createTask('Default Task', 'id-default', 'default');

      // Create a second project
      db.rawExecute(
        'INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
        ['other', 'Other Project', Date.now(), Date.now()]
      );
      await taskService.createTask('Other Task', 'id-other', 'other');

      const defaultTasks = await taskService.getTasks('default');
      const otherTasks = await taskService.getTasks('other');

      expect(defaultTasks).toHaveLength(1);
      expect(defaultTasks[0]?.id).toBe('id-default');
      expect(otherTasks).toHaveLength(1);
      expect(otherTasks[0]?.id).toBe('id-other');
    });
  });

  describe('updateTaskTitle', () => {
    it('should update task title', async () => {
      await taskService.createTask('Old Title', 'id-update');

      await taskService.updateTaskTitle('id-update', 'New Title');

      const rows = db.rawQuery<{ title: string }>('SELECT title FROM conversations WHERE id = ?', [
        'id-update',
      ]);
      expect(rows[0]?.title).toBe('New Title');
    });

    it('should update updated_at timestamp', async () => {
      await taskService.createTask('Task', 'id-timestamp');
      const firstUpdate = db.rawQuery<{ updated_at: number }>(
        'SELECT updated_at FROM conversations WHERE id = ?',
        ['id-timestamp']
      )[0]?.updated_at;

      await new Promise((resolve) => setTimeout(resolve, 10));
      await taskService.updateTaskTitle('id-timestamp', 'New Title');

      const secondUpdate = db.rawQuery<{ updated_at: number }>(
        'SELECT updated_at FROM conversations WHERE id = ?',
        ['id-timestamp']
      )[0]?.updated_at;

      expect(secondUpdate).toBeGreaterThan(firstUpdate ?? 0);
    });
  });

  describe('saveMessage', () => {
    it('should save message with all fields', async () => {
      await taskService.createTask('Task', 'id-msg');

      const messageId = await taskService.saveMessage('id-msg', 'user', 'Hello assistant', 0);

      expect(messageId).toBeDefined();

      const rows = db.rawQuery<{ role: string; content: string; conversation_id: string }>(
        'SELECT role, content, conversation_id FROM messages WHERE id = ?',
        [messageId]
      );
      expect(rows[0]?.role).toBe('user');
      expect(rows[0]?.content).toBe('Hello assistant');
      expect(rows[0]?.conversation_id).toBe('id-msg');
    });

    it('should increment message_count', async () => {
      await taskService.createTask('Task', 'id-count');

      await taskService.saveMessage('id-count', 'user', 'Msg 1', 0);
      await taskService.saveMessage('id-count', 'assistant', 'Msg 2', 1);

      const rows = db.rawQuery<{ message_count: number }>(
        'SELECT message_count FROM conversations WHERE id = ?',
        ['id-count']
      );
      expect(rows[0]?.message_count).toBe(2);
    });

    it('should use provided messageId', async () => {
      await taskService.createTask('Task', 'id-custom');
      const customId = 'custom-msg-id';

      await taskService.saveMessage(
        'id-custom',
        'user',
        'Content',
        0,
        undefined,
        undefined,
        customId
      );

      const rows = db.rawQuery('SELECT id FROM messages WHERE id = ?', [customId]);
      expect(rows).toHaveLength(1);
    });
  });

  describe('updateMessage', () => {
    it('should update message content', async () => {
      await taskService.createTask('Task', 'id-msg-upd');
      const msgId = await taskService.saveMessage('id-msg-upd', 'user', 'Old content', 0);

      await taskService.updateMessage(msgId, 'New content');

      const rows = db.rawQuery<{ content: string }>('SELECT content FROM messages WHERE id = ?', [
        msgId,
      ]);
      expect(rows[0]?.content).toBe('New content');
    });
  });

  describe('getMessages', () => {
    it('should return messages ordered by timestamp ASC', async () => {
      await taskService.createTask('Task', 'id-msgs');

      await taskService.saveMessage('id-msgs', 'user', 'First', 0);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await taskService.saveMessage('id-msgs', 'assistant', 'Second', 1);

      const messages = await taskService.getMessages('id-msgs');

      expect(messages).toHaveLength(2);
      expect(messages[0]?.content).toBe('First');
      expect(messages[1]?.content).toBe('Second');
    });
  });

  describe('deleteTask', () => {
    it('should delete task and all messages', async () => {
      await taskService.createTask('Task', 'id-del');
      await taskService.saveMessage('id-del', 'user', 'Msg', 0);

      await taskService.deleteTask('id-del');

      const tasks = db.rawQuery('SELECT id FROM conversations WHERE id = ?', ['id-del']);
      const messages = db.rawQuery('SELECT id FROM messages WHERE conversation_id = ?', ['id-del']);

      expect(tasks).toHaveLength(0);
      expect(messages).toHaveLength(0);
    });
  });

  describe('getLatestUserMessageContent', () => {
    it('should return latest user message', async () => {
      await taskService.createTask('Task', 'id-latest');
      await taskService.saveMessage('id-latest', 'user', 'First', 0);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await taskService.saveMessage('id-latest', 'assistant', 'Reply', 1);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await taskService.saveMessage('id-latest', 'user', 'Second', 2);

      const latest = await taskService.getLatestUserMessageContent('id-latest');
      expect(latest).toBe('Second');
    });

    it('should return null if no user messages', async () => {
      await taskService.createTask('Task', 'id-none');
      await taskService.saveMessage('id-none', 'assistant', 'Hello', 0);

      const latest = await taskService.getLatestUserMessageContent('id-none');
      expect(latest).toBeNull();
    });
  });

  describe('updateTaskUsage', () => {
    it('should accumulate usage values', async () => {
      await taskService.createTask('Task', 'id-usage');

      await taskService.updateTaskUsage('id-usage', 0.1, 10, 5, 50);
      await taskService.updateTaskUsage('id-usage', 0.2, 20, 10, 75);

      const rows = db.rawQuery<{
        cost: number;
        input_token: number;
        output_token: number;
        context_usage: number | null;
      }>('SELECT cost, input_token, output_token, context_usage FROM conversations WHERE id = ?', [
        'id-usage',
      ]);

      expect(rows[0]?.cost).toBeCloseTo(0.3);
      expect(rows[0]?.input_token).toBe(30);
      expect(rows[0]?.output_token).toBe(15);
      expect(rows[0]?.context_usage).toBe(75);
    });
  });

  describe('updateTaskSettings / getTaskSettings', () => {
    it('should save and retrieve settings', async () => {
      await taskService.createTask('Task', 'id-settings');
      const settings = { model: 'gpt-4', temperature: 0.7 };

      await taskService.updateTaskSettings('id-settings', settings);
      const retrieved = await taskService.getTaskSettings('id-settings');

      // getTaskSettings returns raw string, caller should parse it
      expect(retrieved).toEqual(JSON.stringify(settings));
    });

    it('should return null if no settings', async () => {
      await taskService.createTask('Task', 'id-no-settings');
      const retrieved = await taskService.getTaskSettings('id-no-settings');
      expect(retrieved).toBeNull();
    });
  });

  describe('Concurrent operations', () => {
    it('should handle concurrent saveMessage and updateTaskTitle', async () => {
      await taskService.createTask('Initial', 'id-concurrent');

      await Promise.all([
        taskService.saveMessage('id-concurrent', 'user', 'Msg', 0),
        taskService.updateTaskTitle('id-concurrent', 'Updated'),
      ]);

      const task = (await taskService.getTasks()).find((t) => t.id === 'id-concurrent');
      expect(task?.title).toBe('Updated');
      expect(task?.message_count).toBe(1);
    });

    it('should handle multiple concurrent message saves', async () => {
      await taskService.createTask('Task', 'id-concurrent-msgs');

      await Promise.all([
        taskService.saveMessage('id-concurrent-msgs', 'user', 'Msg 1', 0),
        taskService.saveMessage('id-concurrent-msgs', 'user', 'Msg 2', 1),
        taskService.saveMessage('id-concurrent-msgs', 'user', 'Msg 3', 2),
      ]);

      const task = (await taskService.getTasks()).find((t) => t.id === 'id-concurrent-msgs');
      expect(task?.message_count).toBe(3);
    });
  });
});
