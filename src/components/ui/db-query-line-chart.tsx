import * as React from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { useLocale } from '@/hooks/use-locale';

export interface DbQueryLineDatum {
  timestamp: string | number;
  value: number;
}

export interface DbQueryLineChartProps {
  title?: string;
  data: DbQueryLineDatum[];
  xAxisLabel?: string;
  yAxisLabel?: string;
  valueLabel?: string;
  valueFormatter?: (value: number) => string;
  timeFormatter?: (timestamp: string | number) => string;
  className?: string;
  height?: number;
  emptyMessage?: string;
  curveType?: 'linear' | 'monotone' | 'step';
  strokeColor?: string;
}

function formatValue(value: number, formatter?: (value: number) => string) {
  return formatter ? formatter(value) : new Intl.NumberFormat().format(value);
}

export function DbQueryLineChart({
  title,
  data,
  xAxisLabel,
  yAxisLabel,
  valueLabel,
  valueFormatter,
  timeFormatter,
  className,
  height = 320,
  emptyMessage,
  curveType = 'monotone',
  strokeColor,
}: DbQueryLineChartProps) {
  const { t } = useLocale();
  const resolvedTitle = title ?? t.DbQuery.grid.tabs.chart;
  const resolvedEmpty = emptyMessage ?? t.DbQuery.chart.noData;
  const resolvedValueLabel = valueLabel ?? t.DbQuery.chart.valueLabel;

  const chartConfig = React.useMemo(
    () => ({
      value: {
        label: resolvedValueLabel,
        color: strokeColor ?? 'hsl(204 88% 57%)',
      },
    }),
    [resolvedValueLabel, strokeColor]
  );

  const labelFormatter = (value: string | number) =>
    timeFormatter ? timeFormatter(value) : String(value);

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">{resolvedTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="text-sm text-muted-foreground">{resolvedEmpty}</div>
        ) : (
          <ChartContainer className="p-4" config={chartConfig}>
            <div style={{ height }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 8, right: 16, left: 16, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="timestamp"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={labelFormatter}
                  />
                  <YAxis tickLine={false} axisLine={false} />
                  <Tooltip
                    content={
                      <ChartTooltip
                        labelFormatter={(label) => labelFormatter(label)}
                        valueFormatter={(value) => formatValue(Number(value), valueFormatter)}
                      />
                    }
                  />
                  <Line
                    type={curveType}
                    dataKey="value"
                    name={resolvedValueLabel}
                    stroke={strokeColor ?? 'var(--color-value)'}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartContainer>
        )}
        {(xAxisLabel ?? yAxisLabel) && (
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>{xAxisLabel ?? t.DbQuery.chart.xAxis}</span>
            <span>{yAxisLabel ?? t.DbQuery.chart.yAxis}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
