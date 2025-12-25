/**
 * Autocrat Compute Trigger Integration
 */

import { getAutocratUrl, getDWSComputeUrl } from '@jejunetwork/config'
import type { JsonRecord } from '@jejunetwork/sdk'
import { expectValid } from '@jejunetwork/types'
import { z } from 'zod'
import {
  TriggerHistoryResponseSchema,
  TriggerListResponseSchema,
  TriggerRegisterResponseSchema,
} from '../lib'

export type TriggerSource = 'cloud' | 'compute' | 'onchain'

export interface Trigger {
  id: string
  source: TriggerSource
  type: 'cron' | 'webhook' | 'event'
  name: string
  description?: string
  cronExpression?: string
  webhookPath?: string
  eventTypes?: string[]
  endpoint: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  payload?: JsonRecord
  timeout: number
  resources?: {
    cpuCores?: number
    memoryMb?: number
    maxExecutionTime?: number
  }
  payment?: { mode: 'x402' | 'prepaid' | 'postpaid' | 'free' }
  active: boolean
  createdAt?: Date
}

export interface TriggerExecutionResult {
  executionId: string
  triggerId: string
  status: 'pending' | 'running' | 'success' | 'failed'
  startedAt: Date
  finishedAt?: Date
  output?: Record<string, string | number | boolean | null | object>
  error?: string
}

const TriggerExecutionResultSchema = z.object({
  executionId: z.string(),
  triggerId: z.string(),
  status: z.enum(['pending', 'running', 'success', 'failed']),
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().optional(),
  output: z.record(z.unknown()).optional(),
  error: z.string().optional(),
})

export interface OrchestratorTriggerResult {
  cycleCount: number
  processedProposals: number
  duration: number
  error?: string
}

// Network-aware endpoints
function getAutocratEndpoint(): string {
  return process.env.AUTOCRAT_URL ?? getAutocratUrl()
}

function getComputeEndpoint(): string {
  return (
    process.env.COMPUTE_URL ?? process.env.DWS_COMPUTE_URL ?? getDWSComputeUrl()
  )
}

const ORCHESTRATOR_CRON = process.env.ORCHESTRATOR_CRON ?? '*/30 * * * * *'

export function getAutocratTriggers(): Array<
  Omit<Trigger, 'id' | 'createdAt'>
> {
  const autocratUrl = getAutocratEndpoint()
  return [
    {
      source: 'compute',
      type: 'cron',
      name: 'autocrat-orchestrator-cycle',
      description: 'Run orchestrator',
      cronExpression: ORCHESTRATOR_CRON,
      endpoint: `${autocratUrl}/trigger/orchestrator`,
      method: 'POST',
      timeout: 60,
      payload: { action: 'run-cycle' },
      resources: { cpuCores: 1, memoryMb: 512 },
      payment: { mode: 'free' },
      active: true,
    },
    {
      source: 'compute',
      type: 'webhook',
      name: 'autocrat-manual-trigger',
      webhookPath: '/autocrat/trigger',
      endpoint: `${autocratUrl}/trigger/orchestrator`,
      method: 'POST',
      timeout: 60,
      payment: { mode: 'free' },
      active: true,
    },
    {
      source: 'compute',
      type: 'event',
      name: 'autocrat-proposal-submitted',
      eventTypes: [
        'ProposalSubmitted',
        'AutocratVoteCast',
        'CEODecisionNeeded',
      ],
      endpoint: `${autocratUrl}/trigger/orchestrator`,
      method: 'POST',
      timeout: 30,
      payment: { mode: 'free' },
      active: true,
    },
  ]
}

export async function registerAutocratTriggers(): Promise<void> {
  const computeEndpoint = getComputeEndpoint()
  const triggers = getAutocratTriggers()
  for (const trigger of triggers) {
    const r = await fetch(`${computeEndpoint}/api/triggers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trigger),
    })
    if (r.ok) {
      expectValid(
        TriggerRegisterResponseSchema,
        await r.json(),
        `Trigger registration ${trigger.name}`,
      )
    }
  }
}

export function startLocalCron(
  callback: () => Promise<OrchestratorTriggerResult>,
): NodeJS.Timer {
  const match = ORCHESTRATOR_CRON.match(/^\*\/(\d+)/)
  const intervalMs = match ? parseInt(match[1], 10) * 1000 : 30_000
  return setInterval(() => {
    callback().catch((error) => console.error('[Trigger] Error:', error))
  }, intervalMs)
}

export class ComputeTriggerClient {
  constructor(private readonly computeUrl = getComputeEndpoint()) {}

  async register(trigger: Omit<Trigger, 'id' | 'createdAt'>): Promise<string> {
    const r = await fetch(`${this.computeUrl}/api/triggers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trigger),
    })
    if (!r.ok) throw new Error(`Register failed: ${r.status}`)
    const data = expectValid(
      TriggerRegisterResponseSchema,
      await r.json(),
      'Trigger registration',
    )
    return data.id
  }

  async execute(
    triggerId: string,
    input?: JsonRecord,
  ): Promise<TriggerExecutionResult> {
    const r = await fetch(
      `${this.computeUrl}/api/triggers/${triggerId}/execute`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      },
    )
    if (!r.ok) throw new Error(`Execute failed: ${r.status}`)
    return expectValid(
      TriggerExecutionResultSchema,
      await r.json(),
      'trigger execution result',
    )
  }

  async list(filter?: { type?: string; active?: boolean }): Promise<Trigger[]> {
    const params = new URLSearchParams()
    if (filter?.type) params.set('type', filter.type)
    if (filter?.active !== undefined)
      params.set('active', String(filter.active))
    const r = await fetch(`${this.computeUrl}/api/triggers?${params}`)
    if (!r.ok) throw new Error(`List failed: ${r.status}`)
    const data = expectValid(
      TriggerListResponseSchema,
      await r.json(),
      'Trigger list',
    )
    return data.triggers as Trigger[]
  }

  async getHistory(
    triggerId?: string,
    limit = 50,
  ): Promise<TriggerExecutionResult[]> {
    const params = new URLSearchParams({ limit: String(limit) })
    if (triggerId) params.set('triggerId', triggerId)
    const r = await fetch(`${this.computeUrl}/api/triggers/history?${params}`)
    if (!r.ok) throw new Error(`History failed: ${r.status}`)
    const data = expectValid(
      TriggerHistoryResponseSchema,
      await r.json(),
      'Trigger history',
    )
    return data.executions.map((exec) => ({
      executionId: exec.executionId,
      triggerId: exec.triggerId,
      status: exec.status as TriggerExecutionResult['status'],
      startedAt: exec.startedAt ? new Date(exec.startedAt) : new Date(),
      finishedAt: exec.finishedAt ? new Date(exec.finishedAt) : undefined,
      output: exec.output as TriggerExecutionResult['output'],
      error: exec.error,
    }))
  }

  async isAvailable(): Promise<boolean> {
    try {
      return (await fetch(`${this.computeUrl}/health`)).ok
    } catch {
      return false
    }
  }
}

let triggerClient: ComputeTriggerClient | null = null
export function getComputeTriggerClient(): ComputeTriggerClient {
  if (!triggerClient) {
    triggerClient = new ComputeTriggerClient()
  }
  return triggerClient
}
