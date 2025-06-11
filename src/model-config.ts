export interface ModelConfig {
  name: string;
  endpoint: string;
  vramUsage: number;
  tokensPerSecond: number;
  specializations: string[];
  role: string;
  priority: 'high' | 'medium' | 'low';
}

export interface AgentRoleConfig {
  primaryModel: string;
  fallbackModel?: string;
  subAgentModels: string[];
  capabilities: string[];
  systemPrompt: string;
}

// Available Models Configuration
export const AVAILABLE_MODELS: Record<string, ModelConfig> = {
  // Your Current Excellent Models
  'deepseek-coder-33b': {
    name: 'deepseek-coder:33b',
    endpoint: 'http://localhost:11434',
    vramUsage: 20,
    tokensPerSecond: 20,
    specializations: ['architecture', 'complex-reasoning', 'system-design', 'code-review'],
    role: 'Main Orchestrator',
    priority: 'high'
  },
  'deepseek-coder-6.7b': {
    name: 'deepseek-coder:6.7b',
    endpoint: 'http://localhost:11434',
    vramUsage: 4,
    tokensPerSecond: 50,
    specializations: ['implementation', 'debugging', 'refactoring', 'rapid-coding'],
    role: 'Implementation Agent',
    priority: 'high'
  },
  'codestral-6.7b': {
    name: 'codestral:6.7b',
    endpoint: 'http://localhost:11434',
    vramUsage: 4,
    tokensPerSecond: 45,
    specializations: ['code-generation', 'optimization', 'patterns', 'best-practices'],
    role: 'Code Specialist',
    priority: 'high'
  },

  // Specialized Sub-Agent Models (Recommended Additions)
  'qwen2.5-coder-7b': {
    name: 'qwen2.5-coder:7b',
    endpoint: 'http://localhost:11434',
    vramUsage: 4,
    tokensPerSecond: 55,
    specializations: ['documentation', 'comments', 'api-design', 'testing'],
    role: 'Documentation Specialist',
    priority: 'medium'
  },
  'deepseek-coder-1.3b': {
    name: 'deepseek-coder:1.3b',
    endpoint: 'http://localhost:11434',
    vramUsage: 1,
    tokensPerSecond: 100,
    specializations: ['quick-fixes', 'syntax-checking', 'simple-tasks', 'validation'],
    role: 'Quick Task Agent',
    priority: 'low'
  },
  'starcoder2-7b': {
    name: 'starcoder2:7b',
    endpoint: 'http://localhost:11434',
    vramUsage: 4,
    tokensPerSecond: 50,
    specializations: ['multi-language', 'translation', 'cross-platform', 'polyglot'],
    role: 'Multi-Language Specialist',
    priority: 'medium'
  },
  'codet5-770m': {
    name: 'codet5:770m',
    endpoint: 'http://localhost:11434',
    vramUsage: 1,
    tokensPerSecond: 120,
    specializations: ['test-generation', 'unit-tests', 'mocking', 'assertions'],
    role: 'Test Generator',
    priority: 'low'
  }
};

