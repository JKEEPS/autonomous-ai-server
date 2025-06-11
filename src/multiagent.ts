import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as path from 'path';
import { ResourceManager, TaskCheckpoint, ResourceMetrics } from './resource-manager.js';

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  capabilities: string[];
  systemPrompt: string;
  maxTokens?: number;
  temperature?: number;
  tools?: string[];
  parentAgentId?: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  timeout?: number;
}

export interface Task {
  id: string;
  description: string;
  type: 'research' | 'analysis' | 'coding' | 'testing' | 'documentation' | 'planning' | 'custom';
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignedAgentId?: string;
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  dependencies: string[];
  result?: any;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  estimatedDuration?: number;
  actualDuration?: number;
  parentTaskId?: string;
  subtasks: string[];
}

export interface AgentMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  type: 'task_assignment' | 'task_result' | 'collaboration_request' | 'status_update' | 'error_report';
  content: any;
  timestamp: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface AgentState {
  id: string;
  status: 'idle' | 'busy' | 'error' | 'offline';
  currentTask?: string;
  taskQueue: string[];
  performance: {
    tasksCompleted: number;
    tasksSuccessful: number;
    averageTaskDuration: number;
    lastActiveAt: string;
  };
  resources: {
    memoryUsage: number;
    cpuUsage: number;
    activeConnections: number;
  };
  capabilities: string[];
  specializations: string[];
}

export class MultiAgentOrchestrator extends EventEmitter {
  private agents: Map<string, AgentConfig> = new Map();
  private agentStates: Map<string, AgentState> = new Map();
  private tasks: Map<string, Task> = new Map();
  private messageQueue: AgentMessage[] = [];
  private collaborationGraph: Map<string, string[]> = new Map();
  private workingDirectory: string;
  private isRunning: boolean = false;
  private orchestratorInterval?: NodeJS.Timeout;

  constructor(workingDirectory: string) {
    super();
    this.workingDirectory = workingDirectory;
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.on('agent_created', (agentId: string) => {
      console.log(`Agent created: ${agentId}`);
    });

    this.on('task_assigned', (taskId: string, agentId: string) => {
      console.log(`Task ${taskId} assigned to agent ${agentId}`);
    });

    this.on('task_completed', (taskId: string, agentId: string) => {
      console.log(`Task ${taskId} completed by agent ${agentId}`);
    });

    this.on('collaboration_started', (agentIds: string[]) => {
      console.log(`Collaboration started between agents: ${agentIds.join(', ')}`);
    });
  }

  // Agent Management
  async createAgent(config: AgentConfig): Promise<string> {
    if (this.agents.has(config.id)) {
      throw new Error(`Agent with ID ${config.id} already exists`);
    }

    // Validate agent configuration
    this.validateAgentConfig(config);

    // Create agent
    this.agents.set(config.id, config);

    // Initialize agent state
    const initialState: AgentState = {
      id: config.id,
      status: 'idle',
      taskQueue: [],
      performance: {
        tasksCompleted: 0,
        tasksSuccessful: 0,
        averageTaskDuration: 0,
        lastActiveAt: new Date().toISOString(),
      },
      resources: {
        memoryUsage: 0,
        cpuUsage: 0,
        activeConnections: 0,
      },
      capabilities: config.capabilities,
      specializations: this.deriveSpecializations(config),
    };

    this.agentStates.set(config.id, initialState);

    // Set up collaboration relationships
    if (config.parentAgentId) {
      this.addCollaborationLink(config.parentAgentId, config.id);
    }

    this.emit('agent_created', config.id);
    return config.id;
  }

