import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { databaseService } from '@/services/database-service';
import { memoryService } from '@/services/memory/memory-service';
import { DEFAULT_PROJECT, useSettingsStore } from '@/stores/settings-store';

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
  globalPath: string;
  projectPath: string;
  noProject: string;
  projectUnavailable: string;
  reloadSuccess: string;
  loadFailed: string;
  globalSaved: string;
  projectSaved: string;
  saveFailed: string;
  toggleSaved: string;
  toggleFailed: string;
  saveAction: string;
  savingAction: string;
  refreshAction: string;
};

const EN_COPY: MemoryCopy = {
  title: 'Long-Term Memory',
  description:
    'Manage TalkCody long-term memory and control whether global and project memory are injected into prompts.',
  injectionTitle: 'Prompt Injection',
  injectionDescription:
    'These switches affect only long-term memory providers. Static project instruction providers remain separate.',
  storageNote:
    'Turning a memory layer off only disables prompt injection. Existing files are preserved.',
  globalTitle: 'Global Memory',
  globalDescription: 'User-level long-term memory shared across projects.',
  projectTitle: 'Project Memory',
  projectDescription:
    'Project-level long-term memory stored in the current root instruction file Long-Term Memory section.',
  globalPath: 'Global memory file',
  projectPath: 'Project memory file',
  noProject: 'No active project root is available.',
  projectUnavailable: 'Open a project to view or edit project memory.',
  reloadSuccess: 'Memory reloaded.',
  loadFailed: 'Failed to load memory.',
  globalSaved: 'Global memory saved.',
  projectSaved: 'Project memory saved.',
  saveFailed: 'Failed to save memory.',
  toggleSaved: 'Memory setting updated.',
  toggleFailed: 'Failed to update memory setting.',
  saveAction: 'Save',
  savingAction: 'Saving...',
  refreshAction: 'Refresh',
};

const ZH_COPY: MemoryCopy = {
  title: '长期记忆',
  description: '管理 TalkCody 的长期记忆，并控制是否将全局记忆与项目记忆注入到提示词中。',
  injectionTitle: '提示词注入',
  injectionDescription: '这些开关只影响长期记忆 provider。静态项目指令 provider 仍独立存在。',
  storageNote: '关闭某一层记忆只会停止注入，不会删除已有文件。',
  globalTitle: '全局记忆',
  globalDescription: '跨项目共享的用户级长期记忆。',
  projectTitle: '项目记忆',
  projectDescription: '项目级长期记忆，存储在当前根指令文件的 Long-Term Memory 段落中。',
  globalPath: '全局记忆文件',
  projectPath: '项目记忆文件',
  noProject: '当前没有可用的项目根目录。',
  projectUnavailable: '请先打开一个项目，再查看或编辑项目记忆。',
  reloadSuccess: '记忆已重新加载。',
  loadFailed: '加载记忆失败。',
  globalSaved: '全局记忆已保存。',
  projectSaved: '项目记忆已保存。',
  saveFailed: '保存记忆失败。',
  toggleSaved: '记忆设置已更新。',
  toggleFailed: '更新记忆设置失败。',
  saveAction: '保存',
  savingAction: '保存中...',
  refreshAction: '刷新',
};

export function MemorySettings() {
  const language = useSettingsStore((state) => state.language);
  const currentRootPath = useSettingsStore((state) => state.current_root_path);
  const selectedProjectId = useSettingsStore((state) => state.project);
  const globalEnabled = useSettingsStore((state) => state.memory_global_enabled);
  const projectEnabled = useSettingsStore((state) => state.memory_project_enabled);
  const setGlobalEnabled = useSettingsStore((state) => state.setMemoryGlobalEnabled);
  const setProjectEnabled = useSettingsStore((state) => state.setMemoryProjectEnabled);

  const copy = useMemo(() => (language === 'zh' ? ZH_COPY : EN_COPY), [language]);

  const [globalPath, setGlobalPath] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [globalContent, setGlobalContent] = useState('');
  const [projectContent, setProjectContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingGlobal, setIsSavingGlobal] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [activeProjectRoot, setActiveProjectRoot] = useState<string | null>(null);
  const loadRequestIdRef = useRef(0);

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

  const loadMemory = useCallback(async (): Promise<boolean> => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    setIsLoading(true);

    try {
      const projectRoot = await resolveProjectRoot();
      const [globalDocument, projectDocument] = await Promise.all([
        memoryService.getGlobalDocument(),
        memoryService.getProjectMemoryDocument(projectRoot || undefined),
      ]);

      if (loadRequestIdRef.current !== requestId) {
        return false;
      }

      setActiveProjectRoot(projectRoot);
      setGlobalPath(globalDocument.path);
      setProjectPath(projectDocument.path);
      setGlobalContent(globalDocument.content);
      setProjectContent(projectDocument.content);
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
  }, [copy.loadFailed, resolveProjectRoot]);

  useEffect(() => {
    void loadMemory();
  }, [loadMemory]);

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

  const handleSaveGlobal = async () => {
    setIsSavingGlobal(true);
    try {
      const document = await memoryService.writeGlobal(globalContent);
      setGlobalContent(document.content);
      setGlobalPath(document.path);
      toast.success(copy.globalSaved);
    } catch {
      toast.error(copy.saveFailed);
    } finally {
      setIsSavingGlobal(false);
    }
  };

  const handleSaveProject = async () => {
    const projectRoot = activeProjectRoot ?? (await resolveProjectRoot());
    if (!projectRoot) {
      toast.error(copy.projectUnavailable);
      return;
    }

    setIsSavingProject(true);
    try {
      const document = await memoryService.writeProjectMemoryDocument(projectRoot, projectContent);
      setActiveProjectRoot(projectRoot);
      setProjectContent(document.content);
      setProjectPath(document.path);
      toast.success(copy.projectSaved);
    } catch {
      toast.error(copy.saveFailed);
    } finally {
      setIsSavingProject(false);
    }
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
          <CardTitle className="text-lg">{copy.globalTitle}</CardTitle>
          <CardDescription>{copy.globalDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">{copy.globalPath}:</span>{' '}
            <span className="font-mono">{globalPath ?? '-'}</span>
          </div>
          <Textarea
            value={globalContent}
            onChange={(event) => setGlobalContent(event.target.value)}
            className="min-h-[220px] font-mono text-sm"
            disabled={isLoading || isSavingGlobal}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSaveGlobal} disabled={isLoading || isSavingGlobal}>
              {isSavingGlobal ? copy.savingAction : copy.saveAction}
            </Button>
            <Button variant="outline" onClick={handleReload} disabled={isLoading || isSavingGlobal}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {copy.refreshAction}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{copy.projectTitle}</CardTitle>
          <CardDescription>{copy.projectDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">{copy.projectPath}:</span>{' '}
            <span className="font-mono">{projectPath ?? copy.noProject}</span>
          </div>
          <Textarea
            value={projectContent}
            onChange={(event) => setProjectContent(event.target.value)}
            className="min-h-[220px] font-mono text-sm"
            disabled={!activeProjectRoot || isLoading || isSavingProject}
            placeholder={copy.projectUnavailable}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleSaveProject}
              disabled={!activeProjectRoot || isLoading || isSavingProject}
            >
              {isSavingProject ? copy.savingAction : copy.saveAction}
            </Button>
            <Button
              variant="outline"
              onClick={handleReload}
              disabled={isLoading || isSavingProject}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {copy.refreshAction}
            </Button>
          </div>
          {!activeProjectRoot && (
            <p className="text-sm text-muted-foreground">{copy.projectUnavailable}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
