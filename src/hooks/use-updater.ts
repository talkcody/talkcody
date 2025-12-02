import { error as logError, info as logInfo } from '@tauri-apps/plugin-log';
import type { Update } from '@tauri-apps/plugin-updater';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type DownloadProgress, updateService } from '../services/update-service';

export interface UpdateState {
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  error: string | null;
  update: Update | null;
  progress: DownloadProgress | null;
}

export interface UseUpdaterReturn extends UpdateState {
  checkForUpdate: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  restartApp: () => Promise<void>;
  dismissError: () => void;
}

const PERIODIC_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const LAST_CHECK_KEY = 'last_update_check';

export function useUpdater(options?: {
  checkOnMount?: boolean;
  periodicCheck?: boolean;
}): UseUpdaterReturn {
  const { checkOnMount = false, periodicCheck = true } = options || {};

  const [state, setState] = useState<UpdateState>({
    checking: false,
    available: false,
    downloading: false,
    downloaded: false,
    error: null,
    update: null,
    progress: null,
  });

  /**
   * Store update object in a ref to ensure downloadAndInstall always has
   * access to the latest update without timing issues.
   */
  const updateRef = useRef<Update | null>(null);

  // Sync update object to ref whenever it changes
  useEffect(() => {
    updateRef.current = state.update;
  }, [state.update]);

  /**
   * Update last check timestamp
   */
  const updateLastCheckTime = useCallback(() => {
    localStorage.setItem(LAST_CHECK_KEY, Date.now().toString());
  }, []);

  /**
   * Check for updates
   */
  const checkForUpdate = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      checking: true,
      error: null,
    }));

    try {
      logInfo('User initiated update check');
      const update = await updateService.checkForUpdate();

      if (update) {
        setState((prev) => ({
          ...prev,
          checking: false,
          available: true,
          update,
        }));
      } else {
        setState((prev) => ({
          ...prev,
          checking: false,
          available: false,
          update: null,
        }));
      }

      updateLastCheckTime();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logError(`Update check failed: ${errorMessage}`);
      setState((prev) => ({
        ...prev,
        checking: false,
        error: errorMessage,
      }));
    }
  }, [updateLastCheckTime]);

  /**
   * Download and install update
   *
   * Fix: Use updateRef to access the latest update object directly.
   * This ensures we always have the most recent update without timing issues
   * that can occur with the setState callback pattern.
   */
  const downloadAndInstall = useCallback(async () => {
    // Read update from ref - this is always in sync with state.update
    const currentUpdate = updateRef.current;

    if (!currentUpdate) {
      setState((prev) => ({
        ...prev,
        error: 'No update available to download',
      }));
      return;
    }

    setState((prev) => ({
      ...prev,
      downloading: true,
      error: null,
      progress: null,
    }));

    try {
      logInfo('Starting update download and installation');
      await updateService.downloadAndInstall(currentUpdate, (progress) => {
        setState((prev) => ({
          ...prev,
          progress,
        }));
      });

      setState((prev) => ({
        ...prev,
        downloading: false,
        downloaded: true,
      }));

      logInfo('Update downloaded and installed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logError(`Update download/install failed: ${errorMessage}`);
      setState((prev) => ({
        ...prev,
        downloading: false,
        error: errorMessage,
      }));
    }
  }, []); // Empty deps array - function reference is now stable

  /**
   * Restart the application
   */
  const restartApp = useCallback(async () => {
    try {
      await updateService.restartApp();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setState((prev) => ({
        ...prev,
        error: errorMessage,
      }));
    }
  }, []);

  /**
   * Dismiss error message
   */
  const dismissError = useCallback(() => {
    setState((prev) => ({
      ...prev,
      error: null,
    }));
  }, []);

  /**
   * Store checkForUpdate in a ref to avoid recreating the effect
   * when the function reference changes
   */
  const checkForUpdateRef = useRef(checkForUpdate);
  useEffect(() => {
    checkForUpdateRef.current = checkForUpdate;
  }, [checkForUpdate]);

  /**
   * Effect for checking updates on mount and periodically
   *
   * Fix: Use ref to access checkForUpdate instead of including it in deps.
   * This prevents the effect from re-running every time checkForUpdate changes,
   * which would cause the interval to be cleared and recreated unnecessarily.
   */
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const performCheck = async () => {
      const lastCheck = localStorage.getItem(LAST_CHECK_KEY);
      const shouldCheck =
        !lastCheck || Date.now() - parseInt(lastCheck, 10) >= PERIODIC_CHECK_INTERVAL;

      if (periodicCheck && shouldCheck) {
        logInfo('Performing periodic update check');
        await checkForUpdateRef.current();
      }
    };

    // Check on mount if enabled
    if (checkOnMount) {
      performCheck();
    }

    // Setup periodic check if enabled
    if (periodicCheck) {
      intervalId = setInterval(performCheck, PERIODIC_CHECK_INTERVAL);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
    // Only depend on checkOnMount and periodicCheck flags, not the checkForUpdate function
  }, [checkOnMount, periodicCheck]);

  return {
    ...state,
    checkForUpdate,
    downloadAndInstall,
    restartApp,
    dismissError,
  };
}
