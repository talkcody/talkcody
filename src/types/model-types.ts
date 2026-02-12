import {
  GEMINI_25_FLASH_LITE,
  MINIMAX_M25,
  NANO_BANANA_PRO,
  SCRIBE_V2_REALTIME,
} from '@/providers/config/model-constants';

export enum ModelType {
  MAIN = 'main_model',
  SMALL = 'small_model',
  MESSAGE_COMPACTION = 'message_compaction_model',
  IMAGE_GENERATOR = 'image_generator_model',
  TRANSCRIPTION = 'transcription_model',
  PLAN = 'plan_model',
  CODE_REVIEW = 'code_review_model',
}

export const MODEL_TYPE_LABELS: Record<ModelType, string> = {
  [ModelType.MAIN]: 'Main Model',
  [ModelType.SMALL]: 'Small Model',
  [ModelType.IMAGE_GENERATOR]: 'Image Generator',
  [ModelType.TRANSCRIPTION]: 'Transcription',
  [ModelType.MESSAGE_COMPACTION]: 'Message Compaction',
  [ModelType.PLAN]: 'Plan Model',
  [ModelType.CODE_REVIEW]: 'Code Review Model',
};

export const MODEL_TYPE_DESCRIPTIONS: Record<ModelType, string> = {
  [ModelType.MAIN]: 'Primary model for complex reasoning, coding, and analysis tasks',
  [ModelType.SMALL]: 'Faster, lightweight model for simple tasks and quick responses',
  [ModelType.IMAGE_GENERATOR]: 'Model for generating images from text descriptions',
  [ModelType.TRANSCRIPTION]: 'Model for converting speech/audio to text',
  [ModelType.MESSAGE_COMPACTION]: 'Model for compressing conversation history',
  [ModelType.PLAN]: 'Model for the planning agent to create implementation plans',
  [ModelType.CODE_REVIEW]: 'Model for reviewing changes and providing code review feedback',
};

export const DEFAULT_MODELS_BY_TYPE: Record<ModelType, string> = {
  [ModelType.MAIN]: MINIMAX_M25,
  [ModelType.SMALL]: GEMINI_25_FLASH_LITE,
  [ModelType.IMAGE_GENERATOR]: NANO_BANANA_PRO,
  [ModelType.TRANSCRIPTION]: SCRIBE_V2_REALTIME,
  [ModelType.MESSAGE_COMPACTION]: GEMINI_25_FLASH_LITE,
  [ModelType.PLAN]: MINIMAX_M25,
  [ModelType.CODE_REVIEW]: MINIMAX_M25,
};

export interface ModelTypeConfig {
  [ModelType.MAIN]?: string;
  [ModelType.SMALL]?: string;
  [ModelType.IMAGE_GENERATOR]?: string;
  [ModelType.TRANSCRIPTION]?: string;
  [ModelType.MESSAGE_COMPACTION]?: string;
  [ModelType.PLAN]?: string;
  [ModelType.CODE_REVIEW]?: string;
}

export const MODEL_TYPE_SETTINGS_KEYS = {
  [ModelType.MAIN]: 'model_type_main',
  [ModelType.SMALL]: 'model_type_small',
  [ModelType.IMAGE_GENERATOR]: 'model_type_image_generator',
  [ModelType.TRANSCRIPTION]: 'model_type_transcription',
  [ModelType.MESSAGE_COMPACTION]: 'model_type_message_compaction',
  [ModelType.PLAN]: 'model_type_plan',
  [ModelType.CODE_REVIEW]: 'model_type_code_review',
} as const;

export function isValidModelType(value: string): value is ModelType {
  return Object.values(ModelType).includes(value as ModelType);
}

export function getModelType(value: string | undefined): ModelType {
  if (value && isValidModelType(value)) {
    return value;
  }
  return ModelType.MAIN;
}
