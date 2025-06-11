import * as fs from 'fs-extra';
import * as path from 'path';
import { BaseTool, ToolResult } from '../base-tool.js';

export class FilesystemTools extends BaseTool {
  async readFile(args: { filepath: string }): Promise<ToolResult> {
    try {
      const { filepath } = args;
      this.validatePath(filepath);
      const fullPath = path.resolve(this.workingDirectory, filepath);
      
      const content = await fs.readFile(fullPath, 'utf-8');
      return this.createSuccessResult(content);
    } catch (error) {
      return this.handleError(error, 'Read file');
    }
  }

  async writeFile(args: { filepath: string; content: string; create_dirs?: boolean }): Promise<ToolResult> {
    try {
      const { filepath, content, create_dirs = true } = args;
      this.validatePath(filepath);
      const fullPath = path.resolve(this.workingDirectory, filepath);
      
      if (create_dirs) {
        await fs.ensureDir(path.dirname(fullPath));
      }
      
      await fs.writeFile(fullPath, content, 'utf-8');
      return this.createSuccessResult(`Successfully wrote ${content.length} characters to ${filepath}`);
    } catch (error) {
      return this.handleError(error, 'Write file');
    }
  }

  async listFiles(args: { path?: string; recursive?: boolean; pattern?: string }): Promise<ToolResult> {
    try {
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
        files = items.map((item: any) => 
          path.relative(this.workingDirectory, path.join(fullPath, item.name))
        );
      }
      
      if (pattern) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
        files = files.filter(file => regex.test(file));
      }
      
      return this.createSuccessResult(files.join('\n'));
    } catch (error) {
      return this.handleError(error, 'List files');
    }
  }

  async searchFiles(args: { 
    pattern: string; 
    path?: string; 
    file_pattern?: string; 
    case_sensitive?: boolean 
  }): Promise<ToolResult> {
    try {
      const { pattern, path: searchPath = '.', file_pattern = '*', case_sensitive = false } = args;
      const fullPath = path.resolve(this.workingDirectory, searchPath);
      
      const regex = new RegExp(pattern, case_sensitive ? 'g' : 'gi');
      const fileGlob = new RegExp(file_pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
      
      const results: Array<{ file: string; line: number; content: string }> = [];
      
      const searchInFile = async (filePath: string) => {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const lines = content.split('\n');
          
          lines.forEach((line: string, index: number) => {
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
      
      return this.createJsonResult(results);
    } catch (error) {
      return this.handleError(error, 'Search files');
    }
  }

  async editFile(args: { 
    path: string; 
    edits: Array<{ oldText: string; newText: string }>; 
    dryRun?: boolean 
  }): Promise<ToolResult> {
    try {
      const { path: filepath, edits, dryRun = false } = args;
      this.validatePath(filepath);
      const fullPath = path.resolve(this.workingDirectory, filepath);
      
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
        return this.createJsonResult({
          filepath,
          dryRun: true,
          changes,
          preview: modifiedContent.substring(0, 1000) + (modifiedContent.length > 1000 ? '...' : '')
        });
      }
      
      await fs.writeFile(fullPath, modifiedContent, 'utf-8');
      
      return this.createJsonResult({
        filepath,
        appliedChanges: changes.filter(c => c.applied).length,
        totalChanges: changes.length,
        changes
      });
    } catch (error) {
      return this.handleError(error, 'Edit file');
    }
  }

  async createDirectory(args: { path: string }): Promise<ToolResult> {
    try {
      const { path: dirPath } = args;
      this.validatePath(dirPath);
      const fullPath = path.resolve(this.workingDirectory, dirPath);
      
      await fs.ensureDir(fullPath);
      return this.createSuccessResult(`Successfully created directory: ${dirPath}`);
    } catch (error) {
      return this.handleError(error, 'Create directory');
    }
  }

  async moveFile(args: { source: string; destination: string }): Promise<ToolResult> {
    try {
      const { source, destination } = args;
      this.validatePath(source);
      this.validatePath(destination);
      
      const sourcePath = path.resolve(this.workingDirectory, source);
      const destPath = path.resolve(this.workingDirectory, destination);
      
      if (await fs.pathExists(destPath)) {
        throw new Error(`Destination already exists: ${destination}`);
      }
      
      await fs.move(sourcePath, destPath);
      return this.createSuccessResult(`Successfully moved ${source} to ${destination}`);
    } catch (error) {
      return this.handleError(error, 'Move file');
    }
  }

  async getFileInfo(args: { path: string }): Promise<ToolResult> {
    try {
      const { path: filepath } = args;
      this.validatePath(filepath);
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
      
      return this.createJsonResult(info);
    } catch (error) {
      return this.handleError(error, 'Get file info');
    }
  }

  async readMultipleFiles(args: { paths: string[] }): Promise<ToolResult> {
    try {
      const { paths } = args;
      const results: Array<{ path: string; content?: string; error?: string }> = [];
      
      for (const filepath of paths) {
        try {
          this.validatePath(filepath);
          const fullPath = path.resolve(this.workingDirectory, filepath);
          const content = await fs.readFile(fullPath, 'utf-8');
          results.push({ path: filepath, content });
        } catch (error) {
          results.push({ 
            path: filepath, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          });
        }
      }
      
      return this.createJsonResult(results);
    } catch (error) {
      return this.handleError(error, 'Read multiple files');
    }
  }
}
