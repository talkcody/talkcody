import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { MemorySettingsCopy } from '@/components/settings/memory-settings-copy';
import { databaseService } from '@/services/database-service';
import {
  type MemoryDocument,
  type MemoryScope,
  type MemoryWorkspaceAudit,
  memoryService,
} from '@/services/memory/memory-service';
import { DEFAULT_PROJECT } from '@/stores/settings-store';

export type ScopeWorkspaceState = {
  rootPath: string | null;
  indexPath: string | null;
  indexContent: string;
  topics: MemoryDocument[];
  selectedTopicOriginalName: string | null;
  topicEditorName: string;
  topicEditorContent: string;
  audit: MemoryWorkspaceAudit | null;
};

type UseMemoryWorkspaceManagerOptions = {
  copy: MemorySettingsCopy;
  currentRootPath: string;
  selectedProjectId: string;
};

function createEmptyWorkspaceState(rootPath: string | null): ScopeWorkspaceState {
  return {
    rootPath,
    indexPath: null,
    indexContent: '',
    topics: [],
    selectedTopicOriginalName: null,
    topicEditorName: '',
    topicEditorContent: '',
    audit: null,
  };
}

function pickSelectedTopicState(
  topics: MemoryDocument[],
  previousState: ScopeWorkspaceState,
  preferredTopicFileName?: string | null
): Pick<
  ScopeWorkspaceState,
  'selectedTopicOriginalName' | 'topicEditorName' | 'topicEditorContent'
> {
  const previousName = previousState.selectedTopicOriginalName;
  const firstTopic = topics.length > 0 ? topics[0] : null;
  const selectedTopic =
    topics.find((topic) => topic.fileName === preferredTopicFileName) ??
    topics.find((topic) => topic.fileName === previousName) ??
    firstTopic ??
    null;

  if (!selectedTopic) {
    return {
      selectedTopicOriginalName: null,
      topicEditorName: previousState.selectedTopicOriginalName ? '' : previousState.topicEditorName,
      topicEditorContent: previousState.selectedTopicOriginalName
        ? ''
        : previousState.topicEditorContent,
    };
  }

  return {
    selectedTopicOriginalName: selectedTopic.fileName,
    topicEditorName: selectedTopic.fileName ?? '',
    topicEditorContent: selectedTopic.content,
  };
}

function buildNewTopicFileName(topics: MemoryDocument[]): string {
  const existingNames = new Set(
    topics
      .map((topic) => topic.fileName?.toLowerCase())
      .filter((fileName): fileName is string => Boolean(fileName))
  );

  const baseName = 'untitled-topic';
  const defaultFileName = `${baseName}.md`;
  if (!existingNames.has(defaultFileName)) {
    return defaultFileName;
  }

  let suffix = 2;
  while (existingNames.has(`${baseName}-${suffix}.md`)) {
    suffix += 1;
  }

  return `${baseName}-${suffix}.md`;
}

