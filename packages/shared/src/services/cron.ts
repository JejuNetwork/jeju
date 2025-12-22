/**
 * Cron Service - Scheduled Tasks Integration
 * 
 * Provides decentralized cron triggers via the compute network.
 */

import type { Address } from 'viem';

import { z } from 'zod';

const CronConfigSchema = z.object({
  endpoint: z.string().url(),
  webhookBase: z.string().url().optional(),
});

export type CronConfig = z.infer<typeof CronConfigSchema>;

export interface CronService {
  register(job: CronJobConfig): Promise<CronJob>;
  cancel(jobId: string): Promise<boolean>;
  list(owner?: Address): Promise<CronJob[]>;
  get(jobId: string): Promise<CronJob | null>;
  trigger(jobId: string): Promise<void>;
  isHealthy(): Promise<boolean>;
}

export interface CronJobConfig {
  name: string;
  type: 'cron' | 'once' | 'interval';
  expression?: string; // Cron expression for 'cron' type
  triggerTime?: number; // Unix timestamp for 'once' type
  intervalMs?: number; // Milliseconds for 'interval' type
  webhook: string;
  metadata?: Record<string, unknown>;
  owner?: Address;
}

export interface CronJob {
  id: string;
  name: string;
  type: 'cron' | 'once' | 'interval';
  expression?: string;
  webhook: string;
  enabled: boolean;
  lastRun: number | null;
  nextRun: number;
  executionCount: number;
  metadata?: Record<string, unknown>;
}

class CronServiceImpl implements CronService {
  private endpoint: string;
  private available = true;
  private localJobs = new Map<string, CronJob>();

  constructor(config: CronConfig) {
    const validated = CronConfigSchema.parse(config);
    this.endpoint = validated.endpoint;
  }

  async register(job: CronJobConfig): Promise<CronJob> {
    const id = `cron-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    const cronJob: CronJob = {
      id,
      name: job.name,
      type: job.type,
      expression: job.expression,
      webhook: job.webhook,
      enabled: true,
      lastRun: null,
      nextRun: this.calculateNextRun(job),
      executionCount: 0,
      metadata: job.metadata,
    };

    if (this.available) {
      await this.remoteRegister(cronJob).catch((err: Error) => {
        console.error('[Cron] Remote registration failed:', err.message);
        this.available = false;
      });
    }

    // Store locally for fallback
    this.localJobs.set(id, cronJob);
    
    return cronJob;
  }

  async cancel(jobId: string): Promise<boolean> {
    if (this.available) {
      await this.remoteCancel(jobId);
    }

    const had = this.localJobs.has(jobId);
    this.localJobs.delete(jobId);
    return had;
  }

  async list(owner?: Address): Promise<CronJob[]> {
    if (this.available) {
      const jobs = await this.remoteList(owner);
      if (jobs) return jobs;
    }

    return Array.from(this.localJobs.values());
  }

  async get(jobId: string): Promise<CronJob | null> {
    if (this.available) {
      const job = await this.remoteGet(jobId);
      if (job) return job;
    }

    return this.localJobs.get(jobId) ?? null;
  }

  async trigger(jobId: string): Promise<void> {
    const job = await this.get(jobId);
    if (!job) throw new Error('Job not found');

    // Call webhook
    await fetch(job.webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, triggeredAt: Date.now() }),
    });

    // Update job state
    const localJob = this.localJobs.get(jobId);
    if (localJob) {
      localJob.lastRun = Date.now();
      localJob.executionCount++;
      localJob.nextRun = this.calculateNextRun({
        type: localJob.type,
        expression: localJob.expression,
      });
    }
  }

  async isHealthy(): Promise<boolean> {
    if (!this.available) {
      this.available = await this.checkHealth();
    }
    return this.available;
  }

  private calculateNextRun(job: Partial<CronJobConfig>): number {
    const now = Date.now();

    switch (job.type) {
      case 'once':
        if (job.triggerTime === undefined) {
          throw new Error('triggerTime is required for once job type');
        }
        return job.triggerTime;
      case 'interval':
        if (job.intervalMs === undefined) {
          throw new Error('intervalMs is required for interval job type');
        }
        return now + job.intervalMs;
      case 'cron':
        // Simple next minute calculation (full cron parsing would require a library)
        return now + 60000;
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
  }

  private async remoteRegister(job: CronJob): Promise<void> {
    await fetch(`${this.endpoint}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
      signal: AbortSignal.timeout(5000),
    });
  }

  private async remoteCancel(jobId: string): Promise<void> {
    await fetch(`${this.endpoint}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: jobId }),
      signal: AbortSignal.timeout(5000),
    });
  }

  private async remoteList(owner?: Address): Promise<CronJob[] | null> {
    const url = owner ? `${this.endpoint}/list?owner=${owner}` : `${this.endpoint}/list`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error(`[Cron] remoteList failed: ${response.status}`);
      return null;
    }
    const data = await response.json() as { jobs: CronJob[] };
    return data.jobs;
  }

  private async remoteGet(jobId: string): Promise<CronJob | null> {
    const response = await fetch(`${this.endpoint}/get/${jobId}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error(`[Cron] remoteGet failed: ${response.status}`);
      return null;
    }
    return await response.json() as CronJob;
  }

  private async checkHealth(): Promise<boolean> {
    const response = await fetch(`${this.endpoint}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  }
}

let instance: CronService | null = null;

export function createCronService(config: CronConfig): CronService {
  if (!instance) {
    instance = new CronServiceImpl(config);
  }
  return instance;
}

export function getCronServiceFromEnv(): CronService {
  const endpoint = process.env.CRON_ENDPOINT;
  if (!endpoint) {
    throw new Error('CRON_ENDPOINT environment variable is required');
  }
  return createCronService({ endpoint });
}

export function resetCronService(): void {
  instance = null;
}
