import { type NextRequest, NextResponse } from 'next/server'
import { farcasterClient } from '@/lib/services/farcaster'
import { errorResponse, validateBody, validateQuery } from '@/lib/validation'
import {
  createFeedPostSchema,
  getFeedQuerySchema,
} from '@/lib/validation/schemas'

// GET /api/feed - Get feed posts
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const query = validateQuery(getFeedQuerySchema, searchParams)

    const feed = await farcasterClient.getChannelFeed(
      query.channel ?? undefined,
      {
        cursor: query.cursor ?? undefined,
        limit: query.limit,
      },
    )
    return NextResponse.json(feed)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return errorResponse(message, 400)
  }
}

// POST /api/feed - Create a new post (cast)
export async function POST(request: NextRequest) {
  try {
    const body = await validateBody(createFeedPostSchema, request.json())

    const signerUuid = request.headers.get('x-farcaster-signer')
    if (!signerUuid) {
      return errorResponse('Farcaster signer required', 401)
    }

    const cast = await farcasterClient.publishCast(signerUuid, body.text, {
      embeds: body.embeds,
      parentHash: body.parentHash,
      channelId: body.channelId,
    })

    return NextResponse.json(cast, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    const status = message.includes('required') ? 401 : 400
    return errorResponse(message, status)
  }
}
