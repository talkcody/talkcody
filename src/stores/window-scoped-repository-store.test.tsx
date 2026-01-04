import { renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { RepositoryStoreProvider, useRepositoryStore } from './window-scoped-repository-store';
import { settingsManager } from './settings-store';
import { clearAllTrackedFiles } from '@/utils/file-write-tracker';

// Mock all external dependencies
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('./settings-store', () => ({
  settingsManager: {
    setCurrentRootPath: vi.fn(),
    getCurrentRootPath: vi.fn().mockReturnValue(''),
    setCurrentProjectId: vi.fn().mockResolvedValue(undefined),
  },
  useSettingsStore: {
    getState: vi.fn().mockReturnValue({ language: 'en' }),
  },
}));

vi.mock('@/services/repository-service', () => ({
  repositoryService: {
    buildDirectoryTree: vi.fn().mockResolvedValue({
      path: '/test/path',
      name: 'test',
      is_directory: true,
      children: [],
    }),
    clearCache: vi.fn(),
    selectRepositoryFolder: vi.fn(),
    readFileWithCache: vi.fn(),
    writeFile: vi.fn(),
    invalidateCache: vi.fn(),
    getFileNameFromPath: vi.fn((path: string) => path.split('/').pop()),
  },
}));

vi.mock('@/services/fast-directory-tree-service', () => ({
  fastDirectoryTreeService: {
    clearCache: vi.fn().mockResolvedValue(undefined),
    loadDirectoryChildren: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/services/database-service', () => ({
  databaseService: {
    createOrGetProjectForRepository: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'Test Project' }),
  },
}));