export function useMemoryWorkspaceManager({
  copy,
  currentRootPath,
  selectedProjectId,
}: UseMemoryWorkspaceManagerOptions) {
  const [selectedScope, setSelectedScope] = useState<MemoryScope>('global');
  const [selectedView, setSelectedView] = useState<'index' | 'topics'>('index');
  const [workspaces, setWorkspaces] = useState<Record<MemoryScope, ScopeWorkspaceState>>({
    global: createEmptyWorkspaceState(null),
    project: createEmptyWorkspaceState(null),
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingIndex, setIsSavingIndex] = useState(false);
  const [isSavingTopic, setIsSavingTopic] = useState(false);
  const loadRequestIdRef = useRef(0);
  const workspacesRef = useRef(workspaces);

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  const resolveProjectRoot = useCallback(async () => {
    if (currentRootPath) {
      return currentRootPath;
    }

    if (!selectedProjectId || selectedProjectId === DEFAULT_PROJECT) {
      return null;
    }

    try {
      const project = await databaseService.getProject(selectedProjectId);
      return project?.root_path || null;
    } catch {
      return null;
    }
  }, [currentRootPath, selectedProjectId]);

  const loadWorkspaceState = useCallback(
    async (
      scope: MemoryScope,
      projectRoot: string | null,
      previousState: ScopeWorkspaceState,
      preferredTopicFileName?: string | null
    ) => {
      if (scope === 'project' && !projectRoot) {
        return createEmptyWorkspaceState(null);
      }

      const context =
        scope === 'global'
          ? { scope: 'global' as const }
          : { scope: 'project' as const, workspaceRoot: projectRoot || undefined };
      const [indexDocument, topics, audit] = await Promise.all([
        memoryService.getIndex(context),
        memoryService.listTopics(context),
        memoryService.auditWorkspace(context),
      ]);

      const selectedTopicState = pickSelectedTopicState(
        topics,
        previousState,
        preferredTopicFileName
      );

      return {
        rootPath: projectRoot,
        indexPath: indexDocument.path,
        indexContent: indexDocument.content,
        topics,
        audit,
        ...selectedTopicState,
      };
    },
    []
  );

  const loadMemory = useCallback(
    async (
      preferredTopicSelections: Partial<Record<MemoryScope, string | null>> = {}
    ): Promise<boolean> => {
      const requestId = loadRequestIdRef.current + 1;
      loadRequestIdRef.current = requestId;
      setIsLoading(true);

      try {
        const projectRoot = await resolveProjectRoot();
        const [nextGlobal, nextProject] = await Promise.all([
          loadWorkspaceState(
            'global',
            null,
            workspacesRef.current.global,
            preferredTopicSelections.global
          ),
          loadWorkspaceState(
            'project',
            projectRoot,
            workspacesRef.current.project,
            preferredTopicSelections.project
          ),
        ]);

        if (loadRequestIdRef.current !== requestId) {
          return false;
        }

        setWorkspaces({
          global: nextGlobal,
          project: nextProject,
        });
        return true;
      } catch {
        if (loadRequestIdRef.current === requestId) {
          toast.error(copy.loadFailed);
        }
        return false;
      } finally {
        if (loadRequestIdRef.current === requestId) {
          setIsLoading(false);
        }
      }
    },
    [copy.loadFailed, loadWorkspaceState, resolveProjectRoot]
  );

  useEffect(() => {
    loadMemory().catch(() => undefined);
  }, [loadMemory]);

  const setIndexContent = useCallback((scope: MemoryScope, content: string) => {
    setWorkspaces((current) => ({
      ...current,
      [scope]: {
        ...current[scope],
        indexContent: content,
      },
    }));
  }, []);

  const setTopicEditorState = useCallback(
    (
      scope: MemoryScope,
      values: Partial<
        Pick<
          ScopeWorkspaceState,
          'selectedTopicOriginalName' | 'topicEditorName' | 'topicEditorContent'
        >
      >
    ) => {
      setWorkspaces((current) => ({
        ...current,
        [scope]: {
          ...current[scope],
          ...values,
        },
      }));
    },
    []
  );

  const handleReload = useCallback(async () => {
    const loaded = await loadMemory();
    if (loaded) {
      toast.success(copy.reloadSuccess);
    }
  }, [copy.reloadSuccess, loadMemory]);

  const handleSaveIndex = useCallback(async () => {
    const activeWorkspace = workspacesRef.current[selectedScope];
    if (selectedScope === 'project' && !activeWorkspace.rootPath) {
      toast.error(copy.projectUnavailable);
      return;
    }

    setIsSavingIndex(true);
    try {
      const context =
        selectedScope === 'global'
          ? { scope: 'global' as const }
          : { scope: 'project' as const, workspaceRoot: activeWorkspace.rootPath as string };

      await memoryService.saveIndex(context, activeWorkspace.indexContent);
      toast.success(selectedScope === 'global' ? copy.globalSaved : copy.projectSaved);
      await loadMemory();
    } catch {
      toast.error(copy.saveFailed);
    } finally {
      setIsSavingIndex(false);
    }
  }, [
    copy.globalSaved,
    copy.projectSaved,
    copy.projectUnavailable,
    copy.saveFailed,
    loadMemory,
    selectedScope,
  ]);

  const handleCreateTopic = useCallback(async () => {
    const activeWorkspace = workspacesRef.current[selectedScope];
    if (selectedScope === 'project' && !activeWorkspace.rootPath) {
      toast.error(copy.projectUnavailable);
      return;
    }

    setIsSavingTopic(true);
    try {
      const topicFileName = buildNewTopicFileName(activeWorkspace.topics);
      const context =
        selectedScope === 'global'
          ? { scope: 'global' as const }
          : { scope: 'project' as const, workspaceRoot: activeWorkspace.rootPath as string };

      const document = await memoryService.saveTopic(context, topicFileName, '');
      setSelectedView('topics');
      await loadMemory({
        [selectedScope]: document.fileName,
      });
      toast.success(copy.topicSaved);
    } catch {
      toast.error(copy.saveFailed);
    } finally {
      setIsSavingTopic(false);
    }
  }, [copy.projectUnavailable, copy.saveFailed, copy.topicSaved, loadMemory, selectedScope]);

  const handleSelectTopic = useCallback(
    (scope: MemoryScope, topic: MemoryDocument) => {
      setSelectedView('topics');
      setTopicEditorState(scope, {
        selectedTopicOriginalName: topic.fileName,
        topicEditorName: topic.fileName ?? '',
        topicEditorContent: topic.content,
      });
    },
    [setTopicEditorState]
  );

  const handleSaveTopic = useCallback(async () => {
    const activeWorkspace = workspacesRef.current[selectedScope];
    if (selectedScope === 'project' && !activeWorkspace.rootPath) {
      toast.error(copy.projectUnavailable);
      return;
    }

    setIsSavingTopic(true);
    try {
      const context =
        selectedScope === 'global'
          ? { scope: 'global' as const }
          : { scope: 'project' as const, workspaceRoot: activeWorkspace.rootPath as string };
      const originalName = activeWorkspace.selectedTopicOriginalName;
      const nextName = activeWorkspace.topicEditorName;

      if (originalName && originalName !== nextName) {
        await memoryService.renameTopic(context, originalName, nextName);
      }

      const document = await memoryService.saveTopic(
        context,
        nextName,
        activeWorkspace.topicEditorContent
      );
      toast.success(copy.topicSaved);
      await loadMemory({
        [selectedScope]: document.fileName ?? nextName,
      });
    } catch {
      toast.error(copy.saveFailed);
    } finally {
      setIsSavingTopic(false);
    }
  }, [copy.projectUnavailable, copy.saveFailed, copy.topicSaved, loadMemory, selectedScope]);

  const handleDeleteTopic = useCallback(async () => {
    const activeWorkspace = workspacesRef.current[selectedScope];
    if (!activeWorkspace.selectedTopicOriginalName) {
      setTopicEditorState(selectedScope, {
        selectedTopicOriginalName: null,
        topicEditorName: '',
        topicEditorContent: '',
      });
      return;
    }

    if (selectedScope === 'project' && !activeWorkspace.rootPath) {
      toast.error(copy.projectUnavailable);
      return;
    }

    try {
      const context =
        selectedScope === 'global'
          ? { scope: 'global' as const }
          : { scope: 'project' as const, workspaceRoot: activeWorkspace.rootPath as string };
      await memoryService.deleteTopic(context, activeWorkspace.selectedTopicOriginalName);
      toast.success(copy.topicDeleted);
      await loadMemory();
    } catch {
      toast.error(copy.deleteFailed);
    }
  }, [
    copy.deleteFailed,
    copy.projectUnavailable,
    copy.topicDeleted,
    loadMemory,
    selectedScope,
    setTopicEditorState,
  ]);

  return {
    selectedScope,
    setSelectedScope,
    selectedView,
    setSelectedView,
    workspaces,
    activeWorkspace: workspaces[selectedScope],
    isLoading,
    isSavingIndex,
    isSavingTopic,
    setIndexContent,
    setTopicEditorState,
    handleReload,
    handleSaveIndex,
    handleCreateTopic,
    handleSelectTopic,
    handleSaveTopic,
    handleDeleteTopic,
  };
}
