import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toToolInputJsonSchema, toOpenAIToolDefinition } from './tool-schema';

const createGeminiToolDefinition = (schema: unknown) =>
  toOpenAIToolDefinition('geminiTool', 'Gemini tool', schema, {
    modelIdentifier: 'gemini-1.5-pro@google',
  });

const createNonGeminiToolDefinition = (schema: unknown) =>
  toOpenAIToolDefinition('nonGeminiTool', 'Non-gemini tool', schema, {
    modelIdentifier: 'gpt-4@openai',
  });

describe('toToolInputJsonSchema', () => {
  it('converts Zod v4 schemas to JSON schema', () => {
    const inputSchema = z.object({
      message: z.string(),
    });

    const jsonSchema = toToolInputJsonSchema(inputSchema);

    expect(jsonSchema).toEqual(
      expect.objectContaining({
        type: 'object',
        properties: {
          message: expect.objectContaining({ type: 'string' }),
        },
      })
    );

    expect((jsonSchema as Record<string, unknown>)._def).toBeUndefined();
  });

  it('converts Zod v3 schemas to JSON schema', async () => {
    const { z: z3 } = await import('zod/v3');
    const inputSchema = z3.object({
      message: z3.string(),
    });

    const jsonSchema = toToolInputJsonSchema(inputSchema);

    expect(jsonSchema).toEqual(
      expect.objectContaining({
        type: 'object',
        properties: {
          message: expect.objectContaining({ type: 'string' }),
        },
      })
    );
  });

  it('adds enum type when Zod enum contains strings', () => {
    const inputSchema = z.object({
      operation: z.enum(['one', 'two']),
    });

    const jsonSchema = toToolInputJsonSchema(inputSchema);

    const operationSchema = (jsonSchema.properties as Record<string, unknown>)
      ?.operation as Record<string, unknown>;

    expect(operationSchema).toEqual(
      expect.objectContaining({
        type: 'string',
        enum: ['one', 'two'],
      })
    );
  });

  it('adds enum type for native enums with string values', () => {
    const Status = { Pending: 'pending', Done: 'done' } as const;
    const inputSchema = z.object({
      status: z.nativeEnum(Status),
    });

    const jsonSchema = toToolInputJsonSchema(inputSchema);

    const statusSchema = (jsonSchema.properties as Record<string, unknown>)
      ?.status as Record<string, unknown>;

    expect(statusSchema).toEqual(
      expect.objectContaining({
        type: 'string',
        enum: ['pending', 'done'],
      })
    );
  });

  it('keeps enum without type when mixed values are present', () => {
    const Mixed = { On: 'on', Off: 0 } as const;
    const inputSchema = z.object({
      value: z.nativeEnum(Mixed),
    });

    const jsonSchema = toToolInputJsonSchema(inputSchema);

    const valueSchema = (jsonSchema.properties as Record<string, unknown>)
      ?.value as Record<string, unknown>;

    expect(valueSchema).toEqual(
      expect.objectContaining({
        enum: ['on', 0],
      })
    );
    expect(valueSchema.type).toBeUndefined();
  });

  it('adds enum type for Zod enums in nested objects', () => {
    const inputSchema = z.object({
      nested: z.object({
        state: z.enum(['ready', 'busy']),
      }),
    });

    const jsonSchema = toToolInputJsonSchema(inputSchema);

    const nestedSchema = (jsonSchema.properties as Record<string, unknown>)
      ?.nested as Record<string, unknown>;
    const stateSchema = (nestedSchema.properties as Record<string, unknown>)
      ?.state as Record<string, unknown>;

    expect(stateSchema).toEqual(
      expect.objectContaining({
        type: 'string',
        enum: ['ready', 'busy'],
      })
    );
  });

  it('handles default values in Zod schemas', () => {
    const inputSchema = z.object({
      mode: z.enum(['a', 'b']).default('a'),
    });

    const jsonSchema = toToolInputJsonSchema(inputSchema);

    const modeSchema = (jsonSchema.properties as Record<string, unknown>)?.mode as Record<
      string,
      unknown
    >;
    expect(modeSchema?.default).toBe('a');
  });

  it('passes through JSON schema input unchanged', () => {
    const jsonSchema = {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
    };

    const result = toToolInputJsonSchema(jsonSchema);

    expect(result).toBe(jsonSchema);
  });

  it('returns fallback schema for invalid input', () => {
    const result = toToolInputJsonSchema(null);

    expect(result).toBeDefined();
    expect(result.properties).toEqual({});
    expect(result.additionalProperties).toBe(false);
  });

  it('converts to OpenAI tool definition format', () => {
    const toolDef = toOpenAIToolDefinition('testTool', 'A test tool', z.object({ message: z.string() }));

    expect(toolDef).toBeDefined();
    expect(toolDef.type).toBe('function');
    expect(toolDef.name).toBe('testTool');
    expect(toolDef.description).toBe('A test tool');
    expect(toolDef.strict).toBe(true);
    expect(toolDef.parameters).toBeDefined();
    expect(toolDef.parameters.type).toBe('object');
    expect(toolDef.parameters.additionalProperties).toBe(false);
  });

  it('stringifies enum values for Gemini and flips numeric types to string', () => {
    const toolDef = createGeminiToolDefinition({
      type: 'object',
      properties: {
        mode: {
          type: 'integer',
          enum: [1, 2, 3],
        },
      },
      required: ['mode'],
    });

    const modeSchema = (toolDef.parameters.properties as Record<string, unknown>)
      ?.mode as Record<string, unknown>;

    expect(modeSchema).toEqual(
      expect.objectContaining({
        type: 'string',
        enum: ['1', '2', '3'],
      })
    );
  });

  it('filters required fields to known properties for Gemini', () => {
    const toolDef = createGeminiToolDefinition({
      type: 'object',
      properties: {
        title: { type: 'string' },
      },
      required: ['title', 'missing'],
    });

    expect(toolDef.parameters.required).toEqual(['title']);
  });

  it('adds empty items for Gemini arrays without items', () => {
    const toolDef = createGeminiToolDefinition({
      type: 'object',
      properties: {
        tags: {
          type: 'array',
        },
      },
      required: ['tags'],
    });

    const tagsSchema = (toolDef.parameters.properties as Record<string, unknown>)
      ?.tags as Record<string, unknown>;

    expect(tagsSchema.items).toEqual({});
  });

  it('recursively sanitizes nested Gemini schemas', () => {
    const toolDef = createGeminiToolDefinition({
      type: 'object',
      properties: {
        nested: {
          type: 'object',
          properties: {
            values: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  status: {
                    type: 'number',
                    enum: [10, 20],
                  },
                },
                required: ['status', 'ghost'],
              },
            },
          },
        },
      },
      required: ['nested'],
    });

    const nestedSchema = (toolDef.parameters.properties as Record<string, unknown>)
      ?.nested as Record<string, unknown>;
    const valuesSchema = (nestedSchema.properties as Record<string, unknown>)
      ?.values as Record<string, unknown>;
    const itemsSchema = valuesSchema.items as Record<string, unknown>;
    const statusSchema = (itemsSchema.properties as Record<string, unknown>)
      ?.status as Record<string, unknown>;

    expect(statusSchema).toEqual(
      expect.objectContaining({
        type: 'string',
        enum: ['10', '20'],
      })
    );
    expect(itemsSchema.required).toEqual(['status']);
  });

  it('does not sanitize enums for non-Gemini models', () => {
    const toolDef = createNonGeminiToolDefinition({
      type: 'object',
      properties: {
        level: {
          type: 'integer',
          enum: [1, 2],
        },
      },
      required: ['level'],
    });

    const levelSchema = (toolDef.parameters.properties as Record<string, unknown>)
      ?.level as Record<string, unknown>;

    expect(levelSchema).toEqual(
      expect.objectContaining({
        type: 'integer',
        enum: [1, 2],
      })
    );
  });
});
