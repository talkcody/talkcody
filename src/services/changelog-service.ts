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
    version: '0.2.5',
    date: '2026-01-11',
    en: {
      added: [
        'Custom Tools Support (Experimental): Added Custom Tools and Custom Tools Playground, allowing users to define custom AI tools with core capability to customize UI.',
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
        '支持自定义工具（实验版本）：新增 Custom Tools 和 Custom Tools Playground，支持用户自定义 AI 工具，核心能力是可以自定义 UI',
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
