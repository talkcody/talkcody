// src/components/usage/kimi-usage-tab.tsx
// Kimi usage tab component

import { AlertCircle, CheckCircle2, Clock, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useLocale } from '@/hooks/use-locale';
import {
  getRemainingPercentage,
  getTimeUntilReset,
  getUsageLevel,
  testKimiToken,
} from '@/services/kimi-usage-service';
import { useKimiUsageStore } from '@/stores/kimi-usage-store';
import { settingsManager } from '@/stores/settings-store';

// Helper to get color classes based on usage level
function getLevelColor(level: string): string {
  switch (level) {
    case 'low':
      return 'text-green-600 dark:text-green-400';
    case 'medium':
      return 'text-yellow-600 dark:text-yellow-400';
    case 'high':
      return 'text-orange-600 dark:text-orange-400';
    case 'critical':
      return 'text-red-600 dark:text-red-400';
    default:
      return 'text-muted-foreground';
  }
}

export function KimiUsageTab() {
  const { t } = useLocale();
  const tokenUpdateTextareaId = useId();

  // Usage state
  const usageData = useKimiUsageStore((state) => state.usageData);
  const isLoading = useKimiUsageStore((state) => state.isLoading);
  const error = useKimiUsageStore((state) => state.error);
  const initialize = useKimiUsageStore((state) => state.initialize);
  const refresh = useKimiUsageStore((state) => state.refresh);
  const reset = useKimiUsageStore((state) => state.reset);

  // Token configuration state
  const [tokenInput, setTokenInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  // Initialize on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Handle save token
  const handleSaveToken = async () => {
    if (!tokenInput.trim()) {
      toast.error('Please paste the cURL command or token');
      return;
    }

    setIsSaving(true);
    try {
      // Test the token first
      await testKimiToken(tokenInput);

      // Save to settings
      await settingsManager.setKimiCookie(tokenInput);

      // Clear input and reset store state before refresh
      setTokenInput('');
      reset();

      toast.success('Token saved successfully!');

      // Refresh usage data
      await refresh();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save token';
      toast.error(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle test connection
  const handleTestToken = async () => {
    if (!tokenInput.trim()) {
      toast.error('Please paste the cURL command or token');
      return;
    }

    setIsTesting(true);
    try {
      await testKimiToken(tokenInput);
      toast.success('Connection test successful!');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Connection test failed';
      toast.error(errorMessage);
    } finally {
      setIsTesting(false);
    }
  };

  // Handle refresh
  const handleRefresh = async () => {
    await refresh();
  };

  // Missing/expired token state (initial not configured or expired/missing from API)
  const isTokenMissing =
    error?.includes('token not configured') ||
    error?.includes('SESSION_EXPIRED') ||
    error?.toLowerCase().includes('unauthorized');

  if (isTokenMissing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.kimiUsage.title}</CardTitle>
          <CardDescription>{t.kimiUsage.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Error / info */}
          {error?.includes('SESSION_EXPIRED') || error?.toLowerCase().includes('unauthorized') ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t.kimiUsage.sessionExpired}</AlertTitle>
              <AlertDescription>{t.kimiUsage.sessionExpiredDescription}</AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Configuration Required</AlertTitle>
              <AlertDescription>
                Follow the steps below to configure your Kimi token.
              </AlertDescription>
            </Alert>
          )}

          {/* Step-by-step Guide */}
          <div className="space-y-4">
            <h3 className="font-semibold">
              {error ? 'Update your token:' : 'How to get your token:'}
            </h3>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>
                Open{' '}
                <a
                  href="https://www.kimi.com/code/console"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline"
                >
                  Kimi Code Console
                </a>
              </li>
              <li>Open DevTools (F12) → Network tab</li>
              <li>Refresh the page</li>
              <li>
                Find the <code className="bg-muted px-1 rounded">GetUsages</code> request
              </li>
              <li>Right-click → Copy as cURL</li>
              <li>Paste below</li>
            </ol>
          </div>

          {/* Input Area */}
          <div className="space-y-2">
            <Label htmlFor={tokenUpdateTextareaId}>Paste cURL Command or Token</Label>
            <textarea
              id={tokenUpdateTextareaId}
              className="w-full min-h-[120px] p-3 text-sm border rounded-md font-mono"
              placeholder="curl 'https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages' -H 'authorization: Bearer ...'"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              💡 Tip: You can paste the entire cURL command or just the Bearer token.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button
              onClick={handleTestToken}
              disabled={isTesting || !tokenInput.trim()}
              variant="outline"
            >
              {isTesting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : (
                'Test Connection'
              )}
            </Button>
            <Button onClick={handleSaveToken} disabled={isSaving || !tokenInput.trim()}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : error ? (
                'Update & Reconnect'
              ) : (
                'Save & Connect'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.kimiUsage.title}</CardTitle>
          <CardDescription>{t.kimiUsage.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t.kimiUsage.error}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button onClick={handleRefresh} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t.kimiUsage.refreshing}
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t.kimiUsage.retry}
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Loading state
  if (isLoading && !usageData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.kimiUsage.title}</CardTitle>
          <CardDescription>{t.kimiUsage.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // No data state
  if (!usageData || !usageData.weekly) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.kimiUsage.title}</CardTitle>
          <CardDescription>{t.kimiUsage.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t.kimiUsage.noData}</AlertTitle>
            <AlertDescription>{t.kimiUsage.noDataDescription}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Get usage levels
  const weeklyUsageLevel = getUsageLevel(usageData.weekly.utilization_pct);
  const fiveHourUsageLevel = getUsageLevel(usageData.five_hour.utilization_pct);
  const weeklyRemainingPercentage = getRemainingPercentage(usageData.weekly.utilization_pct);
  const fiveHourRemainingPercentage = getRemainingPercentage(usageData.five_hour.utilization_pct);

  // Format last validated time
  const lastValidated = usageData.last_validated_at
    ? new Date(usageData.last_validated_at).toLocaleString()
    : 'Unknown';

  return (
    <div className="space-y-6">
      {/* Refresh Button */}
      <div className="flex justify-end">
        <Button onClick={handleRefresh} disabled={isLoading} variant="outline" size="sm">
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t.kimiUsage.refreshing}
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t.kimiUsage.refresh}
            </>
          )}
        </Button>
      </div>

      {/* Session Info */}
      <Alert>
        <CheckCircle2 className="h-4 w-4" />
        <AlertDescription>
          {t.kimiUsage.lastValidated}: {lastValidated}
        </AlertDescription>
      </Alert>

      {/* Weekly Usage */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t.kimiUsage.weekly.title}</CardTitle>
              <CardDescription>{t.kimiUsage.weekly.description}</CardDescription>
            </div>
            {usageData.weekly.reset_at && (
              <Badge variant="outline" className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {t.kimiUsage.resetsIn}: {getTimeUntilReset(usageData.weekly.reset_at)}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {t.kimiUsage.used}: {usageData.weekly.utilization_pct.toFixed(1)}%
              </span>
              <span className={`text-sm font-medium ${getLevelColor(weeklyUsageLevel)}`}>
                {t.kimiUsage.remaining}: {weeklyRemainingPercentage.toFixed(1)}%
              </span>
            </div>
            <Progress value={usageData.weekly.utilization_pct} className="h-2" />
          </div>

          <div className="grid grid-cols-2 gap-4 border-t pt-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {t.kimiUsage.used}
              </p>
              <p className="text-lg font-bold">
                <span className="text-orange-500">{Math.round(usageData.weekly.used ?? 0)}</span>
                <span className="text-muted-foreground ml-2 text-sm">
                  ({usageData.weekly.utilization_pct.toFixed(1)}%)
                </span>
              </p>
            </div>
            <div className="space-y-1 text-right">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {t.kimiUsage.remaining}
              </p>
              <p className="text-lg font-bold">
                <span className="text-green-500">
                  {Math.round(usageData.weekly.remaining ?? 0)}
                </span>
                <span className="text-muted-foreground ml-2 text-sm">
                  ({weeklyRemainingPercentage.toFixed(1)}%)
                </span>
              </p>
            </div>
          </div>

          {weeklyUsageLevel === 'critical' && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{t.kimiUsage.criticalWarning}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* 5-Hour Usage */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t.kimiUsage.fiveHour.title}</CardTitle>
              <CardDescription>{t.kimiUsage.fiveHour.description}</CardDescription>
            </div>
            {usageData.five_hour.reset_at && (
              <Badge variant="outline" className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {t.kimiUsage.resetsIn}: {getTimeUntilReset(usageData.five_hour.reset_at)}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {t.kimiUsage.used}: {usageData.five_hour.utilization_pct.toFixed(1)}%
              </span>
              <span className={`text-sm font-medium ${getLevelColor(fiveHourUsageLevel)}`}>
                {t.kimiUsage.remaining}: {fiveHourRemainingPercentage.toFixed(1)}%
              </span>
            </div>
            <Progress value={usageData.five_hour.utilization_pct} className="h-2" />
          </div>

          <div className="grid grid-cols-2 gap-4 border-t pt-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {t.kimiUsage.used}
              </p>
              <p className="text-lg font-bold">
                <span className="text-orange-500">{Math.round(usageData.five_hour.used ?? 0)}</span>
                <span className="text-muted-foreground ml-2 text-sm">
                  ({usageData.five_hour.utilization_pct.toFixed(1)}%)
                </span>
              </p>
            </div>
            <div className="space-y-1 text-right">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {t.kimiUsage.remaining}
              </p>
              <p className="text-lg font-bold">
                <span className="text-green-500">
                  {Math.round(usageData.five_hour.remaining ?? 0)}
                </span>
                <span className="text-muted-foreground ml-2 text-sm">
                  ({fiveHourRemainingPercentage.toFixed(1)}%)
                </span>
              </p>
            </div>
          </div>

          {fiveHourUsageLevel === 'critical' && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{t.kimiUsage.criticalWarning}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
