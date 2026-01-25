import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLocale } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';

export type DbQuerySummaryMetricType = 'count' | 'sum' | 'average' | 'min' | 'max' | 'totalRecords';

export interface DbQuerySummaryMetric {
  label?: string;
  value: number | string;
  type: DbQuerySummaryMetricType;
  formatter?: (value: number | string) => string;
}

export interface DbQuerySummaryCardProps {
  title?: string;
  data: DbQuerySummaryMetric[];
  className?: string;
  columns?: 1 | 2 | 3 | 4;
  locale?: string;
  emptyMessage?: string;
}

const labelKeyByType = {
  totalRecords: 'totalRecords',
  count: 'count',
  sum: 'sum',
  average: 'average',
  min: 'minimum',
  max: 'maximum',
} as const;

function formatValue(value: number | string, locale?: string) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Intl.NumberFormat(locale).format(value);
  }
  return String(value);
}

function getGridClass(columns: DbQuerySummaryCardProps['columns']) {
  switch (columns) {
    case 2:
      return 'grid-cols-1 sm:grid-cols-2';
    case 3:
      return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
    case 4:
      return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';
    default:
      return 'grid-cols-1 sm:grid-cols-2';
  }
}

export function DbQuerySummaryCard({
  title,
  data,
  className,
  columns = 3,
  locale,
  emptyMessage,
}: DbQuerySummaryCardProps) {
  const { t } = useLocale();
  const resolvedTitle = title ?? t.DbQuery.summary.title;
  const resolvedEmpty = emptyMessage ?? t.DbQuery.summary.noData;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">{resolvedTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="text-sm text-muted-foreground">{resolvedEmpty}</div>
        ) : (
          <div className={cn('grid gap-3', getGridClass(columns))}>
            {data.map((metric, index) => {
              const labelKey = labelKeyByType[metric.type];
              const label =
                metric.label ?? t.DbQuery.summary[labelKey as keyof typeof t.DbQuery.summary];
              const displayValue = metric.formatter
                ? metric.formatter(metric.value)
                : formatValue(metric.value, locale);

              return (
                <div key={`${metric.type}-${index}`} className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="mt-2 text-lg font-semibold text-foreground">{displayValue}</p>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