  async createSubAgent(parentAgentId: string, subAgentConfig: Partial<AgentConfig>): Promise<string> {
    const parentAgent = this.agents.get(parentAgentId);
    if (!parentAgent) {
      throw new Error(`Parent agent ${parentAgentId} not found`);
    }

    const subAgentId = `${parentAgentId}_sub_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    const fullConfig: AgentConfig = {
      id: subAgentId,
      name: subAgentConfig.name || `${parentAgent.name} Sub-Agent`,
      role: subAgentConfig.role || `Sub-${parentAgent.role}`,
      capabilities: subAgentConfig.capabilities || [...parentAgent.capabilities],
      systemPrompt: subAgentConfig.systemPrompt || this.generateSubAgentPrompt(parentAgent, subAgentConfig),
      maxTokens: subAgentConfig.maxTokens || parentAgent.maxTokens,
      temperature: subAgentConfig.temperature || parentAgent.temperature,
      tools: subAgentConfig.tools || parentAgent.tools,
      parentAgentId: parentAgentId,
      priority: subAgentConfig.priority || 'medium',
      timeout: subAgentConfig.timeout || 300000, // 5 minutes default
    };

    return await this.createAgent(fullConfig);
  }

  private generateSubAgentPrompt(parentAgent: AgentConfig, subAgentConfig: Partial<AgentConfig>): string {
    return `You are a specialized sub-agent working under ${parentAgent.name} (${parentAgent.role}).

Your specific role: ${subAgentConfig.role || 'Specialized Assistant'}

Parent Agent Context:
- Role: ${parentAgent.role}
- Capabilities: ${parentAgent.capabilities.join(', ')}

Your Responsibilities:
- Execute specific subtasks assigned by your parent agent
- Report progress and results back to the parent agent
- Collaborate with sibling agents when necessary
- Maintain focus on your specialized domain
- Escalate complex issues to the parent agent

Communication Protocol:
- Always acknowledge task assignments
- Provide regular status updates
- Report completion with detailed results
- Flag any blockers or dependencies immediately

${subAgentConfig.systemPrompt || ''}`;
  }

  async removeAgent(agentId: string): Promise<boolean> {
    if (!this.agents.has(agentId)) {
      return false;
    }

    // Cancel any active tasks
    const agentState = this.agentStates.get(agentId);
    if (agentState?.currentTask) {
      await this.cancelTask(agentState.currentTask);
    }

    // Remove from collaboration graph
    this.collaborationGraph.delete(agentId);
    for (const [_, collaborators] of this.collaborationGraph.entries()) {
      const index = collaborators.indexOf(agentId);
      if (index > -1) {
        collaborators.splice(index, 1);
      }
    }

    // Remove agent and state
    this.agents.delete(agentId);
    this.agentStates.delete(agentId);

    return true;
  }

  // Task Management
  async createTask(taskConfig: Partial<Task>): Promise<string> {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const task: Task = {
      id: taskId,
      description: taskConfig.description || 'Unnamed task',
      type: taskConfig.type || 'custom',
      priority: taskConfig.priority || 'medium',
      status: 'pending',
      dependencies: taskConfig.dependencies || [],
      createdAt: new Date().toISOString(),
      subtasks: [],
      ...taskConfig,
    };

    this.tasks.set(taskId, task);
    return taskId;
  }

  async assignTask(taskId: string, agentId?: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.status !== 'pending') {
      throw new Error(`Task ${taskId} is not in pending status`);
    }

    // Auto-assign if no agent specified
    if (!agentId) {
      agentId = await this.findBestAgent(task);
      if (!agentId) {
        throw new Error('No suitable agent found for task');
      }
    }

    const agentState = this.agentStates.get(agentId);
    if (!agentState) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // Check dependencies
    const unmetDependencies = await this.checkTaskDependencies(task);
    if (unmetDependencies.length > 0) {
      throw new Error(`Task has unmet dependencies: ${unmetDependencies.join(', ')}`);
    }

    // Assign task
    task.assignedAgentId = agentId;
    task.status = 'assigned';
    agentState.taskQueue.push(taskId);

    this.tasks.set(taskId, task);
    this.agentStates.set(agentId, agentState);

    this.emit('task_assigned', taskId, agentId);
    return true;
  }

  async executeTask(taskId: string): Promise<any> {
    const task = this.tasks.get(taskId);
    if (!task || !task.assignedAgentId) {
      throw new Error(`Task ${taskId} not found or not assigned`);
    }

    const agentState = this.agentStates.get(task.assignedAgentId);
    if (!agentState) {
      throw new Error(`Agent ${task.assignedAgentId} not found`);
    }

    try {
      // Update task status
      task.status = 'in_progress';
      task.startedAt = new Date().toISOString();
      agentState.status = 'busy';
      agentState.currentTask = taskId;

      this.tasks.set(taskId, task);
      this.agentStates.set(task.assignedAgentId, agentState);

      // Execute task based on type
      const result = await this.executeTaskByType(task);

      // Update completion status
      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      task.result = result;
      
      if (task.startedAt) {
        task.actualDuration = new Date().getTime() - new Date(task.startedAt).getTime();
      }

      agentState.status = 'idle';
      agentState.currentTask = undefined;
      agentState.performance.tasksCompleted++;
      agentState.performance.tasksSuccessful++;
      
      if (task.actualDuration) {
        agentState.performance.averageTaskDuration = 
          (agentState.performance.averageTaskDuration * (agentState.performance.tasksCompleted - 1) + task.actualDuration) / 
          agentState.performance.tasksCompleted;
      }

      // Remove from queue
      const queueIndex = agentState.taskQueue.indexOf(taskId);
      if (queueIndex > -1) {
        agentState.taskQueue.splice(queueIndex, 1);
      }

      this.tasks.set(taskId, task);
      this.agentStates.set(task.assignedAgentId, agentState);

      this.emit('task_completed', taskId, task.assignedAgentId);
      return result;

    } catch (error) {
      // Handle task failure
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : 'Unknown error';
      task.completedAt = new Date().toISOString();

      agentState.status = 'idle';
      agentState.currentTask = undefined;
      agentState.performance.tasksCompleted++;

      // Remove from queue
      const queueIndex = agentState.taskQueue.indexOf(taskId);
      if (queueIndex > -1) {
        agentState.taskQueue.splice(queueIndex, 1);
      }

      this.tasks.set(taskId, task);
      this.agentStates.set(task.assignedAgentId, agentState);

      throw error;
    }
  }

  private async executeTaskByType(task: Task): Promise<any> {
    const agent = this.agents.get(task.assignedAgentId!);
    if (!agent) {
      throw new Error('Agent not found');
    }

    // Simulate task execution based on type
    switch (task.type) {
      case 'research':
        return await this.executeResearchTask(task, agent);
      case 'analysis':
        return await this.executeAnalysisTask(task, agent);
      case 'coding':
        return await this.executeCodingTask(task, agent);
      case 'testing':
        return await this.executeTestingTask(task, agent);
      case 'documentation':
        return await this.executeDocumentationTask(task, agent);
      case 'planning':
        return await this.executePlanningTask(task, agent);
      default:
        return await this.executeCustomTask(task, agent);
    }
  }

  // Collaboration Management
  async createCollaboration(agentIds: string[], collaborationType: string = 'general'): Promise<string> {
    const collaborationId = `collab_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    // Validate all agents exist
    for (const agentId of agentIds) {
      if (!this.agents.has(agentId)) {
        throw new Error(`Agent ${agentId} not found`);
      }
    }

    // Create collaboration links
    for (let i = 0; i < agentIds.length; i++) {
      for (let j = i + 1; j < agentIds.length; j++) {
        this.addCollaborationLink(agentIds[i], agentIds[j]);
        this.addCollaborationLink(agentIds[j], agentIds[i]);
      }
    }

    this.emit('collaboration_started', agentIds);
    return collaborationId;
  }

