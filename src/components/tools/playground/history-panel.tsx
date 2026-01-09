import { CheckCircle, Clock, Copy, Play, Trash2, XCircle } from 'lucide-react';
import React, { useMemo } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useTranslation } from '@/hooks/use-locale';
import { usePlaygroundStore } from '@/stores/playground-store';

export default function HistoryPanel() {
  const t = useTranslation();
  const [searchQuery, setSearchQuery] = React.useState('');

  const { executionHistory, executeTool, clearExecutionHistory } = usePlaygroundStore();

  // Filter history by search query
  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) {
      return executionHistory;
    }

    const query = searchQuery.toLowerCase();
    return executionHistory.filter((record) => {
      // Search in params
      const paramsStr = JSON.stringify(record.params).toLowerCase();
      return paramsStr.includes(query);
    });
  }, [executionHistory, searchQuery]);

  const handleReplay = async (record: (typeof executionHistory)[0]) => {
    try {
      await executeTool(record.params, record.grantedPermissions);
      toast.success(t.playground.executionReplayed);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.playground.error.replayFailed);
    }
  };

  const handleCopyParams = (params: Record<string, unknown>) => {
    const text = JSON.stringify(params, null, 2);
    navigator.clipboard.writeText(text);
    toast.success(t.playground.paramsCopied);
  };

  const handleDeleteHistory = () => {
    if (confirm(t.playground.confirmClearHistory)) {
      clearExecutionHistory();
      toast.success(t.playground.historyCleared);
    }
  };

  if (filteredHistory.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-4">
        <Clock className="w-12 h-12 opacity-50" />
        <div className="text-center">
          <div className="font-medium">{t.playground.noHistory}</div>
          <div className="text-sm mt-1">
            {searchQuery ? t.playground.noMatchingHistory : t.playground.executeToCreateHistory}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{t.playground.executionHistory}</h3>
          <Button variant="ghost" size="sm" onClick={handleDeleteHistory}>
            <Trash2 className="w-4 h-4 mr-1" />
            {t.playground.clearHistory}
          </Button>
        </div>

        <Input
          placeholder={t.playground.searchHistory}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* History List */}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {filteredHistory.map((record) => (
          <Card key={record.id} className="p-4 hover:bg-muted/50 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                {/* Status & Time */}
                <div className="flex items-center gap-2 mb-2">
                  {record.result.status === 'success' ? (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-500" />
                  )}
                  <span className="text-sm text-muted-foreground">
                    {new Date(record.timestamp).toLocaleString()}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {record.result.duration}ms
                  </Badge>
                </div>

                {/* Parameters */}
                <div className="space-y-2">
                  <div className="text-sm font-medium">{t.playground.parameters}:</div>
                  <div className="bg-muted/50 rounded p-2 max-h-32 overflow-auto">
                    <pre className="text-xs whitespace-pre-wrap">
                      {JSON.stringify(record.params, null, 2)}
                    </pre>
                  </div>
                </div>

                {/* Error */}
                {record.result.error && (
                  <div className="mt-2">
                    <div className="text-sm font-medium text-red-500">{t.Common.error}:</div>
                    <div className="bg-red-500/10 border border-red-500/20 rounded p-2 mt-1">
                      <pre className="text-xs text-red-500 whitespace-pre-wrap overflow-auto">
                        {record.result.error}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Permissions */}
                {record.grantedPermissions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {record.grantedPermissions.map((permission) => (
                      <Badge key={permission} variant="secondary" className="text-xs">
                        {permission}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2">
                <Button variant="outline" size="sm" onClick={() => handleReplay(record)}>
                  <Play className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleCopyParams(record.params)}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Logs */}
            {record.result.logs.length > 0 && (
              <>
                <Separator className="my-3" />
                <div className="space-y-1">
                  <div className="text-sm font-medium">
                    {t.playground.logs} ({record.result.logs.length}):
                  </div>
                  <div className="max-h-24 overflow-auto space-y-1">
                    {record.result.logs.slice(-5).map((log) => (
                      <div key={log.id} className="text-xs flex gap-2">
                        <span className="text-muted-foreground font-mono">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                        <span
                          className={`font-semibold ${
                            log.level === 'error'
                              ? 'text-red-500'
                              : log.level === 'warn'
                                ? 'text-yellow-500'
                                : 'text-blue-500'
                          }`}
                        >
                          {log.level.toUpperCase()}
                        </span>
                        <span className="text-muted-foreground truncate">{log.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
