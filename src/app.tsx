import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrent as getCurrentDeepLinkUrls, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InitializationScreen } from '@/components/initialization-screen';
import { LspDownloadPrompt } from '@/components/lsp-download-prompt';
import { MainContent } from '@/components/main-content';
import { NavigationSidebar } from '@/components/navigation-sidebar';
import { OnboardingWizard } from '@/components/onboarding';
import { TelegramRemoteServiceRunner } from '@/components/remote/telegram-remote-runner';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { UpdateNotification } from '@/components/update-notification';
import { WhatsNewDialog } from '@/components/whats-new-dialog';
import { UiNavigationProvider, useUiNavigation } from '@/contexts/ui-navigation';
import { useWindowContext, WindowProvider } from '@/contexts/window-context';
import { useGlobalShortcuts } from '@/hooks/use-global-shortcuts';
import { useTheme } from '@/hooks/use-theme';
import { logger } from '@/lib/logger';
import { initializationManager } from '@/services/initialization-manager';
import { WindowManagerService } from '@/services/window-manager-service';
import { WindowRestoreService } from '@/services/window-restore-service';
import { useAuthStore } from '@/stores/auth-store';
import { useSettingsStore } from '@/stores/settings-store';
import {
  RepositoryStoreProvider,
  useWindowScopedRepositoryStore,
} from '@/stores/window-scoped-repository-store';
import { NavigationView } from '@/types/navigation';

