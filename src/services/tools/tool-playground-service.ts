import { createPlaygroundModuleResolver } from '@/lib/custom-tool-sdk/import-map';
import { createSandbox, defaultPermissionRequest } from '@/lib/custom-tool-sdk/sandbox';
import { logger } from '@/lib/logger';
import type {
  CompileResult,
  ExecutionRecord,
  ExecutionResult,
  ParameterPreset,
  PlaygroundConfig,
  PlaygroundPermission,
  ToolTemplate,
} from '@/types/playground';
import type { ToolExecuteContext } from '@/types/tool';
import {
  compileCustomTool,
  createCustomToolModuleUrl,
  resolveCustomToolDefinition,
} from './custom-tool-compiler';

/**
 * Default playground configuration
 */
const DEFAULT_CONFIG: PlaygroundConfig = {
  allowedPermissions: ['net'],
  timeout: 30000,
  enableMocking: false,
};

/**
 * Pre-defined tool templates
 */
const TOOL_TEMPLATES: ToolTemplate[] = [
  {
    id: 'basic',
    name: 'Basic Tool',
    description: 'A basic tool template with simple input/output',
    category: 'basic',
    sourceCode: `import React from 'react';
import { toolHelper } from '@/lib/custom-tool-sdk';
import { z } from 'zod';

const argsSchema = z.object({
  message: z.string().min(1, 'message is required'),
});

export default toolHelper({
  name: 'basic_tool',
  description: 'A basic tool example',
  args: argsSchema,
  async execute(params) {
    return {
      success: true,
      message: \`Hello, \${params.message}!\`,
    };
  },
  renderToolDoing(params) {
    return <div>Processing: {params.message}</div>;
  },
  renderToolResult(result, params) {
    return <div>{result.message}</div>;
  },
});
`,
  },
  {
    id: 'network',
    name: 'Network Tool',
    description: 'A tool that makes HTTP requests',
    category: 'network',
    sourceCode: `import React from 'react';
import { toolHelper } from '@/lib/custom-tool-sdk';
import { simpleFetch } from '@/lib/tauri-fetch';
import { z } from 'zod';

const argsSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST']).default('GET'),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
});

/**
 * Parse response content based on Content-Type header
 * Supports JSON, HTML, XML, plain text, and binary formats
 */
async function parseResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.toLowerCase() || '';
  const status = response.status;
  const url = response.url;

  // Handle error status codes
  if (!response.ok) {
    const text = await response.text();
    return {
      error: true,
      status,
      message: \`HTTP \${status} \${response.statusText}\`,
      url,
      contentType,
      raw: text,
    };
  }

  // Handle JSON responses
  if (
    contentType.includes('application/json') ||
    contentType.includes('+json')
  ) {
    try {
      return await response.json();
    } catch {
      return {
        error: true,
        message: 'Failed to parse JSON response',
        status,
        url,
        contentType,
        raw: await response.text(),
      };
    }
  }

  // Handle HTML responses
  if (
    contentType.includes('text/html') ||
    contentType.includes('application/xhtml+xml')
  ) {
    const text = await response.text();
    const titleMatch = text.match(new RegExp('<title[^>]*>([^<]+)</title>', 'i'));
    const title = titleMatch ? titleMatch[1].trim() : undefined;

    const isErrorPage =
      text.toLowerCase().includes('not found') ||
      text.toLowerCase().includes('error') ||
      text.toLowerCase().includes('404') ||
      text.toLowerCase().includes('500');

    return {
      contentType: 'html',
      status,
      url,
      title,
      isErrorPage,
      raw: text,
    };
  }

  // Handle XML responses
  if (
    contentType.includes('application/xml') ||
    contentType.includes('text/xml') ||
    contentType.includes('application/rss+xml') ||
    contentType.includes('application/atom+xml')
  ) {
    const text = await response.text();
    return {
      contentType: 'xml',
      status,
      url,
      raw: text,
    };
  }

  // Handle plain text responses
  if (
    contentType.includes('text/plain') ||
    contentType.includes('text/csv') ||
    contentType.includes('text/css') ||
    contentType.includes('text/javascript') ||
    contentType.includes('application/javascript') ||
    contentType.includes('application/x-javascript')
  ) {
    const text = await response.text();
    return {
      contentType: contentType.split(';')[0].trim(),
      status,
      url,
      raw: text,
    };
  }

  // Handle binary data (images, files, etc.)
  if (
    contentType.includes('image/') ||
    contentType.includes('application/octet-stream') ||
    contentType.includes('application/pdf') ||
    contentType.includes('application/zip')
  ) {
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    return {
      contentType: 'binary',
      mimeType: contentType.split(';')[0].trim(),
      status,
      url,
      size: arrayBuffer.byteLength,
      base64: \`data:\${contentType};base64,\${base64}\`,
    };
  }

  // Default: try to parse as JSON, fallback to text
  try {
    const text = await response.text();
    try {
      return await response.json();
    } catch {
      return {
        contentType: contentType || 'text/plain',
        status,
        url,
        raw: text,
      };
    }
  } catch {
    return {
      error: true,
      message: 'Failed to read response',
      status,
      url,
      contentType,
    };
  }
}

/**
 * HTML Renderer component with toggle between rendered view and source code
 */
function HtmlRenderer({
  status,
  title,
  isErrorPage,
  html,
}: {
  status: number;
  title?: string;
  isErrorPage?: boolean;
  html: string;
}) {
  const [viewMode, setViewMode] = React.useState<'rendered' | 'source'>('rendered');

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() =>
            setViewMode(viewMode === 'rendered' ? 'source' : 'rendered')
          }
          className="ml-auto px-2 py-1 text-xs bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 rounded cursor-pointer transition-colors"
        >
          {viewMode === 'rendered' ? 'View Source' : 'View Rendered'}
        </button>
      </div>
      {viewMode === 'rendered' ? (
        <div
          className="border rounded p-2 bg-white dark:bg-gray-800 overflow-auto h-[500px]"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs overflow-auto h-[500px] border dark:border-gray-700">
          {html}
        </pre>
      )}
    </div>
  );
}

export default toolHelper({
  name: 'network_tool',
  description: 'Fetch data from a URL, supports any public web page',
  args: argsSchema,
  permissions: ['net'],
  async execute(params) {
    const fetchOptions: RequestInit = {
      method: params.method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TalkCody/1.0)',
        ...params.headers,
      },
    };

    if (params.body && params.method === 'POST') {
      fetchOptions.body = params.body as string;
    }

    const response = await simpleFetch(params.url, fetchOptions);
    const data = await parseResponse(response);

    return { success: true, data };
  },
  renderToolDoing(params) {
    return <div>Fetching {params.method} {params.url}...</div>;
  },
  renderToolResult(result) {
    if (!result || typeof result !== 'object') {
      return <div>No response data</div>;
    }

    const output = result as { data?: unknown };
    const data = output.data as Record<string, unknown> | undefined;

    // Handle error responses
    if (data?.error === true) {
      return (
        <div className="text-red-500">
          <div>{(data as Record<string, unknown>).message}</div>
          {(data as Record<string, unknown>).raw && (
            <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-auto max-h-60">
              {(data as Record<string, unknown>).raw as string}
            </pre>
          )}
        </div>
      );
    }

    // Handle binary responses (images)
    if (data?.contentType === 'binary' && (data as Record<string, unknown>).base64) {
      return (
        <div>
          <div>{(data as Record<string, unknown>).mimeType as string}</div>
          <div>Size: {(data as Record<string, unknown>).size as number} bytes</div>
          <img
            src={(data as Record<string, unknown>).base64 as string}
            alt="Response"
            className="mt-2 max-w-full rounded border"
          />
        </div>
      );
    }

    // Handle HTML responses
    if (data?.contentType === 'html') {
      const htmlData = data as {
        status: number;
        title?: string;
        isErrorPage?: boolean;
        raw: string;
      };

      return (
        <HtmlRenderer
          status={htmlData.status}
          title={htmlData.title}
          isErrorPage={htmlData.isErrorPage}
          html={htmlData.raw}
        />
      );
    }

    // Handle other raw text responses
    if ((data as Record<string, unknown>)?.raw) {
      return (
        <div>
          <div>Content-Type: {(data as Record<string, unknown>).contentType as string}</div>
          <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-auto max-h-60">
            {(data as Record<string, unknown>).raw as string}
          </pre>
        </div>
      );
    }

    // Default: show as JSON
    return <pre>{JSON.stringify(data ?? null, null, 2)}</pre>;
  },
});
`,
  },
];

