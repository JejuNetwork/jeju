import { Service, elizaLogger, type IAgentRuntime, type ServiceTypeName } from '@elizaos/core';
import { EventEmitter } from 'events';

import { v4 as uuidv4 } from 'uuid';
import type { ProjectHistory, ProjectStatusUpdate, ProjectType } from '../types';

// Types are now imported from ../types

/**
 * Typed EventEmitter for project status events
 */
interface ProjectStatusEvents {
  update: (data: ProjectStatusUpdate) => void;
  complete: (data: ProjectStatusUpdate) => void;
  error: (data: ProjectStatusUpdate) => void;
}

/**
 * Extended EventEmitter with typed events
 */
class TypedEventEmitter extends EventEmitter {
  on<U extends keyof ProjectStatusEvents>(event: U, listener: ProjectStatusEvents[U]): this {
    return super.on(event as string, listener);
  }

  emit<U extends keyof ProjectStatusEvents>(
    event: U,
    ...args: Parameters<ProjectStatusEvents[U]>
  ): boolean {
    return super.emit(event as string, ...args);
  }

  off<U extends keyof ProjectStatusEvents>(event: U, listener: ProjectStatusEvents[U]): this {
    return super.off(event as string, listener);
  }
}

/**
 * Service to manage and broadcast project status updates
 */
export class ProjectStatusManager extends Service {
  static serviceName: string = 'project-status-manager';
  static serviceType: ServiceTypeName = 'project-status' as ServiceTypeName;

  get capabilityDescription(): string {
    return 'Manages project status updates and real-time notifications for code generation projects';
  }

  private projects: Map<string, ProjectStatusUpdate> = new Map();
  private history: ProjectHistory[] = [];
  private eventEmitter: TypedEventEmitter = new TypedEventEmitter();

  /**
   * Static factory method required by Service base class
   */
  static async start(runtime: IAgentRuntime): Promise<Service> {
    elizaLogger.info('Starting ProjectStatusManager (static)');
    const service = new ProjectStatusManager(runtime);
    await service.start();
    return service;
  }

  constructor(protected runtime: IAgentRuntime) {
    super();
  }

  async start(): Promise<void> {
    elizaLogger.info('Starting ProjectStatusManager');

    // Listen for runtime events if available
    if (typeof this.runtime.emitEvent === 'function') {
      // We'll emit our own events
    }
  }

  async stop(): Promise<void> {
    elizaLogger.info('Stopping ProjectStatusManager');
    this.projects.clear();
    this.eventEmitter.removeAllListeners();
  }

  /**
   * Create a new project and start tracking it
   */
  createProject(name: string, type: ProjectType): string {
    const projectId = uuidv4();
    const project: ProjectStatusUpdate = {
      projectId,
      projectName: name,
      type,
      status: 'planning',
      startedAt: Date.now(),
      progress: 0,
      message: 'Project created, starting planning phase...',
    };

    this.projects.set(projectId, project);
    this.broadcastUpdate(project);

    elizaLogger.info(`Created project ${projectId}: ${name}`);
    return projectId;
  }

  /**
   * Update project status
   */
  updateStatus(projectId: string, updates: Partial<ProjectStatusUpdate>): void {
    const project = this.projects.get(projectId);
    if (!project) {
      elizaLogger.warn(`Project ${projectId} not found`);
      return;
    }

    // Merge updates
    Object.assign(project, updates);

    // Calculate progress based on status if not provided
    if (!updates.progress) {
      switch (project.status) {
        case 'planning':
          project.progress = 10;
          break;
        case 'generating':
          project.progress = project.progress || 30;
          break;
        case 'testing':
          project.progress = 70;
          break;
        case 'completed':
          project.progress = 100;
          break;
        case 'failed':
          // Keep current progress
          break;
      }
    }

    // If completed or failed, move to history
    if (project.status === 'completed' || project.status === 'failed') {
      project.completedAt = Date.now();
      this.moveToHistory(project);
    }

    this.broadcastUpdate(project);
    elizaLogger.info(`Updated project ${projectId}: ${project.status} - ${project.message}`);
  }

  /**
   * Update project step (for detailed progress tracking)
   */
  updateStep(projectId: string, step: string, message?: string): void {
    this.updateStatus(projectId, {
      currentStep: step,
      message: message || `Executing: ${step}`,
    });
  }

