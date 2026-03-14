import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { databaseService } from '@/services/database-service';
import {
  MEMORY_INDEX_INJECTION_LINE_LIMIT,
  type MemoryDocument,
  type MemoryScope,
  type MemoryWorkspaceAudit,
  memoryService,
} from '@/services/memory/memory-service';
import { DEFAULT_PROJECT, useSettingsStore } from '@/stores/settings-store';

type ScopeWorkspaceState = {
  rootPath: string | null;
  indexPath: string | null;
  indexContent: string;
  topics: MemoryDocument[];
  selectedTopicOriginalName: string | null;
  topicEditorName: string;
  topicEditorContent: string;
  audit: MemoryWorkspaceAudit | null;
};

type MemoryCopy = {
  title: string;
  description: string;
  injectionTitle: string;
  injectionDescription: string;
  storageNote: string;
  globalTitle: string;
  globalDescription: string;
  projectTitle: string;
  projectDescription: string;
  indexTab: string;
  topicsTab: string;
  workspaceTitle: string;
  workspaceDescription: string;
  workspaceRoot: string;
  indexPath: string;
  topicCount: string;
  projectUnavailable: string;
  noProject: string;
  reloadSuccess: string;
  loadFailed: string;
  globalSaved: string;
  projectSaved: string;
  topicSaved: string;
  topicDeleted: string;
  saveFailed: string;
  deleteFailed: string;
  toggleSaved: string;
  toggleFailed: string;
  saveAction: string;
  deleteAction: string;
  savingAction: string;
  refreshAction: string;
  newTopicAction: string;
  selectTopic: string;
  topicFileName: string;
  topicPlaceholder: string;
  topicEditorPlaceholder: string;
  indexEditorPlaceholder: string;
  auditTitle: string;
  injectedLines: string;
  missingTopics: string;
  unindexedTopics: string;
  allTopicsIndexed: string;
};

const EN_COPY: MemoryCopy = {
  title: 'Auto Memory Workspace',
  description:
    'Manage TalkCody auto memory as indexed markdown workspaces. MEMORY.md is the routing index, and topic files store detailed notes.',
  injectionTitle: 'Prompt Injection',
  injectionDescription:
    'These switches affect only indexed auto-memory providers. Static project instruction providers remain separate.',
  storageNote:
    'Turning a memory layer off only disables prompt injection. Existing MEMORY.md and topic files are preserved.',
  globalTitle: 'Global Memory',
  globalDescription: 'User-level auto memory workspace shared across projects.',
  projectTitle: 'Project Memory',
  projectDescription: 'Repository-level auto memory workspace shared across related worktrees.',
  indexTab: 'Index',
  topicsTab: 'Topics',
  workspaceTitle: 'Memory Workspace',
  workspaceDescription:
    'Edit MEMORY.md directly or switch to topic files. The first 200 lines of MEMORY.md are injected into prompts.',
  workspaceRoot: 'Project root',
  indexPath: 'MEMORY.md path',
  topicCount: 'Topic files',
  projectUnavailable: 'Open a project to view or edit project memory.',
  noProject: 'No active project root is available.',
  reloadSuccess: 'Memory workspace reloaded.',
  loadFailed: 'Failed to load memory workspace.',
  globalSaved: 'Global MEMORY.md saved.',
  projectSaved: 'Project MEMORY.md saved.',
  topicSaved: 'Topic memory saved.',
  topicDeleted: 'Topic memory deleted.',
  saveFailed: 'Failed to save memory.',
  deleteFailed: 'Failed to delete topic memory.',
  toggleSaved: 'Memory setting updated.',
  toggleFailed: 'Failed to update memory setting.',
  saveAction: 'Save',
  deleteAction: 'Delete',
  savingAction: 'Saving...',
  refreshAction: 'Refresh',
  newTopicAction: 'New Topic',
  selectTopic: 'Select a topic file to edit, or create a new one.',
  topicFileName: 'Topic file name',
  topicPlaceholder: 'architecture.md',
  topicEditorPlaceholder: 'Write durable notes for this topic file.',
  indexEditorPlaceholder: 'Keep MEMORY.md concise. Route detailed knowledge into topic files.',
  auditTitle: 'Index Audit',
  injectedLines: 'Injected lines',
  missingTopics: 'Missing topics',
  unindexedTopics: 'Unindexed topics',
  allTopicsIndexed: 'Index and topic files are aligned.',
};

