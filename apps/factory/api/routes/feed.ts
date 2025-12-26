/**
 * Feed Routes
 *
 * Farcaster feed endpoints for Factory.
 * Supports channel feeds, user feeds, trending, and cast operations.
 */

import { Elysia, t } from 'elysia'
import type { Address, Hex } from 'viem'
import { CreateCastBodySchema, expectValid } from '../schemas'
import * as farcasterService from '../services/farcaster'

// ============================================================================
// SCHEMAS
// ============================================================================

const CastReactionBodySchema = t.Object({
  castHash: t.String({ minLength: 3 }),
  castFid: t.Number({ minimum: 1 }),
})

const FeedTypeQuerySchema = t.Object({
  channel: t.Optional(t.String()),
  feedType: t.Optional(
    t.Union([t.Literal('channel'), t.Literal('trending'), t.Literal('user')]),
  ),
  fid: t.Optional(t.String()),
  cursor: t.Optional(t.String()),
  limit: t.Optional(t.String()),
})

const PaginationQuerySchema = t.Object({
  cursor: t.Optional(t.String()),
  limit: t.Optional(t.String()),
})

// ============================================================================
// HELPERS
// ============================================================================

/** Extract viewer FID from authorization header */
function getViewerFid(
  headers: Record<string, string | undefined>,
): number | undefined {
  const authHeader = headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return undefined

  const address = authHeader.slice(7) as Address
  const link = farcasterService.getLinkedFid(address)
  return link?.fid
}

/** Parse pagination params from query */
function getPagination(query: { cursor?: string; limit?: string }) {
  return {
    limit: query.limit ? parseInt(query.limit, 10) : 20,
    cursor: query.cursor,
  }
}

/** Require wallet address from headers, throw 401 if missing */
function requireWalletAddress(
  headers: Record<string, string | undefined>,
): Address {
  const address = headers['x-wallet-address'] as Address | undefined
  if (!address) {
    throw new Error('UNAUTHORIZED')
  }
  return address
}

// ============================================================================
// ROUTES
// ============================================================================