vi.mock('@/services/window-manager-service', () => ({
  WindowManagerService: {
    getCurrentWindowLabel: vi.fn().mockResolvedValue('main'),
    updateWindowProject: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/window-restore-service', () => ({
  WindowRestoreService: {
    saveCurrentWindowState: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('window-scoped-repository-store - selectRepository UI freeze bug', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <RepositoryStoreProvider>{children}</RepositoryStoreProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  it('should return immediately without blocking UI when selecting repository', async () => {
    const { repositoryService } = await import('@/services/repository-service');
    const { databaseService } = await import('@/services/database-service');

    vi.mocked(repositoryService.selectRepositoryFolder).mockResolvedValue('/test/new-project');
    vi.mocked(repositoryService.buildDirectoryTree).mockImplementation(
      () =>
        new Promise((resolve) => {
          // Simulate slow directory tree building (500ms)
          setTimeout(() => {
            resolve({
              path: '/test/new-project',
              name: 'new-project',
              is_directory: true,
              children: [],
            });
          }, 500);
        })
    );

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    const startTime = Date.now();
    const selectRepositoryPromise = result.current.selectRepository();

    // selectRepository should return quickly (before tree building completes)
    const project = await selectRepositoryPromise;
    const endTime = Date.now();
    const duration = endTime - startTime;

    // Should return in less than 200ms (not wait for 500ms tree building)
    expect(duration).toBeLessThan(200);
    expect(project).toEqual({ id: 'proj-1', name: 'Test Project' });
    expect(databaseService.createOrGetProjectForRepository).toHaveBeenCalledWith('/test/new-project');
  });

  it('should run openRepository in background without blocking', async () => {
    const { repositoryService } = await import('@/services/repository-service');

    vi.mocked(repositoryService.selectRepositoryFolder).mockResolvedValue('/test/background-project');

    let treeBuilt = false;
    vi.mocked(repositoryService.buildDirectoryTree).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            treeBuilt = true;
            resolve({
              path: '/test/background-project',
              name: 'background-project',
              is_directory: true,
              children: [],
            });
          }, 300);
        })
    );

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    const project = await result.current.selectRepository();

    // selectRepository should return before tree building completes
    expect(project).toBeDefined();
    expect(treeBuilt).toBe(false);

    // Wait for background operation to complete
    await waitFor(
      () => {
        expect(treeBuilt).toBe(true);
      },
      { timeout: 500 }
    );

    // Verify tree is built and loaded in background
    await waitFor(
      () => {
        expect(result.current.fileTree).toBeDefined();
        expect(result.current.rootPath).toBe('/test/background-project');
      },
      { timeout: 200 }
    );
  });

  it('should handle errors in openRepository without affecting selectRepository return', async () => {
    const { repositoryService } = await import('@/services/repository-service');

    vi.mocked(repositoryService.selectRepositoryFolder).mockResolvedValue('/test/error-project');
    vi.mocked(repositoryService.buildDirectoryTree).mockRejectedValue(new Error('Tree build failed'));

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    // selectRepository should still return project even if openRepository fails
    const project = await result.current.selectRepository();
    expect(project).toEqual({ id: 'proj-1', name: 'Test Project' });

    // Wait for error handling in background and check store state
    await waitFor(
      () => {
        expect(result.current.error).toBeTruthy();
        expect(result.current.isLoading).toBe(false);
      },
      { timeout: 300 }
    );
  });

  it('should allow calling openRepository with different path', async () => {
    const { repositoryService } = await import('@/services/repository-service');

    vi.mocked(repositoryService.selectRepositoryFolder).mockResolvedValue('/test/first-project');
    vi.mocked(repositoryService.buildDirectoryTree).mockResolvedValue({
      path: '/test/first-project',
      name: 'first-project',
      is_directory: true,
      children: [],
    });

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    // Call selectRepository
    const project = await result.current.selectRepository();
    expect(project).toEqual({ id: 'proj-1', name: 'Test Project' });

    // Wait for openRepository to complete
    await waitFor(() => {
      expect(result.current.fileTree).toBeDefined();
      expect(repositoryService.buildDirectoryTree).toHaveBeenCalled();
    });
  });

  it('should update settings and return project correctly', async () => {
    const { repositoryService } = await import('@/services/repository-service');
    const { databaseService } = await import('@/services/database-service');

    vi.mocked(repositoryService.selectRepositoryFolder).mockResolvedValue('/test/settings-project');
    vi.mocked(repositoryService.buildDirectoryTree).mockResolvedValue({
      path: '/test/settings-project',
      name: 'settings-project',
      is_directory: true,
      children: [],
    });
    vi.mocked(databaseService.createOrGetProjectForRepository).mockResolvedValue({
      id: 'proj-settings',
      name: 'Settings Project',
    });

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    const project = await result.current.selectRepository();

    expect(project).toEqual({ id: 'proj-settings', name: 'Settings Project' });
    expect(databaseService.createOrGetProjectForRepository).toHaveBeenCalledWith('/test/settings-project');

    // Settings should be updated in background when openRepository runs
    await waitFor(
      () => {
        expect(settingsManager.setCurrentRootPath).toHaveBeenCalledWith('/test/settings-project');
        expect(result.current.fileTree).toBeDefined();
      },
      { timeout: 300 }
    );
  });

  it('should return null when user cancels repository selection', async () => {
    const { repositoryService } = await import('@/services/repository-service');

    vi.mocked(repositoryService.selectRepositoryFolder).mockResolvedValue(null);

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    const project = await result.current.selectRepository();

    expect(project).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(repositoryService.buildDirectoryTree).not.toHaveBeenCalled();
  });

  it('should skip opening same path that is already open', async () => {
    const { repositoryService } = await import('@/services/repository-service');

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    // First, open a repository
    vi.mocked(repositoryService.selectRepositoryFolder).mockResolvedValue('/test/same-project');
    await result.current.selectRepository();

    // Wait for openRepository to complete
    await waitFor(() => {
      expect(result.current.rootPath).toBe('/test/same-project');
    });

    vi.clearAllMocks();

    // Try to open the same path again
    await result.current.openRepository('/test/same-project', 'proj-1');

    // buildDirectoryTree should not be called again
    expect(repositoryService.buildDirectoryTree).not.toHaveBeenCalled();
  });
});

