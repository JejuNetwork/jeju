import { Elysia, t } from 'elysia'
import { toAddress } from '../../lib'
import { expectFlagType, getModerationSystem } from '../moderation'

const moderation = getModerationSystem()

export const moderationRoutes = new Elysia({ prefix: '/api/v1/moderation' })
  .post(
    '/flag',
    async ({ body }) => {
      // Join evidence array into comma-separated string if provided
      const evidenceStr = body.evidence?.join(',')
      const flag = await moderation.submitFlag(
        body.proposalId,
        body.flagger,
        expectFlagType(body.flagType),
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
      await moderation.voteOnFlag(body.flagId, body.voter, body.upvote)
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
      await moderation.resolveFlag(body.flagId, body.upheld)
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
    async ({ params }) => {
      const score = await moderation.getProposalModerationScore(
        params.proposalId,
      )
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
    async ({ params }) => {
      const flags = await moderation.getProposalFlags(params.proposalId)
      return { flags }
    },
    {
      params: t.Object({ proposalId: t.String() }),
      detail: { tags: ['moderation'], summary: 'Get flags for proposal' },
    },
  )
  .get(
    '/active-flags',
    async () => {
      const flags = await moderation.getActiveFlags()
      return { flags }
    },
    {
      detail: { tags: ['moderation'], summary: 'Get all active flags' },
    },
  )
  .get(
    '/leaderboard',
    async ({ query }) => {
      const limit = parseInt(query.limit ?? '10', 10)
      const moderators = await moderation.getTopModerators(limit)
      return { moderators }
    },
    {
      query: t.Object({ limit: t.Optional(t.String()) }),
      detail: { tags: ['moderation'], summary: 'Get moderator leaderboard' },
    },
  )
  .get(
    '/moderator/:address',
    async ({ params }) => {
      const stats = await moderation.getModeratorStats(
        toAddress(params.address),
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
    async ({ params }) => {
      const result = await moderation.shouldAutoReject(params.proposalId)
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
