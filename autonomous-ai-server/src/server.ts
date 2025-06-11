import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry } from './tools/tool-registry.js';
import { ResourceManager } from './resource-manager.js';

export class AutonomousAIServer {
  private server: Server;
  private toolRegistry: ToolRegistry;
  private resourceManager: ResourceManager;
  private workingDirectory: string;

  constructor(workingDirectory: string = process.cwd()) {
    this.workingDirectory = workingDirectory;
    this.server = new Server(
      {
        name: 'autonomous-ai-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.toolRegistry = new ToolRegistry(workingDirectory);
    this.resourceManager = new ResourceManager(workingDirectory);
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = this.toolRegistry.getToolDefinitions();
      return { tools };
    });

    // Execute tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const result = await this.toolRegistry.executeTool(name, args || {});
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${errorMessage}`
        );
      }
    });

    // List available resources
    this.server.setRequestHandler('resources/list', async () => {
      return this.resourceManager.listResources();
    });

    // Read resource content
    this.server.setRequestHandler('resources/read', async (request) => {
      const { uri } = request.params;
      return this.resourceManager.readResource(uri);
    });

    // Error handling
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Autonomous AI Server running on stdio');
  }

  async stop(): Promise<void> {
    await this.server.close();
  }
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const workingDirectory = process.argv[2] || process.cwd();
  const server = new AutonomousAIServer(workingDirectory);
  
  server.start().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}
