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

export function DynamicContextPanel({ agent, onChange }: DynamicContextPanelProps) {
  // Generate unique IDs for form elements
  const searchStrategyId = useId();
  const maxDepthId = useId();
  const maxCharsId = useId();

  const [dynamicContextEnabled, setDynamicContextEnabled] = useState(
    agent.dynamicPrompt?.enabled ?? false
  );
  const [providers, setProviders] = useState<string[]>(agent.dynamicPrompt?.providers || []);
  const [variables, setVariables] = useState<KV[]>(
    Object.entries(agent.dynamicPrompt?.variables || {}).map(([k, v]) => ({
      key: k,
      value: v,
    }))
  );
  const [agentsMdMaxChars, setAgentsMdMaxChars] = useState<number>(
    (agent.dynamicPrompt?.providerSettings?.agents_md as { maxChars?: number })?.maxChars ?? 8000
  );
  const [agentsMdSearchStrategy, setAgentsMdSearchStrategy] = useState<string>(
    (agent.dynamicPrompt?.providerSettings?.agents_md as { searchStrategy?: string })
      ?.searchStrategy ?? 'root-only'
  );
  const [agentsMdMaxDepth, setAgentsMdMaxDepth] = useState<number | undefined>(
    (agent.dynamicPrompt?.providerSettings?.agents_md as { maxDepth?: number })?.maxDepth
  );
  const [preview, setPreview] = useState<string>('');
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

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

    // Create an abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    try {
      const root = await getValidatedWorkspaceRoot();

      // Check if operation was aborted
      if (controller.signal.aborted) {
        throw new Error('Preview generation timed out');
      }

      const { finalSystemPrompt, unresolvedPlaceholders } = await previewSystemPrompt({
        agent: currentAgent,
        workspaceRoot: root,
      });

      // Check if operation was aborted before setting state
      if (controller.signal.aborted) {
        return;
      }

      setPreview(finalSystemPrompt);
      setUnresolved(unresolvedPlaceholders);
      setError('');
    } catch (err) {
      logger.error('Error refreshing preview:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(`Failed to generate preview: ${errorMessage}`);
      setPreview('');
      setUnresolved([]);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }, [currentAgent]);

  useEffect(() => {
    // Add a small delay to avoid rapid successive calls during editing
    const timeoutId = setTimeout(() => {
      refreshPreview().catch((err) => {
        logger.error('useEffect refreshPreview failed:', err);
      });
    }, 300);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshPreview]);

  // Propagate changes upward when local state changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: onChange is stable via parent's useCallback
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
  ]);

  return (
    <Card className="border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Dynamic Context</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">Enable</span>
            <Switch checked={dynamicContextEnabled} onCheckedChange={setDynamicContextEnabled} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-[13px] text-muted-foreground">
          Providers auto-inject project context when enabled. Advanced: insert{' '}
          <code className="font-mono">{'{{working_directory}}'}</code> or{' '}
          <code className="font-mono">{'{{agents_md}}'}</code> into your template to control
          placement.
        </div>
        <div className="space-y-2">
          <div className="font-medium text-xs">Providers</div>
          <div className="flex flex-wrap gap-4">
            {[
              {
                id: 'env',
                label: 'Environment',
                desc: 'Injects environment info (directory, git, platform, date)',
                tokens: ['working_directory', 'is_git_repo', 'platform', 'today_date'],
              },
              {
                id: 'agents_md',
                label: 'AGENTS.md',
                desc: 'Injects AGENTS.md content from workspace',
                tokens: ['agents_md'],
              },
              {
                id: 'output_format',
                label: 'Output Format',
                desc: 'Injects output format instructions from chat selection',
                tokens: ['output_format_instruction'],
              },
            ].map((p) => (
              <label key={p.id} className="flex max-w-xs items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={providers.includes(p.id)}
                  onChange={(e) => {
                    const next = new Set(providers);
                    if (e.target.checked) next.add(p.id);
                    else next.delete(p.id);
                    setProviders(Array.from(next));
                  }}
                />
                <span>
                  <span className="font-medium">{p.label}</span>
                  <span className="block text-muted-foreground">{p.desc}</span>
                  <span className="mt-1 block space-x-1">
                    {p.tokens.map((t) => (
                      <Badge key={t} variant="secondary">
                        {t}
                      </Badge>
                    ))}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {/* Provider settings for AGENTS.md (direct file read with optional truncation) */}
          {providers.includes('agents_md') && (
            <div className="mt-2 grid gap-2">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
                AGENTS.md Settings
              </div>
              <div className="flex items-center gap-3 text-xs">
                <label htmlFor={searchStrategyId} className="w-28">
                  Search strategy
                </label>
                <select
                  id={searchStrategyId}
                  className="flex-1 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  value={agentsMdSearchStrategy}
                  onChange={(e) => setAgentsMdSearchStrategy(e.target.value)}
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
                    onChange={(e) =>
                      setAgentsMdMaxDepth(e.target.value ? Number(e.target.value) : undefined)
                    }
                  />
                  <span className="text-muted-foreground text-xs">
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
                  onChange={(e) => setAgentsMdMaxChars(Math.max(0, Number(e.target.value || 0)))}
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
              onClick={() => setVariables((v) => [...v, { key: '', value: '' }])}
            >
              Add
            </Button>
          </div>
          <div className="grid gap-2">
            {variables.map((kv, idx) => (
              <div key={`var-${idx}-${kv.key}`} className="flex gap-2">
                <Input
                  placeholder="key"
                  value={kv.key}
                  onChange={(e) => {
                    const v = [...variables];
                    const current = v[idx];
                    if (current) {
                      v[idx] = { ...current, key: e.target.value };
                      setVariables(v);
                    }
                  }}
                />
                <Input
                  placeholder="value"
                  value={kv.value}
                  onChange={(e) => {
                    const v = [...variables];
                    const current = v[idx];
                    if (current) {
                      v[idx] = { ...current, value: e.target.value };
                      setVariables(v);
                    }
                  }}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setVariables((v) => v.filter((_, i) => i !== idx))}
                >
                  ×
                </Button>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="space-y-1">
            <div className="text-red-600 text-xs dark:text-red-400">Error</div>
            <div className="text-red-600 text-xs dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">
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
            <div className="text-amber-600 text-xs dark:text-amber-400">
              Unresolved placeholders
            </div>
            <div className="flex flex-wrap gap-1">
              {unresolved.map((t) => (
                <Badge key={t} variant="destructive">{`{{${t}}}`}</Badge>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-medium text-xs">Preview</div>
            <Button size="sm" variant="outline" onClick={refreshPreview} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
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
