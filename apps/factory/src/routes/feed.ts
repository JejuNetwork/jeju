/**
 * Developer Feed Routes (Farcaster Integration)
 */

import { Elysia, t } from 'elysia'
import { farcasterClient } from '../services/farcaster'

export const feedRoutes = new Elysia({ prefix: '/api/feed' })
  .get(
    '/',
    async ({ query }) => {
      const feed = await farcasterClient.getChannelFeed(
        query.channel ?? undefined,
        {
          cursor: query.cursor ?? undefined,
          limit: parseInt(query.limit || '20', 10),
        },
      )
      return feed
    },
    {
      query: t.Object({
        channel: t.Optional(t.String()),
        cursor: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
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

      const cast = await farcasterClient.publishCast(signerUuid, body.text, {
        embeds: body.embeds,
        parentHash: body.parentHash,
        channelId: body.channelId,
      })

      set.status = 201
      return cast
    },
    {
      body: t.Object({
        text: t.String({ minLength: 1, maxLength: 320 }),
        embeds: t.Optional(t.Array(t.Object({ url: t.String() }))),
        parentHash: t.Optional(t.String()),
        channelId: t.Optional(t.String()),
      }),
      detail: {
        tags: ['feed'],
        summary: 'Post to feed',
        description: 'Create a new post (cast) on the feed',
      },
    },
  )
