/**
 * Import GitHub Agents Dialog
 */

import { AlertCircle, CheckCircle2, Download, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/hooks/use-locale';
import { logger } from '@/lib/logger';
import { agentRegistry } from '@/services/agents/agent-registry';
import { importAgentFromGitHub } from '@/services/agents/github-import-agent-service';
import { getAvailableToolsForUISync } from '@/services/agents/tool-registry';
import type { AgentToolSet } from '@/types/agent';
import type { ModelType } from '@/types/model-types';

interface ImportGitHubAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete?: () => void;
}

type DialogStep = 'input' | 'importing' | 'result';

export function ImportGitHubAgentDialog({
  open,
  onOpenChange,
  onImportComplete,
}: ImportGitHubAgentDialogProps) {
  const t = useTranslation();
  const urlInputId = useId();

  const [step, setStep] = useState<DialogStep>('input');
  const [githubUrl, setGithubUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{
    succeeded: string[];
    failed: Array<{ name: string; error: string }>;
  } | null>(null);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setStep('input');
      setGithubUrl('');
      setError(null);
      setImportResult(null);
    }
  }, [open]);

  const parseGitHubUrl = useCallback(
    (url: string): { repository: string; path: string; branch?: string } | null => {
      try {
        const parsed = new URL(url);
        if (parsed.hostname !== 'github.com') {
          return null;
        }

        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts.length < 2) {
          return null;
        }

        const owner = parts[0];
        const repo = parts[1];
        const repository = `${owner}/${repo}`;

        // Handle /tree/{branch}/{path}
        if (parts[2] === 'tree' && parts.length > 3) {
          const branch = parts[3];
          const path = parts.slice(4).join('/');
          return { repository, path, branch };
        }

        // Handle /blob/{branch}/{path}
        if (parts[2] === 'blob' && parts.length > 3) {
          const branch = parts[3];
          const path = parts.slice(4).join('/');
          return { repository, path, branch };
        }

        // Default to repo root
        return { repository, path: '' };
      } catch (parseError) {
        logger.warn('Failed to parse GitHub URL:', parseError);
        return null;
      }
    },
    []
  );

  const handleImport = useCallback(async () => {
    if (!githubUrl.trim()) {
      setError(t.Agents.githubImport.urlRequired);
      return;
    }

    setError(null);
    setStep('importing');

    try {
      const parsed = parseGitHubUrl(githubUrl);
      if (!parsed) {
        setError(t.Agents.githubImport.invalidUrl);
        setStep('input');
        return;
      }

      const agentId = parsed.path.split('/').filter(Boolean).pop() || 'remote-agent';
      const agentConfigs = await importAgentFromGitHub({
        repository: parsed.repository,
        path: parsed.path,
        agentId,
        branch: parsed.branch,
      });

      const availableTools = getAvailableToolsForUISync();
      const toolIds = new Set(availableTools.map((tool) => tool.id));

      const succeeded: string[] = [];
      const failed: Array<{ name: string; error: string }> = [];

      for (const agentConfig of agentConfigs) {
        try {
          const baseId = agentConfig.id
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');

          let localId = baseId || agentId;
          let counter = 1;
          while (await agentRegistry.get(localId)) {
            localId = `${baseId || agentId}-${counter++}`;
          }

          const resolvedTools: Record<string, unknown> = {};
          const toolList = Array.isArray(agentConfig.tools)
            ? agentConfig.tools
            : Object.keys((agentConfig.tools || {}) as Record<string, unknown>);

          for (const toolId of toolList) {
            if (!toolIds.has(toolId)) continue;
            const match = availableTools.find((tool) => tool.id === toolId);
            if (match) {
              resolvedTools[toolId] = match.ref;
            }
          }

          await agentRegistry.forceRegister({
            id: localId,
            name: agentConfig.name,
            description: agentConfig.description,
            modelType: agentConfig.modelType as ModelType,
            systemPrompt: agentConfig.systemPrompt,
            tools: resolvedTools as AgentToolSet,
            hidden: agentConfig.hidden,
            rules: agentConfig.rules,
            outputFormat: agentConfig.outputFormat,
            isDefault: false,
            dynamicPrompt: agentConfig.dynamicPrompt,
            defaultSkills: agentConfig.defaultSkills,
            isBeta: agentConfig.isBeta,
            role: agentConfig.role,
            canBeSubagent: agentConfig.canBeSubagent,
            version: agentConfig.version,
          });

          succeeded.push(agentConfig.name);
        } catch (registerError) {
          failed.push({
            name: agentConfig.name,
            error: registerError instanceof Error ? registerError.message : 'Register failed',
          });
        }
      }

      if (succeeded.length === 0 && failed.length === 0) {
        throw new Error('No valid agents found');
      }

      setImportResult({ succeeded, failed });
      setStep('result');

      const { useAgentStore } = await import('@/stores/agent-store');
      await useAgentStore.getState().refreshAgents();

      onImportComplete?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : t.Agents.githubImport.networkError;
      logger.error('Import agent failed:', err);
      setImportResult({
        succeeded: [],
        failed: [{ name: githubUrl, error: message }],
      });
      setStep('result');
    }
  }, [githubUrl, t, onImportComplete, parseGitHubUrl]);

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleTryAgain = () => {
    setStep('input');
    setGithubUrl('');
    setError(null);
    setImportResult(null);
  };

  const renderStepContent = () => {
    switch (step) {
      case 'input':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={urlInputId}>{t.Agents.githubImport.urlLabel}</Label>
              <Input
                id={urlInputId}
                placeholder={t.Agents.githubImport.urlPlaceholder}
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleImport();
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">{t.Agents.githubImport.urlHint}</p>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
        );

      case 'importing':
        return (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{t.Agents.githubImport.scanning}</p>
          </div>
        );

      case 'result':
        return (
          <div className="space-y-4">
            {importResult?.succeeded.length ? (
              <Alert>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <AlertDescription>
                  {importResult.succeeded.length} {t.Agents.githubImport.imported}
                </AlertDescription>
              </Alert>
            ) : null}

            {importResult?.failed.length ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {importResult.failed.length} {t.Agents.githubImport.failed}
                </AlertDescription>
              </Alert>
            ) : null}

            {importResult?.failed.length ? (
              <div className="space-y-2">
                {importResult.failed.map((item) => (
                  <div key={item.name} className="text-xs text-muted-foreground">
                    {item.name}: {item.error}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.Agents.githubImport.title}</DialogTitle>
          <DialogDescription>{t.Agents.githubImport.description}</DialogDescription>
        </DialogHeader>

        {renderStepContent()}

        <DialogFooter className="gap-2">
          {step === 'input' && (
            <Button onClick={handleImport} className="flex-1">
              <Download className="h-4 w-4 mr-2" />
              {t.Agents.githubImport.import}
            </Button>
          )}

          {step === 'result' && (
            <Button variant="outline" onClick={handleTryAgain}>
              {t.Common.retry}
            </Button>
          )}

          <Button variant="outline" onClick={handleClose}>
            {t.Agents.githubImport.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
