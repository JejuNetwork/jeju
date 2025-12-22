/**
 * Proposal Routes
 */

import { Elysia, t } from 'elysia'
import { getProposalAssistant, type ProposalDraft } from '../proposal-assistant'
import { blockchain, config } from '../server'
import type { CasualProposalCategory, ProposalType } from '../types'

const proposalAssistant = getProposalAssistant()

function toProposalDraft(raw: {
  daoId: string
  title: string
  summary: string
  description: string
  proposalType: ProposalType
  casualCategory?: string
  targetContract?: `0x${string}`
  calldata?: `0x${string}`
  value?: string
  tags?: string[]
  linkedPackageId?: string
  linkedRepoId?: string
}): ProposalDraft {
  return {
    daoId: raw.daoId,
    title: raw.title,
    summary: raw.summary,
    description: raw.description,
    proposalType: raw.proposalType,
    casualCategory: raw.casualCategory as CasualProposalCategory | undefined,
    targetContract: raw.targetContract,
    callData: raw.calldata,
    value: raw.value,
    tags: raw.tags,
    linkedPackageId: raw.linkedPackageId,
    linkedRepoId: raw.linkedRepoId,
  }
}

// A2A internal call helper
async function callA2AInternal(
  skillId: string,
  params: Record<string, unknown> = {},
) {
  // Import the A2A server to make internal calls
  const { createAutocratA2AServer } = await import('../a2a-server')
  const a2aServer = createAutocratA2AServer(config, blockchain)

  const response = await a2aServer.getRouter().fetch(
    new Request('http://localhost/a2a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            messageId: `rest-${Date.now()}`,
            parts: [{ kind: 'data', data: { skillId, params } }],
          },
        },
      }),
    }),
  )
  const result = (await response.json()) as {
    result?: { parts?: Array<{ kind: string; data?: Record<string, unknown> }> }
    error?: { message: string }
  }
  if (result.error) {
    throw new Error(`A2A call failed: ${result.error.message}`)
  }
  const parts = result.result?.parts
  const dataPart = parts?.find((p) => p.kind === 'data')
  return dataPart?.data ?? {}
}

export const proposalsRoutes = new Elysia({ prefix: '/api/v1/proposals' })
  .get(
    '/',
    async ({ query }) => {
      const activeOnly = query.active === 'true'
      return callA2AInternal('list-proposals', { activeOnly })
    },
    {
      query: t.Object({
        active: t.Optional(t.String()),
      }),
      detail: { tags: ['proposals'], summary: 'List proposals' },
    },
  )
  .get(
    '/:id',
    async ({ params }) => {
      return callA2AInternal('get-proposal', { proposalId: params.id })
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['proposals'], summary: 'Get proposal by ID' },
    },
  )
  .post(
    '/assess',
    async ({ body }) => {
      const draft = toProposalDraft(body)
      const assessment = await proposalAssistant.assessQuality(draft)
      return assessment
    },
    {
      body: t.Object({
        daoId: t.String(),
        title: t.String(),
        summary: t.String(),
        description: t.String(),
        proposalType: t.Number(),
        casualCategory: t.Optional(t.String()),
        targetContract: t.Optional(t.String()),
        calldata: t.Optional(t.String()),
        value: t.Optional(t.String()),
        tags: t.Optional(t.Array(t.String())),
        linkedPackageId: t.Optional(t.String()),
        linkedRepoId: t.Optional(t.String()),
      }),
      detail: { tags: ['proposals'], summary: 'Assess proposal quality' },
    },
  )
  .post(
    '/check-duplicates',
    async ({ body }) => {
      const draft = toProposalDraft(body)
      const duplicates = await proposalAssistant.checkDuplicates(draft)
      return { duplicates }
    },
    {
      body: t.Object({
        daoId: t.String(),
        title: t.String(),
        summary: t.String(),
        description: t.String(),
        proposalType: t.Number(),
      }),
      detail: { tags: ['proposals'], summary: 'Check for duplicate proposals' },
    },
  )
  .post(
    '/improve',
    async ({ body }) => {
      const draft = toProposalDraft(body.draft)
      const improved = await proposalAssistant.improveProposal(
        draft,
        body.criterion,
      )
      return { improved }
    },
    {
      body: t.Object({
        draft: t.Object({
          daoId: t.String(),
          title: t.String(),
          summary: t.String(),
          description: t.String(),
          proposalType: t.Number(),
        }),
        criterion: t.String(),
      }),
      detail: {
        tags: ['proposals'],
        summary: 'Improve proposal based on criterion',
      },
    },
  )
  .post(
    '/generate',
    async ({ body }) => {
      const draft = await proposalAssistant.generateProposal(
        body.idea,
        body.proposalType ?? 0,
      )
      return draft
    },
    {
      body: t.Object({
        idea: t.String(),
        proposalType: t.Optional(t.Number()),
      }),
      detail: { tags: ['proposals'], summary: 'Generate proposal from idea' },
    },
  )
  .post(
    '/quick-score',
    async ({ body }) => {
      const draft = toProposalDraft(body)
      const score = proposalAssistant.quickScore(draft)
      const contentHash = proposalAssistant.getContentHash(draft)
      return {
        score,
        contentHash,
        readyForFullAssessment: score >= 60,
      }
    },
    {
      body: t.Object({
        daoId: t.String(),
        title: t.String(),
        summary: t.String(),
        description: t.String(),
        proposalType: t.Number(),
      }),
      detail: { tags: ['proposals'], summary: 'Quick score a proposal' },
    },
  )
