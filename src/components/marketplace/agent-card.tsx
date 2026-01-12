// Marketplace agent card component

import type { RemoteAgentConfig } from '@talkcody/shared/types/remote-agents';
import { User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface MarketplaceAgentCardProps {
  agent: RemoteAgentConfig;
  onClick: () => void;
  onInstall?: (agent: RemoteAgentConfig) => void;
  isInstalling?: boolean;
}

export function MarketplaceAgentCard({
  agent,
  onClick,
  onInstall,
  isInstalling = false,
}: MarketplaceAgentCardProps) {
  return (
    <Card className="cursor-pointer hover:bg-accent transition-colors" onClick={onClick}>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center">
            <User className="h-6 w-6 text-primary" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg truncate">{agent.name}</CardTitle>
              {agent.isBeta && (
                <Badge variant="default" className="shrink-0">
                  Beta
                </Badge>
              )}
            </div>

            <CardDescription className="text-xs line-clamp-2 mt-1">
              {agent.description}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <span className="font-medium">{agent.category}</span>
          </div>
        </div>
      </CardContent>

      <CardFooter className="gap-2">
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          View Details
        </Button>
        <Button
          size="sm"
          className="flex-1"
          onClick={(e) => {
            e.stopPropagation();
            onInstall?.(agent);
          }}
          disabled={isInstalling || !onInstall}
        >
          {isInstalling ? 'Installing...' : 'Install'}
        </Button>
      </CardFooter>
    </Card>
  );
}