type ZodSchemaLike = {
  safeParse?: (data: unknown) => {
    success: boolean;
    data?: Record<string, unknown>;
    error?: { errors?: Array<{ message: string }> };
  };
};

function parseToolParams(
  schema: unknown,
  params: Record<string, unknown>
): { success: true; data: Record<string, unknown> } | { success: false; error: string } {
  if (!schema || typeof schema !== 'object' || !('safeParse' in schema)) {
    return { success: true, data: params };
  }

  const parsed = (schema as ZodSchemaLike).safeParse?.(params);
  if (!parsed) {
    return { success: true, data: params };
  }

  if (parsed.success) {
    return { success: true, data: parsed.data ?? {} };
  }

  const errorMessage =
    parsed.error?.errors?.map((e) => e.message).join(', ') || 'Invalid parameters';
  return { success: false, error: errorMessage };
}

/**
 * Tool Playground Service
 * Manages playground compilation and execution
 */
export class ToolPlaygroundService {
  private sourceCode = '';
  private toolName = 'Untitled Tool';
  private config: PlaygroundConfig = { ...DEFAULT_CONFIG };
  private status: 'idle' | 'compiling' | 'executing' | 'error' | 'success' = 'idle';
  private compileResult?: CompileResult;
  private executionHistory: ExecutionRecord[] = [];
  private parameterPresets: ParameterPreset[] = [];

