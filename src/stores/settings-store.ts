// src/stores/settings-store.ts
import { create } from 'zustand';
import { logger } from '@/lib/logger';
import { GROK_CODE_FAST } from '@/lib/models';
import { providerRegistry } from '@/providers';
import type { TursoClient } from '@/services/database/turso-client';
import { databaseService } from '@/services/database-service';
import type { ApiKeySettings, CustomProviderApiKeys } from '@/types/api-keys';
import type { ShortcutAction, ShortcutConfig, ShortcutSettings } from '@/types/shortcuts';
import { DEFAULT_SHORTCUTS } from '@/types/shortcuts';

export const DEFAULT_PROJECT = 'default';

// Generate default API key settings from provider registry
function generateDefaultApiKeySettings(): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const provider of providerRegistry.getAllProviders()) {
    settings[`api_key_${provider.id}`] = '';
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
  ai_completion_enabled: boolean;
  get_context_tool_model: string;
  is_plan_mode_enabled: boolean;

  // Project Settings
  project: string;
  current_conversationid: string;
  current_root_path: string;

  // Model Type Settings
  model_type_main: string;
  model_type_small: string;
  model_type_image_generator: string;
  model_type_transcription: string;

  // API Keys (dynamic based on provider registry)
  apiKeys: ApiKeySettings;

  // Shortcuts
  shortcuts: ShortcutSettings;

  // What's New
  last_seen_version: string;

  // Terminal Settings
  terminal_shell: string; // 'auto' | 'pwsh' | 'powershell' | 'cmd' | custom path

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
  setAICompletionEnabled: (enabled: boolean) => Promise<void>;
  setGetContextToolModel: (model: string) => Promise<void>;
  setPlanModeEnabled: (enabled: boolean) => Promise<void>;

  // Project Settings
  setProject: (project: string) => Promise<void>;
  setCurrentProjectId: (projectId: string) => Promise<void>;
  setCurrentConversationId: (conversationId: string) => void;
  setCurrentRootPath: (rootPath: string) => void;

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

  // Shortcuts
  getShortcutConfig: (action: ShortcutAction) => ShortcutConfig;
  setShortcutConfig: (action: ShortcutAction, config: ShortcutConfig) => Promise<void>;
  getAllShortcuts: () => ShortcutSettings;
  setAllShortcuts: (shortcuts: ShortcutSettings) => Promise<void>;
  resetShortcutsToDefault: () => Promise<void>;

  // What's New
  setLastSeenVersion: (version: string) => Promise<void>;
  getLastSeenVersion: () => string;

  // Terminal Settings
  setTerminalShell: (shell: string) => Promise<void>;
  getTerminalShell: () => string;

  // Convenience getters
  getModel: () => string;
  getAgentId: () => string;
  getProject: () => string;
  getIsThink: () => boolean;
  getCurrentConversationId: () => string;
  getCurrentRootPath: () => string;
  getAICompletionEnabled: () => boolean;
  getPlanModeEnabled: () => boolean;
}

type SettingsStore = SettingsState & SettingsActions;

