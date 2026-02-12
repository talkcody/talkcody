// src/services/initialization-manager.ts
import { logger } from '@/lib/logger';
import { useProviderStore } from '@/providers/stores/provider-store';
import { commandRegistry } from '@/services/commands/command-registry';
import { executionService } from '@/services/execution-service';
import { hookSnapshotService } from '@/services/hooks/hook-snapshot-service';
import { terminalService } from '@/services/terminal-service';
import { useAgentStore } from '@/stores/agent-store';
import { useAuthStore } from '@/stores/auth-store';
import { initializeLspSettings } from '@/stores/lsp-store';
import { usePlanModeStore } from '@/stores/plan-mode-store';
import { useRalphLoopStore } from '@/stores/ralph-loop-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSkillsStore } from '@/stores/skills-store';

type InitializationPhase = 'idle' | 'initializing' | 'completed' | 'failed';

/**
 * Initialization Manager
 *
 * Orchestrates application initialization with optimized startup speed.
 * Only critical services block the main UI, non-critical services load in background.
 *
 * Critical Path (blocks UI):
 * - Settings Store (theme, language needed for UI)
 * - Model Store (needed for chat functionality)
 * - Auth Store (needed for user state)
 *
 * Background Loading (non-blocking):
 * - Command Registry
 * - Terminal Service
 * - Agent Store
 * - Skills Store
 * - Plan Mode Store
 */
class InitializationManager {
  private phase: InitializationPhase = 'idle';
  private error: Error | null = null;
  private initPromise: Promise<void> | null = null;
  private nonCriticalInitialized = false;

  /**
   * Initialize application in the correct order
   *
   * @returns Promise that resolves when critical initialization is complete
   */
  async initialize(): Promise<void> {
    // Return existing promise if initialization is in progress
    if (this.initPromise) {
      logger.info('[InitManager] Initialization already in progress, returning existing promise');
      return this.initPromise;
    }

    // Skip if already completed
    if (this.phase === 'completed') {
      logger.info('[InitManager] Already initialized');
      return;
    }

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  /**
   * Internal initialization logic - optimized for fast startup
   */
  private async _doInitialize(): Promise<void> {
    try {
      this.phase = 'initializing';
      const startTime = performance.now();
      logger.info('[InitManager] Starting optimized application initialization...');

      // CRITICAL PATH: Only initialize what's needed for UI to render
      logger.info('[InitManager] Critical path: Settings...');
      const settingsStore = useSettingsStore.getState();
      await settingsStore.initialize();
      logger.info('[InitManager] ✓ Settings initialized');

      // CRITICAL PATH: Load providers and models (needed for chat UI)
      // Auth uses fast init - only checks token, no network request
      logger.info('[InitManager] Critical path: Providers & Auth (fast)...');
      const providerStore = useProviderStore.getState();
      const authStore = useAuthStore.getState();

      await Promise.all([
        providerStore.initialize().then(() => {
          logger.info('[InitManager] ✓ Providers & Models loaded');
        }),
        authStore.initAuthFast().then(() => {
          logger.info('[InitManager] ✓ Auth initialized (fast, no network)');
        }),
      ]);

      this.phase = 'completed';
      const criticalTime = performance.now() - startTime;
      logger.info(
        `[InitManager] ✅ Critical initialization completed in ${criticalTime.toFixed(0)}ms`
      );

      // NON-CRITICAL: Initialize remaining services in background (non-blocking)
      this.initializeNonCritical();
    } catch (error) {
      this.phase = 'failed';
      this.error = error as Error;
      logger.error('[InitManager] ❌ Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Initialize non-critical services in background
   * These don't block the main UI from rendering
   */
  private initializeNonCritical(): void {
    if (this.nonCriticalInitialized) return;
    this.nonCriticalInitialized = true;

    // Use queueMicrotask to defer execution after current task completes
    queueMicrotask(async () => {
      const startTime = performance.now();
      logger.info('[InitManager] Background: Starting non-critical initialization...');

      try {
        // Initialize these services in parallel (they don't depend on each other)
        await Promise.all([
          // Command registry
          commandRegistry.initialize().then(() => {
            logger.info('[InitManager] ✓ Command registry initialized (background)');
          }),

          // Hooks config snapshot
          hookSnapshotService.initializeSession().then(() => {
            logger.info('[InitManager] ✓ Hooks snapshot initialized (background)');
          }),

          // Terminal service
          terminalService.initialize().then(() => {
            logger.info('[InitManager] ✓ Terminal service initialized (background)');
          }),

          // Agent store
          useAgentStore
            .getState()
            .loadAgents()
            .then(() => {
              logger.info('[InitManager] ✓ Agents loaded (background)');
            }),

          // Skills store
          useSkillsStore
            .getState()
            .loadActiveSkills()
            .then(() => {
              logger.info('[InitManager] ✓ Skills loaded (background)');
            }),

          // Plan mode store
          Promise.resolve(usePlanModeStore.getState().initialize()).then(() => {
            logger.info('[InitManager] ✓ Plan mode initialized (background)');
          }),

          // Ralph Loop store
          Promise.resolve(useRalphLoopStore.getState().initialize()).then(() => {
            logger.info('[InitManager] ✓ Ralph Loop initialized (background)');
          }),

          // LSP settings (sync from persisted settings)
          Promise.resolve(initializeLspSettings()).then(() => {
            logger.info('[InitManager] ✓ LSP settings initialized (background)');
          }),

          // Completion hooks (stop hook, ralph loop, auto code review)
          Promise.resolve(executionService.registerCompletionHooks()).then(() => {
            logger.info('[InitManager] ✓ Completion hooks registered (background)');
          }),
        ]);

        const bgTime = performance.now() - startTime;
        logger.info(
          `[InitManager] ✅ Background initialization completed in ${bgTime.toFixed(0)}ms`
        );
      } catch (error) {
        // Non-critical errors don't fail the app, just log them
        logger.error('[InitManager] ⚠️ Background initialization error (non-fatal):', error);
      }
    });
  }

  /**
   * Get current initialization phase
   */
  getPhase(): InitializationPhase {
    return this.phase;
  }

  /**
   * Get initialization error if any
   */
  getError(): Error | null {
    return this.error;
  }

  /**
   * Reset initialization state
   * Useful for testing or manual re-initialization
   */
  reset(): void {
    logger.info('[InitManager] Resetting initialization state');
    this.phase = 'idle';
    this.error = null;
    this.initPromise = null;
  }

  /**
   * Check if initialization is complete
   */
  isInitialized(): boolean {
    return this.phase === 'completed';
  }

  /**
   * Check if initialization is in progress
   */
  isInitializing(): boolean {
    return this.phase === 'initializing';
  }

  /**
   * Check if initialization has failed
   */
  hasFailed(): boolean {
    return this.phase === 'failed';
  }
}

// Export singleton instance
export const initializationManager = new InitializationManager();
