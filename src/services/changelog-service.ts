export type ChangelogItem =
  | string
  | {
      title: string;
      description?: string;
      videoUrl?: string;
    };

export interface ChangelogContent {
  added?: ChangelogItem[];
  changed?: ChangelogItem[];
  fixed?: ChangelogItem[];
  removed?: ChangelogItem[];
  security?: ChangelogItem[];
  deprecated?: ChangelogItem[];
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
    version: '0.6.0',
    date: '2026-04-25',
    en: {
      added: [
        'Task Queue: Queue the current prompt as the next task and import todo items from Markdown with `/import-tasks`.',
        'WeChat Remote Control: Connect TalkCody to personal WeChat chats through iLink.',
        'Auto Git Commit & Auto Check Finish: New optional completion hooks can verify results and commit code automatically after a task ends.',
        'Local Agent & Skill Import: Import Agents and Skills directly from local folders.',
        'Model Updates: Added GPT-5.5, Claude Opus 4.7, Kimi K2.6, DeepSeek V4 Pro, and DeepSeek V4 Flash.',
      ],
      changed: [
        'Normalized Skill Install Directories: Unified installed skill folder naming for more consistent local and GitHub imports.',
        'Search & Glob Improvements: Improved pattern matching and automatically fall back to literal search when a regex is invalid.',
        'Agent Loop Retry Improvements: Improved retry stability for longer and more complex runs.',
      ],
      fixed: [
        'Fixed task queue state issues that could prevent queued tasks from starting correctly.',
        'Fixed Auto Code Review hook continuation behavior.',
        'Fixed code-search handling when `file_types` is empty.',
        'Fixed cached input token accounting in some model responses.',
      ],
    },
    zh: {
      added: [
        '任务队列：支持将当前输入排队为下一项任务，并通过 `/import-tasks` 从 Markdown 待办清单批量导入任务。',
        '微信远程控制：支持通过 iLink 绑定个人微信私聊来远程控制 TalkCody。',
        '自动 Git 提交与自动完成检查：新增可选的完成钩子，可在任务结束后自动校验结果并提交代码。',
        '本地导入 Agents / Skills：支持直接从本地目录导入 Agents 和 Skills。',
        '模型更新：新增 GPT-5.5、Claude Opus 4.7、Kimi K2.6、DeepSeek V4 Pro 和 DeepSeek V4 Flash。',
      ],
      changed: [
        'Skills 安装目录规范化：统一 Skills 安装目录命名，提升本地导入和 GitHub 导入的一致性。',
        '搜索与 Glob 工具增强：改进模式匹配能力，并在正则表达式无效时自动回退为字面量搜索。',
        'Agent Loop 重试优化：增强长任务和复杂任务场景下的重试稳定性。',
      ],
      fixed: [
        '修复任务队列状态问题，避免排队任务无法正常启动。',
        '修复 Auto Code Review Hook 的续跑逻辑问题。',
        '修复 code-search 在空 `file_types` 过滤条件下的处理问题。',
        '修复部分模型响应中的 cached input token 统计问题。',
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
