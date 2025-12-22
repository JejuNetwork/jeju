/**
 * Moderation Routes
 */

import { Elysia, t } from 'elysia'
import { type FlagType, getModerationSystem } from '../moderation'

const moderation = getModerationSystem()

export const moderationRoutes = new Elysia({ prefix: '/api/v1/moderation' })
  .post(
    '/flag',
    async ({ body }) => {
      // Join evidence array into comma-separated string if provided
      const evidenceStr = body.evidence?.join(',')
      const flag = moderation.submitFlag(
        body.proposalId,
        body.flagger,
        body.flagType as FlagType,
        body.reason,
        body.stake ?? 10,
        evidenceStr,
      )
      return flag
    },
    {
      body: t.Object({
        proposalId: t.String(),
        flagger: t.String(),
        flagType: t.String(),
        reason: t.String(),
        stake: t.Optional(t.Number()),
        evidence: t.Optional(t.Array(t.String())),
      }),
      detail: { tags: ['moderation'], summary: 'Submit moderation flag' },
    },
  )
  .post(
    '/vote',
    async ({ body }) => {
      moderation.voteOnFlag(body.flagId, body.voter, body.upvote)
      return { success: true }
    },
    {
      body: t.Object({
        flagId: t.String(),
        voter: t.String(),
        upvote: t.Boolean(),
      }),
      detail: { tags: ['moderation'], summary: 'Vote on flag' },
    },
  )
  .post(
    '/resolve',
    async ({ body }) => {
      moderation.resolveFlag(body.flagId, body.upheld)
      return { success: true }
    },
    {
      body: t.Object({
        flagId: t.String(),
        upheld: t.Boolean(),
      }),
      detail: { tags: ['moderation'], summary: 'Resolve flag' },
    },
  )
  .get(
    '/score/:proposalId',
    ({ params }) => {
      const score = moderation.getProposalModerationScore(params.proposalId)
      return score
    },
    {
      params: t.Object({ proposalId: t.String() }),
      detail: {
        tags: ['moderation'],
        summary: 'Get proposal moderation score',
      },
    },
  )
  .get(
    '/flags/:proposalId',
    ({ params }) => {
      const flags = moderation.getProposalFlags(params.proposalId)
      return { flags }
    },
    {
      params: t.Object({ proposalId: t.String() }),
      detail: { tags: ['moderation'], summary: 'Get flags for proposal' },
    },
  )
  .get(
    '/active-flags',
    () => {
      const flags = moderation.getActiveFlags()
      return { flags }
    },
    {
      detail: { tags: ['moderation'], summary: 'Get all active flags' },
    },
  )
  .get(
    '/leaderboard',
    ({ query }) => {
      const limit = parseInt(query.limit ?? '10', 10)
      const moderators = moderation.getTopModerators(limit)
      return { moderators }
    },
    {
      query: t.Object({ limit: t.Optional(t.String()) }),
      detail: { tags: ['moderation'], summary: 'Get moderator leaderboard' },
    },
  )
  .get(
    '/moderator/:address',
    ({ params }) => {
      const stats = moderation.getModeratorStats(
        params.address as `0x${string}`,
      )
      return stats
    },
    {
      params: t.Object({ address: t.String() }),
      detail: { tags: ['moderation'], summary: 'Get moderator stats' },
    },
  )
  .get(
    '/should-reject/:proposalId',
    ({ params }) => {
      const result = moderation.shouldAutoReject(params.proposalId)
      return result
    },
    {
      params: t.Object({ proposalId: t.String() }),
      detail: {
        tags: ['moderation'],
        summary: 'Check if proposal should be auto-rejected',
      },
    },
  )
