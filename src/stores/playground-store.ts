import { join } from '@tauri-apps/api/path';
import { exists, mkdir } from '@tauri-apps/plugin-fs';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { logger } from '@/lib/logger';
import { replaceCustomToolsCache } from '@/lib/tools';
import { refreshCustomTools } from '@/services/tools/custom-tool-refresh';
import { toolPlaygroundService } from '@/services/tools/tool-playground-service';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';
import { useSettingsStore } from '@/stores/settings-store';
import type {
  CompileResult,
  ExecutionRecord,
  ExecutionResult,
  ParameterPreset,
  PlaygroundConfig,
  PlaygroundStatus,
  ToolTemplate,
} from '@/types/playground';

interface PlaygroundState {
  // Playground core state
  toolName: string;
  sourceCode: string;
  config: PlaygroundConfig;
  status: PlaygroundStatus;

  // UI state
  isCompiling: boolean;
  isExecuting: boolean;
  compileResult: CompileResult | null;
  executionResult: ExecutionResult | null;
  executionHistory: ExecutionRecord[];
  parameterPresets: ParameterPreset[];

  // Error state
  error: string | null;

  // ============================================
  // Initialization Actions
  // ============================================

  /**
   * Initialize playground
   */
  initializePlayground: (
    sourceCode: string,
    name?: string,
    config?: Partial<PlaygroundConfig>
  ) => void;

  /**
   * Initialize from a template
   */
  initializeFromTemplate: (templateId: string) => void;

  /**
   * Load a tool from file into playground
   */
  loadToolFromFile: (filePath: string, sourceCode: string) => void;

  /**
   * Update source code
   */
  updateSourceCode: (sourceCode: string) => void;

  // ============================================
  // Compilation Actions
  // ============================================

  /**
   * Clear any pending auto-compile timeout
   */
  clearAutoCompile: () => void;

  /**
   * Compile the current tool
   */
  compileTool: () => Promise<CompileResult>;

  /**
   * Auto-compile tool (debounced)
   */
  autoCompile: (delay?: number) => void;

  // ============================================
  // Execution Actions
  // ============================================

  /**
   * Execute the current tool with given parameters
   */
  executeTool: (
    params: Record<string, unknown>,
    grantedPermissions?: string[]
  ) => Promise<ExecutionResult>;

  /**
   * Clear execution result
   */
  clearExecutionResult: () => void;

  /**
   * Clear execution history
   */
  clearExecutionHistory: () => void;

  // ============================================
  // Parameter Preset Actions
  // ============================================

  /**
   * Create a parameter preset
   */
  createParameterPreset: (
    name: string,
    params: Record<string, unknown>,
    description?: string
  ) => ParameterPreset;

  /**
   * Update a parameter preset
   */
  updateParameterPreset: (presetId: string, updates: Partial<ParameterPreset>) => void;

  /**
   * Delete a parameter preset
   */
  deleteParameterPreset: (presetId: string) => void;

  /**
   * Load preset parameters
   */
  loadPreset: (presetId: string) => Record<string, unknown>;

  // ============================================
  // Template Actions
  // ============================================

  /**
   * Get available templates
   */
  getTemplates: () => ToolTemplate[];

  // ============================================
  // Config Actions
  // ============================================

  /**
   * Update config
   */
  updateConfig: (updates: Partial<PlaygroundConfig>) => void;

  // ============================================
  // Installation Actions
  // ============================================

  /**
   * Install the current tool to .talkcody/tools directory
   */
  installTool: () => Promise<boolean>;

  // ============================================
  // Utility Actions
  // ============================================

  /**
   * Clear error
   */
  clearError: () => void;
}

// Auto-compile timeout ID - use closure-based storage to prevent memory leaks
let autoCompileTimeoutId: ReturnType<typeof setTimeout> | null = null;

/**
 * Clear any pending auto-compile timeout
 */
function clearAutoCompile(): void {
  if (autoCompileTimeoutId) {
    clearTimeout(autoCompileTimeoutId);
    autoCompileTimeoutId = null;
    logger.debug('[PlaygroundStore] Auto-compile timeout cleared');
  }
}

