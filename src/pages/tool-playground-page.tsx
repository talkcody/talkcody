import Editor, { type Monaco } from '@monaco-editor/react';
import { Download, History, Loader2, Plus, RotateCcw, Settings, Terminal } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import HistoryPanel from '@/components/tools/playground/history-panel';
import ParameterPanel from '@/components/tools/playground/parameter-panel';
import ResultPanel from '@/components/tools/playground/result-panel';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from '@/hooks/use-locale';
import { usePlaygroundStore } from '@/stores/playground-store';
import type { PlaygroundConfig } from '@/types/playground';

export default function ToolPlayground() {
  const t = useTranslation();
  const [_monaco, setMonaco] = useState<Monaco | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<'parameters' | 'result' | 'history'>('parameters');

  // Store state
  const {
    toolName,
    sourceCode,
    status,
    config,
    compileResult,
    isCompiling,
    isExecuting,
    executionResult,
    initializeFromTemplate,
    compileTool,
    executeTool,
    updateSourceCode,
    autoCompile,
    clearAutoCompile,
    clearExecutionResult,
    getTemplates,
    updateConfig,
    installTool,
  } = usePlaygroundStore();

  // Initialize session on mount
  useEffect(() => {
    try {
      // Default to Network Tool template
      initializeFromTemplate('network');
    } catch (error) {
      toast.error(t.playground.error.initFailed);
      console.error('Failed to initialize playground:', error);
    }

    // Cleanup: clear any pending auto-compile when component unmounts
    return () => {
      clearAutoCompile();
    };
  }, [initializeFromTemplate, t.playground.error.initFailed, clearAutoCompile]);

  // Auto-compile on source code change
  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (value !== undefined) {
        updateSourceCode(value);
        autoCompile(500); // Auto-compile after 500ms
      }
    },
    [updateSourceCode, autoCompile]
  );

  // Handle execute
  const handleExecute = async (params: Record<string, unknown>) => {
    try {
      const result = await executeTool(params);

      if (result.status === 'error') {
        toast.error(result.error || t.playground.error.executionFailed);
      } else {
        toast.success(t.playground.executionSuccess);
      }

      // Switch to result tab
      setActiveTab('result');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.playground.error.executionFailed);
    }
  };

  // Handle compile
  const handleCompile = async () => {
    try {
      const result = await compileTool();

      if (result.success) {
        toast.success(t.playground.compileSuccess);
      } else {
        toast.error(result.error || t.playground.error.compileFailed);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.playground.error.compileFailed);
    }
  };

  // Handle settings update
  const handleUpdateConfig = async (updates: Partial<PlaygroundConfig>) => {
    updateConfig(updates);
    toast.success(t.playground.configUpdated);
  };

  // Handle install
  const handleInstall = async () => {
    try {
      const success = await installTool();

      if (success) {
        toast.success(t.playground.installSuccess, {
          description: t.playground.installSuccessDescription,
        });
      } else {
        toast.error(t.playground.installFailed);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.playground.installFailed);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-background">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-primary" />
            <h1 className="font-semibold text-lg">Tool Playground</h1>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{toolName}</span>
            <Separator orientation="vertical" className="h-4" />
            <span className={status === 'error' ? 'text-destructive' : 'text-green-500'}>
              {status}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleCompile} disabled={isCompiling}>
            {isCompiling ? (
              <>
                <RotateCcw className="w-4 h-4 mr-2 animate-spin" />
                {t.playground.compiling}
              </>
            ) : (
              <>
                <RotateCcw className="w-4 h-4 mr-2" />
                {t.playground.compile}
              </>
            )}
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={handleInstall}
            disabled={!compileResult?.success || isCompiling}
          >
            <Download className="w-4 h-4 mr-2" />
            {t.playground.install}
          </Button>

          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="w-4 h-4 mr-2" />
                {t.playground.newTool}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t.playground.newTool}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  {t.playground.newToolDescription}
                </div>
                <div className="grid gap-2">
                  {getTemplates().map((template) => (
                    <Button
                      key={template.id}
                      variant="outline"
                      className="justify-start"
                      onClick={() => initializeFromTemplate(template.id)}
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      {template.name}
                    </Button>
                  ))}
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={showSettings} onOpenChange={setShowSettings}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm">
                <Settings className="w-4 h-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t.playground.settings}</DialogTitle>
              </DialogHeader>
              <PlaygroundSettings
                config={config}
                onUpdate={handleUpdateConfig}
                onClose={() => setShowSettings(false)}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Code Editor */}
        <div className="w-1/2 flex flex-col border-r">
          <div className="flex items-center justify-between px-4 py-2 bg-muted/50">
            <span className="text-sm font-medium">{t.playground.codeEditor}</span>
            {compileResult && (
              <span
                className={`text-xs px-2 py-1 rounded ${
                  compileResult.success
                    ? 'bg-green-500/10 text-green-500'
                    : 'bg-red-500/10 text-red-500'
                }`}
              >
                {compileResult.success
                  ? `${t.playground.compileSuccess} (${compileResult.duration}ms)`
                  : `${t.playground.error.compileFailed} (${compileResult.duration}ms)`}
              </span>
            )}
          </div>
          <div className="flex-1">
            <Editor
              height="100%"
              defaultLanguage="typescript"
              theme="vs-dark"
              value={sourceCode}
              onChange={handleEditorChange}
              onMount={(_editor, monacoInstance) => {
                setMonaco(monacoInstance);

                monacoInstance.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
                  noSemanticValidation: true,
                  noSyntaxValidation: true,
                  noSuggestionDiagnostics: true,
                });

                monacoInstance.languages.typescript.typescriptDefaults.setCompilerOptions({
                  noEmit: true,
                  strict: false,
                  noStrictGenericChecks: true,
                  noImplicitAny: false,
                  noImplicitReturns: false,
                  noImplicitThis: false,
                  noUnusedLocals: false,
                  noUnusedParameters: false,
                  allowUnreachableCode: true,
                  allowUnusedLabels: true,
                });
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                wordWrap: 'on',
              }}
            />
          </div>
        </div>

        {/* Right: Test Panel */}
        <div className="w-1/2 flex flex-col">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as 'parameters' | 'result' | 'history')}
            className="flex-1 flex flex-col"
          >
            <div className="border-b px-4">
              <TabsList className="w-full justify-start bg-transparent h-12">
                <TabsTrigger value="parameters" className="data-[state=active]:bg-background">
                  {t.playground.parameters}
                </TabsTrigger>
                <TabsTrigger value="result" className="data-[state=active]:bg-background">
                  {t.playground.result}
                </TabsTrigger>
                <TabsTrigger value="history" className="data-[state=active]:bg-background">
                  <History className="w-4 h-4 mr-1" />
                  {t.playground.history}
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="parameters" className="flex-1 overflow-auto p-4 m-0">
              {compileResult?.tool ? (
                <ParameterPanel
                  tool={compileResult.tool}
                  onExecute={handleExecute}
                  isExecuting={isExecuting}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="text-center">
                    <RotateCcw className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>{t.playground.compileFirst}</p>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="result" className="flex-1 overflow-auto p-4 m-0">
              {executionResult ? (
                <ResultPanel
                  result={executionResult}
                  tool={compileResult?.tool}
                  onClear={clearExecutionResult}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="text-center">
                    <Terminal className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>{t.playground.noExecutionResult}</p>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="history" className="flex-1 overflow-auto p-4 m-0">
              <HistoryPanel />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function PlaygroundSettings({
  config,
  onUpdate,
  onClose,
}: {
  config: PlaygroundConfig;
  onUpdate: (updates: Partial<PlaygroundConfig>) => void;
  onClose: () => void;
}) {
  const timeoutId = useId();
  const mockingId = useId();
  const [timeout, setTimeout] = useState(config?.timeout || 300000);
  const [enableMocking, setEnableMocking] = useState(config?.enableMocking || false);

  const handleSave = () => {
    onUpdate({ timeout, enableMocking });
    onClose();
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={timeoutId}>{timeout / 1000}s</Label>
        <Input
          id={timeoutId}
          type="number"
          value={timeout}
          onChange={(e) => setTimeout(Number(e.target.value))}
          min={1000}
          max={120000}
          step={1000}
        />
        <p className="text-xs text-muted-foreground">Maximum execution time in milliseconds</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={mockingId}>Enable Mock Mode</Label>
        <div className="flex items-center space-x-2">
          <Switch id={mockingId} checked={enableMocking} onCheckedChange={setEnableMocking} />
          <span className="text-sm text-muted-foreground">Use mock data for network requests</span>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave}>Save</Button>
      </div>
    </div>
  );
}
