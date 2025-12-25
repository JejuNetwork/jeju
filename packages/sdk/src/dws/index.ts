/**
 * DWS (Distributed Workflow System) Module
 *
 * Provides access to:
 * - Trigger management (cron, webhook, event-based)
 * - Workflow execution and scheduling
 * - Job monitoring and management
 * - Compute resource allocation
 */

import type { JsonRecord, NetworkType } from '@jejunetwork/types'
import type { Address } from 'viem'
import { getServicesConfig } from '../config'
import { generateAuthHeaders } from '../shared/api'
import {
  DWSCreateTriggerResponseSchema,
  DWSCreateWorkflowResponseSchema,
  DWSJobResponseSchema,
  DWSStatsSchema,
  JobLogsSchema,
  JobSchema,
  JobsListSchema,
  TriggerSchema,
  TriggersListSchema,
  WorkflowMetricsSchema,
  WorkflowSchema,
  WorkflowsListSchema,
} from '../shared/schemas'
import type { JejuWallet } from '../wallet'

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const TriggerType = {
  CRON: 'cron',
  WEBHOOK: 'webhook',
  EVENT: 'event',
  MANUAL: 'manual',
  CHAIN_EVENT: 'chain_event',
} as const
export type TriggerType = (typeof TriggerType)[keyof typeof TriggerType]

export const JobStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus]

export const WorkflowStatus = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  DISABLED: 'disabled',
} as const
export type WorkflowStatus =
  (typeof WorkflowStatus)[keyof typeof WorkflowStatus]

export interface Trigger {
  triggerId: string
  type: TriggerType
  name: string
  config: TriggerConfig
  workflowId: string
  owner: Address
  isActive: boolean
  createdAt: number
  lastTriggeredAt: number
  triggerCount: number
}

export interface TriggerConfig {
  // For CRON
  cronExpression?: string
  timezone?: string

  // For WEBHOOK
  webhookSecret?: string
  allowedOrigins?: string[]

  // For EVENT / CHAIN_EVENT
  contractAddress?: Address
  eventSignature?: string
  chainId?: number

  // Common
  maxRetries?: number
  retryDelayMs?: number
}

export interface Workflow {
  workflowId: string
  name: string
  description: string
  owner: Address
  status: WorkflowStatus
  steps: WorkflowStep[]
  createdAt: number
  updatedAt: number
  totalExecutions: number
  successfulExecutions: number
}

export interface WorkflowStep {
  stepId: string
  name: string
  type: 'compute' | 'storage' | 'contract' | 'http' | 'transform'
  config: JsonRecord
  dependencies: string[]
  timeout: number
  retries: number
}

export interface Job {
  jobId: string
  workflowId: string
  triggerId: string
  status: JobStatus
  startedAt: number
  completedAt: number
  duration: number
  input: JsonRecord
  output: JsonRecord
  error: string | null
  logs: string[]
  stepResults: StepResult[]
}

export interface StepResult {
  stepId: string
  status: JobStatus
  startedAt: number
  completedAt: number
  output: JsonRecord
  error: string | null
}

export interface DWSTriggerParams {
  name: string
  type: TriggerType
  config: TriggerConfig
  workflowId: string
}

export interface CreateWorkflowParams {
  name: string
  description?: string
  steps: Omit<WorkflowStep, 'stepId'>[]
}

export interface ExecuteWorkflowParams {
  workflowId: string
  input?: JsonRecord
}

export interface DWSModule {
  // ═══════════════════════════════════════════════════════════════════════
  //                         TRIGGERS
  // ═══════════════════════════════════════════════════════════════════════

  /** Create a new trigger */
  createTrigger(params: DWSTriggerParams): Promise<{ triggerId: string }>

  /** Get trigger by ID */
  getTrigger(triggerId: string): Promise<Trigger | null>

  /** List my triggers */
  listMyTriggers(): Promise<Trigger[]>

  /** Update trigger config */
  updateTrigger(
    triggerId: string,
    config: Partial<TriggerConfig>,
  ): Promise<void>

  /** Enable/disable trigger */
  setTriggerActive(triggerId: string, active: boolean): Promise<void>

  /** Delete trigger */
  deleteTrigger(triggerId: string): Promise<void>

  /** Manually fire a trigger */
  fireTrigger(
    triggerId: string,
    payload?: JsonRecord,
  ): Promise<{ jobId: string }>

