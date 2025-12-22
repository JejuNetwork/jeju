/**
 * CI Event Bus - Internal event routing for CI triggers
 */

import type { Address, Hex } from 'viem';
import type { CIEvent, WorkflowTrigger } from './types';
import type { WorkflowEngine } from './workflow-engine';

type EventHandler = (event: CIEvent) => Promise<void>;

export class CIEventBus {
  private workflowEngine: WorkflowEngine;
  private handlers = new Map<CIEvent['type'], Set<EventHandler>>();
  private eventHistory: Array<{ event: CIEvent; timestamp: number }> = [];
  private maxHistorySize = 1000;

  constructor(workflowEngine: WorkflowEngine) {
    this.workflowEngine = workflowEngine;
  }

  on(eventType: CIEvent['type'], handler: EventHandler): () => void {
    let handlers = this.handlers.get(eventType);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(eventType, handlers);
    }
    handlers.add(handler);

    return () => {
      handlers?.delete(handler);
    };
  }

  async emit(event: CIEvent): Promise<void> {
    this.eventHistory.push({ event, timestamp: Date.now() });
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    const handlers = this.handlers.get(event.type);
    if (handlers) {
      await Promise.all(Array.from(handlers).map((h) => h(event).catch(console.error)));
    }

    await this.triggerMatchingWorkflows(event);
  }

  private async triggerMatchingWorkflows(event: CIEvent): Promise<void> {
    const repoId = event.repoId;
    const workflows = await this.workflowEngine.loadRepositoryWorkflows(repoId);

    for (const workflow of workflows) {
      if (!workflow.active) continue;

      const matchingTrigger = this.findMatchingTrigger(workflow.triggers, event);
      if (!matchingTrigger) continue;

      const { branch, commitSha, inputs, prNumber } = this.extractRunParams(event);

      await this.workflowEngine.triggerRun(
        workflow.workflowId,
        event.type as 'push' | 'pull_request' | 'schedule' | 'workflow_dispatch' | 'release',
        this.getActor(event),
        branch,
        commitSha,
        inputs,
        prNumber
      );
    }
  }

  private findMatchingTrigger(triggers: WorkflowTrigger[], event: CIEvent): WorkflowTrigger | null {
    for (const trigger of triggers) {
      if (!this.eventTypeMatchesTrigger(event.type, trigger.type)) continue;

      if (event.type === 'push' && trigger.type === 'push') {
        if (!this.branchMatches(event.branch, trigger.branches, trigger.branchesIgnore)) continue;
        return trigger;
      }

      if (event.type === 'pull_request' && trigger.type === 'pull_request') {
        if (trigger.types && !trigger.types.includes(event.action)) continue;
        if (!this.branchMatches(event.baseBranch, trigger.branches, trigger.branchesIgnore)) continue;
        return trigger;
      }

      if (event.type === 'release' && trigger.type === 'release') {
        if (trigger.types && !trigger.types.includes(event.action)) continue;
        return trigger;
      }

      if (event.type === 'workflow_dispatch' && trigger.type === 'workflow_dispatch') {
        if (event.workflowId !== this.getWorkflowIdFromTrigger(trigger)) continue;
        return trigger;
      }

      if (event.type === 'schedule' && trigger.type === 'schedule') {
        return trigger;
      }
    }

    return null;
  }

  private eventTypeMatchesTrigger(eventType: CIEvent['type'], triggerType: WorkflowTrigger['type']): boolean {
    return eventType === triggerType;
  }

  private branchMatches(branch: string, patterns?: string[], ignorePatterns?: string[]): boolean {
    if (ignorePatterns) {
      for (const pattern of ignorePatterns) {
        if (this.matchPattern(branch, pattern)) return false;
      }
    }

    if (!patterns || patterns.length === 0) return true;

    for (const pattern of patterns) {
      if (this.matchPattern(branch, pattern)) return true;
    }

    return false;
  }

  private matchPattern(value: string, pattern: string): boolean {
    if (pattern === value) return true;
    if (pattern === '*') return true;
    if (pattern === '**') return true;

    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
      return regex.test(value);
    }

    return false;
  }

  private getWorkflowIdFromTrigger(_trigger: WorkflowTrigger): Hex {
    return '0x0' as Hex;
  }

  private extractRunParams(event: CIEvent): {
    branch: string;
    commitSha: string;
    inputs: Record<string, string>;
    prNumber?: number;
  } {
    switch (event.type) {
      case 'push':
        return { branch: event.branch, commitSha: event.commitSha, inputs: {} };
      case 'pull_request':
        return { branch: event.baseBranch, commitSha: event.headSha, inputs: {}, prNumber: event.prNumber };
      case 'release':
        return { branch: 'main', commitSha: event.tagName, inputs: {} };
      case 'workflow_dispatch':
        return { branch: event.branch, commitSha: '', inputs: event.inputs };
      case 'schedule':
        return { branch: 'main', commitSha: '', inputs: {} };
    }
  }

  private getActor(event: CIEvent): Address {
    switch (event.type) {
      case 'push':
        return event.pusher;
      case 'pull_request':
        return event.author;
      case 'release':
        return event.author;
      case 'workflow_dispatch':
        return event.triggeredBy;
      case 'schedule':
        return '0x0000000000000000000000000000000000000000' as Address;
    }
  }

  getEventHistory(repoId?: Hex, limit = 100): Array<{ event: CIEvent; timestamp: number }> {
    let events = this.eventHistory;
    if (repoId) {
      events = events.filter((e) => e.event.repoId === repoId);
    }
    return events.slice(-limit);
  }

  clearHistory(): void {
    this.eventHistory = [];
  }
}

let eventBusInstance: CIEventBus | null = null;

export function getCIEventBus(workflowEngine: WorkflowEngine): CIEventBus {
  if (!eventBusInstance) {
    eventBusInstance = new CIEventBus(workflowEngine);
  }
  return eventBusInstance;
}

export function resetCIEventBus(): void {
  eventBusInstance = null;
}


