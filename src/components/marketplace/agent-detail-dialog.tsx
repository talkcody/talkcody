// Agent detail dialog

import type { RemoteAgentConfig } from '@talkcody/shared/types/remote-agents';
import { Calendar, Package } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMarketplace } from '@/hooks/use-marketplace';
import { logger } from '@/lib/logger';
import { MODEL_TYPE_LABELS } from '@/types/model-types';

interface AgentDetailDialogProps {
  agent: RemoteAgentConfig;
  open: boolean;
  onClose: () => void;
}

export function AgentDetailDialog({ agent, open, onClose }: AgentDetailDialogProps) {
  const [isInstalling, setIsInstalling] = useState(false);
  const { installAgent } = useMarketplace();

  // Debug: Log agent data when dialog opens
  if (open) {
    logger.debug('Agent Detail Dialog - Agent Data:', {
      name: agent.name,
      id: agent.id,
    });
  }

  const handleInstall = async () => {
    setIsInstalling(true);
    try {
      await installAgent(agent.id, agent.version || '1.0.0');
      toast.success(`${agent.name} installed successfully!`);
      onClose();
    } catch (error) {
      toast.error('Failed to install agent');
      logger.error('Install error:', error);
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-fit min-w-4/5 max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-md bg-primary/10 flex items-center justify-center">
              <Package className="h-8 w-8 text-primary" />
            </div>

            <div className="flex-1">
              <DialogTitle className="text-2xl">{agent.name}</DialogTitle>
              <DialogDescription className="mt-1">{agent.description}</DialogDescription>

              <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />v{agent.version || '1.0.0'}
                </div>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="mt-4">
          <Tabs defaultValue="overview">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="configuration">Configuration</TabsTrigger>
              <TabsTrigger value="author">Repository</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4 space-y-4">
              {/* Category */}
              <div>
                <h3 className="text-sm font-semibold mb-2">Category</h3>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{agent.category}</Badge>
                </div>
              </div>

              {/* Model */}
              <div>
                <h3 className="text-sm font-semibold mb-2">AI Model Type</h3>
                <p className="text-sm text-muted-foreground">
                  {MODEL_TYPE_LABELS[agent.modelType as keyof typeof MODEL_TYPE_LABELS] ||
                    agent.modelType}
                </p>
              </div>

              {/* Metadata */}
              <div>
                <h3 className="text-sm font-semibold mb-2">Metadata</h3>
                <div className="text-sm space-y-1">
                  <div>
                    <span className="text-muted-foreground">Repository:</span> {agent.repository}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Path:</span> {agent.githubPath}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="configuration" className="mt-4 space-y-4">
              {/* System Prompt */}
              <div>
                <h3 className="text-sm font-semibold mb-2">System Prompt</h3>
                <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap">
                  {agent.systemPrompt}
                </pre>
              </div>

              {/* Rules */}
              {agent.rules && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Rules</h3>
                  <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap">
                    {agent.rules}
                  </pre>
                </div>
              )}

              {/* Output Format */}
              {agent.outputFormat && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Output Format</h3>
                  <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap">
                    {agent.outputFormat}
                  </pre>
                </div>
              )}
            </TabsContent>

            <TabsContent value="author" className="mt-4 space-y-4">
              <div className="text-sm space-y-2">
                <div>
                  <span className="text-muted-foreground">Repository:</span> {agent.repository}
                </div>
                <div>
                  <span className="text-muted-foreground">Path:</span> {agent.githubPath}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <div className="flex gap-2 mt-4">
          <Button onClick={handleInstall} disabled={isInstalling} className="flex-1">
            {isInstalling ? 'Installing...' : 'Install Agent'}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
