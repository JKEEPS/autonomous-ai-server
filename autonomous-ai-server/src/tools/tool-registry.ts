import { FilesystemTools } from './filesystem/filesystem-tools.js';
import { WebTools } from './web/web-tools.js';
import { GitTools } from './git/git-tools.js';
import { ToolResult } from './base-tool.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: any;
}

export class ToolRegistry {
  private filesystemTools: FilesystemTools;
  private webTools: WebTools;
  private gitTools: GitTools;

  constructor(workingDirectory: string) {
    this.filesystemTools = new FilesystemTools(workingDirectory);
    this.webTools = new WebTools(workingDirectory);
    this.gitTools = new GitTools(workingDirectory);
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      // Filesystem Tools
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

      // Web Tools
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
        name: 'fetch_text',
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

      // Git Tools
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
    ];
  }

  async executeTool(name: string, args: any): Promise<ToolResult> {
    switch (name) {
      // Filesystem Tools
      case 'read_file':
        return this.filesystemTools.readFile(args);
      case 'write_file':
        return this.filesystemTools.writeFile(args);
      case 'list_files':
        return this.filesystemTools.listFiles(args);
      case 'search_files':
        return this.filesystemTools.searchFiles(args);
      case 'edit_file':
        return this.filesystemTools.editFile(args);
      case 'create_directory':
        return this.filesystemTools.createDirectory(args);
      case 'move_file':
        return this.filesystemTools.moveFile(args);
      case 'get_file_info':
        return this.filesystemTools.getFileInfo(args);
      case 'read_multiple_files':
        return this.filesystemTools.readMultipleFiles(args);

      // Web Tools
      case 'fetch_html':
        return this.webTools.fetchHtml(args);
      case 'fetch_json':
        return this.webTools.fetchJson(args);
      case 'fetch_text':
        return this.webTools.fetchText(args);
      case 'capture_screenshot':
        return this.webTools.captureScreenshot(args);
      case 'run_accessibility_audit':
        return this.webTools.runAccessibilityAudit(args);
      case 'run_performance_audit':
        return this.webTools.runPerformanceAudit(args);
      case 'analyze_page_dom':
        return this.webTools.analyzePageDOM(args);
      case 'get_page_console_logs':
        return this.webTools.getPageConsoleLogs(args);
      case 'get_page_network_logs':
        return this.webTools.getPageNetworkLogs(args);

      // Git Tools
      case 'git_status':
        return this.gitTools.gitStatus(args);
      case 'git_diff_unstaged':
        return this.gitTools.gitDiffUnstaged(args);
      case 'git_diff_staged':
        return this.gitTools.gitDiffStaged(args);
      case 'git_diff':
        return this.gitTools.gitDiff(args);
      case 'git_commit':
        return this.gitTools.gitCommit(args);
      case 'git_add':
        return this.gitTools.gitAdd(args);
      case 'git_reset':
        return this.gitTools.gitReset(args);
      case 'git_log':
        return this.gitTools.gitLog(args);
      case 'git_create_branch':
        return this.gitTools.gitCreateBranch(args);
      case 'git_checkout':
        return this.gitTools.gitCheckout(args);
      case 'git_show':
        return this.gitTools.gitShow(args);
      case 'git_init':
        return this.gitTools.gitInit(args);

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
