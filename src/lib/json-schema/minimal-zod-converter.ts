import { logger } from '@/lib/logger';

export type JSONSchema7 = {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null';
  properties?: Record<string, JSONSchema7>;
  items?: JSONSchema7 | JSONSchema7[];
  required?: string[];
  additionalProperties?: boolean | JSONSchema7;
  enum?: Array<string | number | boolean | null>;
  const?: string | number | boolean | null;
  description?: string;
  oneOf?: JSONSchema7[];
  anyOf?: JSONSchema7[];
  allOf?: JSONSchema7[];
  default?: unknown;
  format?: string;
} & Record<string, unknown>;

type ZodDef = {
  type?: unknown;
  typeName?: string;
  innerType?: unknown;
  schema?: unknown;
  shape?: unknown;
  element?: unknown;
  items?: unknown;
  options?: unknown;
  entries?: unknown;
  values?: unknown;
  value?: unknown;
  keyType?: unknown;
  valueType?: unknown;
  defaultValue?: unknown;
  left?: unknown;
  right?: unknown;
};

type ZodSchemaLike = {
  def?: ZodDef;
  _def?: ZodDef;
  shape?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function getDef(schema: unknown): ZodDef | null {
  if (!schema || typeof schema !== 'object') return null;
  const record = schema as ZodSchemaLike & { _zod?: { def?: ZodDef } };
  const def = record.def ?? record._def ?? record._zod?.def;
  if (!def || typeof def !== 'object') return null;
  return def;
}

function getObjectShape(schema: unknown): Record<string, unknown> | null {
  if (!schema || typeof schema !== 'object') return null;
  const record = schema as ZodSchemaLike;
  const def = getDef(record);
  const shape = def?.shape ?? record.shape;
  if (typeof shape === 'function') {
    const result = shape();
    return asRecord(result);
  }
  return asRecord(shape);
}

function getInnerSchema(def: ZodDef): unknown {
  return def.innerType ?? def.schema ?? def.type;
}

function toZodType(def: ZodDef | null | undefined): string | undefined {
  if (!def) return undefined;
  if (typeof def.type === 'string') {
    return def.type;
  }
  if (typeof def.typeName === 'string') {
    return def.typeName.replace(/^Zod/, '').replace(/^Zod/, '').toLowerCase();
  }
  return undefined;
}

function unwrapSchema(schema: unknown): {
  base: unknown;
  optional: boolean;
  nullable: boolean;
  defaultValue?: unknown;
} {
  let current: unknown = schema;
  let optional = false;
  let nullable = false;
  let defaultValue: unknown;

  while (true) {
    const def = getDef(current);
    const type = toZodType(def);
    if (!type) break;

    if (type === 'optional' || type === 'default' || type === 'prefault') {
      optional = true;
    }
    if (type === 'nullable') {
      nullable = true;
    }
    if (type === 'default' && def?.defaultValue !== undefined) {
      const value = def.defaultValue;
      defaultValue = typeof value === 'function' ? value() : value;
    }

    if (
      type === 'optional' ||
      type === 'default' ||
      type === 'prefault' ||
      type === 'nullable' ||
      type === 'effects' ||
      type === 'transform' ||
      type === 'readonly'
    ) {
      const inner = getInnerSchema(def ?? {});
      if (inner && typeof inner === 'object') {
        current = inner;
        continue;
      }
    }
    break;
  }

  return { base: current, optional, nullable, defaultValue };
}

function extractEnumValues(source: unknown): Array<string | number | boolean | null> {
  const values: Array<string | number | boolean | null> = [];
  if (Array.isArray(source)) {
    for (const value of source) {
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value === null
      ) {
        values.push(value);
      }
    }
    return values;
  }

  const record = asRecord(source);
  if (!record) return values;
  for (const value of Object.values(record)) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      values.push(value);
    }
  }
  return values;
}

function inferEnumType(values: Array<string | number | boolean | null>): JSONSchema7['type'] {
  if (values.length === 0) return undefined;
  const types = new Set(values.map((value) => (value === null ? 'null' : typeof value)));
  if (types.size !== 1) return undefined;
  const onlyType = Array.from(types)[0];
  if (onlyType === 'string') return 'string';
  if (onlyType === 'number') return 'number';
  if (onlyType === 'boolean') return 'boolean';
  if (onlyType === 'null') return 'null';
  return undefined;
}

