// src/stores/settings-store.ts
import { create } from 'zustand';
import { logger } from '@/lib/logger';
import { GROK_CODE_FAST } from '@/providers/config/model-config';
import { PROVIDER_CONFIGS } from '@/providers/config/provider-config';
import type { TursoClient } from '@/services/database/turso-client';
import { databaseService } from '@/services/database-service';
import { taskStore } from '@/stores/task-store';
import type { ApiKeySettings, CustomProviderApiKeys } from '@/types/api-keys';
import type { ShortcutAction, ShortcutConfig, ShortcutSettings } from '@/types/shortcuts';
import { DEFAULT_SHORTCUTS } from '@/types/shortcuts';

export const DEFAULT_PROJECT = 'default';

// Generate default API key settings from provider configs
function generateDefaultApiKeySettings(): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const providerId of Object.keys(PROVIDER_CONFIGS)) {
    settings[`api_key_${providerId}`] = '';
  }
  return settings;
}

// All settings managed by the store
interface SettingsState {
  // UI Settings
  language: string;
  onboarding_completed: boolean;

  // AI Settings
  model: string;
  assistantId: string;
  is_think: boolean;
  reasoning_effort: string;
  ai_completion_enabled: boolean;
  get_context_tool_model: string;
  is_plan_mode_enabled: boolean;
  is_worktree_mode_enabled: boolean;
  is_ralph_loop_enabled: boolean;
  auto_approve_edits_global: boolean;
  auto_approve_plan_global: boolean;
  auto_code_review_global: boolean;
  hooks_enabled: boolean;
  trace_enabled: boolean;

  // Remote Control
  telegram_remote_enabled: boolean;
  telegram_remote_token: string;
  telegram_remote_allowed_chats: string;
  telegram_remote_poll_timeout: string;
  feishu_remote_enabled: boolean;
  feishu_remote_app_id: string;
  feishu_remote_app_secret: string;
  feishu_remote_encrypt_key: string;
  feishu_remote_verification_token: string;
  feishu_remote_allowed_open_ids: string;
  remote_control_keep_awake: boolean;

  // Project Settings
  project: string;
  current_root_path: string;

  // Custom Tools
  custom_tools_dir: string;

  // Model Type Settings
  model_type_main: string;
  model_type_small: string;
  model_type_image_generator: string;
  model_type_transcription: string;
  model_type_message_compaction: string;
  model_type_plan: string;
  model_type_code_review: string;

  // API Keys (dynamic based on provider registry)
  apiKeys: ApiKeySettings;

  // MiniMax Cookie (for manual session cookie configuration)
  minimax_cookie: string;

  // Kimi Cookie (for manual token configuration)
  kimi_cookie: string;

  // Shortcuts
  shortcuts: ShortcutSettings;

  // What's New
  last_seen_version: string;

  // UI State
  sidebar_view: string; // 'files' | 'tasks' - current sidebar view

  // Terminal Settings
  terminal_shell: string; // 'auto' | 'pwsh' | 'powershell' | 'cmd' | custom path
  terminal_font: string; // Terminal font family
  terminal_font_size: number; // Terminal font size

  // Worktree Settings
  worktree_root_path: string; // Custom worktree root path (empty = use default ~/.talkcody)

  // LSP Settings
  lsp_enabled: boolean;
  lsp_show_diagnostics: boolean;
  lsp_show_errors: boolean;
  lsp_show_warnings: boolean;
  lsp_show_info: boolean;
  lsp_show_hints: boolean;

  // Prompt Enhancement Settings
  prompt_enhancement_context_enabled: boolean;
  prompt_enhancement_model: string;

  // Internal state
  loading: boolean;
  error: Error | null;
  isInitialized: boolean;
}

interface SettingsActions {
  // Initialization
  initialize: () => Promise<void>;

  // Generic setters
  set: (key: string, value: string) => Promise<void>;
  setBatch: (settings: Record<string, string>) => Promise<void>;
  get: (key: string) => string;
  getBatch: (keys: readonly string[]) => Record<string, string>;

  // UI Settings
  setLanguage: (language: string) => Promise<void>;

  // AI Settings
  setModel: (model: string) => Promise<void>;
  setAssistantId: (assistantId: string) => Promise<void>;
  setIsThink: (isThink: boolean) => Promise<void>;
  setReasoningEffort: (effort: string) => Promise<void>;
  getReasoningEffort: () => string;
  setAICompletionEnabled: (enabled: boolean) => Promise<void>;
  setGetContextToolModel: (model: string) => Promise<void>;
  setPlanModeEnabled: (enabled: boolean) => Promise<void>;
  setWorktreeModeEnabled: (enabled: boolean) => Promise<void>;
  setRalphLoopEnabled: (enabled: boolean) => Promise<void>;
  setAutoApproveEditsGlobal: (enabled: boolean) => Promise<void>;
  setAutoApprovePlanGlobal: (enabled: boolean) => Promise<void>;
  setAutoCodeReviewGlobal: (enabled: boolean) => Promise<void>;
  setHooksEnabled: (enabled: boolean) => Promise<void>;
  setTraceEnabled: (enabled: boolean) => Promise<void>;
  setTelegramRemoteEnabled: (enabled: boolean) => Promise<boolean>;
  setFeishuRemoteEnabled: (enabled: boolean) => Promise<boolean>;
  setFeishuRemoteAppId: (value: string) => Promise<void>;
  setFeishuRemoteAppSecret: (value: string) => Promise<void>;
  setFeishuRemoteEncryptKey: (value: string) => Promise<void>;
  setFeishuRemoteVerificationToken: (value: string) => Promise<void>;
  setFeishuRemoteAllowedOpenIds: (value: string) => Promise<void>;
  getFeishuRemoteAppId: () => string;
  getFeishuRemoteAppSecret: () => string;
  getFeishuRemoteEncryptKey: () => string;
  getFeishuRemoteVerificationToken: () => string;
  getFeishuRemoteAllowedOpenIds: () => string;
  getRemoteControlEnabled: () => boolean;
  getAutoApproveEditsGlobal: () => boolean;
  getAutoApprovePlanGlobal: () => boolean;
  getAutoCodeReviewGlobal: () => boolean;
  getTraceEnabled: () => boolean;

  // Project Settings
  setProject: (project: string) => Promise<void>;
  setCurrentProjectId: (projectId: string) => Promise<void>;
  setCurrentRootPath: (rootPath: string) => void;

  // Custom Tools
  setCustomToolsDir: (path: string) => Promise<void>;
  getCustomToolsDir: () => string;

  // Model Type Settings
  setModelType: (
    type: 'main' | 'small' | 'image_generator' | 'transcription',
    value: string
  ) => Promise<void>;

  // API Keys
  setApiKeys: (apiKeys: ApiKeySettings) => Promise<void>;
  getApiKeys: () => ApiKeySettings;
  setProviderApiKey: (providerId: string, apiKey: string) => Promise<void>;
  getProviderApiKey: (providerId: string) => string | undefined;

  // Base URLs
  setProviderBaseUrl: (providerId: string, baseUrl: string) => Promise<void>;
  getProviderBaseUrl: (providerId: string) => string | undefined;