const ZH_COPY: MemoryCopy = {
  title: '自动记忆工作区',
  description: '以索引化 markdown 工作区的方式管理 TalkCody 自动记忆。MEMORY.md 是路由索引，topic 文件保存详细笔记。',
  injectionTitle: '提示词注入',
  injectionDescription: '这些开关只影响自动记忆 provider。静态项目指令 provider 仍独立存在。',
  storageNote: '关闭某一层记忆只会停止注入，不会删除已有的 MEMORY.md 或 topic 文件。',
  globalTitle: '全局记忆',
  globalDescription: '跨项目共享的用户级自动记忆工作区。',
  projectTitle: '项目记忆',
  projectDescription: '按仓库维度共享、可跨相关 worktree 复用的自动记忆工作区。',
  indexTab: '索引',
  topicsTab: 'Topic',
  workspaceTitle: '记忆工作区',
  workspaceDescription: '可以直接编辑 MEMORY.md，也可以切换到 topic 文件视图。只有 MEMORY.md 的前 200 行会被注入到提示词。',
  workspaceRoot: '项目根目录',
  indexPath: 'MEMORY.md 路径',
  topicCount: 'Topic 文件数',
  projectUnavailable: '请先打开一个项目，再查看或编辑项目记忆。',
  noProject: '当前没有可用的项目根目录。',
  reloadSuccess: '记忆工作区已重新加载。',
  loadFailed: '加载记忆工作区失败。',
  globalSaved: '全局 MEMORY.md 已保存。',
  projectSaved: '项目 MEMORY.md 已保存。',
  topicSaved: 'Topic 记忆已保存。',
  topicDeleted: 'Topic 记忆已删除。',
  saveFailed: '保存记忆失败。',
  deleteFailed: '删除 Topic 记忆失败。',
  toggleSaved: '记忆设置已更新。',
  toggleFailed: '更新记忆设置失败。',
  saveAction: '保存',
  deleteAction: '删除',
  savingAction: '保存中...',
  refreshAction: '刷新',
  newTopicAction: '新建 Topic',
  selectTopic: '请选择一个 topic 文件进行编辑，或者新建一个 topic。',
  topicFileName: 'Topic 文件名',
  topicPlaceholder: 'architecture.md',
  topicEditorPlaceholder: '在这里写入这个 topic 的长期、可复用信息。',
  indexEditorPlaceholder: '保持 MEMORY.md 简洁，把详细知识路由到 topic 文件中。',
  auditTitle: '索引审计',
  injectedLines: '注入行数',
  missingTopics: '缺失 topic',
  unindexedTopics: '未索引 topic',
  allTopicsIndexed: '索引与 topic 文件已对齐。',
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
      topicEditorContent: previousState.selectedTopicOriginalName ? '' : previousState.topicEditorContent,
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
    topics.map((topic) => topic.fileName?.toLowerCase()).filter((fileName): fileName is string => Boolean(fileName))
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

export function MemorySettings() {
  const language = useSettingsStore((state) => state.language);
  const currentRootPath = useSettingsStore((state) => state.current_root_path);
  const selectedProjectId = useSettingsStore((state) => state.project);
  const globalEnabled = useSettingsStore((state) => state.memory_global_enabled);
  const projectEnabled = useSettingsStore((state) => state.memory_project_enabled);
  const setGlobalEnabled = useSettingsStore((state) => state.setMemoryGlobalEnabled);
  const setProjectEnabled = useSettingsStore((state) => state.setMemoryProjectEnabled);

  const copy = useMemo(() => (language === 'zh' ? ZH_COPY : EN_COPY), [language]);

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

      const options = scope === 'project' ? { workspaceRoot: projectRoot || undefined } : {};
      const [indexDocument, topics, audit] = await Promise.all([
        scope === 'global'
          ? memoryService.getGlobalDocument()
          : memoryService.getProjectMemoryDocument(projectRoot || undefined),
        memoryService.listTopicDocuments(scope, options),
        memoryService.getWorkspaceAudit(scope, options),
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
    async (preferredTopicSelections: Partial<Record<MemoryScope, string | null>> = {}): Promise<boolean> => {
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
    void loadMemory();
  }, [loadMemory]);

  const activeWorkspace = workspaces[selectedScope];
  const activeScopeTitle = selectedScope === 'global' ? copy.globalTitle : copy.projectTitle;
  const activeScopeDescription =
    selectedScope === 'global' ? copy.globalDescription : copy.projectDescription;

  const handleReload = async () => {
    const loaded = await loadMemory();
    if (loaded) {
      toast.success(copy.reloadSuccess);
    }
  };

  const handleToggle = async (setter: (enabled: boolean) => Promise<void>, enabled: boolean) => {
    try {
      await setter(enabled);
      toast.success(copy.toggleSaved);
    } catch {
      toast.error(copy.toggleFailed);
    }
  };

  const setIndexContent = (scope: MemoryScope, content: string) => {
    setWorkspaces((current) => ({
      ...current,
      [scope]: {
        ...current[scope],
        indexContent: content,
      },
    }));
  };

  const setTopicEditorState = (
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
  };

  const handleSaveIndex = async () => {
    if (selectedScope === 'project' && !activeWorkspace.rootPath) {
      toast.error(copy.projectUnavailable);
      return;
    }

    setIsSavingIndex(true);
    try {
      if (selectedScope === 'global') {
        await memoryService.writeGlobal(activeWorkspace.indexContent);
        toast.success(copy.globalSaved);
      } else {
        await memoryService.writeProjectMemoryDocument(
          activeWorkspace.rootPath as string,
          activeWorkspace.indexContent
        );
        toast.success(copy.projectSaved);
      }
      await loadMemory();
    } catch {
      toast.error(copy.saveFailed);
    } finally {
      setIsSavingIndex(false);
    }
  };

  const handleCreateTopic = async () => {
    if (selectedScope === 'project' && !activeWorkspace.rootPath) {
      toast.error(copy.projectUnavailable);
      return;
    }

    setIsSavingTopic(true);
    try {
      const topicFileName = buildNewTopicFileName(activeWorkspace.topics);
      const options =
        selectedScope === 'project' ? { workspaceRoot: activeWorkspace.rootPath as string } : {};

      const document = await memoryService.writeTopicDocument(
        selectedScope,
        topicFileName,
        '',
        options
      );

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
  };

  const handleSelectTopic = (scope: MemoryScope, topic: MemoryDocument) => {
    setSelectedView('topics');
    setTopicEditorState(scope, {
      selectedTopicOriginalName: topic.fileName,
      topicEditorName: topic.fileName ?? '',
      topicEditorContent: topic.content,
    });
  };

  const handleSaveTopic = async () => {
    if (selectedScope === 'project' && !activeWorkspace.rootPath) {
      toast.error(copy.projectUnavailable);
      return;
    }

    setIsSavingTopic(true);
    try {
      const options =
        selectedScope === 'project' ? { workspaceRoot: activeWorkspace.rootPath as string } : {};
      const originalName = activeWorkspace.selectedTopicOriginalName;
      const nextName = activeWorkspace.topicEditorName;

      if (originalName && originalName !== nextName) {
        await memoryService.renameTopicDocument(selectedScope, originalName, nextName, options);
      }

      const document = await memoryService.writeTopicDocument(
        selectedScope,
        nextName,
        activeWorkspace.topicEditorContent,
        options
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
  };

  const handleDeleteTopic = async () => {
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
      const options =
        selectedScope === 'project' ? { workspaceRoot: activeWorkspace.rootPath as string } : {};
      await memoryService.deleteTopicDocument(
        selectedScope,
        activeWorkspace.selectedTopicOriginalName,
        options
      );
      toast.success(copy.topicDeleted);
      await loadMemory();
    } catch {
      toast.error(copy.deleteFailed);
    }
  };

  const renderAudit = (audit: MemoryWorkspaceAudit | null) => {
    if (!audit) {
      return null;
    }

    const hasIssues = audit.missingTopicFiles.length > 0 || audit.unindexedTopicFiles.length > 0;

    return (
      <div className="space-y-3 rounded-md border p-4">
        <h4 className="text-sm font-medium">{copy.auditTitle}</h4>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={audit.overInjectionLimit ? 'destructive' : 'secondary'}>
            {copy.injectedLines}: {audit.injectedLineCount}/{MEMORY_INDEX_INJECTION_LINE_LIMIT}
          </Badge>
          <Badge variant={audit.missingTopicFiles.length > 0 ? 'destructive' : 'secondary'}>
            {copy.missingTopics}: {audit.missingTopicFiles.length}
          </Badge>
          <Badge variant={audit.unindexedTopicFiles.length > 0 ? 'destructive' : 'secondary'}>
            {copy.unindexedTopics}: {audit.unindexedTopicFiles.length}
          </Badge>
        </div>
        {!hasIssues && <p className="text-sm text-muted-foreground">{copy.allTopicsIndexed}</p>}
        {audit.missingTopicFiles.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {copy.missingTopics}: {audit.missingTopicFiles.join(', ')}
          </p>
        )}
        {audit.unindexedTopicFiles.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {copy.unindexedTopics}: {audit.unindexedTopicFiles.join(', ')}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{copy.title}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="text-sm font-medium">{copy.injectionTitle}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{copy.injectionDescription}</p>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-md border p-4">
              <div className="space-y-1">
                <Label className="text-sm font-medium">{copy.globalTitle}</Label>
                <p className="text-sm text-muted-foreground">{copy.globalDescription}</p>
              </div>
              <Switch
                checked={globalEnabled}
                onCheckedChange={(checked) => handleToggle(setGlobalEnabled, checked)}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border p-4">
              <div className="space-y-1">
                <Label className="text-sm font-medium">{copy.projectTitle}</Label>
                <p className="text-sm text-muted-foreground">{copy.projectDescription}</p>
              </div>
              <Switch
                checked={projectEnabled}
                onCheckedChange={(checked) => handleToggle(setProjectEnabled, checked)}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">{copy.storageNote}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{copy.workspaceTitle}</CardTitle>
          <CardDescription>{copy.workspaceDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            <div className="grid w-full grid-cols-2 gap-2">
              <Button
                variant={selectedScope === 'global' ? 'default' : 'outline'}
                onClick={() => setSelectedScope('global')}
              >
                {copy.globalTitle}
              </Button>
              <Button
                variant={selectedScope === 'project' ? 'default' : 'outline'}
                onClick={() => setSelectedScope('project')}
              >
                {copy.projectTitle}
              </Button>
            </div>

            {selectedScope === 'global' && (
              <div className="space-y-4">
              <div className="space-y-1">
                <h3 className="text-sm font-medium">{copy.globalTitle}</h3>
                <p className="text-sm text-muted-foreground">{copy.globalDescription}</p>
              </div>
              </div>
            )}

            {selectedScope === 'project' && (
              <div className="space-y-4">
              <div className="space-y-1">
                <h3 className="text-sm font-medium">{copy.projectTitle}</h3>
                <p className="text-sm text-muted-foreground">{copy.projectDescription}</p>
              </div>
              </div>
            )}
          </div>

          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
            <div>
              <span className="font-medium">{copy.workspaceRoot}:</span>{' '}
              <span className="font-mono">
                {selectedScope === 'project'
                  ? activeWorkspace.rootPath ?? copy.noProject
                  : copy.globalTitle}
              </span>
            </div>
            <div>
              <span className="font-medium">{copy.indexPath}:</span>{' '}
              <span className="font-mono">{activeWorkspace.indexPath ?? '-'}</span>
            </div>
            <div>
              <span className="font-medium">{copy.topicCount}:</span> {activeWorkspace.topics.length}
            </div>
          </div>

          {renderAudit(activeWorkspace.audit)}

          <div className="space-y-4">
            <div className="grid w-full grid-cols-2 gap-2">
              <Button
                variant={selectedView === 'index' ? 'default' : 'outline'}
                onClick={() => setSelectedView('index')}
              >
                {copy.indexTab}
              </Button>
              <Button
                variant={selectedView === 'topics' ? 'default' : 'outline'}
                onClick={() => setSelectedView('topics')}
              >
                {copy.topicsTab}
              </Button>
            </div>

            {selectedView === 'index' && (
              <div className="space-y-4">
              <div className="space-y-1">
                <Label className="text-sm font-medium">{activeScopeTitle}</Label>
                <p className="text-sm text-muted-foreground">{activeScopeDescription}</p>
              </div>
              <Textarea
                value={activeWorkspace.indexContent}
                onChange={(event) => setIndexContent(selectedScope, event.target.value)}
                className="min-h-[240px] font-mono text-sm"
                disabled={
                  isLoading ||
                  isSavingIndex ||
                  (selectedScope === 'project' && !activeWorkspace.rootPath)
                }
                placeholder={copy.indexEditorPlaceholder}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleSaveIndex}
                  disabled={
                    isLoading ||
                    isSavingIndex ||
                    (selectedScope === 'project' && !activeWorkspace.rootPath)
                  }
                >
                  {isSavingIndex ? copy.savingAction : copy.saveAction}
                </Button>
                <Button variant="outline" onClick={handleReload} disabled={isLoading || isSavingIndex}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {copy.refreshAction}
                </Button>
              </div>
              {selectedScope === 'project' && !activeWorkspace.rootPath && (
                <p className="text-sm text-muted-foreground">{copy.projectUnavailable}</p>
              )}
              </div>
            )}

            {selectedView === 'topics' && (
              <div className="space-y-4">
              {selectedScope === 'project' && !activeWorkspace.rootPath ? (
                <p className="text-sm text-muted-foreground">{copy.projectUnavailable}</p>
              ) : (
                <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                  <div className="space-y-2 rounded-md border p-3">
                    <Button variant="outline" className="w-full" onClick={handleCreateTopic}>
                      {copy.newTopicAction}
                    </Button>
                    <div className="space-y-2">
                      {activeWorkspace.topics.map((topic) => (
                        <Button
                          key={topic.fileName ?? topic.path ?? 'topic'}
                          variant={
                            activeWorkspace.selectedTopicOriginalName === topic.fileName
                              ? 'default'
                              : 'ghost'
                          }
                          className="w-full justify-start font-mono text-xs"
                          onClick={() => handleSelectTopic(selectedScope, topic)}
                        >
                          {topic.fileName}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-1">
                      <Label htmlFor="memory-topic-name">{copy.topicFileName}</Label>
                      <Input
                        id="memory-topic-name"
                        value={activeWorkspace.topicEditorName}
                        onChange={(event) =>
                          setTopicEditorState(selectedScope, { topicEditorName: event.target.value })
                        }
                        placeholder={copy.topicPlaceholder}
                        disabled={isLoading || isSavingTopic}
                      />
                    </div>
                    <Textarea
                      value={activeWorkspace.topicEditorContent}
                      onChange={(event) =>
                        setTopicEditorState(selectedScope, {
                          topicEditorContent: event.target.value,
                        })
                      }
                      className="min-h-[240px] font-mono text-sm"
                      disabled={isLoading || isSavingTopic}
                      placeholder={copy.topicEditorPlaceholder}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={handleSaveTopic} disabled={isLoading || isSavingTopic}>
                        {isSavingTopic ? copy.savingAction : copy.saveAction}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleDeleteTopic}
                        disabled={isLoading || isSavingTopic}
                      >
                        {copy.deleteAction}
                      </Button>
                      <Button variant="outline" onClick={handleReload} disabled={isLoading || isSavingTopic}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        {copy.refreshAction}
                      </Button>
                    </div>
                    {!activeWorkspace.topicEditorName && !activeWorkspace.topicEditorContent && (
                      <p className="text-sm text-muted-foreground">{copy.selectTopic}</p>
                    )}
                  </div>
                </div>
              )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}