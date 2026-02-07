import { convertSchema, type JSONSchema7 } from '@/lib/json-schema/minimal-zod-converter';
import { logger } from '@/lib/logger';

type ToolSchemaOptions = {
  modelIdentifier?: string | null;
};

const FALLBACK_SCHEMA: JSONSchema7 = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

function looksLikeJsonSchema(value: unknown): value is JSONSchema7 {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;

  // Exclude Zod internal format which has '~standard' or 'def.shape' properties
  if (
    '~standard' in record ||
    ('def' in record && record.def && typeof record.def === 'object' && 'shape' in record.def)
  ) {
    return false;
  }

  return (
    '$schema' in record ||
    'properties' in record ||
    'oneOf' in record ||
    'anyOf' in record ||
    'allOf' in record ||
    ('type' in record &&
      (record.type === 'object' ||
        record.type === 'string' ||
        record.type === 'number' ||
        record.type === 'integer' ||
        record.type === 'array' ||
        record.type === 'boolean' ||
        record.type === 'null'))
  );
}

export function toToolInputJsonSchema(inputSchema: unknown): JSONSchema7 {
  if (inputSchema == null) {
    return FALLBACK_SCHEMA;
  }
  if (looksLikeJsonSchema(inputSchema)) {
    return inputSchema;
  }

  const converted = convertSchema(inputSchema);
  if (converted) {
    return converted;
  }

  logger.warn('[ToolSchema] Failed to normalize tool input schema', {
    error: 'Unsupported input schema',
  });
  return FALLBACK_SCHEMA;
}

function isGeminiModel(modelIdentifier?: string | null): boolean {
  if (!modelIdentifier) return false;
  const normalized = modelIdentifier.toLowerCase();
  return normalized.includes('gemini') || normalized.includes('@google');
}

function sanitizeGeminiSchema(schema: JSONSchema7): JSONSchema7 {
  const visit = (value: JSONSchema7 | unknown): JSONSchema7 | unknown => {
    if (!value || typeof value !== 'object') {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((entry) => visit(entry));
    }

    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(record)) {
      if (key === 'enum' && Array.isArray(entry)) {
        const stringified = entry.map((enumValue) => String(enumValue));
        result[key] = stringified;

        const currentType = result.type ?? record.type;
        if (currentType === 'integer' || currentType === 'number') {
          result.type = 'string';
        }
        continue;
      }

      if (entry && typeof entry === 'object') {
        result[key] = visit(entry);
        continue;
      }

      result[key] = entry;
    }

    if (
      result.type === 'object' &&
      result.properties &&
      Array.isArray(result.required) &&
      typeof result.properties === 'object'
    ) {
      const properties = result.properties as Record<string, unknown>;
      result.required = result.required.filter((field) => field in properties);
    }

    if (result.type === 'array' && result.items == null) {
      result.items = {};
    }

    return result as JSONSchema7;
  };

  return visit(schema) as JSONSchema7;
}

/**
 * Normalizes a tool parameter schema to be OpenAI-compatible
 * - Ensures type: "object" is at the top
 * - Adds additionalProperties: false if not present
 * - Orders fields: type, properties, required, additionalProperties
 */
function normalizeParameterSchema(schema: JSONSchema7): JSONSchema7 {
  if (!schema || typeof schema !== 'object') {
    return FALLBACK_SCHEMA;
  }

  // If it's not an object type, return as-is
  if (schema.type !== 'object') {
    return schema;
  }

  // Build normalized schema with proper field order
  const normalized: JSONSchema7 = {
    type: 'object',
  };

  // Add properties if present
  if (schema.properties && typeof schema.properties === 'object') {
    normalized.properties = schema.properties;
  }

  // Add required if present
  if (Array.isArray(schema.required) && schema.required.length > 0) {
    normalized.required = schema.required;
  }

  // Always add additionalProperties: false for strict mode
  normalized.additionalProperties = false;

  return normalized;
}

/**
 * Tool definition in OpenAI-compatible format
 * Field order: type, name, description, parameters, strict
 */
export interface OpenAIToolDefinition {
  type: 'function';
  name: string;
  description?: string | null;
  parameters: JSONSchema7;
  strict: true;
}

/**
 * Converts a tool definition to OpenAI-compatible format
 * - Normalizes the schema
 * - Ensures correct field order
 * - Adds strict: true
 */
export function toOpenAIToolDefinition(
  name: string,
  description: string | null | undefined,
  inputSchema: unknown,
  options?: ToolSchemaOptions
): OpenAIToolDefinition {
  // Convert to JSON Schema if needed
  let jsonSchema = toToolInputJsonSchema(inputSchema);
  if (isGeminiModel(options?.modelIdentifier)) {
    jsonSchema = sanitizeGeminiSchema(jsonSchema);
  }

  // Normalize the parameter schema
  const normalizedSchema = normalizeParameterSchema(jsonSchema);

  // Return with explicit field order for OpenAI compatibility
  return {
    type: 'function',
    name,
    description,
    parameters: normalizedSchema,
    strict: true,
  };
}
