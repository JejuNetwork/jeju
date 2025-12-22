/**
 * CI Scheduler - Cron-based workflow scheduling using croner library
 */

import { Cron } from 'croner'
import type { Hex } from 'viem'
import { getCIEventBus } from './event-bus'
import type { Workflow, WorkflowTrigger } from './types'
import type { WorkflowEngine } from './workflow-engine'

interface ScheduledJob {
  jobId: string
  workflowId: Hex
  repoId: Hex
  cron: string
  nextRun: number
  lastRun?: number
  enabled: boolean
  cronInstance?: Cron
}

export class CIScheduler {
  private workflowEngine: WorkflowEngine
  private jobs = new Map<string, ScheduledJob>()

  constructor(workflowEngine: WorkflowEngine) {
    this.workflowEngine = workflowEngine
  }

  async loadScheduledWorkflows(repoIds: Hex[]): Promise<void> {
    for (const repoId of repoIds) {
      const workflows =
        await this.workflowEngine.loadRepositoryWorkflows(repoId)

      for (const workflow of workflows) {
        const scheduleTriggers = workflow.triggers.filter(
          (t) => t.type === 'schedule',
        )

        for (const trigger of scheduleTriggers) {
          if (!trigger.schedule) continue
          this.addJob(workflow, trigger)
        }
      }
    }
  }

  start(): void {
    // All jobs are started when added via croner
    for (const job of this.jobs.values()) {
      if (job.enabled && !job.cronInstance) {
        this.startJob(job)
      }
    }
  }

  stop(): void {
    for (const job of this.jobs.values()) {
      if (job.cronInstance) {
        job.cronInstance.stop()
        job.cronInstance = undefined
      }
    }
  }

  private startJob(job: ScheduledJob): void {
    job.cronInstance = new Cron(job.cron, async () => {
      if (!job.enabled) return

      job.lastRun = Date.now()
      const nextDate = job.cronInstance?.nextRun()
      job.nextRun = nextDate ? nextDate.getTime() : Date.now() + 60000

      const eventBus = getCIEventBus(this.workflowEngine)
      await eventBus.emit({
        type: 'schedule',
        repoId: job.repoId,
        workflowId: job.workflowId,
      })
    })

    // Update next run time
    const nextDate = job.cronInstance.nextRun()
    job.nextRun = nextDate ? nextDate.getTime() : Date.now() + 60000
  }

  addJob(workflow: Workflow, trigger: WorkflowTrigger): ScheduledJob | null {
    if (trigger.type !== 'schedule' || !trigger.schedule) return null

    const jobId = `${workflow.workflowId}-${trigger.schedule}`

    // Stop existing job if any
    const existingJob = this.jobs.get(jobId)
    if (existingJob?.cronInstance) {
      existingJob.cronInstance.stop()
    }

    const job: ScheduledJob = {
      jobId,
      workflowId: workflow.workflowId,
      repoId: workflow.repoId,
      cron: trigger.schedule,
      nextRun: Date.now(),
      enabled: workflow.active,
    }

    if (job.enabled) {
      this.startJob(job)
    }

    this.jobs.set(jobId, job)
    return job
  }

  removeJob(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (job?.cronInstance) {
      job.cronInstance.stop()
    }
    this.jobs.delete(jobId)
  }

  enableJob(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (job) {
      job.enabled = true
      if (!job.cronInstance) {
        this.startJob(job)
      }
    }
  }

  disableJob(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (job) {
      job.enabled = false
      if (job.cronInstance) {
        job.cronInstance.stop()
        job.cronInstance = undefined
      }
    }
  }

  getJob(jobId: string): ScheduledJob | undefined {
    return this.jobs.get(jobId)
  }

  listJobs(repoId?: Hex): ScheduledJob[] {
    const jobs = Array.from(this.jobs.values())
    if (repoId) {
      return jobs.filter((j) => j.repoId === repoId)
    }
    return jobs
  }

  getNextRuns(limit = 10): Array<{ job: ScheduledJob; nextRun: Date }> {
    return Array.from(this.jobs.values())
      .filter((j) => j.enabled)
      .sort((a, b) => a.nextRun - b.nextRun)
      .slice(0, limit)
      .map((job) => ({ job, nextRun: new Date(job.nextRun) }))
  }
}

let schedulerInstance: CIScheduler | null = null

export function getCIScheduler(workflowEngine: WorkflowEngine): CIScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new CIScheduler(workflowEngine)
  }
  return schedulerInstance
}

export function resetCIScheduler(): void {
  if (schedulerInstance) {
    schedulerInstance.stop()
    schedulerInstance = null
  }
}
