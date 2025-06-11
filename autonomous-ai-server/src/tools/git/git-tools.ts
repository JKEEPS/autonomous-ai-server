import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { BaseTool, ToolResult } from '../base-tool.js';

const execAsync = promisify(exec);

export class GitTools extends BaseTool {
  private async executeGitCommand(command: string, repoPath: string = '.'): Promise<string> {
    const fullPath = path.resolve(this.workingDirectory, repoPath);
    
    try {
      const { stdout, stderr } = await execAsync(command, { cwd: fullPath });
      return stdout || stderr || '';
    } catch (error: any) {
      throw new Error(`Git command failed: ${error.message}`);
    }
  }

  async gitStatus(args: { repo_path?: string }): Promise<ToolResult> {
    try {
      const { repo_path = '.' } = args;
      const output = await this.executeGitCommand('git status --porcelain', repo_path);
      
      return this.createSuccessResult(output || 'Working tree clean');
    } catch (error) {
      return this.handleError(error, 'Git status');
    }
  }

  async gitDiffUnstaged(args: { repo_path?: string }): Promise<ToolResult> {
    try {
      const { repo_path = '.' } = args;
      const output = await this.executeGitCommand('git diff', repo_path);
      
      return this.createSuccessResult(output || 'No unstaged changes');
    } catch (error) {
      return this.handleError(error, 'Git diff unstaged');
    }
  }

  async gitDiffStaged(args: { repo_path?: string }): Promise<ToolResult> {
    try {
      const { repo_path = '.' } = args;
      const output = await this.executeGitCommand('git diff --cached', repo_path);
      
      return this.createSuccessResult(output || 'No staged changes');
    } catch (error) {
      return this.handleError(error, 'Git diff staged');
    }
  }

  async gitDiff(args: { repo_path?: string; target: string }): Promise<ToolResult> {
    try {
      const { repo_path = '.', target } = args;
      const output = await this.executeGitCommand(`git diff ${target}`, repo_path);
      
      return this.createSuccessResult(output || `No differences with ${target}`);
    } catch (error) {
      return this.handleError(error, 'Git diff');
    }
  }

  async gitCommit(args: { repo_path?: string; message: string }): Promise<ToolResult> {
    try {
      const { repo_path = '.', message } = args;
      const sanitizedMessage = this.sanitizeInput(message);
      const output = await this.executeGitCommand(`git commit -m "${sanitizedMessage}"`, repo_path);
      
      return this.createSuccessResult(output);
    } catch (error) {
      return this.handleError(error, 'Git commit');
    }
  }

  async gitAdd(args: { repo_path?: string; files: string[] }): Promise<ToolResult> {
    try {
      const { repo_path = '.', files } = args;
      const sanitizedFiles = files.map(f => this.sanitizeInput(f));
      const fileList = sanitizedFiles.join(' ');
      await this.executeGitCommand(`git add ${fileList}`, repo_path);
      
      return this.createSuccessResult(`Successfully staged files: ${fileList}`);
    } catch (error) {
      return this.handleError(error, 'Git add');
    }
  }

  async gitReset(args: { repo_path?: string }): Promise<ToolResult> {
    try {
      const { repo_path = '.' } = args;
      await this.executeGitCommand('git reset', repo_path);
      
      return this.createSuccessResult('Successfully unstaged all changes');
    } catch (error) {
      return this.handleError(error, 'Git reset');
    }
  }

  async gitLog(args: { repo_path?: string; max_count?: number }): Promise<ToolResult> {
    try {
      const { repo_path = '.', max_count = 10 } = args;
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
      
      return this.createJsonResult(commits);
    } catch (error) {
      return this.handleError(error, 'Git log');
    }
  }

  async gitCreateBranch(args: { repo_path?: string; branch_name: string; start_point?: string }): Promise<ToolResult> {
    try {
      const { repo_path = '.', branch_name, start_point } = args;
      const sanitizedBranchName = this.sanitizeInput(branch_name);
      
      const command = start_point 
        ? `git checkout -b ${sanitizedBranchName} ${this.sanitizeInput(start_point)}`
        : `git checkout -b ${sanitizedBranchName}`;
      
      await this.executeGitCommand(command, repo_path);
      
      return this.createSuccessResult(`Successfully created and switched to branch: ${sanitizedBranchName}`);
    } catch (error) {
      return this.handleError(error, 'Git create branch');
    }
  }

