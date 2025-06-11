export interface ToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export abstract class BaseTool {
  protected workingDirectory: string;

  constructor(workingDirectory: string) {
    this.workingDirectory = workingDirectory;
  }

  protected handleError(error: unknown, operation: string): ToolResult {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`${operation} failed:`, error);
    
    return {
      content: [
        {
          type: 'text',
          text: `${operation} failed: ${message}`,
        },
      ],
      isError: true,
    };
  }

  protected createSuccessResult(text: string): ToolResult {
    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  }

  protected createJsonResult(data: any): ToolResult {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  protected validatePath(filepath: string): string {
    // Basic path validation to prevent directory traversal
    if (filepath.includes('..') || filepath.startsWith('/')) {
      throw new ValidationError('Invalid file path: path traversal not allowed');
    }
    return filepath;
  }

  protected sanitizeInput(input: string): string {
    // Basic input sanitization
    return input.replace(/[;&|`$(){}[\]]/g, '');
  }
}
