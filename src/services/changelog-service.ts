// Changelog data service for What's New dialog

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
    version: '0.4.1',
    date: '2026-02-11',
    en: {
      added: [
        {
          title: 'Video Input Support',
          description:
            'Added video input feature, allowing direct generation of frontend pages from videos (currently only Kimi API model is supported, more models will be supported in the next version).',
        },
        'MiniMax M2.5 Model: Added MiniMax M2.5 model support and set it as the default free model.',
        'GLM-5 Model: Added GLM-5 series model support.',
      ],
      changed: ['Made Kimi Coding Plan a separate Provider.'],
      fixed: [
        'Fixed Issue #50: Fixed terminal panel related bug.',
        'Fixed Issue #51: Fixed workspace root related bug.',
        'Fixed Issue #52: Fixed bug where application did not fully exit when window was closed.',
      ],
    },
    zh: {
      added: [
        {
          title: '视频输入支持',
          description:
            '新增视频输入功能，可以直接根据视频生成前端页面（当前只有 Kimi API 模型支持，下个版本将支持更多模型）。',
        },
        'MiniMax M2.5 模型：新增 MiniMax M2.5 模型支持，并设为默认免费模型。',
        'GLM-5 模型：新增 GLM-5 系列模型。',
      ],
      changed: ['将 Kimi Coding Plan 作为单独的 Provider。'],
      fixed: [
        '修复 Issue #50：修复终端面板相关的 bug。',
        '修复 Issue #51：修复 workspace root 相关的 bug。',
        '修复 Issue #52：修复窗口关闭应用没有完全退出的 bug。',
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
