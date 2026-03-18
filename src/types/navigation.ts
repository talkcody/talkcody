export enum NavigationView {
  EXPLORER = 'explorer',
  PROJECTS = 'projects',
  AGENTS_MARKETPLACE = 'agents-marketplace',
  SKILLS_MARKETPLACE = 'skills-marketplace',
  MCP_SERVERS = 'mcp-servers',
  TOOLS_PLAYGROUND = 'tools-playground',
  SCHEDULED_TASKS = 'scheduled-tasks',
  USAGE = 'usage',
  LLM_TRACING = 'llm-tracing',
  LOGS = 'logs',
  SETTINGS = 'settings',
}

export enum SidebarView {
  FILES = 'files',
  TASKS = 'tasks',
}

export interface NavigationItem {
  id: NavigationView;
  icon: string;
  label: string;
  tooltip: string;
}
