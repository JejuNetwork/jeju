/**
 * Typed A2A Client
 *
 * Provides type-safe A2A (Agent-to-Agent) protocol calls.
 * Centralizes all A2A communication with proper error handling and validation.
 *
 * A2A uses JSON-RPC 2.0 over HTTP with a custom skill-based invocation pattern.
 */

import {
  getAutocratA2AUrl,
  getAutocratUrl,
  getCoreAppUrl,
} from '@jejunetwork/config'
import { expectValid } from '@jejunetwork/types'
import { A2AJsonRpcResponseSchema, extractA2AData } from '../schemas'

interface A2ASkillParams {
  [key: string]: unknown
}

interface A2ACallOptions {
  timeout?: number
  signal?: AbortSignal
}

interface A2ASkillResult<T> {
  data: T
  text?: string
}

function getAutocratA2AEndpoint(): string {
  return process.env.AUTOCRAT_A2A_URL ?? getAutocratA2AUrl()
}

function getCEOA2AEndpoint(): string {
  return process.env.CEO_A2A_URL ?? `${getCoreAppUrl('AUTOCRAT_CEO')}/a2a`
}

function getAutocratMCPEndpoint(): string {
  return process.env.AUTOCRAT_MCP_URL ?? `${getAutocratUrl()}/mcp`
}

function getCEOMCPEndpoint(): string {
  return process.env.CEO_MCP_URL ?? `${getCoreAppUrl('AUTOCRAT_CEO')}/mcp`
}

async function callA2A<T>(
  endpoint: string,
  skillId: string,
  params: A2ASkillParams = {},
  options: A2ACallOptions = {},
): Promise<A2ASkillResult<T>> {
  const { timeout = 30000, signal } = options

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'message/send',
      params: {
        message: {
          messageId: `a2a-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          parts: [{ kind: 'data', data: { skillId, params } }],
        },
      },
    }),
    signal: signal ?? controller.signal,
  }).finally(() => clearTimeout(timeoutId))

  if (!response.ok) {
    throw new Error(
      `A2A call to ${skillId} failed: ${response.status} ${response.statusText}`,
    )
  }

  const result = expectValid(
    A2AJsonRpcResponseSchema,
    await response.json(),
    `A2A ${skillId}`,
  )

  const data = extractA2AData<T>(result, `A2A ${skillId}`)
  const textPart = result.result?.parts?.find((p) => p.kind === 'text')
  const text = textPart?.kind === 'text' ? textPart.text : undefined

  return { data, text }
}

export const autocratA2A = {
  /**
   * Call any skill on the Autocrat A2A server
   */
  call: <T>(
    skillId: string,
    params: A2ASkillParams = {},
    options?: A2ACallOptions,
  ) => callA2A<T>(getAutocratA2AEndpoint(), skillId, params, options),

  // Typed convenience methods for common skills
  getGovernanceStats: () =>
    autocratA2A.call<{
      totalProposals: number
      approvedCount: number
      rejectedCount: number
      pendingCount: number
      avgQualityScore: number
    }>('get-governance-stats'),

  getCEOStatus: () =>
    autocratA2A.call<{
      currentModel?: { name: string; modelId: string }
      decisionsThisPeriod: number
      approvalRate: number
      lastDecision?: { proposalId: string; approved: boolean }
    }>('get-ceo-status'),

  getAutocratStatus: () =>
    autocratA2A.call<{
      roles: Array<{ id: string; name: string; role: string }>
      totalMembers: number
    }>('get-autocrat-status'),

  listProposals: (activeOnly = false) =>
    autocratA2A.call<{
      proposals: Array<{
        id: string
        status: string
        proposer: string
        proposalType: number
        qualityScore: number
        autocratVoteEnd: number
        gracePeriodEnd: number
        hasResearch: boolean
        contentHash: string
      }>
      total: number
    }>('list-proposals', { activeOnly }),

  getProposal: (proposalId: string) =>
    autocratA2A.call<{
      id: string
      status: string
      proposer: string
      proposalType: number
      qualityScore: number
      contentHash: string
      hasResearch: boolean
      researchHash?: string
      autocratVoteEnd: number
      gracePeriodEnd: number
    }>('get-proposal', { proposalId }),

  getAutocratVotes: (proposalId: string) =>
    autocratA2A.call<{
      votes: Array<{
        role: string
        vote: string
        reasoning: string
        confidence: number
        timestamp?: number
      }>
    }>('get-autocrat-votes', { proposalId }),

  getResearch: (proposalId: string) =>
    autocratA2A.call<{
      report?: string
      status?: string
      completedAt?: number
    }>('get-research', { proposalId }),

  submitVote: (params: {
    proposalId: string
    role: string
    vote: 'APPROVE' | 'REJECT' | 'ABSTAIN'
    reasoning: string
    confidence: number
  }) => autocratA2A.call<{ success: boolean }>('submit-vote', params),

  requestResearch: (proposalId: string, description?: string) =>
    autocratA2A.call<{ status: string }>('request-research', {
      proposalId,
      description,
    }),
}

export const ceoA2A = {
  /**
   * Call any skill on the CEO A2A server
   */
  call: <T>(
    skillId: string,
    params: A2ASkillParams = {},
    options?: A2ACallOptions,
  ) => callA2A<T>(getCEOA2AEndpoint(), skillId, params, options),

  // Typed convenience methods
  makeDecision: (params: {
    proposalId: string
    autocratVotes: Array<{ role: string; vote: string; reasoning: string }>
  }) =>
    ceoA2A.call<{
      approved: boolean
      reasoning: string
      confidence: number
      alignment: number
      recommendations: string[]
      attestation?: { provider: string; verified: boolean }
    }>('make-decision', params),

  getDashboard: () =>
    ceoA2A.call<{
      totalProposals: number
      approvedCount: number
      rejectedCount: number
      pendingCount: number
      treasury?: { balance: string }
    }>('get-dashboard'),

  getActiveProposals: () =>
    ceoA2A.call<{
      proposals: Array<{ id: string; status: string; qualityScore: number }>
      total: number
    }>('get-active-proposals'),

  chat: (message: string) =>
    ceoA2A.call<Record<string, unknown>>('chat', { message }),
}

export const autocratMCP = {
  getTools: async () => {
    const response = await fetch(`${getAutocratMCPEndpoint()}/tools`)
    if (!response.ok) return { tools: [] }
    return response.json() as Promise<{
      tools: Array<{ name: string; description: string }>
    }>
  },

  callTool: async (name: string, args: Record<string, string> = {}) => {
    const response = await fetch(`${getAutocratMCPEndpoint()}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: { name, arguments: args } }),
    })
    if (!response.ok) {
      throw new Error(`MCP tool call failed: ${response.status}`)
    }
    return response.json() as Promise<{
      content?: Array<{ type?: string; text?: string }>
    }>
  },
}

