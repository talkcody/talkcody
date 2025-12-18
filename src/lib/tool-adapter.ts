import { tool } from 'ai';
import type { ToolExecuteContext, ToolInput, ToolOutput, ToolWithUI } from '@/types/tool';

// Context passed to tool UI renderers
export interface ToolUIContext {
  taskId?: string;
}

// Global registry to store UI renderers for tools
const toolUIRegistry = new Map<
  string,
  {
    renderToolDoing: (params: ToolInput, context?: ToolUIContext) => React.ReactElement;
    renderToolResult: (result: ToolOutput, params: ToolInput) => React.ReactElement;
  }
>();

export function registerToolUIRenderers(toolWithUI: ToolWithUI, keyName: string) {
  if (toolUIRegistry.has(keyName)) return;

  toolUIRegistry.set(keyName, {
    renderToolDoing: toolWithUI.renderToolDoing,
    renderToolResult: toolWithUI.renderToolResult,
  });
}

/**
 * Convert ToolWithUI to ai library compatible tool and register UI renderers
 */
export function convertToolForAI(toolWithUI: ToolWithUI, keyName: string) {
  registerToolUIRenderers(toolWithUI, keyName);

  // Use vercel ai's tool() for proper schema handling and JSON schema conversion
  // Don't provide execute - ToolExecutor will use the original execute with context
  const vercelTool = tool({
    description: toolWithUI.description,
    inputSchema: toolWithUI.inputSchema as any,
  });

  // Preserve ToolWithUI properties so ToolExecutor.isToolWithUI() returns true
  // and uses the correct execute signature with context
  const adaptedTool = vercelTool as typeof vercelTool & Partial<ToolWithUI>;
  (adaptedTool as any).renderToolDoing = toolWithUI.renderToolDoing;
  (adaptedTool as any).renderToolResult = toolWithUI.renderToolResult;
  // Add execute with the original that accepts (params, context)
  (adaptedTool as any).execute = toolWithUI.execute;

  return Object.defineProperty(adaptedTool, 'description', {
    get: () => toolWithUI.description,
    enumerable: true,
    configurable: true,
  });
}

/**
 * Get UI renderers for a tool
 */
export function getToolUIRenderers(toolName: string) {
  return toolUIRegistry.get(toolName);
}

/**
 * Convert a set of tools (mixed ToolWithUI and legacy) to ai library format
 */
export function convertToolsForAI(tools: Record<string, unknown>) {
  const aiTools: Record<string, any> = {};

  for (const [key, toolObj] of Object.entries(tools)) {
    if (toolObj && typeof toolObj === 'object') {
      // Check if it's a ToolWithUI
      if ('renderToolDoing' in toolObj && 'renderToolResult' in toolObj) {
        // logger.info('[ToolAdapter] Tool has UI renderers, registering:', key);
        aiTools[key] = convertToolForAI(toolObj as ToolWithUI, key);
      } else {
        // // It's already an adapted tool (e.g., MCP tool or previously converted tool)
        // logger.info('[ToolAdapter] Tool looks like a pre-adapted tool, using directly:', key);

        // Just use directly without re-wrapping
        aiTools[key] = toolObj as any;
      }
    }
  }

  return aiTools;
}
