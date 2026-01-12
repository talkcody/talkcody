import { logger } from '@/lib/logger';
import type { CustomToolDefinition } from '@/types/custom-tool';
import type { ToolWithUI } from '@/types/tool';
import type { CustomToolLoadOptions, CustomToolSource } from './custom-tool-loader';
import { loadCustomTools } from './custom-tool-loader';
import { adaptCustomTools } from './custom-tool-registry';

export interface CustomToolLoadState {
  tools: ToolWithUI[];
  definitions: CustomToolDefinition[];
  errors: Array<{ name: string; filePath: string; error: string }>;
}

const SOURCE_PRIORITY: Record<CustomToolSource, number> = {
  custom: 3,
  workspace: 2,
  user: 1,
};

function isHigherPriority(next: CustomToolSource, current: CustomToolSource): boolean {
  return SOURCE_PRIORITY[next] > SOURCE_PRIORITY[current];
}

export async function loadCustomToolsForRegistry(
  options: CustomToolLoadOptions
): Promise<CustomToolLoadState> {
  const summary = await loadCustomTools(options);
  const definitions = new Map<
    string,
    { definition: CustomToolDefinition; source: CustomToolSource }
  >();

  for (const tool of summary.tools) {
    if (tool.status !== 'loaded' || !tool.tool) continue;
    const existing = definitions.get(tool.tool.name);
    if (!existing || isHigherPriority(tool.source, existing.source)) {
      definitions.set(tool.tool.name, { definition: tool.tool, source: tool.source });
    }
  }

  const adapted = adaptCustomTools([...definitions.values()].map((item) => item.definition));
  const tools = Object.values(adapted);

  logger.info('[CustomToolService] Custom tools loaded', {
    definitionCount: definitions.size,
    adaptedToolCount: tools.length,
    toolNames: tools.map((t) => (t as any).name || 'unknown'),
  });

  const errors = summary.tools
    .filter((tool) => tool.status === 'error')
    .map((tool) => ({
      name: tool.name,
      filePath: tool.filePath,
      error: tool.error || 'Unknown error',
    }));

  if (errors.length > 0) {
    logger.warn('[CustomToolService] Some custom tools failed to load', errors);
  }

  return { tools, definitions: [...definitions.values()].map((item) => item.definition), errors };
}