function AppContent() {
  const { activeView, setActiveView } = useUiNavigation();
  const { handleOAuthCallback } = useAuthStore();
  const { isMainWindow } = useWindowContext();

  // Initialize theme sync from database to localStorage
  useTheme();

  // Initialization state
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Register global keyboard shortcuts
  useGlobalShortcuts({
    openModelSettings: useCallback(() => {
      setActiveView(NavigationView.SETTINGS);
      // Dispatch event to switch to models tab
      window.dispatchEvent(new CustomEvent('openModelSettingsTab'));
    }, [setActiveView]),
  });

  // Unified initialization on app startup - optimized for fast startup
  useEffect(() => {
    const initializeApp = async () => {
      try {
        const startTime = performance.now();
        logger.info('Starting app initialization...');

        // Use initialization manager to handle critical store initialization
        // Non-critical services are loaded in background (non-blocking)
        await initializationManager.initialize();

        const initTime = performance.now() - startTime;
        logger.info(`App initialization completed in ${initTime.toFixed(0)}ms`);

        // Check if onboarding is needed
        const { onboarding_completed } = useSettingsStore.getState();
        if (!onboarding_completed) {
          setShowOnboarding(true);
        }

        setIsInitializing(false);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        logger.error('App initialization failed:', error);
        setInitError(`Failed to initialize: ${errorMessage}`);
        setIsInitializing(false);
      }
    };

    initializeApp();
  }, []); // Empty deps - initialization manager handles everything

  // Handle deep link URLs (OAuth callback)
  const handleDeepLinkUrl = useCallback(
    async (url: string) => {
      try {
        logger.info('[Deep Link] Processing deep link URL:', url);

        // Step 1: Activate the app to bring it to foreground (macOS specific)
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          logger.info('[Deep Link] Activating app...');
          await invoke('activate_app');
          logger.info('[Deep Link] App activated successfully');
        } catch (activateError) {
          logger.error('[Deep Link] Failed to activate app:', activateError);
        }

        // Step 2: Show and focus the window
        try {
          const window = getCurrentWindow();
          logger.info('[Deep Link] Showing and focusing window...');
          await window.show();
          await window.setFocus();
          logger.info('[Deep Link] Window shown and focused');
        } catch (windowError) {
          logger.error('[Deep Link] Failed to show/focus window:', windowError);
        }

        // Step 3: Parse URL and extract token
        logger.info('[Deep Link] Parsing URL...');
        const parsedUrl = new URL(url);
        logger.info('[Deep Link] URL pathname:', parsedUrl.pathname);
        logger.info('[Deep Link] URL search params:', parsedUrl.search);

        // Extract token from query params
        // Expected format: talkcody://auth/callback?token=xxx
        const token = parsedUrl.searchParams.get('token');

        if (token) {
          logger.info('[Deep Link] OAuth token received, length:', token.length);
          // Step 4: Process the OAuth callback
          await handleOAuthCallback(token);
          logger.info('[Deep Link] OAuth callback completed');
        } else {
          logger.error('[Deep Link] No token found in deep link URL');
          logger.error(
            '[Deep Link] No token found in URL. Available params:',
            Array.from(parsedUrl.searchParams.keys())
          );
        }
      } catch (error) {
        logger.error('[Deep Link] Failed to process deep link URL:', error);

        // Show error toast to user
        const { toast } = await import('sonner');
        toast.error('Failed to process sign-in callback');
      }
    },
    [handleOAuthCallback]
  );

  // Use ref to avoid stale closure in deep link listener
  // This ensures that listener always uses the latest handleDeepLinkUrl function
  const handleDeepLinkUrlRef = useRef(handleDeepLinkUrl);

  // Keep ref updated on every render
  useEffect(() => {
    handleDeepLinkUrlRef.current = handleDeepLinkUrl;
  }, [handleDeepLinkUrl]);

  // Listen for deep link events (OAuth callback)
  // Using ref pattern to avoid stale closures while keeping empty deps
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let isMounted = true;

    const setupDeepLink = async () => {
      try {
        logger.info('[Deep Link] Setting up deep link handler...');

        // Get initial URL (if app was launched via deep link)
        getCurrentDeepLinkUrls()
          .then((urls) => {
            if (!isMounted) return;
            logger.info('[Deep Link] Initial URLs:', urls);
            if (urls && urls.length > 0) {
              const firstUrl = urls[0];
              if (firstUrl) {
                // Use ref to get latest function
                handleDeepLinkUrlRef.current(firstUrl);
              }
            }
          })
          .catch((err) => {
            logger.error('[Deep Link] Failed to get initial URLs:', err);
          });

        // Listen for deep link events using official API
        const unlistenFn = await onOpenUrl((urls) => {
          try {
            logger.info('Deep link event received:', urls);

            if (urls && urls.length > 0) {
              const firstUrl = urls[0];
              if (firstUrl) {
                // Use ref to always get the latest function
                // This avoids stale closure issues
                handleDeepLinkUrlRef.current(firstUrl);
              }
            }
          } catch (error) {
            // Catch errors to prevent crashes in the listener
            logger.error('[Deep Link] Error in listener handler:', error);
          }
        });

        // Only set unlisten if component is still mounted
        if (isMounted) {
          unlisten = unlistenFn;
        } else {
          // Component unmounted before setup completed, clean up immediately
          unlistenFn?.();
        }
      } catch (error) {
        logger.error('[Deep Link] Setup failed:', error);
      }
    };

    setupDeepLink();

    // Cleanup function
    return () => {
      isMounted = false;
      if (unlisten) {
        unlisten();
      }
    };
    // Empty deps is safe now because we use ref pattern
  }, []);

  // MCP adapter is now lazy-loaded when first used
  // This saves ~1 second on startup by not connecting to MCP servers immediately
  // The multiMCPAdapter.getAdaptedTools() will call initialize() on first use

  // Restore windows on app startup (only for main window)
  // Executes immediately after main UI is displayed (isInitializing becomes false)
  useEffect(() => {
    if (!isMainWindow || isInitializing) return;

    const restoreWindows = async () => {
      try {
        logger.info('Restoring windows from last session...');
        await WindowRestoreService.restoreWindows();
        logger.info('Windows restored successfully');
      } catch (error) {
        logger.error('Failed to restore windows:', error);
      }
    };

    restoreWindows();
  }, [isMainWindow, isInitializing]);

  // Store ref for dynamic dependencies to avoid infinite loops
  const repositoryDepsRef = useRef<{
    openRepository: (path: string, projectId: string) => Promise<void>;
    rootPath: string | null;
  }>({ openRepository: () => Promise.resolve(), rootPath: null });

  // Update ref when store changes
  const openRepository = useWindowScopedRepositoryStore((state) => state.openRepository);
  const rootPath = useWindowScopedRepositoryStore((state) => state.rootPath);

  // Update the ref on every render
  repositoryDepsRef.current = { openRepository, rootPath };

  // Track if we've already loaded window project
  const projectLoadedRef = useRef(false);

  // Track when repository becomes ready (has a rootPath)
  const repositoryReadyRef = useRef(false);
  useEffect(() => {
    if (rootPath) {
      repositoryReadyRef.current = true;
    }
  }, [rootPath]);

  // Load window-associated project on startup (for all windows)
  // This handles the case where a window is created from dock menu with a specific project
  useEffect(() => {
    const loadWindowProject = async () => {
      // Wait for initialization to complete
      if (isInitializing) return;
      // Skip if already loaded or repository already ready
      if (projectLoadedRef.current || repositoryReadyRef.current) return;

      // 1. First check if this is a new window
      const isNewWindow = await WindowManagerService.checkNewWindowFlag();
      if (isNewWindow) {
        logger.info('[app.tsx] New window detected - skipping auto-load');
        await WindowManagerService.clearNewWindowFlag();
        projectLoadedRef.current = true;
        return;
      }

      // 2. Then check window-associated project
      try {
        const windowInfo = await WindowManagerService.getWindowInfo();
        const { openRepository: repoOpenFn, rootPath: currentRootPath } = repositoryDepsRef.current;

        if (windowInfo?.projectId && windowInfo?.rootPath && !currentRootPath) {
          logger.info('[app.tsx] Loading window-associated project:', windowInfo.rootPath);
          projectLoadedRef.current = true;
          await repoOpenFn(windowInfo.rootPath, windowInfo.projectId);
        } else {
          logger.info('[app.tsx] No window-associated project, delegating to repository-layout');
          projectLoadedRef.current = true;
        }
      } catch (error) {
        logger.error('[app.tsx] Failed to load window project:', error);
        projectLoadedRef.current = true;
      }
    };

    loadWindowProject();
  }, [isInitializing]);

  // Save window state before closing
  useEffect(() => {
    const handleBeforeUnload = async () => {
      try {
        if (isMainWindow) {
          await WindowRestoreService.saveAllWindowsState();
        }
      } catch (error) {
        logger.error('Failed to save window state on close:', error);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isMainWindow]);

  // Global drag/drop event handlers to prevent browser default behavior
  // This is required for Tauri's file-drop events to work properly
  useEffect(() => {
    const preventDefault = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    // Prevent default behavior on document level
    document.addEventListener('dragover', preventDefault);
    document.addEventListener('drop', preventDefault);

    logger.info('Global drag/drop preventDefault handlers registered');

    return () => {
      document.removeEventListener('dragover', preventDefault);
      document.removeEventListener('drop', preventDefault);
      logger.info('Global drag/drop preventDefault handlers unregistered');
    };
  }, []);

  // Prevent Shift+Esc from triggering WebView2's browser task manager on Windows
  // This is a WebView2/Chromium built-in shortcut that cannot be disabled at the WebView level
  // We intercept it at the JavaScript level to prevent it from bubbling to the WebView
  useEffect(() => {
    const preventShiftEsc = (e: KeyboardEvent) => {
      // Check if it's Shift+Esc
      if (e.key === 'Escape' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        logger.debug('Prevented Shift+Esc browser task manager shortcut');
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    };

    // Use capture phase to intercept before any other handlers
    document.addEventListener('keydown', preventShiftEsc, true);

    logger.info('Global Shift+Esc preventDefault handler registered');

    return () => {
      document.removeEventListener('keydown', preventShiftEsc, true);
      logger.info('Global Shift+Esc preventDefault handler unregistered');
    };
  }, []);

  // Show initialization screen while loading or if there's an error
  if (isInitializing || initError) {
    return <InitializationScreen error={initError} />;
  }

  // Show onboarding for first-time users
  if (showOnboarding) {
    return <OnboardingWizard onComplete={() => setShowOnboarding(false)} />;
  }

  return (
    <div className="flex h-screen">
      {/* Left Navigation Sidebar */}
      <NavigationSidebar activeView={activeView} onViewChange={setActiveView} />

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden">
        <MainContent activeView={activeView} />
      </div>

      {/* Toast Notifications */}
      <TelegramRemoteServiceRunner />
      <Toaster richColors />

      {/* Update Notification */}
      <UpdateNotification checkOnMount={true} periodicCheck={true} />

      {/* What's New Dialog - shown after app update */}
      <WhatsNewDialog />

      {/* LSP Server Download Prompt */}
      <LspDownloadPrompt />
    </div>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="system">
      <WindowProvider>
        <RepositoryStoreProvider>
          <UiNavigationProvider>
            <AppContent />
          </UiNavigationProvider>
        </RepositoryStoreProvider>
      </WindowProvider>
    </ThemeProvider>
  );
}

export default App;
