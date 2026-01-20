// Changelog data service for What's New dialog

export interface ChangelogContent {
  added?: string[];
  changed?: string[];
  fixed?: string[];
  removed?: string[];
  security?: string[];
  deprecated?: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  en: ChangelogContent;
  zh: ChangelogContent;
}

// Changelog data - update this when releasing new versions
// Only include the most recent versions that users care about
export const CHANGELOG_DATA: ChangelogEntry[] = [
  {
    version: '0.3.0',
    date: '2026-01-19',
    en: {
      added: [
        'Google OAuth Support: New Google authentication option for AI providers',
        'LSP Tool: Enhanced Language Server Protocol tool with better code navigation',
        'Claude Code Skills Support: Support for importing and using Claude Code skills',
        'Create Agent Tool: New tool to create custom AI agents',
        'Create Skill Command: New command to create agent skills',
        'Create Tool Command: New command to create custom tools',
        'Hook Feature: Support for pre-execution and post-execution hooks',
        'Task Service: Enhanced task management service',
        'Auto-Approve Plan: Option to automatically approve plan mode results',
        'Global Auto-Approve Edits Setting: New global setting to auto-approve file edits',
      ],
      changed: ['Improved Keep Awake functionality', 'Enhanced Whats New dialog with link support'],
      fixed: ['Fixed unknown command bug', 'Fixed compact command issues', 'Fixed Rust warnings'],
    },
    zh: {
      added: [
        'Google OAuth 支持：AI 提供商新增 Google 身份验证选项',
        'LSP 工具：增强的语言服务器协议工具，提供更好的代码导航',
        'Claude Code Skills 支持：支持导入和使用 Claude Code skills',
        'Create Agent Tool：新增创建自定义 AI 智能体的工具',
        'Create Skill Command：新增创建智能体 skill 的命令',
        'Create Tool Command：新增创建自定义工具的命令',
        'Hook 功能：支持执行前和执行后的钩子',
        'Task Service：增强的任务管理服务',
        'Auto-Approve Plan：支持自动批准 plan 模式结果',
        '全局 Auto-Approve Edits 设置：新增全局设置自动批准文件编辑',
      ],
      changed: ['改进 Keep Awake 功能', '增强 Whats New 对话框的链接支持'],
      fixed: ['修复未知命令 bug', '修复 compact 命令问题', '修复 Rust 警告'],
    },
  },
  {
    version: '0.2.6',
    date: '2026-01-14',
    en: {
      added: [
        'Agent Compatible with Claude Code Subagent Definition: Support for importing and using Claude Code subagent-defined agents from GitHub repositories, with more excellent built-in agents',
      ],
      changed: [
        'Task Title Generation Optimization: Improved task title generation logic for better user experience',
      ],
      fixed: [
        'Fixed Lint feature compatibility issue on Windows platform',
        'Fixed MiniMax Usage Cookie missing or expired issue',
        'Fixed Custom Tool refresh bug',
        'Fixed Chinese input method Enter key directly sending bug',
      ],
    },
    zh: {
      added: [
        'Agent 兼容Claude Code subagent 定义：支持从 GitHub 仓库导入和使用 Claude Code subagent 定义的智能体，内置更多优秀的智能体',
      ],
      changed: ['任务标题生成优化：改进任务标题生成逻辑，提升用户体验'],
      fixed: [
        '修复 lint 功能在 windows 平台的兼容性问题',
        '修复 MiniMax Usage Cookie 缺失或过期问题',
        '修复 custom tool 刷新的 Bug',
        '修复 中文输入法 enter 直接发送的 bug',
      ],
    },
  },
  {
    version: '0.2.5',
    date: '2026-01-11',
    en: {
      added: [
        'Custom Tools Support (Experimental): Added Custom Tools and Custom Tools Playground, allowing users to define custom AI tools with core capability to customize UI. For details, refer to [Custom Tools](/en/docs/features/custom-tools)',
        'Edit Auto-Approval: Can be enabled in settings, eliminating the need to wait for approval when modifying files.',
        'Global file search now displays recently opened files.',
        'When using multiple windows, the Project name is used as the window title.',
      ],
      changed: [
        'UI Rendering Performance Optimization: Optimized UI rendering performance during multi-task parallel execution, improving response speed under complex workflows.',
      ],
      fixed: [
        'Fixed File Changes Summary Bug: Fixed display issues with the file-changes-summary component.',
        'Path Handling Compatibility: Fixed compatibility issues with Windows and Unix path handling.',
        'Fixed Mac dock menu bug showing recent projects.',
      ],
    },
    zh: {
      added: [
        '支持自定义工具（实验版本）：新增 Custom Tools 和 Custom Tools Playground，支持用户自定义 AI 工具，核心能力是可以自定义 UI。详情参考 [自定义工具](/zh/docs/features/custom-tools)',
        'Edit 自动批准：可在设置中开启，不需要等待文件修改时再进行审批',
        '全局文件搜索显示最近打开的文件',
        '多窗口时，将 Project name 作为窗口标题',
      ],
      changed: ['UI 渲染性能优化：优化多任务并行执行时的 UI 渲染性能，提升复杂工作流下的响应速度'],
      fixed: [
        '修复文件变更摘要 Bug：修复 file-changes-summary 组件的显示问题',
        '路径处理兼容：修复 Windows 和 Unix 路径处理的兼容性问题',
        'Fix Mac 的 dock menu 显示最近 project 的 Bug',
      ],
    },
  },
];

export function getChangelogForVersion(version: string): ChangelogEntry | undefined {
  return CHANGELOG_DATA.find((entry) => entry.version === version);
}

export function getLatestChangelog(): ChangelogEntry | undefined {
  return CHANGELOG_DATA[0];
}
