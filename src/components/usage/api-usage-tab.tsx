// src/components/usage/api-usage-tab.tsx

import { useEffect, useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLocale } from '@/hooks/use-locale';
import { getTokenValue } from '@/services/api-usage-service';
import { useApiUsageStore } from '@/stores/api-usage-store';
import type {
  ApiUsageDailyPoint,
  ApiUsageModelBreakdown,
  ApiUsageTokenView,
} from '@/types/api-usage';

const tokenViewOptions: Array<{
  value: ApiUsageTokenView;
  labelKey: 'total' | 'input' | 'output';
}> = [
  { value: 'total', labelKey: 'total' },
  { value: 'input', labelKey: 'input' },
  { value: 'output', labelKey: 'output' },
];

const rangeOptions = [
  { value: 'today', labelKey: 'today' },
  { value: 'week', labelKey: 'week' },
  { value: 'month', labelKey: 'month' },
] as const;

function formatCurrency(value: number) {
  return `$${value.toFixed(4)}`;
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${value}`;
}

function formatDateLabel(dateString: string): string {
  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) return dateString;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getTokenSeriesValue(point: ApiUsageDailyPoint, view: ApiUsageTokenView): number {
  return getTokenValue(view, {
    totalTokens: point.totalTokens,
    inputTokens: point.inputTokens,
    outputTokens: point.outputTokens,
  });
}

export function ApiUsageTab() {
  const { t } = useLocale();
  const range = useApiUsageStore((state) => state.range);
  const tokenView = useApiUsageStore((state) => state.tokenView);
  const data = useApiUsageStore((state) => state.data);
  const isLoading = useApiUsageStore((state) => state.isLoading);
  const error = useApiUsageStore((state) => state.error);
  const initialize = useApiUsageStore((state) => state.initialize);
  const setRange = useApiUsageStore((state) => state.setRange);
  const setTokenView = useApiUsageStore((state) => state.setTokenView);
  const setAutoRefresh = useApiUsageStore((state) => state.setAutoRefresh);

  useEffect(() => {
    initialize();
    setAutoRefresh(true);
    return () => {
      setAutoRefresh(false);
    };
  }, [initialize, setAutoRefresh]);

  const dailyData = useMemo(() => {
    return (data?.daily ?? []).map((point) => ({
      ...point,
      tokenValue: getTokenSeriesValue(point, tokenView),
      label: formatDateLabel(point.date),
    }));
  }, [data?.daily, tokenView]);

  const summary = data?.summary;

  const modelsData = useMemo(() => {
    if (data?.models) return data.models;
    const fallback = data as {
      modelBreakdown?: ApiUsageModelBreakdown[];
      model_breakdown?: ApiUsageModelBreakdown[];
    } | null;
    return fallback?.modelBreakdown ?? fallback?.model_breakdown ?? [];
  }, [data]);

  const modelRows = useMemo(() => {
    return modelsData.map((model) => ({
      ...model,
      tokenValue: getTokenValue(tokenView, {
        totalTokens: model.totalTokens,
        inputTokens: model.inputTokens,
        outputTokens: model.outputTokens,
      }),
    }));
  }, [modelsData, tokenView]);

  const tokenStats = useMemo(() => {
    if (dailyData.length === 0) return null;
    const total = dailyData.reduce((sum, point) => sum + point.tokenValue, 0);
    const average = total / dailyData.length;
    const peak = dailyData.reduce((max, point) =>
      point.tokenValue > max.tokenValue ? point : max
    );

    return {
      total,
      average,
      peakValue: peak.tokenValue,
      peakLabel: peak.label,
    };
  }, [dailyData]);

  const costDailyData = useMemo(() => {
    return (data?.daily ?? []).map((point) => ({
      ...point,
      value: point.totalCost,
      label: formatDateLabel(point.date),
    }));
  }, [data?.daily]);

  const requestDailyData = useMemo(() => {
    return (data?.daily ?? []).map((point) => ({
      ...point,
      value: point.requestCount,
      label: formatDateLabel(point.date),
    }));
  }, [data?.daily]);

  const costStats = useMemo(() => {
    if (costDailyData.length === 0) return null;
    const total = costDailyData.reduce((sum, point) => sum + point.value, 0);
    const average = total / costDailyData.length;
    const peak = costDailyData.reduce((max, point) => (point.value > max.value ? point : max));

    return {
      total,
      average,
      peakValue: peak.value,
      peakLabel: peak.label,
    };
  }, [costDailyData]);

  const requestStats = useMemo(() => {
    if (requestDailyData.length === 0) return null;
    const total = requestDailyData.reduce((sum, point) => sum + point.value, 0);
    const average = total / requestDailyData.length;
    const peak = requestDailyData.reduce((max, point) => (point.value > max.value ? point : max));

    return {
      total,
      average,
      peakValue: peak.value,
      peakLabel: peak.label,
    };
  }, [requestDailyData]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{t.apiUsage.title}</CardTitle>
            <CardDescription>{t.apiUsage.description}</CardDescription>
          </div>
          <Select value={range} onValueChange={(value) => setRange(value as typeof range)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder={t.apiUsage.rangeLabel} />
            </SelectTrigger>
            <SelectContent>
              {rangeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {t.apiUsage.ranges[option.labelKey]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="text-sm text-red-500">{error}</div>
          ) : !summary && isLoading ? (
            <div className="text-sm text-muted-foreground">{t.apiUsage.loading}</div>
          ) : !summary ? (
            <div className="text-sm text-muted-foreground">{t.apiUsage.noData}</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border bg-card p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t.apiUsage.metrics.cost}
                </p>
                <p className="mt-2 text-2xl font-semibold">{formatCurrency(summary.totalCost)}</p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t.apiUsage.metrics.totalTokens}
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {summary.totalTokens.toLocaleString()}
                </p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t.apiUsage.metrics.outputTokens}
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {summary.outputTokens.toLocaleString()}
                </p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t.apiUsage.metrics.requests}
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {summary.requestCount.toLocaleString()}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{t.apiUsage.tokens.title}</CardTitle>
            <CardDescription>{t.apiUsage.tokens.description}</CardDescription>
          </div>
          <Select
            value={tokenView}
            onValueChange={(value) => setTokenView(value as ApiUsageTokenView)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder={t.apiUsage.tokens.selectLabel} />
            </SelectTrigger>
            <SelectContent>
              {tokenViewOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {t.apiUsage.tokens.options[option.labelKey]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="space-y-4">
          {dailyData.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t.apiUsage.noData}</div>
          ) : (
            <>
              {tokenStats && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t.apiUsage.tokens.options[tokenView]}
                    </p>
                    <p className="mt-2 text-lg font-semibold">
                      {formatCompactNumber(tokenStats.total)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.apiUsage.tokens.summary.totalSuffix}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t.apiUsage.tokens.summary.average}
                    </p>
                    <p className="mt-2 text-lg font-semibold">
                      {formatCompactNumber(tokenStats.average)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.apiUsage.tokens.summary.perDay}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t.apiUsage.tokens.summary.peak}
                    </p>
                    <p className="mt-2 text-lg font-semibold">
                      {formatCompactNumber(tokenStats.peakValue)}
                    </p>
                    <p className="text-xs text-muted-foreground">{tokenStats.peakLabel}</p>
                  </div>
                </div>
              )}
              <ChartContainer
                className="h-[300px] rounded-lg border border-blue-200/60 bg-gradient-to-b from-blue-50/60 via-blue-50/10 to-transparent p-4 dark:border-blue-900/50 dark:from-blue-950/40 dark:via-blue-950/10"
                config={{
                  tokens: {
                    label: t.apiUsage.tokens.chartLabel,
                    color: 'hsl(210 90% 60%)',
                  },
                }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyData} margin={{ top: 10, right: 12, left: 16, bottom: 12 }}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      className="stroke-blue-200/70 dark:stroke-blue-900/50"
                    />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      className="text-blue-700/70 dark:text-blue-200/70"
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={56}
                      tickMargin={6}
                      tickFormatter={formatCompactNumber}
                      className="text-blue-700/70 dark:text-blue-200/70"
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(59, 130, 246, 0.12)' }}
                      content={
                        <ChartTooltip
                          labelFormatter={(label) => label}
                          valueFormatter={(value) => formatCompactNumber(Number(value))}
                        />
                      }
                    />
                    <Bar
                      dataKey="tokenValue"
                      name={t.apiUsage.tokens.chartLabel}
                      fill="var(--color-tokens)"
                      radius={[8, 8, 4, 4]}
                      maxBarSize={36}
                      className="drop-shadow-[0_8px_18px_rgba(37,99,235,0.35)]"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.apiUsage.cost.title}</CardTitle>
          <CardDescription>{t.apiUsage.cost.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {costDailyData.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t.apiUsage.noData}</div>
          ) : (
            <>
              {costStats && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t.apiUsage.cost.summary.total}
                    </p>
                    <p className="mt-2 text-lg font-semibold">{formatCurrency(costStats.total)}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.apiUsage.tokens.summary.totalSuffix}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t.apiUsage.tokens.summary.average}
                    </p>
                    <p className="mt-2 text-lg font-semibold">
                      {formatCurrency(costStats.average)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.apiUsage.tokens.summary.perDay}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t.apiUsage.tokens.summary.peak}
                    </p>
                    <p className="mt-2 text-lg font-semibold">
                      {formatCurrency(costStats.peakValue)}
                    </p>
                    <p className="text-xs text-muted-foreground">{costStats.peakLabel}</p>
                  </div>
                </div>
              )}
              <ChartContainer
                className="h-[300px] rounded-lg border border-blue-200/60 bg-gradient-to-b from-blue-50/60 via-blue-50/10 to-transparent p-4 dark:border-blue-900/50 dark:from-blue-950/40 dark:via-blue-950/10"
                config={{
                  cost: {
                    label: t.apiUsage.cost.chartLabel,
                    color: 'hsl(204 90% 58%)',
                  },
                }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={costDailyData}
                    margin={{ top: 10, right: 12, left: 20, bottom: 12 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      className="stroke-blue-200/70 dark:stroke-blue-900/50"
                    />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      className="text-blue-700/70 dark:text-blue-200/70"
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={72}
                      tickMargin={6}
                      tickFormatter={(value) => formatCurrency(Number(value))}
                      className="text-blue-700/70 dark:text-blue-200/70"
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(59, 130, 246, 0.12)' }}
                      content={
                        <ChartTooltip
                          labelFormatter={(label) => label}
                          valueFormatter={(value) => formatCurrency(Number(value))}
                        />
                      }
                    />
                    <Bar
                      dataKey="value"
                      name={t.apiUsage.cost.chartLabel}
                      fill="var(--color-cost)"
                      radius={[8, 8, 4, 4]}
                      maxBarSize={36}
                      className="drop-shadow-[0_8px_18px_rgba(14,165,233,0.35)]"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.apiUsage.requests.title}</CardTitle>
          <CardDescription>{t.apiUsage.requests.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {requestDailyData.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t.apiUsage.noData}</div>
          ) : (
            <>
              {requestStats && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t.apiUsage.requests.summary.total}
                    </p>
                    <p className="mt-2 text-lg font-semibold">
                      {formatCompactNumber(requestStats.total)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.apiUsage.tokens.summary.totalSuffix}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t.apiUsage.tokens.summary.average}
                    </p>
                    <p className="mt-2 text-lg font-semibold">
                      {formatCompactNumber(requestStats.average)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.apiUsage.tokens.summary.perDay}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t.apiUsage.tokens.summary.peak}
                    </p>
                    <p className="mt-2 text-lg font-semibold">
                      {formatCompactNumber(requestStats.peakValue)}
                    </p>
                    <p className="text-xs text-muted-foreground">{requestStats.peakLabel}</p>
                  </div>
                </div>
              )}
              <ChartContainer
                className="h-[300px] rounded-lg border border-blue-200/60 bg-gradient-to-b from-blue-50/60 via-blue-50/10 to-transparent p-4 dark:border-blue-900/50 dark:from-blue-950/40 dark:via-blue-950/10"
                config={{
                  requests: {
                    label: t.apiUsage.requests.chartLabel,
                    color: 'hsl(220 85% 65%)',
                  },
                }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={requestDailyData}
                    margin={{ top: 10, right: 12, left: 16, bottom: 12 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      className="stroke-blue-200/70 dark:stroke-blue-900/50"
                    />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      className="text-blue-700/70 dark:text-blue-200/70"
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={56}
                      tickMargin={6}
                      tickFormatter={(value) => formatCompactNumber(Number(value))}
                      className="text-blue-700/70 dark:text-blue-200/70"
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(59, 130, 246, 0.12)' }}
                      content={
                        <ChartTooltip
                          labelFormatter={(label) => label}
                          valueFormatter={(value) => formatCompactNumber(Number(value))}
                        />
                      }
                    />
                    <Bar
                      dataKey="value"
                      name={t.apiUsage.requests.chartLabel}
                      fill="var(--color-requests)"
                      radius={[8, 8, 4, 4]}
                      maxBarSize={36}
                      className="drop-shadow-[0_8px_18px_rgba(59,130,246,0.35)]"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.apiUsage.models.title}</CardTitle>
          <CardDescription>{t.apiUsage.models.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {modelRows.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t.apiUsage.noData}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.apiUsage.models.columns.model}</TableHead>
                  <TableHead className="text-right">{t.apiUsage.models.columns.min}</TableHead>
                  <TableHead className="text-right">{t.apiUsage.models.columns.max}</TableHead>
                  <TableHead className="text-right">{t.apiUsage.models.columns.avg}</TableHead>
                  <TableHead className="text-right">{t.apiUsage.models.columns.sum}</TableHead>
                  <TableHead className="text-right">{t.apiUsage.models.columns.requests}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modelRows.map((model) => {
                  const minTokens =
                    tokenView === 'input'
                      ? model.minInputTokens
                      : tokenView === 'output'
                        ? model.minOutputTokens
                        : model.minTotalTokens;
                  const maxTokens =
                    tokenView === 'input'
                      ? model.maxInputTokens
                      : tokenView === 'output'
                        ? model.maxOutputTokens
                        : model.maxTotalTokens;
                  const avgTokens =
                    tokenView === 'input'
                      ? model.avgInputTokens
                      : tokenView === 'output'
                        ? model.avgOutputTokens
                        : model.avgTotalTokens;
                  return (
                    <TableRow key={`${model.model}-${model.providerId ?? 'unknown'}`}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{model.model}</span>
                          {model.providerId && (
                            <span className="text-xs text-muted-foreground">
                              {model.providerId}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{formatCompactNumber(minTokens)}</TableCell>
                      <TableCell className="text-right">{formatCompactNumber(maxTokens)}</TableCell>
                      <TableCell className="text-right">{formatCompactNumber(avgTokens)}</TableCell>
                      <TableCell className="text-right">
                        {formatCompactNumber(model.tokenValue)}
                      </TableCell>
                      <TableCell className="text-right">
                        {model.requestCount.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {summary && (
            <div className="grid gap-4 text-sm text-muted-foreground sm:grid-cols-3">
              <div>
                <span className="font-medium text-foreground">
                  {t.apiUsage.models.summaryLabel}
                </span>{' '}
                {formatCurrency(summary.totalCost)}
              </div>
              <div>
                <span className="font-medium text-foreground">{t.apiUsage.metrics.requests}</span>{' '}
                {summary.requestCount.toLocaleString()}
              </div>
              <div>
                <span className="font-medium text-foreground">
                  {t.apiUsage.tokens.options[tokenView]}
                </span>{' '}
                {formatCompactNumber(getTokenValue(tokenView, summary))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