// Agent Role Configurations
export const AGENT_ROLES: Record<string, AgentRoleConfig> = {
  'main-orchestrator': {
    primaryModel: 'deepseek-coder-33b',
    fallbackModel: 'deepseek-coder-6.7b',
    subAgentModels: ['deepseek-coder-6.7b', 'codestral-6.7b'],
    capabilities: [
      'system-architecture',
      'complex-reasoning',
      'task-decomposition',
      'agent-coordination',
      'strategic-planning',
      'code-review',
      'performance-optimization'
    ],
    systemPrompt: `You are the Main Orchestrator Agent, responsible for high-level system architecture and coordinating multiple sub-agents. You excel at:
- Breaking down complex projects into manageable tasks
- Designing system architecture and data flow
- Coordinating between specialized agents
- Making strategic technical decisions
- Reviewing and optimizing overall code quality
- Managing project timelines and dependencies

Use your deep reasoning capabilities to provide thoughtful, well-structured solutions.`
  },

  'implementation-agent': {
    primaryModel: 'deepseek-coder-6.7b',
    fallbackModel: 'codestral-6.7b',
    subAgentModels: ['deepseek-coder-1.3b', 'codet5-770m'],
    capabilities: [
      'rapid-coding',
      'implementation',
      'debugging',
      'refactoring',
      'error-handling',
      'performance-tuning',
      'code-optimization'
    ],
    systemPrompt: `You are an Implementation Agent specialized in rapid, high-quality code development. Your strengths include:
- Fast, accurate code implementation
- Debugging and error resolution
- Code refactoring and optimization
- Following coding standards and best practices
- Implementing complex algorithms efficiently
- Handling edge cases and error scenarios

Focus on clean, efficient, and maintainable code that follows established patterns.`
  },

  'code-specialist': {
    primaryModel: 'codestral-6.7b',
    fallbackModel: 'deepseek-coder-6.7b',
    subAgentModels: ['starcoder2-7b', 'deepseek-coder-1.3b'],
    capabilities: [
      'code-generation',
      'pattern-implementation',
      'optimization',
      'best-practices',
      'design-patterns',
      'code-quality',
      'performance-analysis'
    ],
    systemPrompt: `You are a Code Specialist focused on generating high-quality, optimized code. Your expertise includes:
- Implementing design patterns and best practices
- Code optimization and performance improvements
- Generating clean, readable, and maintainable code
- Following language-specific conventions
- Creating reusable and modular components
- Ensuring code quality and consistency

Prioritize code elegance, efficiency, and maintainability in all implementations.`
  },

  'testing-agent': {
    primaryModel: 'qwen2.5-coder-7b',
    fallbackModel: 'deepseek-coder-6.7b',
    subAgentModels: ['codet5-770m', 'deepseek-coder-1.3b'],
    capabilities: [
      'test-generation',
      'unit-testing',
      'integration-testing',
      'test-automation',
      'quality-assurance',
      'coverage-analysis',
      'test-optimization'
    ],
    systemPrompt: `You are a Testing Agent specialized in comprehensive test creation and quality assurance. Your focus areas include:
- Generating comprehensive unit and integration tests
- Creating test cases for edge cases and error scenarios
- Implementing test automation frameworks
- Ensuring high test coverage and quality
- Performance and load testing strategies
- Test data generation and mocking
- Continuous testing and validation

Ensure all code is thoroughly tested and meets quality standards.`
  },

  'documentation-agent': {
    primaryModel: 'qwen2.5-coder-7b',
    fallbackModel: 'codestral-6.7b',
    subAgentModels: ['deepseek-coder-1.3b'],
    capabilities: [
      'documentation-generation',
      'api-documentation',
      'code-comments',
      'technical-writing',
      'user-guides',
      'readme-creation',
      'changelog-management'
    ],
    systemPrompt: `You are a Documentation Agent specialized in creating clear, comprehensive technical documentation. Your responsibilities include:
- Writing detailed API documentation
- Creating user guides and tutorials
- Generating inline code comments
- Maintaining README files and changelogs
- Creating architectural documentation
- Writing technical specifications
- Ensuring documentation accuracy and clarity

Focus on making complex technical concepts accessible and well-organized.`
  },

  'debugging-agent': {
    primaryModel: 'deepseek-coder-6.7b',
    fallbackModel: 'codestral-6.7b',
    subAgentModels: ['deepseek-coder-1.3b'],
    capabilities: [
      'error-diagnosis',
      'debugging',
      'performance-analysis',
      'memory-optimization',
      'security-analysis',
      'code-profiling',
      'issue-resolution'
    ],
    systemPrompt: `You are a Debugging Agent specialized in identifying and resolving code issues. Your expertise includes:
- Systematic error diagnosis and resolution
- Performance bottleneck identification
- Memory leak detection and optimization
- Security vulnerability analysis
- Code profiling and optimization
- Root cause analysis
- Preventive debugging strategies

Approach problems methodically and provide clear explanations of issues and solutions.`
  },

  'research-agent': {
    primaryModel: 'deepseek-coder-6.7b',
    fallbackModel: 'qwen2.5-coder-7b',
    subAgentModels: ['starcoder2-7b'],
    capabilities: [
      'technology-research',
      'library-analysis',
      'best-practices-research',
      'solution-exploration',
      'trend-analysis',
      'compatibility-checking',
      'alternative-evaluation'
    ],
    systemPrompt: `You are a Research Agent specialized in technology research and analysis. Your focus areas include:
- Researching new technologies and frameworks
- Analyzing library compatibility and performance
- Exploring alternative solutions and approaches
- Staying current with industry best practices
- Evaluating technology trade-offs
- Providing recommendations based on research
- Creating technology comparison reports

Provide thorough, well-researched recommendations with clear pros and cons.`
  },

  'quick-task-agent': {
    primaryModel: 'deepseek-coder-1.3b',
    fallbackModel: 'codet5-770m',
    subAgentModels: [],
    capabilities: [
      'syntax-checking',
      'quick-fixes',
      'simple-tasks',
      'validation',
      'formatting',
      'basic-refactoring',
      'simple-generation'
    ],
    systemPrompt: `You are a Quick Task Agent optimized for fast, simple operations. Your responsibilities include:
- Rapid syntax checking and validation
- Quick code fixes and formatting
- Simple code generation tasks
- Basic refactoring operations
- File organization and cleanup
- Simple validation and verification
- Fast response to straightforward requests

Focus on speed and accuracy for routine tasks.`
  }
};

