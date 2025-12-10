/**
 * MCP Resources Read Endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJejuTokens, getLatestBlocks } from '@/lib/indexer-client';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function readResource(uri: string): Promise<unknown | null> {
  switch (uri) {
    case 'bazaar://tokens': {
      const tokens = await getJejuTokens({ limit: 50 });
      return {
        tokens: tokens.map((t) => ({
          address: t.address,
          creator: t.creator.address,
          isERC20: t.isERC20,
        })),
      };
    }

    case 'bazaar://blocks': {
      const blocks = await getLatestBlocks(10);
      return {
        blocks: blocks.map((b) => ({
          number: b.number,
          hash: b.hash,
          timestamp: b.timestamp,
        })),
      };
    }

    case 'bazaar://pools':
      return { pools: [], note: 'Query Uniswap V4 for pool data' };

    case 'bazaar://nfts':
      return { nfts: [], note: 'NFT indexing coming soon' };

    default:
      return null;
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { uri } = body;

  if (!uri) {
    return NextResponse.json(
      { error: { code: -32602, message: 'Missing required parameter: uri' } },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const contents = await readResource(uri);

  if (contents === null) {
    return NextResponse.json(
      { error: `Resource not found: ${uri}` },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json({
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(contents, null, 2),
    }],
  }, { headers: CORS_HEADERS });
}
