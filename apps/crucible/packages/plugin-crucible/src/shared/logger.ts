/**
 * Logging and Observability Service
 * Writes structured logs to database with performance metrics
 */

import { Plugin, Service, type IAgentRuntime } from '@elizaos/core';

export interface ActionMetric {
  actionName: string;
  agentId: string;
  agentType: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  gasUsed?: string;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * Logger Service
 * Enhanced logging with metrics tracking
 */
export class LoggerService extends Service {
  public static serviceType = 'logger_service';
  
  private metrics: Map<string, ActionMetric[]> = new Map();
  private activeActions: Map<string, number> = new Map();
  
  async start(runtime: IAgentRuntime): Promise<LoggerService> {
    runtime.logger.info('Logger service started');
    return this;
  }
  
  /**
   * Start tracking an action
   */
  startAction(actionName: string, agentType: string): string {
    const actionId = `${actionName}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.activeActions.set(actionId, Date.now());
    
    this.runtime.logger.debug(`Action started: ${actionName}`, {actionId});
    
    return actionId;
  }
  
  /**
   * End tracking an action and record metrics
   */
  async endAction(
    actionId: string,
    actionName: string,
    agentType: string,
    success: boolean,
    gasUsed?: string,
    error?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    const startTime = this.activeActions.get(actionId);
    
    if (!startTime) {
      this.runtime.logger.warn('Action end called without start', {actionId});
      return;
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    const metric: ActionMetric = {
      actionName,
      agentId: this.runtime.agentId.toString(),
      agentType,
      startTime,
      endTime,
      duration,
      success,
      gasUsed,
      error,
      metadata
    };
    
    // Store metric
    const actionMetrics = this.metrics.get(actionName) || [];
    actionMetrics.push(metric);
    this.metrics.set(actionName, actionMetrics);
    
    // Clean up active tracking
    this.activeActions.delete(actionId);
    
    // Log to runtime
    await this.runtime.log({
      body: {
        type: 'ACTION_METRIC',
        actionName,
        duration,
        success,
        gasUsed,
        error
      },
      entityId: this.runtime.agentId,
      roomId: 'metrics',
      type: 'metrics'
    });
    
    this.runtime.logger.debug(`Action completed: ${actionName}`, {
      duration: `${duration}ms`,
      success,
      gasUsed
    });
  }
  
  /**
   * Get metrics for an action
   */
  getActionMetrics(actionName: string): ActionMetric[] {
    return this.metrics.get(actionName) || [];
  }
  
  /**
   * Get all metrics
   */
  getAllMetrics(): Record<string, ActionMetric[]> {
    return Object.fromEntries(this.metrics.entries());
  }
  
  /**
   * Get aggregate statistics
   */
  getStatistics(): {
    totalActions: number;
    successRate: number;
    averageDuration: number;
    byAction: Record<string, {
      count: number;
      successRate: number;
      avgDuration: number;
      totalGasUsed: bigint;
    }>;
  } {
    let totalActions = 0;
    let totalSuccesses = 0;
    let totalDuration = 0;
    
    const byAction: Record<string, any> = {};
    
    for (const [actionName, metrics] of this.metrics.entries()) {
      const count = metrics.length;
      const successes = metrics.filter(m => m.success).length;
      const avgDuration = metrics.reduce((sum, m) => sum + m.duration, 0) / count;
      const totalGas = metrics.reduce((sum, m) => 
        sum + (m.gasUsed ? BigInt(m.gasUsed) : BigInt(0)), BigInt(0)
      );
      
      byAction[actionName] = {
        count,
        successRate: (successes / count) * 100,
        avgDuration: Math.round(avgDuration),
        totalGasUsed: totalGas
      };
      
      totalActions += count;
      totalSuccesses += successes;
      totalDuration += avgDuration * count;
    }
    
    return {
      totalActions,
      successRate: totalActions > 0 ? (totalSuccesses / totalActions) * 100 : 0,
      averageDuration: totalActions > 0 ? Math.round(totalDuration / totalActions) : 0,
      byAction
    };
  }
  
  /**
   * Clear old metrics (keep last 1000)
   */
  pruneMetrics(): void {
    for (const [actionName, metrics] of this.metrics.entries()) {
      if (metrics.length > 1000) {
        // Keep last 1000
        this.metrics.set(actionName, metrics.slice(-1000));
      }
    }
  }
  
  async stop(): Promise<void> {
    this.metrics.clear();
    this.activeActions.clear();
    this.runtime.logger.info('Logger service stopped');
  }
  
  public get capabilityDescription(): string {
    return 'Enhanced logging with performance metrics and database persistence';
  }
}

export const loggerPlugin: Plugin = {
  name: '@crucible/plugin-logger',
  description: 'Comprehensive logging and observability with metrics tracking',
  services: [LoggerService]
};

