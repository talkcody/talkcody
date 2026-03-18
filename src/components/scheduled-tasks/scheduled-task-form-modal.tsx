// src/components/scheduled-tasks/scheduled-task-form-modal.tsx
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useLocale } from '@/hooks/use-locale';
import { scheduledTaskNlpService } from '@/services/scheduled-tasks/scheduled-task-nlp-service';
import { useScheduledTaskStore } from '@/stores/scheduled-task-store';
import {
  type CreateScheduledTaskInput,
  DEFAULT_DELIVERY_POLICY,
  DEFAULT_EXECUTION_POLICY,
  DEFAULT_NOTIFICATION_POLICY,
  DEFAULT_OFFLINE_POLICY,
  DEFAULT_RETRY_POLICY,
  type ScheduledTask,
  type ScheduledTaskSchedule,
} from '@/types/scheduled-task';

interface Props {
  open: boolean;
  onClose: () => void;
  task?: ScheduledTask;
}

type ScheduleKind = 'at' | 'every' | 'cron';

function msToInterval(ms: number): { value: number; unit: 'minutes' | 'hours' | 'days' } {
  if (ms % 86_400_000 === 0) return { value: ms / 86_400_000, unit: 'days' };
  if (ms % 3_600_000 === 0) return { value: ms / 3_600_000, unit: 'hours' };
  return { value: Math.max(1, Math.round(ms / 60_000)), unit: 'minutes' };
}

function intervalToMs(value: number, unit: 'minutes' | 'hours' | 'days'): number {
  switch (unit) {
    case 'days':
      return value * 86_400_000;
    case 'hours':
      return value * 3_600_000;
    default:
      return value * 60_000;
  }
}

function localDatetimeToISO(val: string): string {
  return new Date(val).toISOString();
}