export const ceoMCP = {
  getTools: async () => {
    const response = await fetch(`${getCEOMCPEndpoint()}/tools`)
    if (!response.ok) return { tools: [] }
    return response.json() as Promise<{
      tools: Array<{ name: string; description: string }>
    }>
  },

  callTool: async (name: string, args: Record<string, string> = {}) => {
    const response = await fetch(`${getCEOMCPEndpoint()}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: { name, arguments: args } }),
    })
    if (!response.ok) {
      throw new Error(`CEO MCP tool call failed: ${response.status}`)
    }
    return response.json() as Promise<{
      content?: Array<{ type?: string; text?: string }>
    }>
  },
}

export async function fetchAgentCard(baseUrl: string): Promise<{
  name?: string
  description?: string
  skills?: Array<{ id: string; name?: string; description?: string }>
} | null> {
  const cardUrl = `${baseUrl.replace('/a2a', '')}/.well-known/agent-card.json`
  const response = await fetch(cardUrl).catch(() => null)
  if (!response?.ok) return null
  return response.json().catch(() => null)
}

export async function checkA2AHealth(endpoint: string): Promise<boolean> {
  const healthUrl = endpoint.replace('/a2a', '/health')
  const response = await fetch(healthUrl, {
    signal: AbortSignal.timeout(2000),
  }).catch(() => null)
  return response?.ok ?? false
}

export async function checkMCPHealth(endpoint: string): Promise<boolean> {
  const healthUrl = endpoint.replace('/mcp', '/health')
  const response = await fetch(healthUrl, {
    signal: AbortSignal.timeout(2000),
  }).catch(() => null)
  return response?.ok ?? false
}

export const healthChecks = {
  autocratA2A: () => checkA2AHealth(getAutocratA2AEndpoint()),
  ceoA2A: () => checkA2AHealth(getCEOA2AEndpoint()),
  autocratMCP: () => checkMCPHealth(getAutocratMCPEndpoint()),
  ceoMCP: () => checkMCPHealth(getCEOMCPEndpoint()),
}