export const feedRoutes = new Elysia({ prefix: '/api/feed' })
  // Get feed (channel, trending, or user)
  .get(
    '/',
    async ({ query, headers }) => {
      const channel = query.channel ?? farcasterService.getFactoryChannelId()
      const feedType = query.feedType ?? 'channel'
      const { limit, cursor } = getPagination(query)
      const viewerFid = getViewerFid(headers)

      if (feedType === 'trending') {
        if (!farcasterService.isNeynarConfigured()) {
          return { casts: [], cursor: undefined }
        }
        return farcasterService.getTrendingFeed({ limit, cursor, viewerFid })
      }

      if (feedType === 'user' && query.fid) {
        return farcasterService.getUserFeed(parseInt(query.fid, 10), {
          limit,
          cursor,
          viewerFid,
        })
      }

      return farcasterService.getChannelFeed(channel, {
        limit,
        cursor,
        viewerFid,
      })
    },
    {
      query: FeedTypeQuerySchema,
      detail: {
        tags: ['feed'],
        summary: 'Get feed',
        description: 'Get Farcaster feed (channel, trending, or user)',
      },
    },
  )

  // Get channel feed
  .get(
    '/channel/:channelId',
    async ({ params, query, headers }) => {
      const { limit, cursor } = getPagination(query)
      return farcasterService.getChannelFeed(params.channelId, {
        limit,
        cursor,
        viewerFid: getViewerFid(headers),
      })
    },
    {
      query: PaginationQuerySchema,
      detail: {
        tags: ['feed'],
        summary: 'Get channel feed',
        description: 'Get casts from a specific Farcaster channel',
      },
    },
  )

  // Get user feed
  .get(
    '/user/:fid',
    async ({ params, query, headers }) => {
      const { limit, cursor } = getPagination(query)
      return farcasterService.getUserFeed(parseInt(params.fid, 10), {
        limit,
        cursor,
        viewerFid: getViewerFid(headers),
      })
    },
    {
      query: PaginationQuerySchema,
      detail: {
        tags: ['feed'],
        summary: 'Get user feed',
        description: 'Get casts from a specific user',
      },
    },
  )

  // Publish a cast
  .post(
    '/',
    async ({ body, headers, set }) => {
      let address: Address
      try {
        address = requireWalletAddress(headers)
      } catch {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      if (!farcasterService.isFarcasterConnected(address)) {
        set.status = 401
        return {
          error: {
            code: 'NOT_CONNECTED',
            message: 'Please connect your Farcaster account first',
          },
        }
      }

      const validated = expectValid(CreateCastBodySchema, body, 'request body')
      const cast = await farcasterService.publishCast(address, validated.text, {
        channelId: validated.channelId,
        parentHash: validated.parentHash as Hex | undefined,
        embeds: validated.embeds?.map((e) => e.url),
      })

      set.status = 201
      return {
        success: true,
        cast: {
          hash: cast.hash,
          fid: cast.fid,
          text: cast.text,
          timestamp: cast.timestamp,
        },
      }
    },
    {
      detail: {
        tags: ['feed'],
        summary: 'Publish cast',
        description: 'Publish a new cast to Farcaster',
      },
    },
  )

  // Delete a cast
  .delete(
    '/:castHash',
    async ({ params, headers, set }) => {
      let address: Address
      try {
        address = requireWalletAddress(headers)
      } catch {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      await farcasterService.deleteCast(address, params.castHash as Hex)
      return { success: true }
    },
    {
      detail: {
        tags: ['feed'],
        summary: 'Delete cast',
        description: 'Delete a cast you authored',
      },
    },
  )

  // Like a cast
  .post(
    '/like',
    async ({ body, headers, set }) => {
      let address: Address
      try {
        address = requireWalletAddress(headers)
      } catch {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      await farcasterService.likeCast(address, {
        fid: body.castFid,
        hash: body.castHash as Hex,
      })
      return { success: true }
    },
    {
      body: CastReactionBodySchema,
      detail: {
        tags: ['feed'],
        summary: 'Like cast',
        description: 'Like a cast',
      },
    },
  )

  // Unlike a cast
  .delete(
    '/like',
    async ({ body, headers, set }) => {
      let address: Address
      try {
        address = requireWalletAddress(headers)
      } catch {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      await farcasterService.unlikeCast(address, {
        fid: body.castFid,
        hash: body.castHash as Hex,
      })
      return { success: true }
    },
    {
      body: CastReactionBodySchema,
      detail: {
        tags: ['feed'],
        summary: 'Unlike cast',
        description: 'Remove like from a cast',
      },
    },
  )

  // Recast
  .post(
    '/recast',
    async ({ body, headers, set }) => {
      let address: Address
      try {
        address = requireWalletAddress(headers)
      } catch {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      await farcasterService.recastCast(address, {
        fid: body.castFid,
        hash: body.castHash as Hex,
      })
      return { success: true }
    },
    {
      body: CastReactionBodySchema,
      detail: {
        tags: ['feed'],
        summary: 'Recast',
        description: 'Recast a cast',
      },
    },
  )

  // Remove recast
  .delete(
    '/recast',
    async ({ body, headers, set }) => {
      let address: Address
      try {
        address = requireWalletAddress(headers)
      } catch {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      await farcasterService.unrecastCast(address, {
        fid: body.castFid,
        hash: body.castHash as Hex,
      })
      return { success: true }
    },
    {
      body: CastReactionBodySchema,
      detail: {
        tags: ['feed'],
        summary: 'Remove recast',
        description: 'Remove recast from a cast',
      },
    },
  )

  // Get user profile
  .get(
    '/user/:fid/profile',
    async ({ params }) => {
      const user = await farcasterService.getUser(parseInt(params.fid, 10))
      if (!user) {
        return { error: { code: 'NOT_FOUND', message: 'User not found' } }
      }
      return { user }
    },
    {
      detail: {
        tags: ['feed'],
        summary: 'Get user profile',
        description: 'Get Farcaster user profile by FID',
      },
    },
  )

  // Follow a user
  .post(
    '/follow/:fid',
    async ({ params, headers, set }) => {
      let address: Address
      try {
        address = requireWalletAddress(headers)
      } catch {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      await farcasterService.followUser(address, parseInt(params.fid, 10))
      return { success: true }
    },
    {
      detail: {
        tags: ['feed'],
        summary: 'Follow user',
        description: 'Follow a Farcaster user',
      },
    },
  )

  // Unfollow a user
  .delete(
    '/follow/:fid',
    async ({ params, headers, set }) => {
      let address: Address
      try {
        address = requireWalletAddress(headers)
      } catch {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      await farcasterService.unfollowUser(address, parseInt(params.fid, 10))
      return { success: true }
    },
    {
      detail: {
        tags: ['feed'],
        summary: 'Unfollow user',
        description: 'Unfollow a Farcaster user',
      },
    },
  )

  // Check if Neynar is configured
  .get(
    '/status',
    () => ({
      neynarConfigured: farcasterService.isNeynarConfigured(),
      factoryChannelId: farcasterService.getFactoryChannelId(),
    }),
    {
      detail: {
        tags: ['feed'],
        summary: 'Feed status',
        description: 'Get feed service status',
      },
    },
  )
