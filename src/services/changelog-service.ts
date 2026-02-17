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
    version: '0.4.2',
    date: '2026-02-16',
    en: {
      added: [
        {
          title: 'PPT Generator Agent',
          description: 'One-click AI-powered PPT generation.',
        },
        'Multiple Image Generation Models: Doubao Seedream, GLM Image, Qwen Image Max.',
        'Qwen 3.5 Plus Model: Added Qwen 3.5 Plus model support.',
        {
          title: 'Prompt AI Enhancement',
          description: 'Enhanced AI prompt generation for better results.',
        },
        '[PPT Generator Documentation](/docs/features/ppt-generator)',
        '[Image Generator Documentation](/docs/features/image-generator)',
      ],
      fixed: [
        'Fixed Compaction Bug: Fixed context compaction related bug.',
        'Fixed Windows compatibility bug.',
      ],
    },
    zh: {
      added: [
        {
          title: 'PPT 生成 Agent',
          description: '利用 AI 一键生成 PPT。',
        },
        '多个图片生成模型：Doubao Seedream, GLM Image, Qwen Image Max。',
        'Qwen 3.5 Plus 模型：新增 Qwen 3.5 Plus 模型支持。',
        {
          title: 'Prompt AI 增强',
          description: '对 Prompt AI 进行增强，提升生成效果。',
        },
        '[PPT 生成器文档](/zh/docs/features/ppt-generator)',
        '[图片生成器文档](/zh/docs/features/image-generator)',
      ],
      fixed: ['修复压缩 Bug：修复上下文压缩相关的 bug。', '修复 Windows 兼容性 bug。'],
    },
  },
];

export function getChangelogForVersion(version: string): ChangelogEntry | undefined {
  return CHANGELOG_DATA.find((entry) => entry.version === version);
}

export function getLatestChangelog(): ChangelogEntry | undefined {
  return CHANGELOG_DATA[0];
}
