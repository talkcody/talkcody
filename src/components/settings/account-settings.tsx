import type { User as UserType } from '@talkcody/shared';
import { Github, Loader2, LogOut, Pencil, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ProfileEditDialog } from '@/components/settings/profile-edit-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useLocale } from '@/hooks/use-locale';
import { logger } from '@/lib/logger';
import { apiClient } from '@/services/api-client';
import { useAuthStore } from '@/stores/auth-store';

export function AccountSettings() {
  const { t } = useLocale();
  const {
    isAuthenticated,
    isLoading,
    user,
    signInWithGitHub,
    signOut,
    updateUser,
    loadUserIfNeeded,
  } = useAuthStore();
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // Load user profile when component mounts (lazy loading)
  useEffect(() => {
    loadUserIfNeeded();
  }, [loadUserIfNeeded]);

  const handleSaveProfile = async (data: { displayName: string; avatarUrl: string }) => {
    try {
      logger.info('Sending request to /api/users/me with data:', data);

      const response = await apiClient.patch('/api/users/me', data, { requireAuth: true });

      logger.info('Response status:', response.status);
      logger.info('Response headers:', Object.fromEntries(response.headers.entries()));

      // Get the raw response text first
      const responseText = await response.text();
      logger.info('Response body (raw):', responseText);

      if (!response.ok) {
        let errorMessage = 'Failed to update profile';
        try {
          const error = JSON.parse(responseText);
          errorMessage = error.error || errorMessage;
        } catch {
          errorMessage = responseText || errorMessage;
        }
        logger.error('Profile update failed:', errorMessage);
        throw new Error(errorMessage);
      }

      // Try to parse the response as JSON
      let result: { user: UserType };
      try {
        result = JSON.parse(responseText);
      } catch (parseError) {
        logger.error('Failed to parse response as JSON:', parseError);
        logger.error('Response was:', responseText);
        throw new Error(t.Settings.account.invalidJsonResponse);
      }

      logger.info('Profile updated successfully');
      updateUser(result.user);
    } catch (error) {
      logger.error('Update profile error:', error);
      throw error;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t.Settings.account.title}</CardTitle>
        <CardDescription>{t.Settings.account.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isAuthenticated && isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">{t.Common.loading}</span>
          </div>
        ) : isAuthenticated && user ? (
          <>
            {/* User Profile */}
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                {user.avatarUrl && (
                  <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-muted">
                    <img
                      src={user.avatarUrl}
                      alt={user.displayName || user.name}
                      className="h-full w-full object-cover"
                    />
                  </div>
                )}
                {!user.avatarUrl && (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                    <User className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 space-y-1">
                  <div className="text-lg font-medium">{user.displayName || user.name}</div>
                  {user.email && <div className="text-sm text-muted-foreground">{user.email}</div>}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setEditDialogOpen(true)}
                  className="shrink-0"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Sign Out Button */}
            <div className="border-t pt-4">
              <Button onClick={signOut} variant="outline" className="w-full">
                <LogOut className="mr-2 h-4 w-4" />
                {t.Settings.account.signOut}
              </Button>
            </div>

            {/* Profile Edit Dialog */}
            <ProfileEditDialog
              open={editDialogOpen}
              onOpenChange={setEditDialogOpen}
              user={user}
              onSave={handleSaveProfile}
            />
          </>
        ) : (
          <>
            {/* Not Signed In */}
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t.Settings.account.signInDescription}
              </p>
              <Button onClick={signInWithGitHub} variant="default" className="w-full">
                <Github className="mr-2 h-4 w-4" />
                {t.Settings.account.signInWithGitHub}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