  // Custom Provider API Keys
  setCustomProviderApiKey: (providerId: string, apiKey: string) => Promise<void>;
  getCustomProviderApiKey: (providerId: string) => string | undefined;
  getCustomProviderApiKeys: () => Promise<CustomProviderApiKeys>;

  // Use Coding Plan
  setProviderUseCodingPlan: (providerId: string, useCodingPlan: boolean) => Promise<void>;
  getProviderUseCodingPlan: (providerId: string) => boolean | undefined;

  // Use International mode
  setProviderUseInternational: (providerId: string, useInternational: boolean) => Promise<void>;
  getProviderUseInternational: (providerId: string) => boolean | undefined;

  // MiniMax Cookie
  setMinimaxCookie: (cookie: string) => Promise<void>;
  getMinimaxCookie: () => string;

  // Kimi Cookie
  setKimiCookie: (cookie: string) => Promise<void>;
  getKimiCookie: () => string;

  // Shortcuts
  getShortcutConfig: (action: ShortcutAction) => ShortcutConfig;
  setShortcutConfig: (action: ShortcutAction, config: ShortcutConfig) => Promise<void>;
  getAllShortcuts: () => ShortcutSettings;
  setAllShortcuts: (shortcuts: ShortcutSettings) => Promise<void>;
  resetShortcutsToDefault: () => Promise<void>;

  // What's New
  setLastSeenVersion: (version: string) => Promise<void>;
  getLastSeenVersion: () => string;

  // Sidebar View
  setSidebarView: (view: string) => Promise<void>;
  getSidebarView: () => string;

  // Terminal Settings
  setTerminalShell: (shell: string) => Promise<void>;
  getTerminalShell: () => string;
  setTerminalFont: (font: string) => Promise<void>;
  getTerminalFont: () => string;
  setTerminalFontSize: (size: number) => Promise<void>;
  getTerminalFontSize: () => number;

  // Worktree Settings
  setWorktreeRootPath: (path: string) => Promise<void>;
  getWorktreeRootPath: () => string;

  // LSP Settings
  setLspEnabled: (enabled: boolean) => Promise<void>;
  getLspEnabled: () => boolean;
  setLspShowDiagnostics: (show: boolean) => Promise<void>;
  getLspShowDiagnostics: () => boolean;
  setLspShowErrors: (show: boolean) => Promise<void>;
  getLspShowErrors: () => boolean;
  setLspShowWarnings: (show: boolean) => Promise<void>;
  getLspShowWarnings: () => boolean;
  setLspShowInfo: (show: boolean) => Promise<void>;
  getLspShowInfo: () => boolean;
  setLspShowHints: (show: boolean) => Promise<void>;
  getLspShowHints: () => boolean;

  // Prompt Enhancement Settings
  setPromptEnhancementContextEnabled: (enabled: boolean) => Promise<void>;
  getPromptEnhancementContextEnabled: () => boolean;
  setPromptEnhancementModel: (model: string) => Promise<void>;
  getPromptEnhancementModel: () => string;

  // Convenience getters
  getModel: () => string;
  getAgentId: () => string;
  getProject: () => string;
  getIsThink: () => boolean;
  getCurrentRootPath: () => string;
  getAICompletionEnabled: () => boolean;
  getPlanModeEnabled: () => boolean;
  getWorktreeModeEnabled: () => boolean;
  getRalphLoopEnabled: () => boolean;
  getHooksEnabled: () => boolean;
}

type SettingsStore = SettingsState & SettingsActions;

// Default settings
const DEFAULT_SETTINGS: Omit<SettingsState, 'loading' | 'error' | 'isInitialized'> = {
  language: 'en',
  onboarding_completed: false,
  model: '',
  assistantId: 'planner',
  is_think: false,
  reasoning_effort: 'medium',
  ai_completion_enabled: false,
  get_context_tool_model: GROK_CODE_FAST,
  is_plan_mode_enabled: false,
  is_worktree_mode_enabled: false,
  is_ralph_loop_enabled: false,
  auto_approve_edits_global: false,
  auto_approve_plan_global: false,
  auto_code_review_global: false,
  hooks_enabled: false,
  trace_enabled: true,
  telegram_remote_enabled: false,
  telegram_remote_token: '',
  telegram_remote_allowed_chats: '',
  telegram_remote_poll_timeout: '25',
  feishu_remote_enabled: false,
  feishu_remote_app_id: '',
  feishu_remote_app_secret: '',
  feishu_remote_encrypt_key: '',
  feishu_remote_verification_token: '',
  feishu_remote_allowed_open_ids: '',
  remote_control_keep_awake: true,
  project: DEFAULT_PROJECT,
  current_root_path: '',
  custom_tools_dir: '',
  model_type_main: '',
  model_type_small: '',
  model_type_image_generator: '',
  model_type_transcription: '',
  model_type_message_compaction: '',
  model_type_plan: '',
  model_type_code_review: '',
  apiKeys: {} as ApiKeySettings,
  minimax_cookie: '',
  kimi_cookie: '',
  shortcuts: DEFAULT_SHORTCUTS,
  last_seen_version: '',
  sidebar_view: 'files',
  terminal_shell: 'auto',
  terminal_font:
    'Menlo, Monaco, "DejaVu Sans Mono", "Ubuntu Mono", "Liberation Mono", "Droid Sans Mono", "Courier New", monospace',
  terminal_font_size: 14,
  worktree_root_path: '',
  lsp_enabled: true,
  lsp_show_diagnostics: true,
  lsp_show_errors: true,
  lsp_show_warnings: true,
  lsp_show_info: true,
  lsp_show_hints: false,
  prompt_enhancement_context_enabled: true,
  prompt_enhancement_model: '',
};

