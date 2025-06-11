import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

export interface ResourceMetrics {
  totalRAM: number;
  usedRAM: number;
  freeRAM: number;
  ramUtilization: number;
  totalVRAM: number;
  usedVRAM: number;
  freeVRAM: number;
  vramUtilization: number;
  cpuUsage: number;
  timestamp: string;
}

export interface TaskCheckpoint {
  taskId: string;
  agentId: string;
  status: string;
  progress: number;
  context: any;
  intermediateResults: any[];
  dependencies: string[];
  startTime: string;
  lastUpdate: string;
  modelState: any;
  memorySnapshot: any;
}

export interface SystemState {
  activeAgents: any[];
  runningTasks: any[];
  resourceMetrics: ResourceMetrics;
  modelLoadStates: Record<string, any>;
  collaborations: any[];
  timestamp: string;
}

export class ResourceManager {
  private workingDirectory: string;
  private checkpointDirectory: string;
  private emergencyDumpDirectory: string;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private resourceThresholds = {
    ramCritical: 95,      // 95% RAM usage triggers emergency
    ramWarning: 85,       // 85% RAM usage triggers task pausing
    vramCritical: 95,     // 95% VRAM usage triggers model unloading
    vramWarning: 90,      // 90% VRAM usage triggers task queuing
  };
  private isMonitoring = false;
  private emergencyCallbacks: Array<() => Promise<void>> = [];
  private pauseCallbacks: Array<() => Promise<void>> = [];
  private resumeCallbacks: Array<() => Promise<void>> = [];

  constructor(workingDirectory: string) {
    this.workingDirectory = workingDirectory;
    this.checkpointDirectory = path.join(workingDirectory, '.checkpoints');
    this.emergencyDumpDirectory = path.join(workingDirectory, '.emergency-dumps');
    
    this.initializeDirectories();
    this.setupCrashHandlers();
  }

  private async initializeDirectories() {
    await fs.ensureDir(this.checkpointDirectory);
    await fs.ensureDir(this.emergencyDumpDirectory);
  }

  private setupCrashHandlers() {
    // Handle various crash scenarios
    process.on('uncaughtException', async (error) => {
      console.error('Uncaught Exception detected:', error);
      await this.emergencyDump('uncaught-exception', { error: error.message, stack: error.stack });
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason, promise) => {
      console.error('Unhandled Rejection detected:', reason);
      await this.emergencyDump('unhandled-rejection', { reason, promise });
    });

    process.on('SIGTERM', async () => {
      console.log('SIGTERM received, performing graceful shutdown...');
      await this.emergencyDump('sigterm-shutdown');
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      console.log('SIGINT received, performing graceful shutdown...');
      await this.emergencyDump('sigint-shutdown');
      process.exit(0);
    });

    // Monitor for memory pressure
    process.on('warning', async (warning) => {
      if (warning.name === 'MaxListenersExceededWarning' || 
          warning.message.includes('memory')) {
        console.warn('Memory warning detected:', warning);
        await this.checkResourcePressure();
      }
    });
  }

  public startMonitoring(intervalMs: number = 5000) {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.monitoringInterval = setInterval(async () => {
      await this.checkResourcePressure();
    }, intervalMs);
    
    console.log(`Resource monitoring started (interval: ${intervalMs}ms)`);
  }

