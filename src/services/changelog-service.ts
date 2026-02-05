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
    version: '0.3.4',
    date: '2026-02-04',
    en: {
      changed: [
        {
          title: 'User Abort Handling',
          description: 'Optimized the user abort handling process before Hook is triggered.',
        },
      ],
      fixed: [
        'Fixed multiple cross-platform path separator compatibility issues.',
        'Fixed issue where current task was not reset when switching projects.',
        'Fixed Issue #43 & #44: Custom model loss bug.',
        'Fixed Gemini model schema error and Google AI API 400 error.',
        'Fixed Issue #45: GitHub Skill import bug.',
      ],
    },
    zh: {
      changed: [
        {
          title: '用户中止处理',
          description: '优化了用户在 Hook 触发前中止操作的处理流程。',
        },
      ],
      fixed: [
        '修复了多处跨平台路径分隔符兼容性问题。',
        '修复了切换项目时未重置当前任务的问题。',
        '修复 Issue #43 & #44：自定义模型丢失的 bug。',
        '修复了 Gemini 模型 Schema 错误及 Google AI API 400 错误。',
        '修复 Issue #45：GitHub Skill 导入的 bug。',
      ],
    },
  },
  {
    version: '0.3.3',
    date: '2026-02-02',
    en: {
      added: [
        {
          title: 'LLM Tracing',
          description:
            'Added complete LLM tracing functionality, supporting recording and viewing detailed AI request processes, execution time, Token usage, and Tool call details for debugging and prompt optimization.',
        },
        {
          title: 'Kimi Coding Plan Usage',
          description: 'Added support for displaying Kimi Coding Plan usage statistics.',
        },
      ],
      changed: [
        'Rust Backend LLM Architecture Refactoring: Refactored the LLM processing logic on the Rust side, laying the foundation for supporting 10-20 tasks in parallel.',
      ],
      fixed: [
        'Fixed window state save and restore bugs, improving multi-window experience.',
        'Fixed Issue #36: Optimized UI rendering logic in specific scenarios.',
        'Fixed Issue #39: Improved Bash tool execution feedback for complex commands.',
        'Fixed Issue #40: Fixed infinite refresh bug on Agents page.',
        'Fixed Kimi Coding Plan bugs.',
      ],
    },
    zh: {
      added: [
        {
          title: 'LLM Tracing',
          description:
            '新增完整的 LLM 追踪功能，支持记录和查看所有 AI 请求的详细过程、耗时、Token 使用情况以及 Tool 调用细节，方便调试和优化 Prompt。',
        },
        {
          title: 'Kimi Coding Plan Usage',
          description: '支持展示 Kimi Coding Plan 的用量统计。',
        },
      ],
      changed: [
        'Rust 后端 LLM 架构重构：重构了 Rust 端的 LLM 处理逻辑，为支持10到20个 Task 并行处理奠定基础。',
      ],
      fixed: [
        '修复窗口状态保存和恢复的 Bug，提升多窗口体验。',
        '修复 Issue #36：优化了特定场景下的 UI 渲染逻辑。',
        '修复 Issue #39：改进了 Bash 工具在某些复杂命令下的执行反馈。',
        '修复 Issue #40: Agents 页面无限刷新的 bug。',
        '修复了 Kimi Coding Plan 的bug。',
      ],
    },
  },
  {
    version: '0.3.2',
    date: '2026-01-27',
    en: {
      added: [
        {
          title: 'Ralph Loop (Experimental)',
          description:
            'New persistent execution mode supporting AI Agent autonomous iteration for complex tasks. Agents can continue learning across multiple iterations, self-correcting based on execution feedback until completion criteria are met.',
        },
        {
          title: 'Kimi 2.5 Model Support',
          description: 'Added support for Kimi 2.5 model.',
        },
      ],
      changed: [
        'Web Fetch Tool Optimization: Improved web content fetching capabilities',
        'Create Agent Agent Optimization: Improved custom Agent creation experience',
      ],
      fixed: [
        'Fixed tool UI registration related bugs',
        'Fixed custom tool UI display bugs',
        'Fixed recent project list bug',
        'Fixed LLM retry mechanism issues',
        'Fixed Whats New dialog video Linux platform compatibility issue',
      ],
    },
    zh: {
      added: [
        {
          title: 'Ralph Loop（实验版本）',
          description:
            '新增持久化执行模式，支持 AI Agent 自主迭代完成复杂任务。Agent 可以在多次迭代中持续学习，根据执行反馈自我修正，直到满足完成条件。',
        },
        {
          title: 'Kimi 2.5 模型支持',
          description: '新增对 Kimi 2.5 模型的支持。',
        },
      ],
      changed: [
        'Web Fetch 工具优化：改进网页内容获取能力',
        'Create Agent Agent 优化：改进创建自定义 Agent 的体验',
      ],
      fixed: [
        '修复工具 UI 注册相关 Bug',
        '修复自定义工具 UI 显示 Bug',
        '修复最近项目列表 Bug',
        '修复 LLM 重试机制问题',
        '修复更新日志弹窗视频在 Linux 平台的兼容性问题',
      ],
    },
  },
  {
    version: '0.3.1',
    date: '2026-01-25',
    en: {
      added: [
        {
          title: 'Hooks System',
          description:
            'New event-driven Hooks mechanism that supports triggering custom scripts at key events, enabling operation interception, parameter modification, audit logs, and more.',
          videoUrl: 'https://cdn.talkcody.com/images/talkcody-stop-hook.mp4',
        },
        {
          title: 'Auto Code Review',
          description:
            'Support for automatic code review (Auto Code Review), which automatically runs the Code Review Agent after file changes.',
          videoUrl: 'https://cdn.talkcody.com/images/TalkCody-code-review.mp4',
        },
        {
          title: 'API Usage Dashboard',
          description:
            'New API usage visualization page, displaying chart statistics for Token usage, costs, and request counts, with filtering by today/this week/this month.',
          videoUrl: 'https://cdn.talkcody.com/images/talkcody-api-usage.mp4',
        },
        {
          title: 'LSP Tools',
          description:
            'New complete LSP tools, supporting go-to-definition, find references, hover hints, document symbols, workspace symbols, go-to-implementation, call hierarchy analysis, and other operations.',
        },
        {
          title: 'Custom Plan and Code Review Models',
          description:
            'Support for configuring dedicated models for Plan Agent and Code Review Agent in settings.',
        },
        {
          title: 'Direct Plan Content Display',
          description:
            'Display Plan file content directly in call-agent-tool-result without manually opening the file.',
        },
        {
          title: 'Custom Tool package.json Support',
          description:
            'Custom Tools now support using package.json to define dependencies, automatically installing npm/bun packages, supporting any third-party libraries.',
        },
      ],
      fixed: [
        'Fixed bugs related to AI Pricing Service and LSP Tool',
        'Fixed API Usage Tab refresh issue',
        'Fixed OpenAI compatible type path handling (automatically appends /v1)',
      ],
    },
    zh: {
      added: [
        {
          title: 'Hooks 系统',
          description:
            '新增事件驱动的 Hooks 机制，支持在关键事件（用户提交、工具调用前后、会话开始/结束、停止等）触发自定义脚本，实现操作拦截、参数修改、审计日志等功能。',
          videoUrl: 'https://cdn.talkcody.com/images/talkcody-stop-hook.mp4',
        },
        {
          title: '自动代码审查',
          description:
            '支持自动代码审查（Auto Code Review），在文件变更后自动运行 Code Review Agent 进行代码审查。',
          videoUrl: 'https://cdn.talkcody.com/images/TalkCody-code-review.mp4',
        },
        {
          title: 'API 使用量仪表板',
          description:
            '新增 API 使用量可视化页面，展示 Token 使用量、成本、请求数的图表统计，支持按今日/本周/本月筛选。',
          videoUrl: 'https://cdn.talkcody.com/images/talkcody-api-usage.mp4',
        },
        {
          title: 'LSP 工具',
          description:
            '新增完整的 LSP（Language Server Protocol）工具，支持跳转定义、查找引用、悬停提示、文档符号、工作区符号、跳转实现、调用层级分析等操作。',
        },
        {
          title: '自定义 Plan 和 Code Review 模型',
          description: '支持在设置中为 Plan Agent 和 Code Review Agent 分别配置专用模型。',
        },
        {
          title: 'Plan 内容直接展示',
          description: '在 call-agent-tool-result 中直接展示 Plan 文件内容，无需手动打开文件。',
        },
        {
          title: 'Custom Tool 支持 package.json',
          description:
            'Custom Tool 现在支持使用 package.json 定义依赖，自动安装 npm/bun 依赖包，支持任意第三方库。',
        },
      ],
      fixed: [
        '修复 AI Pricing Service 和 LSP Tool 的相关 Bug',
        '修复 API Usage Tab 刷新问题',
        '修复 OpenAI 兼容类型的路径处理（自动追加 /v1）',
      ],
    },
  },
  {
    version: '0.3.0',
    date: '2026-01-19',
    en: {
      added: [
        {
          title: 'Google Login Support',
          description: 'Sign in faster with Google accounts across devices.',
          videoUrl: 'https://talkcody.com/assets/videos/whats-new/google-login.mp4',
        },
        {
          title: 'New create-agent command',
          description: 'One-click creation of custom AI agents.',
          videoUrl: 'https://talkcody.com/assets/videos/whats-new/create-agent.mp4',
        },
        {
          title: 'New create-skill command',
          description: 'One-click creation of skills for your agents.',
          videoUrl: 'https://talkcody.com/assets/videos/whats-new/create-skill.mp4',
        },
        {
          title: 'New create-tool command',
          description: 'One-click creation of custom tools.',
          videoUrl: 'https://talkcody.com/assets/videos/whats-new/create-tool.mp4',
        },
        {
          title: 'New compact command',
          description: 'Manually compact conversations early.',
        },
        {
          title: 'Mac Keep Awake Support',
          description: 'Prevent system sleep while tasks run.',
        },
        {
          title: 'Auto-Approve Plan Setting Support',
          description: 'Ship faster with auto-approved plans.',
        },
        {
          title: 'Reasoning-Effort Setting Support',
          description: 'Tune performance with reasoning-effort.',
        },
        '[Commands Documentation](https://talkcody.com/docs/commands)',
      ],
    },
    zh: {
      added: [
        {
          title: '支持 Google 登录',
          description: '跨设备使用 Google 账户快速登录。',
          videoUrl: 'https://talkcody.com/assets/videos/whats-new/google-login.mp4',
        },
        {
          title: '新增 create-agent command',
          description: '一键创建自定义 AI 智能体。',
          videoUrl: 'https://talkcody.com/assets/videos/whats-new/create-agent.mp4',
        },
        {
          title: '新增 create-skill command',
          description: '一键创建 skill。',
          videoUrl: 'https://talkcody.com/assets/videos/whats-new/create-skill.mp4',
        },
        {
          title: '新增 create-tool command',
          description: '一键创建自定义工具。',
          videoUrl: 'https://talkcody.com/assets/videos/whats-new/create-tool.mp4',
        },
        {
          title: '新增 compact command',
          description: '支持手动提前压缩对话。',
        },
        {
          title: '支持 Mac Keep Awake 功能',
          description: '防止系统休眠。',
        },
        {
          title: '支持自动批准 plan 设置',
          description: '启用后可自动批准计划。',
        },
        {
          title: '支持 reasoning-effort 设置',
          description: '可调节推理强度。',
        },
        '[commands 文档](https://talkcody.com/docs/commands)',
      ],
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
