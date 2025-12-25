/** Leaderboard Routes */

import { Elysia } from 'elysia'
import {
  getLeaderboard as dbGetLeaderboard,
  getLeaderboardEntry,
  type LeaderboardRow,
} from '../db/client'
import { expectValid, LeaderboardQuerySchema } from '../schemas'

export interface LeaderboardEntry {
  address: string
  name: string
  avatar: string
  score: number
  rank: number
  contributions: number
  bounties: number
  tier: 'bronze' | 'silver' | 'gold' | 'diamond'
}

function transformLeaderboardEntry(
  row: LeaderboardRow,
  rank: number,
): LeaderboardEntry {
  return {
    address: row.address,
    name: row.name,
    avatar: row.avatar,
    score: row.score,
    rank,
    contributions: row.contributions,
    bounties: row.bounties_completed,
    tier: row.tier,
  }
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

      const rows = dbGetLeaderboard(limit)
      const entries = rows.map((row, index) =>
        transformLeaderboardEntry(row, index + 1),
      )

      return { entries, total: entries.length }
    },
    { detail: { tags: ['leaderboard'], summary: 'Get leaderboard' } },
  )
  .get(
    '/user/:address',
    async ({ params }) => {
      const row = getLeaderboardEntry(params.address)

      if (!row) {
        // Return default entry for non-ranked users
        return {
          address: params.address,
          name: `${params.address.slice(0, 6)}...${params.address.slice(-4)}`,
          avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${params.address}`,
          score: 0,
          rank: 0,
          contributions: 0,
          bounties: 0,
          tier: 'bronze' as const,
        }
      }

      // Calculate rank by counting users with higher scores
      const allRows = dbGetLeaderboard(1000)
      const rank = allRows.findIndex((r) => r.address === params.address) + 1

      return transformLeaderboardEntry(row, rank || 0)
    },
    {
      detail: { tags: ['leaderboard'], summary: 'Get user leaderboard entry' },
    },
  )
