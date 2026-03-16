export type MemorySettingsCopy = {
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

export const EN_MEMORY_SETTINGS_COPY: MemorySettingsCopy = {
  title: 'Long-Term Memory Workspace',
  description:
    'Manage TalkCody long-term memory as indexed markdown workspaces. MEMORY.md is the routing index, and topic files store detailed notes.',
  injectionTitle: 'Prompt Injection',
  injectionDescription:
    'These switches affect only indexed long-term memory providers. Static project instruction providers remain separate.',
  storageNote:
    'Turning a memory layer off only disables prompt injection. Existing MEMORY.md and topic files are preserved.',
  globalTitle: 'Global Memory',
  globalDescription: 'User-level long-term memory workspace shared across projects.',
  projectTitle: 'Project Memory',
  projectDescription:
    'Repository-level long-term memory workspace shared across related worktrees.',
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

export const ZH_MEMORY_SETTINGS_COPY: MemorySettingsCopy = {
  title: '长期记忆工作区',
  description:
    '以索引化 Markdown 工作区的方式管理 TalkCody 长期记忆。`MEMORY.md` 是路由索引，topic 文件保存详细笔记。',
  injectionTitle: '提示词注入',
  injectionDescription:
    '这些开关只影响索引型长期记忆 provider。静态项目指令 provider 仍然独立生效。',
  storageNote: '关闭某一层记忆只会停止提示词注入，不会删除已有的 `MEMORY.md` 和 topic 文件。',
  globalTitle: '全局记忆',
  globalDescription: '跨项目共享的用户级长期记忆工作区。',
  projectTitle: '项目记忆',
  projectDescription: '在关联 worktree 之间共享的仓库级长期记忆工作区。',
  indexTab: '索引',
  topicsTab: 'Topics',
  workspaceTitle: '记忆工作区',
  workspaceDescription:
    '你可以直接编辑 `MEMORY.md`，也可以切换到 topic 文件视图。只有 `MEMORY.md` 的前 200 行会自动注入提示词。',
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
  selectTopic: '请选择一个 topic 文件进行编辑，或新建一个 topic。',
  topicFileName: 'Topic 文件名',
  topicPlaceholder: 'architecture.md',
  topicEditorPlaceholder: '在这里写入这个 topic 的长期、可复用信息。',
  indexEditorPlaceholder: '保持 `MEMORY.md` 简洁，把详细知识路由到 topic 文件中。',
  auditTitle: '索引审计',
  injectedLines: '注入行数',
  missingTopics: '缺失 topic',
  unindexedTopics: '未索引 topic',
  allTopicsIndexed: '索引与 topic 文件已经对齐。',
};

export function getMemorySettingsCopy(language: string): MemorySettingsCopy {
  return language === 'zh' ? ZH_MEMORY_SETTINGS_COPY : EN_MEMORY_SETTINGS_COPY;
}