function isoToLocalDatetime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScheduledTaskFormModal({ open, onClose, task }: Props) {
  const { t } = useLocale();
  const { createTask, updateTask, previewCron, cronPreview } = useScheduledTaskStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isParsingNlp, setIsParsingNlp] = useState(false);

  const [name, setName] = useState('');
  const [promptMessage, setPromptMessage] = useState('');
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>('cron');
  const [nlScheduleText, setNlScheduleText] = useState('');
  const [atDatetime, setAtDatetime] = useState('');
  const [intervalValue, setIntervalValue] = useState(30);
  const [intervalUnit, setIntervalUnit] = useState<'minutes' | 'hours' | 'days'>('minutes');
  const [cronExpr, setCronExpr] = useState('0 9 * * 1-5');
  const [cronTz, setCronTz] = useState('');
  const [cronError, setCronError] = useState('');
  const [autoApproveEdits, setAutoApproveEdits] = useState(false);
  const [autoApprovePlan, setAutoApprovePlan] = useState(false);
  const [maxAttempts, setMaxAttempts] = useState(2);
  const [backoffText, setBackoffText] = useState('30000,60000');
  const [staggerMode, setStaggerMode] = useState<'auto' | 'none' | 'custom'>('auto');
  const [staggerMs, setStaggerMs] = useState(60000);
  const [notifyOnSuccess, setNotifyOnSuccess] = useState(false);
  const [notifyOnFailure, setNotifyOnFailure] = useState(true);
  const [offlineEnabled, setOfflineEnabled] = useState(false);
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [deliveryChannel, setDeliveryChannel] = useState<'telegram' | 'feishu'>('telegram');
  const [deliveryTarget, setDeliveryTarget] = useState('');

  useEffect(() => {
    if (!open) return;

    if (task) {
      setName(task.name);
      setPromptMessage(task.payload.message);
      setNlScheduleText(task.scheduleNlText ?? '');
      setAutoApproveEdits(task.payload.autoApproveEdits ?? false);
      setAutoApprovePlan(task.payload.autoApprovePlan ?? false);
      setScheduleKind(task.schedule.kind);
      setMaxAttempts(task.retryPolicy.maxAttempts);
      setBackoffText(task.retryPolicy.backoffMs.join(','));
      setNotifyOnSuccess(task.notificationPolicy?.notifyOnSuccess ?? false);
      setNotifyOnFailure(task.notificationPolicy?.notifyOnFailure ?? true);
      setOfflineEnabled(task.offlinePolicy?.enabled ?? false);
      setDeliveryEnabled(task.deliveryPolicy?.enabled ?? false);
      setDeliveryChannel(task.deliveryPolicy?.channelId ?? 'telegram');
      setDeliveryTarget(task.deliveryPolicy?.target ?? '');
      if (task.executionPolicy.staggerMs === -1) setStaggerMode('auto');
      else if (task.executionPolicy.staggerMs === 0) setStaggerMode('none');
      else {
        setStaggerMode('custom');
        setStaggerMs(task.executionPolicy.staggerMs);
      }
      if (task.schedule.kind === 'at') {
        setAtDatetime(isoToLocalDatetime(task.schedule.at));
      } else if (task.schedule.kind === 'every') {
        const { value, unit } = msToInterval(task.schedule.everyMs);
        setIntervalValue(value);
        setIntervalUnit(unit);
      } else {
        setCronExpr(task.schedule.expr);
        setCronTz(task.schedule.tz ?? '');
      }
    } else {
      setName('');
      setPromptMessage('');
      setNlScheduleText('');
      setScheduleKind('cron');
      setAtDatetime('');
      setIntervalValue(30);
      setIntervalUnit('minutes');
      setCronExpr('0 9 * * 1-5');
      setCronTz('');
      setAutoApproveEdits(false);
      setAutoApprovePlan(false);
      setMaxAttempts(2);
      setBackoffText('30000,60000');
      setStaggerMode('auto');
      setStaggerMs(60000);
      setNotifyOnSuccess(false);
      setNotifyOnFailure(true);
      setOfflineEnabled(false);
      setDeliveryEnabled(false);
      setDeliveryChannel('telegram');
      setDeliveryTarget('');
    }
    setCronError('');
  }, [open, task]);

  const effectiveStaggerMs = useMemo(() => {
    if (staggerMode === 'auto') return -1;
    if (staggerMode === 'none') return 0;
    return staggerMs;
  }, [staggerMode, staggerMs]);

  useEffect(() => {
    if (!open || scheduleKind !== 'cron') return;
    void previewCron(
      { kind: 'cron', expr: cronExpr, tz: cronTz || undefined },
      { staggerMs: effectiveStaggerMs }
    );
  }, [open, scheduleKind, cronExpr, cronTz, effectiveStaggerMs, previewCron]);

  const buildSchedule = (): ScheduledTaskSchedule => {
    switch (scheduleKind) {
      case 'at':
        return { kind: 'at', at: localDatetimeToISO(atDatetime) };
      case 'every':
        return { kind: 'every', everyMs: intervalToMs(intervalValue, intervalUnit) };
      default:
        return { kind: 'cron', expr: cronExpr, tz: cronTz || undefined };
    }
  };

  const parseBackoff = (): number[] =>
    backoffText
      .split(',')
      .map((entry) => Number(entry.trim()))
      .filter((entry) => Number.isFinite(entry) && entry > 0);

  const handleParseNaturalLanguage = async () => {
    if (!nlScheduleText.trim()) return;
    setIsParsingNlp(true);
    try {
      const parsed = await scheduledTaskNlpService.parse(nlScheduleText.trim());
      setScheduleKind(parsed.kind);
      if (parsed.kind === 'at' && parsed.at) {
        setAtDatetime(isoToLocalDatetime(parsed.at));
      } else if (parsed.kind === 'every' && parsed.everyMs) {
        const { value, unit } = msToInterval(parsed.everyMs);
        setIntervalValue(value);
        setIntervalUnit(unit);
      } else if (parsed.kind === 'cron' && parsed.expr) {
        setCronExpr(parsed.expr);
        setCronTz(parsed.tz ?? '');
      }
      if (parsed.warnings?.length) {
        toast.warning(parsed.warnings.join(' '));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setIsParsingNlp(false);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error(t.ScheduledTasks.validation.nameRequired);
      return;
    }
    if (!promptMessage.trim()) {
      toast.error(t.ScheduledTasks.validation.promptRequired);
      return;
    }
    if (scheduleKind === 'cron') {
      try {
        await invoke<void>('validate_scheduled_task_cron', { expr: cronExpr });
        setCronError('');
      } catch (error) {
        setCronError(String(error));
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const payload = {
        message: promptMessage.trim(),
        autoApproveEdits,
        autoApprovePlan,
      };
      const base = {
        name: name.trim(),
        schedule: buildSchedule(),
        scheduleNlText: nlScheduleText.trim() || undefined,
        payload,
        executionPolicy: {
          ...DEFAULT_EXECUTION_POLICY,
          staggerMs: effectiveStaggerMs,
        },
        retryPolicy: {
          ...DEFAULT_RETRY_POLICY,
          maxAttempts,
          backoffMs: parseBackoff(),
        },
        notificationPolicy: {
          ...DEFAULT_NOTIFICATION_POLICY,
          notifyOnSuccess,
          notifyOnFailure,
        },
        deliveryPolicy: {
          ...DEFAULT_DELIVERY_POLICY,
          enabled: deliveryEnabled,
          channelId: deliveryEnabled ? deliveryChannel : undefined,
          target: deliveryEnabled ? deliveryTarget : undefined,
        },
        offlinePolicy: {
          ...DEFAULT_OFFLINE_POLICY,
          enabled: offlineEnabled,
        },
      } satisfies CreateScheduledTaskInput;

      if (task) {
        await updateTask(task.id, base);
        toast.success(t.ScheduledTasks.updated);
      } else {
        await createTask(base);
        toast.success(t.ScheduledTasks.created);
      }
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task ? t.ScheduledTasks.editTask : t.ScheduledTasks.newTask}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="st-name">{t.ScheduledTasks.fields.name}</Label>
            <Input
              id="st-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.ScheduledTasks.fields.namePlaceholder}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="st-prompt">{t.ScheduledTasks.fields.prompt}</Label>
            <Textarea
              id="st-prompt"
              rows={3}
              value={promptMessage}
              onChange={(e) => setPromptMessage(e.target.value)}
              placeholder={t.ScheduledTasks.fields.promptPlaceholder}
            />
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <div className="space-y-1">
              <Label htmlFor="st-nl">{t.ScheduledTasks.fields.naturalLanguageSchedule}</Label>
              <div className="flex gap-2">
                <Input
                  id="st-nl"
                  value={nlScheduleText}
                  onChange={(e) => setNlScheduleText(e.target.value)}
                  placeholder={t.ScheduledTasks.fields.naturalLanguageSchedulePlaceholder}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleParseNaturalLanguage}
                  disabled={isParsingNlp}
                >
                  {isParsingNlp ? t.Common.loading : t.ScheduledTasks.actions.parseNaturalLanguage}
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label>{t.ScheduledTasks.fields.schedule}</Label>
            <Select
              value={scheduleKind}
              onValueChange={(value) => setScheduleKind(value as ScheduleKind)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="at">{t.ScheduledTasks.scheduleKind.at}</SelectItem>
                <SelectItem value="every">{t.ScheduledTasks.scheduleKind.every}</SelectItem>
                <SelectItem value="cron">{t.ScheduledTasks.scheduleKind.cron}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {scheduleKind === 'at' && (
            <div className="space-y-1">
              <Label htmlFor="st-at">{t.ScheduledTasks.fields.atTime}</Label>
              <Input
                id="st-at"
                type="datetime-local"
                value={atDatetime}
                onChange={(e) => setAtDatetime(e.target.value)}
              />
            </div>
          )}

          {scheduleKind === 'every' && (
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="st-interval-val">{t.ScheduledTasks.fields.intervalValue}</Label>
                <Input
                  id="st-interval-val"
                  type="number"
                  min={1}
                  value={intervalValue}
                  onChange={(e) => setIntervalValue(Number(e.target.value))}
                />
              </div>
              <div className="w-36 space-y-1">
                <Label>{t.ScheduledTasks.fields.intervalUnit}</Label>
                <Select
                  value={intervalUnit}
                  onValueChange={(value) => setIntervalUnit(value as 'minutes' | 'hours' | 'days')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">{t.ScheduledTasks.fields.minutes}</SelectItem>
                    <SelectItem value="hours">{t.ScheduledTasks.fields.hours}</SelectItem>
                    <SelectItem value="days">{t.ScheduledTasks.fields.days}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {scheduleKind === 'cron' && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-1">
                <Label htmlFor="st-cron">{t.ScheduledTasks.fields.cronExpr}</Label>
                <Input
                  id="st-cron"
                  value={cronExpr}
                  onChange={(e) => setCronExpr(e.target.value)}
                  className={cronError ? 'border-destructive' : ''}
                  placeholder="0 9 * * 1-5"
                />
                {cronError && <p className="text-xs text-destructive">{cronError}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="st-tz">{t.ScheduledTasks.fields.timezone}</Label>
                <Input
                  id="st-tz"
                  value={cronTz}
                  onChange={(e) => setCronTz(e.target.value)}
                  placeholder="Asia/Shanghai"
                />
              </div>
              <div className="space-y-1">
                <Label>{t.ScheduledTasks.fields.preview}</Label>
                <div className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
                  {cronPreview.length === 0
                    ? t.ScheduledTasks.noPreview
                    : cronPreview
                        .map(
                          (entry) =>
                            `${new Date(entry.jitteredAt).toLocaleString()} (${t.ScheduledTasks.jitterLabel(entry.jitterMs)})`
                        )
                        .join('\n')}
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-4 rounded-md border p-3 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-sm font-medium">{t.ScheduledTasks.fields.retryPolicy}</p>
              <div className="space-y-1">
                <Label htmlFor="st-attempts">{t.ScheduledTasks.fields.maxAttempts}</Label>
                <Input
                  id="st-attempts"
                  type="number"
                  min={0}
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="st-backoff">{t.ScheduledTasks.fields.backoffMs}</Label>
                <Input
                  id="st-backoff"
                  value={backoffText}
                  onChange={(e) => setBackoffText(e.target.value)}
                  placeholder="30000,60000,300000"
                />
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t.ScheduledTasks.fields.jitterPolicy}</p>
              <Select
                value={staggerMode}
                onValueChange={(value) => setStaggerMode(value as 'auto' | 'none' | 'custom')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t.ScheduledTasks.fields.jitterAuto}</SelectItem>
                  <SelectItem value="none">{t.ScheduledTasks.fields.jitterNone}</SelectItem>
                  <SelectItem value="custom">{t.ScheduledTasks.fields.jitterCustom}</SelectItem>
                </SelectContent>
              </Select>
              {staggerMode === 'custom' && (
                <div className="space-y-1">
                  <Label htmlFor="st-stagger">{t.ScheduledTasks.fields.customJitterMs}</Label>
                  <Input
                    id="st-stagger"
                    type="number"
                    min={0}
                    value={staggerMs}
                    onChange={(e) => setStaggerMs(Number(e.target.value))}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">{t.ScheduledTasks.fields.notifications}</p>
            <div className="flex items-center gap-3">
              <Switch checked={notifyOnSuccess} onCheckedChange={setNotifyOnSuccess} />
              <Label>{t.ScheduledTasks.fields.notifyOnSuccess}</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={notifyOnFailure} onCheckedChange={setNotifyOnFailure} />
              <Label>{t.ScheduledTasks.fields.notifyOnFailure}</Label>
            </div>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">{t.ScheduledTasks.fields.delivery}</p>
            <div className="flex items-center gap-3">
              <Switch checked={deliveryEnabled} onCheckedChange={setDeliveryEnabled} />
              <Label>{t.ScheduledTasks.fields.deliveryEnabled}</Label>
            </div>
            {deliveryEnabled && (
              <>
                <Select
                  value={deliveryChannel}
                  onValueChange={(value) => setDeliveryChannel(value as 'telegram' | 'feishu')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="telegram">Telegram</SelectItem>
                    <SelectItem value="feishu">Feishu</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={deliveryTarget}
                  onChange={(e) => setDeliveryTarget(e.target.value)}
                  placeholder={t.ScheduledTasks.fields.deliveryTargetPlaceholder}
                />
              </>
            )}
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">{t.ScheduledTasks.fields.offline}</p>
            <div className="flex items-center gap-3">
              <Switch checked={offlineEnabled} onCheckedChange={setOfflineEnabled} />
              <Label>{t.ScheduledTasks.fields.offlineEnabled}</Label>
            </div>
            <p className="text-xs text-muted-foreground">{t.ScheduledTasks.fields.offlineHint}</p>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">{t.ScheduledTasks.fields.advanced}</p>
            <div className="flex items-center gap-3">
              <Switch checked={autoApproveEdits} onCheckedChange={setAutoApproveEdits} />
              <Label>{t.ScheduledTasks.fields.autoApproveEdits}</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={autoApprovePlan} onCheckedChange={setAutoApprovePlan} />
              <Label>{t.ScheduledTasks.fields.autoApprovePlan}</Label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            {t.Common.cancel}
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? t.Common.saving : task ? t.Common.save : t.Common.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
