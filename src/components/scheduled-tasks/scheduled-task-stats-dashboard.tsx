import { BarChart3, Clock3, RotateCcw, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLocale } from '@/hooks/use-locale';
import type { ScheduledTaskStatsSummary } from '@/types/scheduled-task';

interface Props {
  stats: ScheduledTaskStatsSummary | null;
}

function MetricCard(props: { title: string; value: string | number; icon: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{props.title}</CardTitle>
        {props.icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{props.value}</div>
      </CardContent>
    </Card>
  );
}

export function ScheduledTaskStatsDashboard({ stats }: Props) {
  const { t } = useLocale();

  if (!stats) {
    return <div className="text-sm text-muted-foreground">{t.Common.loading}</div>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        title={t.ScheduledTasks.dashboard.totalRuns}
        value={stats.totalRuns}
        icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
      />
      <MetricCard
        title={t.ScheduledTasks.dashboard.successRate}
        value={`${Math.round(stats.successRate * 100)}%`}
        icon={<Clock3 className="h-4 w-4 text-muted-foreground" />}
      />
      <MetricCard
        title={t.ScheduledTasks.dashboard.retriedRuns}
        value={stats.retriedRuns}
        icon={<RotateCcw className="h-4 w-4 text-muted-foreground" />}
      />
      <MetricCard
        title={t.ScheduledTasks.dashboard.deliveryFailures}
        value={stats.deliveryFailures}
        icon={<TriangleAlert className="h-4 w-4 text-muted-foreground" />}
      />
    </div>
  );
}