// Database persistence layer
class SettingsDatabase {
  private db: TursoClient | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        await databaseService.initialize();
        this.db = await databaseService.getDb();
        await this.ensureDefaults();
        this.initialized = true;
        logger.info('Settings Database initialized');
      } catch (error) {
        logger.error('Failed to initialize settings database:', error);
        this.initPromise = null;
        throw error;
      }
    })();

    return this.initPromise;
  }

  private async ensureDefaults(): Promise<void> {
    if (!this.db) return;

    const defaultSettings: Record<string, string> = {
      language: 'en',
      agentId: 'planner',
      is_think: 'false',
      project: DEFAULT_PROJECT,
      current_root_path: '',
      custom_tools_dir: '',
      ai_completion_enabled: 'false',
      get_context_tool_model: GROK_CODE_FAST,
      is_plan_mode_enabled: 'false',
      is_worktree_mode_enabled: 'false',
      is_ralph_loop_enabled: 'false',
      auto_approve_edits_global: 'false',
      auto_approve_plan_global: 'false',
      auto_code_review_global: 'false',
      hooks_enabled: 'false',
      trace_enabled: 'true',
      telegram_remote_enabled: 'false',
      telegram_remote_token: '',
      telegram_remote_allowed_chats: '',
      telegram_remote_poll_timeout: '25',
      feishu_remote_enabled: 'false',
      feishu_remote_app_id: '',
      feishu_remote_app_secret: '',
      feishu_remote_encrypt_key: '',
      feishu_remote_verification_token: '',
      feishu_remote_allowed_open_ids: '',
      remote_control_keep_awake: 'true',
      model_type_main: '',
      model_type_small: '',
      model_type_image_generator: '',
      model_type_transcription: '',
      model_type_message_compaction: '',
      model_type_plan: '',
      model_type_code_review: '',
      onboarding_completed: 'false',
      ...generateDefaultApiKeySettings(),
      shortcut_globalFileSearch: JSON.stringify(DEFAULT_SHORTCUTS.globalFileSearch),
      shortcut_globalContentSearch: JSON.stringify(DEFAULT_SHORTCUTS.globalContentSearch),
      shortcut_fileSearch: JSON.stringify(DEFAULT_SHORTCUTS.fileSearch),
      shortcut_saveFile: JSON.stringify(DEFAULT_SHORTCUTS.saveFile),
      shortcut_openModelSettings: JSON.stringify(DEFAULT_SHORTCUTS.openModelSettings),
      last_seen_version: '',
      sidebar_view: 'files',
      terminal_shell: 'auto',
      terminal_font:
        'Menlo, Monaco, "DejaVu Sans Mono", "Ubuntu Mono", "Liberation Mono", "Droid Sans Mono", "Courier New", monospace',
      terminal_font_size: '14',
      worktree_root_path: '',
      lsp_enabled: 'true',
      lsp_show_diagnostics: 'true',
      lsp_show_errors: 'true',
      lsp_show_warnings: 'true',
      lsp_show_info: 'true',
      lsp_show_hints: 'false',
      prompt_enhancement_context_enabled: 'true',
      prompt_enhancement_model: '',
    };

    const now = Date.now();
    const entries = Object.entries(defaultSettings);

    // Batch insert all defaults in a single query for better performance
    const placeholders = entries
      .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
      .join(', ');
    const values = entries.flatMap(([key, value]) => [key, value, now]);

    await this.db.execute(
      `INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ${placeholders}`,
      values
    );
  }

  async get(key: string): Promise<string> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.select<{ value: string }[]>(
      'SELECT value FROM settings WHERE key = $1',
      [key]
    );

    return result[0]?.value || '';
  }

  async getBatch(keys: readonly string[]): Promise<Record<string, string>> {
    if (!this.db) throw new Error('Database not initialized');

    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const result = await this.db.select<{ key: string; value: string }[]>(
      `SELECT key, value FROM settings WHERE key IN (${placeholders})`,
      [...keys]
    );

    const settingsMap: Record<string, string> = {};
    for (const row of result) {
      settingsMap[row.key] = row.value;
    }

    return settingsMap;
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const now = Date.now();
    await this.db.execute(
      'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ($1, $2, $3)',
      [key, value, now]
    );
  }

  async setBatch(settings: Record<string, string>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const entries = Object.entries(settings);
    const now = Date.now();

    const statements = entries.map(([key, value]) => ({
      sql: 'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ($1, $2, $3)',
      params: [key, value, now],
    }));

    await this.db.batch(statements);
  }
}

const settingsDb = new SettingsDatabase();