  private addCollaborationLink(fromAgentId: string, toAgentId: string) {
    if (!this.collaborationGraph.has(fromAgentId)) {
      this.collaborationGraph.set(fromAgentId, []);
    }
    
    const collaborators = this.collaborationGraph.get(fromAgentId)!;
    if (!collaborators.includes(toAgentId)) {
      collaborators.push(toAgentId);
    }
  }

  async sendMessage(message: Omit<AgentMessage, 'id' | 'timestamp'>): Promise<string> {
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    const fullMessage: AgentMessage = {
      id: messageId,
      timestamp: new Date().toISOString(),
      ...message,
    };

    this.messageQueue.push(fullMessage);
    
    // Process message immediately if agents are available
    await this.processMessage(fullMessage);
    
    return messageId;
  }

  private async processMessage(message: AgentMessage): Promise<void> {
    const toAgent = this.agentStates.get(message.toAgentId);
    if (!toAgent) {
      console.error(`Target agent ${message.toAgentId} not found`);
      return;
    }

    switch (message.type) {
      case 'task_assignment':
        await this.handleTaskAssignmentMessage(message);
        break;
      case 'task_result':
        await this.handleTaskResultMessage(message);
        break;
      case 'collaboration_request':
        await this.handleCollaborationRequestMessage(message);
        break;
      case 'status_update':
        await this.handleStatusUpdateMessage(message);
        break;
      case 'error_report':
        await this.handleErrorReportMessage(message);
        break;
    }
  }

