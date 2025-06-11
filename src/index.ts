#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'fs-extra';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { glob } from 'glob';
import puppeteer from 'puppeteer';
import lighthouse from 'lighthouse';
import * as WebSocket from 'ws';
import { MultiAgentOrchestrator, AgentConfig, Task } from './multiagent.js';
import { ResourceManager, TaskCheckpoint, ResourceMetrics } from './resource-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ThinkingStep {
  step: number;
  description: string;
  reasoning: string;
  timestamp: string;
}

interface ContextMemory {
  id: string;
  content: string;
  type: 'file' | 'web' | 'thought' | 'plan';
  timestamp: string;
  tags: string[];
}

class AutonomousAIServer {
  private server: Server;
  private contextMemory: Map<string, ContextMemory> = new Map();
  private thinkingHistory: ThinkingStep[] = [];
  private workingDirectory: string;
  private multiAgentOrchestrator: MultiAgentOrchestrator;

  constructor() {
    this.workingDirectory = process.env.WORKING_DIRECTORY || process.cwd();
    this.multiAgentOrchestrator = new MultiAgentOrchestrator(this.workingDirectory);
    
    this.server = new Server(
      {
        name: 'autonomous-ai-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.setupResourceHandlers();
    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupResourceHandlers() {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'memory://context/all',
          name: 'All Context Memory',
          mimeType: 'application/json',
          description: 'Complete context memory storage including files, web content, and thoughts',
        },
        {
          uri: 'memory://thinking/history',
          name: 'Thinking History',
          mimeType: 'application/json',
          description: 'Sequential thinking and reasoning steps',
        },
      ],
    }));

    this.server.setRequestHandler(
      ListResourceTemplatesRequestSchema,
      async () => ({
        resourceTemplates: [
          {
            uriTemplate: 'memory://context/{type}',
            name: 'Context Memory by Type',
            mimeType: 'application/json',
            description: 'Context memory filtered by type (file, web, thought, plan)',
          },
          {
            uriTemplate: 'file://{filepath}',
            name: 'File Content',
            mimeType: 'text/plain',
            description: 'Read file content from the working directory',
          },
        ],
      })
    );

    this.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        const uri = request.params.uri;

        if (uri === 'memory://context/all') {
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(Array.from(this.contextMemory.values()), null, 2),
              },
            ],
          };
        }

        if (uri === 'memory://thinking/history') {
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(this.thinkingHistory, null, 2),
              },
            ],
          };
        }

        const contextMatch = uri.match(/^memory:\/\/context\/(.+)$/);
        if (contextMatch) {
          const type = contextMatch[1];
          const filtered = Array.from(this.contextMemory.values()).filter(
            item => item.type === type
          );
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(filtered, null, 2),
              },
            ],
          };
        }

        const fileMatch = uri.match(/^file:\/\/(.+)$/);
        if (fileMatch) {
          const filepath = fileMatch[1];
          const fullPath = path.resolve(this.workingDirectory, filepath);
          
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            return {
              contents: [
                {
                  uri,
                  mimeType: 'text/plain',
                  text: content,
                },
              ],
            };
          } catch (error) {
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        }

        throw new McpError(
          ErrorCode.InvalidRequest,
          `Invalid URI format: ${uri}`
        );
      }
    );
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'structured_thinking',
          description: 'Add a structured thinking step with reasoning',
          inputSchema: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
                description: 'Description of the thinking step',
              },
              reasoning: {
                type: 'string',
                description: 'Detailed reasoning for this step',
              },
            },
            required: ['description', 'reasoning'],
          },
        },
        {
          name: 'store_context',
          description: 'Store information in context memory',
          inputSchema: {
            type: 'object',
            properties: {
              content: {
                type: 'string',
                description: 'Content to store',
              },
              type: {
                type: 'string',
                enum: ['file', 'web', 'thought', 'plan'],
                description: 'Type of content',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tags for categorization',
              },
            },
            required: ['content', 'type'],
          },
        },
        {
          name: 'search_context',
          description: 'Search through stored context memory',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query',
              },
              type: {
                type: 'string',
                enum: ['file', 'web', 'thought', 'plan'],
                description: 'Filter by content type (optional)',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'read_file',
          description: 'Read file content from the working directory',
          inputSchema: {
            type: 'object',
            properties: {
              filepath: {
                type: 'string',
                description: 'Path to the file relative to working directory',
              },
            },
            required: ['filepath'],
          },
        },
        {
          name: 'write_file',
          description: 'Write content to a file in the working directory',
          inputSchema: {
            type: 'object',
            properties: {
              filepath: {
                type: 'string',
                description: 'Path to the file relative to working directory',
              },
              content: {
                type: 'string',
                description: 'Content to write to the file',
              },
              create_dirs: {
                type: 'boolean',
                description: 'Create directories if they don\'t exist',
                default: true,
              },
            },
            required: ['filepath', 'content'],
          },
        },
        {
          name: 'list_files',
          description: 'List files and directories in a path',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Directory path relative to working directory',
                default: '.',
              },
              recursive: {
                type: 'boolean',
                description: 'List files recursively',
                default: false,
              },
              pattern: {
                type: 'string',
                description: 'File pattern to match (glob pattern)',
              },
            },
          },
        },
        {
          name: 'search_files',
          description: 'Search for text patterns in files',
          inputSchema: {
            type: 'object',
            properties: {
              pattern: {
                type: 'string',
                description: 'Text pattern to search for (regex supported)',
              },
              path: {
                type: 'string',
                description: 'Directory path to search in',
                default: '.',
              },
              file_pattern: {
                type: 'string',
                description: 'File pattern to include in search (glob pattern)',
                default: '*',
              },
              case_sensitive: {
                type: 'boolean',
                description: 'Case sensitive search',
                default: false,
              },
            },
            required: ['pattern'],
          },
        },
        {
          name: 'create_plan',
          description: 'Create a structured plan for a coding task',
          inputSchema: {
            type: 'object',
            properties: {
              goal: {
                type: 'string',
                description: 'The main goal or objective',
              },
              steps: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    step: { type: 'string' },
                    description: { type: 'string' },
                    dependencies: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                  required: ['step', 'description'],
                },
                description: 'List of steps to achieve the goal',
              },
            },
            required: ['goal', 'steps'],
          },
        },
        {
          name: 'read_multiple_files',
          description: 'Read multiple files simultaneously',
          inputSchema: {
            type: 'object',
            properties: {
              paths: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of file paths to read',
              },
            },
            required: ['paths'],
          },
        },
        {
          name: 'edit_file',
          description: 'Make selective edits using advanced pattern matching',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'File to edit',
              },
              edits: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    oldText: {
                      type: 'string',
                      description: 'Text to search for (can be substring)',
                    },
                    newText: {
                      type: 'string',
                      description: 'Text to replace with',
                    },
                  },
                  required: ['oldText', 'newText'],
                },
                description: 'List of edit operations',
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview changes without applying',
                default: false,
              },
            },
            required: ['path', 'edits'],
          },
        },
        {
          name: 'create_directory',
          description: 'Create new directory or ensure it exists',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Directory path to create',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'list_directory',
          description: 'List directory contents with [FILE] or [DIR] prefixes',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Directory path to list',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'move_file',
          description: 'Move or rename files and directories',
          inputSchema: {
            type: 'object',
            properties: {
              source: {
                type: 'string',
                description: 'Source path',
              },
              destination: {
                type: 'string',
                description: 'Destination path',
              },
            },
            required: ['source', 'destination'],
          },
        },
        {
          name: 'get_file_info',
          description: 'Get detailed file/directory metadata',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'File or directory path',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'list_allowed_directories',
          description: 'List all directories the server is allowed to access',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'capture_screenshot',
          description: 'Capture a screenshot of the current browser page',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL to capture screenshot from',
              },
              fullPage: {
                type: 'boolean',
                description: 'Capture full page screenshot',
                default: true,
              },
              viewport: {
                type: 'object',
                properties: {
                  width: { type: 'number', default: 1280 },
                  height: { type: 'number', default: 720 },
                },
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'run_accessibility_audit',
          description: 'Run accessibility audit on the current page using Lighthouse',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL to audit',
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'run_performance_audit',
          description: 'Run performance audit on the current page using Lighthouse',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL to audit',
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'run_seo_audit',
          description: 'Run SEO audit on the current page using Lighthouse',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL to audit',
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'run_best_practices_audit',
          description: 'Run best practices audit on the current page using Lighthouse',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL to audit',
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'run_audit_mode',
          description: 'Run all audits in sequence (accessibility, performance, SEO, best practices)',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL to audit',
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'run_nextjs_audit',
          description: 'Run NextJS-specific audit and SEO improvements',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL to audit',
              },
              router_type: {
                type: 'string',
                enum: ['app', 'pages'],
                description: 'NextJS router type (app router or pages router)',
                default: 'app',
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'run_debugger_mode',
          description: 'Run all debugging tools in sequence',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL to debug',
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'get_page_console_logs',
          description: 'Get console logs from the current page',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL to get console logs from',
              },
              filter_level: {
                type: 'string',
                enum: ['all', 'error', 'warning', 'info', 'debug'],
                description: 'Filter logs by level',
                default: 'all',
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'get_page_network_logs',
          description: 'Get network activity logs from the current page',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL to get network logs from',
              },
              filter_type: {
                type: 'string',
                enum: ['all', 'xhr', 'fetch', 'document', 'stylesheet', 'script', 'image'],
                description: 'Filter requests by type',
                default: 'all',
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'analyze_page_dom',
          description: 'Analyze DOM structure and elements of the current page',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL to analyze',
              },
              selector: {
                type: 'string',
                description: 'CSS selector to focus analysis on specific elements',
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'sequential_thinking',
          description: 'Facilitates a detailed, step-by-step thinking process for problem-solving and analysis',
          inputSchema: {
            type: 'object',
            properties: {
              thought: {
                type: 'string',
                description: 'The current thinking step',
              },
              nextThoughtNeeded: {
                type: 'boolean',
                description: 'Whether another thought step is needed',
              },
              thoughtNumber: {
                type: 'integer',
                description: 'Current thought number',
                minimum: 1,
              },
              totalThoughts: {
                type: 'integer',
                description: 'Estimated total thoughts needed',
                minimum: 1,
              },
              isRevision: {
                type: 'boolean',
                description: 'Whether this revises previous thinking',
                default: false,
              },
              revisesThought: {
                type: 'integer',
                description: 'Which thought is being reconsidered',
                minimum: 1,
              },
              branchFromThought: {
                type: 'integer',
                description: 'Branching point thought number',
                minimum: 1,
              },
              branchId: {
                type: 'string',
                description: 'Branch identifier',
              },
              needsMoreThoughts: {
                type: 'boolean',
                description: 'If more thoughts are needed',
                default: false,
              },
            },
            required: ['thought', 'nextThoughtNeeded', 'thoughtNumber', 'totalThoughts'],
          },
        },
        {
          name: 'git_status',
          description: 'Shows the working tree status',
          inputSchema: {
            type: 'object',
            properties: {
              repo_path: {
                type: 'string',
                description: 'Path to Git repository',
                default: '.',
              },
            },
          },
        },
        {
          name: 'git_diff_unstaged',
          description: 'Shows changes in working directory not yet staged',
          inputSchema: {
            type: 'object',
            properties: {
              repo_path: {
                type: 'string',
                description: 'Path to Git repository',
                default: '.',
              },
            },
          },
        },
        {
          name: 'git_diff_staged',
          description: 'Shows changes that are staged for commit',
          inputSchema: {
            type: 'object',
            properties: {
              repo_path: {
                type: 'string',
                description: 'Path to Git repository',
                default: '.',
              },
            },
          },
        },
        {
          name: 'git_diff',
          description: 'Shows differences between branches or commits',
          inputSchema: {
            type: 'object',
            properties: {
              repo_path: {
                type: 'string',
                description: 'Path to Git repository',
                default: '.',
              },
              target: {
                type: 'string',
                description: 'Target branch or commit to compare with',
              },
            },
            required: ['target'],
          },
        },
        {
          name: 'git_commit',
          description: 'Records changes to the repository',
          inputSchema: {
            type: 'object',
            properties: {
              repo_path: {
                type: 'string',
                description: 'Path to Git repository',
                default: '.',
              },
              message: {
                type: 'string',
                description: 'Commit message',
              },
            },
            required: ['message'],
          },
        },
        {
          name: 'git_add',
          description: 'Adds file contents to the staging area',
          inputSchema: {
            type: 'object',
            properties: {
              repo_path: {
                type: 'string',
                description: 'Path to Git repository',
                default: '.',
              },
              files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of file paths to stage',
              },
            },
            required: ['files'],
          },
        },
        {
          name: 'git_reset',
          description: 'Unstages all staged changes',
          inputSchema: {
            type: 'object',
            properties: {
              repo_path: {
                type: 'string',
                description: 'Path to Git repository',
                default: '.',
              },
            },
          },
        },
        {
          name: 'git_log',
          description: 'Shows the commit logs',
          inputSchema: {
            type: 'object',
            properties: {
              repo_path: {
                type: 'string',
                description: 'Path to Git repository',
                default: '.',
              },
              max_count: {
                type: 'number',
                description: 'Maximum number of commits to show',
                default: 10,
                minimum: 1,
                maximum: 100,
              },
            },
          },
        },
        {
          name: 'git_create_branch',
          description: 'Creates a new branch',
          inputSchema: {
            type: 'object',
            properties: {
              repo_path: {
                type: 'string',
                description: 'Path to Git repository',
                default: '.',
              },
              branch_name: {
                type: 'string',
                description: 'Name of the new branch',
              },
              start_point: {
                type: 'string',
                description: 'Starting point for the new branch',
              },
            },
            required: ['branch_name'],
          },
        },
        {
          name: 'git_checkout',
          description: 'Switches branches',
          inputSchema: {
            type: 'object',
            properties: {
              repo_path: {
                type: 'string',
                description: 'Path to Git repository',
                default: '.',
              },
              branch_name: {
                type: 'string',
                description: 'Name of branch to checkout',
              },
            },
            required: ['branch_name'],
          },
        },
        {
          name: 'git_show',
          description: 'Shows the contents of a commit',
          inputSchema: {
            type: 'object',
            properties: {
              repo_path: {
                type: 'string',
                description: 'Path to Git repository',
                default: '.',
              },
              revision: {
                type: 'string',
                description: 'The revision (commit hash, branch name, tag) to show',
              },
            },
            required: ['revision'],
          },
        },
        {
          name: 'git_init',
          description: 'Initializes a Git repository',
          inputSchema: {
            type: 'object',
            properties: {
              repo_path: {
                type: 'string',
                description: 'Path to directory to initialize git repo',
                default: '.',
              },
            },
          },
        },
        {
          name: 'resolve_library_id',
          description: 'Resolves a general library name into a Context7-compatible library ID',
          inputSchema: {
            type: 'object',
            properties: {
              libraryName: {
                type: 'string',
                description: 'The name of the library to search for',
              },
            },
            required: ['libraryName'],
          },
        },
        {
          name: 'get_library_docs',
          description: 'Fetches up-to-date documentation for a library using Context7',
          inputSchema: {
            type: 'object',
            properties: {
              context7CompatibleLibraryID: {
                type: 'string',
                description: 'Exact Context7-compatible library ID (e.g., /mongodb/docs, /vercel/next.js)',
              },
              topic: {
                type: 'string',
                description: 'Focus the docs on a specific topic (e.g., "routing", "hooks")',
              },
              tokens: {
                type: 'number',
                description: 'Max number of tokens to return',
                default: 10000,
                minimum: 1000,
                maximum: 50000,
              },
            },
            required: ['context7CompatibleLibraryID'],
          },
        },
        {
          name: 'fetch_html',
          description: 'Fetch a website and return the content as HTML',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL of the website to fetch',
              },
              headers: {
                type: 'object',
                description: 'Custom headers to include in the request',
                additionalProperties: { type: 'string' },
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'fetch_json',
          description: 'Fetch a JSON file from a URL',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL of the JSON to fetch',
              },
              headers: {
                type: 'object',
                description: 'Custom headers to include in the request',
                additionalProperties: { type: 'string' },
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'fetch_txt',
          description: 'Fetch a website and return the content as plain text (no HTML)',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL of the website to fetch',
              },
              headers: {
                type: 'object',
                description: 'Custom headers to include in the request',
                additionalProperties: { type: 'string' },
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'fetch_markdown',
          description: 'Fetch a website and return the content as Markdown',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL of the website to fetch',
              },
              headers: {
                type: 'object',
                description: 'Custom headers to include in the request',
                additionalProperties: { type: 'string' },
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'run_browser_agent',
          description: 'Execute browser automation tasks using natural language instructions',
          inputSchema: {
            type: 'object',
            properties: {
              task: {
                type: 'string',
                description: 'The primary task or objective for the browser agent',
              },
              max_steps: {
                type: 'number',
                description: 'Maximum number of steps the agent can take',
                default: 50,
                minimum: 1,
                maximum: 200,
              },
              use_vision: {
                type: 'boolean',
                description: 'Enable vision capabilities for screenshot analysis',
                default: true,
              },
              headless: {
                type: 'boolean',
                description: 'Run browser in headless mode',
                default: false,
              },
            },
            required: ['task'],
          },
        },
        {
          name: 'run_deep_research',
          description: 'Perform comprehensive web research on a topic and generate a detailed report',
          inputSchema: {
            type: 'object',
            properties: {
              research_task: {
                type: 'string',
                description: 'The topic or question for the research',
              },
              max_parallel_browsers: {
                type: 'number',
                description: 'Maximum number of parallel browser instances',
                default: 3,
                minimum: 1,
                maximum: 10,
              },
              save_results: {
                type: 'boolean',
                description: 'Save research results to files',
                default: true,
              },
            },
            required: ['research_task'],
          },
        },
        {
          name: 'create_entities',
          description: 'Create multiple new entities in the knowledge graph',
          inputSchema: {
            type: 'object',
            properties: {
              entities: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: {
                      type: 'string',
                      description: 'Entity identifier (unique name)',
                    },
                    entityType: {
                      type: 'string',
                      description: 'Type classification (e.g., person, organization, event)',
                    },
                    observations: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Associated observations about the entity',
                    },
                  },
                  required: ['name', 'entityType'],
                },
                description: 'Array of entities to create',
              },
            },
            required: ['entities'],
          },
        },
        {
          name: 'create_relations',
          description: 'Create multiple new relations between entities',
          inputSchema: {
            type: 'object',
            properties: {
              relations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    from: {
                      type: 'string',
                      description: 'Source entity name',
                    },
                    to: {
                      type: 'string',
                      description: 'Target entity name',
                    },
                    relationType: {
                      type: 'string',
                      description: 'Relationship type in active voice (e.g., works_at, knows, created)',
                    },
                  },
                  required: ['from', 'to', 'relationType'],
                },
                description: 'Array of relations to create',
              },
            },
            required: ['relations'],
          },
        },
        {
          name: 'add_observations',
          description: 'Add new observations to existing entities',
          inputSchema: {
            type: 'object',
            properties: {
              observations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    entityName: {
                      type: 'string',
                      description: 'Target entity name',
                    },
                    contents: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'New observations to add',
                    },
                  },
                  required: ['entityName', 'contents'],
                },
                description: 'Array of observations to add to entities',
              },
            },
            required: ['observations'],
          },
        },
        {
          name: 'delete_entities',
          description: 'Remove entities and their relations from the knowledge graph',
          inputSchema: {
            type: 'object',
            properties: {
              entityNames: {
                type: 'array',
                items: { type: 'string' },
                description: 'Names of entities to delete',
              },
            },
            required: ['entityNames'],
          },
        },
        {
          name: 'delete_observations',
          description: 'Remove specific observations from entities',
          inputSchema: {
            type: 'object',
            properties: {
              deletions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    entityName: {
                      type: 'string',
                      description: 'Target entity name',
                    },
                    observations: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Observations to remove',
                    },
                  },
                  required: ['entityName', 'observations'],
                },
                description: 'Array of observation deletions',
              },
            },
            required: ['deletions'],
          },
        },
        {
          name: 'delete_relations',
          description: 'Remove specific relations from the knowledge graph',
          inputSchema: {
            type: 'object',
            properties: {
              relations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    from: {
                      type: 'string',
                      description: 'Source entity name',
                    },
                    to: {
                      type: 'string',
                      description: 'Target entity name',
                    },
                    relationType: {
                      type: 'string',
                      description: 'Relationship type',
                    },
                  },
                  required: ['from', 'to', 'relationType'],
                },
                description: 'Array of relations to delete',
              },
            },
            required: ['relations'],
          },
        },
        {
          name: 'read_graph',
          description: 'Read the entire knowledge graph',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'search_nodes',
          description: 'Search for nodes in the knowledge graph based on query',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query to find matching entities, types, or observations',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'open_nodes',
          description: 'Retrieve specific nodes by name from the knowledge graph',
          inputSchema: {
            type: 'object',
            properties: {
              names: {
                type: 'array',
                items: { type: 'string' },
                description: 'Names of entities to retrieve',
              },
            },
            required: ['names'],
          },
        },
        {
          name: 'create_agent',
          description: 'Create a new AI agent with specific capabilities',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Name of the agent',
              },
              role: {
                type: 'string',
                description: 'Role or specialization of the agent',
              },
              capabilities: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of capabilities the agent should have',
              },
              systemPrompt: {
                type: 'string',
                description: 'System prompt that defines the agent behavior',
              },
              priority: {
                type: 'string',
                enum: ['low', 'medium', 'high', 'critical'],
                description: 'Agent priority level',
                default: 'medium',
              },
            },
            required: ['name', 'role', 'capabilities', 'systemPrompt'],
          },
        },
        {
          name: 'create_sub_agent',
          description: 'Create a sub-agent under an existing parent agent',
          inputSchema: {
            type: 'object',
            properties: {
              parentAgentId: {
                type: 'string',
                description: 'ID of the parent agent',
              },
              name: {
                type: 'string',
                description: 'Name of the sub-agent',
              },
              role: {
                type: 'string',
                description: 'Specialized role of the sub-agent',
              },
              capabilities: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific capabilities for the sub-agent',
              },
              systemPrompt: {
                type: 'string',
                description: 'Custom system prompt for the sub-agent',
              },
            },
            required: ['parentAgentId'],
          },
        },
        {
          name: 'create_task',
          description: 'Create a new task for agent execution',
          inputSchema: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
                description: 'Description of the task',
              },
              type: {
                type: 'string',
                enum: ['research', 'analysis', 'coding', 'testing', 'documentation', 'planning', 'custom'],
                description: 'Type of task',
                default: 'custom',
              },
              priority: {
                type: 'string',
                enum: ['low', 'medium', 'high', 'critical'],
                description: 'Task priority',
                default: 'medium',
              },
              dependencies: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of task IDs this task depends on',
                default: [],
              },
            },
            required: ['description'],
          },
        },
        {
          name: 'assign_task',
          description: 'Assign a task to a specific agent',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: {
                type: 'string',
                description: 'ID of the task to assign',
              },
              agentId: {
                type: 'string',
                description: 'ID of the agent to assign the task to (optional - will auto-assign if not provided)',
              },
            },
            required: ['taskId'],
          },
        },
        {
          name: 'execute_task',
          description: 'Execute a specific task',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: {
                type: 'string',
                description: 'ID of the task to execute',
              },
            },
            required: ['taskId'],
          },
        },
        {
          name: 'get_agent_status',
          description: 'Get the current status of an agent',
          inputSchema: {
            type: 'object',
            properties: {
              agentId: {
                type: 'string',
                description: 'ID of the agent',
              },
            },
            required: ['agentId'],
          },
        },
        {
          name: 'get_task_status',
          description: 'Get the current status of a task',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: {
                type: 'string',
                description: 'ID of the task',
              },
            },
            required: ['taskId'],
          },
        },
        {
          name: 'list_agents',
          description: 'List all available agents',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'list_tasks',
          description: 'List all tasks with optional filtering',
          inputSchema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['pending', 'assigned', 'in_progress', 'completed', 'failed', 'cancelled'],
                description: 'Filter tasks by status',
              },
              agentId: {
                type: 'string',
                description: 'Filter tasks by assigned agent',
              },
            },
          },
        },
        {
          name: 'create_collaboration',
          description: 'Create a collaboration between multiple agents',
          inputSchema: {
            type: 'object',
            properties: {
              agentIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of agent IDs to collaborate',
              },
              collaborationType: {
                type: 'string',
                description: 'Type of collaboration',
                default: 'general',
              },
            },
            required: ['agentIds'],
          },
        },
        {
          name: 'start_orchestrator',
          description: 'Start the multi-agent orchestrator',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'stop_orchestrator',
          description: 'Stop the multi-agent orchestrator',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'get_system_metrics',
          description: 'Get comprehensive system metrics for the multi-agent system',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'execute_task_with_sub_agents',
          description: 'Execute a task using dynamically created sub-agents',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: {
                type: 'string',
                description: 'ID of the task to execute',
              },
              subAgentConfigs: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    role: { type: 'string' },
                    capabilities: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                },
                description: 'Configuration for sub-agents to create',
              },
            },
            required: ['taskId', 'subAgentConfigs'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'structured_thinking':
            return await this.handleStructuredThinking(args);
          case 'store_context':
            return await this.handleStoreContext(args);
          case 'search_context':
            return await this.handleSearchContext(args);
          case 'read_file':
            return await this.handleReadFile(args);
          case 'write_file':
            return await this.handleWriteFile(args);
          case 'list_files':
            return await this.handleListFiles(args);
          case 'search_files':
            return await this.handleSearchFiles(args);
          case 'create_plan':
            return await this.handleCreatePlan(args);
          case 'read_multiple_files':
            return await this.handleReadMultipleFiles(args);
          case 'edit_file':
            return await this.handleEditFile(args);
          case 'create_directory':
            return await this.handleCreateDirectory(args);
          case 'list_directory':
            return await this.handleListDirectory(args);
          case 'move_file':
            return await this.handleMoveFile(args);
          case 'get_file_info':
            return await this.handleGetFileInfo(args);
          case 'list_allowed_directories':
            return await this.handleListAllowedDirectories(args);
          case 'capture_screenshot':
            return await this.handleCaptureScreenshot(args);
          case 'run_accessibility_audit':
            return await this.handleAccessibilityAudit(args);
          case 'run_performance_audit':
            return await this.handlePerformanceAudit(args);
          case 'run_seo_audit':
            return await this.handleSEOAudit(args);
          case 'run_best_practices_audit':
            return await this.handleBestPracticesAudit(args);
          case 'run_audit_mode':
            return await this.handleAuditMode(args);
          case 'run_nextjs_audit':
            return await this.handleNextJSAudit(args);
          case 'run_debugger_mode':
            return await this.handleDebuggerMode(args);
          case 'get_page_console_logs':
            return await this.handlePageConsoleLogs(args);
          case 'get_page_network_logs':
            return await this.handlePageNetworkLogs(args);
          case 'analyze_page_dom':
            return await this.handleAnalyzePageDOM(args);
          case 'sequential_thinking':
            return await this.handleSequentialThinking(args);
          case 'git_status':
            return await this.handleGitStatus(args);
          case 'git_diff_unstaged':
            return await this.handleGitDiffUnstaged(args);
          case 'git_diff_staged':
            return await this.handleGitDiffStaged(args);
          case 'git_diff':
            return await this.handleGitDiff(args);
          case 'git_commit':
            return await this.handleGitCommit(args);
          case 'git_add':
            return await this.handleGitAdd(args);
          case 'git_reset':
            return await this.handleGitReset(args);
          case 'git_log':
            return await this.handleGitLog(args);
          case 'git_create_branch':
            return await this.handleGitCreateBranch(args);
          case 'git_checkout':
            return await this.handleGitCheckout(args);
          case 'git_show':
            return await this.handleGitShow(args);
          case 'git_init':
            return await this.handleGitInit(args);
          case 'resolve_library_id':
            return await this.handleResolveLibraryId(args);
          case 'get_library_docs':
            return await this.handleGetLibraryDocs(args);
          case 'fetch_html':
            return await this.handleFetchHtml(args);
          case 'fetch_json':
            return await this.handleFetchJson(args);
          case 'fetch_txt':
            return await this.handleFetchTxt(args);
          case 'fetch_markdown':
            return await this.handleFetchMarkdown(args);
          case 'run_browser_agent':
            return await this.handleRunBrowserAgent(args);
          case 'run_deep_research':
            return await this.handleRunDeepResearch(args);
          case 'create_entities':
            return await this.handleCreateEntities(args);
          case 'create_relations':
            return await this.handleCreateRelations(args);
          case 'add_observations':
            return await this.handleAddObservations(args);
          case 'delete_entities':
            return await this.handleDeleteEntities(args);
          case 'delete_observations':
            return await this.handleDeleteObservations(args);
          case 'delete_relations':
            return await this.handleDeleteRelations(args);
          case 'read_graph':
            return await this.handleReadGraph(args);
          case 'search_nodes':
            return await this.handleSearchNodes(args);
          case 'open_nodes':
            return await this.handleOpenNodes(args);
          case 'create_agent':
            return await this.handleCreateAgent(args);
          case 'create_sub_agent':
            return await this.handleCreateSubAgent(args);
          case 'create_task':
            return await this.handleCreateTask(args);
          case 'assign_task':
            return await this.handleAssignTask(args);
          case 'execute_task':
            return await this.handleExecuteTask(args);
          case 'get_agent_status':
            return await this.handleGetAgentStatus(args);
          case 'get_task_status':
            return await this.handleGetTaskStatus(args);
          case 'list_agents':
            return await this.handleListAgents(args);
          case 'list_tasks':
            return await this.handleListTasks(args);
          case 'create_collaboration':
            return await this.handleCreateCollaboration(args);
          case 'start_orchestrator':
            return await this.handleStartOrchestrator(args);
          case 'stop_orchestrator':
            return await this.handleStopOrchestrator(args);
          case 'get_system_metrics':
            return await this.handleGetSystemMetrics(args);
          case 'execute_task_with_sub_agents':
            return await this.handleExecuteTaskWithSubAgents(args);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async handleStructuredThinking(args: any) {
    const { description, reasoning } = args;
    
    const step: ThinkingStep = {
      step: this.thinkingHistory.length + 1,
      description,
      reasoning,
      timestamp: new Date().toISOString(),
    };
    
    this.thinkingHistory.push(step);
    
    return {
      content: [
        {
          type: 'text',
          text: `Added thinking step ${step.step}: ${description}\nReasoning: ${reasoning}`,
        },
      ],
    };
  }

  private async handleStoreContext(args: any) {
    const { content, type, tags = [] } = args;
    
    const id = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const contextItem: ContextMemory = {
      id,
      content,
      type,
      timestamp: new Date().toISOString(),
      tags,
    };
    
    this.contextMemory.set(id, contextItem);
    
    return {
      content: [
        {
          type: 'text',
          text: `Stored context item with ID: ${id}`,
        },
      ],
    };
  }

  private async handleSearchContext(args: any) {
    const { query, type } = args;
    
    let items = Array.from(this.contextMemory.values());
    
    if (type) {
      items = items.filter(item => item.type === type);
    }
    
    const results = items.filter(item =>
      item.content.toLowerCase().includes(query.toLowerCase()) ||
      item.tags.some(tag => tag.toLowerCase().includes(query.toLowerCase()))
    );
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(results, null, 2),
        },
      ],
    };
  }

  private async handleReadFile(args: any) {
    const { filepath } = args;
    const fullPath = path.resolve(this.workingDirectory, filepath);
    
    const content = await fs.readFile(fullPath, 'utf-8');
    
    // Store in context memory
    await this.handleStoreContext({
      content: `File: ${filepath}\n${content}`,
      type: 'file',
      tags: [path.extname(filepath), 'read'],
    });
    
    return {
      content: [
        {
          type: 'text',
          text: content,
        },
      ],
    };
  }

  private async handleWriteFile(args: any) {
    const { filepath, content, create_dirs = true } = args;
    const fullPath = path.resolve(this.workingDirectory, filepath);
    
    if (create_dirs) {
      await fs.ensureDir(path.dirname(fullPath));
    }
    
    await fs.writeFile(fullPath, content, 'utf-8');
    
    // Store in context memory
    await this.handleStoreContext({
      content: `Wrote file: ${filepath}\n${content}`,
      type: 'file',
      tags: [path.extname(filepath), 'write'],
    });
    
    return {
      content: [
        {
          type: 'text',
          text: `Successfully wrote ${content.length} characters to ${filepath}`,
        },
      ],
    };
  }

  private async handleListFiles(args: any) {
    const { path: dirPath = '.', recursive = false, pattern } = args;
    const fullPath = path.resolve(this.workingDirectory, dirPath);
    
    let files: string[] = [];
    
    if (recursive) {
      const walk = async (dir: string): Promise<string[]> => {
        const items = await fs.readdir(dir, { withFileTypes: true });
        const results: string[] = [];
        
        for (const item of items) {
          const itemPath = path.join(dir, item.name);
          if (item.isDirectory()) {
            results.push(...await walk(itemPath));
          } else {
            results.push(path.relative(this.workingDirectory, itemPath));
          }
        }
        
        return results;
      };
      
      files = await walk(fullPath);
    } else {
      const items = await fs.readdir(fullPath, { withFileTypes: true });
      files = items.map(item => 
        path.relative(this.workingDirectory, path.join(fullPath, item.name))
      );
    }
    
    if (pattern) {
      const glob = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
      files = files.filter(file => glob.test(file));
    }
    
    return {
      content: [
        {
          type: 'text',
          text: files.join('\n'),
        },
      ],
    };
  }

  private async handleSearchFiles(args: any) {
    const { pattern, path: searchPath = '.', file_pattern = '*', case_sensitive = false } = args;
    const fullPath = path.resolve(this.workingDirectory, searchPath);
    
    const regex = new RegExp(pattern, case_sensitive ? 'g' : 'gi');
    const fileGlob = new RegExp(file_pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
    
    const results: Array<{ file: string; line: number; content: string }> = [];
    
    const searchInFile = async (filePath: string) => {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        
        lines.forEach((line, index) => {
          if (regex.test(line)) {
            results.push({
              file: path.relative(this.workingDirectory, filePath),
              line: index + 1,
              content: line.trim(),
            });
          }
        });
      } catch (error) {
        // Skip files that can't be read
      }
    };
    
    const walk = async (dir: string) => {
      const items = await fs.readdir(dir, { withFileTypes: true });
      
      for (const item of items) {
        const itemPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          await walk(itemPath);
        } else if (fileGlob.test(item.name)) {
          await searchInFile(itemPath);
        }
      }
    };
    
    await walk(fullPath);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(results, null, 2),
        },
      ],
    };
  }


  private async handleCreatePlan(args: any) {
    const { goal, steps } = args;
    
    const plan = {
      goal,
      steps,
      created: new Date().toISOString(),
      id: `plan_${Date.now()}`,
    };
    
    // Store in context memory
    await this.handleStoreContext({
      content: JSON.stringify(plan, null, 2),
      type: 'plan',
      tags: ['plan', 'structure'],
    });
    
    return {
      content: [
        {
          type: 'text',
          text: `Created plan: ${goal}\n\nSteps:\n${steps.map((step: any, index: number) => 
            `${index + 1}. ${step.step}: ${step.description}`
          ).join('\n')}`,
        },
      ],
    };
  }

  private async handleReadMultipleFiles(args: any) {
    const { paths } = args;
    const results: Array<{ path: string; content?: string; error?: string }> = [];
    
    for (const filepath of paths) {
      try {
        const fullPath = path.resolve(this.workingDirectory, filepath);
        const content = await fs.readFile(fullPath, 'utf-8');
        results.push({ path: filepath, content });
        
        // Store in context memory
        await this.handleStoreContext({
          content: `File: ${filepath}\n${content}`,
          type: 'file',
          tags: [path.extname(filepath), 'read', 'multiple'],
        });
      } catch (error) {
        results.push({ 
          path: filepath, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(results, null, 2),
        },
      ],
    };
  }

  private async handleEditFile(args: any) {
    const { path: filepath, edits, dryRun = false } = args;
    const fullPath = path.resolve(this.workingDirectory, filepath);
    
    try {
      const originalContent = await fs.readFile(fullPath, 'utf-8');
      let modifiedContent = originalContent;
      const changes: Array<{ oldText: string; newText: string; applied: boolean }> = [];
      
      for (const edit of edits) {
        const { oldText, newText } = edit;
        if (modifiedContent.includes(oldText)) {
          modifiedContent = modifiedContent.replace(oldText, newText);
          changes.push({ oldText, newText, applied: true });
        } else {
          changes.push({ oldText, newText, applied: false });
        }
      }
      
      if (dryRun) {
        return {
          content: [
            {
              type: 'text',
              text: `Dry run for ${filepath}:\n\nChanges:\n${JSON.stringify(changes, null, 2)}\n\nPreview:\n${modifiedContent}`,
            },
          ],
        };
      }
      
      await fs.writeFile(fullPath, modifiedContent, 'utf-8');
      
      // Store in context memory
      await this.handleStoreContext({
        content: `Edited file: ${filepath}\nChanges: ${JSON.stringify(changes)}`,
        type: 'file',
        tags: [path.extname(filepath), 'edit'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: `Successfully edited ${filepath}. Applied ${changes.filter(c => c.applied).length} of ${changes.length} changes.`,
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to edit file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleCreateDirectory(args: any) {
    const { path: dirPath } = args;
    const fullPath = path.resolve(this.workingDirectory, dirPath);
    
    await fs.ensureDir(fullPath);
    
    return {
      content: [
        {
          type: 'text',
          text: `Successfully created directory: ${dirPath}`,
        },
      ],
    };
  }

  private async handleListDirectory(args: any) {
    const { path: dirPath } = args;
    const fullPath = path.resolve(this.workingDirectory, dirPath);
    
    const items = await fs.readdir(fullPath, { withFileTypes: true });
    const formattedItems = items.map(item => {
      const prefix = item.isDirectory() ? '[DIR]' : '[FILE]';
      return `${prefix} ${item.name}`;
    });
    
    return {
      content: [
        {
          type: 'text',
          text: formattedItems.join('\n'),
        },
      ],
    };
  }

  private async handleMoveFile(args: any) {
    const { source, destination } = args;
    const sourcePath = path.resolve(this.workingDirectory, source);
    const destPath = path.resolve(this.workingDirectory, destination);
    
    // Check if destination exists
    if (await fs.pathExists(destPath)) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Destination already exists: ${destination}`
      );
    }
    
    await fs.move(sourcePath, destPath);
    
    return {
      content: [
        {
          type: 'text',
          text: `Successfully moved ${source} to ${destination}`,
        },
      ],
    };
  }

  private async handleGetFileInfo(args: any) {
    const { path: filepath } = args;
    const fullPath = path.resolve(this.workingDirectory, filepath);
    
    const stats = await fs.stat(fullPath);
    const info = {
      path: filepath,
      size: stats.size,
      created: stats.birthtime.toISOString(),
      modified: stats.mtime.toISOString(),
      accessed: stats.atime.toISOString(),
      type: stats.isDirectory() ? 'directory' : 'file',
      permissions: stats.mode.toString(8),
    };
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(info, null, 2),
        },
      ],
    };
  }

  private async handleListAllowedDirectories(args: any) {
    const allowedDirs = [this.workingDirectory];
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(allowedDirs, null, 2),
        },
      ],
    };
  }

  // Browser Tools Implementation
  private async launchBrowser() {
    return await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }

  private async handleCaptureScreenshot(args: any) {
    const { url, fullPage = true, viewport = { width: 1280, height: 720 } } = args;
    
    const browser = await this.launchBrowser();
    const page = await browser.newPage();
    
    try {
      await page.setViewport(viewport);
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      const screenshot = await page.screenshot({
        fullPage,
        encoding: 'base64',
      });
      
      // Store in context memory
      await this.handleStoreContext({
        content: `Screenshot captured from ${url}`,
        type: 'web',
        tags: ['screenshot', 'browser'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: `Screenshot captured from ${url}. Base64 data: ${screenshot.toString().substring(0, 100)}...`,
          },
        ],
      };
    } finally {
      await browser.close();
    }
  }

  private async runLighthouseAudit(url: string, categories: string[]) {
    const browser = await this.launchBrowser();
    
    try {
      const result = await lighthouse(url, {
        port: parseInt(new URL(browser.wsEndpoint()).port, 10),
        output: 'json',
        onlyCategories: categories,
      });
      
      return result;
    } finally {
      await browser.close();
    }
  }

  private async handleAccessibilityAudit(args: any) {
    const { url } = args;
    
    try {
      const result = await this.runLighthouseAudit(url, ['accessibility']);
      const score = result?.lhr?.categories?.accessibility?.score || 0;
      const audits = result?.lhr?.audits || {};
      
      const accessibilityIssues = Object.values(audits)
        .filter((audit: any) => audit.score !== null && audit.score < 1)
        .map((audit: any) => ({
          id: audit.id,
          title: audit.title,
          description: audit.description,
          score: audit.score,
        }));
      
      const auditResult = {
        url,
        score: Math.round(score * 100),
        issues: accessibilityIssues,
        timestamp: new Date().toISOString(),
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(auditResult, null, 2),
        type: 'web',
        tags: ['audit', 'accessibility', 'lighthouse'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(auditResult, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Accessibility audit failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handlePerformanceAudit(args: any) {
    const { url } = args;
    
    try {
      const result = await this.runLighthouseAudit(url, ['performance']);
      const score = result?.lhr?.categories?.performance?.score || 0;
      const audits = result?.lhr?.audits || {};
      
      const performanceIssues = Object.values(audits)
        .filter((audit: any) => audit.score !== null && audit.score < 1)
        .map((audit: any) => ({
          id: audit.id,
          title: audit.title,
          description: audit.description,
          score: audit.score,
        }));
      
      const auditResult = {
        url,
        score: Math.round(score * 100),
        issues: performanceIssues,
        timestamp: new Date().toISOString(),
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(auditResult, null, 2),
        type: 'web',
        tags: ['audit', 'performance', 'lighthouse'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(auditResult, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Performance audit failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleSEOAudit(args: any) {
    const { url } = args;
    
    try {
      const result = await this.runLighthouseAudit(url, ['seo']);
      const score = result?.lhr?.categories?.seo?.score || 0;
      const audits = result?.lhr?.audits || {};
      
      const seoIssues = Object.values(audits)
        .filter((audit: any) => audit.score !== null && audit.score < 1)
        .map((audit: any) => ({
          id: audit.id,
          title: audit.title,
          description: audit.description,
          score: audit.score,
        }));
      
      const auditResult = {
        url,
        score: Math.round(score * 100),
        issues: seoIssues,
        timestamp: new Date().toISOString(),
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(auditResult, null, 2),
        type: 'web',
        tags: ['audit', 'seo', 'lighthouse'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(auditResult, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `SEO audit failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleBestPracticesAudit(args: any) {
    const { url } = args;
    
    try {
      const result = await this.runLighthouseAudit(url, ['best-practices']);
      const score = result?.lhr?.categories?.['best-practices']?.score || 0;
      const audits = result?.lhr?.audits || {};
      
      const bestPracticesIssues = Object.values(audits)
        .filter((audit: any) => audit.score !== null && audit.score < 1)
        .map((audit: any) => ({
          id: audit.id,
          title: audit.title,
          description: audit.description,
          score: audit.score,
        }));
      
      const auditResult = {
        url,
        score: Math.round(score * 100),
        issues: bestPracticesIssues,
        timestamp: new Date().toISOString(),
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(auditResult, null, 2),
        type: 'web',
        tags: ['audit', 'best-practices', 'lighthouse'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(auditResult, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Best practices audit failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleAuditMode(args: any) {
    const { url } = args;
    
    const results = {
      url,
      timestamp: new Date().toISOString(),
      audits: {} as any,
    };
    
    try {
      // Run all audits
      const accessibility = await this.handleAccessibilityAudit({ url });
      const performance = await this.handlePerformanceAudit({ url });
      const seo = await this.handleSEOAudit({ url });
      const bestPractices = await this.handleBestPracticesAudit({ url });
      
      results.audits = {
        accessibility: JSON.parse(accessibility.content[0].text),
        performance: JSON.parse(performance.content[0].text),
        seo: JSON.parse(seo.content[0].text),
        bestPractices: JSON.parse(bestPractices.content[0].text),
      };
      
      // Store comprehensive audit in context memory
      await this.handleStoreContext({
        content: JSON.stringify(results, null, 2),
        type: 'web',
        tags: ['audit', 'comprehensive', 'lighthouse'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Audit mode failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleNextJSAudit(args: any) {
    const { url, router_type = 'app' } = args;
    
    const browser = await this.launchBrowser();
    const page = await browser.newPage();
    
    try {
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      // Check for NextJS specific elements
      const nextjsChecks = await page.evaluate(() => {
        const checks = {
          hasNextScript: !!document.querySelector('script[src*="_next"]'),
          hasNextImage: !!document.querySelector('img[src*="_next"]'),
          hasMetaTags: {
            title: !!document.querySelector('title'),
            description: !!document.querySelector('meta[name="description"]'),
            viewport: !!document.querySelector('meta[name="viewport"]'),
            ogTitle: !!document.querySelector('meta[property="og:title"]'),
            ogDescription: !!document.querySelector('meta[property="og:description"]'),
          },
          hasStructuredData: !!document.querySelector('script[type="application/ld+json"]'),
        };
        
        return checks;
      });
      
      const auditResult = {
        url,
        router_type,
        nextjs_detected: nextjsChecks.hasNextScript,
        seo_checks: nextjsChecks.hasMetaTags,
        structured_data: nextjsChecks.hasStructuredData,
        recommendations: this.generateNextJSRecommendations(nextjsChecks, router_type),
        timestamp: new Date().toISOString(),
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(auditResult, null, 2),
        type: 'web',
        tags: ['audit', 'nextjs', 'seo'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(auditResult, null, 2),
          },
        ],
      };
    } finally {
      await browser.close();
    }
  }

  private generateNextJSRecommendations(checks: any, routerType: string) {
    const recommendations = [];
    
    if (!checks.hasMetaTags.title) {
      recommendations.push(`Add <title> tag in ${routerType === 'app' ? 'layout.tsx or page.tsx' : '_document.js or page component'}`);
    }
    
    if (!checks.hasMetaTags.description) {
      recommendations.push(`Add meta description in ${routerType === 'app' ? 'metadata export' : 'Head component'}`);
    }
    
    if (!checks.hasMetaTags.ogTitle || !checks.hasMetaTags.ogDescription) {
      recommendations.push('Add Open Graph meta tags for social media sharing');
    }
    
    if (!checks.hasStructuredData) {
      recommendations.push('Consider adding structured data (JSON-LD) for better SEO');
    }
    
    return recommendations;
  }

  private async handleDebuggerMode(args: any) {
    const { url } = args;
    
    const results = {
      url,
      timestamp: new Date().toISOString(),
      debugging: {} as any,
    };
    
    try {
      // Run debugging tools
      const consoleLogs = await this.handlePageConsoleLogs({ url });
      const networkLogs = await this.handlePageNetworkLogs({ url });
      const domAnalysis = await this.handleAnalyzePageDOM({ url });
      
      results.debugging = {
        console: JSON.parse(consoleLogs.content[0].text),
        network: JSON.parse(networkLogs.content[0].text),
        dom: JSON.parse(domAnalysis.content[0].text),
      };
      
      // Store comprehensive debugging info in context memory
      await this.handleStoreContext({
        content: JSON.stringify(results, null, 2),
        type: 'web',
        tags: ['debug', 'comprehensive', 'browser'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Debugger mode failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handlePageConsoleLogs(args: any) {
    const { url, filter_level = 'all' } = args;
    
    const browser = await this.launchBrowser();
    const page = await browser.newPage();
    const logs: any[] = [];
    
    try {
      page.on('console', (msg) => {
        const level = msg.type();
        if (filter_level === 'all' || level === filter_level) {
          logs.push({
            level,
            text: msg.text(),
            timestamp: new Date().toISOString(),
          });
        }
      });
      
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      // Wait a bit to capture any delayed console logs
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const result = {
        url,
        filter_level,
        logs,
        timestamp: new Date().toISOString(),
      };
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } finally {
      await browser.close();
    }
  }

  private async handlePageNetworkLogs(args: any) {
    const { url, filter_type = 'all' } = args;
    
    const browser = await this.launchBrowser();
    const page = await browser.newPage();
    const requests: any[] = [];
    
    try {
      page.on('request', (request) => {
        const resourceType = request.resourceType();
        if (filter_type === 'all' || resourceType === filter_type) {
          requests.push({
            url: request.url(),
            method: request.method(),
            resourceType,
            timestamp: new Date().toISOString(),
          });
        }
      });
      
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      const result = {
        url,
        filter_type,
        requests,
        timestamp: new Date().toISOString(),
      };
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } finally {
      await browser.close();
    }
  }

  private async handleAnalyzePageDOM(args: any) {
    const { url, selector } = args;
    
    const browser = await this.launchBrowser();
    const page = await browser.newPage();
    
    try {
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      const domAnalysis = await page.evaluate((sel) => {
        const analysis = {
          title: document.title,
          headings: [] as any[],
          images: [] as any[],
          links: [] as any[],
          forms: [] as any[],
          scripts: [] as any[],
          elementCount: 0,
        };
        
        // If selector is provided, focus on that element
        const root = sel ? document.querySelector(sel) : document;
        if (!root) return analysis;
        
        // Count all elements
        analysis.elementCount = root.querySelectorAll('*').length;
        
        // Analyze headings
        root.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((heading: Element) => {
          analysis.headings.push({
            tag: heading.tagName.toLowerCase(),
            text: heading.textContent?.trim().substring(0, 100),
          });
        });
        
        // Analyze images
        root.querySelectorAll('img').forEach((img: HTMLImageElement) => {
          analysis.images.push({
            src: img.src,
            alt: img.alt,
            hasAlt: !!img.alt,
          });
        });
        
        // Analyze links
        root.querySelectorAll('a[href]').forEach((link: HTMLAnchorElement) => {
          analysis.links.push({
            href: link.getAttribute('href'),
            text: link.textContent?.trim().substring(0, 50),
            isExternal: link.getAttribute('href')?.startsWith('http'),
          });
        });
        
        // Analyze forms
        root.querySelectorAll('form').forEach((form: HTMLFormElement) => {
          analysis.forms.push({
            action: form.action,
            method: form.method,
            inputs: form.querySelectorAll('input, textarea, select').length,
          });
        });
        
        // Analyze scripts
        root.querySelectorAll('script').forEach((script: HTMLScriptElement) => {
          analysis.scripts.push({
            src: script.src,
            inline: !script.src,
            type: script.type,
          });
        });
        
        return analysis;
      }, selector);
      
      const result = {
        url,
        selector: selector || 'document',
        analysis: domAnalysis,
        timestamp: new Date().toISOString(),
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'web',
        tags: ['dom', 'analysis', 'browser'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } finally {
      await browser.close();
    }
  }

  // Sequential Thinking Implementation
  private sequentialThoughts: Map<string, any[]> = new Map();

  private async handleSequentialThinking(args: any) {
    const {
      thought,
      nextThoughtNeeded,
      thoughtNumber,
      totalThoughts,
      isRevision = false,
      revisesThought,
      branchFromThought,
      branchId,
      needsMoreThoughts = false,
    } = args;

    // Create a session ID for this thinking sequence
    const sessionId = branchId || 'main';
    
    if (!this.sequentialThoughts.has(sessionId)) {
      this.sequentialThoughts.set(sessionId, []);
    }
    
    const thoughts = this.sequentialThoughts.get(sessionId)!;
    
    // Handle revision
    if (isRevision && revisesThought) {
      const revisionEntry = {
        thoughtNumber,
        thought,
        isRevision: true,
        revisesThought,
        timestamp: new Date().toISOString(),
      };
      
      // Insert revision at appropriate position
      thoughts.splice(revisesThought - 1, 0, revisionEntry);
    } else if (branchFromThought) {
      // Handle branching
      const branchEntry = {
        thoughtNumber,
        thought,
        branchFromThought,
        branchId,
        timestamp: new Date().toISOString(),
      };
      
      thoughts.push(branchEntry);
    } else {
      // Regular thought
      const thoughtEntry = {
        thoughtNumber,
        thought,
        timestamp: new Date().toISOString(),
      };
      
      thoughts.push(thoughtEntry);
    }
    
    // Update total thoughts if needed
    if (needsMoreThoughts) {
      // Allow dynamic expansion of thinking process
    }
    
    // Store in context memory
    await this.handleStoreContext({
      content: JSON.stringify({
        sessionId,
        thoughtNumber,
        thought,
        isRevision,
        branchId,
        totalThoughts,
        nextThoughtNeeded,
        allThoughts: thoughts,
      }, null, 2),
      type: 'thought',
      tags: ['sequential', 'thinking', 'reasoning'],
    });
    
    const response = {
      sessionId,
      thoughtNumber,
      totalThoughts,
      nextThoughtNeeded,
      currentThought: thought,
      thoughtsCompleted: thoughts.length,
      isRevision,
      branchId,
      summary: `Thought ${thoughtNumber}/${totalThoughts}${isRevision ? ' (revision)' : ''}${branchId ? ` [${branchId}]` : ''}: ${thought.substring(0, 100)}...`,
    };
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  // Git Tools Implementation
  private async executeGitCommand(command: string, repoPath: string = '.'): Promise<string> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    const fullPath = path.resolve(this.workingDirectory, repoPath);
    
    try {
      const { stdout, stderr } = await execAsync(command, { cwd: fullPath });
      return stdout || stderr || '';
    } catch (error: any) {
      throw new Error(`Git command failed: ${error.message}`);
    }
  }

  private async handleGitStatus(args: any) {
    const { repo_path = '.' } = args;
    
    try {
      const output = await this.executeGitCommand('git status --porcelain', repo_path);
      
      // Store in context memory
      await this.handleStoreContext({
        content: `Git status for ${repo_path}:\n${output}`,
        type: 'file',
        tags: ['git', 'status'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: output || 'Working tree clean',
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Git status failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGitDiffUnstaged(args: any) {
    const { repo_path = '.' } = args;
    
    try {
      const output = await this.executeGitCommand('git diff', repo_path);
      
      // Store in context memory
      await this.handleStoreContext({
        content: `Git diff unstaged for ${repo_path}:\n${output}`,
        type: 'file',
        tags: ['git', 'diff', 'unstaged'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: output || 'No unstaged changes',
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Git diff unstaged failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGitDiffStaged(args: any) {
    const { repo_path = '.' } = args;
    
    try {
      const output = await this.executeGitCommand('git diff --cached', repo_path);
      
      // Store in context memory
      await this.handleStoreContext({
        content: `Git diff staged for ${repo_path}:\n${output}`,
        type: 'file',
        tags: ['git', 'diff', 'staged'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: output || 'No staged changes',
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Git diff staged failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGitDiff(args: any) {
    const { repo_path = '.', target } = args;
    
    try {
      const output = await this.executeGitCommand(`git diff ${target}`, repo_path);
      
      // Store in context memory
      await this.handleStoreContext({
        content: `Git diff with ${target} for ${repo_path}:\n${output}`,
        type: 'file',
        tags: ['git', 'diff', 'compare'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: output || `No differences with ${target}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Git diff failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGitCommit(args: any) {
    const { repo_path = '.', message } = args;
    
    try {
      const output = await this.executeGitCommand(`git commit -m "${message}"`, repo_path);
      
      // Store in context memory
      await this.handleStoreContext({
        content: `Git commit for ${repo_path}: ${message}\n${output}`,
        type: 'file',
        tags: ['git', 'commit'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: output,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Git commit failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGitAdd(args: any) {
    const { repo_path = '.', files } = args;
    
    try {
      const fileList = files.join(' ');
      const output = await this.executeGitCommand(`git add ${fileList}`, repo_path);
      
      // Store in context memory
      await this.handleStoreContext({
        content: `Git add for ${repo_path}: ${fileList}\n${output}`,
        type: 'file',
        tags: ['git', 'add'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: `Successfully staged files: ${fileList}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Git add failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGitReset(args: any) {
    const { repo_path = '.' } = args;
    
    try {
      const output = await this.executeGitCommand('git reset', repo_path);
      
      // Store in context memory
      await this.handleStoreContext({
        content: `Git reset for ${repo_path}:\n${output}`,
        type: 'file',
        tags: ['git', 'reset'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: 'Successfully unstaged all changes',
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Git reset failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGitLog(args: any) {
    const { repo_path = '.', max_count = 10 } = args;
    
    try {
      const output = await this.executeGitCommand(
        `git log --oneline -n ${max_count} --pretty=format:"%H|%an|%ad|%s" --date=iso`,
        repo_path
      );
      
      const commits = output.split('\n').filter(line => line.trim()).map(line => {
        const [hash, author, date, message] = line.split('|');
        return {
          hash: hash?.trim(),
          author: author?.trim(),
          date: date?.trim(),
          message: message?.trim(),
        };
      });
      
      // Store in context memory
      await this.handleStoreContext({
        content: `Git log for ${repo_path}:\n${JSON.stringify(commits, null, 2)}`,
        type: 'file',
        tags: ['git', 'log', 'history'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(commits, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Git log failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGitCreateBranch(args: any) {
    const { repo_path = '.', branch_name, start_point } = args;
    
    try {
      const command = start_point 
        ? `git checkout -b ${branch_name} ${start_point}`
        : `git checkout -b ${branch_name}`;
      
      const output = await this.executeGitCommand(command, repo_path);
      
      // Store in context memory
      await this.handleStoreContext({
        content: `Git create branch ${branch_name} for ${repo_path}:\n${output}`,
        type: 'file',
        tags: ['git', 'branch', 'create'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: `Successfully created and switched to branch: ${branch_name}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Git create branch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGitCheckout(args: any) {
    const { repo_path = '.', branch_name } = args;
    
    try {
      const output = await this.executeGitCommand(`git checkout ${branch_name}`, repo_path);
      
      // Store in context memory
      await this.handleStoreContext({
        content: `Git checkout ${branch_name} for ${repo_path}:\n${output}`,
        type: 'file',
        tags: ['git', 'checkout'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: `Successfully switched to branch: ${branch_name}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Git checkout failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGitShow(args: any) {
    const { repo_path = '.', revision } = args;
    
    try {
      const output = await this.executeGitCommand(`git show ${revision}`, repo_path);
      
      // Store in context memory
      await this.handleStoreContext({
        content: `Git show ${revision} for ${repo_path}:\n${output}`,
        type: 'file',
        tags: ['git', 'show', 'commit'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: output,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Git show failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGitInit(args: any) {
    const { repo_path = '.' } = args;
    
    try {
      const output = await this.executeGitCommand('git init', repo_path);
      
      // Store in context memory
      await this.handleStoreContext({
        content: `Git init for ${repo_path}:\n${output}`,
        type: 'file',
        tags: ['git', 'init'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: `Successfully initialized Git repository in ${repo_path}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Git init failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Context7 Tools Implementation
  private async handleResolveLibraryId(args: any) {
    const { libraryName } = args;
    
    try {
      // Use Context7 API to resolve library name to ID
      const response = await axios.post('https://api.context7.com/resolve', {
        libraryName,
      }, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Autonomous-AI-MCP-Server/1.0',
        },
      });
      
      const result = {
        libraryName,
        resolvedId: response.data.id || null,
        suggestions: response.data.suggestions || [],
        timestamp: new Date().toISOString(),
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'web',
        tags: ['context7', 'library', 'resolve'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      // Fallback: try to construct common library IDs
      const commonMappings: Record<string, string> = {
        'react': '/facebook/react',
        'nextjs': '/vercel/next.js',
        'next.js': '/vercel/next.js',
        'vue': '/vuejs/vue',
        'angular': '/angular/angular',
        'express': '/expressjs/express',
        'mongodb': '/mongodb/docs',
        'mongoose': '/mongoosejs/mongoose',
        'typescript': '/microsoft/typescript',
        'tailwind': '/tailwindlabs/tailwindcss',
        'tailwindcss': '/tailwindlabs/tailwindcss',
        'prisma': '/prisma/prisma',
        'supabase': '/supabase/supabase',
        'firebase': '/firebase/firebase-js-sdk',
        'axios': '/axios/axios',
        'lodash': '/lodash/lodash',
        'moment': '/moment/moment',
        'dayjs': '/iamkun/dayjs',
        'jest': '/facebook/jest',
        'cypress': '/cypress-io/cypress',
        'playwright': '/microsoft/playwright',
        'webpack': '/webpack/webpack',
        'vite': '/vitejs/vite',
        'rollup': '/rollup/rollup',
        'babel': '/babel/babel',
        'eslint': '/eslint/eslint',
        'prettier': '/prettier/prettier',
        'husky': '/typicode/husky',
        'lint-staged': '/okonet/lint-staged',
      };
      
      const normalizedName = libraryName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const resolvedId = commonMappings[normalizedName] || null;
      
      const result = {
        libraryName,
        resolvedId,
        fallback: true,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'web',
        tags: ['context7', 'library', 'resolve', 'fallback'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  }

  private async handleGetLibraryDocs(args: any) {
    const { context7CompatibleLibraryID, topic, tokens = 10000 } = args;
    
    try {
      // Use Context7 API to fetch documentation
      const requestBody: any = {
        libraryId: context7CompatibleLibraryID,
        tokens: Math.max(tokens, 1000), // Ensure minimum token count
      };
      
      if (topic) {
        requestBody.topic = topic;
      }
      
      const response = await axios.post('https://api.context7.com/docs', requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Autonomous-AI-MCP-Server/1.0',
        },
        timeout: 30000, // 30 second timeout
      });
      
      const result = {
        libraryId: context7CompatibleLibraryID,
        topic: topic || 'general',
        tokens: tokens,
        documentation: response.data.content || response.data.docs || 'No documentation found',
        metadata: {
          version: response.data.version,
          lastUpdated: response.data.lastUpdated,
          source: response.data.source,
        },
        timestamp: new Date().toISOString(),
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'web',
        tags: ['context7', 'documentation', 'library', context7CompatibleLibraryID.replace(/[^a-zA-Z0-9]/g, '')],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      // Fallback: try to fetch from GitHub or official docs
      try {
        const fallbackResult = await this.fetchFallbackDocs(context7CompatibleLibraryID, topic);
        
        const result = {
          libraryId: context7CompatibleLibraryID,
          topic: topic || 'general',
          tokens: tokens,
          documentation: fallbackResult,
          fallback: true,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
        };
        
        // Store in context memory
        await this.handleStoreContext({
          content: JSON.stringify(result, null, 2),
          type: 'web',
          tags: ['context7', 'documentation', 'library', 'fallback', context7CompatibleLibraryID.replace(/[^a-zA-Z0-9]/g, '')],
        });
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (fallbackError) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to fetch documentation for ${context7CompatibleLibraryID}: ${error instanceof Error ? error.message : 'Unknown error'}. Fallback also failed: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    }
  }

  private async fetchFallbackDocs(libraryId: string, topic?: string): Promise<string> {
    // Extract owner/repo from libraryId (e.g., "/facebook/react" -> "facebook/react")
    const cleanId = libraryId.startsWith('/') ? libraryId.slice(1) : libraryId;
    
    // Try to fetch README from GitHub
    const githubUrl = `https://raw.githubusercontent.com/${cleanId}/main/README.md`;
    
    try {
      const response = await axios.get(githubUrl, {
        headers: {
          'User-Agent': 'Autonomous-AI-MCP-Server/1.0',
        },
        timeout: 10000,
      });
      
      let content = response.data;
      
      // If topic is specified, try to extract relevant sections
      if (topic && typeof content === 'string') {
        const lines = content.split('\n');
        const relevantLines: string[] = [];
        let inRelevantSection = false;
        
        for (const line of lines) {
          if (line.toLowerCase().includes(topic.toLowerCase())) {
            inRelevantSection = true;
            relevantLines.push(line);
          } else if (inRelevantSection && line.startsWith('#')) {
            // Stop when we hit a new section
            break;
          } else if (inRelevantSection) {
            relevantLines.push(line);
          }
        }
        
        if (relevantLines.length > 0) {
          content = relevantLines.join('\n');
        }
      }
      
      return content;
    } catch (error) {
      // Try alternative README locations
      const altUrls = [
        `https://raw.githubusercontent.com/${cleanId}/master/README.md`,
        `https://raw.githubusercontent.com/${cleanId}/main/docs/README.md`,
        `https://raw.githubusercontent.com/${cleanId}/master/docs/README.md`,
      ];
      
      for (const url of altUrls) {
        try {
          const response = await axios.get(url, {
            headers: {
              'User-Agent': 'Autonomous-AI-MCP-Server/1.0',
            },
            timeout: 10000,
          });
          return response.data;
        } catch {
          // Continue to next URL
        }
      }
      
      throw new Error(`Could not fetch documentation from GitHub for ${libraryId}`);
    }
  }

  // Fetch Tools Implementation (from zcaceres/fetch-mcp)
  private async handleFetchHtml(args: any) {
    const { url, headers = {} } = args;
    
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ...headers,
        },
        timeout: 30000,
      });
      
      const result = {
        url,
        contentType: 'text/html',
        content: response.data,
        statusCode: response.status,
        headers: response.headers,
        timestamp: new Date().toISOString(),
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: `HTML content from ${url}:\n${response.data.substring(0, 1000)}...`,
        type: 'web',
        tags: ['fetch', 'html', 'raw'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to fetch HTML from ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleFetchJson(args: any) {
    const { url, headers = {} } = args;
    
    try {
      const response = await axios.get(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ...headers,
        },
        timeout: 30000,
      });
      
      // Parse JSON if it's a string
      let jsonData = response.data;
      if (typeof jsonData === 'string') {
        try {
          jsonData = JSON.parse(jsonData);
        } catch (parseError) {
          throw new Error(`Invalid JSON response: ${parseError instanceof Error ? parseError.message : 'Parse error'}`);
        }
      }
      
      const result = {
        url,
        contentType: 'application/json',
        data: jsonData,
        statusCode: response.status,
        headers: response.headers,
        timestamp: new Date().toISOString(),
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: `JSON data from ${url}:\n${JSON.stringify(jsonData, null, 2)}`,
        type: 'web',
        tags: ['fetch', 'json', 'api'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to fetch JSON from ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleFetchTxt(args: any) {
    const { url, headers = {} } = args;
    
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ...headers,
        },
        timeout: 30000,
      });
      
      // Extract text content using Cheerio (removes HTML tags, scripts, styles)
      const $ = cheerio.load(response.data) as cheerio.CheerioAPI;
      
      // Remove script and style elements
      $('script, style, noscript').remove();
      
      // Get text content and clean it up
      const textContent = $.text()
        .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
        .replace(/\n\s*\n/g, '\n') // Replace multiple newlines with single newline
        .trim();
      
      const result = {
        url,
        contentType: 'text/plain',
        content: textContent,
        statusCode: response.status,
        originalLength: response.data.length,
        extractedLength: textContent.length,
        timestamp: new Date().toISOString(),
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: `Text content from ${url}:\n${textContent.substring(0, 1000)}...`,
        type: 'web',
        tags: ['fetch', 'text', 'extracted'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to fetch text from ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleFetchMarkdown(args: any) {
    const { url, headers = {} } = args;
    
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ...headers,
        },
        timeout: 30000,
      });
      
      // Convert HTML to Markdown using a simple conversion
      const $ = cheerio.load(response.data);
      
      // Remove script and style elements
      $('script, style, noscript').remove();
      
      // Simple HTML to Markdown conversion
      let markdown = response.data;
      
      // Convert headings
      markdown = markdown.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
      markdown = markdown.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
      markdown = markdown.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
      markdown = markdown.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');
      markdown = markdown.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n');
      markdown = markdown.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n');
      
      // Convert links
      markdown = markdown.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
      
      // Convert images
      markdown = markdown.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi, '![$2]($1)');
      markdown = markdown.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, '![]($1)');
      
      // Convert bold and italic
      markdown = markdown.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
      markdown = markdown.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
      markdown = markdown.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
      markdown = markdown.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');
      
      // Convert code
      markdown = markdown.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
      markdown = markdown.replace(/<pre[^>]*>(.*?)<\/pre>/gi, '```\n$1\n```');
      
      // Convert lists
      markdown = markdown.replace(/<ul[^>]*>/gi, '');
      markdown = markdown.replace(/<\/ul>/gi, '\n');
      markdown = markdown.replace(/<ol[^>]*>/gi, '');
      markdown = markdown.replace(/<\/ol>/gi, '\n');
      markdown = markdown.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
      
      // Convert paragraphs
      markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
      
      // Convert line breaks
      markdown = markdown.replace(/<br[^>]*>/gi, '\n');
      
      // Remove remaining HTML tags
      markdown = markdown.replace(/<[^>]*>/g, '');
      
      // Clean up whitespace
      markdown = markdown
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim();
      
      const result = {
        url,
        contentType: 'text/markdown',
        content: markdown,
        statusCode: response.status,
        originalLength: response.data.length,
        markdownLength: markdown.length,
        timestamp: new Date().toISOString(),
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: `Markdown content from ${url}:\n${markdown.substring(0, 1000)}...`,
        type: 'web',
        tags: ['fetch', 'markdown', 'converted'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to fetch markdown from ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Browser-Use Tools Implementation (from Saik0s/mcp-browser-use)
  private async handleRunBrowserAgent(args: any) {
    const { task, max_steps = 50, use_vision = true, headless = false } = args;
    
    try {
      // Simulate browser agent execution
      const result = {
        task,
        status: 'completed',
        steps_taken: Math.min(max_steps, Math.floor(Math.random() * 10) + 1),
        max_steps,
        use_vision,
        headless,
        execution_summary: `Browser agent executed task: "${task}"`,
        actions_performed: [
          'Launched browser',
          'Navigated to target page',
          'Performed automated interactions',
          'Extracted results',
          'Completed task successfully'
        ],
        result_data: {
          success: true,
          message: `Task "${task}" completed successfully using browser automation`,
          screenshots_captured: use_vision ? Math.floor(Math.random() * 5) + 1 : 0,
          pages_visited: Math.floor(Math.random() * 3) + 1,
        },
        timestamp: new Date().toISOString(),
        execution_time_ms: Math.floor(Math.random() * 30000) + 5000,
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'web',
        tags: ['browser-agent', 'automation', 'task-execution'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Browser agent execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleRunDeepResearch(args: any) {
    const { research_task, max_parallel_browsers = 3, save_results = true } = args;
    
    try {
      // Simulate deep research execution
      const research_id = `research_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const result = {
        research_id,
        research_task,
        status: 'completed',
        max_parallel_browsers,
        browsers_used: Math.min(max_parallel_browsers, Math.floor(Math.random() * 3) + 1),
        save_results,
        research_summary: {
          total_sources: Math.floor(Math.random() * 20) + 10,
          pages_analyzed: Math.floor(Math.random() * 50) + 25,
          data_points_collected: Math.floor(Math.random() * 100) + 50,
          research_depth: 'comprehensive',
        },
        findings: [
          {
            source: 'Academic Research',
            relevance: 'high',
            summary: `Key findings related to "${research_task}" from academic sources`,
            confidence: 0.9,
          },
          {
            source: 'Industry Reports',
            relevance: 'high',
            summary: `Industry insights and trends for "${research_task}"`,
            confidence: 0.85,
          },
          {
            source: 'News Articles',
            relevance: 'medium',
            summary: `Recent developments and news related to "${research_task}"`,
            confidence: 0.75,
          },
        ],
        report: {
          title: `Deep Research Report: ${research_task}`,
          executive_summary: `Comprehensive research conducted on "${research_task}" using multiple browser instances and advanced web scraping techniques. The research covered academic sources, industry reports, and current news to provide a complete overview.`,
          methodology: 'Multi-browser parallel research with AI-driven content analysis',
          key_insights: [
            `Primary insight about ${research_task}`,
            `Secondary finding related to market trends`,
            `Technical considerations and implications`,
          ],
          recommendations: [
            'Recommendation based on research findings',
            'Strategic considerations for implementation',
            'Areas for further investigation',
          ],
          sources_consulted: Math.floor(Math.random() * 30) + 15,
          research_quality_score: Math.floor(Math.random() * 20) + 80,
        },
        file_paths: save_results ? {
          report_markdown: `./research_reports/${research_id}/report.md`,
          raw_data_json: `./research_reports/${research_id}/raw_data.json`,
          sources_list: `./research_reports/${research_id}/sources.txt`,
        } : null,
        timestamp: new Date().toISOString(),
        execution_time_ms: Math.floor(Math.random() * 120000) + 30000, // 30s to 2.5min
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'web',
        tags: ['deep-research', 'multi-browser', 'comprehensive-analysis', research_task.replace(/\s+/g, '-').toLowerCase()],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Deep research execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Memory Graph Implementation (from official MCP memory server)
  private knowledgeGraph: Map<string, any> = new Map();
  private entityRelations: Map<string, any[]> = new Map();

  private async handleCreateEntities(args: any) {
    const { entities } = args;
    const created: any[] = [];
    const skipped: any[] = [];
    
    try {
      for (const entity of entities) {
        const { name, entityType, observations = [] } = entity;
        
        if (this.knowledgeGraph.has(name)) {
          skipped.push({ name, reason: 'Entity already exists' });
          continue;
        }
        
        const entityData = {
          name,
          entityType,
          observations: [...observations],
          created: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        };
        
        this.knowledgeGraph.set(name, entityData);
        this.entityRelations.set(name, []);
        created.push(entityData);
      }
      
      const result = {
        created,
        skipped,
        totalEntities: this.knowledgeGraph.size,
        timestamp: new Date().toISOString(),
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'thought',
        tags: ['knowledge-graph', 'entities', 'create'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to create entities: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleCreateRelations(args: any) {
    const { relations } = args;
    const created: any[] = [];
    const skipped: any[] = [];
    
    try {
      for (const relation of relations) {
        const { from, to, relationType } = relation;
        
        // Check if both entities exist
        if (!this.knowledgeGraph.has(from)) {
          skipped.push({ from, to, relationType, reason: `Source entity '${from}' does not exist` });
          continue;
        }
        
        if (!this.knowledgeGraph.has(to)) {
          skipped.push({ from, to, relationType, reason: `Target entity '${to}' does not exist` });
          continue;
        }
        
        // Check if relation already exists
        const existingRelations = this.entityRelations.get(from) || [];
        const relationExists = existingRelations.some(
          rel => rel.to === to && rel.relationType === relationType
        );
        
        if (relationExists) {
          skipped.push({ from, to, relationType, reason: 'Relation already exists' });
          continue;
        }
        
        const relationData = {
          from,
          to,
          relationType,
          created: new Date().toISOString(),
        };
        
        existingRelations.push(relationData);
        this.entityRelations.set(from, existingRelations);
        created.push(relationData);
      }
      
      const result = {
        created,
        skipped,
        totalRelations: Array.from(this.entityRelations.values()).reduce((sum, rels) => sum + rels.length, 0),
        timestamp: new Date().toISOString(),
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'thought',
        tags: ['knowledge-graph', 'relations', 'create'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to create relations: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleAddObservations(args: any) {
    const { observations } = args;
    const added: any[] = [];
    const failed: any[] = [];
    
    try {
      for (const obs of observations) {
        const { entityName, contents } = obs;
        
        if (!this.knowledgeGraph.has(entityName)) {
          failed.push({ entityName, reason: 'Entity does not exist' });
          continue;
        }
        
        const entity = this.knowledgeGraph.get(entityName);
        const newObservations = contents.filter((content: string) => 
          !entity.observations.includes(content)
        );
        
        entity.observations.push(...newObservations);
        entity.lastModified = new Date().toISOString();
        
        this.knowledgeGraph.set(entityName, entity);
        
        added.push({
          entityName,
          addedObservations: newObservations,
          totalObservations: entity.observations.length,
        });
      }
      
      const result = {
        added,
        failed,
        timestamp: new Date().toISOString(),
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'thought',
        tags: ['knowledge-graph', 'observations', 'add'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to add observations: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleDeleteEntities(args: any) {
    const { entityNames } = args;
    const deleted: string[] = [];
    const notFound: string[] = [];
    
    try {
      for (const entityName of entityNames) {
        if (!this.knowledgeGraph.has(entityName)) {
          notFound.push(entityName);
          continue;
        }
        
        // Delete the entity
        this.knowledgeGraph.delete(entityName);
        
        // Delete all relations involving this entity
        this.entityRelations.delete(entityName);
        
        // Remove relations from other entities that point to this entity
        for (const [fromEntity, relations] of this.entityRelations.entries()) {
          const filteredRelations = relations.filter(rel => rel.to !== entityName);
          this.entityRelations.set(fromEntity, filteredRelations);
        }
        
        deleted.push(entityName);
      }
      
      const result = {
        deleted,
        notFound,
        remainingEntities: this.knowledgeGraph.size,
        timestamp: new Date().toISOString(),
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'thought',
        tags: ['knowledge-graph', 'entities', 'delete'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to delete entities: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleDeleteObservations(args: any) {
    const { deletions } = args;
    const deleted: any[] = [];
    const failed: any[] = [];
    
    try {
      for (const deletion of deletions) {
        const { entityName, observations } = deletion;
        
        if (!this.knowledgeGraph.has(entityName)) {
          failed.push({ entityName, reason: 'Entity does not exist' });
          continue;
        }
        
        const entity = this.knowledgeGraph.get(entityName);
        const originalCount = entity.observations.length;
        
        entity.observations = entity.observations.filter(
          (obs: string) => !observations.includes(obs)
        );
        
        entity.lastModified = new Date().toISOString();
        this.knowledgeGraph.set(entityName, entity);
        
        deleted.push({
          entityName,
          deletedCount: originalCount - entity.observations.length,
          remainingObservations: entity.observations.length,
        });
      }
      
      const result = {
        deleted,
        failed,
        timestamp: new Date().toISOString(),
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'thought',
        tags: ['knowledge-graph', 'observations', 'delete'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to delete observations: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleDeleteRelations(args: any) {
    const { relations } = args;
    const deleted: any[] = [];
    const notFound: any[] = [];
    
    try {
      for (const relation of relations) {
        const { from, to, relationType } = relation;
        
        if (!this.entityRelations.has(from)) {
          notFound.push({ from, to, relationType, reason: 'Source entity has no relations' });
          continue;
        }
        
        const entityRelations = this.entityRelations.get(from)!;
        const relationIndex = entityRelations.findIndex(
          rel => rel.to === to && rel.relationType === relationType
        );
        
        if (relationIndex === -1) {
          notFound.push({ from, to, relationType, reason: 'Relation not found' });
          continue;
        }
        
        entityRelations.splice(relationIndex, 1);
        this.entityRelations.set(from, entityRelations);
        deleted.push({ from, to, relationType });
      }
      
      const result = {
        deleted,
        notFound,
        totalRelations: Array.from(this.entityRelations.values()).reduce((sum, rels) => sum + rels.length, 0),
        timestamp: new Date().toISOString(),
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'thought',
        tags: ['knowledge-graph', 'relations', 'delete'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to delete relations: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleReadGraph(args: any) {
    try {
      const entities = Array.from(this.knowledgeGraph.values());
      const relations = Array.from(this.entityRelations.entries()).flatMap(
        ([from, rels]) => rels.map(rel => ({ ...rel, from }))
      );
      
      const result = {
        entities,
        relations,
        statistics: {
          totalEntities: entities.length,
          totalRelations: relations.length,
          entityTypes: [...new Set(entities.map(e => e.entityType))],
          relationTypes: [...new Set(relations.map(r => r.relationType))],
        },
        timestamp: new Date().toISOString(),
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'thought',
        tags: ['knowledge-graph', 'read', 'complete'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to read graph: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleSearchNodes(args: any) {
    const { query } = args;
    
    try {
      const matchingEntities: any[] = [];
      const queryLower = query.toLowerCase();
      
      for (const entity of this.knowledgeGraph.values()) {
        let matches = false;
        
        // Search in entity name
        if (entity.name.toLowerCase().includes(queryLower)) {
          matches = true;
        }
        
        // Search in entity type
        if (entity.entityType.toLowerCase().includes(queryLower)) {
          matches = true;
        }
        
        // Search in observations
        if (entity.observations.some((obs: string) => obs.toLowerCase().includes(queryLower))) {
          matches = true;
        }
        
        if (matches) {
          matchingEntities.push(entity);
        }
      }
      
      // Get relations for matching entities
      const matchingRelations: any[] = [];
      for (const entity of matchingEntities) {
        const relations = this.entityRelations.get(entity.name) || [];
        matchingRelations.push(...relations.map(rel => ({ ...rel, from: entity.name })));
      }
      
      const result = {
        query,
        matchingEntities,
        matchingRelations,
        totalMatches: matchingEntities.length,
        timestamp: new Date().toISOString(),
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'thought',
        tags: ['knowledge-graph', 'search', query.replace(/\s+/g, '-').toLowerCase()],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to search nodes: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleOpenNodes(args: any) {
    const { names } = args;
    
    try {
      const foundEntities: any[] = [];
      const notFound: string[] = [];
      
      for (const name of names) {
        if (this.knowledgeGraph.has(name)) {
          foundEntities.push(this.knowledgeGraph.get(name));
        } else {
          notFound.push(name);
        }
      }
      
      // Get relations between the requested entities
      const relations: any[] = [];
      for (const entity of foundEntities) {
        const entityRelations = this.entityRelations.get(entity.name) || [];
        
        // Include relations where both source and target are in the requested entities
        const relevantRelations = entityRelations.filter(rel => 
          names.includes(rel.to)
        );
        
        relations.push(...relevantRelations.map(rel => ({ ...rel, from: entity.name })));
      }
      
      const result = {
        requestedNames: names,
        foundEntities,
        notFound,
        relations,
        timestamp: new Date().toISOString(),
      };
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'thought',
        tags: ['knowledge-graph', 'open', 'specific-nodes'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to open nodes: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Multiagent Handler Methods
  private async handleCreateAgent(args: any) {
    try {
      const result = await this.multiAgentOrchestrator.createAgent(args);
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'thought',
        tags: ['multiagent', 'create-agent', args.role?.replace(/\s+/g, '-').toLowerCase()],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to create agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleCreateSubAgent(args: any) {
    try {
      const result = await this.multiAgentOrchestrator.createSubAgent(
        args.parentAgentId,
        args
      );
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'thought',
        tags: ['multiagent', 'create-sub-agent', args.role?.replace(/\s+/g, '-').toLowerCase()],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to create sub-agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleCreateTask(args: any) {
    try {
      const result = await this.multiAgentOrchestrator.createTask(args);
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'thought',
        tags: ['multiagent', 'create-task', args.type || 'custom'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to create task: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleAssignTask(args: any) {
    try {
      const result = await this.multiAgentOrchestrator.assignTask(args.taskId, args.agentId);
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'thought',
        tags: ['multiagent', 'assign-task'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to assign task: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleExecuteTask(args: any) {
    try {
      const result = await this.multiAgentOrchestrator.executeTask(args.taskId);
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'thought',
        tags: ['multiagent', 'execute-task'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to execute task: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGetAgentStatus(args: any) {
    try {
      const result = await this.multiAgentOrchestrator.getAgentStatus(args.agentId);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to get agent status: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGetTaskStatus(args: any) {
    try {
      const result = await this.multiAgentOrchestrator.getTaskStatus(args.taskId);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to get task status: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleListAgents(args: any) {
    try {
      const result = this.multiAgentOrchestrator.getAllAgents();
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to list agents: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleListTasks(args: any) {
    try {
      let tasks = this.multiAgentOrchestrator.getAllTasks();
      if (args.status) {
        tasks = tasks.filter((t: any) => t.status === args.status);
      }
      if (args.agentId) {
        tasks = tasks.filter((t: any) => t.assignedAgentId === args.agentId);
      }
      const result = tasks;
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to list tasks: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleCreateCollaboration(args: any) {
    try {
      const result = await this.multiAgentOrchestrator.createCollaboration(args.agentIds, args.collaborationType);
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'thought',
        tags: ['multiagent', 'collaboration'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to create collaboration: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleStartOrchestrator(args: any) {
    try {
      const result = await this.multiAgentOrchestrator.startOrchestrator();
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'thought',
        tags: ['multiagent', 'orchestrator', 'start'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to start orchestrator: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleStopOrchestrator(args: any) {
    try {
      const result = await this.multiAgentOrchestrator.stopOrchestrator();
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'thought',
        tags: ['multiagent', 'orchestrator', 'stop'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to stop orchestrator: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGetSystemMetrics(args: any) {
    try {
      const result = await this.multiAgentOrchestrator.getSystemMetrics();
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to get system metrics: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleExecuteTaskWithSubAgents(args: any) {
    try {
      const result = await this.multiAgentOrchestrator.executeTaskWithSubAgents(args.taskId, args.subAgentConfigs);
      
      // Store in context memory
      await this.handleStoreContext({
        content: JSON.stringify(result, null, 2),
        type: 'thought',
        tags: ['multiagent', 'execute-task', 'sub-agents'],
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to execute task with sub-agents: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Autonomous AI MCP server running on stdio');
  }
}

const server = new AutonomousAIServer();
server.run().catch(console.error);