// Zustand store
export const useSettingsStore = create<SettingsStore>((set, get) => ({
  // Initial state
  ...DEFAULT_SETTINGS,
  loading: false,
  error: null,
  isInitialized: false,

  // Initialize settings from database
  initialize: async () => {
    const { isInitialized, loading } = get();

    if (isInitialized || loading) {
      return;
    }

    try {
      set({ loading: true, error: null });

      await settingsDb.initialize();

      // Load all settings from database
      const keys = [
        'language',
        'model',
        'assistantId',
        'is_think',
        'ai_completion_enabled',
        'get_context_tool_model',
        'is_plan_mode_enabled',
        'is_worktree_mode_enabled',
        'is_ralph_loop_enabled',
        'auto_approve_edits_global',
        'auto_approve_plan_global',
        'auto_code_review_global',
        'hooks_enabled',
        'trace_enabled',
        'telegram_remote_enabled',
        'telegram_remote_token',
        'telegram_remote_allowed_chats',
        'telegram_remote_poll_timeout',
        'feishu_remote_enabled',
        'feishu_remote_app_id',
        'feishu_remote_app_secret',
        'feishu_remote_encrypt_key',
        'feishu_remote_verification_token',
        'feishu_remote_allowed_open_ids',
        'remote_control_keep_awake',
        'reasoning_effort',
        'project',
        'current_root_path',
        'custom_tools_dir',
        'model_type_main',
        'model_type_small',
        'model_type_image_generator',
        'model_type_transcription',
        'model_type_message_compaction',
        'model_type_plan',
        'model_type_code_review',
        'onboarding_completed',
        'minimax_cookie',
        'kimi_cookie',
        'last_seen_version',
        'sidebar_view',
        'terminal_shell',
        'terminal_font',
        'terminal_font_size',
        'worktree_root_path',
        'lsp_enabled',
        'lsp_show_diagnostics',
        'lsp_show_errors',
        'lsp_show_warnings',
        'lsp_show_info',
        'lsp_show_hints',
        'prompt_enhancement_context_enabled',
        'prompt_enhancement_model',
      ];

      // Add API key keys
      const providerIds = Object.keys(PROVIDER_CONFIGS);
      logger.debug('[initialize] Loading API keys for providers', {
        providerCount: providerIds.length,
        providerIds,
      });
      for (const providerId of providerIds) {
        keys.push(`api_key_${providerId}`);
      }

      // Add shortcut keys
      for (const action of Object.keys(DEFAULT_SHORTCUTS)) {
        keys.push(`shortcut_${action}`);
      }

      const rawSettings = await settingsDb.getBatch(keys);

      // Parse API keys
      const apiKeys: Partial<ApiKeySettings> = {};
      for (const providerId of providerIds) {
        const key = providerId as keyof ApiKeySettings;
        const value = rawSettings[`api_key_${providerId}`];
        apiKeys[key] = value || undefined;
      }
      logger.debug('[initialize] Parsed API keys', {
        apiKeyCount: Object.keys(apiKeys).length,
        keysWithValues: Object.keys(apiKeys).filter((k) => apiKeys[k as keyof ApiKeySettings])
          .length,
      });

      // Parse shortcuts
      const shortcuts: Partial<ShortcutSettings> = {};
      for (const action of Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]) {
        try {
          shortcuts[action] =
            JSON.parse(rawSettings[`shortcut_${action}`] || 'null') || DEFAULT_SHORTCUTS[action];
        } catch {
          shortcuts[action] = DEFAULT_SHORTCUTS[action];
        }
      }

      set({
        language: rawSettings.language || 'en',
        onboarding_completed: rawSettings.onboarding_completed === 'true',
        model: rawSettings.model || '',
        assistantId: rawSettings.assistantId || 'planner',
        is_think: rawSettings.is_think === 'true',
        reasoning_effort: rawSettings.reasoning_effort || 'medium',
        ai_completion_enabled: rawSettings.ai_completion_enabled === 'true',
        get_context_tool_model: rawSettings.get_context_tool_model || GROK_CODE_FAST,
        is_plan_mode_enabled: rawSettings.is_plan_mode_enabled === 'true',
        is_worktree_mode_enabled: rawSettings.is_worktree_mode_enabled === 'true',
        is_ralph_loop_enabled: rawSettings.is_ralph_loop_enabled === 'true',
        auto_approve_edits_global: rawSettings.auto_approve_edits_global === 'true',
        auto_approve_plan_global: rawSettings.auto_approve_plan_global === 'true',
        auto_code_review_global: rawSettings.auto_code_review_global === 'true',
        hooks_enabled: rawSettings.hooks_enabled === 'true',
        trace_enabled: rawSettings.trace_enabled !== 'false',
        telegram_remote_enabled: rawSettings.telegram_remote_enabled === 'true',
        telegram_remote_token: rawSettings.telegram_remote_token || '',
        telegram_remote_allowed_chats: rawSettings.telegram_remote_allowed_chats || '',
        telegram_remote_poll_timeout: rawSettings.telegram_remote_poll_timeout || '25',
        feishu_remote_enabled: rawSettings.feishu_remote_enabled === 'true',
        feishu_remote_app_id: rawSettings.feishu_remote_app_id || '',
        feishu_remote_app_secret: rawSettings.feishu_remote_app_secret || '',
        feishu_remote_encrypt_key: rawSettings.feishu_remote_encrypt_key || '',
        feishu_remote_verification_token: rawSettings.feishu_remote_verification_token || '',
        feishu_remote_allowed_open_ids: rawSettings.feishu_remote_allowed_open_ids || '',
        remote_control_keep_awake: rawSettings.remote_control_keep_awake !== 'false',
        project: rawSettings.project || DEFAULT_PROJECT,
        current_root_path: rawSettings.current_root_path || '',
        custom_tools_dir: rawSettings.custom_tools_dir || '',
        model_type_main: rawSettings.model_type_main || '',
        model_type_small: rawSettings.model_type_small || '',
        model_type_image_generator: rawSettings.model_type_image_generator || '',
        model_type_transcription: rawSettings.model_type_transcription || '',
        model_type_message_compaction: rawSettings.model_type_message_compaction || '',
        model_type_plan: rawSettings.model_type_plan || '',
        model_type_code_review: rawSettings.model_type_code_review || '',
        apiKeys: apiKeys as ApiKeySettings,
        minimax_cookie: rawSettings.minimax_cookie || '',
        kimi_cookie: rawSettings.kimi_cookie || '',
        shortcuts: shortcuts as ShortcutSettings,
        last_seen_version: rawSettings.last_seen_version || '',
        sidebar_view: rawSettings.sidebar_view || 'files',
        terminal_shell: rawSettings.terminal_shell || 'auto',
        terminal_font:
          rawSettings.terminal_font ||
          'Menlo, Monaco, "DejaVu Sans Mono", "Ubuntu Mono", "Liberation Mono", "Droid Sans Mono", "Courier New", monospace',
        terminal_font_size: Number(rawSettings.terminal_font_size) || 14,
        worktree_root_path: rawSettings.worktree_root_path || '',
        lsp_enabled: rawSettings.lsp_enabled !== 'false',
        lsp_show_diagnostics: rawSettings.lsp_show_diagnostics !== 'false',
        lsp_show_errors: rawSettings.lsp_show_errors !== 'false',
        lsp_show_warnings: rawSettings.lsp_show_warnings !== 'false',
        lsp_show_info: rawSettings.lsp_show_info !== 'false',
        lsp_show_hints: rawSettings.lsp_show_hints === 'true',
        prompt_enhancement_context_enabled:
          rawSettings.prompt_enhancement_context_enabled !== 'false',
        prompt_enhancement_model: rawSettings.prompt_enhancement_model || '',
        loading: false,
        isInitialized: true,
      });

      logger.info('Settings store initialized');
    } catch (error) {
      logger.error('Failed to initialize settings store:', error);
      set({
        error: error as Error,
        loading: false,
        isInitialized: true,
      });
    }
  },

  // Generic setters
  set: async (key: string, value: string) => {
    await settingsDb.set(key, value);
    // Update store if it's a tracked key
    const state = get();
    if (key in state) {
      set({ [key]: value } as Partial<SettingsState>);
    }
  },

  setBatch: async (settings: Record<string, string>) => {
    await settingsDb.setBatch(settings);
    // Update store for tracked keys
    const updates: Partial<SettingsState> = {};
    const state = get();
    for (const [key, value] of Object.entries(settings)) {
      if (key in state) {
        updates[key as keyof SettingsState] = value as never;
      }
    }
    if (Object.keys(updates).length > 0) {
      set(updates);
    }
  },

  get: (key: string) => {
    const state = get() as unknown as Record<string, unknown>;
    return (state[key] as string) || '';
  },

  getBatch: (keys: readonly string[]) => {
    const state = get() as unknown as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const key of keys) {
      result[key] = (state[key] as string) || '';
    }
    return result;
  },

  // UI Settings
  setLanguage: async (language: string) => {
    await settingsDb.set('language', language);
    set({ language });
  },

  // AI Settings
  setModel: async (model: string) => {
    await settingsDb.set('model', model);
    set({ model });
  },

  setAssistantId: async (assistantId: string) => {
    await settingsDb.set('assistantId', assistantId);
    set({ assistantId });
  },

  setIsThink: async (isThink: boolean) => {
    await settingsDb.set('is_think', isThink.toString());
    set({ is_think: isThink });
  },

  setReasoningEffort: async (effort: string) => {
    await settingsDb.set('reasoning_effort', effort);
    set({ reasoning_effort: effort });
  },

  setAICompletionEnabled: async (enabled: boolean) => {
    await settingsDb.set('ai_completion_enabled', enabled.toString());
    set({ ai_completion_enabled: enabled });
  },

  setGetContextToolModel: async (model: string) => {
    await settingsDb.set('get_context_tool_model', model);
    set({ get_context_tool_model: model });
  },

  setPlanModeEnabled: async (enabled: boolean) => {
    await settingsDb.set('is_plan_mode_enabled', enabled.toString());
    set({ is_plan_mode_enabled: enabled });
  },

  setWorktreeModeEnabled: async (enabled: boolean) => {
    await settingsDb.set('is_worktree_mode_enabled', enabled.toString());
    set({ is_worktree_mode_enabled: enabled });
  },

  setRalphLoopEnabled: async (enabled: boolean) => {
    await settingsDb.set('is_ralph_loop_enabled', enabled.toString());
    set({ is_ralph_loop_enabled: enabled });
  },

  setAutoApproveEditsGlobal: async (enabled: boolean) => {
    await settingsDb.set('auto_approve_edits_global', enabled.toString());
    set({ auto_approve_edits_global: enabled });
  },

  setAutoApprovePlanGlobal: async (enabled: boolean) => {
    await settingsDb.set('auto_approve_plan_global', enabled.toString());
    set({ auto_approve_plan_global: enabled });
  },

  setAutoCodeReviewGlobal: async (enabled: boolean) => {
    await settingsDb.set('auto_code_review_global', enabled.toString());
    set({ auto_code_review_global: enabled });
  },

  setHooksEnabled: async (enabled: boolean) => {
    await settingsDb.set('hooks_enabled', enabled.toString());
    set({ hooks_enabled: enabled });
  },

  setTraceEnabled: async (enabled: boolean) => {
    await settingsDb.set('trace_enabled', enabled.toString());
    set({ trace_enabled: enabled });
  },
  setTelegramRemoteEnabled: async (enabled: boolean) => {
    await settingsDb.set('telegram_remote_enabled', enabled.toString());
    const updated = { ...get(), telegram_remote_enabled: enabled };
    set({ telegram_remote_enabled: enabled });
    return updated.telegram_remote_enabled || updated.feishu_remote_enabled;
  },

  setFeishuRemoteEnabled: async (enabled: boolean) => {
    await settingsDb.set('feishu_remote_enabled', enabled.toString());
    const updated = { ...get(), feishu_remote_enabled: enabled };
    set({ feishu_remote_enabled: enabled });
    return updated.telegram_remote_enabled || updated.feishu_remote_enabled;
  },

  setFeishuRemoteAppId: async (value: string) => {
    await settingsDb.set('feishu_remote_app_id', value);
    set({ feishu_remote_app_id: value });
  },

  setFeishuRemoteAppSecret: async (value: string) => {
    await settingsDb.set('feishu_remote_app_secret', value);
    set({ feishu_remote_app_secret: value });
  },

  setFeishuRemoteEncryptKey: async (value: string) => {
    await settingsDb.set('feishu_remote_encrypt_key', value);
    set({ feishu_remote_encrypt_key: value });
  },

  setFeishuRemoteVerificationToken: async (value: string) => {
    await settingsDb.set('feishu_remote_verification_token', value);
    set({ feishu_remote_verification_token: value });
  },

  setFeishuRemoteAllowedOpenIds: async (value: string) => {
    await settingsDb.set('feishu_remote_allowed_open_ids', value);
    set({ feishu_remote_allowed_open_ids: value });
  },

  getFeishuRemoteAppId: () => {
    return get().feishu_remote_app_id;
  },

  getFeishuRemoteAppSecret: () => {
    return get().feishu_remote_app_secret;
  },

  getFeishuRemoteEncryptKey: () => {
    return get().feishu_remote_encrypt_key;
  },

  getFeishuRemoteVerificationToken: () => {
    return get().feishu_remote_verification_token;
  },

  getFeishuRemoteAllowedOpenIds: () => {
    return get().feishu_remote_allowed_open_ids;
  },

  getRemoteControlEnabled: () => {
    const state = get();
    return state.telegram_remote_enabled || state.feishu_remote_enabled;
  },

  // Project Settings
  setProject: async (project: string) => {
    await settingsDb.set('project', project);
    set({ project });
  },

  setCurrentProjectId: async (projectId: string) => {
    const currentProject = get().project;
    await settingsDb.set('project', projectId);
    set({ project: projectId });
    if (currentProject !== projectId) {
      taskStore.getState().setCurrentTaskId(null);
    }
  },

  setCurrentRootPath: (rootPath: string) => {
    set({ current_root_path: rootPath });
    settingsDb.set('current_root_path', rootPath).catch((error) => {
      logger.error('Failed to persist current_root_path:', error);
    });
  },

  // Custom Tools
  setCustomToolsDir: async (path: string) => {
    await settingsDb.set('custom_tools_dir', path);
    set({ custom_tools_dir: path });
  },

  getCustomToolsDir: () => {
    return get().custom_tools_dir || '';
  },

  // Model Type Settings
  setModelType: async (
    type:
      | 'main'
      | 'small'
      | 'image_generator'
      | 'transcription'
      | 'message_compaction'
      | 'plan'
      | 'code_review',
    value: string
  ) => {
    const key = `model_type_${type}`;
    await settingsDb.set(key, value);
    set({ [key]: value } as Partial<SettingsState>);
  },

  // API Keys
  setApiKeys: async (apiKeys: ApiKeySettings) => {
    const settingsToUpdate: Record<string, string> = {};

    logger.info('[setApiKeys] Starting API key update', {
      keysToUpdate: Object.keys(apiKeys),
      keysDetail: Object.keys(apiKeys).map((k) => ({
        key: k,
        hasValue: !!apiKeys[k as keyof ApiKeySettings],
      })),
    });

    for (const providerId of Object.keys(PROVIDER_CONFIGS)) {
      const key = providerId as keyof ApiKeySettings;
      if (apiKeys[key] !== undefined) {
        settingsToUpdate[`api_key_${providerId}`] = apiKeys[key] as string;
      }
    }

    logger.info('[setApiKeys] Database keys to update', {
      dbKeys: Object.keys(settingsToUpdate),
    });

    if (Object.keys(settingsToUpdate).length > 0) {
      await settingsDb.setBatch(settingsToUpdate);
      logger.info('[setApiKeys] Database update completed');

      // Merge with existing API keys to avoid overwriting other providers
      const currentApiKeys = get().apiKeys;
      const mergedApiKeys = { ...currentApiKeys, ...apiKeys };

      logger.info('[setApiKeys] Updated API keys in store', {
        providersUpdated: Object.keys(settingsToUpdate).map((k) => k.replace('api_key_', '')),
        totalProviders: Object.keys(mergedApiKeys).filter(
          (k) => mergedApiKeys[k as keyof ApiKeySettings]
        ).length,
        mergedApiKeysStructure: Object.keys(mergedApiKeys).map((k) => ({
          key: k,
          hasValue: !!mergedApiKeys[k as keyof ApiKeySettings],
        })),
      });

      set({ apiKeys: mergedApiKeys });
      logger.info('[setApiKeys] Store updated successfully');
    }
  },

  getApiKeys: () => {
    const apiKeys = get().apiKeys;
    logger.debug('[getApiKeys] Retrieved API keys from store', {
      totalKeys: Object.keys(apiKeys).length,
      keysWithValues: Object.keys(apiKeys).filter((k) => apiKeys[k as keyof ApiKeySettings]).length,
      keyStructure: Object.keys(apiKeys).map((k) => ({
        key: k,
        hasValue: !!apiKeys[k as keyof ApiKeySettings],
      })),
    });
    return apiKeys;
  },

  setProviderApiKey: async (providerId: string, apiKey: string) => {
    await settingsDb.set(`api_key_${providerId}`, apiKey);
    const state = get();
    const newApiKeys = { ...state.apiKeys };
    newApiKeys[providerId as keyof ApiKeySettings] = apiKey as never;

    logger.info('Updated provider API key', {
      provider: providerId,
      hasKey: !!apiKey,
    });

    set({ apiKeys: newApiKeys });
  },

  getProviderApiKey: (providerId: string) => {
    const state = get();
    return state.apiKeys[providerId as keyof ApiKeySettings] as string | undefined;
  },

  // Base URLs
  setProviderBaseUrl: async (providerId: string, baseUrl: string) => {
    await settingsDb.set(`base_url_${providerId}`, baseUrl);
    logger.info('Updated provider base URL', {
      provider: providerId,
      hasBaseUrl: !!baseUrl,
    });
  },

  getProviderBaseUrl: (_providerId: string) => {
    // We need to get this from the database directly since we don't cache it in state
    // For now, we'll return empty string and let the component handle async loading
    return undefined;
  },

  // Custom Provider API Keys
  setCustomProviderApiKey: async (providerId: string, apiKey: string) => {
    await settingsDb.set(`custom_api_key_${providerId}`, apiKey);
    logger.info('Updated custom provider API key', {
      provider: providerId,
      hasKey: !!apiKey,
    });
  },

  getCustomProviderApiKey: (_providerId: string) => {
    // We need to get this from the database directly since we don't cache it in state
    // For now, we'll return undefined and let the component handle async loading
    return undefined;
  },

  getCustomProviderApiKeys: async () => {
    // Get custom provider configurations and extract API keys
    try {
      const { customProviderService } = await import('@/providers/custom/custom-provider-service');
      const config = await customProviderService.getCustomProviders();

      const apiKeys: CustomProviderApiKeys = {};
      for (const [providerId, providerConfig] of Object.entries(config.providers)) {
        if (providerConfig.apiKey) {
          apiKeys[providerId] = providerConfig.apiKey;
        }
      }

      return apiKeys;
    } catch (error) {
      logger.warn('Failed to get custom provider API keys:', error);
      return {};
    }
  },

  // Use Coding Plan
  setProviderUseCodingPlan: async (providerId: string, useCodingPlan: boolean) => {
    await settingsDb.set(`use_coding_plan_${providerId}`, useCodingPlan.toString());
    logger.info('Updated provider use coding plan', {
      provider: providerId,
      useCodingPlan,
    });
  },

  getProviderUseCodingPlan: (_providerId: string) => {
    // We need to get this from the database directly since we don't cache it in state
    // For now, we'll return undefined and let the component handle async loading
    return undefined;
  },

  // Use International mode
  setProviderUseInternational: async (providerId: string, useInternational: boolean) => {
    await settingsDb.set(`use_international_${providerId}`, useInternational.toString());
    logger.info('Updated provider use international', {
      provider: providerId,
      useInternational,
    });
  },

  getProviderUseInternational: (_providerId: string) => {
    // We need to get this from the database directly since we don't cache it in state
    // For now, we'll return undefined and let the component handle async loading
    return undefined;
  },

  // Shortcuts
  getShortcutConfig: (action: ShortcutAction) => {
    const state = get();
    return state.shortcuts[action];
  },

  setShortcutConfig: async (action: ShortcutAction, config: ShortcutConfig) => {
    const settingKey = `shortcut_${action}`;
    await settingsDb.set(settingKey, JSON.stringify(config));
    const state = get();
    const newShortcuts = { ...state.shortcuts };
    newShortcuts[action] = config;
    set({ shortcuts: newShortcuts });
  },

  getAllShortcuts: () => {
    return get().shortcuts;
  },

  setAllShortcuts: async (shortcuts: ShortcutSettings) => {
    const settingsToUpdate: Record<string, string> = {};

    for (const [action, config] of Object.entries(shortcuts)) {
      const settingKey = `shortcut_${action}`;
      settingsToUpdate[settingKey] = JSON.stringify(config);
    }

    await settingsDb.setBatch(settingsToUpdate);
    set({ shortcuts });
  },

  resetShortcutsToDefault: async () => {
    await get().setAllShortcuts(DEFAULT_SHORTCUTS);
  },

  // What's New
  setLastSeenVersion: async (version: string) => {
    await settingsDb.set('last_seen_version', version);
    set({ last_seen_version: version });
  },

  getLastSeenVersion: () => {
    return get().last_seen_version;
  },

  // Sidebar View
  setSidebarView: async (view: string) => {
    await settingsDb.set('sidebar_view', view);
    set({ sidebar_view: view });
  },

  getSidebarView: () => {
    return get().sidebar_view || 'files';
  },

  // Terminal Settings
  setTerminalShell: async (shell: string) => {
    await settingsDb.set('terminal_shell', shell);
    set({ terminal_shell: shell });
  },

  getTerminalShell: () => {
    return get().terminal_shell || 'auto';
  },

  setTerminalFont: async (font: string) => {
    await settingsDb.set('terminal_font', font);
    set({ terminal_font: font });
  },

  getTerminalFont: () => {
    return (
      get().terminal_font ||
      'Menlo, Monaco, "DejaVu Sans Mono", "Ubuntu Mono", "Liberation Mono", "Droid Sans Mono", "Courier New", monospace'
    );
  },

  setTerminalFontSize: async (size: number) => {
    await settingsDb.set('terminal_font_size', size.toString());
    set({ terminal_font_size: size });
  },

  getTerminalFontSize: () => {
    return get().terminal_font_size || 14;
  },

  // MiniMax Cookie
  setMinimaxCookie: async (cookie: string) => {
    await settingsDb.set('minimax_cookie', cookie);
    set({ minimax_cookie: cookie });
  },

  getMinimaxCookie: () => {
    return get().minimax_cookie || '';
  },

  // Kimi Cookie
  setKimiCookie: async (cookie: string) => {
    await settingsDb.set('kimi_cookie', cookie);
    set({ kimi_cookie: cookie });
  },

  getKimiCookie: () => {
    return get().kimi_cookie || '';
  },

  // Worktree Settings
  setWorktreeRootPath: async (path: string) => {
    await settingsDb.set('worktree_root_path', path);
    set({ worktree_root_path: path });
  },

  getWorktreeRootPath: () => {
    return get().worktree_root_path || '';
  },

  // LSP Settings
  setLspEnabled: async (enabled: boolean) => {
    await settingsDb.set('lsp_enabled', enabled.toString());
    set({ lsp_enabled: enabled });
  },

  getLspEnabled: () => {
    return get().lsp_enabled;
  },

  setLspShowDiagnostics: async (show: boolean) => {
    await settingsDb.set('lsp_show_diagnostics', show.toString());
    set({ lsp_show_diagnostics: show });
  },

  getLspShowDiagnostics: () => {
    return get().lsp_show_diagnostics;
  },

  setLspShowErrors: async (show: boolean) => {
    await settingsDb.set('lsp_show_errors', show.toString());
    set({ lsp_show_errors: show });
  },

  getLspShowErrors: () => {
    return get().lsp_show_errors;
  },

  setLspShowWarnings: async (show: boolean) => {
    await settingsDb.set('lsp_show_warnings', show.toString());
    set({ lsp_show_warnings: show });
  },

  getLspShowWarnings: () => {
    return get().lsp_show_warnings;
  },

  setLspShowInfo: async (show: boolean) => {
    await settingsDb.set('lsp_show_info', show.toString());
    set({ lsp_show_info: show });
  },

  getLspShowInfo: () => {
    return get().lsp_show_info;
  },

  setLspShowHints: async (show: boolean) => {
    await settingsDb.set('lsp_show_hints', show.toString());
    set({ lsp_show_hints: show });
  },

  getLspShowHints: () => {
    return get().lsp_show_hints;
  },

  // Prompt Enhancement Settings
  setPromptEnhancementContextEnabled: async (enabled: boolean) => {
    await settingsDb.set('prompt_enhancement_context_enabled', enabled.toString());
    set({ prompt_enhancement_context_enabled: enabled });
  },

  getPromptEnhancementContextEnabled: () => {
    return get().prompt_enhancement_context_enabled;
  },

  setPromptEnhancementModel: async (model: string) => {
    await settingsDb.set('prompt_enhancement_model', model);
    set({ prompt_enhancement_model: model });
  },

  getPromptEnhancementModel: () => {
    return get().prompt_enhancement_model || '';
  },

  // Convenience getters
  getModel: () => {
    return get().model;
  },

  getAgentId: () => {
    return get().assistantId;
  },

  getProject: () => {
    return get().project;
  },

  getIsThink: () => {
    return get().is_think;
  },

  getReasoningEffort: () => {
    return get().reasoning_effort || 'medium';
  },

  getCurrentRootPath: () => {
    return get().current_root_path;
  },

  getAICompletionEnabled: () => {
    return get().ai_completion_enabled;
  },

  getPlanModeEnabled: () => {
    return get().is_plan_mode_enabled;
  },

  getWorktreeModeEnabled: () => {
    return get().is_worktree_mode_enabled;
  },

  getRalphLoopEnabled: () => {
    return get().is_ralph_loop_enabled;
  },

  getAutoApproveEditsGlobal: () => {
    return get().auto_approve_edits_global;
  },

  getAutoApprovePlanGlobal: () => {
    return get().auto_approve_plan_global;
  },

  getAutoCodeReviewGlobal: () => {
    return get().auto_code_review_global;
  },

  getHooksEnabled: () => {
    return get().hooks_enabled;
  },

  getTraceEnabled: () => {
    return get().trace_enabled;
  },
}));