  // ═══════════════════════════════════════════════════════════════════════
  //                         WORKFLOWS
  // ═══════════════════════════════════════════════════════════════════════

  /** Create a new workflow */
  createWorkflow(params: CreateWorkflowParams): Promise<{ workflowId: string }>

  /** Get workflow by ID */
  getWorkflow(workflowId: string): Promise<Workflow | null>

  /** List my workflows */
  listMyWorkflows(): Promise<Workflow[]>

  /** Update workflow */
  updateWorkflow(
    workflowId: string,
    updates: Partial<CreateWorkflowParams>,
  ): Promise<void>

  /** Set workflow status */
  setWorkflowStatus(workflowId: string, status: WorkflowStatus): Promise<void>

  /** Delete workflow */
  deleteWorkflow(workflowId: string): Promise<void>

  /** Execute workflow manually */
  executeWorkflow(params: ExecuteWorkflowParams): Promise<{ jobId: string }>

  // ═══════════════════════════════════════════════════════════════════════
  //                         JOBS
  // ═══════════════════════════════════════════════════════════════════════

  /** Get job by ID */
  getJob(jobId: string): Promise<Job | null>

  /** List jobs for a workflow */
  listWorkflowJobs(workflowId: string, limit?: number): Promise<Job[]>

  /** List my recent jobs */
  listMyJobs(limit?: number): Promise<Job[]>

  /** Cancel a running job */
  cancelJob(jobId: string): Promise<void>

  /** Retry a failed job */
  retryJob(jobId: string): Promise<{ jobId: string }>

  /** Get job logs */
  getJobLogs(jobId: string): Promise<string[]>

  // ═══════════════════════════════════════════════════════════════════════
  //                         STATS & MONITORING
  // ═══════════════════════════════════════════════════════════════════════

  /** Get DWS usage stats */
  getStats(): Promise<{
    totalWorkflows: number
    totalTriggers: number
    totalJobs: number
    successRate: number
    avgExecutionTime: number
  }>

  /** Get workflow metrics */
  getWorkflowMetrics(workflowId: string): Promise<{
    executions: number
    successRate: number
    avgDuration: number
    lastExecuted: number
  }>
}

