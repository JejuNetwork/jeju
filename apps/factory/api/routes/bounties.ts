import { Elysia } from 'elysia'
import type { Address } from 'viem'
import {
  type BountyRow,
  createBounty as dbCreateBounty,
  getBountyStats as dbGetBountyStats,
  listBounties as dbListBounties,
  getBounty,
} from '../db/client'
import {
  BountiesQuerySchema,
  BountyIdParamSchema,
  CreateBountyBodySchema,
  expectValid,
  MilestonesSchema,
  SkillsSchema,
} from '../schemas'
import { requireAuth } from '../validation/access-control'

export interface Milestone {
  name: string
  description: string
  reward: string
  currency: string
  deadline: number
}

export interface Bounty {
  id: string
  title: string
  description: string
  reward: string
  currency: string
  status: 'open' | 'in_progress' | 'review' | 'completed' | 'cancelled'
  skills: string[]
  creator: Address
  deadline: number
  milestones?: Milestone[]
  submissions: number
  createdAt: number
  updatedAt: number
}

function transformBounty(row: BountyRow): Bounty {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    reward: row.reward,
    currency: row.currency,
    status: row.status,
    skills: SkillsSchema.parse(JSON.parse(row.skills)),
    creator: row.creator as Address,
    deadline: row.deadline,
    milestones: row.milestones
      ? MilestonesSchema.parse(JSON.parse(row.milestones))
      : undefined,
    submissions: row.submissions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const bountiesRoutes = new Elysia({ prefix: '/api/bounties' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(BountiesQuerySchema, query, 'query params')
      const page = parseInt(validated.page ?? '1', 10)
      const limit = parseInt(validated.limit ?? '20', 10)

      const result = dbListBounties({
        status: validated.status,
        skill: validated.skill,
        search: validated.q,
        page,
        limit,
      })

      const bounties = result.bounties.map(transformBounty)

      return {
        bounties,
        total: result.total,
        page,
        limit,
        hasMore: page * limit < result.total,
      }
    },
    {
      detail: {
        tags: ['bounties'],
        summary: 'List bounties',
        description: 'Get a list of all bounties with optional filtering',
      },
    },
  )
  .get(
    '/stats',
    () => {
      const stats = dbGetBountyStats()
      return {
        openBounties: stats.openBounties,
        totalValue: `${stats.totalValue.toFixed(2)} ETH`,
        completed: stats.completed,
        avgPayout: `${stats.avgPayout.toFixed(2)} ETH`,
      }
    },
    {
      detail: {
        tags: ['bounties'],
        summary: 'Get bounty stats',
        description: 'Get aggregated bounty statistics',
      },
    },
  )
  .post(
    '/',
    async ({ body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      const validated = expectValid(
        CreateBountyBodySchema,
        body,
        'request body',
      )

      const row = dbCreateBounty({
        title: validated.title,
        description: validated.description,
        reward: validated.reward,
        currency: validated.currency,
        skills: validated.skills,
        deadline: validated.deadline,
        milestones: validated.milestones,
        creator: authResult.address,
      })

      set.status = 201
      return transformBounty(row)
    },
    {
      detail: {
        tags: ['bounties'],
        summary: 'Create bounty',
        description: 'Create a new bounty (requires authentication)',
      },
    },
  )
  .get(
    '/:id',
    async ({ params, set }) => {
      const validated = expectValid(BountyIdParamSchema, params, 'params')
      const row = getBounty(validated.id)
      if (!row) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Bounty ${validated.id} not found`,
          },
        }
      }
      return transformBounty(row)
    },
    {
      detail: {
        tags: ['bounties'],
        summary: 'Get bounty',
        description: 'Get details of a specific bounty',
      },
    },
  )
