import {
  AlertTriangle,
  FileEdit,
  FileMinus,
  FilePlus,
  FileWarning,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTranslation } from '@/hooks/use-locale';
import type { MergeResult, SyncResult, WorktreeChanges } from '@/types/worktree';

interface FileGroupProps {
  title: string;
  files: string[];
  icon: React.ReactNode;
}

function FileGroup({ title, files, icon }: FileGroupProps) {
  if (files.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {icon}
        <span>
          {title} ({files.length})
        </span>
      </div>
      <div className="ml-6 space-y-0.5">
        {files.map((file) => (
          <div key={file} className="truncate font-mono text-xs text-foreground/80">
            {file}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface WorktreeConflictDialogProps {
  open: boolean;
  worktreePath: string;
  changes: WorktreeChanges | null;
  isProcessing: boolean;
  mergeResult: MergeResult | null;
  syncResult: SyncResult | null;
  onDiscard: () => Promise<void>;
  onMerge: () => Promise<void>;
  onSync: () => Promise<void>;
  onCancel: () => void;
  onClose: () => void;
}

export function WorktreeConflictDialog({
  open,
  worktreePath,
  changes,
  isProcessing,
  mergeResult,
  syncResult,
  onDiscard,
  onMerge,
  onSync,
  onCancel,
  onClose,
}: WorktreeConflictDialogProps) {
  const t = useTranslation();

  const totalChanges =
    (changes?.modifiedFiles.length ?? 0) +
    (changes?.addedFiles.length ?? 0) +
    (changes?.deletedFiles.length ?? 0);

  // If there are merge or sync conflicts, show the conflict UI
  const hasConflicts = mergeResult?.hasConflicts || syncResult?.hasConflicts;
  const conflictedFiles = mergeResult?.conflictedFiles || syncResult?.conflictedFiles || [];
  const isSyncConflict = syncResult?.hasConflicts;

  if (hasConflicts) {
    return (
      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {isSyncConflict
                ? t.Worktree.conflictDialog.syncConflict.title
                : t.Worktree.conflictDialog.mergeConflict.title}
            </DialogTitle>
            <DialogDescription>
              {isSyncConflict
                ? t.Worktree.conflictDialog.syncConflict.description
                : t.Worktree.conflictDialog.mergeConflict.description}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Conflict files list */}
            <div className="space-y-2">
              <div className="text-sm font-medium">
                {isSyncConflict
                  ? t.Worktree.conflictDialog.syncConflict.conflictFiles
                  : t.Worktree.conflictDialog.mergeConflict.conflictFiles}
              </div>
              <ScrollArea className="h-40 rounded-md border">
                <div className="space-y-1 p-3">
                  {conflictedFiles.map((file) => (
                    <div key={file} className="flex items-center gap-2 text-sm">
                      <FileWarning className="h-4 w-4 text-destructive" />
                      <span className="truncate font-mono text-xs">{file}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            <p className="text-sm text-muted-foreground">
              {isSyncConflict
                ? t.Worktree.conflictDialog.syncConflict.resolveManually
                : t.Worktree.conflictDialog.mergeConflict.resolveManually}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t.Common.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Normal changes display
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            {t.Worktree.conflictDialog.title}
          </DialogTitle>
          <DialogDescription>{t.Worktree.conflictDialog.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Worktree info */}
          <div className="space-y-1 rounded-md bg-muted/50 p-3">
            <div className="text-xs text-muted-foreground">
              {t.Worktree.conflictDialog.worktreePath}
            </div>
            <div className="truncate font-mono text-sm">{worktreePath}</div>
          </div>

          {/* Changes summary */}
          {changes && (
            <>
              <div className="text-sm text-muted-foreground">
                {t.Worktree.conflictDialog.changesCount(totalChanges)}
              </div>

              {/* File lists */}
              <ScrollArea className="h-48 rounded-md border">
                <div className="space-y-4 p-3">
                  <FileGroup
                    title={t.Worktree.conflictDialog.modifiedFiles}
                    files={changes.modifiedFiles}
                    icon={<FileEdit className="h-4 w-4 text-yellow-500" />}
                  />
                  <FileGroup
                    title={t.Worktree.conflictDialog.addedFiles}
                    files={changes.addedFiles}
                    icon={<FilePlus className="h-4 w-4 text-green-500" />}
                  />
                  <FileGroup
                    title={t.Worktree.conflictDialog.deletedFiles}
                    files={changes.deletedFiles}
                    icon={<FileMinus className="h-4 w-4 text-red-500" />}
                  />
                </div>
              </ScrollArea>
            </>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={onCancel} disabled={isProcessing}>
            {t.Worktree.conflictDialog.actions.cancel}
          </Button>
          <Button
            variant="destructive"
            onClick={onDiscard}
            disabled={isProcessing}
            title={t.Worktree.conflictDialog.actions.discardDescription}
          >
            {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t.Worktree.conflictDialog.actions.discard}
          </Button>
          <Button
            variant="secondary"
            onClick={onSync}
            disabled={isProcessing}
            title={t.Worktree.conflictDialog.actions.syncDescription}
          >
            {isProcessing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {t.Worktree.conflictDialog.actions.sync}
          </Button>
          <Button
            onClick={onMerge}
            disabled={isProcessing}
            title={t.Worktree.conflictDialog.actions.mergeDescription}
          >
            {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t.Worktree.conflictDialog.actions.merge}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
