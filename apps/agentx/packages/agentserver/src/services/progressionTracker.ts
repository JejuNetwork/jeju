import { IAgentRuntime, logger, EventType } from '@elizaos/core';
import { CapabilityProgressionService } from './capabilityProgressionService';

export class ProgressionTracker {
  private runtime: IAgentRuntime;
  private progressionService: CapabilityProgressionService;

  constructor(runtime: IAgentRuntime, progressionService: CapabilityProgressionService) {
    this.runtime = runtime;
    this.progressionService = progressionService;
    this.setupEventListeners();
  }

  public stop(): void {
    // Event listeners are automatically cleaned up with the runtime
    // No manual cleanup needed for event-based approach
  }

  private setupEventListeners(): void {
    logger.info('[PROGRESSION_TRACKER] Setting up event-based progression tracking');

    // Skip setup in unlocked mode
    if (this.progressionService.isUnlockedModeEnabled()) {
      logger.info('[PROGRESSION_TRACKER] Skipping event listeners - unlocked mode enabled');
      return;
    }

    // Register event listeners for progression tracking
    this.runtime.registerEvent(EventType.SHELL_COMMAND_EXECUTED, async (params) => {
      await this.handleShellCommandExecuted(params);
    });

    this.runtime.registerEvent(EventType.AGENT_NAMED, async (params) => {
      await this.handleAgentNamed(params);
    });

    this.runtime.registerEvent(EventType.GOAL_CREATED, async (params) => {
      await this.handleGoalCreated(params);
    });

    this.runtime.registerEvent(EventType.TODO_CREATED, async (params) => {
      await this.handleTodoCreated(params);
    });

    this.runtime.registerEvent(EventType.BROWSER_ACTION_PERFORMED, async (params) => {
      await this.handleBrowserActionPerformed(params);
    });

    this.runtime.registerEvent(EventType.FORM_SUBMITTED, async (params) => {
      await this.handleFormSubmitted(params);
    });

    this.runtime.registerEvent(EventType.VISION_ACTION_PERFORMED, async (params) => {
      await this.handleVisionActionPerformed(params);
    });

    this.runtime.registerEvent(EventType.MICROPHONE_USED, async (params) => {
      await this.handleMicrophoneUsed(params);
    });

    this.runtime.registerEvent(EventType.CAPABILITY_USED, async (params) => {
      await this.handleCapabilityUsed(params);
    });

    logger.info('[PROGRESSION_TRACKER] Event listeners registered');
  }

  // Event handlers for progression tracking
  private async handleShellCommandExecuted(params: {
    command: string;
    exitCode: number;
    output?: string;
  }): Promise<void> {
    if (this.progressionService.isUnlockedModeEnabled()) {
      return;
    }

    if (params.exitCode === 0) {
      logger.info(
        '[PROGRESSION_TRACKER] Shell command executed successfully, recording capability usage'
      );
      await this.progressionService.recordCapabilityUsed('shell');
    }
  }

  private async handleAgentNamed(_params: { name: string }): Promise<void> {
    if (this.progressionService.isUnlockedModeEnabled()) {
      return;
    }

    logger.info(`[PROGRESSION_TRACKER] Agent named: ${_params.name}`);
    this.progressionService.recordAgentNamed(_params.name);
  }

  private async handleGoalCreated(_params: { goalData: Record<string, unknown> }): Promise<void> {
    if (this.progressionService.isUnlockedModeEnabled()) {
      return;
    }

    logger.info('[PROGRESSION_TRACKER] Goal created, recording capability usage');
    await this.progressionService.recordCapabilityUsed('goals');
  }

  private async handleTodoCreated(_params: { todoData: Record<string, unknown> }): Promise<void> {
    if (this.progressionService.isUnlockedModeEnabled()) {
      return;
    }

    logger.info('[PROGRESSION_TRACKER] Todo created, recording capability usage');
    await this.progressionService.recordCapabilityUsed('todo');
  }

