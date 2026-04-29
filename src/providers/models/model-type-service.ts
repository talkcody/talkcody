/**
 * Service for resolving model types to concrete model identifiers
 */

import { logger } from '@/lib/logger';
import { parseModelIdentifier } from '@/providers/core/provider-utils';
import { modelService, useProviderStore } from '@/providers/stores/provider-store';
import { settingsManager } from '@/stores/settings-store';
import type { AvailableModel } from '@/types/api-keys';
import {
  getDefaultModelTypeChain,
  MODEL_TYPE_SETTINGS_KEYS,
  ModelType,
  parseStoredModelTypeValue,
} from '@/types/model-types';

function toModelIdentifier(modelKey: string, providerId: string): string {
  return `${modelKey}@${providerId}`;
}

function dedupeModelIdentifiers(modelIdentifiers: string[]): string[] {
  return Array.from(
    new Set(
      modelIdentifiers
        .map((modelIdentifier) => modelIdentifier.trim())
        .filter((modelIdentifier) => modelIdentifier.length > 0)
    )
  );
}

function resolveAvailableModelIdentifier(
  modelIdentifier: string,
  availableModels: AvailableModel[]
): string | null {
  const { modelKey, providerId } = parseModelIdentifier(modelIdentifier);

  if (!modelKey) {
    return null;
  }

  if (providerId) {
    const exactMatch = availableModels.find(
      (availableModel) => availableModel.key === modelKey && availableModel.provider === providerId
    );
    return exactMatch ? toModelIdentifier(exactMatch.key, exactMatch.provider) : null;
  }

  const resolvedMatch = availableModels.find((availableModel) => availableModel.key === modelKey);
  return resolvedMatch ? toModelIdentifier(resolvedMatch.key, resolvedMatch.provider) : null;
}

async function resolveConfiguredModelChain(
  configuredModelIdentifiers: string[],
  availableModels: AvailableModel[]
): Promise<string[]> {
  const resolvedIdentifiers: string[] = [];

  for (const modelIdentifier of dedupeModelIdentifiers(configuredModelIdentifiers)) {
    const resolvedIdentifier = resolveAvailableModelIdentifier(modelIdentifier, availableModels);
    if (resolvedIdentifier) {
      resolvedIdentifiers.push(resolvedIdentifier);
      continue;
    }

    const isAvailable = await modelService.isModelAvailable(modelIdentifier);
    if (isAvailable) {
      resolvedIdentifiers.push(modelIdentifier);
    }
  }

  return dedupeModelIdentifiers(resolvedIdentifiers);
}

function resolveConfiguredModelChainSync(
  configuredModelIdentifiers: string[],
  availableModels: AvailableModel[]
): string[] {
  const resolvedIdentifiers = dedupeModelIdentifiers(configuredModelIdentifiers).flatMap(
    (modelIdentifier) => {
      const resolvedIdentifier = resolveAvailableModelIdentifier(modelIdentifier, availableModels);
      if (resolvedIdentifier) {
        return [resolvedIdentifier];
      }

      if (useProviderStore.getState().isModelAvailable(modelIdentifier)) {
        return [modelIdentifier];
      }

      return [];
    }
  );

  return dedupeModelIdentifiers(resolvedIdentifiers);
}

export class ModelTypeService {
  private getConfiguredModelTypeChain(
    value: string | null | undefined,
    modelType: ModelType
  ): string[] {
    return parseStoredModelTypeValue(value, modelType);
  }

  private buildModelCandidateChain(
    value: string | null | undefined,
    modelType: ModelType
  ): string[] {
    return dedupeModelIdentifiers([
      ...this.getConfiguredModelTypeChain(value, modelType),
      ...getDefaultModelTypeChain(modelType),
    ]);
  }

  /**
   * Resolve a model type to an ordered chain of concrete model identifiers.
   * Falls back to the first available model if the configured/default chain is unavailable.
   */
  async resolveModelTypeChain(modelType: ModelType): Promise<string[]> {
    const settingsKey = MODEL_TYPE_SETTINGS_KEYS[modelType];
    const configuredModelValue = await settingsManager.get(settingsKey);
    const availableModels = await modelService.getAvailableModels();
    const candidateIdentifiers = this.buildModelCandidateChain(configuredModelValue, modelType);

    logger.debug('resolveModelTypeChain', {
      settingsKey,
      configuredModelValue,
      candidateIdentifiers,
      availableModelCount: availableModels.length,
    });

    const resolvedIdentifiers = await resolveConfiguredModelChain(
      candidateIdentifiers,
      availableModels
    );
    if (resolvedIdentifiers.length > 0) {
      return resolvedIdentifiers;
    }

    const fallbackModel = availableModels[0];
    if (fallbackModel) {
      const fallbackIdentifier = toModelIdentifier(fallbackModel.key, fallbackModel.provider);
      logger.warn(`Using fallback model chain for type "${modelType}": ${fallbackIdentifier}`);
      return [fallbackIdentifier];
    }

    const defaultModel = getDefaultModelTypeChain(modelType)[0] || '';
    logger.error('No models available. Please configure API keys.', { modelType, defaultModel });
    return defaultModel ? [defaultModel] : [];
  }

  /**
   * Resolve a model type to a concrete model identifier.
   * Falls back to the first available resolved entry from the configured chain.
   */
  async resolveModelType(modelType: ModelType): Promise<string> {
    const [resolvedModel] = await this.resolveModelTypeChain(modelType);
    return resolvedModel || '';
  }

  /**
   * Synchronously resolve a model type to an ordered model chain using cached settings/store state.
   */
  resolveModelTypeChainSync(modelType: ModelType): string[] {
    const settingsKey = MODEL_TYPE_SETTINGS_KEYS[modelType];
    const configuredModelValue = settingsManager.getSync(settingsKey);
    const availableModels = useProviderStore.getState().availableModels;
    const candidateIdentifiers = this.buildModelCandidateChain(configuredModelValue, modelType);
    const resolvedIdentifiers = resolveConfiguredModelChainSync(
      candidateIdentifiers,
      availableModels
    );

    if (resolvedIdentifiers.length > 0) {
      return resolvedIdentifiers;
    }

    return getDefaultModelTypeChain(modelType);
  }

  /**
   * Synchronously resolve a model type using cached settings.
   * Use this for performance-critical paths where async is not possible.
   */
  resolveModelTypeSync(modelType: ModelType): string {
    const [resolvedModel] = this.resolveModelTypeChainSync(modelType);
    return resolvedModel || '';
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
