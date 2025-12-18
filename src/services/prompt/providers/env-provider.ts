// src/services/prompt/providers/env-provider.ts

import { join } from '@tauri-apps/api/path';
import { exists } from '@tauri-apps/plugin-fs';
import { arch, platform } from '@tauri-apps/plugin-os';
import { logger } from '@/lib/logger';
import { usePlanModeStore } from '@/stores/plan-mode-store';
import type { PromptContextProvider, ResolveContext } from '@/types/prompt';

/**
 * Detects if the workspace is a git repository
 */
async function detectGitRepo(workspaceRoot: string): Promise<boolean> {
  try {
    const gitDir = await join(workspaceRoot, '.git');
    return await exists(gitDir);
  } catch {
    return false;
  }
}

/**
 * Gets platform information in a readable format
 * Examples: mac_arm, mac_x86, linux, windows
 */
function getPlatformInfo(): string {
  try {
    const osPlatform = platform();
    const osArch = arch();

    if (osPlatform === 'macos') {
      // aarch64 is ARM (M1/M2/M3), x86_64 is Intel
      return osArch === 'aarch64' ? 'mac_arm' : 'mac_x86';
    }

    // For other platforms, just return the platform name
    return osPlatform;
  } catch {
    return 'unknown';
  }
}

/**
 * Gets today's date in YYYY-MM-DD format
 */
function getTodayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const EnvProvider: PromptContextProvider = {
  id: 'env',
  label: 'Environment Context',
  description:
    'Injects environment information including working directory, git status, platform, and date.',
  badges: ['Auto', 'Local'],

  providedTokens() {
    return ['working_directory', 'is_git_repo', 'platform', 'today_date', 'plan_mode'];
  },

  canResolve(token: string) {
    return ['working_directory', 'is_git_repo', 'platform', 'today_date', 'plan_mode'].includes(
      token
    );
  },

  async resolve(token: string, ctx: ResolveContext): Promise<string> {
    // Use cache to avoid repeated expensive operations
    const cacheKey = `env_${token}`;
    const cached = ctx.cache.get(cacheKey);
    if (cached !== undefined) {
      return String(cached);
    }

    let result = '';

    switch (token) {
      case 'working_directory':
        result = ctx.workspaceRoot || '';
        break;

      case 'is_git_repo': {
        const isGit = await detectGitRepo(ctx.workspaceRoot);
        result = isGit ? 'Yes' : 'No';
        break;
      }

      case 'platform':
        result = getPlatformInfo();
        break;

      case 'today_date':
        result = getTodayDate();
        break;

      case 'plan_mode': {
        const isPlanModeEnabled = usePlanModeStore.getState().isPlanModeEnabled;
        result = isPlanModeEnabled ? 'enabled' : 'disabled';
        break;
      }
    }

    ctx.cache.set(cacheKey, result);
    return result;
  },

  injection: {
    enabledByDefault: true,
    placement: 'append',
    sectionTitle: 'Environment Context',
    sectionTemplate(values: Record<string, string>) {
      const sections: string[] = [];

      if (values.working_directory) {
        logger.info('[EnvProvider] Working directory detected:', values.working_directory);
        sections.push(`Working directory: ${values.working_directory}`);
      }

      if (values.is_git_repo) {
        sections.push(`Is directory a git repo: ${values.is_git_repo}`);
      }

      if (values.platform) {
        sections.push(`Platform: ${values.platform}`);
      }

      if (values.today_date) {
        sections.push(`Today's date: ${values.today_date}`);
      }

      if (values.plan_mode) {
        sections.push(`Plan Mode: ${values.plan_mode}`);
      }

      if (sections.length === 0) {
        return '';
      }

      return [
        'IMPORTANT: Here is important information about the environment you are running in:',
        '<env>',
        ...sections,
        '</env>',
      ].join('\n');
    },
  },
};