function wrapNullable(schema: JSONSchema7): JSONSchema7 {
  return { anyOf: [schema, { type: 'null' }] };
}

function convertInternal(schema: unknown): { json: JSONSchema7 | null; optional: boolean } {
  const { base, optional, nullable, defaultValue } = unwrapSchema(schema);
  const def = getDef(base);
  const type = toZodType(def);

  if (!type) {
    return { json: null, optional };
  }

  let json: JSONSchema7 | null = null;

  switch (type) {
    case 'string':
      json = { type: 'string' };
      break;
    case 'number':
      json = { type: 'number' };
      break;
    case 'boolean':
      json = { type: 'boolean' };
      break;
    case 'bigint':
      json = { type: 'integer' };
      break;
    case 'date':
      json = { type: 'string', format: 'date-time' };
      break;
    case 'literal': {
      const literalValue = def?.value ?? (Array.isArray(def?.values) ? def?.values[0] : undefined);
      if (
        typeof literalValue === 'string' ||
        typeof literalValue === 'number' ||
        typeof literalValue === 'boolean' ||
        literalValue === null
      ) {
        json = { const: literalValue };
      } else {
        json = {};
      }
      break;
    }
    case 'enum':
    case 'nativeenum': {
      const enumValues = extractEnumValues(def?.values ?? def?.entries ?? def?.options);
      const enumType = inferEnumType(enumValues);
      json = enumType ? { type: enumType, enum: enumValues } : { enum: enumValues };
      break;
    }
    case 'null':
      json = { type: 'null' };
      break;
    case 'array': {
      const itemSchema = convertSchema(def?.element ?? def?.items ?? def?.type) ?? {};
      json = { type: 'array', items: itemSchema };
      break;
    }
    case 'tuple': {
      const items = Array.isArray(def?.items)
        ? def.items.map((item) => convertSchema(item) ?? {})
        : [];
      json = { type: 'array', items };
      break;
    }
    case 'record': {
      const additional = def?.valueType ? (convertSchema(def.valueType) ?? {}) : true;
      json = { type: 'object', properties: {}, additionalProperties: additional };
      break;
    }
    case 'union': {
      const options = Array.isArray(def?.options) ? def.options : [];
      json = { anyOf: options.map((option) => convertSchema(option) ?? {}) };
      break;
    }
    case 'intersection': {
      const left = convertSchema(def?.left) ?? {};
      const right = convertSchema(def?.right) ?? {};
      json = { allOf: [left, right] };
      break;
    }
    case 'object': {
      const shape = getObjectShape(base) ?? {};
      const properties: Record<string, JSONSchema7> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        const converted = convertInternal(value);
        properties[key] = converted.json ?? {};
        if (!converted.optional) {
          required.push(key);
        }
      }

      json = {
        type: 'object',
        properties,
        additionalProperties: false,
      };

      if (required.length > 0) {
        json.required = required;
      }
      break;
    }
    case 'unknown':
    case 'any':
      json = {};
      break;
    default:
      json = null;
  }

  if (!json) {
    return { json: null, optional };
  }

  if (defaultValue !== undefined) {
    json.default = defaultValue;
  }

  if (nullable) {
    json = wrapNullable(json);
  }

  return { json, optional };
}

export function convertZodToJsonSchema(schema: unknown): JSONSchema7 | null {
  const converted = convertInternal(schema);
  if (!converted.json) {
    logger.warn('[ToolSchema] Unsupported Zod schema, falling back to default');
    return null;
  }
  return converted.json;
}

export function convertSchema(schema: unknown): JSONSchema7 | null {
  if (!schema || typeof schema !== 'object') {
    return null;
  }

  const record = schema as Record<string, unknown>;
  if ('def' in record || '_def' in record || '~standard' in record || '_zod' in record) {
    return convertZodToJsonSchema(schema);
  }

  return null;
}
