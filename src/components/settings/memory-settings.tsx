import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useMemoryWorkspaceManager } from '@/hooks/use-memory-workspace-manager';
import { useSettingsStore } from '@/stores/settings-store';
import { MemoryAuditPanel } from './memory-audit-panel';
import { MemoryIndexEditor } from './memory-index-editor';
import { getMemorySettingsCopy } from './memory-settings-copy';
import { MemoryTopicsEditor } from './memory-topics-editor';

export function MemorySettings() {
  const language = useSettingsStore((state) => state.language);
  const currentRootPath = useSettingsStore((state) => state.current_root_path);
  const selectedProjectId = useSettingsStore((state) => state.project);
  const globalEnabled = useSettingsStore((state) => state.memory_global_enabled);
  const projectEnabled = useSettingsStore((state) => state.memory_project_enabled);
  const setGlobalEnabled = useSettingsStore((state) => state.setMemoryGlobalEnabled);
  const setProjectEnabled = useSettingsStore((state) => state.setMemoryProjectEnabled);

  const copy = getMemorySettingsCopy(language);
  const {
    selectedScope,
    setSelectedScope,
    selectedView,
    setSelectedView,
    activeWorkspace,
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
  } = useMemoryWorkspaceManager({
    copy,
    currentRootPath,
    selectedProjectId,
  });

  const activeScopeTitle = selectedScope === 'global' ? copy.globalTitle : copy.projectTitle;
  const activeScopeDescription =
    selectedScope === 'global' ? copy.globalDescription : copy.projectDescription;
  const projectUnavailable = selectedScope === 'project' && !activeWorkspace.rootPath;

  const handleToggle = async (setter: (enabled: boolean) => Promise<void>, enabled: boolean) => {
    try {
      await setter(enabled);
      toast.success(copy.toggleSaved);
    } catch {
      toast.error(copy.toggleFailed);
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

            {projectUnavailable && (
              <div className="rounded-md border border-dashed p-4">
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
                  ? (activeWorkspace.rootPath ?? copy.noProject)
                  : copy.globalTitle}
              </span>
            </div>
            <div>
              <span className="font-medium">{copy.indexPath}:</span>{' '}
              <span className="font-mono">{activeWorkspace.indexPath ?? '-'}</span>
            </div>
            <div>
              <span className="font-medium">{copy.topicCount}:</span>{' '}
              {activeWorkspace.topics.length}
            </div>
          </div>

          <MemoryAuditPanel audit={activeWorkspace.audit} copy={copy} />

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
              <MemoryIndexEditor
                title={activeScopeTitle}
                description={activeScopeDescription}
                value={activeWorkspace.indexContent}
                onChange={(value) => setIndexContent(selectedScope, value)}
                onSave={handleSaveIndex}
                onRefresh={handleReload}
                copy={copy}
                disabled={isLoading || isSavingIndex || projectUnavailable}
                isSaving={isSavingIndex}
                showProjectUnavailable={projectUnavailable}
              />
            )}

            {selectedView === 'topics' && (
              <MemoryTopicsEditor
                scope={selectedScope}
                topics={activeWorkspace.topics}
                selectedTopicOriginalName={activeWorkspace.selectedTopicOriginalName}
                topicEditorName={activeWorkspace.topicEditorName}
                topicEditorContent={activeWorkspace.topicEditorContent}
                onCreateTopic={handleCreateTopic}
                onSelectTopic={handleSelectTopic}
                onTopicNameChange={(value) =>
                  setTopicEditorState(selectedScope, {
                    topicEditorName: value,
                  })
                }
                onTopicContentChange={(value) =>
                  setTopicEditorState(selectedScope, {
                    topicEditorContent: value,
                  })
                }
                onSaveTopic={handleSaveTopic}
                onDeleteTopic={handleDeleteTopic}
                onRefresh={handleReload}
                copy={copy}
                disabled={isLoading || isSavingTopic}
                isSaving={isSavingTopic}
                showProjectUnavailable={projectUnavailable}
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
