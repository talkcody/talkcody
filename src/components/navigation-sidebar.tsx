import { open } from '@tauri-apps/plugin-shell';
import {
  Activity,
  Bot,
  Files,
  FileText,
  FolderOpen,
  Github,
  Server,
  Settings,
  Wrench,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useLocale } from '@/hooks/use-locale';

import { cn } from '@/lib/utils';
import { NavigationView } from '@/types/navigation';

interface NavigationSidebarProps {
  activeView: NavigationView;
  onViewChange: (view: NavigationView) => void;
}

export function NavigationSidebar({ activeView, onViewChange }: NavigationSidebarProps) {
  const { t } = useLocale();

  const navigationItems = [
    {
      id: NavigationView.EXPLORER,
      icon: Files,
      tooltip: `${t.Navigation.explorerTooltip}`,
    },
    {
      id: NavigationView.PROJECTS,
      icon: FolderOpen,
      tooltip: `${t.Navigation.projectsTooltip}`,
    },
    {
      id: NavigationView.AGENTS_MARKETPLACE,
      icon: Bot,
      tooltip: `${t.Navigation.agentsTooltip}`,
    },
    {
      id: NavigationView.SKILLS_MARKETPLACE,
      icon: Zap,
      tooltip: `${t.Navigation.skillsTooltip}`,
    },
    {
      id: NavigationView.MCP_SERVERS,
      icon: Server,
      tooltip: `${t.Navigation.mcpServersTooltip}`,
    },

    {
      id: NavigationView.USAGE,
      icon: Activity,
      tooltip: `${t.Navigation.usageTooltip}`,
    },
  ];

  const handleSettingsClick = () => {
    onViewChange(NavigationView.SETTINGS);
  };

  const handleAgentsClick = () => {
    onViewChange(NavigationView.AGENTS_MARKETPLACE);
  };

  const handleGitHubClick = () => {
    open('https://github.com/talkcody/talkcody');
  };

  const bottomNavigationItems = [
    {
      id: NavigationView.TOOLS_PLAYGROUND,
      icon: Wrench,
      tooltip: `${t.Navigation.toolsPlaygroundTooltip}`,
      action: () => onViewChange(NavigationView.TOOLS_PLAYGROUND),
    },
    {
      id: 'github',
      icon: Github,
      tooltip: t.Navigation.githubTooltip,
      action: handleGitHubClick,
    },
    {
      id: NavigationView.LOGS,
      icon: FileText,
      tooltip: t.Navigation.logsTooltip,
      action: () => onViewChange(NavigationView.LOGS),
    },
  ];

  return (
    <div className="flex h-full w-12 flex-col border-r bg-gray-50 dark:bg-gray-900">
      {/* Top Navigation Items */}
      <div className="flex flex-col items-center space-y-1 p-1">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;

          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-10 w-10 p-0',
                    'hover:bg-gray-200 dark:hover:bg-gray-800',
                    isActive && 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400'
                  )}
                  onClick={() => {
                    if (item.id === NavigationView.AGENTS_MARKETPLACE) {
                      handleAgentsClick();
                    } else {
                      onViewChange(item.id);
                    }
                  }}
                >
                  <Icon className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{item.tooltip}</TooltipContent>
            </Tooltip>
          );
        })}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-10 w-10 p-0 hover:bg-gray-200 dark:hover:bg-gray-800"
              onClick={handleSettingsClick}
            >
              <Settings className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{t.Navigation.settingsTooltip}</TooltipContent>
        </Tooltip>
      </div>

      {/* Bottom Settings Items */}
      <div className="mt-auto flex flex-col items-center space-y-1 p-1">
        {bottomNavigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === NavigationView.LOGS && activeView === NavigationView.LOGS;

          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-10 w-10 p-0',
                    'hover:bg-gray-200 dark:hover:bg-gray-800',
                    isActive && 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400'
                  )}
                  onClick={item.action}
                >
                  <Icon className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{item.tooltip}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