  /**
   * Update file generation status
   */
  updateFileStatus(
    projectId: string,
    filePath: string,
    status: 'pending' | 'generating' | 'complete' | 'error'
  ): void {
    const project = this.projects.get(projectId);
    if (!project) return;

    if (!project.files) {
      project.files = [];
    }

    const fileIndex = project.files.findIndex((f) => f.path === filePath);
    if (fileIndex >= 0) {
      project.files[fileIndex].status = status;
    } else {
      project.files.push({ path: filePath, status });
    }

    // Update progress based on file completion
    const completed = project.files.filter((f) => f.status === 'complete').length;
    const total = project.files.length;
    if (total > 0 && project.status === 'generating') {
      project.progress = 30 + Math.floor((completed / total) * 40); // 30-70% range
    }

    this.broadcastUpdate(project);
  }

  /**
   * Update validation results
   */
  updateValidation(
    projectId: string,
    type: 'lint' | 'typeCheck' | 'tests' | 'build',
    passed: boolean,
    errors?: string[]
  ): void {
    const project = this.projects.get(projectId);
    if (!project) return;

    if (!project.validationResults) {
      project.validationResults = {
        lint: { passed: true },
        typeCheck: { passed: true },
        tests: { passed: true },
        build: { passed: true },
      };
    }

    project.validationResults[type] = { passed, errors };
    this.broadcastUpdate(project);
  }

  /**
   * Get current project status
   */
  getProject(projectId: string): ProjectStatusUpdate | undefined {
    return this.projects.get(projectId);
  }

  /**
   * Get all active projects
   */
  getActiveProjects(): ProjectStatusUpdate[] {
    return Array.from(this.projects.values());
  }

  /**
   * Get project history
   */
  getHistory(limit: number = 50): ProjectHistory[] {
    return this.history.slice(0, limit);
  }

  /**
   * Subscribe to project updates
   */
  on(event: 'update' | 'complete' | 'error', callback: (data: ProjectStatusUpdate) => void): void {
    this.eventEmitter.on(event, callback);
  }

  /**
   * Unsubscribe from project updates
   */
  off(event: 'update' | 'complete' | 'error', callback: (data: ProjectStatusUpdate) => void): void {
    this.eventEmitter.off(event, callback);
  }

  /**
   * Move project to history
   */
  private moveToHistory(project: ProjectStatusUpdate): void {
    const historyEntry: ProjectHistory = {
      id: project.projectId,
      name: project.projectName,
      type: project.type,
      status: project.status,
      startedAt: project.startedAt!,
      completedAt: project.completedAt,
      duration: project.completedAt ? project.completedAt - project.startedAt! : undefined,
      filesGenerated: project.files?.filter((f) => f.status === 'complete').length,
      error: project.error,
    };

    this.history.unshift(historyEntry);

    // Keep only last 100 entries
    if (this.history.length > 100) {
      this.history = this.history.slice(0, 100);
    }

    // Remove from active projects after a delay
    setTimeout(() => {
      this.projects.delete(project.projectId);
    }, 5000);
  }

  /**
   * Broadcast project update
   */
  private broadcastUpdate(project: ProjectStatusUpdate): void {
    // Emit to local listeners
    this.eventEmitter.emit('update', project);

    if (project.status === 'completed') {
      this.eventEmitter.emit('complete', project);
    } else if (project.status === 'failed') {
      this.eventEmitter.emit('error', project);
    }

    // Emit to runtime if available
    if (typeof this.runtime.emitEvent === 'function') {
      this.runtime.emitEvent('project:update', project);

      if (project.status === 'completed') {
        this.runtime.emitEvent('project:complete', project);
      } else if (project.status === 'failed') {
        this.runtime.emitEvent('project:error', project);
      }
    }

    // If the runtime has WebSocket support, emit through that
    const socketService = this.runtime.getService('socket') as {
      emit?: (event: string, data: any) => void;
    };
    if (socketService && typeof socketService.emit === 'function') {
      socketService.emit('autocoder:project:update', {
        type: 'PROJECT_UPDATE',
        data: project,
      });
    }
  }

  /**
   * Get status summary for all projects
   */
  getStatusSummary(): {
    active: number;
    completed: number;
    failed: number;
    totalGenerated: number;
    averageDuration: number;
  } {
    const active = this.projects.size;
    const completed = this.history.filter((h) => h.status === 'completed').length;
    const failed = this.history.filter((h) => h.status === 'failed').length;
    const totalGenerated = this.history.reduce((sum, h) => sum + (h.filesGenerated || 0), 0);

    const completedProjects = this.history.filter((h) => h.status === 'completed' && h.duration);
    const averageDuration =
      completedProjects.length > 0
        ? completedProjects.reduce((sum, h) => sum + h.duration!, 0) / completedProjects.length
        : 0;

    return {
      active,
      completed,
      failed,
      totalGenerated,
      averageDuration,
    };
  }
}
