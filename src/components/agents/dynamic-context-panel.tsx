import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { logger } from '@/lib/logger';
import { previewSystemPrompt } from '@/services/prompt/preview';
import { getValidatedWorkspaceRoot } from '@/services/workspace-root-service';
import type { AgentDefinition } from '@/types/agent';
import type { PromptContextSource } from '@/types/prompt';

type KV = { key: string; value: string };

interface DynamicContextPanelProps {
  agent: AgentDefinition;
  onChange: (dynamicPrompt: {
    enabled: boolean;
    providers: string[];
    variables: Record<string, string>;
    providerSettings?: Record<string, unknown>;
  }) => void;
}

const PROVIDER_OPTIONS = [
  {
    id: 'env',
    label: 'Environment',
    desc: 'Injects environment info such as directory, git, platform, and date.',
    tokens: ['working_directory', 'is_git_repo', 'platform', 'today_date'],
  },
  {
    id: 'global_memory',
    label: 'Global Memory',
    desc: 'Injects user-level memory from the app data directory.',
    tokens: ['global_memory'],
  },
  {
    id: 'project_memory',
    label: 'Project Memory',
    desc: 'Injects the first 200 lines of the project MEMORY.md index from the current workspace memory workspace.',
    tokens: ['project_memory'],
  },
  {
    id: 'agents_md',
    label: 'Project Instructions',
    desc: 'Injects hierarchical AGENTS.md, CLAUDE.md, and GEMINI.md instructions.',
    tokens: ['agents_md'],
  },
  {
    id: 'output_format',
    label: 'Output Format',
    desc: 'Injects output format instructions from the current chat selection.',
    tokens: ['output_format_instruction'],
  },
] as const;