// Default settings
const DEFAULT_SETTINGS: Omit<SettingsState, 'loading' | 'error' | 'isInitialized'> = {
  language: 'en',
  onboarding_completed: false,
  model: '',
  assistantId: 'planner',
  is_think: false,
  ai_completion_enabled: false,
  get_context_tool_model: GROK_CODE_FAST,
  is_plan_mode_enabled: false,
  project: DEFAULT_PROJECT,
  current_conversationid: '',
  current_root_path: '',
  model_type_main: '',
  model_type_small: '',
  model_type_image_generator: '',
  model_type_transcription: '',
  apiKeys: {} as ApiKeySettings,
  shortcuts: DEFAULT_SHORTCUTS,
  last_seen_version: '',
  terminal_shell: 'auto',
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
      current_conversationid: '',
      current_root_path: '',
      ai_completion_enabled: 'false',
      get_context_tool_model: GROK_CODE_FAST,
      is_plan_mode_enabled: 'false',
      model_type_main: '',
      model_type_small: '',
      model_type_image_generator: '',
      model_type_transcription: '',
      onboarding_completed: 'false',
      ...generateDefaultApiKeySettings(),
      shortcut_globalFileSearch: JSON.stringify(DEFAULT_SHORTCUTS.globalFileSearch),
      shortcut_globalContentSearch: JSON.stringify(DEFAULT_SHORTCUTS.globalContentSearch),
      shortcut_fileSearch: JSON.stringify(DEFAULT_SHORTCUTS.fileSearch),
      shortcut_saveFile: JSON.stringify(DEFAULT_SHORTCUTS.saveFile),
      shortcut_openModelSettings: JSON.stringify(DEFAULT_SHORTCUTS.openModelSettings),
      last_seen_version: '',
    };

    const now = Date.now();
    for (const [key, value] of Object.entries(defaultSettings)) {
      await this.db.execute(
        'INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ($1, $2, $3)',
        [key, value, now]
      );
    }
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
        'project',
        'current_conversationid',
        'current_root_path',
        'model_type_main',
        'model_type_small',
        'model_type_image_generator',
        'model_type_transcription',
        'onboarding_completed',
        'last_seen_version',
        'terminal_shell',
      ];

      // Add API key keys
      const allProviders = providerRegistry.getAllProviders();
      logger.debug('[initialize] Loading API keys for providers', {
        providerCount: allProviders.length,
        providerIds: allProviders.map((p) => p.id),
      });
      for (const provider of allProviders) {
        keys.push(`api_key_${provider.id}`);
      }

      // Add shortcut keys
      for (const action of Object.keys(DEFAULT_SHORTCUTS)) {
        keys.push(`shortcut_${action}`);
      }

      const rawSettings = await settingsDb.getBatch(keys);

      // Parse API keys
      const apiKeys: Partial<ApiKeySettings> = {};
      for (const provider of allProviders) {
        const key = provider.id as keyof ApiKeySettings;
        const value = rawSettings[`api_key_${provider.id}`];
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
        ai_completion_enabled: rawSettings.ai_completion_enabled === 'true',
        get_context_tool_model: rawSettings.get_context_tool_model || GROK_CODE_FAST,
        is_plan_mode_enabled: rawSettings.is_plan_mode_enabled === 'true',
        project: rawSettings.project || DEFAULT_PROJECT,
        current_conversationid: rawSettings.current_conversationid || '',
        current_root_path: rawSettings.current_root_path || '',
        model_type_main: rawSettings.model_type_main || '',
        model_type_small: rawSettings.model_type_small || '',
        model_type_image_generator: rawSettings.model_type_image_generator || '',
        model_type_transcription: rawSettings.model_type_transcription || '',
        apiKeys: apiKeys as ApiKeySettings,
        shortcuts: shortcuts as ShortcutSettings,
        last_seen_version: rawSettings.last_seen_version || '',
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

  // Project Settings
  setProject: async (project: string) => {
    await settingsDb.set('project', project);
    set({ project });
  },

  setCurrentProjectId: async (projectId: string) => {
    await settingsDb.set('project', projectId);
    set({ project: projectId });
  },

  setCurrentConversationId: (conversationId: string) => {
    set({ current_conversationid: conversationId });
    settingsDb.set('current_conversationid', conversationId).catch((error) => {
      logger.error('Failed to persist current_conversationid:', error);
    });
  },

  setCurrentRootPath: (rootPath: string) => {
    set({ current_root_path: rootPath });
    settingsDb.set('current_root_path', rootPath).catch((error) => {
      logger.error('Failed to persist current_root_path:', error);
    });
  },

  // Model Type Settings
  setModelType: async (
    type: 'main' | 'small' | 'image_generator' | 'transcription',
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

    for (const provider of providerRegistry.getAllProviders()) {
      const key = provider.id as keyof ApiKeySettings;
      if (apiKeys[key] !== undefined) {
        settingsToUpdate[`api_key_${provider.id}`] = apiKeys[key] as string;
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

  getCustomProviderApiKey: (providerId: string) => {
    // We need to get this from the database directly since we don't cache it in state
    // For now, we'll return undefined and let the component handle async loading
    return undefined;
  },

  getCustomProviderApiKeys: async () => {
    // Get custom provider configurations and extract API keys
    try {
      const { customProviderService } = await import('@/services/custom-provider-service');
      const config = await customProviderService.getCustomProviders();

      const apiKeys: CustomProviderApiKeys = {};
      for (const [providerId, provider] of Object.entries(config.providers)) {
        if (provider.apiKey) {
          apiKeys[providerId] = provider.apiKey;
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

  // Terminal Settings
  setTerminalShell: async (shell: string) => {
    await settingsDb.set('terminal_shell', shell);
    set({ terminal_shell: shell });
  },

  getTerminalShell: () => {
    return get().terminal_shell || 'auto';
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

  getCurrentConversationId: () => {
    return get().current_conversationid;
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
  setAssistant: (assistantId: string) => useSettingsStore.getState().setAssistantId(assistantId),
  setApiKey: (apiKey: string) => useSettingsStore.getState().set('apiKey', apiKey),
  setProject: (project: string) => useSettingsStore.getState().setProject(project),
  setIsThink: (isThink: boolean) => useSettingsStore.getState().setIsThink(isThink),
  setCurrentConversationId: (conversationId: string) =>
    useSettingsStore.getState().setCurrentConversationId(conversationId),
  setCurrentRootPath: (rootPath: string) =>
    useSettingsStore.getState().setCurrentRootPath(rootPath),
  setCurrentProjectId: (projectId: string) =>
    useSettingsStore.getState().setCurrentProjectId(projectId),
  setAICompletionEnabled: (enabled: boolean) =>
    useSettingsStore.getState().setAICompletionEnabled(enabled),
  setPlanModeEnabled: (enabled: boolean) => useSettingsStore.getState().setPlanModeEnabled(enabled),

  getModel: () => useSettingsStore.getState().getModel(),
  getAgentId: () => useSettingsStore.getState().getAgentId(),
  getProject: () => useSettingsStore.getState().getProject(),
  getIsThink: () => useSettingsStore.getState().getIsThink(),
  getCurrentConversationId: () => useSettingsStore.getState().getCurrentConversationId(),
  getCurrentRootPath: () => useSettingsStore.getState().getCurrentRootPath(),
  getAICompletionEnabled: () => useSettingsStore.getState().getAICompletionEnabled(),
  getPlanModeEnabled: () => useSettingsStore.getState().getPlanModeEnabled(),

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
  setTerminalShell: (shell: string) => useSettingsStore.getState().setTerminalShell(shell),
  getTerminalShell: () => useSettingsStore.getState().getTerminalShell(),
};

// Export settingsDb for direct database access (used by ThemeProvider before store initialization)
export { settingsDb };
