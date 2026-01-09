import { FolderOpen, Play, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/hooks/use-locale';
import { logger } from '@/lib/logger';
import { usePlaygroundStore } from '@/stores/playground-store';
import type { CustomToolDefinition } from '@/types/custom-tool';

interface ParameterPanelProps {
  tool: CustomToolDefinition;
  onExecute: (params: Record<string, unknown>) => Promise<void>;
  isExecuting: boolean;
}

export default function ParameterPanel({ tool, onExecute, isExecuting }: ParameterPanelProps) {
  const t = useTranslation();
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');

  const { parameterPresets, createParameterPreset, deleteParameterPreset, loadPreset } =
    usePlaygroundStore();

  const inputSchema = tool.inputSchema ?? tool.args;

  type SchemaNode = {
    _def?: {
      typeName?: string;
      innerType?: SchemaNode;
      defaultValue?: () => unknown;
      values?: string[];
      description?: string;
    };
    shape?: Record<string, SchemaNode>;
    safeParse?: (data: unknown) => { success: boolean; data?: Record<string, unknown> };
  };

  const schemaShape = useMemo(() => {
    const extractShape = (schema: unknown): Record<string, SchemaNode> => {
      if (!schema || typeof schema !== 'object') return {};

      if ('shape' in schema && typeof (schema as { shape?: unknown }).shape === 'object') {
        return (schema as { shape: Record<string, SchemaNode> }).shape ?? {};
      }

      const def = (schema as { _def?: { shape?: unknown; schema?: unknown } })._def;
      if (def?.shape) {
        const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
        if (shape && typeof shape === 'object') {
          return shape as Record<string, SchemaNode>;
        }
      }

      if (def?.schema) {
        return extractShape(def.schema);
      }

      return {};
    };

    return extractShape(inputSchema);
  }, [inputSchema]);

  const fieldMeta = useMemo(() => {
    const defaults: Record<string, unknown> = {};
    const optionalMap: Record<string, boolean> = {};
    const schemaMap: Record<string, SchemaNode | null> = {};

    if (inputSchema && typeof inputSchema === 'object' && 'safeParse' in inputSchema) {
      try {
        const sample = (inputSchema as SchemaNode).safeParse?.({});
        if (sample?.success && sample.data) {
          Object.assign(defaults, sample.data);
        }
      } catch (error) {
        logger.error('[ParameterPanel] safeParse error:', error);
        // Ignore parsing errors
      }
    }

    const unwrapSchemaNode = (schema?: SchemaNode | null) => {
      let current = schema;
      let isOptional = false;
      let defaultValue: unknown;
      const visited = new Set<SchemaNode>();

      while (current && !visited.has(current)) {
        visited.add(current);
        const def = current._def;
        const typeName = def?.typeName;
        const defType = (def as { type?: string })?.type;

        // Check both typeName (e.g., "ZodOptional") and def.type (e.g., "optional")
        if (typeName === 'ZodOptional' || defType === 'optional') {
          isOptional = true;
          current = def?.innerType ?? null;
          continue;
        }

        if (typeName === 'ZodDefault' || defType === 'default') {
          // Handle function defaultValue (typeName) and value defaultValue (def.type)
          let value: unknown;
          if (typeof def?.defaultValue === 'function') {
            value = def.defaultValue();
          } else if ((def as { defaultValue?: unknown }).defaultValue !== undefined) {
            value = (def as { defaultValue: unknown }).defaultValue;
          }
          if (value !== undefined) {
            defaultValue = value;
          }
          isOptional = true;
          current = def?.innerType ?? null;
          continue;
        }

        // For other types, check if they have typeName before continuing
        if (!typeName && !defType) {
          break;
        }

        // Continue only if we have a typeName to check
        if (typeName) {
          break;
        }

        break;
      }

      return { schema: current ?? schema, isOptional, defaultValue };
    };

    for (const [key, schema] of Object.entries(schemaShape)) {
      const { schema: unwrapped, isOptional, defaultValue } = unwrapSchemaNode(schema);
      if (defaultValue !== undefined && defaults[key] === undefined) {
        defaults[key] = defaultValue;
      }

      schemaMap[key] = unwrapped ?? schema;
      optionalMap[key] = isOptional;
    }

    logger.info('[ParameterPanel] Final fieldMeta:', { defaults, optionalMap, schemaMap });
    return { defaults, optionalMap, schemaMap };
  }, [inputSchema, schemaShape]);

  // Load default values from schema
  useEffect(() => {
    setParams((prev) => {
      const next = { ...fieldMeta.defaults };
      for (const [key, value] of Object.entries(prev)) {
        if (value !== undefined && value !== '') {
          next[key] = value;
        }
      }
      return next;
    });
  }, [fieldMeta.defaults]);

  // Handle parameter change
  const handleParamChange = (key: string, value: unknown) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  // Handle execute
  const handleExecute = async () => {
    try {
      // Validate params with Zod schema if available
      if (inputSchema && 'safeParse' in inputSchema) {
        const schema = inputSchema as {
          safeParse: (data: unknown) => {
            success: boolean;
            error?: {
              issues: Array<{ message: string; path: string[] }>;
            };
          };
        };
        const result = schema.safeParse(params);
        if (!result.success) {
          const _errors =
            result.error?.issues?.map((e) => `[${e.path.join('.')}] ${e.message}`).join('; ') || '';
          logger.warn('[ParameterPanel] Validation failed:', {
            issues: result.error?.issues,
            _errors,
          });
          toast.error(_errors || t.playground.error.validationFailed);
          return;
        }
      }

      await onExecute(params);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.playground.error.executionFailed);
    }
  };

  // Handle save preset
  const handleSavePreset = () => {
    try {
      const name = prompt(t.playground.presetNamePrompt);
      if (!name) return;

      createParameterPreset(name, params);
      toast.success(t.playground.presetSaved);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.playground.error.savePresetFailed);
    }
  };

  // Handle load preset
  const handleLoadPreset = () => {
    if (!selectedPresetId) return;

    try {
      const presetParams = loadPreset(selectedPresetId);
      setParams(presetParams);
      toast.success(t.playground.presetLoaded);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.playground.error.loadPresetFailed);
    }
  };

  // Handle delete preset
  const handleDeletePreset = () => {
    if (!selectedPresetId) return;

    if (confirm(t.playground.confirmDeletePreset)) {
      deleteParameterPreset(selectedPresetId);
      setSelectedPresetId('');
      toast.success(t.playground.presetDeleted);
    }
  };

  // Render input field based on Zod schema
  const renderInput = (key: string, schema: SchemaNode | null, value: unknown) => {
    const handleChange = (newValue: unknown) => handleParamChange(key, newValue);
    const defaultValue = fieldMeta.defaults[key];

    // Detect type from Zod schema - support both typeName and def.type
    const typeName = schema?._def?.typeName;
    const defType = (schema?._def as { type?: string })?.type;

    if (typeName === 'ZodString' || defType === 'string') {
      return (
        <Input
          value={String(value ?? '')}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={
            schema?._def?.description || (defaultValue !== undefined ? String(defaultValue) : '')
          }
        />
      );
    }

    if (typeName === 'ZodNumber' || defType === 'number') {
      return (
        <Input
          type="number"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => {
            const nextValue = e.target.value === '' ? undefined : Number(e.target.value);
            handleChange(nextValue);
          }}
          placeholder={defaultValue !== undefined ? String(defaultValue) : ''}
        />
      );
    }

    if (typeName === 'ZodBoolean' || defType === 'boolean') {
      return (
        <Select value={String(value ?? 'false')} onValueChange={(v) => handleChange(v === 'true')}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">true</SelectItem>
            <SelectItem value="false">false</SelectItem>
          </SelectContent>
        </Select>
      );
    }

    if (typeName === 'ZodEnum' || defType === 'enum') {
      // Zod stores enum values in options array or def.entries
      const defEntries = (schema?._def as { entries?: Record<string, string> })?.entries;
      const enumValues =
        (defEntries && Object.values(defEntries)) ||
        ((schema?._def as { values?: string[] })?.values as string[]) ||
        [];
      const defaultEnumValue = enumValues[0] || '';
      return (
        <Select value={String(value ?? defaultEnumValue)} onValueChange={handleChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {enumValues.map((val: string) => (
              <SelectItem key={val} value={val}>
                {val}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    // Default: textarea for complex types
    return (
      <Textarea
        value={typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '')}
        onChange={(e) => {
          try {
            handleChange(JSON.parse(e.target.value));
          } catch {
            handleChange(e.target.value);
          }
        }}
        rows={3}
      />
    );
  };

  // Try to extract field definitions from schema
  const getFields = () => {
    if (Object.keys(schemaShape).length > 0) {
      return Object.entries(schemaShape).map(([key, schema]) => [key, schema] as const);
    }

    // Fallback: use params keys
    return Object.entries(params).map(([key]) => [key, null]);
  };

  useEffect(() => {
    if (Object.keys(schemaShape).length > 0) {
      return;
    }

    // Reset params on source change when no schema exists
    setParams({});
  }, [schemaShape]);

  const fields = getFields();
  const hasSchema = Object.keys(schemaShape).length > 0;

  return (
    <div className="space-y-4">
      {/* Preset Management */}
      {parameterPresets.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <Label className="text-sm font-medium">{t.playground.parameterPresets}</Label>
            <Button variant="ghost" size="sm" onClick={handleSavePreset}>
              <Save className="w-4 h-4 mr-1" />
              {t.playground.savePreset}
            </Button>
          </div>
          <div className="flex gap-2">
            <Select value={selectedPresetId} onValueChange={setSelectedPresetId}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder={t.playground.selectPreset} />
              </SelectTrigger>
              <SelectContent>
                {parameterPresets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoadPreset}
              disabled={!selectedPresetId}
            >
              <FolderOpen className="w-4 h-4 mr-1" />
              {t.playground.load}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDeletePreset}
              disabled={!selectedPresetId}
            >
              {t.playground.delete ?? 'Delete'}
            </Button>
          </div>
        </Card>
      )}

      {/* Tool Description */}
      {tool.description && (
        <Card className="p-4">
          <div className="space-y-1">
            <h3 className="font-semibold">{tool.name}</h3>
            <p className="text-sm text-muted-foreground">
              {typeof tool.description === 'string'
                ? tool.description
                : typeof tool.description === 'object' && tool.description !== null
                  ? (tool.description as { en?: string; zh?: string }).en ||
                    (tool.description as { en?: string; zh?: string }).zh
                  : String(tool.description || '')}
            </p>
          </div>
        </Card>
      )}

      <Separator />

      {/* Parameters Form */}
      <div className="space-y-4">
        <h3 className="font-semibold">{t.playground.parameters}</h3>

        {fields.length === 0 ? (
          <div className="text-sm text-muted-foreground">{t.playground.noParameters}</div>
        ) : (
          <div className="space-y-4">
            {fields.map(([key, schema]) => {
              const fieldKey = key ?? '';
              const schemaFromMap = fieldMeta.schemaMap[fieldKey];
              const schemaNode: SchemaNode | null =
                schemaFromMap !== undefined ? schemaFromMap : (schema as SchemaNode | null);
              return (
                <div key={fieldKey} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={fieldKey}>{fieldKey}</Label>
                    <div className="flex gap-1.5">
                      {fieldMeta.optionalMap[fieldKey] && (
                        <Badge
                          variant="outline"
                          className="text-[10px] uppercase tracking-wide opacity-70"
                        >
                          {t.playground.optional}
                        </Badge>
                      )}
                      {fieldMeta.defaults[fieldKey] !== undefined && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] uppercase tracking-wide opacity-70"
                        >
                          {t.Common.default}: {String(fieldMeta.defaults[fieldKey])}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {renderInput(fieldKey, schemaNode, params[fieldKey])}
                </div>
              );
            })}
            {!hasSchema && fields.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {t.playground.parametersFromLastRun ?? 'Parameters from last run'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Execute Button */}
      <div className="pt-4">
        <Button className="w-full" size="lg" onClick={handleExecute} disabled={isExecuting}>
          {isExecuting ? (
            <>
              <div className="w-4 h-4 mr-2 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
              {t.playground.executing}
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2" />
              {t.playground.execute}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
