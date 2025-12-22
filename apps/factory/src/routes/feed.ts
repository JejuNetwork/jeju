/**
 * Developer Feed Routes (Farcaster Integration)
 */

import { Elysia } from 'elysia'
import { CreateCastBodySchema, expectValid, FeedQuerySchema } from '../schemas'
import { farcasterClient } from '../services/farcaster'

export const feedRoutes = new Elysia({ prefix: '/api/feed' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(FeedQuerySchema, query, 'query params')
      const feed = await farcasterClient.getChannelFeed(
        validated.channel ?? undefined,
        {
          cursor: validated.cursor ?? undefined,
          limit: parseInt(validated.limit || '20', 10),
        },
      )
      return feed
    },
    {
      detail: {
        tags: ['feed'],
        summary: 'Get feed',
        description: 'Get the developer feed from Farcaster',
      },
    },
  )
  .post(
    '/',
    async ({ body, headers, set }) => {
      const signerUuid = headers['x-farcaster-signer']
      if (!signerUuid) {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Farcaster signer required' },
        }
      }

      const validated = expectValid(CreateCastBodySchema, body, 'request body')

      const cast = await farcasterClient.publishCast(
        signerUuid,
        validated.text,
        {
          embeds: validated.embeds,
          parentHash: validated.parentHash,
          channelId: validated.channelId,
        },
      )

      set.status = 201
      return cast
    },
    {
      detail: {
        tags: ['feed'],
        summary: 'Post to feed',
        description: 'Create a new post (cast) on the feed',
      },
    },
  )