  /**
   * Initialize playground state
   */
  initialize(sourceCode: string, name: string, config: Partial<PlaygroundConfig> = {}): void {
    this.sourceCode = sourceCode;
    this.toolName = name;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.status = 'idle';
  }

  /**
   * Update source code
   */
  updateSourceCode(sourceCode: string): void {
    this.sourceCode = sourceCode;
    this.status = 'idle';
    this.compileResult = undefined;

    logger.info('[ToolPlaygroundService] Source code updated');
  }

  /**
   * Update config
   */
  updateConfig(config: Partial<PlaygroundConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current config
   */
  getConfig(): PlaygroundConfig {
    return { ...this.config };
  }

  /**
   * Get compile result
   */
  getCompileResult(): CompileResult | undefined {
    return this.compileResult;
  }

  /**
   * Get execution history
   */
  getExecutionHistory(): ExecutionRecord[] {
    return [...this.executionHistory];
  }

  /**
   * Clear execution history
   */
  clearExecutionHistory(): void {
    this.executionHistory = [];
  }

  /**
   * Get parameter presets
   */
  getParameterPresets(): ParameterPreset[] {
    return [...this.parameterPresets];
  }

  /**
   * Get current status
   */
  getStatus(): 'idle' | 'compiling' | 'executing' | 'error' | 'success' {
    return this.status;
  }

  /**
   * Get current tool name
   */
  getToolName(): string {
    return this.toolName;
  }

  /**
   * Set tool name
   */
  setToolName(name: string): void {
    this.toolName = name;
  }

  /**
   * Get current source code
   */
  getSourceCode(): string {
    return this.sourceCode;
  }

  /**
   * Compile a tool in playground
   */
  async compileTool(): Promise<CompileResult> {
    const startTime = Date.now();
    this.status = 'compiling';

    try {
      // Compile the source code
      const compiled = await compileCustomTool(this.sourceCode, {
        filename: `${this.toolName}.tsx`,
      });

      // Create module URL
      const moduleUrl = await createCustomToolModuleUrl(compiled, `${this.toolName}.tsx`);

      // Register playground module resolver
      createPlaygroundModuleResolver({
        permissions: this.config.allowedPermissions,
        mockFetch: this.config.enableMocking,
        timeout: this.config.timeout,
        playgroundId: 'playground',
      });

      // Resolve the tool definition
      const definition = await resolveCustomToolDefinition(moduleUrl);

      if (!definition) {
        throw new Error('Failed to resolve tool definition');
      }

      // Ensure name is set
      if (!definition.name) {
        definition.name = this.toolName;
      }

      const duration = Date.now() - startTime;

      const compileResult: CompileResult = {
        success: true,
        tool: definition,
        duration,
      };

      this.compileResult = compileResult;
      this.status = 'idle';

      logger.info('[ToolPlaygroundService] Tool compiled successfully', {
        toolName: definition.name,
        duration,
      });

      return compileResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      const compileResult: CompileResult = {
        success: false,
        error: errorMessage,
        duration,
      };

      this.compileResult = compileResult;
      this.status = 'error';

      logger.error('[ToolPlaygroundService] Tool compilation failed', {
        error: errorMessage,
        duration,
      });

      return compileResult;
    }
  }

  /**
   * Execute a tool in playground
   */
  async executeTool(
    params: Record<string, unknown>,
    grantedPermissions?: string[]
  ): Promise<ExecutionResult> {
    if (!this.compileResult?.success || !this.compileResult.tool) {
      throw new Error('Tool must be compiled before execution');
    }

    const startTime = Date.now();
    this.status = 'executing';

    const tool = this.compileResult.tool;
    const schema = tool.inputSchema ?? tool.args;
    const parsedParams = parseToolParams(schema, params);

    if (!parsedParams.success) {
      this.status = 'error';
      return {
        status: 'error',
        error: parsedParams.error,
        duration: 0,
        logs: [],
      };
    }

    try {
      // Create sandbox
      const sandbox = createSandbox(
        {
          allowedPermissions: this.config.allowedPermissions,
          timeout: this.config.timeout,
          enableMocking: this.config.enableMocking,
        },
        defaultPermissionRequest
      );

      // Create execution context
      const context: ToolExecuteContext = sandbox.createExecutionContext();

      // Execute tool with sandbox
      const { result, error } = await sandbox.executeSafely(
        () => tool.execute(parsedParams.data, context),
        tool.permissions || [],
        tool.name
      );

      const duration = Date.now() - startTime;

      const executionResult: ExecutionResult = {
        status: error ? 'error' : 'success',
        output: result,
        error,
        duration,
        logs: sandbox.getLogs(),
      };

      // Record execution
      const record: ExecutionRecord = {
        id: `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        params: parsedParams.data,
        result: executionResult,
        grantedPermissions: (grantedPermissions || []) as PlaygroundPermission[],
      };

      this.executionHistory.push(record);
      this.status = error ? 'error' : 'success';

      logger.info('[ToolPlaygroundService] Tool execution completed', {
        toolName: tool.name,
        status: executionResult.status,
        duration,
      });

      return executionResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorDetails = error instanceof Error ? String(error) : JSON.stringify(error);

      logger.error('[ToolPlaygroundService] Tool execution failed', {
        toolName: tool.name,
        error: errorMessage,
        errorStack,
        errorDetails,
        duration,
      });

      const executionResult: ExecutionResult = {
        status: 'error',
        error: `${errorMessage}\n${errorStack || ''}`,
        duration,
        logs: [],
      };

      this.status = 'error';

      return executionResult;
    }
  }

  /**
   * Create a parameter preset
   */
  createParameterPreset(
    name: string,
    params: Record<string, unknown>,
    description?: string
  ): ParameterPreset {
    const preset: ParameterPreset = {
      id: `preset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      description,
      params,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.parameterPresets.push(preset);

    return preset;
  }

  /**
   * Update a parameter preset
   */
  updateParameterPreset(presetId: string, updates: Partial<ParameterPreset>): void {
    const presetIndex = this.parameterPresets.findIndex((p) => p.id === presetId);
    if (presetIndex === -1) {
      throw new Error(`Preset not found: ${presetId}`);
    }

    const currentPreset = this.parameterPresets[presetIndex];
    if (!currentPreset) {
      throw new Error(`Preset at index ${presetIndex} is undefined`);
    }
    this.parameterPresets[presetIndex] = {
      id: currentPreset.id,
      name: currentPreset.name,
      description: currentPreset.description,
      params: currentPreset.params,
      createdAt: currentPreset.createdAt,
      updatedAt: Date.now(),
      ...updates,
    };
  }

  /**
   * Delete a parameter preset
   */
  deleteParameterPreset(presetId: string): void {
    this.parameterPresets = this.parameterPresets.filter((p) => p.id !== presetId);
  }

  /**
   * Get available templates
   */
  getTemplates(): ToolTemplate[] {
    return [...TOOL_TEMPLATES];
  }
}

// Global singleton instance
export const toolPlaygroundService = new ToolPlaygroundService();
