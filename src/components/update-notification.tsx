import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useUpdater } from '@/hooks/use-updater';
import { UpdateDialog } from './update-dialog';

interface UpdateNotificationProps {
  checkOnMount?: boolean;
  periodicCheck?: boolean;
}

export function UpdateNotification({
  checkOnMount = true,
  periodicCheck = true,
}: UpdateNotificationProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const updater = useUpdater({ checkOnMount, periodicCheck });

  // Auto-download when update is available (silent background download)
  // Only attempt once - if error occurs, don't retry automatically
  useEffect(() => {
    if (updater.available && !updater.downloading && !updater.downloaded && !updater.error) {
      updater.downloadAndInstall();
    }
  }, [updater]);

  // Show error notification
  useEffect(() => {
    if (updater.error && !dialogOpen) {
      toast.error('Update Error', {
        description: updater.error,
        action: {
          label: 'Dismiss',
          onClick: () => updater.dismissError(),
        },
      });
    }
  }, [updater.error, dialogOpen, updater]);

  // Show success notification when downloaded
  useEffect(() => {
    if (updater.downloaded && !dialogOpen) {
      toast.success('Update Ready', {
        description: 'The update has been installed. Restart to apply changes.',
        action: {
          label: 'Restart',
          onClick: () => updater.restartApp(),
        },
        duration: Infinity,
      });
    }
  }, [updater.downloaded, dialogOpen, updater]);

  return <UpdateDialog open={dialogOpen} onOpenChange={setDialogOpen} updater={updater} />;
}
