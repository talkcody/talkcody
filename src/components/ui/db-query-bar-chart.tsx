import * as React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { useLocale } from '@/hooks/use-locale';

export interface DbQueryBarDatum {
  label: string;
  value: number;
  color?: string;
}

export interface DbQueryBarChartProps {
  title?: string;
  data: DbQueryBarDatum[];
  xAxisLabel?: string;
  yAxisLabel?: string;
  valueLabel?: string;
  valueFormatter?: (value: number) => string;
  className?: string;
  height?: number;
  emptyMessage?: string;
}

function formatValue(value: number, formatter?: (value: number) => string) {
  return formatter ? formatter(value) : new Intl.NumberFormat().format(value);
}

export function DbQueryBarChart({
  title,
  data,
  xAxisLabel,
  yAxisLabel,
  valueLabel,
  valueFormatter,
  className,
  height = 320,
  emptyMessage,
}: DbQueryBarChartProps) {
  const { t } = useLocale();
  const resolvedTitle = title ?? t.DbQuery.grid.tabs.chart;
  const resolvedEmpty = emptyMessage ?? t.DbQuery.chart.noData;

  const chartConfig = React.useMemo(
    () => ({
      value: {
        label: valueLabel ?? t.DbQuery.chart.valueLabel,
        color: 'hsl(212 84% 60%)',
      },
    }),
    [t, valueLabel]
  );

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
                <BarChart data={data} margin={{ top: 8, right: 16, left: 16, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <Tooltip
                    content={
                      <ChartTooltip
                        labelFormatter={(label) => label}
                        valueFormatter={(value) => formatValue(Number(value), valueFormatter)}
                      />
                    }
                  />
                  <Bar dataKey="value" name={valueLabel ?? t.DbQuery.chart.valueLabel} radius={6}>
                    {data.map((entry, index) => (
                      <Cell
                        key={`cell-${entry.label}-${index}`}
                        fill={entry.color ?? 'var(--color-value)'}
                      />
                    ))}
                  </Bar>
                </BarChart>
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
