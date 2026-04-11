// src/components/chat/auto-approve-button.tsx

import { CheckCircle, Circle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { useLocale } from '@/hooks/use-locale';
import { logger } from '@/lib/logger';
import { taskService } from '@/services/task-service';
import { useSettingsStore } from '@/stores/settings-store';
import { useTaskStore } from '@/stores/task-store';
import type { TaskSettings } from '@/types/task';

export function AutoApproveButton() {
  const { t } = useLocale();
  const [isLoading, setIsLoading] = useState(false);
  const currentTaskId = useTaskStore((state) => state.currentTaskId);
  const autoApproveEditsGlobal = useSettingsStore((state) => state.auto_approve_edits_global);
  const autoApprovePlanGlobal = useSettingsStore((state) => state.auto_approve_plan_global);
  const autoCodeReviewGlobal = useSettingsStore((state) => state.auto_code_review_global);
  const autoGitCommitGlobal = useSettingsStore((state) => state.auto_git_commit_global);
  const autoCheckFinishGlobal = useSettingsStore((state) => state.auto_check_finish_global);
  const setAutoApproveEditsGlobal = useSettingsStore((state) => state.setAutoApproveEditsGlobal);
  const setAutoApprovePlanGlobal = useSettingsStore((state) => state.setAutoApprovePlanGlobal);
  const setAutoCodeReviewGlobal = useSettingsStore((state) => state.setAutoCodeReviewGlobal);
  const setAutoGitCommitGlobal = useSettingsStore((state) => state.setAutoGitCommitGlobal);
  const setAutoCheckFinishGlobal = useSettingsStore((state) => state.setAutoCheckFinishGlobal);

  const [editsEnabled, setEditsEnabled] = useState(autoApproveEditsGlobal);
  const [planEnabled, setPlanEnabled] = useState(autoApprovePlanGlobal);
  const [codeReviewEnabled, setCodeReviewEnabled] = useState(autoCodeReviewGlobal);
  const [gitCommitEnabled, setGitCommitEnabled] = useState(autoGitCommitGlobal);
  const [checkFinishEnabled, setCheckFinishEnabled] = useState(autoCheckFinishGlobal);

  useEffect(() => {
    setEditsEnabled(autoApproveEditsGlobal);
  }, [autoApproveEditsGlobal]);

  useEffect(() => {
    setPlanEnabled(autoApprovePlanGlobal);
  }, [autoApprovePlanGlobal]);

  useEffect(() => {
    setCodeReviewEnabled(autoCodeReviewGlobal);
  }, [autoCodeReviewGlobal]);

  useEffect(() => {
    setGitCommitEnabled(autoGitCommitGlobal);
  }, [autoGitCommitGlobal]);

  useEffect(() => {
    setCheckFinishEnabled(autoCheckFinishGlobal);
  }, [autoCheckFinishGlobal]);

  const handleToggle = async (
    kind: 'edits' | 'plan' | 'codeReview' | 'gitCommit' | 'checkFinish'
  ) => {
    if (isLoading) return;

    setIsLoading(true);
    try {
      if (kind === 'edits') {
        const newEnabled = !editsEnabled;
        await setAutoApproveEditsGlobal(newEnabled);

        if (currentTaskId) {
          const settings: TaskSettings = { autoApproveEdits: newEnabled };
          await taskService.updateTaskSettings(currentTaskId, settings);
          logger.info(
            `Auto-approve edits ${newEnabled ? 'enabled' : 'disabled'} for task ${currentTaskId}`
          );
        }

        setEditsEnabled(newEnabled);
        toast.success(
          newEnabled ? t.Chat.autoApproveEdits.enabled : t.Chat.autoApproveEdits.disabled
        );
        return;
      }

      if (kind === 'plan') {
        const newEnabled = !planEnabled;
        await setAutoApprovePlanGlobal(newEnabled);

        if (currentTaskId) {
          const settings: TaskSettings = { autoApprovePlan: newEnabled };
          await taskService.updateTaskSettings(currentTaskId, settings);
          logger.info(
            `Auto-approve plan ${newEnabled ? 'enabled' : 'disabled'} for task ${currentTaskId}`
          );
        }

        setPlanEnabled(newEnabled);
        toast.success(
          newEnabled ? t.Chat.autoApprovePlan.enabled : t.Chat.autoApprovePlan.disabled
        );
        return;
      }

      if (kind === 'codeReview') {
        const newEnabled = !codeReviewEnabled;
        await setAutoCodeReviewGlobal(newEnabled);

        if (currentTaskId) {
          const settings: TaskSettings = { autoCodeReview: newEnabled };
          await taskService.updateTaskSettings(currentTaskId, settings);
          logger.info(
            `Auto code review ${newEnabled ? 'enabled' : 'disabled'} for task ${currentTaskId}`
          );
        }

        setCodeReviewEnabled(newEnabled);
        toast.success(newEnabled ? t.Chat.autoCodeReview.enabled : t.Chat.autoCodeReview.disabled);
        return;
      }

      if (kind === 'gitCommit') {
        const newEnabled = !gitCommitEnabled;
        await setAutoGitCommitGlobal(newEnabled);

        if (currentTaskId) {
          const settings: TaskSettings = { autoGitCommit: newEnabled };
          await taskService.updateTaskSettings(currentTaskId, settings);
          logger.info(
            `Auto git commit ${newEnabled ? 'enabled' : 'disabled'} for task ${currentTaskId}`
          );
        }

        setGitCommitEnabled(newEnabled);
        toast.success(newEnabled ? t.Chat.autoGitCommit.enabled : t.Chat.autoGitCommit.disabled);
        return;
      }

      const newEnabled = !checkFinishEnabled;
      await setAutoCheckFinishGlobal(newEnabled);

      if (currentTaskId) {
        const settings: TaskSettings = { autoCheckFinish: newEnabled };
        await taskService.updateTaskSettings(currentTaskId, settings);
        logger.info(
          `Auto check finish ${newEnabled ? 'enabled' : 'disabled'} for task ${currentTaskId}`
        );
      }

      setCheckFinishEnabled(newEnabled);
      toast.success(newEnabled ? t.Chat.autoCheckFinish.enabled : t.Chat.autoCheckFinish.disabled);
    } catch (error) {
      logger.error('Failed to update auto-approve setting:', error);
      toast.error(
        kind === 'edits'
          ? t.Chat.autoApproveEdits.toggleFailed
          : kind === 'plan'
            ? t.Chat.autoApprovePlan.toggleFailed
            : kind === 'codeReview'
              ? t.Chat.autoCodeReview.toggleFailed
              : kind === 'gitCommit'
                ? t.Chat.autoGitCommit.toggleFailed
                : t.Chat.autoCheckFinish.toggleFailed
      );
    } finally {
      setIsLoading(false);
    }
  };

  const anyEnabled =
    editsEnabled || planEnabled || codeReviewEnabled || gitCommitEnabled || checkFinishEnabled;

  return (
    <HoverCard>
      <Popover>
        <HoverCardTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 relative"
              disabled={isLoading}
              aria-label={t.Chat.autoApproveEdits.title}
            >
              {anyEnabled ? (
                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground" />
              )}
              {anyEnabled && (
                <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-green-500" />
              )}
            </Button>
          </PopoverTrigger>
        </HoverCardTrigger>
        <HoverCardContent side="top" className="w-72">
          <div className="space-y-3">
            <div className="space-y-1">
              <h4 className="font-medium text-sm">{t.Chat.autoApproveEdits.title}</h4>
              <p className="text-xs text-muted-foreground">{t.Chat.autoApproveEdits.description}</p>
              <p className="text-xs">
                <span className="text-muted-foreground">{t.Chat.autoApproveEdits.title}: </span>
                <span className={editsEnabled ? 'text-green-600 dark:text-green-400' : ''}>
                  {editsEnabled
                    ? t.Chat.autoApproveEdits.enabled
                    : t.Chat.autoApproveEdits.disabled}
                </span>
              </p>
            </div>
            <div className="space-y-1">
              <h4 className="font-medium text-sm">{t.Chat.autoApprovePlan.title}</h4>
              <p className="text-xs text-muted-foreground">{t.Chat.autoApprovePlan.description}</p>
              <p className="text-xs">
                <span className="text-muted-foreground">{t.Chat.autoApprovePlan.title}: </span>
                <span className={planEnabled ? 'text-green-600 dark:text-green-400' : ''}>
                  {planEnabled ? t.Chat.autoApprovePlan.enabled : t.Chat.autoApprovePlan.disabled}
                </span>
              </p>
            </div>
            <div className="space-y-1">
              <h4 className="font-medium text-sm">{t.Chat.autoCodeReview.title}</h4>
              <p className="text-xs text-muted-foreground">{t.Chat.autoCodeReview.description}</p>
              <p className="text-xs">
                <span className="text-muted-foreground">{t.Chat.autoCodeReview.title}: </span>
                <span className={codeReviewEnabled ? 'text-green-600 dark:text-green-400' : ''}>
                  {codeReviewEnabled
                    ? t.Chat.autoCodeReview.enabled
                    : t.Chat.autoCodeReview.disabled}
                </span>
              </p>
            </div>
            <div className="space-y-1">
              <h4 className="font-medium text-sm">{t.Chat.autoGitCommit.title}</h4>
              <p className="text-xs text-muted-foreground">{t.Chat.autoGitCommit.description}</p>
              <p className="text-xs">
                <span className="text-muted-foreground">{t.Chat.autoGitCommit.title}: </span>
                <span className={gitCommitEnabled ? 'text-green-600 dark:text-green-400' : ''}>
                  {gitCommitEnabled ? t.Chat.autoGitCommit.enabled : t.Chat.autoGitCommit.disabled}
                </span>
              </p>
            </div>
            <div className="space-y-1">
              <h4 className="font-medium text-sm">{t.Chat.autoCheckFinish.title}</h4>
              <p className="text-xs text-muted-foreground">{t.Chat.autoCheckFinish.description}</p>
              <p className="text-xs">
                <span className="text-muted-foreground">{t.Chat.autoCheckFinish.title}: </span>
                <span className={checkFinishEnabled ? 'text-green-600 dark:text-green-400' : ''}>
                  {checkFinishEnabled
                    ? t.Chat.autoCheckFinish.enabled
                    : t.Chat.autoCheckFinish.disabled}
                </span>
              </p>
            </div>
          </div>
        </HoverCardContent>
        <PopoverContent side="top" align="end" className="w-80 p-3">
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{t.Chat.autoApproveEdits.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.Chat.autoApproveEdits.description}
                  </p>
                </div>
                <Switch
                  checked={editsEnabled}
                  onCheckedChange={() => handleToggle('edits')}
                  disabled={isLoading}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {editsEnabled
                  ? t.Chat.autoApproveEdits.enabledTooltip
                  : t.Chat.autoApproveEdits.disabledTooltip}
              </p>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{t.Chat.autoApprovePlan.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.Chat.autoApprovePlan.description}
                  </p>
                </div>
                <Switch
                  checked={planEnabled}
                  onCheckedChange={() => handleToggle('plan')}
                  disabled={isLoading}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {planEnabled
                  ? t.Chat.autoApprovePlan.enabledTooltip
                  : t.Chat.autoApprovePlan.disabledTooltip}
              </p>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{t.Chat.autoCodeReview.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.Chat.autoCodeReview.description}
                  </p>
                </div>
                <Switch
                  checked={codeReviewEnabled}
                  onCheckedChange={() => handleToggle('codeReview')}
                  disabled={isLoading}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {codeReviewEnabled
                  ? t.Chat.autoCodeReview.enabledTooltip
                  : t.Chat.autoCodeReview.disabledTooltip}
              </p>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{t.Chat.autoGitCommit.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.Chat.autoGitCommit.description}
                  </p>
                </div>
                <Switch
                  checked={gitCommitEnabled}
                  onCheckedChange={() => handleToggle('gitCommit')}
                  disabled={isLoading}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {gitCommitEnabled
                  ? t.Chat.autoGitCommit.enabledTooltip
                  : t.Chat.autoGitCommit.disabledTooltip}
              </p>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{t.Chat.autoCheckFinish.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.Chat.autoCheckFinish.description}
                  </p>
                </div>
                <Switch
                  checked={checkFinishEnabled}
                  onCheckedChange={() => handleToggle('checkFinish')}
                  disabled={isLoading}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {checkFinishEnabled
                  ? t.Chat.autoCheckFinish.enabledTooltip
                  : t.Chat.autoCheckFinish.disabledTooltip}
              </p>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </HoverCard>
  );
}