  private async handleBrowserActionPerformed(params: {
    action: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    if (this.progressionService.isUnlockedModeEnabled()) {
      return;
    }

    logger.info(`[PROGRESSION_TRACKER] Browser action performed: ${params.action}`);
    await this.progressionService.recordCapabilityUsed('browser');
  }

  private async handleFormSubmitted(params: { details?: Record<string, unknown> }): Promise<void> {
    if (this.progressionService.isUnlockedModeEnabled()) {
      return;
    }

    logger.info('[PROGRESSION_TRACKER] Form submitted');
    await this.progressionService.recordFormSubmitted(params.details);
  }

  private async handleVisionActionPerformed(params: {
    action: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    if (this.progressionService.isUnlockedModeEnabled()) {
      return;
    }

    logger.info(`[PROGRESSION_TRACKER] Vision action performed: ${params.action}`);
    await this.progressionService.recordCapabilityUsed('vision');
  }

  private async handleMicrophoneUsed(_params: {
    details?: Record<string, unknown>;
  }): Promise<void> {
    if (this.progressionService.isUnlockedModeEnabled()) {
      return;
    }

    logger.info('[PROGRESSION_TRACKER] Microphone used');
    await this.progressionService.recordCapabilityUsed('microphone');
  }

  private async handleCapabilityUsed(params: {
    capability: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    if (this.progressionService.isUnlockedModeEnabled()) {
      return;
    }

    logger.info(`[PROGRESSION_TRACKER] Capability used: ${params.capability}`);
    await this.progressionService.recordCapabilityUsed(params.capability);
  }

  // Method to track shell command execution - called from API endpoints
  public async trackShellCommand(command: string, exitCode: number): Promise<void> {
    // Emit event instead of direct tracking
    await this.runtime.emitEvent(EventType.SHELL_COMMAND_EXECUTED, {
      command,
      exitCode,
    });
  }

  // Method to track goal creation - called from API endpoints
  public async trackGoalCreation(goalData: Record<string, unknown>): Promise<void> {
    // Emit event instead of direct tracking
    await this.runtime.emitEvent(EventType.GOAL_CREATED, {
      goalData,
    });
  }

  // Method to track todo creation - called from API endpoints
  public async trackTodoCreation(todoData: Record<string, unknown>): Promise<void> {
    // Emit event instead of direct tracking
    await this.runtime.emitEvent(EventType.TODO_CREATED, {
      todoData,
    });
  }

  // Method to track agent naming - should be called when agent name changes
  public async trackAgentNaming(name: string): Promise<void> {
    // Emit event instead of direct tracking
    await this.runtime.emitEvent(EventType.AGENT_NAMED, {
      name,
    });
  }

  // Method to manually track specific actions
  public async trackAction(actionType: string, details?: Record<string, unknown>): Promise<void> {
    logger.info(`[PROGRESSION_TRACKER] Manual action tracked: ${actionType}`, details);

    // Emit appropriate events based on action type
    switch (actionType) {
      case 'form_submitted':
        await this.runtime.emitEvent(EventType.FORM_SUBMITTED, { details });
        break;
      case 'browser_used':
        await this.runtime.emitEvent(EventType.BROWSER_ACTION_PERFORMED, {
          action: actionType,
          details,
        });
        break;
      case 'vision_used':
        await this.runtime.emitEvent(EventType.VISION_ACTION_PERFORMED, {
          action: actionType,
          details,
        });
        break;
      case 'microphone_used':
        await this.runtime.emitEvent(EventType.MICROPHONE_USED, { details });
        break;
      default:
        // For generic capability usage
        await this.runtime.emitEvent(EventType.CAPABILITY_USED, {
          capability: actionType,
          details,
        });
        break;
    }
  }

  // Method to check and display current progression status
  public getProgressionStatus(): Record<string, unknown> {
    const state = this.progressionService.getProgressionState();
    const unlockedCapabilities = this.progressionService.getUnlockedCapabilities();
    const availableLevels = this.progressionService.getAvailableLevels();
    const isUnlockedMode = this.progressionService.isUnlockedModeEnabled();

    return {
      mode: isUnlockedMode ? 'unlocked' : 'progression',
      isUnlockedMode,
      currentLevel: state.currentLevel,
      unlockedLevels: state.unlockedLevels,
      completedActions: state.completedActions,
      agentNamed: state.agentNamed,
      unlockedCapabilities,
      availableLevels: availableLevels.map((level) => ({
        id: level.id,
        name: level.name,
        description: level.description,
        isUnlocked: level.isUnlocked,
        capabilities: level.unlockedCapabilities,
      })),
    };
  }

  // Cleanup method to stop intervals
  public cleanup(): void {
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }
    if (this.namingInterval) {
      clearInterval(this.namingInterval);
      this.namingInterval = null;
    }
    logger.info('[PROGRESSION_TRACKER] Cleaned up tracking intervals');
  }
}
