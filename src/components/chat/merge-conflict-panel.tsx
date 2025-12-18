import { AlertTriangle, Eye, File, GitMerge, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface MergeConflictPanelProps {
  conflictedFiles: string[];
  onOpenFile: (filePath: string) => void;
  onAbortMerge: () => void;
  onContinueMerge: () => void;
  isMerging: boolean;
}

export function MergeConflictPanel({
  conflictedFiles,
  onOpenFile,
  onAbortMerge,
  onContinueMerge,
  isMerging,
}: MergeConflictPanelProps) {
  if (conflictedFiles.length === 0) {
    return null;
  }

  return (
    <Card className="mx-4 mb-2 border-amber-500 dark:border-amber-600">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4" />
          Merge Conflicts Detected
          <span className="ml-auto text-sm font-normal text-muted-foreground">
            {conflictedFiles.length} {conflictedFiles.length === 1 ? 'file' : 'files'}
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          The following files have merge conflicts. Please resolve them manually in your editor,
          then click "Continue Merge" to complete the merge.
        </p>

        {/* Conflicted files list */}
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {conflictedFiles.map((filePath) => {
            const fileName = filePath.split('/').pop() || filePath;
            return (
              <div
                key={filePath}
                className="flex items-center justify-between py-2 px-3 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded border border-amber-200 dark:border-amber-800"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <File className="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                  <span className="font-mono text-sm truncate" title={filePath}>
                    {fileName}
                  </span>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenFile(filePath)}
                  className="h-7 px-2 flex-shrink-0"
                >
                  <Eye className="h-3.5 w-3.5 mr-1" />
                  Open
                </Button>
              </div>
            );
          })}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 pt-2 border-t">
          <Button
            size="sm"
            variant="destructive"
            onClick={onAbortMerge}
            disabled={isMerging}
            className="flex-1"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Abort Merge
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={onContinueMerge}
            disabled={isMerging}
            className="flex-1"
          >
            <GitMerge className="h-3.5 w-3.5 mr-1" />
            {isMerging ? 'Merging...' : 'Continue Merge'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