export const usePlaygroundStore = create<PlaygroundState>()(
  devtools(
    (set, get) => ({
      // Initial state
      toolName: 'Untitled Tool',
      sourceCode: '',
      config: {
        allowedPermissions: ['net'],
        timeout: 30000,
        enableMocking: false,
      },
      status: 'idle',
      isCompiling: false,
      isExecuting: false,
      compileResult: null,
      executionResult: null,
      executionHistory: [],
      parameterPresets: [],
      error: null,

      // ============================================
      // Initialization Actions
      // ============================================

      initializePlayground: (sourceCode, name = 'Untitled Tool', config) => {
        // Clear any pending auto-compile before reinitializing
        clearAutoCompile();

        toolPlaygroundService.initialize(sourceCode, name, config);
        set((state) => ({
          toolName: name,
          sourceCode,
          config: { ...state.config, ...(config || {}) },
          status: 'idle',
          compileResult: null,
          executionResult: null,
          error: null,
        }));
        logger.info('[PlaygroundStore] Playground initialized', { toolName: name });
      },

      initializeFromTemplate: (templateId) => {
        // Clear any pending auto-compile before switching templates
        clearAutoCompile();

        try {
          const template = toolPlaygroundService.getTemplates().find((t) => t.id === templateId);
          if (!template) {
            throw new Error(`Template not found: ${templateId}`);
          }

          toolPlaygroundService.initialize(template.sourceCode, template.name);
          set((state) => ({
            toolName: template.name,
            sourceCode: template.sourceCode,
            config: { ...state.config },
            status: 'idle',
            compileResult: null,
            executionResult: null,
            error: null,
          }));
          logger.info('[PlaygroundStore] Playground initialized from template', {
            templateId,
            toolName: template.name,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          set({ error: errorMessage });
          logger.error('[PlaygroundStore] Failed to initialize from template', error);
          throw error;
        }
      },

      loadToolFromFile: (filePath, sourceCode) => {
        // Clear any pending auto-compile before loading new file
        clearAutoCompile();

        const name =
          filePath
            .split('/')
            .pop()
            ?.replace(/\.(ts|tsx)$/, '') || 'Untitled Tool';

        toolPlaygroundService.initialize(sourceCode, name);
        set((state) => ({
          toolName: name,
          sourceCode,
          config: { ...state.config },
          status: 'idle',
          compileResult: null,
          executionResult: null,
          error: null,
        }));
        logger.info('[PlaygroundStore] Tool loaded from file', { filePath, toolName: name });
      },

      updateSourceCode: (sourceCode) => {
        try {
          toolPlaygroundService.updateSourceCode(sourceCode);
          set({ sourceCode, compileResult: null, status: 'idle' });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          set({ error: errorMessage });
          logger.error('[PlaygroundStore] Failed to update source code', error);
        }
      },

      // ============================================
      // Compilation Actions
      // ============================================

      /**
       * Clear any pending auto-compile timeout
       */
      clearAutoCompile: () => {
        clearAutoCompile();
      },

      compileTool: async () => {
        set({ isCompiling: true, error: null });

        try {
          const result = await toolPlaygroundService.compileTool();

          set({
            isCompiling: false,
            compileResult: result,
            status: toolPlaygroundService.getStatus(),
          });

          // Clear any pending auto-compile after compilation
          clearAutoCompile();

          return result;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const result: CompileResult = {
            success: false,
            error: errorMessage,
            duration: 0,
          };
          set({
            isCompiling: false,
            compileResult: result,
            error: errorMessage,
            status: toolPlaygroundService.getStatus(),
          });
          // Also clear auto-compile on error
          clearAutoCompile();
          return result;
        }
      },

      autoCompile: (delay = 500) => {
        // Clear any pending auto-compile before scheduling new one
        clearAutoCompile();

        // Schedule new auto-compile
        autoCompileTimeoutId = setTimeout(() => {
          logger.debug('[PlaygroundStore] Auto-compile triggered');
          get().compileTool();
          autoCompileTimeoutId = null;
        }, delay);
      },

      // ============================================
      // Execution Actions
      // ============================================

      executeTool: async (params, grantedPermissions) => {
        set({ isExecuting: true, error: null });

        try {
          const result = await toolPlaygroundService.executeTool(params, grantedPermissions);
          const history = toolPlaygroundService.getExecutionHistory();

          set({
            isExecuting: false,
            executionResult: result,
            executionHistory: history,
            status: toolPlaygroundService.getStatus(),
          });

          return result;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const result: ExecutionResult = {
            status: 'error',
            error: errorMessage,
            duration: 0,
            logs: [],
          };
          set({
            isExecuting: false,
            executionResult: result,
            error: errorMessage,
            status: toolPlaygroundService.getStatus(),
          });
          return result;
        }
      },

      clearExecutionResult: () => {
        set({
          executionResult: null,
          error: null,
        });
      },

      clearExecutionHistory: () => {
        toolPlaygroundService.clearExecutionHistory();
        set({ executionHistory: [] });
      },

      // ============================================
      // Parameter Preset Actions
      // ============================================

      createParameterPreset: (name, params, description) => {
        const preset = toolPlaygroundService.createParameterPreset(name, params, description);

        set((state) => ({
          parameterPresets: [...state.parameterPresets, preset],
        }));

        return preset;
      },

      updateParameterPreset: (presetId, updates) => {
        toolPlaygroundService.updateParameterPreset(presetId, updates);

        set((state) => ({
          parameterPresets: state.parameterPresets.map((p) =>
            p.id === presetId ? { ...p, ...updates, updatedAt: Date.now() } : p
          ),
        }));
      },

      deleteParameterPreset: (presetId) => {
        toolPlaygroundService.deleteParameterPreset(presetId);

        set((state) => ({
          parameterPresets: state.parameterPresets.filter((p) => p.id !== presetId),
        }));
      },

      loadPreset: (presetId) => {
        const { parameterPresets } = get();
        const preset = parameterPresets.find((p) => p.id === presetId);
        if (preset) {
          return preset.params;
        }
        return {};
      },

      // ============================================
      // Template Actions
      // ============================================

      getTemplates: () => {
        return toolPlaygroundService.getTemplates();
      },

      // ============================================
      // Config Actions
      // ============================================

      updateConfig: (updates) => {
        toolPlaygroundService.updateConfig(updates);
        set((state) => ({
          config: { ...state.config, ...updates },
        }));
      },

      // ============================================
      // Installation Actions
      // ============================================

      installTool: async () => {
        const { sourceCode, toolName, compileResult } = get();

        // Check if tool is compiled successfully
        if (!compileResult?.success || !compileResult.tool) {
          logger.error('[PlaygroundStore] Cannot install tool: tool not compiled successfully');
          return false;
        }

        try {
          // Get workspace root or use home directory
          const workspaceRoot = await getEffectiveWorkspaceRoot('');
          const toolsDir = workspaceRoot
            ? `${workspaceRoot}/.talkcody/tools`
            : `${await import('@tauri-apps/api/path').then((m) => m.homeDir())}/.talkcody/tools`;

          // Ensure tools directory exists
          const dirExists = await exists(toolsDir);
          if (!dirExists) {
            await mkdir(toolsDir, { recursive: true });
          }

          // Generate file name from tool name
          const fileName = `${toolName.toLowerCase().replace(/\s+/g, '_')}.tsx`;
          const filePath = await join(toolsDir, fileName);

          // Write tool file
          const { writeTextFile } = await import('@tauri-apps/plugin-fs');
          await writeTextFile(filePath, sourceCode);

          logger.info('[PlaygroundStore] Tool installed successfully', {
            toolName,
            filePath,
          });

          // Refresh custom tools to enable the new tool
          const customDirectory = useSettingsStore.getState().custom_tools_dir;
          const options = {
            workspaceRoot: workspaceRoot || undefined,
            customDirectory: customDirectory || undefined,
          };

          const refreshed = await refreshCustomTools(options);
          replaceCustomToolsCache(refreshed);

          return true;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error('[PlaygroundStore] Failed to install tool', {
            toolName,
            error: errorMessage,
          });
          return false;
        }
      },

      // ============================================
      // Utility Actions
      // ============================================

      clearError: () => {
        set({ error: null });
      },
    }),
    {
      name: 'PlaygroundStore',
    }
  )
);