export function DynamicContextPanel({ agent, onChange }: DynamicContextPanelProps) {
  const searchStrategyId = useId();
  const maxDepthId = useId();
  const maxCharsId = useId();

  const [dynamicContextEnabled, setDynamicContextEnabled] = useState(
    agent.dynamicPrompt?.enabled ?? false
  );
  const [providers, setProviders] = useState<string[]>(agent.dynamicPrompt?.providers || []);
  const [variables, setVariables] = useState<KV[]>(
    Object.entries(agent.dynamicPrompt?.variables || {}).map(([key, value]) => ({ key, value }))
  );
  const [agentsMdMaxChars, setAgentsMdMaxChars] = useState<number>(
    (agent.dynamicPrompt?.providerSettings?.agents_md as { maxChars?: number })?.maxChars ?? 8000
  );
  const [agentsMdSearchStrategy, setAgentsMdSearchStrategy] = useState<string>(
    (agent.dynamicPrompt?.providerSettings?.agents_md as { searchStrategy?: string })
      ?.searchStrategy ?? 'hierarchical'
  );
  const [agentsMdMaxDepth, setAgentsMdMaxDepth] = useState<number | undefined>(
    (agent.dynamicPrompt?.providerSettings?.agents_md as { maxDepth?: number })?.maxDepth
  );
  const [preview, setPreview] = useState('');
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [resolvedSources, setResolvedSources] = useState<PromptContextSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const currentAgent: AgentDefinition = useMemo(
    () => ({
      ...agent,
      dynamicPrompt: {
        enabled: dynamicContextEnabled,
        providers,
        variables: Object.fromEntries(variables.map((kv) => [kv.key, kv.value])),
        providerSettings: {
          agents_md: {
            maxChars: agentsMdMaxChars,
            searchStrategy: agentsMdSearchStrategy as 'hierarchical' | 'root-only',
            maxDepth: agentsMdMaxDepth,
          },
        },
      },
    }),
    [
      agent,
      dynamicContextEnabled,
      providers,
      variables,
      agentsMdMaxChars,
      agentsMdSearchStrategy,
      agentsMdMaxDepth,
    ]
  );

  const refreshPreview = useCallback(async () => {
    setLoading(true);
    setError('');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const root = await getValidatedWorkspaceRoot();

      if (controller.signal.aborted) {
        throw new Error('Preview generation timed out');
      }

      const { finalSystemPrompt, unresolvedPlaceholders, resolvedContextSources } =
        await previewSystemPrompt({
          agent: currentAgent,
          workspaceRoot: root,
        });

      if (controller.signal.aborted) {
        return;
      }

      setPreview(finalSystemPrompt);
      setUnresolved(unresolvedPlaceholders);
      setResolvedSources(resolvedContextSources);
      setError('');
    } catch (err) {
      logger.error('Error refreshing preview:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(`Failed to generate preview: ${errorMessage}`);
      setPreview('');
      setUnresolved([]);
      setResolvedSources([]);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }, [currentAgent]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      refreshPreview().catch((err) => {
        logger.error('useEffect refreshPreview failed:', err);
      });
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [refreshPreview]);

  useEffect(() => {
    onChange({
      enabled: dynamicContextEnabled,
      providers,
      variables: Object.fromEntries(
        variables.filter((kv) => kv.key).map((kv) => [kv.key, kv.value])
      ),
      providerSettings: {
        agents_md: {
          maxChars: agentsMdMaxChars,
          searchStrategy: agentsMdSearchStrategy as 'hierarchical' | 'root-only',
          maxDepth: agentsMdMaxDepth,
        },
      },
    });
  }, [
    dynamicContextEnabled,
    providers,
    variables,
    agentsMdMaxChars,
    agentsMdSearchStrategy,
    agentsMdMaxDepth,
    onChange,
  ]);

  return (
    <Card className="border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Dynamic Context</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Enable</span>
            <Switch checked={dynamicContextEnabled} onCheckedChange={setDynamicContextEnabled} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-[13px] text-muted-foreground">
          Providers auto-inject context when enabled. Advanced: insert{' '}
          <code className="font-mono">{'{{project_memory}}'}</code> or{' '}
          <code className="font-mono">{'{{agents_md}}'}</code> into your template to control
          placement.
        </div>

        <div className="space-y-2">
          <div className="font-medium text-xs">Providers</div>
          <div className="flex flex-wrap gap-4">
            {PROVIDER_OPTIONS.map((provider) => (
              <label key={provider.id} className="flex max-w-xs items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={providers.includes(provider.id)}
                  onChange={(event) => {
                    const next = new Set(providers);
                    if (event.target.checked) {
                      next.add(provider.id);
                    } else {
                      next.delete(provider.id);
                    }
                    setProviders(Array.from(next));
                  }}
                />
                <span>
                  <span className="font-medium">{provider.label}</span>
                  <span className="block text-muted-foreground">{provider.desc}</span>
                  <span className="mt-1 block space-x-1">
                    {provider.tokens.map((token) => (
                      <Badge key={token} variant="secondary">
                        {token}
                      </Badge>
                    ))}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {providers.includes('agents_md') && (
            <div className="mt-2 grid gap-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Project Instructions Settings
              </div>
              <div className="flex items-center gap-3 text-xs">
                <label htmlFor={searchStrategyId} className="w-28">
                  Search strategy
                </label>
                <select
                  id={searchStrategyId}
                  className="h-9 flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  value={agentsMdSearchStrategy}
                  onChange={(event) => setAgentsMdSearchStrategy(event.target.value)}
                >
                  <option value="root-only">Root only</option>
                  <option value="hierarchical">Hierarchical</option>
                </select>
              </div>
              {agentsMdSearchStrategy === 'hierarchical' && (
                <div className="flex items-center gap-3 text-xs">
                  <label htmlFor={maxDepthId} className="w-28">
                    Max depth
                  </label>
                  <Input
                    id={maxDepthId}
                    type="number"
                    className="w-32"
                    placeholder="unlimited"
                    value={agentsMdMaxDepth ?? ''}
                    onChange={(event) =>
                      setAgentsMdMaxDepth(
                        event.target.value ? Number(event.target.value) : undefined
                      )
                    }
                  />
                  <span className="text-xs text-muted-foreground">
                    (0 = root only, empty = no limit)
                  </span>
                </div>
              )}
              <div className="flex items-center gap-3 text-xs">
                <label htmlFor={maxCharsId} className="w-28">
                  Max chars
                </label>
                <Input
                  id={maxCharsId}
                  type="number"
                  className="w-32"
                  value={agentsMdMaxChars}
                  onChange={(event) =>
                    setAgentsMdMaxChars(Math.max(0, Number(event.target.value || 0)))
                  }
                />
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-medium text-xs">Custom Variables</div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setVariables((current) => [...current, { key: '', value: '' }])}
            >
              Add
            </Button>
          </div>
          <div className="grid gap-2">
            {variables.map((kv, index) => (
              <div key={`var-${index}-${kv.key}`} className="flex gap-2">
                <Input
                  placeholder="key"
                  value={kv.key}
                  onChange={(event) => {
                    const next = [...variables];
                    const current = next[index];
                    if (current) {
                      next[index] = { ...current, key: event.target.value };
                      setVariables(next);
                    }
                  }}
                />
                <Input
                  placeholder="value"
                  value={kv.value}
                  onChange={(event) => {
                    const next = [...variables];
                    const current = next[index];
                    if (current) {
                      next[index] = { ...current, value: event.target.value };
                      setVariables(next);
                    }
                  }}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() =>
                    setVariables((current) => current.filter((_, idx) => idx !== index))
                  }
                >
                  ×
                </Button>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="space-y-1">
            <div className="text-xs text-red-600 dark:text-red-400">Error</div>
            <div className="rounded bg-red-50 p-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {error}
              <Button
                size="sm"
                variant="ghost"
                className="ml-2 h-auto p-1 text-xs"
                onClick={() => {
                  setError('');
                  refreshPreview().catch(() => {});
                }}
              >
                Retry
              </Button>
            </div>
          </div>
        )}

        {unresolved.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-amber-600 dark:text-amber-400">
              Unresolved placeholders
            </div>
            <div className="flex flex-wrap gap-1">
              {unresolved.map((token) => (
                <Badge key={token} variant="destructive">{`{{${token}}}`}</Badge>
              ))}
            </div>
          </div>
        )}

        {resolvedSources.length > 0 && (
          <div className="space-y-2">
            <div className="font-medium text-xs">Resolved Context Sources</div>
            <div className="grid gap-2">
              {resolvedSources.map((source) => (
                <div
                  key={`${source.providerId}-${source.token}-${source.sourcePath ?? 'none'}-${source.sectionKind ?? 'none'}`}
                  className="rounded-md border p-2 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{source.providerLabel}</Badge>
                    <Badge variant="secondary">{source.token}</Badge>
                    <span className="text-muted-foreground">{source.charsInjected} chars</span>
                  </div>
                  {source.sectionKind && (
                    <div className="mt-1 text-muted-foreground">Section: {source.sectionKind}</div>
                  )}
                  {source.sourcePath && (
                    <div className="mt-1 truncate font-mono text-muted-foreground">
                      {source.sourcePath}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-medium text-xs">Preview</div>
            <Button size="sm" variant="outline" onClick={refreshPreview} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
          <Textarea
            readOnly
            className="h-64 font-mono text-xs"
            value={error ? 'Preview unavailable due to error' : preview}
            placeholder={loading ? 'Generating preview...' : 'Preview will appear here'}
          />
        </div>
      </CardContent>
    </Card>
  );
}