// ═══════════════════════════════════════════════════════════════════════════
//                          IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export function createDWSModule(
  wallet: JejuWallet,
  network: NetworkType,
): DWSModule {
  const services = getServicesConfig(network)
  const dwsApiUrl = services.dws?.api ?? `${services.gateway.api}/dws`

  async function authHeaders(): Promise<Record<string, string>> {
    return generateAuthHeaders(wallet, 'jeju-dws')
  }

  return {
    // ═══════════════════════════════════════════════════════════════════════
    //                         TRIGGERS
    // ═══════════════════════════════════════════════════════════════════════

    async createTrigger(params) {
      const headers = await authHeaders()
      const response = await fetch(`${dwsApiUrl}/triggers`, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Failed to create trigger: ${error}`)
      }

      const rawData: unknown = await response.json()
      return DWSCreateTriggerResponseSchema.parse(rawData)
    },

    async getTrigger(triggerId) {
      const response = await fetch(`${dwsApiUrl}/triggers/${triggerId}`)
      if (response.status === 404) return null
      if (!response.ok) {
        throw new Error(`Failed to get trigger: ${response.statusText}`)
      }
      const rawData: unknown = await response.json()
      const parsed = TriggerSchema.parse(rawData)
      return {
        triggerId: parsed.triggerId,
        type: parsed.type as TriggerType,
        name: parsed.name,
        config: {
          ...parsed.config,
          contractAddress: parsed.config.contractAddress as Address | undefined,
        },
        workflowId: parsed.workflowId,
        owner: parsed.owner as Address,
        isActive: parsed.isActive,
        createdAt: parsed.createdAt,
        lastTriggeredAt: parsed.lastTriggeredAt,
        triggerCount: parsed.triggerCount,
      }
    },

    async listMyTriggers() {
      const headers = await authHeaders()
      const response = await fetch(`${dwsApiUrl}/triggers`, { headers })
      if (!response.ok) {
        throw new Error(`Failed to list triggers: ${response.statusText}`)
      }
      const rawData: unknown = await response.json()
      const data = TriggersListSchema.parse(rawData)
      return data.triggers.map((t) => ({
        triggerId: t.triggerId,
        type: t.type as TriggerType,
        name: t.name,
        config: {
          ...t.config,
          contractAddress: t.config.contractAddress as Address | undefined,
        },
        workflowId: t.workflowId,
        owner: t.owner as Address,
        isActive: t.isActive,
        createdAt: t.createdAt,
        lastTriggeredAt: t.lastTriggeredAt,
        triggerCount: t.triggerCount,
      }))
    },

    async updateTrigger(triggerId, config) {
      const headers = await authHeaders()
      const response = await fetch(`${dwsApiUrl}/triggers/${triggerId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ config }),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Failed to update trigger: ${error}`)
      }
    },

    async setTriggerActive(triggerId, active) {
      const headers = await authHeaders()
      const response = await fetch(
        `${dwsApiUrl}/triggers/${triggerId}/active`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ active }),
        },
      )

      if (!response.ok) {
        throw new Error('Failed to update trigger status')
      }
    },

    async deleteTrigger(triggerId) {
      const headers = await authHeaders()
      const response = await fetch(`${dwsApiUrl}/triggers/${triggerId}`, {
        method: 'DELETE',
        headers,
      })

      if (!response.ok) {
        throw new Error('Failed to delete trigger')
      }
    },

    async fireTrigger(triggerId, payload) {
      const headers = await authHeaders()
      const response = await fetch(`${dwsApiUrl}/triggers/${triggerId}/fire`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ payload }),
      })

      if (!response.ok) {
        throw new Error('Failed to fire trigger')
      }

      const rawData: unknown = await response.json()
      return DWSJobResponseSchema.parse(rawData)
    },

    // ═══════════════════════════════════════════════════════════════════════
    //                         WORKFLOWS
    // ═══════════════════════════════════════════════════════════════════════

    async createWorkflow(params) {
      const headers = await authHeaders()
      const response = await fetch(`${dwsApiUrl}/workflows`, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Failed to create workflow: ${error}`)
      }

      const rawData: unknown = await response.json()
      return DWSCreateWorkflowResponseSchema.parse(rawData)
    },

    async getWorkflow(workflowId) {
      const response = await fetch(`${dwsApiUrl}/workflows/${workflowId}`)
      if (response.status === 404) return null
      if (!response.ok) {
        throw new Error(`Failed to get workflow: ${response.statusText}`)
      }
      const rawData: unknown = await response.json()
      const parsed = WorkflowSchema.parse(rawData)
      return {
        ...parsed,
        owner: parsed.owner as Address,
        status: parsed.status as WorkflowStatus,
        steps: parsed.steps.map((s) => ({
          ...s,
          type: s.type as WorkflowStep['type'],
        })),
      }
    },

    async listMyWorkflows() {
      const headers = await authHeaders()
      const response = await fetch(`${dwsApiUrl}/workflows`, { headers })
      if (!response.ok) {
        throw new Error(`Failed to list workflows: ${response.statusText}`)
      }
      const rawData: unknown = await response.json()
      const data = WorkflowsListSchema.parse(rawData)
      return data.workflows.map((w) => ({
        ...w,
        owner: w.owner as Address,
        status: w.status as WorkflowStatus,
        steps: w.steps.map((s) => ({
          ...s,
          type: s.type as WorkflowStep['type'],
        })),
      }))
    },

    async updateWorkflow(workflowId, updates) {
      const headers = await authHeaders()
      const response = await fetch(`${dwsApiUrl}/workflows/${workflowId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        throw new Error('Failed to update workflow')
      }
    },

    async setWorkflowStatus(workflowId, status) {
      const headers = await authHeaders()
      const response = await fetch(
        `${dwsApiUrl}/workflows/${workflowId}/status`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ status }),
        },
      )

      if (!response.ok) {
        throw new Error('Failed to update workflow status')
      }
    },

    async deleteWorkflow(workflowId) {
      const headers = await authHeaders()
      const response = await fetch(`${dwsApiUrl}/workflows/${workflowId}`, {
        method: 'DELETE',
        headers,
      })

      if (!response.ok) {
        throw new Error('Failed to delete workflow')
      }
    },

    async executeWorkflow(params) {
      const headers = await authHeaders()
      const response = await fetch(
        `${dwsApiUrl}/workflows/${params.workflowId}/execute`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ input: params.input }),
        },
      )

      if (!response.ok) {
        throw new Error('Failed to execute workflow')
      }

      const rawData: unknown = await response.json()
      return DWSJobResponseSchema.parse(rawData)
    },

    // ═══════════════════════════════════════════════════════════════════════
    //                         JOBS
    // ═══════════════════════════════════════════════════════════════════════

    async getJob(jobId) {
      const headers = await authHeaders()
      const response = await fetch(`${dwsApiUrl}/jobs/${jobId}`, { headers })
      if (response.status === 404) return null
      if (!response.ok) {
        throw new Error(`Failed to get job: ${response.statusText}`)
      }
      const rawData: unknown = await response.json()
      const parsed = JobSchema.parse(rawData)
      return {
        ...parsed,
        status: parsed.status as JobStatus,
        stepResults: parsed.stepResults.map((sr) => ({
          ...sr,
          status: sr.status as JobStatus,
        })),
      }
    },

    async listWorkflowJobs(workflowId, limit = 50) {
      const headers = await authHeaders()
      const response = await fetch(
        `${dwsApiUrl}/workflows/${workflowId}/jobs?limit=${limit}`,
        { headers },
      )
      if (!response.ok) {
        throw new Error(`Failed to list workflow jobs: ${response.statusText}`)
      }
      const rawData: unknown = await response.json()
      const data = JobsListSchema.parse(rawData)
      return data.jobs.map((j) => ({
        ...j,
        status: j.status as JobStatus,
        stepResults: j.stepResults.map((sr) => ({
          ...sr,
          status: sr.status as JobStatus,
        })),
      }))
    },

    async listMyJobs(limit = 50) {
      const headers = await authHeaders()
      const response = await fetch(`${dwsApiUrl}/jobs?limit=${limit}`, {
        headers,
      })
      if (!response.ok) {
        throw new Error(`Failed to list jobs: ${response.statusText}`)
      }
      const rawData: unknown = await response.json()
      const data = JobsListSchema.parse(rawData)
      return data.jobs.map((j) => ({
        ...j,
        status: j.status as JobStatus,
        stepResults: j.stepResults.map((sr) => ({
          ...sr,
          status: sr.status as JobStatus,
        })),
      }))
    },

    async cancelJob(jobId) {
      const headers = await authHeaders()
      const response = await fetch(`${dwsApiUrl}/jobs/${jobId}/cancel`, {
        method: 'POST',
        headers,
      })

      if (!response.ok) {
        throw new Error('Failed to cancel job')
      }
    },

    async retryJob(jobId) {
      const headers = await authHeaders()
      const response = await fetch(`${dwsApiUrl}/jobs/${jobId}/retry`, {
        method: 'POST',
        headers,
      })

      if (!response.ok) {
        throw new Error('Failed to retry job')
      }

      const rawData: unknown = await response.json()
      return DWSJobResponseSchema.parse(rawData)
    },

    async getJobLogs(jobId) {
      const headers = await authHeaders()
      const response = await fetch(`${dwsApiUrl}/jobs/${jobId}/logs`, {
        headers,
      })
      if (!response.ok) {
        throw new Error(`Failed to get job logs: ${response.statusText}`)
      }
      const rawData: unknown = await response.json()
      const data = JobLogsSchema.parse(rawData)
      return data.logs
    },

    // ═══════════════════════════════════════════════════════════════════════
    //                         STATS & MONITORING
    // ═══════════════════════════════════════════════════════════════════════

    async getStats() {
      const headers = await authHeaders()
      const response = await fetch(`${dwsApiUrl}/stats`, { headers })
      if (!response.ok) {
        throw new Error(`Failed to get stats: ${response.statusText}`)
      }
      const rawData: unknown = await response.json()
      return DWSStatsSchema.parse(rawData)
    },

    async getWorkflowMetrics(workflowId) {
      const headers = await authHeaders()
      const response = await fetch(
        `${dwsApiUrl}/workflows/${workflowId}/metrics`,
        { headers },
      )
      if (!response.ok) {
        throw new Error(
          `Failed to get workflow metrics: ${response.statusText}`,
        )
      }
      const rawData: unknown = await response.json()
      return WorkflowMetricsSchema.parse(rawData)
    },
  }
}
