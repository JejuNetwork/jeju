/**
 * Crucible Integration Service
 * Connects Factory to the agent orchestration platform
 */

import type { Address } from 'viem'

const CRUCIBLE_API = process.env.CRUCIBLE_URL || 'http://localhost:4020'

export interface Agent {
  agentId: bigint
  owner: Address
  name: string
  botType: string
  characterCid: string | null
  stateCid: string
  vaultAddress: Address
  active: boolean
  registeredAt: number
  lastExecutedAt: number
  executionCount: number
  capabilities: string[]
  specializations: string[]
  reputation: number
}

export interface AgentTask {
  taskId: string
  agentId: bigint
  type: 'bounty' | 'pr_review' | 'code_audit' | 'job' | 'custom'
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed'
  input: {
    bountyId?: string
    prId?: string
    repoId?: string
    description: string
    requirements?: string[]
  }
  output?: {
    result: string
    deliverables?: string[]
    recommendation?: 'approve' | 'reject' | 'request_changes'
    confidence: number
  }
  reward: bigint
  deadline: number
  createdAt: number
  completedAt?: number
}

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
    ).catch(() => null)

    if (!response?.ok) {
      // Return mock data if service is unavailable
      return [
        {
          agentId: BigInt(1),
          owner: '0x0000000000000000000000000000000000000000' as Address,
          name: 'Code Reviewer',
          botType: 'review',
          characterCid: null,
          stateCid: 'ipfs://...',
          vaultAddress: '0x0000000000000000000000000000000000000000' as Address,
          active: true,
          registeredAt: Date.now(),
          lastExecutedAt: 0,
          executionCount: 0,
          capabilities: ['code_review', 'security_audit'],
          specializations: ['solidity'],
          reputation: 85,
        },
      ]
    }

    const data = (await response.json()) as { agents: Agent[] }
    return data.agents
  }

  async getAgent(agentId: bigint): Promise<Agent | null> {
    const response = await fetch(`${CRUCIBLE_API}/api/v1/agents/${agentId}`, {
      headers: this.headers,
    }).catch(() => null)

    if (!response?.ok) return null
    return response.json()
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
    return response.json()
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
    return response.json()
  }

  async getTask(taskId: string): Promise<AgentTask | null> {
    const response = await fetch(`${CRUCIBLE_API}/api/v1/tasks/${taskId}`, {
      headers: this.headers,
    }).catch(() => null)

    if (!response?.ok) return null
    return response.json()
  }
}

export const crucibleService = new CrucibleService()
