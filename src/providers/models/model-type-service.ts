/**
 * Service for resolving model types to concrete model identifiers
 */

import { logger } from '@/lib/logger';
import { modelService } from '@/providers/stores/provider-store';
import { settingsManager } from '@/stores/settings-store';
import { DEFAULT_MODELS_BY_TYPE, MODEL_TYPE_SETTINGS_KEYS, ModelType } from '@/types/model-types';

export class ModelTypeService {
  /**
   * Resolve a model type to a concrete model identifier
   * Falls back to default if no model is configured for the type
   */
  async resolveModelType(modelType: ModelType): Promise<string> {
    const settingsKey = MODEL_TYPE_SETTINGS_KEYS[modelType];
    const configuredModel = await settingsManager.get(settingsKey);

    logger.debug(
      `resolveModelType: settingsKey=${settingsKey}, configuredModel=${configuredModel}`
    );

    // If user has configured a model for this type, use it
    if (configuredModel && typeof configuredModel === 'string' && configuredModel.trim()) {
      // Verify the model is available (has API key)
      const isAvailable = await modelService.isModelAvailable(configuredModel);
      logger.debug(
        `resolveModelType: configuredModel=${configuredModel}, isAvailable=${isAvailable}`
      );
      if (isAvailable) {
        return configuredModel;
      }
      // If configured model is not available, log warning and fall through to default
      logger.warn(
        `Configured model "${configuredModel}" for type "${modelType}" is not available. Falling back to default.`
      );
    }

    // Fall back to default model for this type
    const defaultModel = DEFAULT_MODELS_BY_TYPE[modelType];

    // Check if default model is available
    const isDefaultAvailable = await modelService.isModelAvailable(defaultModel);
    if (isDefaultAvailable) {
      return defaultModel;
    }

    // If default is not available, try to find any available model
    logger.warn(
      `Default model "${defaultModel}" for type "${modelType}" is not available. Trying to find alternative.`
    );

    const availableModels = await modelService.getAvailableModels();
    if (availableModels.length > 0) {
      // Return first available model as last resort
      const fallbackModel = availableModels[0];
      if (fallbackModel) {
        const fallbackModelIdentifier = `${fallbackModel.key}@${fallbackModel.provider}`;
        logger.warn(`Using fallback model: ${fallbackModelIdentifier}`);
        return fallbackModelIdentifier;
      }
    }

    // No models available at all - return default anyway
    // This will cause an error later, but that's expected behavior
    logger.error('No models available. Please configure API keys.');
    return defaultModel;
  }

  /**
   * Synchronously resolve a model type using cached settings
   * Use this for performance-critical paths where async is not possible
   */
  resolveModelTypeSync(modelType: ModelType): string {
    const settingsKey = MODEL_TYPE_SETTINGS_KEYS[modelType];
    const configuredModel = settingsManager.getSync(settingsKey);

    if (configuredModel && typeof configuredModel === 'string' && configuredModel.trim()) {
      return configuredModel;
    }

    return DEFAULT_MODELS_BY_TYPE[modelType];
  }

  /**
   * Clear the configured model for a type (will use default)
   */
  async clearModelForType(modelType: ModelType): Promise<void> {
    const settingsKey = MODEL_TYPE_SETTINGS_KEYS[modelType];
    await settingsManager.set(settingsKey, '');
  }

  /**
   * Get the default model type
   */
  getDefaultModelType(): ModelType {
    return ModelType.MAIN;
  }
}

export const modelTypeService = new ModelTypeService();
