import { readTextFile } from '@tauri-apps/plugin-fs';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const INPUT_SCHEMA_PATTERN =
  /(?:export\s+)?const\s+inputSchema\s*=\s*z\.(?:object|strictObject)\s*\(/m;

function isQuote(char: string): boolean {
  return char === '"' || char === "'" || char === '`';
}

function unescapeString(value: string): string {
  return value.replace(/\\([\\'"nrt])/g, (_match, token: string) => {
    switch (token) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case '\\':
        return '\\';
      case '"':
        return '"';
      case "'":
        return "'";
      default:
        return token;
    }
  });
}

function parseLiteral(value: string): unknown {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return unescapeString(trimmed.slice(1, -1));
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return undefined;
}

function findMatchingBracket(
  source: string,
  startIndex: number,
  open: string,
  close: string
): number {
  let depth = 0;
  let inString: string | null = null;
  let escaped = false;

  for (let i = startIndex; i < source.length; i += 1) {
    const char = source[i] ?? '';
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === inString) {
        inString = null;
      }
      continue;
    }

    if (isQuote(char)) {
      inString = char;
      continue;
    }

    if (char === open) {
      depth += 1;
      continue;
    }

    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function extractObjectLiteral(source: string, startIndex: number): string | null {
  const braceIndex = source.indexOf('{', startIndex);
  if (braceIndex === -1) return null;
  const endIndex = findMatchingBracket(source, braceIndex, '{', '}');
  if (endIndex === -1) return null;
  return source.slice(braceIndex, endIndex + 1);
}

function splitTopLevelEntries(body: string): string[] {
  const entries: string[] = [];
  let current = '';
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString: string | null = null;
  let escaped = false;

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i] ?? '';
    if (inString) {
      current += char;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === inString) {
        inString = null;
      }
      continue;
    }

    if (isQuote(char)) {
      inString = char;
      current += char;
      continue;
    }

    switch (char) {
      case '(':
        parenDepth += 1;
        break;
      case ')':
        parenDepth -= 1;
        break;
      case '{':
        braceDepth += 1;
        break;
      case '}':
        braceDepth -= 1;
        break;
      case '[':
        bracketDepth += 1;
        break;
      case ']':
        bracketDepth -= 1;
        break;
      case ',':
        if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
          if (current.trim()) {
            entries.push(current.trim());
          }
          current = '';
          continue;
        }
        break;
      default:
        break;
    }

    current += char;
  }

  if (current.trim()) {
    entries.push(current.trim());
  }

  return entries;
}

function findTopLevelColon(entry: string): number {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString: string | null = null;
  let escaped = false;

  for (let i = 0; i < entry.length; i += 1) {
    const char = entry[i] ?? '';
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === inString) {
        inString = null;
      }
      continue;
    }

    if (isQuote(char)) {
      inString = char;
      continue;
    }

    switch (char) {
      case '(':
        parenDepth += 1;
        break;
      case ')':
        parenDepth -= 1;
        break;
      case '{':
        braceDepth += 1;
        break;
      case '}':
        braceDepth -= 1;
        break;
      case '[':
        bracketDepth += 1;
        break;
      case ']':
        bracketDepth -= 1;
        break;
      case ':':
        if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
          return i;
        }
        break;
      default:
        break;
    }
  }

  return -1;
}

function parseEnumValues(source: string): string[] | null {
  const openIndex = source.indexOf('[');
  if (openIndex === -1) return null;
  const closeIndex = findMatchingBracket(source, openIndex, '[', ']');
  if (closeIndex === -1) return null;
  const arrayBody = source.slice(openIndex + 1, closeIndex);
  const values: string[] = [];
  const pattern = /'((?:\\'|[^'])*)'|"((?:\\"|[^"])*)"/g;
  let match = pattern.exec(arrayBody);
  while (match) {
    const raw = match[1] ?? match[2] ?? '';
    values.push(unescapeString(raw));
    match = pattern.exec(arrayBody);
  }
  return values.length > 0 ? values : null;
}

function extractCallArgs(expression: string): string | null {
  const openIndex = expression.indexOf('(');
  if (openIndex === -1) return null;
  const closeIndex = findMatchingBracket(expression, openIndex, '(', ')');
  if (closeIndex === -1) return null;
  return expression.slice(openIndex + 1, closeIndex);
}

function parseZodExpression(expression: string): z.ZodTypeAny {
  const trimmed = expression.trim();
  const typeMatch = trimmed.match(/^z\.(\w+)/);
  const zodType = typeMatch?.[1] ?? '';

  let schema: z.ZodTypeAny = z.unknown();

  switch (zodType) {
    case 'string':
      schema = z.string();
      break;
    case 'number':
      schema = z.number();
      break;
    case 'boolean':
      schema = z.boolean();
      break;
    case 'enum': {
      const args = extractCallArgs(trimmed);
      const values = args ? parseEnumValues(args) : null;
      if (values && values.length > 0) {
        schema = z.enum(values as [string, ...string[]]);
      } else {
        schema = z.string();
      }
      break;
    }
    case 'array': {
      const args = extractCallArgs(trimmed) ?? '';
      const innerMatch = args.trim().match(/^z\.(\w+)/);
      if (innerMatch) {
        schema = z.array(parseZodExpression(args.trim()));
      } else {
        schema = z.array(z.unknown());
      }
      break;
    }
    case 'record':
      schema = z.record(z.string(), z.unknown());
      break;
    default:
      schema = z.unknown();
      break;
  }

  const descriptionMatch = trimmed.match(/\.describe\(\s*(['"])(.*?)\1\s*\)/);
  if (descriptionMatch?.[2]) {
    schema = schema.describe(descriptionMatch[2]);
  }

  const defaultMatch = trimmed.match(/\.default\(([^)]+)\)/);
  const defaultValue = defaultMatch?.[1] ? parseLiteral(defaultMatch[1]) : undefined;
  if (defaultValue !== undefined) {
    schema = schema.default(defaultValue as never);
  }

  if (/\.optional\(/.test(trimmed) || /\.default\(/.test(trimmed) || /\.nullish\(/.test(trimmed)) {
    schema = schema.optional();
  }

  return schema;
}

export async function parseToolInputSchema(
  entryPath: string
): Promise<z.ZodSchema<Record<string, unknown>> | null> {
  try {
    const source = await readTextFile(entryPath);
    const match = INPUT_SCHEMA_PATTERN.exec(source);
    if (!match) return null;

    const objectLiteral = extractObjectLiteral(source, match.index + match[0].length);
    if (!objectLiteral) return null;

    const body = objectLiteral.slice(1, -1);
    const entries = splitTopLevelEntries(body);
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const entry of entries) {
      const colonIndex = findTopLevelColon(entry);
      if (colonIndex === -1) continue;

      const rawKey = entry.slice(0, colonIndex).trim();
      const rawValue = entry.slice(colonIndex + 1).trim();
      if (!rawKey || !rawValue) continue;

      const key = rawKey.replace(/^['"]|['"]$/g, '');
      if (!key) continue;

      if (!rawValue.startsWith('z.')) continue;

      shape[key] = parseZodExpression(rawValue);
    }

    if (Object.keys(shape).length === 0) {
      return null;
    }

    return z.object(shape);
  } catch (error) {
    logger.warn('[CustomToolSchemaParser] Failed to parse tool input schema', {
      entryPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
