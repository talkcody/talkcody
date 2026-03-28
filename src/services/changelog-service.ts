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
    version: '0.5.0',
    date: '2026-03-28',
    en: {
      added: [
        'New Global Memory System: Support for global and project-level Memory management, with Topic-based storage mechanism.',
        'Orchestrator Agent: New orchestration Agent for task scheduling and Agent coordination.',
        'ZenMux Provider: New ZenMux model provider support.',
        'Increased Parallel Agent Limit: Maximum parallel sub-agent count increased to 20, supporting more complex parallel workflows.',
      ],
      fixed: [
        'Fixed Windows platform path check issues.',
        'Fixed http_proxy decoding errors.',
        'Fixed code-search tool bug.',
      ],
    },
    zh: {
      added: [
        '新增全局 Memory 系统：支持全局和项目级别的 Memory 管理，支持基于 Topic 的存储机制。',
        'Orchestrator Agent：新增编排 Agent，负责任务调度和 Agent 协调。',
        'ZenMux Provider：新增 ZenMux 模型提供商支持。',
        '并行 Agent 数量提升：将最大并行子 Agent 数量提升至 20 个，支持更复杂的并行工作流。',
      ],
      fixed: [
        '修复 Windows 平台路径检查问题。',
        '修复 http_proxy 解码错误。',
        '修复 code-search tool bug。',
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