// Export singleton for non-React usage (backward compatibility)
export const settingsManager = {
  initialize: () => useSettingsStore.getState().initialize(),
  get: (key: string) => useSettingsStore.getState().get(key),
  getBatch: (keys: readonly string[]) => useSettingsStore.getState().getBatch(keys),
  set: (key: string, value: string) => useSettingsStore.getState().set(key, value),
  setBatch: (settings: Record<string, string>) => useSettingsStore.getState().setBatch(settings),
  getSync: (key: string) => useSettingsStore.getState().get(key),
  getBatchSync: (keys: readonly string[]) => useSettingsStore.getState().getBatch(keys),

  // Convenience methods
  setModel: (model: string) => useSettingsStore.getState().setModel(model),
  setModelType: (type: 'main' | 'small' | 'image_generator' | 'transcription', value: string) =>
    useSettingsStore.getState().setModelType(type, value),
  setAssistant: (assistantId: string) => useSettingsStore.getState().setAssistantId(assistantId),
  setApiKey: (apiKey: string) => useSettingsStore.getState().set('apiKey', apiKey),
  setProject: (project: string) => useSettingsStore.getState().setProject(project),
  setIsThink: (isThink: boolean) => useSettingsStore.getState().setIsThink(isThink),
  setReasoningEffort: (effort: string) => useSettingsStore.getState().setReasoningEffort(effort),
  getReasoningEffort: () => useSettingsStore.getState().getReasoningEffort(),
  setCurrentRootPath: (rootPath: string) =>
    useSettingsStore.getState().setCurrentRootPath(rootPath),
  setCurrentProjectId: (projectId: string) =>
    useSettingsStore.getState().setCurrentProjectId(projectId),
  setAICompletionEnabled: (enabled: boolean) =>
    useSettingsStore.getState().setAICompletionEnabled(enabled),
  setPlanModeEnabled: (enabled: boolean) => useSettingsStore.getState().setPlanModeEnabled(enabled),
  setWorktreeModeEnabled: (enabled: boolean) =>
    useSettingsStore.getState().setWorktreeModeEnabled(enabled),
  setRalphLoopEnabled: (enabled: boolean) =>
    useSettingsStore.getState().setRalphLoopEnabled(enabled),
  setAutoApproveEditsGlobal: (enabled: boolean) =>
    useSettingsStore.getState().setAutoApproveEditsGlobal(enabled),
  setAutoApprovePlanGlobal: (enabled: boolean) =>
    useSettingsStore.getState().setAutoApprovePlanGlobal(enabled),
  setAutoCodeReviewGlobal: (enabled: boolean) =>
    useSettingsStore.getState().setAutoCodeReviewGlobal(enabled),
  setHooksEnabled: (enabled: boolean) => useSettingsStore.getState().setHooksEnabled(enabled),
  setTraceEnabled: (enabled: boolean) => useSettingsStore.getState().setTraceEnabled(enabled),
  setTelegramRemoteEnabled: (enabled: boolean) =>
    useSettingsStore.getState().setTelegramRemoteEnabled(enabled),
  setFeishuRemoteEnabled: (enabled: boolean) =>
    useSettingsStore.getState().setFeishuRemoteEnabled(enabled),
  setFeishuRemoteAppId: (value: string) => useSettingsStore.getState().setFeishuRemoteAppId(value),
  setFeishuRemoteAppSecret: (value: string) =>
    useSettingsStore.getState().setFeishuRemoteAppSecret(value),
  setFeishuRemoteEncryptKey: (value: string) =>
    useSettingsStore.getState().setFeishuRemoteEncryptKey(value),
  setFeishuRemoteVerificationToken: (value: string) =>
    useSettingsStore.getState().setFeishuRemoteVerificationToken(value),
  setFeishuRemoteAllowedOpenIds: (value: string) =>
    useSettingsStore.getState().setFeishuRemoteAllowedOpenIds(value),
  getFeishuRemoteAppId: () => useSettingsStore.getState().getFeishuRemoteAppId(),
  getFeishuRemoteAppSecret: () => useSettingsStore.getState().getFeishuRemoteAppSecret(),
  getFeishuRemoteEncryptKey: () => useSettingsStore.getState().getFeishuRemoteEncryptKey(),
  getFeishuRemoteVerificationToken: () =>
    useSettingsStore.getState().getFeishuRemoteVerificationToken(),
  getFeishuRemoteAllowedOpenIds: () => useSettingsStore.getState().getFeishuRemoteAllowedOpenIds(),
  getRemoteControlEnabled: () => useSettingsStore.getState().getRemoteControlEnabled(),
  setCustomToolsDir: (path: string) => useSettingsStore.getState().setCustomToolsDir(path),

  getModel: () => useSettingsStore.getState().getModel(),
  getAgentId: () => useSettingsStore.getState().getAgentId(),
  getProject: () => useSettingsStore.getState().getProject(),
  getIsThink: () => useSettingsStore.getState().getIsThink(),
  getCurrentRootPath: () => useSettingsStore.getState().getCurrentRootPath(),
  getCustomToolsDir: () => useSettingsStore.getState().getCustomToolsDir(),
  getAICompletionEnabled: () => useSettingsStore.getState().getAICompletionEnabled(),
  getPlanModeEnabled: () => useSettingsStore.getState().getPlanModeEnabled(),
  getWorktreeModeEnabled: () => useSettingsStore.getState().getWorktreeModeEnabled(),
  getRalphLoopEnabled: () => useSettingsStore.getState().getRalphLoopEnabled(),
  getAutoApproveEditsGlobal: () => useSettingsStore.getState().getAutoApproveEditsGlobal(),
  getAutoApprovePlanGlobal: () => useSettingsStore.getState().getAutoApprovePlanGlobal(),
  getAutoCodeReviewGlobal: () => useSettingsStore.getState().getAutoCodeReviewGlobal(),
  getHooksEnabled: () => useSettingsStore.getState().getHooksEnabled(),
  getTraceEnabled: () => useSettingsStore.getState().getTraceEnabled(),

  // Prompt Enhancement
  setPromptEnhancementContextEnabled: (enabled: boolean) =>
    useSettingsStore.getState().setPromptEnhancementContextEnabled(enabled),
  getPromptEnhancementContextEnabled: () =>
    useSettingsStore.getState().getPromptEnhancementContextEnabled(),
  setPromptEnhancementModel: (model: string) =>
    useSettingsStore.getState().setPromptEnhancementModel(model),
  getPromptEnhancementModel: () => useSettingsStore.getState().getPromptEnhancementModel(),

  // API Keys
  setApiKeys: (apiKeys: ApiKeySettings) => useSettingsStore.getState().setApiKeys(apiKeys),
  getApiKeys: () => useSettingsStore.getState().getApiKeys(),
  getApiKeysSync: () => useSettingsStore.getState().getApiKeys(),
  setProviderApiKey: (providerId: string, apiKey: string) =>
    useSettingsStore.getState().setProviderApiKey(providerId, apiKey),
  getProviderApiKey: (providerId: string) =>
    useSettingsStore.getState().getProviderApiKey(providerId),
  getProviderApiKeySync: (providerId: string) =>
    useSettingsStore.getState().getProviderApiKey(providerId),

  // Base URLs
  setProviderBaseUrl: (providerId: string, baseUrl: string) =>
    useSettingsStore.getState().setProviderBaseUrl(providerId, baseUrl),
  getProviderBaseUrl: async (providerId: string) => {
    await settingsDb.initialize();
    return settingsDb.get(`base_url_${providerId}`);
  },
  getProviderBaseUrlSync: (providerId: string) => {
    return useSettingsStore.getState().getProviderBaseUrl(providerId);
  },

  // Custom Provider API Keys
  setCustomProviderApiKey: (providerId: string, apiKey: string) =>
    useSettingsStore.getState().setCustomProviderApiKey(providerId, apiKey),
  getCustomProviderApiKey: async (providerId: string) => {
    await settingsDb.initialize();
    return settingsDb.get(`custom_api_key_${providerId}`);
  },
  getCustomProviderApiKeys: () => useSettingsStore.getState().getCustomProviderApiKeys(),

  // Use Coding Plan
  setProviderUseCodingPlan: (providerId: string, useCodingPlan: boolean) =>
    useSettingsStore.getState().setProviderUseCodingPlan(providerId, useCodingPlan),
  getProviderUseCodingPlan: async (providerId: string) => {
    await settingsDb.initialize();
    const value = await settingsDb.get(`use_coding_plan_${providerId}`);
    return value === 'true';
  },
  getProviderUseCodingPlanSync: (providerId: string) => {
    return useSettingsStore.getState().getProviderUseCodingPlan(providerId);
  },

  // Use International mode
  setProviderUseInternational: (providerId: string, useInternational: boolean) =>
    useSettingsStore.getState().setProviderUseInternational(providerId, useInternational),
  getProviderUseInternational: async (providerId: string) => {
    await settingsDb.initialize();
    const value = await settingsDb.get(`use_international_${providerId}`);
    return value === 'true';
  },
  getProviderUseInternationalSync: (providerId: string) => {
    return useSettingsStore.getState().getProviderUseInternational(providerId);
  },

  // Shortcuts
  getShortcutConfig: (action: ShortcutAction) =>
    Promise.resolve(useSettingsStore.getState().getShortcutConfig(action)),
  getShortcutConfigSync: (action: ShortcutAction) =>
    useSettingsStore.getState().getShortcutConfig(action),
  setShortcutConfig: (action: ShortcutAction, config: ShortcutConfig) =>
    useSettingsStore.getState().setShortcutConfig(action, config),
  getAllShortcuts: () => Promise.resolve(useSettingsStore.getState().getAllShortcuts()),
  getAllShortcutsSync: () => useSettingsStore.getState().getAllShortcuts(),
  setAllShortcuts: (shortcuts: ShortcutSettings) =>
    useSettingsStore.getState().setAllShortcuts(shortcuts),
  resetShortcutsToDefault: () => useSettingsStore.getState().resetShortcutsToDefault(),

  // What's New
  setLastSeenVersion: (version: string) => useSettingsStore.getState().setLastSeenVersion(version),
  getLastSeenVersion: () => useSettingsStore.getState().getLastSeenVersion(),

  // Sidebar View
  setSidebarView: (view: string) => useSettingsStore.getState().setSidebarView(view),
  getSidebarView: () => useSettingsStore.getState().getSidebarView(),

  setTerminalShell: (shell: string) => useSettingsStore.getState().setTerminalShell(shell),
  getTerminalShell: () => useSettingsStore.getState().getTerminalShell(),
  setTerminalFont: (font: string) => useSettingsStore.getState().setTerminalFont(font),
  getTerminalFont: () => useSettingsStore.getState().getTerminalFont(),
  setTerminalFontSize: (size: number) => useSettingsStore.getState().setTerminalFontSize(size),
  getTerminalFontSize: () => useSettingsStore.getState().getTerminalFontSize(),

  // MiniMax Cookie
  setMinimaxCookie: (cookie: string) => useSettingsStore.getState().setMinimaxCookie(cookie),
  getMinimaxCookie: () => useSettingsStore.getState().getMinimaxCookie(),

  // Kimi Cookie
  setKimiCookie: (cookie: string) => useSettingsStore.getState().setKimiCookie(cookie),
  getKimiCookie: () => useSettingsStore.getState().getKimiCookie(),

  // Worktree Settings
  setWorktreeRootPath: (path: string) => useSettingsStore.getState().setWorktreeRootPath(path),
  getWorktreeRootPath: () => useSettingsStore.getState().getWorktreeRootPath(),

  // LSP Settings
  setLspEnabled: (enabled: boolean) => useSettingsStore.getState().setLspEnabled(enabled),
  getLspEnabled: () => useSettingsStore.getState().getLspEnabled(),
  setLspShowDiagnostics: (show: boolean) => useSettingsStore.getState().setLspShowDiagnostics(show),
  getLspShowDiagnostics: () => useSettingsStore.getState().getLspShowDiagnostics(),
  setLspShowErrors: (show: boolean) => useSettingsStore.getState().setLspShowErrors(show),
  getLspShowErrors: () => useSettingsStore.getState().getLspShowErrors(),
  setLspShowWarnings: (show: boolean) => useSettingsStore.getState().setLspShowWarnings(show),
  getLspShowWarnings: () => useSettingsStore.getState().getLspShowWarnings(),
  setLspShowInfo: (show: boolean) => useSettingsStore.getState().setLspShowInfo(show),
  getLspShowInfo: () => useSettingsStore.getState().getLspShowInfo(),
  setLspShowHints: (show: boolean) => useSettingsStore.getState().setLspShowHints(show),
  getLspShowHints: () => useSettingsStore.getState().getLspShowHints(),
};

// Export settingsDb for direct database access (used by ThemeProvider before store initialization)
export { settingsDb };
