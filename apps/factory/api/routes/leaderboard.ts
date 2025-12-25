/** Leaderboard Routes */

import { Elysia } from 'elysia'
import { expectValid, LeaderboardQuerySchema } from '../schemas'

interface LeaderboardEntry {
  address: string
  name: string
  avatar: string
  score: number
  rank: number
  contributions: number
  bounties: number
  tier: 'bronze' | 'silver' | 'gold' | 'diamond'
}

export const leaderboardRoutes = new Elysia({ prefix: '/api/leaderboard' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(
        LeaderboardQuerySchema,
        query,
        'query params',
      )
      const limit = Number.parseInt(validated.limit || '50', 10)
      const entries: LeaderboardEntry[] = []
      return { entries: entries.slice(0, limit), total: entries.length }
    },
    { detail: { tags: ['leaderboard'], summary: 'Get leaderboard' } },
  )
  .get(
    '/user/:address',
    async ({ params }) => {
      const entry: LeaderboardEntry = {
        address: params.address,
        name: `${params.address.slice(0, 6)}...${params.address.slice(-4)}`,
        avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${params.address}`,
        score: 0,
        rank: 0,
        contributions: 0,
        bounties: 0,
        tier: 'bronze',
      }
      return entry
    },
    {
      detail: { tags: ['leaderboard'], summary: 'Get user leaderboard entry' },
    },
  )
