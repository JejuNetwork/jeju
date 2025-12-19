import { NextRequest, NextResponse } from 'next/server';
import { farcasterClient } from '@/lib/services/farcaster';

// GET /api/feed - Get feed posts
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const channel = searchParams.get('channel');
  const cursor = searchParams.get('cursor');
  const limit = parseInt(searchParams.get('limit') || '20');

  const feed = await farcasterClient.getChannelFeed(channel || undefined, { cursor: cursor || undefined, limit });
  return NextResponse.json(feed);
}

// POST /api/feed - Create a new post (cast)
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { text, embeds, parentHash, channelId } = body;

  const signerUuid = request.headers.get('x-farcaster-signer');
  if (!signerUuid) {
    return NextResponse.json({ error: 'Farcaster signer required' }, { status: 401 });
  }

  const cast = await farcasterClient.publishCast(signerUuid, text, {
    embeds,
    parent: parentHash,
    channelId,
  });

  return NextResponse.json(cast, { status: 201 });
}