describe('window-scoped-repository-store - external file change false positive bug', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <RepositoryStoreProvider>{children}</RepositoryStoreProvider>
  );

  const testFilePath = '/test/path/file.ts';
  const originalContent = 'console.log("hello world");';
  const modifiedContent = 'console.log("hello from TalkCody");';

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear file write tracker to avoid interference between tests
    clearAllTrackedFiles();
  });

  it('should not trigger external change dialog after saving a file with matching disk content', async () => {
    const { repositoryService } = await import('@/services/repository-service');

    // Mock reading file content - return original content initially
    vi.mocked(repositoryService.readFileWithCache).mockResolvedValue(originalContent);
    vi.mocked(repositoryService.writeFile).mockResolvedValue(undefined);

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    // Step 1: Open a file
    await result.current.selectFile(testFilePath);

    // Verify file is opened with original content
    await waitFor(() => {
      expect(result.current.openFiles).toHaveLength(1);
      const file = result.current.openFiles.find((f) => f.path === testFilePath);
      expect(file).toBeDefined();
      expect(file?.path).toBe(testFilePath);
      expect(file?.content).toBe(originalContent);
    });

    // Step 2: Edit the content in the editor (simulating user typing)
    result.current.updateFileContent(testFilePath, modifiedContent, true); // hasUnsavedChanges=true

    // Verify the file shows unsaved changes
    await waitFor(() => {
      const fileBeforeSave = result.current.openFiles.find((f) => f.path === testFilePath);
      expect(fileBeforeSave?.content).toBe(modifiedContent);
      expect(fileBeforeSave?.hasUnsavedChanges).toBe(true);
    });

    // Step 3: Save the file (this writes to disk and clears hasUnsavedChanges flag)
    await result.current.saveFile(testFilePath, modifiedContent);

    // Verify writeFile was called with the modified content
    expect(repositoryService.writeFile).toHaveBeenCalledWith(testFilePath, modifiedContent);

    // Verify hasUnsavedChanges is now false
    await waitFor(() => {
      const fileAfterSave = result.current.openFiles.find((f) => f.path === testFilePath);
      expect(fileAfterSave?.hasUnsavedChanges).toBe(false);
      expect(fileAfterSave?.content).toBe(modifiedContent);
    });

    // Mock the disk content to match what was just saved (same as editor content)
    vi.mocked(repositoryService.readFileWithCache).mockResolvedValue(modifiedContent);

    // Clear file write tracker to allow handleExternalFileChange to process the event
    // (In real scenario, this would be triggered after the 2s ignore window)
    clearAllTrackedFiles();

    // Step 4: Simulate a file system change event (like file watcher would trigger)
    await result.current.handleExternalFileChange(testFilePath);

    // Step 5: Verify that content remains unchanged (disk content matches editor content)
    // No update should occur since the content is the same

    // Verify that invalidateCache was called (to read fresh content from disk)
    expect(repositoryService.invalidateCache).toHaveBeenCalledWith(testFilePath);

    // Verify that readFileWithCache was called to check disk content
    expect(repositoryService.readFileWithCache).toHaveBeenCalledWith(testFilePath);

    // Verify content was not updated (since it's the same)
    const finalFile = result.current.openFiles.find((f) => f.path === testFilePath);
    expect(finalFile?.content).toBe(modifiedContent);
  });

  it('should silently update file content when disk changes after save', async () => {
    const { repositoryService } = await import('@/services/repository-service');

    // Mock reading file content
    vi.mocked(repositoryService.readFileWithCache).mockResolvedValue(originalContent);
    vi.mocked(repositoryService.writeFile).mockResolvedValue(undefined);

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    // Step 1: Open a file
    await result.current.selectFile(testFilePath);

    await waitFor(() => {
      expect(result.current.openFiles).toHaveLength(1);
      const file = result.current.openFiles.find((f) => f.path === testFilePath);
      expect(file?.content).toBe(originalContent);
    });

    // Step 2: Edit and save the file
    result.current.updateFileContent(testFilePath, modifiedContent, true);
    await waitFor(() => {
      const editedFile = result.current.openFiles.find((f) => f.path === testFilePath);
      expect(editedFile?.hasUnsavedChanges).toBe(true);
    });

    await result.current.saveFile(testFilePath, modifiedContent);

    // Verify file was saved
    await waitFor(() => {
      const savedFile = result.current.openFiles.find((f) => f.path === testFilePath);
      expect(savedFile?.hasUnsavedChanges).toBe(false);
    });

    // Step 3: Simulate external change to the file on disk (different content)
    const externalModifiedContent = 'console.log("modified externally");';
    vi.mocked(repositoryService.readFileWithCache).mockResolvedValue(externalModifiedContent);

    // Clear file write tracker to allow handleExternalFileChange to process the event
    // (In real scenario, this would be triggered after the 2s ignore window)
    clearAllTrackedFiles();

    // Step 4: Simulate file system change event
    await result.current.handleExternalFileChange(testFilePath);

    // Step 5: Verify that content is silently updated (always updates from disk)
    const fileAfterExternalChange = result.current.openFiles.find((f) => f.path === testFilePath);
    expect(fileAfterExternalChange?.content).toBe(externalModifiedContent);
    expect(fileAfterExternalChange?.hasUnsavedChanges).toBe(false);
  });

  it('should silently update file content when disk changes and file has no unsaved changes', async () => {
    const { repositoryService } = await import('@/services/repository-service');

    // Mock reading file content
    vi.mocked(repositoryService.readFileWithCache).mockResolvedValue(originalContent);

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    // Step 1: Open a file
    await result.current.selectFile(testFilePath);

    await waitFor(() => {
      expect(result.current.openFiles).toHaveLength(1);
      const file = result.current.openFiles.find((f) => f.path === testFilePath);
      expect(file?.content).toBe(originalContent);
    });

    // Step 2: Simulate external change to the file on disk (different content)
    const externalModifiedContent = 'console.log("modified externally");';
    vi.mocked(repositoryService.readFileWithCache).mockResolvedValue(externalModifiedContent);

    // Step 3: Simulate file system change event
    await result.current.handleExternalFileChange(testFilePath);

    // Step 4: Verify content was silently updated (always updates from disk)
    const fileAfterUpdate = result.current.openFiles.find((f) => f.path === testFilePath);
    expect(fileAfterUpdate?.content).toBe(externalModifiedContent);
    expect(fileAfterUpdate?.hasUnsavedChanges).toBe(false);
  });

  it('should silently update file content when external change happens even with unsaved changes', async () => {
    const { repositoryService } = await import('@/services/repository-service');

    // Mock reading file content
    vi.mocked(repositoryService.readFileWithCache).mockResolvedValue(originalContent);

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    // Step 1: Open a file
    await result.current.selectFile(testFilePath);

    await waitFor(() => {
      expect(result.current.openFiles).toHaveLength(1);
    });

    // Step 2: Edit the content but DO NOT save (hasUnsavedChanges=true)
    result.current.updateFileContent(testFilePath, modifiedContent, true);

    await waitFor(() => {
      const fileBeforeExternal = result.current.openFiles.find((f) => f.path === testFilePath);
      expect(fileBeforeExternal?.hasUnsavedChanges).toBe(true);
    });

    // Step 3: Simulate external change to the file on disk
    const externalModifiedContent = 'console.log("modified externally");';
    vi.mocked(repositoryService.readFileWithCache).mockResolvedValue(externalModifiedContent);

    // Step 4: Simulate file system change event
    await result.current.handleExternalFileChange(testFilePath);

    // Step 5: Verify content is silently updated from disk (no dialog)
    // This relies on auto-save to prevent data loss
    const fileAfterExternal = result.current.openFiles.find((f) => f.path === testFilePath);
    expect(fileAfterExternal?.content).toBe(externalModifiedContent);
    expect(fileAfterExternal?.hasUnsavedChanges).toBe(false);
  });

  it('should handle multiple file changes correctly', async () => {
    const { repositoryService } = await import('@/services/repository-service');

    const file1Path = '/test/path/file1.ts';
    const file2Path = '/test/path/file2.ts';
    const file1Content = 'file1 content';
    const file2Content = 'file2 content';

    // Mock reading file content
    vi.mocked(repositoryService.readFileWithCache).mockImplementation(async (filePath) => {
      if (filePath === file1Path) return file1Content;
      if (filePath === file2Path) return file2Content;
      return '';
    });
    vi.mocked(repositoryService.writeFile).mockResolvedValue(undefined);

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    // Step 1: Open two files
    await result.current.selectFile(file1Path);
    await result.current.selectFile(file2Path);

    await waitFor(() => {
      expect(result.current.openFiles).toHaveLength(2);
    });

    // Step 2: Edit and save file1
    const file1Modified = 'file1 modified';
    result.current.updateFileContent(file1Path, file1Modified, true);
    await result.current.saveFile(file1Path, file1Modified);

    await waitFor(() => {
      const file1 = result.current.openFiles.find((f) => f.path === file1Path);
      expect(file1?.hasUnsavedChanges).toBe(false);
    });

    // Step 3: Simulate external change to file1 that matches saved content
    vi.mocked(repositoryService.readFileWithCache).mockImplementation(async (filePath) => {
      if (filePath === file1Path) return file1Modified; // Same as saved
      if (filePath === file2Path) return file2Content;
      return '';
    });

    // Step 4: Handle external change for file1
    await result.current.handleExternalFileChange(file1Path);

    // Step 5: Verify no update for file1 (content matches)

    // Step 6: Now simulate external change to file2 with different content
    const file2ExternalModified = 'file2 changed externally';
    vi.mocked(repositoryService.readFileWithCache).mockImplementation(async (filePath) => {
      if (filePath === file1Path) return file1Modified;
      if (filePath === file2Path) return file2ExternalModified;
      return '';
    });

    // Step 7: Handle external change for file2
    await result.current.handleExternalFileChange(file2Path);

    // Step 8: Verify content is silently updated for file2
    const file2AfterUpdate = result.current.openFiles.find((f) => f.path === file2Path);
    expect(file2AfterUpdate?.content).toBe(file2ExternalModified);
    expect(file2AfterUpdate?.hasUnsavedChanges).toBe(false);
  });

  it('should handle unsaved changes that match disk content (no dialog)', async () => {
    const { repositoryService } = await import('@/services/repository-service');

    // Mock reading file content
    vi.mocked(repositoryService.readFileWithCache).mockResolvedValue(originalContent);
    vi.mocked(repositoryService.writeFile).mockResolvedValue(undefined);

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    // Step 1: Open a file
    await result.current.selectFile(testFilePath);

    await waitFor(() => {
      expect(result.current.openFiles).toHaveLength(1);
    });

    // Step 2: Edit the content but DO NOT save (hasUnsavedChanges=true)
    result.current.updateFileContent(testFilePath, modifiedContent, true);

    await waitFor(() => {
      const file = result.current.openFiles.find((f) => f.path === testFilePath);
      expect(file?.hasUnsavedChanges).toBe(true);
    });

    // Step 3: Simulate external change that MATCHES current editor content
    vi.mocked(repositoryService.readFileWithCache).mockResolvedValue(modifiedContent);

    // Step 4: Simulate file system change event
    await result.current.handleExternalFileChange(testFilePath);

    // Step 5: Verify no update occurs (content matches, so no change needed)
    const fileAfterExternal = result.current.openFiles.find((f) => f.path === testFilePath);
    expect(fileAfterExternal?.content).toBe(modifiedContent);
  });
});