  async gitCheckout(args: { repo_path?: string; branch_name: string }): Promise<ToolResult> {
    try {
      const { repo_path = '.', branch_name } = args;
      const sanitizedBranchName = this.sanitizeInput(branch_name);
      await this.executeGitCommand(`git checkout ${sanitizedBranchName}`, repo_path);
      
      return this.createSuccessResult(`Successfully switched to branch: ${sanitizedBranchName}`);
    } catch (error) {
      return this.handleError(error, 'Git checkout');
    }
  }

  async gitShow(args: { repo_path?: string; revision: string }): Promise<ToolResult> {
    try {
      const { repo_path = '.', revision } = args;
      const sanitizedRevision = this.sanitizeInput(revision);
      const output = await this.executeGitCommand(`git show ${sanitizedRevision}`, repo_path);
      
      return this.createSuccessResult(output);
    } catch (error) {
      return this.handleError(error, 'Git show');
    }
  }

  async gitInit(args: { repo_path?: string }): Promise<ToolResult> {
    try {
      const { repo_path = '.' } = args;
      await this.executeGitCommand('git init', repo_path);
      
      return this.createSuccessResult(`Successfully initialized Git repository in ${repo_path}`);
    } catch (error) {
      return this.handleError(error, 'Git init');
    }
  }

  async gitBranch(args: { repo_path?: string; list_all?: boolean }): Promise<ToolResult> {
    try {
      const { repo_path = '.', list_all = false } = args;
      const command = list_all ? 'git branch -a' : 'git branch';
      const output = await this.executeGitCommand(command, repo_path);
      
      const branches = output.split('\n')
        .filter(line => line.trim())
        .map(line => ({
          name: line.replace(/^\*?\s*/, ''),
          current: line.startsWith('*'),
          remote: line.includes('remotes/'),
        }));
      
      return this.createJsonResult(branches);
    } catch (error) {
      return this.handleError(error, 'Git branch');
    }
  }

  async gitPull(args: { repo_path?: string; remote?: string; branch?: string }): Promise<ToolResult> {
    try {
      const { repo_path = '.', remote = 'origin', branch } = args;
      const sanitizedRemote = this.sanitizeInput(remote);
      const command = branch 
        ? `git pull ${sanitizedRemote} ${this.sanitizeInput(branch)}`
        : `git pull ${sanitizedRemote}`;
      
      const output = await this.executeGitCommand(command, repo_path);
      
      return this.createSuccessResult(output);
    } catch (error) {
      return this.handleError(error, 'Git pull');
    }
  }

  async gitPush(args: { repo_path?: string; remote?: string; branch?: string; force?: boolean }): Promise<ToolResult> {
    try {
      const { repo_path = '.', remote = 'origin', branch, force = false } = args;
      const sanitizedRemote = this.sanitizeInput(remote);
      
      let command = `git push ${sanitizedRemote}`;
      if (branch) {
        command += ` ${this.sanitizeInput(branch)}`;
      }
      if (force) {
        command += ' --force';
      }
      
      const output = await this.executeGitCommand(command, repo_path);
      
      return this.createSuccessResult(output);
    } catch (error) {
      return this.handleError(error, 'Git push');
    }
  }

  async gitStash(args: { repo_path?: string; action?: string; message?: string }): Promise<ToolResult> {
    try {
      const { repo_path = '.', action = 'push', message } = args;
      
      let command = `git stash ${action}`;
      if (action === 'push' && message) {
        command += ` -m "${this.sanitizeInput(message)}"`;
      }
      
      const output = await this.executeGitCommand(command, repo_path);
      
      return this.createSuccessResult(output);
    } catch (error) {
      return this.handleError(error, 'Git stash');
    }
  }

  async gitRemote(args: { repo_path?: string; action?: string; name?: string; url?: string }): Promise<ToolResult> {
    try {
      const { repo_path = '.', action = 'list', name, url } = args;
      
      let command = 'git remote';
      
      switch (action) {
        case 'list':
          command += ' -v';
          break;
        case 'add':
          if (!name || !url) {
            throw new Error('Name and URL required for adding remote');
          }
          command += ` add ${this.sanitizeInput(name)} ${this.sanitizeInput(url)}`;
          break;
        case 'remove':
          if (!name) {
            throw new Error('Name required for removing remote');
          }
          command += ` remove ${this.sanitizeInput(name)}`;
          break;
        default:
          throw new Error(`Unknown remote action: ${action}`);
      }
      
      const output = await this.executeGitCommand(command, repo_path);
      
      return this.createSuccessResult(output);
    } catch (error) {
      return this.handleError(error, 'Git remote');
    }
  }
}
