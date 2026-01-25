import { DbQueryBarChart, type DbQueryBarChartProps } from '@/components/ui/db-query-bar-chart';
import { DbQueryDataTable, type DbQueryDataTableProps } from '@/components/ui/db-query-data-table';
import { DbQueryLineChart, type DbQueryLineChartProps } from '@/components/ui/db-query-line-chart';
import {
  DbQuerySummaryCard,
  type DbQuerySummaryCardProps,
} from '@/components/ui/db-query-summary-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLocale } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';

export type DbQueryResultGridLayout = 'stacked' | 'side-by-side' | 'tabs';

export interface DbQueryResultGridProps<T> {
  title?: string;
  layout?: DbQueryResultGridLayout;
  summary?: DbQuerySummaryCardProps;
  table?: DbQueryDataTableProps<T>;
  barChart?: DbQueryBarChartProps;
  lineChart?: DbQueryLineChartProps;
  chartType?: 'bar' | 'line';
  emptyMessage?: string;
  className?: string;
}

export function DbQueryResultGrid<T>({
  title,
  layout = 'stacked',
  summary,
  table,
  barChart,
  lineChart,
  chartType,
  emptyMessage,
  className,
}: DbQueryResultGridProps<T>) {
  const { t } = useLocale();
  const resolvedTitle = title ?? t.DbQuery.grid.title;
  const resolvedEmpty = emptyMessage ?? t.DbQuery.grid.noData;

  const summaryNode = summary ? <DbQuerySummaryCard {...summary} /> : null;
  const tableNode = table ? <DbQueryDataTable {...table} /> : null;

  const resolvedChartType = chartType ?? (lineChart ? 'line' : 'bar');
  const chartNode =
    resolvedChartType === 'line' ? (
      lineChart ? (
        <DbQueryLineChart {...lineChart} />
      ) : null
    ) : barChart ? (
      <DbQueryBarChart {...barChart} />
    ) : null;

  const sections = [
    { key: 'summary', label: t.DbQuery.grid.tabs.summary, node: summaryNode },
    { key: 'chart', label: t.DbQuery.grid.tabs.chart, node: chartNode },
    { key: 'table', label: t.DbQuery.grid.tabs.table, node: tableNode },
  ].filter((section) => section.node !== null);

  if (sections.length === 0) {
    return <div className={cn('text-sm text-muted-foreground', className)}>{resolvedEmpty}</div>;
  }

  if (layout === 'tabs') {
    const [firstSection] = sections;
    if (!firstSection) {
      return <div className={cn('text-sm text-muted-foreground', className)}>{resolvedEmpty}</div>;
    }
    const defaultKey = firstSection.key;

    return (
      <div className={cn('space-y-3', className)}>
        <div className="text-base font-semibold text-foreground">{resolvedTitle}</div>
        <Tabs defaultValue={defaultKey}>
          <TabsList>
            {sections.map((section) => (
              <TabsTrigger key={section.key} value={section.key}>
                {section.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {sections.map((section) => (
            <TabsContent key={section.key} value={section.key}>
              {section.node}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    );
  }

  const content =
    layout === 'side-by-side' ? (
      <div className="grid gap-4 lg:grid-cols-2">
        {summaryNode}
        {chartNode}
        {tableNode ? <div className="lg:col-span-2">{tableNode}</div> : null}
      </div>
    ) : (
      <div className="flex flex-col gap-4">
        {summaryNode}
        {chartNode}
        {tableNode}
      </div>
    );

  return (
    <div className={cn('space-y-3', className)}>
      <div className="text-base font-semibold text-foreground">{resolvedTitle}</div>
      {content}
    </div>
  );
}
