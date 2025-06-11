# Autonomous AI Server

A comprehensive MCP (Model Context Protocol) server providing autonomous AI capabilities with extensive tooling for file system operations, web automation, Git integration, and multi-agent orchestration.

## 🚀 Features

### Core Capabilities
- **Modular Architecture**: Clean separation of concerns with dedicated tool modules
- **Comprehensive File System Operations**: Advanced file manipulation with pattern matching
- **Web Automation**: Browser automation, screenshot capture, and web scraping
- **Git Integration**: Full Git workflow support including branching and merging
- **Multi-Agent Orchestration**: Sophisticated task delegation and collaboration
- **Performance Auditing**: Lighthouse integration for accessibility and performance analysis

### Tool Categories

#### 📁 File System Tools
- Read/write files with directory creation
- Advanced file search with regex patterns
- Selective file editing with dry-run support
- File metadata and batch operations
- Directory management and file moving

#### 🌐 Web Tools
- HTML/JSON/text content fetching
- Screenshot capture with viewport control
- Accessibility and performance auditing
- DOM analysis and console log monitoring
- Network request tracking

#### 🔧 Git Tools
- Repository status and diff operations
- Commit, branch, and merge operations
- Remote repository management
- Stash operations and log viewing
- Repository initialization

## 📦 Installation

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Git (for Git tools functionality)
- Chrome/Chromium (for web automation)

### Setup

1. **Clone and install dependencies:**
```bash
git clone <repository-url>
cd autonomous-ai-server
npm install
```

2. **Build the project:**
```bash
npm run build
```

3. **Run the server:**
```bash
npm start
# or for development
npm run dev
```

## 🛠️ Development

### Project Structure
```
autonomous-ai-server/
├── src/
│   ├── tools/                 # Modular tool implementations
│   │   ├── base-tool.ts      # Base tool class with common functionality
│   │   ├── filesystem/       # File system operations
│   │   ├── web/             # Web automation and scraping
│   │   ├── git/             # Git repository management
│   │   └── tool-registry.ts # Central tool registration
│   ├── server.ts            # Main MCP server implementation
│   ├── resource-manager.ts  # Resource management
│   ├── multiagent.ts       # Multi-agent orchestration
│   └── model-config.ts     # AI model configuration
├── tests/                   # Test suites
├── jest.config.js          # Jest configuration
└── tsconfig.json          # TypeScript configuration
```

### Available Scripts

```bash
# Development
npm run dev          # Start development server
npm run build        # Build TypeScript to JavaScript
npm run start        # Start production server

# Testing
npm run test         # Run test suite
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage report

# Code Quality
npm run lint         # Run ESLint
npm run clean        # Clean build directory
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

## 🔧 Configuration

### MCP Configuration

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "autonomous-ai": {
      "command": "node",
      "args": ["path/to/autonomous-ai-server/dist/server.js"],
      "cwd": "/your/working/directory"
    }
  }
}
```

### Environment Variables

```bash
# Optional: Set working directory
WORKING_DIRECTORY=/path/to/your/workspace

# Optional: Configure browser for web tools
PUPPETEER_EXECUTABLE_PATH=/path/to/chrome
```

## 📚 API Reference

### File System Tools

#### `read_file`
Read file content from the working directory.

```json
{
  "name": "read_file",
  "arguments": {
    "filepath": "src/example.ts"
  }
}
```

#### `write_file`
Write content to a file with optional directory creation.

```json
{
  "name": "write_file",
  "arguments": {
    "filepath": "output/result.txt",
    "content": "Hello, World!",
    "create_dirs": true
  }
}
```

#### `search_files`
Search for text patterns across files.

```json
{
  "name": "search_files",
  "arguments": {
    "pattern": "function.*export",
    "path": "src",
    "file_pattern": "*.ts",
    "case_sensitive": false
  }
}
```

### Web Tools

#### `fetch_html`
Fetch website content as HTML.

```json
{
  "name": "fetch_html",
  "arguments": {
    "url": "https://example.com",
    "headers": {
      "User-Agent": "Custom Agent"
    }
  }
}
```

#### `capture_screenshot`
Capture website screenshots.

```json
{
  "name": "capture_screenshot",
  "arguments": {
    "url": "https://example.com",
    "fullPage": true,
    "viewport": {
      "width": 1280,
      "height": 720
    }
  }
}
```

#### `run_accessibility_audit`
Run Lighthouse accessibility audit.

```json
{
  "name": "run_accessibility_audit",
  "arguments": {
    "url": "https://example.com"
  }
}
```

### Git Tools

#### `git_status`
Get repository status.

```json
{
  "name": "git_status",
  "arguments": {
    "repo_path": "."
  }
}
```

#### `git_commit`
Commit staged changes.

```json
{
  "name": "git_commit",
  "arguments": {
    "message": "Add new feature",
    "repo_path": "."
  }
}
```

#### `git_create_branch`
Create and switch to new branch.

```json
{
  "name": "git_create_branch",
  "arguments": {
    "branch_name": "feature/new-feature",
    "start_point": "main"
  }
}
```

## 🔒 Security

### Path Validation
- All file operations validate paths to prevent directory traversal
- Paths are restricted to the configured working directory
- Input sanitization for Git commands

### Safe Execution
- Git commands use parameterized execution
- Web requests include timeout protection
- Browser automation runs in sandboxed environment

## 🤝 Contributing

### Development Setup

1. **Fork and clone the repository**
2. **Install dependencies:** `npm install`
3. **Create feature branch:** `git checkout -b feature/amazing-feature`
4. **Make changes and add tests**
5. **Run tests:** `npm test`
6. **Commit changes:** `git commit -m 'Add amazing feature'`
7. **Push to branch:** `git push origin feature/amazing-feature`
8. **Open Pull Request**

### Code Style

- Use TypeScript for all new code
- Follow existing code formatting
- Add tests for new functionality
- Update documentation as needed

### Adding New Tools

1. **Create tool class** extending `BaseTool`
2. **Add to tool registry** in `tool-registry.ts`
3. **Write comprehensive tests**
4. **Update API documentation**

Example:
```typescript
export class MyTool extends BaseTool {
  async myMethod(args: { param: string }): Promise<ToolResult> {
    try {
      // Implementation
      return this.createSuccessResult(result);
    } catch (error) {
      return this.handleError(error, 'My operation');
    }
  }
}
```

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🐛 Troubleshooting

### Common Issues

**TypeScript compilation errors:**
```bash
npm run clean
npm install
npm run build
```

**Puppeteer installation issues:**
```bash
npm install puppeteer --force
```

**Git command failures:**
- Ensure Git is installed and accessible
- Check repository permissions
- Verify working directory is a Git repository

**Web automation failures:**
- Install Chrome/Chromium browser
- Check network connectivity
- Verify URL accessibility

### Debug Mode

Enable verbose logging:
```bash
DEBUG=autonomous-ai:* npm run dev
```

## 📞 Support

- **Issues:** [GitHub Issues](https://github.com/your-repo/issues)
- **Discussions:** [GitHub Discussions](https://github.com/your-repo/discussions)
- **Documentation:** [Wiki](https://github.com/your-repo/wiki)

---

**Built with ❤️ for autonomous AI development**
