import type { User } from '@talkcody/shared';
import { Loader2, Upload } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/hooks/use-locale';
import { getApiUrl } from '@/lib/config';
import { logger } from '@/lib/logger';
import { secureStorage } from '@/services/secure-storage';

interface ProfileEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User;
  onSave: (data: { displayName: string; avatarUrl: string }) => Promise<void>;
}

export function ProfileEditDialog({ open, onOpenChange, user, onSave }: ProfileEditDialogProps) {
  const t = useTranslation();
  const avatarUrlId = useId();
  const avatarFileId = useId();
  const displayNameId = useId();

  const [displayName, setDisplayName] = useState(user.displayName || user.name);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl || '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleAvatarUrlChange = (url: string) => {
    setAvatarUrl(url);
    setAvatarFile(null);
    setAvatarPreview(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      toast.error(t.Settings.account.invalidFileType);
      return;
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      toast.error(t.Settings.account.fileTooLarge);
      return;
    }

    setAvatarFile(file);

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setAvatarPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    logger.info('=== handleSave called ===');
    logger.info('displayName:', displayName);
    logger.info('avatarUrl:', avatarUrl);

    try {
      setSaving(true);

      let finalAvatarUrl = avatarUrl;

      // Upload file if selected
      if (avatarFile) {
        logger.info('Uploading avatar file:', avatarFile.name);
        const formData = new FormData();
        formData.append('avatar', avatarFile);

        const apiUrl = getApiUrl('/api/users/me/avatar');
        logger.info('Uploading to:', apiUrl);

        // Get auth token
        const token = await secureStorage.getAuthToken();
        if (!token) {
          throw new Error(t.Settings.account.authRequired);
        }

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });

        if (!response.ok) {
          const error = await response.json();
          logger.error('Avatar upload failed:', error);
          throw new Error(error.error || t.Settings.account.failedUploadAvatar);
        }

        const data = await response.json();
        finalAvatarUrl = data.avatarUrl;
        logger.info('Avatar uploaded successfully:', finalAvatarUrl);
      }

      // Save profile
      logger.info('Saving profile data...');
      await onSave({
        displayName: displayName.trim(),
        avatarUrl: finalAvatarUrl,
      });

      toast.success(t.Settings.account.profileUpdated);
      logger.info('Profile save completed successfully');
      onOpenChange(false);
    } catch (error) {
      logger.error('Save profile error:', error);
      toast.error(error instanceof Error ? error.message : t.Settings.account.profileUpdateFailed);
    } finally {
      setSaving(false);
    }
  };

  const currentAvatar = avatarPreview || avatarUrl || user.avatarUrl;
  const displayInitial = (displayName || user.name).charAt(0).toUpperCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t.Settings.profile.editTitle}</DialogTitle>
          <DialogDescription>{t.Settings.profile.editDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Avatar Section */}
          <div className="flex flex-col items-center space-y-4">
            <Avatar className="h-24 w-24">
              <AvatarImage src={currentAvatar || ''} />
              <AvatarFallback className="text-2xl">{displayInitial}</AvatarFallback>
            </Avatar>

            <div className="w-full space-y-3">
              <div>
                <Label htmlFor={avatarUrlId}>{t.Settings.profile.avatarUrl}</Label>
                <Input
                  id={avatarUrlId}
                  type="text"
                  placeholder={t.Settings.profile.avatarUrlPlaceholder}
                  value={avatarUrl}
                  onChange={(e) => handleAvatarUrlChange(e.target.value)}
                  className="mt-1.5"
                />
              </div>

              <div className="relative">
                <div className="flex items-center justify-center">
                  <span className="text-sm text-muted-foreground">{t.Settings.profile.or}</span>
                </div>
              </div>

              <div>
                <Label htmlFor={avatarFileId}>{t.Settings.profile.uploadImage}</Label>
                <div className="mt-1.5">
                  <label
                    htmlFor={avatarFileId}
                    className="flex items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors"
                  >
                    <Upload className="h-4 w-4" />
                    {avatarFile ? avatarFile.name : t.Settings.profile.chooseFile}
                  </label>
                  <input
                    id={avatarFileId}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  {t.Settings.profile.fileTypeHint}
                </p>
              </div>
            </div>
          </div>

          {/* Display Name */}
          <div className="space-y-2">
            <Label htmlFor={displayNameId}>{t.Settings.profile.displayName}</Label>
            <Input
              id={displayNameId}
              type="text"
              placeholder={t.Settings.profile.displayNamePlaceholder}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t.Settings.profile.displayNameHint}</p>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t.Common.cancel}
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || !displayName.trim()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t.Settings.profile.saveChanges}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
