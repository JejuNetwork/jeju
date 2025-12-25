/** Crucible Service */

import { z } from 'zod'
import { AddressSchema } from '../schemas'

const CRUCIBLE_API = process.env.CRUCIBLE_URL || 'http://localhost:4020'

const AgentSchema = z.object({
  agentId: z.union([z.bigint(), z.string()]).transform((v) => BigInt(v)),
  owner: AddressSchema,
  name: z.string(),
  botType: z.string(),
  characterCid: z.string().nullable(),
  stateCid: z.string(),
  vaultAddress: AddressSchema,
  active: z.boolean(),
  registeredAt: z.number(),
  lastExecutedAt: z.number(),
  executionCount: z.number(),
  capabilities: z.array(z.string()),
  specializations: z.array(z.string()),
  reputation: z.number(),
})

const AgentTaskSchema = z.object({
  taskId: z.string(),
  agentId: z.union([z.bigint(), z.string()]).transform((v) => BigInt(v)),
  type: z.enum(['bounty', 'pr_review', 'code_audit', 'job', 'custom']),
  status: z.enum(['pending', 'assigned', 'in_progress', 'completed', 'failed']),
  input: z.object({
    bountyId: z.string().optional(),
    prId: z.string().optional(),
    repoId: z.string().optional(),
    description: z.string(),
    requirements: z.array(z.string()).optional(),
  }),
  output: z
    .object({
      result: z.string(),
      deliverables: z.array(z.string()).optional(),
      recommendation: z
        .enum(['approve', 'reject', 'request_changes'])
        .optional(),
      confidence: z.number(),
    })
    .optional(),
  reward: z.union([z.bigint(), z.string()]).transform((v) => BigInt(v)),
  deadline: z.number(),
  createdAt: z.number(),
  completedAt: z.number().optional(),
})

const AgentsResponseSchema = z.object({
  agents: z.array(AgentSchema),
})

export type Agent = z.infer<typeof AgentSchema>
export type AgentTask = z.infer<typeof AgentTaskSchema>

class CrucibleService {
  private headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  setAuth(address: string, signature: string, timestamp: string) {
    this.headers['x-jeju-address'] = address
    this.headers['x-jeju-signature'] = signature
    this.headers['x-jeju-timestamp'] = timestamp
  }

  async getAgents(params?: {
    capability?: string
    specialization?: string
    minReputation?: number
    active?: boolean
  }): Promise<Agent[]> {
    const searchParams = new URLSearchParams()
    if (params?.capability) searchParams.set('capability', params.capability)
    if (params?.specialization)
      searchParams.set('specialization', params.specialization)
    if (params?.minReputation)
      searchParams.set('minReputation', params.minReputation.toString())
    if (params?.active !== undefined)
      searchParams.set('active', params.active.toString())

    const response = await fetch(
      `${CRUCIBLE_API}/api/v1/agents?${searchParams}`,
      {
        headers: this.headers,
      },
    )

    if (!response.ok) {
      throw new Error(`Failed to list agents: ${response.status}`)
    }

    const json: unknown = await response.json()
    const result = AgentsResponseSchema.parse(json)
    return result.agents
  }

  async getAgent(agentId: bigint): Promise<Agent> {
    const response = await fetch(`${CRUCIBLE_API}/api/v1/agents/${agentId}`, {
      headers: this.headers,
    })

    if (!response.ok) {
      throw new Error(`Failed to get agent ${agentId}: ${response.status}`)
    }

    const json: unknown = await response.json()
    return AgentSchema.parse(json)
  }

  async assignBountyToAgent(
    bountyId: string,
    agentId: bigint,
    requirements: string[],
  ): Promise<AgentTask> {
    const response = await fetch(`${CRUCIBLE_API}/api/v1/tasks`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        agentId: agentId.toString(),
        type: 'bounty',
        input: {
          bountyId,
          requirements,
          description: `Complete bounty ${bountyId}`,
        },
      }),
    })

    if (!response.ok) throw new Error('Failed to assign bounty')
    const json: unknown = await response.json()
    const result = AgentTaskSchema.safeParse(json)
    if (!result.success) {
      throw new Error(
        `Invalid task response: ${result.error.issues[0]?.message}`,
      )
    }
    return result.data
  }

  async requestPRReview(
    repoId: string,
    prNumber: number,
    agentId: bigint,
  ): Promise<AgentTask> {
    const response = await fetch(`${CRUCIBLE_API}/api/v1/tasks`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        agentId: agentId.toString(),
        type: 'pr_review',
        input: {
          repoId,
          prId: `${repoId}:${prNumber}`,
          description: `Review PR #${prNumber}`,
        },
      }),
    })

    if (!response.ok) throw new Error('Failed to request PR review')
    const json: unknown = await response.json()
    const result = AgentTaskSchema.safeParse(json)
    if (!result.success) {
      throw new Error(
        `Invalid task response: ${result.error.issues[0]?.message}`,
      )
    }
    return result.data
  }

  async getTask(taskId: string): Promise<AgentTask> {
    const response = await fetch(`${CRUCIBLE_API}/api/v1/tasks/${taskId}`, {
      headers: this.headers,
    })

    if (!response.ok) {
      throw new Error(`Failed to get task ${taskId}: ${response.status}`)
    }

    const json: unknown = await response.json()
    return AgentTaskSchema.parse(json)
  }
}

export const crucibleService = new CrucibleService()
