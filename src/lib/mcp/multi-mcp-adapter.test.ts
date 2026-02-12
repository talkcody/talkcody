import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetEnabledMCPServers = vi.fn();
const mockGetMCPServer = vi.fn();
const mockListTools = vi.fn();
const mockCallTool = vi.fn();
const mockCreateTransport = vi.fn();

vi.mock('@/services/database-service', () => ({
  databaseService: {
    getEnabledMCPServers: mockGetEnabledMCPServers,
    getMCPServer: mockGetMCPServer,
  },
}));

vi.mock('./transport-factory', () => ({
  TransportFactory: {
    createTransport: mockCreateTransport,
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  class MockClient {
    connect = vi.fn(async () => undefined);
    listTools = mockListTools;
    callTool = mockCallTool;
  }

  return { Client: MockClient };
});

describe('MultiMCPAdapter', () => {
  const server = {
    id: 'server-1',
    name: 'Server One',
    url: 'http://localhost/mcp',
    protocol: 'http' as const,
    is_enabled: true,
    is_built_in: false,
    created_at: 0,
    updated_at: 0,
  };

  beforeEach(() => {
    vi.resetModules();
    mockGetEnabledMCPServers.mockReset();
    mockGetMCPServer.mockReset();
    mockListTools.mockReset();
    mockCallTool.mockReset();
    mockCreateTransport.mockReset();
  });

  it('loads tools via MCP client during initialization', async () => {
    mockGetEnabledMCPServers.mockResolvedValue([server]);
    mockListTools.mockResolvedValue({
      tools: [
        {
          name: 'ping',
          description: 'Ping tool',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
      ],
    });
    mockCreateTransport.mockReturnValue({});

    const { multiMCPAdapter } = await import('./multi-mcp-adapter');

    await multiMCPAdapter.initialize();
    const tools = await multiMCPAdapter.listServerTools(server.id);

    expect(mockCreateTransport).toHaveBeenCalledWith(server);
    expect(mockListTools).toHaveBeenCalled();
    expect(tools).toHaveLength(1);
    expect(tools[0]?.prefixedName).toBe('server-1__ping');
  });

  it('provides fallback schema when MCP tools do not supply one', async () => {
    mockGetEnabledMCPServers.mockResolvedValue([server]);
    mockListTools.mockResolvedValue({
      tools: [
        {
          name: 'ping',
          description: 'Ping tool',
        },
      ],
    });
    mockCreateTransport.mockReturnValue({});

    const { multiMCPAdapter } = await import('./multi-mcp-adapter');

    const tools = await multiMCPAdapter.getAdaptedTools();

    expect(tools['server-1__ping']).toEqual({
      description: 'Ping tool',
      inputSchema: { type: 'object', properties: {} },
    });
  });

  it('executes adapted tools through MCP client', async () => {
    mockGetEnabledMCPServers.mockResolvedValue([server]);
    mockListTools.mockResolvedValue({
      tools: [
        {
          name: 'search',
          description: 'Search tool',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
    });
    mockCreateTransport.mockReturnValue({});
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

    const { multiMCPAdapter } = await import('./multi-mcp-adapter');

    const tool = await multiMCPAdapter.getAdaptedTool('server-1__search');

    // Should use cached schema instead of calling listTools again
    expect(tool.inputSchema).toEqual({
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    });

    // Should have UI render methods
    expect(tool.renderToolDoing).toBeDefined();
    expect(tool.renderToolResult).toBeDefined();
    expect(tool.canConcurrent).toBe(true);

    const result = await tool.execute({ query: 'hello' });

    expect(mockCallTool).toHaveBeenCalledWith({
      name: 'search',
      arguments: { query: 'hello' },
    });
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
  });

  it('uses cached schema in getAdaptedTool without extra listTools call', async () => {
    mockGetEnabledMCPServers.mockResolvedValue([server]);
    mockListTools.mockResolvedValue({
      tools: [
        {
          name: 'mytool',
          description: 'My tool',
          inputSchema: {
            type: 'object',
            properties: { input: { type: 'string' } },
          },
        },
      ],
    });
    mockCreateTransport.mockReturnValue({});

    const { multiMCPAdapter } = await import('./multi-mcp-adapter');

    // initialize calls listTools once during connectToServer
    await multiMCPAdapter.initialize();
    expect(mockListTools).toHaveBeenCalledTimes(1);

    // getAdaptedTool should NOT call listTools again
    const tool = await multiMCPAdapter.getAdaptedTool('server-1__mytool');
    expect(mockListTools).toHaveBeenCalledTimes(1); // Still only 1 call

    expect(tool.inputSchema).toEqual({
      type: 'object',
      properties: { input: { type: 'string' } },
    });
  });
});