  public stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.isMonitoring = false;
    console.log('Resource monitoring stopped');
  }

  public async getResourceMetrics(): Promise<ResourceMetrics> {
    const totalRAM = os.totalmem();
    const freeRAM = os.freemem();
    const usedRAM = totalRAM - freeRAM;
    const ramUtilization = (usedRAM / totalRAM) * 100;

    // Estimate VRAM usage (would need GPU monitoring library for real data)
    const estimatedTotalVRAM = 28 * 1024 * 1024 * 1024; // 28GB in bytes
    const estimatedUsedVRAM = this.estimateVRAMUsage();
    const vramUtilization = (estimatedUsedVRAM / estimatedTotalVRAM) * 100;

    // Get CPU usage
    const cpuUsage = await this.getCPUUsage();

    return {
      totalRAM,
      usedRAM,
      freeRAM,
      ramUtilization,
      totalVRAM: estimatedTotalVRAM,
      usedVRAM: estimatedUsedVRAM,
      freeVRAM: estimatedTotalVRAM - estimatedUsedVRAM,
      vramUtilization,
      cpuUsage,
      timestamp: new Date().toISOString(),
    };
  }

  private estimateVRAMUsage(): number {
    // This would be replaced with actual GPU monitoring
    // For now, estimate based on loaded models
    const modelVRAMUsage = {
      'deepseek-coder-33b': 20 * 1024 * 1024 * 1024, // 20GB
      'deepseek-coder-6.7b': 4 * 1024 * 1024 * 1024,  // 4GB
      'codestral-6.7b': 4 * 1024 * 1024 * 1024,       // 4GB
      'qwen2.5-coder-7b': 4 * 1024 * 1024 * 1024,     // 4GB
      'deepseek-coder-1.3b': 1 * 1024 * 1024 * 1024,  // 1GB
    };

    // Would track which models are actually loaded
    // For now, assume some are loaded
    return 24 * 1024 * 1024 * 1024; // 24GB estimated usage
  }

  private async getCPUUsage(): Promise<number> {
    return new Promise((resolve) => {
      const startUsage = process.cpuUsage();
      setTimeout(() => {
        const endUsage = process.cpuUsage(startUsage);
        const totalUsage = endUsage.user + endUsage.system;
        const percentage = (totalUsage / 1000000) / 10; // Convert to percentage
        resolve(Math.min(percentage, 100));
      }, 100);
    });
  }

  private async checkResourcePressure() {
    const metrics = await this.getResourceMetrics();
    
    // Critical RAM usage - trigger emergency procedures
    if (metrics.ramUtilization >= this.resourceThresholds.ramCritical) {
      console.error(`CRITICAL: RAM usage at ${metrics.ramUtilization.toFixed(1)}%`);
      await this.handleCriticalRAMUsage(metrics);
    }
    // Warning RAM usage - pause new tasks
    else if (metrics.ramUtilization >= this.resourceThresholds.ramWarning) {
      console.warn(`WARNING: RAM usage at ${metrics.ramUtilization.toFixed(1)}%`);
      await this.handleWarningRAMUsage(metrics);
    }

    // Critical VRAM usage - unload models
    if (metrics.vramUtilization >= this.resourceThresholds.vramCritical) {
      console.error(`CRITICAL: VRAM usage at ${metrics.vramUtilization.toFixed(1)}%`);
      await this.handleCriticalVRAMUsage(metrics);
    }
    // Warning VRAM usage - queue tasks
    else if (metrics.vramUtilization >= this.resourceThresholds.vramWarning) {
      console.warn(`WARNING: VRAM usage at ${metrics.vramUtilization.toFixed(1)}%`);
      await this.handleWarningVRAMUsage(metrics);
    }
  }

  private async handleCriticalRAMUsage(metrics: ResourceMetrics) {
    // Emergency dump everything
    await this.emergencyDump('critical-ram-usage', { metrics });
    
    // Execute emergency callbacks
    for (const callback of this.emergencyCallbacks) {
      try {
        await callback();
      } catch (error) {
        console.error('Emergency callback failed:', error);
      }
    }
  }

  private async handleWarningRAMUsage(metrics: ResourceMetrics) {
    // Pause non-critical tasks
    for (const callback of this.pauseCallbacks) {
      try {
        await callback();
      } catch (error) {
        console.error('Pause callback failed:', error);
      }
    }
  }

  private async handleCriticalVRAMUsage(metrics: ResourceMetrics) {
    // Unload non-essential models
    console.log('Unloading non-essential models to free VRAM...');
    // This would integrate with Ollama to unload models
  }

  private async handleWarningVRAMUsage(metrics: ResourceMetrics) {
    // Queue new tasks instead of starting them immediately
    console.log('Queueing new tasks due to high VRAM usage...');
  }

  public async saveTaskCheckpoint(taskCheckpoint: TaskCheckpoint): Promise<string> {
    const checkpointId = `checkpoint_${taskCheckpoint.taskId}_${Date.now()}`;
    const checkpointPath = path.join(this.checkpointDirectory, `${checkpointId}.json`);
    
    const checkpointData = {
      ...taskCheckpoint,
      checkpointId,
      savedAt: new Date().toISOString(),
      version: '1.0',
    };
    
    await fs.writeJson(checkpointPath, checkpointData, { spaces: 2 });
    
    // Also save a quick recovery file
    const quickRecoveryPath = path.join(this.checkpointDirectory, `quick_${taskCheckpoint.taskId}.json`);
    await fs.writeJson(quickRecoveryPath, {
      taskId: taskCheckpoint.taskId,
      checkpointId,
      checkpointPath,
      lastUpdate: checkpointData.savedAt,
    });
    
    console.log(`Task checkpoint saved: ${checkpointId}`);
    return checkpointId;
  }

  public async loadTaskCheckpoint(taskId: string): Promise<TaskCheckpoint | null> {
    try {
      const quickRecoveryPath = path.join(this.checkpointDirectory, `quick_${taskId}.json`);
      
      if (await fs.pathExists(quickRecoveryPath)) {
        const quickRecovery = await fs.readJson(quickRecoveryPath);
        const checkpointData = await fs.readJson(quickRecovery.checkpointPath);
        
        console.log(`Task checkpoint loaded: ${quickRecovery.checkpointId}`);
        return checkpointData;
      }
      
      return null;
    } catch (error) {
      console.error(`Failed to load checkpoint for task ${taskId}:`, error);
      return null;
    }
  }

  public async emergencyDump(reason: string, additionalData?: any): Promise<string> {
    const dumpId = `emergency_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const dumpPath = path.join(this.emergencyDumpDirectory, `${dumpId}.json`);
    
    try {
      const systemState: SystemState = {
        activeAgents: [], // Would be populated by orchestrator
        runningTasks: [], // Would be populated by orchestrator
        resourceMetrics: await this.getResourceMetrics(),
        modelLoadStates: {}, // Would track loaded models
        collaborations: [], // Would be populated by orchestrator
        timestamp: new Date().toISOString(),
      };
      
      const emergencyData = {
        dumpId,
        reason,
        systemState,
        additionalData,
        processInfo: {
          pid: process.pid,
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
          versions: process.versions,
        },
        environment: {
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          cwd: process.cwd(),
        },
        timestamp: new Date().toISOString(),
      };
      
      await fs.writeJson(dumpPath, emergencyData, { spaces: 2 });
      
      // Also create a latest dump symlink/copy
      const latestDumpPath = path.join(this.emergencyDumpDirectory, 'latest_emergency_dump.json');
      await fs.copy(dumpPath, latestDumpPath);
      
      console.log(`Emergency dump completed: ${dumpId}`);
      console.log(`Dump saved to: ${dumpPath}`);
      
      return dumpId;
    } catch (error) {
      console.error('Failed to create emergency dump:', error);
      // Try to at least save basic info to a text file
      const basicDumpPath = path.join(this.emergencyDumpDirectory, `basic_${dumpId}.txt`);
      const basicInfo = `Emergency Dump: ${dumpId}\nReason: ${reason}\nTimestamp: ${new Date().toISOString()}\nError: ${error}\n`;
      await fs.writeFile(basicDumpPath, basicInfo);
      return dumpId;
    }
  }

  public async recoverFromDump(dumpId?: string): Promise<SystemState | null> {
    try {
      let dumpPath: string;
      
      if (dumpId) {
        dumpPath = path.join(this.emergencyDumpDirectory, `${dumpId}.json`);
      } else {
        dumpPath = path.join(this.emergencyDumpDirectory, 'latest_emergency_dump.json');
      }
      
      if (await fs.pathExists(dumpPath)) {
        const dumpData = await fs.readJson(dumpPath);
        console.log(`Recovered from emergency dump: ${dumpData.dumpId}`);
        return dumpData.systemState;
      }
      
      return null;
    } catch (error) {
      console.error('Failed to recover from dump:', error);
      return null;
    }
  }

  public async listCheckpoints(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.checkpointDirectory);
      return files
        .filter(file => file.startsWith('checkpoint_') && file.endsWith('.json'))
        .map(file => file.replace('.json', ''));
    } catch (error) {
      console.error('Failed to list checkpoints:', error);
      return [];
    }
  }

  public async listEmergencyDumps(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.emergencyDumpDirectory);
      return files
        .filter(file => file.startsWith('emergency_') && file.endsWith('.json'))
        .map(file => file.replace('.json', ''));
    } catch (error) {
      console.error('Failed to list emergency dumps:', error);
      return [];
    }
  }

  public async cleanupOldCheckpoints(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    try {
      const files = await fs.readdir(this.checkpointDirectory);
      const now = Date.now();
      let cleaned = 0;
      
      for (const file of files) {
        const filePath = path.join(this.checkpointDirectory, file);
        const stats = await fs.stat(filePath);
        
        if (now - stats.mtime.getTime() > maxAge) {
          await fs.remove(filePath);
          cleaned++;
        }
      }
      
      console.log(`Cleaned up ${cleaned} old checkpoint files`);
      return cleaned;
    } catch (error) {
      console.error('Failed to cleanup old checkpoints:', error);
      return 0;
    }
  }

  // Callback registration methods
  public onEmergency(callback: () => Promise<void>) {
    this.emergencyCallbacks.push(callback);
  }

  public onPause(callback: () => Promise<void>) {
    this.pauseCallbacks.push(callback);
  }

  public onResume(callback: () => Promise<void>) {
    this.resumeCallbacks.push(callback);
  }

  // Resource threshold configuration
  public setThresholds(thresholds: Partial<typeof this.resourceThresholds>) {
    this.resourceThresholds = { ...this.resourceThresholds, ...thresholds };
    console.log('Resource thresholds updated:', this.resourceThresholds);
  }

  public getThresholds() {
    return { ...this.resourceThresholds };
  }
}