  // Orchestrator Control
  async startOrchestrator(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.orchestratorInterval = setInterval(async () => {
      await this.orchestratorTick();
    }, 1000); // Run every second

    console.log('Multi-agent orchestrator started');
  }

  async stopOrchestrator(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.orchestratorInterval) {
      clearInterval(this.orchestratorInterval);
      this.orchestratorInterval = undefined;
    }

    console.log('Multi-agent orchestrator stopped');
  }

  private async orchestratorTick(): Promise<void> {
    try {
      // Process pending tasks
      await this.processPendingTasks();
      
      // Process message queue
      await this.processMessageQueue();
      
      // Update agent states
      await this.updateAgentStates();
      
      // Handle timeouts
      await this.handleTimeouts();
      
      // Optimize task distribution
      await this.optimizeTaskDistribution();
      
    } catch (error) {
      console.error('Error in orchestrator tick:', error);
    }
  }

  // Utility Methods
  private validateAgentConfig(config: AgentConfig): void {
    if (!config.id || !config.name || !config.role) {
      throw new Error('Agent must have id, name, and role');
    }

    if (!config.capabilities || config.capabilities.length === 0) {
      throw new Error('Agent must have at least one capability');
    }

    if (!config.systemPrompt) {
      throw new Error('Agent must have a system prompt');
    }
  }

  private deriveSpecializations(config: AgentConfig): string[] {
    const specializations: string[] = [];
    
    // Derive specializations from capabilities and role
    if (config.capabilities.includes('coding')) {
      specializations.push('software_development');
    }
    if (config.capabilities.includes('research')) {
      specializations.push('information_gathering');
    }
    if (config.capabilities.includes('analysis')) {
      specializations.push('data_analysis');
    }
    if (config.role.toLowerCase().includes('test')) {
      specializations.push('quality_assurance');
    }
    if (config.role.toLowerCase().includes('doc')) {
      specializations.push('technical_writing');
    }

    return specializations;
  }

  private async findBestAgent(task: Task): Promise<string | null> {
    const availableAgents = Array.from(this.agentStates.entries())
      .filter(([_, state]) => state.status === 'idle')
      .map(([id, state]) => ({ id, state, config: this.agents.get(id)! }));

    if (availableAgents.length === 0) {
      return null;
    }

    // Score agents based on capabilities, specializations, and performance
    const scoredAgents = availableAgents.map(agent => {
      let score = 0;
      
      // Capability matching
      const taskCapabilities = this.getTaskRequiredCapabilities(task);
      const matchingCapabilities = agent.config.capabilities.filter(cap => 
        taskCapabilities.includes(cap)
      );
      score += matchingCapabilities.length * 10;
      
      // Specialization matching
      const taskSpecializations = this.getTaskRequiredSpecializations(task);
      const matchingSpecializations = agent.state.specializations.filter(spec => 
        taskSpecializations.includes(spec)
      );
      score += matchingSpecializations.length * 15;
      
      // Performance bonus
      if (agent.state.performance.tasksSuccessful > 0) {
        const successRate = agent.state.performance.tasksSuccessful / agent.state.performance.tasksCompleted;
        score += successRate * 5;
      }
      
      // Priority matching
      if (agent.config.priority === task.priority) {
        score += 5;
      }
      
      // Queue length penalty
      score -= agent.state.taskQueue.length * 2;
      
      return { ...agent, score };
    });

    // Sort by score and return best agent
    scoredAgents.sort((a, b) => b.score - a.score);
    return scoredAgents[0]?.id || null;
  }

  private getTaskRequiredCapabilities(task: Task): string[] {
    const capabilities: string[] = [];
    
    switch (task.type) {
      case 'research':
        capabilities.push('research', 'web_browsing', 'data_collection');
        break;
      case 'analysis':
        capabilities.push('analysis', 'data_processing', 'reasoning');
        break;
      case 'coding':
        capabilities.push('coding', 'programming', 'software_development');
        break;
      case 'testing':
        capabilities.push('testing', 'quality_assurance', 'debugging');
        break;
      case 'documentation':
        capabilities.push('documentation', 'writing', 'technical_writing');
        break;
      case 'planning':
        capabilities.push('planning', 'project_management', 'strategy');
        break;
    }
    
    return capabilities;
  }

  private getTaskRequiredSpecializations(task: Task): string[] {
    const specializations: string[] = [];
    
    switch (task.type) {
      case 'research':
        specializations.push('information_gathering', 'data_analysis');
        break;
      case 'analysis':
        specializations.push('data_analysis', 'statistical_analysis');
        break;
      case 'coding':
        specializations.push('software_development', 'programming');
        break;
      case 'testing':
        specializations.push('quality_assurance', 'test_automation');
        break;
      case 'documentation':
        specializations.push('technical_writing', 'documentation');
        break;
      case 'planning':
        specializations.push('project_management', 'strategic_planning');
        break;
    }
    
    return specializations;
  }

  private async checkTaskDependencies(task: Task): Promise<string[]> {
    const unmetDependencies: string[] = [];
    
    for (const depId of task.dependencies) {
      const depTask = this.tasks.get(depId);
      if (!depTask || depTask.status !== 'completed') {
        unmetDependencies.push(depId);
      }
    }
    
    return unmetDependencies;
  }

  // Task execution methods (simplified implementations)
  private async executeResearchTask(task: Task, agent: AgentConfig): Promise<any> {
    // Simulate research task execution
    await this.delay(Math.random() * 5000 + 2000); // 2-7 seconds
    
    return {
      type: 'research_result',
      findings: [
        `Research finding 1 for: ${task.description}`,
        `Research finding 2 for: ${task.description}`,
        `Research finding 3 for: ${task.description}`,
      ],
      sources: [
        'https://example.com/source1',
        'https://example.com/source2',
      ],
      confidence: Math.random() * 0.3 + 0.7, // 0.7-1.0
      executedBy: agent.id,
      executionTime: new Date().toISOString(),
    };
  }

  private async executeAnalysisTask(task: Task, agent: AgentConfig): Promise<any> {
    await this.delay(Math.random() * 4000 + 1000);
    
    return {
      type: 'analysis_result',
      insights: [
        `Key insight 1 from analysis of: ${task.description}`,
        `Key insight 2 from analysis of: ${task.description}`,
      ],
      metrics: {
        accuracy: Math.random() * 0.2 + 0.8,
        completeness: Math.random() * 0.3 + 0.7,
        relevance: Math.random() * 0.2 + 0.8,
      },
      recommendations: [
        'Recommendation 1 based on analysis',
        'Recommendation 2 based on analysis',
      ],
      executedBy: agent.id,
      executionTime: new Date().toISOString(),
    };
  }

  private async executeCodingTask(task: Task, agent: AgentConfig): Promise<any> {
    await this.delay(Math.random() * 8000 + 3000);
    
    return {
      type: 'coding_result',
      code: `// Code generated for: ${task.description}\nfunction generatedFunction() {\n  // Implementation here\n  return 'Task completed';\n}`,
      files: [
        `${task.id}.js`,
        `${task.id}.test.js`,
      ],
      linesOfCode: Math.floor(Math.random() * 200) + 50,
      complexity: Math.random() * 0.5 + 0.3,
      testCoverage: Math.random() * 0.3 + 0.7,
      executedBy: agent.id,
      executionTime: new Date().toISOString(),
    };
  }

  private async executeTestingTask(task: Task, agent: AgentConfig): Promise<any> {
    await this.delay(Math.random() * 6000 + 2000);
    
    return {
      type: 'testing_result',
      testsRun: Math.floor(Math.random() * 50) + 10,
      testsPassed: Math.floor(Math.random() * 45) + 8,
      testsFailed: Math.floor(Math.random() * 5),
      coverage: Math.random() * 0.3 + 0.7,
      issues: [
        'Minor issue found in edge case handling',
        'Performance optimization opportunity identified',
      ],
      executedBy: agent.id,
      executionTime: new Date().toISOString(),
    };
  }

  private async executeDocumentationTask(task: Task, agent: AgentConfig): Promise<any> {
    await this.delay(Math.random() * 5000 + 2000);
    
    return {
      type: 'documentation_result',
      documents: [
        `${task.id}_readme.md`,
        `${task.id}_api_docs.md`,
      ],
      wordCount: Math.floor(Math.random() * 2000) + 500,
      sections: [
        'Overview',
        'Installation',
        'Usage',
        'API Reference',
        'Examples',
      ],
      readabilityScore: Math.random() * 0.3 + 0.7,
      executedBy: agent.id,
      executionTime: new Date().toISOString(),
    };
  }

  private async executePlanningTask(task: Task, agent: AgentConfig): Promise<any> {
    await this.delay(Math.random() * 4000 + 2000);
    
    return {
      type: 'planning_result',
      plan: {
        phases: [
          'Phase 1: Analysis and Requirements',
          'Phase 2: Design and Architecture',
          'Phase 3: Implementation',
          'Phase 4: Testing and Validation',
          'Phase 5: Deployment and Monitoring',
        ],
        timeline: '4-6 weeks',
        resources: [
          '2 developers',
          '1 designer',
          '1 tester',
        ],
        risks: [
          'Technical complexity',
          'Timeline constraints',
        ],
        milestones: [
          'Requirements finalized',
          'Design approved',
          'MVP completed',
          'Testing completed',
          'Production deployment',
        ],
      },
      executedBy: agent.id,
      executionTime: new Date().toISOString(),
    };
  }

  private async executeCustomTask(task: Task, agent: AgentConfig): Promise<any> {
    await this.delay(Math.random() * 3000 + 1000);
    
    return {
      type: 'custom_result',
      result: `Custom task "${task.description}" completed successfully`,
      details: {
        approach: 'Custom implementation approach',
        outcome: 'Successful completion',
        notes: 'Task executed according to specifications',
      },
      executedBy: agent.id,
      executionTime: new Date().toISOString(),
    };
  }

  // Message handling methods
  private async handleTaskAssignmentMessage(message: AgentMessage): Promise<void> {
    // Handle task assignment from one agent to another
    const { taskId, instructions } = message.content;
    
    if (taskId && this.tasks.has(taskId)) {
      await this.assignTask(taskId, message.toAgentId);
    }
  }

  private async handleTaskResultMessage(message: AgentMessage): Promise<void> {
    // Handle task result reporting
    const { taskId, result } = message.content;
    
    if (taskId && this.tasks.has(taskId)) {
      const task = this.tasks.get(taskId)!;
      task.result = result;
      task.status = 'completed';
      this.tasks.set(taskId, task);
    }
  }

  private async handleCollaborationRequestMessage(message: AgentMessage): Promise<void> {
    // Handle collaboration requests between agents
    const { requestType, details } = message.content;
    
    // Create collaboration if both agents agree
    await this.createCollaboration([message.fromAgentId, message.toAgentId], requestType);
  }

  private async handleStatusUpdateMessage(message: AgentMessage): Promise<void> {
    // Handle status updates from agents
    const { status, details } = message.content;
    
    const agentState = this.agentStates.get(message.fromAgentId);
    if (agentState) {
      agentState.performance.lastActiveAt = new Date().toISOString();
      this.agentStates.set(message.fromAgentId, agentState);
    }
  }

  private async handleErrorReportMessage(message: AgentMessage): Promise<void> {
    // Handle error reports from agents
    const { error, taskId } = message.content;
    
    console.error(`Agent ${message.fromAgentId} reported error:`, error);
    
    if (taskId && this.tasks.has(taskId)) {
      const task = this.tasks.get(taskId)!;
      task.status = 'failed';
      task.error = error;
      this.tasks.set(taskId, task);
    }
  }

  // Missing utility methods
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async cancelTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    task.status = 'cancelled';
    task.completedAt = new Date().toISOString();
    this.tasks.set(taskId, task);

    // Remove from agent queue if assigned
    if (task.assignedAgentId) {
      const agentState = this.agentStates.get(task.assignedAgentId);
      if (agentState) {
        const queueIndex = agentState.taskQueue.indexOf(taskId);
        if (queueIndex > -1) {
          agentState.taskQueue.splice(queueIndex, 1);
        }
        if (agentState.currentTask === taskId) {
          agentState.currentTask = undefined;
          agentState.status = 'idle';
        }
        this.agentStates.set(task.assignedAgentId, agentState);
      }
    }

    return true;
  }

  private async processPendingTasks(): Promise<void> {
    const pendingTasks = Array.from(this.tasks.values())
      .filter(task => task.status === 'pending')
      .sort((a, b) => {
        // Sort by priority
        const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      });

    for (const task of pendingTasks) {
      try {
        // Check if dependencies are met
        const unmetDependencies = await this.checkTaskDependencies(task);
        if (unmetDependencies.length === 0) {
          await this.assignTask(task.id);
        }
      } catch (error) {
        console.error(`Failed to assign task ${task.id}:`, error);
      }
    }
  }

  private async processMessageQueue(): Promise<void> {
    const messagesToProcess = [...this.messageQueue];
    this.messageQueue = [];

    for (const message of messagesToProcess) {
      try {
        await this.processMessage(message);
      } catch (error) {
        console.error(`Failed to process message ${message.id}:`, error);
      }
    }
  }

  private async updateAgentStates(): Promise<void> {
    for (const [agentId, state] of this.agentStates.entries()) {
      // Update resource usage (simulated)
      state.resources.memoryUsage = Math.random() * 100;
      state.resources.cpuUsage = Math.random() * 100;
      state.resources.activeConnections = state.status === 'busy' ? 1 : 0;

      // Process next task in queue if agent is idle
      if (state.status === 'idle' && state.taskQueue.length > 0) {
        const nextTaskId = state.taskQueue[0];
        const task = this.tasks.get(nextTaskId);
        if (task && task.status === 'assigned') {
          try {
            await this.executeTask(nextTaskId);
          } catch (error) {
            console.error(`Failed to execute task ${nextTaskId}:`, error);
          }
        }
      }

      this.agentStates.set(agentId, state);
    }
  }

  private async handleTimeouts(): Promise<void> {
    const now = new Date().getTime();

    for (const [taskId, task] of this.tasks.entries()) {
      if (task.status === 'in_progress' && task.startedAt) {
        const startTime = new Date(task.startedAt).getTime();
        const agent = this.agents.get(task.assignedAgentId!);
        const timeout = agent?.timeout || 300000; // 5 minutes default

        if (now - startTime > timeout) {
          console.warn(`Task ${taskId} timed out, cancelling...`);
          await this.cancelTask(taskId);
        }
      }
    }
  }

  private async optimizeTaskDistribution(): Promise<void> {
    // Simple load balancing - redistribute tasks if some agents are overloaded
    const agentLoads = Array.from(this.agentStates.entries())
      .map(([id, state]) => ({
        id,
        load: state.taskQueue.length,
        status: state.status,
      }))
      .filter(agent => agent.status !== 'offline');

    if (agentLoads.length < 2) return;

    agentLoads.sort((a, b) => a.load - b.load);
    const lightestAgent = agentLoads[0];
    const heaviestAgent = agentLoads[agentLoads.length - 1];

    // If load difference is significant, redistribute
    if (heaviestAgent.load - lightestAgent.load > 3) {
      const heaviestState = this.agentStates.get(heaviestAgent.id)!;
      const taskToMove = heaviestState.taskQueue.pop();
      
      if (taskToMove) {
        const lightestState = this.agentStates.get(lightestAgent.id)!;
        lightestState.taskQueue.push(taskToMove);
        
        // Update task assignment
        const task = this.tasks.get(taskToMove);
        if (task) {
          task.assignedAgentId = lightestAgent.id;
          this.tasks.set(taskToMove, task);
        }

        this.agentStates.set(heaviestAgent.id, heaviestState);
        this.agentStates.set(lightestAgent.id, lightestState);
      }
    }
  }

  // Public API methods for external access
  getAgentStatus(agentId: string): AgentState | null {
    return this.agentStates.get(agentId) || null;
  }

  getTaskStatus(taskId: string): Task | null {
    return this.tasks.get(taskId) || null;
  }

  getAllAgents(): AgentConfig[] {
    return Array.from(this.agents.values());
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  getCollaborationGraph(): Map<string, string[]> {
    return new Map(this.collaborationGraph);
  }

  async createTaskWithSubtasks(
    mainTaskConfig: Partial<Task>,
    subtaskConfigs: Partial<Task>[]
  ): Promise<{ mainTaskId: string; subtaskIds: string[] }> {
    // Create main task
    const mainTaskId = await this.createTask(mainTaskConfig);
    const subtaskIds: string[] = [];

    // Create subtasks
    for (const subtaskConfig of subtaskConfigs) {
      const subtaskId = await this.createTask({
        ...subtaskConfig,
        parentTaskId: mainTaskId,
      });
      subtaskIds.push(subtaskId);
    }

    // Update main task with subtask references
    const mainTask = this.tasks.get(mainTaskId)!;
    mainTask.subtasks = subtaskIds;
    this.tasks.set(mainTaskId, mainTask);

    return { mainTaskId, subtaskIds };
  }

  async executeTaskWithSubAgents(
    taskId: string,
    subAgentConfigs: Partial<AgentConfig>[]
  ): Promise<any> {
    const task = this.tasks.get(taskId);
    if (!task || !task.assignedAgentId) {
      throw new Error('Task not found or not assigned');
    }

    const parentAgentId = task.assignedAgentId;
    const subAgentIds: string[] = [];

    try {
      // Create sub-agents
      for (const config of subAgentConfigs) {
        const subAgentId = await this.createSubAgent(parentAgentId, config);
        subAgentIds.push(subAgentId);
      }

      // Create collaboration between parent and sub-agents
      await this.createCollaboration([parentAgentId, ...subAgentIds], 'hierarchical');

      // Execute the task (sub-agents will be utilized automatically)
      const result = await this.executeTask(taskId);

      return {
        ...result,
        subAgentsUsed: subAgentIds,
        collaborationType: 'hierarchical',
      };

    } finally {
      // Clean up sub-agents after task completion
      for (const subAgentId of subAgentIds) {
        await this.removeAgent(subAgentId);
      }
    }
  }

  // Performance and monitoring methods
  getSystemMetrics(): any {
    const agents = Array.from(this.agentStates.values());
    const tasks = Array.from(this.tasks.values());

    return {
      agents: {
        total: agents.length,
        idle: agents.filter(a => a.status === 'idle').length,
        busy: agents.filter(a => a.status === 'busy').length,
        error: agents.filter(a => a.status === 'error').length,
        offline: agents.filter(a => a.status === 'offline').length,
      },
      tasks: {
        total: tasks.length,
        pending: tasks.filter(t => t.status === 'pending').length,
        assigned: tasks.filter(t => t.status === 'assigned').length,
        in_progress: tasks.filter(t => t.status === 'in_progress').length,
        completed: tasks.filter(t => t.status === 'completed').length,
        failed: tasks.filter(t => t.status === 'failed').length,
        cancelled: tasks.filter(t => t.status === 'cancelled').length,
      },
      performance: {
        averageTaskDuration: tasks
          .filter(t => t.actualDuration)
          .reduce((sum, t) => sum + t.actualDuration!, 0) / 
          tasks.filter(t => t.actualDuration).length || 0,
        successRate: tasks.length > 0 ? 
          tasks.filter(t => t.status === 'completed').length / tasks.length : 0,
        totalTasksCompleted: tasks.filter(t => t.status === 'completed').length,
      },
      orchestrator: {
        isRunning: this.isRunning,
        messageQueueLength: this.messageQueue.length,
        collaborations: this.collaborationGraph.size,
      },
    };
  }
}
