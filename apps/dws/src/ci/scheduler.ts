/**
 * CI Scheduler - Cron-based workflow scheduling
 */

import type { Hex } from 'viem';
import type { Workflow, WorkflowTrigger } from './types';
import { getCIEventBus } from './event-bus';
import type { WorkflowEngine } from './workflow-engine';

interface ScheduledJob {
  jobId: string;
  workflowId: Hex;
  repoId: Hex;
  cron: string;
  nextRun: number;
  lastRun?: number;
  enabled: boolean;
}

interface CronParts {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

export class CIScheduler {
  private workflowEngine: WorkflowEngine;
  private jobs = new Map<string, ScheduledJob>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private checkInterval = 60000;

  constructor(workflowEngine: WorkflowEngine) {
    this.workflowEngine = workflowEngine;
  }

  async loadScheduledWorkflows(repoIds: Hex[]): Promise<void> {
    for (const repoId of repoIds) {
      const workflows = await this.workflowEngine.loadRepositoryWorkflows(repoId);

      for (const workflow of workflows) {
        const scheduleTriggers = workflow.triggers.filter((t) => t.type === 'schedule');

        for (const trigger of scheduleTriggers) {
          if (!trigger.schedule) continue;

          const jobId = `${workflow.workflowId}-${trigger.schedule}`;
          const nextRun = this.getNextRunTime(trigger.schedule);

          this.jobs.set(jobId, {
            jobId,
            workflowId: workflow.workflowId,
            repoId: workflow.repoId,
            cron: trigger.schedule,
            nextRun,
            enabled: workflow.active,
          });
        }
      }
    }
  }

  start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.checkAndTrigger();
    }, this.checkInterval);

    this.checkAndTrigger();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async checkAndTrigger(): Promise<void> {
    const now = Date.now();

    for (const job of this.jobs.values()) {
      if (!job.enabled) continue;
      if (now < job.nextRun) continue;

      job.lastRun = now;
      job.nextRun = this.getNextRunTime(job.cron);

      const eventBus = getCIEventBus(this.workflowEngine);
      await eventBus.emit({
        type: 'schedule',
        repoId: job.repoId,
        workflowId: job.workflowId,
      });
    }
  }

  private getNextRunTime(cron: string): number {
    const parts = this.parseCron(cron);
    const now = new Date();
    const next = new Date(now);

    next.setSeconds(0);
    next.setMilliseconds(0);

    for (let i = 0; i < 366 * 24 * 60; i++) {
      next.setMinutes(next.getMinutes() + 1);

      if (
        parts.minute.includes(next.getMinutes()) &&
        parts.hour.includes(next.getHours()) &&
        parts.dayOfMonth.includes(next.getDate()) &&
        parts.month.includes(next.getMonth() + 1) &&
        parts.dayOfWeek.includes(next.getDay())
      ) {
        return next.getTime();
      }
    }

    return now.getTime() + 24 * 60 * 60 * 1000;
  }

  private parseCron(cron: string): CronParts {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(`Invalid cron expression: ${cron}`);
    }

    return {
      minute: this.parseField(parts[0], 0, 59),
      hour: this.parseField(parts[1], 0, 23),
      dayOfMonth: this.parseField(parts[2], 1, 31),
      month: this.parseField(parts[3], 1, 12),
      dayOfWeek: this.parseField(parts[4], 0, 6),
    };
  }

  private parseField(field: string, min: number, max: number): number[] {
    if (field === '*') {
      return Array.from({ length: max - min + 1 }, (_, i) => min + i);
    }

    const values: number[] = [];

    for (const part of field.split(',')) {
      if (part.includes('/')) {
        const [range, step] = part.split('/');
        const stepNum = parseInt(step, 10);
        const rangeValues = range === '*' ? [min, max] : range.split('-').map((n) => parseInt(n, 10));
        const start = rangeValues[0];
        const end = rangeValues[1] ?? max;

        for (let i = start; i <= end; i += stepNum) {
          if (i >= min && i <= max) values.push(i);
        }
      } else if (part.includes('-')) {
        const [start, end] = part.split('-').map((n) => parseInt(n, 10));
        for (let i = start; i <= end; i++) {
          if (i >= min && i <= max) values.push(i);
        }
      } else {
        const num = parseInt(part, 10);
        if (num >= min && num <= max) values.push(num);
      }
    }

    return [...new Set(values)].sort((a, b) => a - b);
  }

  addJob(workflow: Workflow, trigger: WorkflowTrigger): ScheduledJob | null {
    if (trigger.type !== 'schedule' || !trigger.schedule) return null;

    const jobId = `${workflow.workflowId}-${trigger.schedule}`;
    const job: ScheduledJob = {
      jobId,
      workflowId: workflow.workflowId,
      repoId: workflow.repoId,
      cron: trigger.schedule,
      nextRun: this.getNextRunTime(trigger.schedule),
      enabled: workflow.active,
    };

    this.jobs.set(jobId, job);
    return job;
  }

  removeJob(jobId: string): void {
    this.jobs.delete(jobId);
  }

  enableJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.enabled = true;
      job.nextRun = this.getNextRunTime(job.cron);
    }
  }

  disableJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.enabled = false;
    }
  }

  getJob(jobId: string): ScheduledJob | undefined {
    return this.jobs.get(jobId);
  }

  listJobs(repoId?: Hex): ScheduledJob[] {
    const jobs = Array.from(this.jobs.values());
    if (repoId) {
      return jobs.filter((j) => j.repoId === repoId);
    }
    return jobs;
  }

  getNextRuns(limit = 10): Array<{ job: ScheduledJob; nextRun: Date }> {
    return Array.from(this.jobs.values())
      .filter((j) => j.enabled)
      .sort((a, b) => a.nextRun - b.nextRun)
      .slice(0, limit)
      .map((job) => ({ job, nextRun: new Date(job.nextRun) }));
  }
}

let schedulerInstance: CIScheduler | null = null;

export function getCIScheduler(workflowEngine: WorkflowEngine): CIScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new CIScheduler(workflowEngine);
  }
  return schedulerInstance;
}

export function resetCIScheduler(): void {
  if (schedulerInstance) {
    schedulerInstance.stop();
    schedulerInstance = null;
  }
}


