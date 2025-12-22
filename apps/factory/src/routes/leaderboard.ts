/**
 * Leaderboard Routes
 */

import { Elysia } from 'elysia'

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
      const limit = Number.parseInt(
        (query as { limit?: string }).limit || '50',
        10,
      )
      const entries: LeaderboardEntry[] = [
        {
          address: '0x1234567890123456789012345678901234567890',
          name: 'alice.eth',
          avatar: 'https://avatars.githubusercontent.com/u/1?v=4',
          score: 15000,
          rank: 1,
          contributions: 234,
          bounties: 12,
          tier: 'diamond',
        },
        {
          address: '0x2345678901234567890123456789012345678901',
          name: 'bob.eth',
          avatar: 'https://avatars.githubusercontent.com/u/2?v=4',
          score: 8500,
          rank: 2,
          contributions: 156,
          bounties: 8,
          tier: 'gold',
        },
      ]
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
        score: Math.floor(Math.random() * 10000),
        rank: Math.floor(Math.random() * 100) + 1,
        contributions: Math.floor(Math.random() * 100),
        bounties: Math.floor(Math.random() * 10),
        tier: 'silver',
      }
      return entry
    },
    {
      detail: { tags: ['leaderboard'], summary: 'Get user leaderboard entry' },
    },
  )
