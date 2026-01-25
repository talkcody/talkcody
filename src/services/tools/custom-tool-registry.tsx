import { createTool } from '@/lib/create-tool';
import type { CustomToolDefinition } from '@/types/custom-tool';
import type { CustomToolPackageInfo } from '@/types/custom-tool-package';
import type { ToolExecuteContext, ToolWithUI } from '@/types/tool';
import { executePackagedToolWithBun } from './custom-tool-bun-runner';
import { CustomToolDoingFallback, CustomToolResultFallback } from './custom-tool-ui-fallback';

type CustomToolEntry = {
  definition: CustomToolDefinition;
  packageInfo?: CustomToolPackageInfo;
};

function fallbackDescription(definition: CustomToolDefinition) {
  return definition.description || definition.name;
}

export function adaptCustomTool(entry: CustomToolEntry): ToolWithUI {
  const { definition, packageInfo } = entry;
  const description = fallbackDescription(definition);

  const fallbackDoing = (_params: Record<string, unknown>) => {
    return <CustomToolDoingFallback toolName={definition.name} />;
  };

  const fallbackResult = (result: unknown, _params: Record<string, unknown>) => {
    if (result && typeof result === 'object') {
      const resultObj = result as { success?: boolean; error?: string };
      if (resultObj.success === false || resultObj.error) {
        return (
          <CustomToolResultFallback
            success={resultObj.success ?? false}
            error={resultObj.error || 'Custom tool failed'}
          />
        );
      }
    }

    const message = typeof result === 'string' ? result : 'Custom tool executed';
    return <CustomToolResultFallback message={message} success={true} />;
  };

  const renderToolDoing = definition.renderToolDoing ?? fallbackDoing;
  const renderToolResult = definition.renderToolResult ?? fallbackResult;

  const execute = async (params: Record<string, unknown>, context: ToolExecuteContext) => {
    if (packageInfo) {
      return await executePackagedToolWithBun(definition, packageInfo, params, context);
    }
    return await definition.execute(params as never, context);
  };

  return createTool({
    name: definition.name,
    description,
    inputSchema: definition.inputSchema,
    canConcurrent: definition.canConcurrent ?? false,
    hidden: definition.hidden,
    showResultUIAlways: definition.showResultUIAlways,
    execute,
    renderToolDoing,
    renderToolResult,
  });
}

export function adaptCustomTools(entries: CustomToolEntry[]): Record<string, ToolWithUI> {
  const tools: Record<string, ToolWithUI> = {};

  for (const entry of entries) {
    tools[entry.definition.name] = adaptCustomTool(entry);
  }

  return tools;
}
