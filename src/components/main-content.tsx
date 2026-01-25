import { AgentsPage } from '@/pages/agents-page';
import { ExplorerPage } from '@/pages/explorer-page';
import { LogsPage } from '@/pages/logs-page';
import { MCPServersPage } from '@/pages/mcp-servers-page';
import { ProjectsPage } from '@/pages/projects-page';
import { SettingsPage } from '@/pages/settings-page';
import { SkillsPage } from '@/pages/skills-page';
import ToolPlayground from '@/pages/tool-playground-page';
import { UsageDashboardPage } from '@/pages/usage-dashboard-page';
import { NavigationView } from '@/types/navigation';

interface MainContentProps {
  activeView: NavigationView;
}

export function MainContent({ activeView }: MainContentProps) {
  return (
    <div className="h-full w-full">
      {/* Keep ExplorerPage and ChatOnlyPage mounted to preserve state (legacy) */}
      <div className={activeView === NavigationView.EXPLORER ? 'h-full' : 'hidden'}>
        <ExplorerPage />
      </div>

      {/* Lazy load these pages to avoid unnecessary network requests on startup */}
      {activeView === NavigationView.PROJECTS && <ProjectsPage />}

      {activeView === NavigationView.AGENTS_MARKETPLACE && <AgentsPage />}

      {activeView === NavigationView.SKILLS_MARKETPLACE && <SkillsPage />}

      {activeView === NavigationView.MCP_SERVERS && <MCPServersPage />}

      {activeView === NavigationView.TOOLS_PLAYGROUND && <ToolPlayground />}

      {activeView === NavigationView.USAGE && <UsageDashboardPage />}

      {activeView === NavigationView.LOGS && <LogsPage />}

      {activeView === NavigationView.SETTINGS && <SettingsPage />}
    </div>
  );
}
