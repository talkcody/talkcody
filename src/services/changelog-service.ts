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
    version: '0.1.19',
    date: '2025-12-18',
    en: {
      added: [
        'Multi-Agent parallel execution (experimental), supporting multiple agents executing tasks simultaneously',
        'Git Worktree-based parallel task execution (experimental), supporting multiple tasks running in isolated working directories',
        'One-click Git Commit: Added Commit button in file changes summary, AI automatically generates commit message',
        'One-click Code Review: Added Review button in file changes summary to invoke Code Review Agent',
      ],
      changed: [
        'Improved MCP tool selection button',
        'Optimized local Agent loading performance',
        'Improved Edit File tool',
        'Improved dangerous command detection in Bash tool',
        'Optimized Context Compaction logic',
        'Optimized AI request retry strategy',
      ],
      fixed: [
        'Fixed Windows terminal bug',
        'Fixed global content search exiting immediately when pressing space',
      ],
    },
    zh: {
      added: [
        '多 Agent 并行执行（实验版本），支持多个 Agent 同时执行任务',
        '基于 Git Worktree 的 Task 并行执行（实验版本），支持多个 Task 在独立工作目录中并行运行',
        '一键 Git Commit：在文件变更摘要中新增 Commit 按钮，AI 自动生成提交信息',
        '一键 Code Review：在文件变更摘要中新增 Review 按钮，一键调用 Code Review Agent',
      ],
      changed: [
        '优化 MCP 工具选择按钮',
        '优化本地 Agent 加载性能',
        '改进 Edit File 工具',
        '改进 Bash 工具的危险命令检测',
        '优化 Context Compaction 逻辑',
        '优化 AI 请求的重试策略',
      ],
      fixed: ['修复 Windows 终端的 bug', '修复全局内容搜索空格直接退出的 bug'],
    },
  },
  {
    version: '0.1.18',
    date: '2025-12-13',
    en: {
      added: [
        'Editor Lint feature with real-time syntax checking and quick fixes',
        'GPT 5.2 model support',
        'New feature documentation: Coding Plan, Web Search, Voice Input, Code Lint',
      ],
      changed: ['Improved Web Search tool', 'Improved Web Fetch tool'],
      fixed: [
        'Fixed Windows PowerShell terminal bug',
        'Fixed missing environment variables due to not correctly reading bashrc/zshrc',
      ],
    },
    zh: {
      added: [
        '编辑器代码检查功能 (Editor Lint)，支持实时语法检查和快速修复',
        'GPT 5.2 模型支持',
        '新增功能文档：Coding Plan、网页搜索、语音输入、代码检查',
      ],
      changed: ['改进网页搜索工具', '改进 Web fetch 工具'],
      fixed: [
        '修复 Windows PowerShell 终端 bug',
        '修复没有正确获取 bashrc/zshrc 导致环境变量缺失的问题',
      ],
    },
  },
  {
    version: '0.1.17',
    date: '2025-12-11',
    en: {
      added: [
        'Support for multiple sessions running in parallel, significantly improving workflow efficiency',
        'Custom AI provider configuration support',
        'New built-in Minimax Coding Plan MCP with web search and image input support',
        'New built-in GLM Coding Plan MCP with web search and image input support',
        'New built-in AI provider: Moonshot',
        'New built-in model: GLM-4.6 v',
      ],
      changed: [
        'Optimized Bash tool output for better performance',
        'Optimized GitHub PR tool output for better performance',
        'Optimized Context Compaction logic for improved multi-turn conversation performance',
      ],
      fixed: [
        'Fixed HTTP MCP server header configuration bug',
        'Fixed Stdio MCP server not supporting custom environment variables',
        'Fixed database exit issue when using multiple windows',
      ],
    },
    zh: {
      added: [
        '支持多个会话并行执行, 大幅提升工作流效率',
        '支持自定义 AI 提供商',
        '新增内置 Minimax Coding Plan MCP，支持网页搜索和图像输入',
        '新增内置 GLM Coding Plan MCP，支持网页搜索和图像输入',
        '新增内置 AI 提供商：moonshot',
        '新增内置模型：GLM-4.6 v',
      ],
      changed: [
        '优化 Bash 工具输出以提升性能',
        '优化 Github PR 工具输出以提升性能',
        '优化 Context Compaction 逻辑，提升多轮对话性能',
      ],
      fixed: [
        '修复 HTTP MCP 服务器请求头配置问题',
        '修复 Stdio MCP 服务器不支持自定义环境变量的问题',
        '修复多窗口时，数据库提前退出时的问题',
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
