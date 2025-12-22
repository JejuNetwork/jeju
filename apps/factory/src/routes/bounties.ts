/**
 * Bounties Routes
 */

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
      const page = parseInt(validated.page || '1', 10)
      const limit = parseInt(validated.limit || '20', 10)

      const bounties: Bounty[] = [
        {
          id: '1',
          title: 'Implement ERC-4337 Account Abstraction',
          description: 'Create a smart contract wallet with ERC-4337 support',
          reward: '5000',
          currency: 'USDC',
          status: 'open',
          skills: ['Solidity', 'ERC-4337', 'Smart Contracts'],
          creator: '0x1234567890123456789012345678901234567890' as Address,
          deadline: Date.now() + 7 * 24 * 60 * 60 * 1000,
          submissions: 3,
          createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
          updatedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
        },
        {
          id: '2',
          title: 'Build React Dashboard Component',
          description: 'Create a reusable analytics dashboard with charts',
          reward: '2500',
          currency: 'USDC',
          status: 'in_progress',
          skills: ['React', 'TypeScript', 'D3.js'],
          creator: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address,
          deadline: Date.now() + 14 * 24 * 60 * 60 * 1000,
          submissions: 1,
          createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
          updatedAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
        },
      ]

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
    async ({ params }) => {
      const validated = expectValid(BountyIdParamSchema, params, 'params')
      const bounty: Bounty = {
        id: validated.id,
        title: 'Example Bounty',
        description: 'This is an example bounty',
        reward: '1000',
        currency: 'USDC',
        status: 'open',
        skills: ['TypeScript', 'React'],
        creator: '0x1234567890123456789012345678901234567890' as Address,
        deadline: Date.now() + 7 * 24 * 60 * 60 * 1000,
        submissions: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      return bounty
    },
    {
      detail: {
        tags: ['bounties'],
        summary: 'Get bounty',
        description: 'Get details of a specific bounty',
      },
    },
  )
