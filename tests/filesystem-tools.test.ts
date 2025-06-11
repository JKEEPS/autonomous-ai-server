import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { FilesystemTools } from '../src/tools/filesystem/filesystem-tools.js';

describe('FilesystemTools', () => {
  let filesystemTools: FilesystemTools;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filesystem-test-'));
    filesystemTools = new FilesystemTools(tempDir);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  describe('readFile', () => {
    it('should read file content successfully', async () => {
      const testContent = 'Hello, World!';
      const testFile = 'test.txt';
      await fs.writeFile(path.join(tempDir, testFile), testContent);

      const result = await filesystemTools.readFile({ filepath: testFile });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toBe(testContent);
    });

    it('should handle file not found error', async () => {
      const result = await filesystemTools.readFile({ filepath: 'nonexistent.txt' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Read file failed');
    });

    it('should reject path traversal attempts', async () => {
      const result = await filesystemTools.readFile({ filepath: '../../../etc/passwd' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Invalid file path');
    });
  });

  describe('writeFile', () => {
    it('should write file content successfully', async () => {
      const testContent = 'Test content';
      const testFile = 'output.txt';

      const result = await filesystemTools.writeFile({ 
        filepath: testFile, 
        content: testContent 
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Successfully wrote');

      const writtenContent = await fs.readFile(path.join(tempDir, testFile), 'utf-8');
      expect(writtenContent).toBe(testContent);
    });

    it('should create directories when create_dirs is true', async () => {
      const testContent = 'Test content';
      const testFile = 'subdir/nested/output.txt';

      const result = await filesystemTools.writeFile({ 
        filepath: testFile, 
        content: testContent,
        create_dirs: true
      });

      expect(result.isError).toBeFalsy();
      expect(await fs.pathExists(path.join(tempDir, 'subdir/nested'))).toBe(true);
    });
  });

  describe('listFiles', () => {
    beforeEach(async () => {
      await fs.writeFile(path.join(tempDir, 'file1.txt'), 'content1');
      await fs.writeFile(path.join(tempDir, 'file2.js'), 'content2');
      await fs.ensureDir(path.join(tempDir, 'subdir'));
      await fs.writeFile(path.join(tempDir, 'subdir/file3.txt'), 'content3');
    });

    it('should list files in directory', async () => {
      const result = await filesystemTools.listFiles({ path: '.' });

      expect(result.isError).toBeFalsy();
      const files = result.content[0].text.split('\n');
      expect(files).toContain('file1.txt');
      expect(files).toContain('file2.js');
      expect(files).toContain('subdir');
    });

    it('should list files recursively', async () => {
      const result = await filesystemTools.listFiles({ 
        path: '.', 
        recursive: true 
      });

      expect(result.isError).toBeFalsy();
      const files = result.content[0].text.split('\n');
      expect(files.some(f => f.includes('subdir/file3.txt'))).toBe(true);
    });

    it('should filter files by pattern', async () => {
      const result = await filesystemTools.listFiles({ 
        path: '.', 
        pattern: '.*\\.txt$' 
      });

      expect(result.isError).toBeFalsy();
      const files = result.content[0].text.split('\n');
      expect(files).toContain('file1.txt');
      expect(files).not.toContain('file2.js');
    });
  });

  describe('searchFiles', () => {
    beforeEach(async () => {
      await fs.writeFile(path.join(tempDir, 'file1.txt'), 'Hello World\nTest content');
      await fs.writeFile(path.join(tempDir, 'file2.txt'), 'Another file\nHello Universe');
    });

    it('should search for pattern in files', async () => {
      const result = await filesystemTools.searchFiles({ 
        pattern: 'Hello' 
      });

      expect(result.isError).toBeFalsy();
      const results = JSON.parse(result.content[0].text);
      expect(results).toHaveLength(2);
      expect(results[0].content).toContain('Hello');
    });

    it('should respect case sensitivity', async () => {
      const result = await filesystemTools.searchFiles({ 
        pattern: 'hello',
        case_sensitive: true
      });

      expect(result.isError).toBeFalsy();
      const results = JSON.parse(result.content[0].text);
      expect(results).toHaveLength(0);
    });
  });

  describe('editFile', () => {
    it('should edit file content', async () => {
      const originalContent = 'Hello World\nThis is a test';
      const testFile = 'edit-test.txt';
      await fs.writeFile(path.join(tempDir, testFile), originalContent);

      const result = await filesystemTools.editFile({
        path: testFile,
        edits: [
          { oldText: 'World', newText: 'Universe' },
          { oldText: 'test', newText: 'example' }
        ]
      });

      expect(result.isError).toBeFalsy();
      const editResult = JSON.parse(result.content[0].text);
      expect(editResult.appliedChanges).toBe(2);

      const modifiedContent = await fs.readFile(path.join(tempDir, testFile), 'utf-8');
      expect(modifiedContent).toBe('Hello Universe\nThis is a example');
    });

    it('should support dry run mode', async () => {
      const originalContent = 'Hello World';
      const testFile = 'dry-run-test.txt';
      await fs.writeFile(path.join(tempDir, testFile), originalContent);

      const result = await filesystemTools.editFile({
        path: testFile,
        edits: [{ oldText: 'World', newText: 'Universe' }],
        dryRun: true
      });

      expect(result.isError).toBeFalsy();
      const editResult = JSON.parse(result.content[0].text);
      expect(editResult.dryRun).toBe(true);

      // Original file should be unchanged
      const unchangedContent = await fs.readFile(path.join(tempDir, testFile), 'utf-8');
      expect(unchangedContent).toBe(originalContent);
    });
  });

  describe('createDirectory', () => {
    it('should create directory successfully', async () => {
      const dirName = 'new-directory';

      const result = await filesystemTools.createDirectory({ path: dirName });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Successfully created directory');
      expect(await fs.pathExists(path.join(tempDir, dirName))).toBe(true);
    });
  });

  describe('moveFile', () => {
    it('should move file successfully', async () => {
      const sourceFile = 'source.txt';
      const destFile = 'destination.txt';
      await fs.writeFile(path.join(tempDir, sourceFile), 'test content');

      const result = await filesystemTools.moveFile({
        source: sourceFile,
        destination: destFile
      });

      expect(result.isError).toBeFalsy();
      expect(await fs.pathExists(path.join(tempDir, sourceFile))).toBe(false);
      expect(await fs.pathExists(path.join(tempDir, destFile))).toBe(true);
    });

    it('should fail when destination exists', async () => {
      const sourceFile = 'source.txt';
      const destFile = 'destination.txt';
      await fs.writeFile(path.join(tempDir, sourceFile), 'source content');
      await fs.writeFile(path.join(tempDir, destFile), 'dest content');

      const result = await filesystemTools.moveFile({
        source: sourceFile,
        destination: destFile
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Destination already exists');
    });
  });

  describe('getFileInfo', () => {
    it('should return file information', async () => {
      const testFile = 'info-test.txt';
      await fs.writeFile(path.join(tempDir, testFile), 'test content');

      const result = await filesystemTools.getFileInfo({ path: testFile });

      expect(result.isError).toBeFalsy();
      const info = JSON.parse(result.content[0].text);
      expect(info.path).toBe(testFile);
      expect(info.type).toBe('file');
      expect(info.size).toBeGreaterThan(0);
      expect(info.created).toBeDefined();
      expect(info.modified).toBeDefined();
    });
  });

  describe('readMultipleFiles', () => {
    beforeEach(async () => {
      await fs.writeFile(path.join(tempDir, 'file1.txt'), 'content1');
      await fs.writeFile(path.join(tempDir, 'file2.txt'), 'content2');
    });

    it('should read multiple files successfully', async () => {
      const result = await filesystemTools.readMultipleFiles({
        paths: ['file1.txt', 'file2.txt']
      });

      expect(result.isError).toBeFalsy();
      const results = JSON.parse(result.content[0].text);
      expect(results).toHaveLength(2);
      expect(results[0].content).toBe('content1');
      expect(results[1].content).toBe('content2');
    });

    it('should handle mixed success and failure', async () => {
      const result = await filesystemTools.readMultipleFiles({
        paths: ['file1.txt', 'nonexistent.txt']
      });

      expect(result.isError).toBeFalsy();
      const results = JSON.parse(result.content[0].text);
      expect(results).toHaveLength(2);
      expect(results[0].content).toBe('content1');
      expect(results[1].error).toBeDefined();
    });
  });
});