// Memory-Optimized Configurations for 28GB System
export const MEMORY_CONFIGURATIONS = {
  'high-performance': {
    description: 'Single large model + specialized agents',
    models: ['deepseek-coder-33b', 'deepseek-coder-6.7b', 'codestral-6.7b'],
    totalVram: 28,
    concurrentAgents: 3
  },
  'balanced': {
    description: 'Multiple medium models for parallel processing',
    models: ['deepseek-coder-6.7b', 'codestral-6.7b', 'qwen2.5-coder-7b', 'starcoder2-7b', 'deepseek-coder-1.3b'],
    totalVram: 17,
    concurrentAgents: 5
  },
  'high-throughput': {
    description: 'Many small models for maximum parallelism',
    models: ['deepseek-coder-6.7b', 'codestral-6.7b', 'qwen2.5-coder-7b', 'deepseek-coder-1.3b', 'codet5-770m'],
    totalVram: 14,
    concurrentAgents: 8
  }
};

// Task-to-Agent Mapping
export const TASK_AGENT_MAPPING = {
  'architecture': 'main-orchestrator',
  'implementation': 'implementation-agent',
  'coding': 'code-specialist',
  'testing': 'testing-agent',
  'documentation': 'documentation-agent',
  'debugging': 'debugging-agent',
  'research': 'research-agent',
  'planning': 'main-orchestrator',
  'custom': 'implementation-agent'
};

export function getOptimalAgentForTask(taskType: string, complexity: 'low' | 'medium' | 'high'): string {
  const baseAgent = TASK_AGENT_MAPPING[taskType as keyof typeof TASK_AGENT_MAPPING] || 'implementation-agent';
  
  // For high complexity tasks, prefer main orchestrator
  if (complexity === 'high' && baseAgent !== 'main-orchestrator') {
    return 'main-orchestrator';
  }
  
  // For low complexity tasks, prefer quick task agent for simple operations
  if (complexity === 'low' && ['testing', 'documentation'].includes(taskType)) {
    return 'quick-task-agent';
  }
  
  return baseAgent;
}

export function getModelForAgent(agentRole: string): ModelConfig {
  const roleConfig = AGENT_ROLES[agentRole];
  if (!roleConfig) {
    throw new Error(`Unknown agent role: ${agentRole}`);
  }
  
  const model = AVAILABLE_MODELS[roleConfig.primaryModel];
  if (!model) {
    throw new Error(`Model not found: ${roleConfig.primaryModel}`);
  }
  
  return model;
}
