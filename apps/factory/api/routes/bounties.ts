/** Bounties Routes */

import { Elysia } from 'elysia'
import type { Address } from 'viem'
import {
  BountiesQuerySchema,
  BountyIdParamSchema,
  CreateBountyBodySchema,
  expectValid,
} from '../schemas'
import { requireAuth } from '../validation/access-control'

interface Bounty {
  id: string
  title: string
  description: string
  reward: string
  currency: string
  status: 'open' | 'in_progress' | 'review' | 'completed' | 'cancelled'
  skills: string[]
  creator: Address
  deadline: number
  milestones?: Array<{
    name: string
    description: string
    reward: string
    currency: string
    deadline: number
  }>
  submissions: number
  createdAt: number
  updatedAt: number
}

export const bountiesRoutes = new Elysia({ prefix: '/api/bounties' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(BountiesQuerySchema, query, 'query params')
      const page = parseInt(validated.page ?? '1', 10)
      const limit = parseInt(validated.limit ?? '20', 10)

      const bounties: Bounty[] = []

      return {
        bounties,
        total: bounties.length,
        page,
        limit,
        hasMore: false,
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

      const bounty: Bounty = {
        id: `bounty-${Date.now()}`,
        title: validated.title,
        description: validated.description,
        reward: validated.reward,
        currency: validated.currency,
        skills: validated.skills,
        deadline: validated.deadline,
        milestones: validated.milestones,
        status: 'open',
        creator: authResult.address,
        submissions: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      set.status = 201
      return bounty
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
      set.status = 404
      return {
        error: {
          code: 'NOT_FOUND',
          message: `Bounty ${validated.id} not found`,
        },
      }
    },
    {
      detail: {
        tags: ['bounties'],
        summary: 'Get bounty',
        description: 'Get details of a specific bounty',
      },
    },
  )
