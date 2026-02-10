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
    version: '0.4.0',
    date: '2026-02-09',
    en: {
      added: [
        {
          title: 'Telegram Remote Control',
          description:
            'Support Telegram remote control for desktop TalkCody, supporting text, voice, and image messages with streaming response support. [Documentation](/docs/features/telegram-remote)',
        },
        {
          title: 'Feishu (Lark) Remote Control',
          description:
            'Support Feishu remote control for desktop TalkCody, supporting text, voice, and image messages with streaming response support. [Documentation](/docs/features/feishu-remote)',
        },
        'Voice Transcription: Added Groq Whisper voice transcription support, available for free.',
        'Model Support: Added OpenRouter Pony Alpha free model.',
        'Explore Agent: Open Explore Agent, suitable for quickly understanding code repositories.',
      ],
      fixed: [
        'Fixed custom Provider configuration and request issues.',
        'Fixed input Token status display issue.',
        'Fixed share page theme display issue.',
      ],
    },
    zh: {
      added: [
        {
          title: 'Telegram 远程控制',
          description:
            '支持 Telegram 远程控制桌面的TalkCody，支持文本，语音，图片消息，支持流式返回消息。[文档](/zh/docs/features/telegram-remote)',
        },
        {
          title: '飞书 远程控制',
          description:
            '支持飞书远程控制桌面的TalkCody，支持文本，语音，图片消息，支持流式返回消息。[文档](/zh/docs/features/feishu-remote)',
        },
        '语音转写：新增 Groq Whisper 语音转写支持，可以免费使用。',
        '模型支持：新增 OpenRouter 的 Pony Alpha 免费模型。',
        'Explore Agent：开放 Explore Agent，适合快速了解代码仓库。',
      ],
      fixed: [
        '修复自定义 Provider 相关配置与请求问题。',
        '修复输入 Token 状态显示问题。',
        '修复分享页面主题显示问题。',
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
