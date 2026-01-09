import { CheckCircle, Clock, Copy, Download, Trash2, XCircle } from 'lucide-react';
import React, { isValidElement } from 'react';
import { toast } from 'sonner';
import { ToolErrorBoundary } from '@/components/tools/tool-error-boundary';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from '@/hooks/use-locale';
import { logger } from '@/lib/logger';
import type { CustomToolDefinition } from '@/types/custom-tool';
import type { ExecutionResult } from '@/types/playground';

interface ResultPanelProps {
  result: ExecutionResult;
  tool?: CustomToolDefinition;
  onClear: () => void;
}

export default function ResultPanel({ result, tool, onClear }: ResultPanelProps) {
  const t = useTranslation();

  const handleCopyOutput = () => {
    const text = JSON.stringify(result.output, null, 2);
    navigator.clipboard.writeText(text);
    toast.success(t.playground.outputCopied);
  };

  const handleDownloadOutput = () => {
    const text = JSON.stringify(result.output, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tool-output-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t.playground.outputDownloaded);
  };

  const renderLogItem = (log: ExecutionResult['logs'][0], index: number) => {
    const levelColors = {
      info: 'text-blue-500',
      warn: 'text-yellow-500',
      error: 'text-red-500',
      debug: 'text-gray-500',
    };

    return (
      <div key={index} className="flex gap-2 text-sm">
        <span className="text-muted-foreground font-mono text-xs">
          {new Date(log.timestamp).toLocaleTimeString()}
        </span>
        <span className={`font-semibold ${levelColors[log.level]}`}>{log.level.toUpperCase()}</span>
        <span className="flex-1">{log.message}</span>
      </div>
    );
  };

  const safeStringify = (value: unknown) => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  const renderInvalidResult = (value: unknown) => (
    <div className="space-y-2">
      <div className="text-sm text-destructive">{t.playground.renderInvalidResult}</div>
      <pre className="text-xs whitespace-pre-wrap text-muted-foreground">
        {safeStringify(value)}
      </pre>
    </div>
  );

  const normalizeRenderedOutput = (value: unknown): React.ReactNode => {
    if (
      value === null ||
      value === undefined ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      isValidElement(value)
    ) {
      return value as React.ReactNode;
    }

    if (Array.isArray(value)) {
      return value.map((item, index) => {
        // Use a combination of index and item type as key
        const itemType = typeof item;
        const itemKey =
          item === null ? 'null' : item === undefined ? 'undefined' : `${index}-${itemType}`;
        return <React.Fragment key={itemKey}>{normalizeRenderedOutput(item)}</React.Fragment>;
      });
    }

    return renderInvalidResult(value);
  };

  const renderToolResultContent = (): React.ReactNode => {
    if (!tool?.renderToolResult) {
      return (
        <div className="text-center text-muted-foreground py-8">
          <div className="text-sm">{t.playground.noRenderer}</div>
        </div>
      );
    }

    try {
      const rendered = tool.renderToolResult(result.output, {}, { toolName: tool.name });
      return normalizeRenderedOutput(rendered);
    } catch (error) {
      logger.error('[Playground] renderToolResult failed', error);
      return (
        <div className="space-y-2">
          <div className="text-sm text-destructive">{t.playground.renderFailed}</div>
          {error instanceof Error && (
            <pre className="text-xs whitespace-pre-wrap text-muted-foreground">{error.message}</pre>
          )}
        </div>
      );
    }
  };

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Status Header */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {result.status === 'success' ? (
              <CheckCircle className="w-5 h-5 text-green-500" />
            ) : (
              <XCircle className="w-5 h-5 text-red-500" />
            )}
            <div>
              <div className="font-semibold">
                {result.status === 'success'
                  ? t.playground.executionSuccess
                  : t.playground.executionFailed}
              </div>
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Clock className="w-3 h-3" />
                <span>{result.duration}ms</span>
                {result.logs.length > 0 && (
                  <>
                    <span>•</span>
                    <span>
                      {result.logs.length} {t.playground.logs}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {result.status === 'success' && result.output != null && (
              <>
                <Button variant="ghost" size="sm" onClick={handleCopyOutput}>
                  <Copy className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={handleDownloadOutput}>
                  <Download className="w-4 h-4" />
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={onClear}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {result.error && (
          <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-md">
            <pre className="text-sm text-red-500 whitespace-pre-wrap overflow-auto max-h-32">
              {result.error}
            </pre>
          </div>
        )}
      </Card>

      {/* Content Tabs */}
      <div className="flex-1 overflow-auto">
        <Tabs
          defaultValue={result.status === 'success' ? 'output' : 'error'}
          className="h-full flex flex-col"
        >
          <TabsList className="w-full justify-start bg-transparent">
            {result.status === 'success' && (
              <TabsTrigger value="output">{t.playground.output}</TabsTrigger>
            )}
            {result.status === 'error' && <TabsTrigger value="error">{t.Common.error}</TabsTrigger>}
            <TabsTrigger value="logs">
              {t.playground.logs} ({result.logs.length})
            </TabsTrigger>
            {tool && result.status === 'success' && (
              <TabsTrigger value="render">{t.playground.rendered}</TabsTrigger>
            )}
          </TabsList>

          {result.status === 'success' && (
            <TabsContent value="output" className="flex-1 overflow-auto m-0">
              <Card className="p-4 h-full overflow-auto">
                <pre className="text-sm whitespace-pre-wrap overflow-auto">
                  {JSON.stringify(result.output as unknown, null, 2)}
                </pre>
              </Card>
            </TabsContent>
          )}

          {result.status === 'error' && result.error && (
            <TabsContent value="error" className="flex-1 overflow-auto m-0">
              <Card className="p-4 h-full overflow-auto">
                <pre className="text-sm text-red-500 whitespace-pre-wrap overflow-auto">
                  {result.error}
                </pre>
              </Card>
            </TabsContent>
          )}

          <TabsContent value="logs" className="flex-1 overflow-auto m-0">
            <Card className="p-4 h-full overflow-auto">
              {result.logs.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  <div className="text-sm">{t.playground.noLogs}</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {result.logs.map((log, index) => renderLogItem(log, index))}
                </div>
              )}
            </Card>
          </TabsContent>

          {tool && result.status === 'success' && (
            <TabsContent value="render" className="flex-1 overflow-auto m-0">
              <Card className="p-4 h-full overflow-auto">
                <ToolErrorBoundary
                  toolName={tool.name}
                  fallback={
                    <div className="text-sm text-destructive">{t.playground.renderFailed}</div>
                  }
                >
                  <div className="prose dark:prose-invert max-w-none">
                    {normalizeRenderedOutput(renderToolResultContent())}
                  </div>
                </ToolErrorBoundary>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}
