/**
 * A2A (Agent-to-Agent) JSON-RPC endpoint for Bazaar
 * Enables autonomous agents to discover and interact with the marketplace
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJejuTokens, getLatestBlocks } from '@/lib/indexer-client';

// CORS headers for A2A cross-origin requests
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

interface A2ARequest {
  jsonrpc: string;
  method: string;
  params?: {
    message?: {
      messageId: string;
      parts: Array<{
        kind: string;
        text?: string;
        data?: Record<string, string>;
      }>;
    };
  };
  id: number | string;
}

interface A2AResponse {
  jsonrpc: string;
  id: number | string;
  result?: {
    role: string;
    parts: Array<{
      kind: string;
      text?: string;
      data?: Record<string, unknown>;
    }>;
    messageId: string;
    kind: string;
  };
  error?: {
    code: number;
    message: string;
  };
}

async function executeSkill(skillId: string): Promise<{ message: string; data: Record<string, unknown> }> {
  switch (skillId) {
    case 'list-tokens': {
      const tokens = await getJejuTokens({ limit: 50 });
      return {
        message: `Found ${tokens.length} tokens on Jeju`,
        data: {
          tokens: tokens.map((t) => ({
            address: t.address,
            creator: t.creator.address,
            firstSeen: t.firstSeenAt,
          })),
        },
      };
    }

    case 'get-latest-blocks': {
      const blocks = await getLatestBlocks(10);
      return {
        message: `Latest ${blocks.length} blocks`,
        data: {
          blocks: blocks.map((b) => ({
            number: b.number,
            hash: b.hash,
            timestamp: b.timestamp,
            txCount: b.transactionCount,
          })),
        },
      };
    }

    case 'list-nfts': {
      return {
        message: 'NFT marketplace feature coming soon',
        data: {
          nfts: [],
          note: 'NFT indexing not yet implemented',
        },
      };
    }

    case 'get-pool-info': {
      return {
        message: 'Pool information coming soon',
        data: {
          pools: [],
          note: 'Pool data not yet available',
        },
      };
    }

    default:
      return {
        message: 'Unknown skill',
        data: { error: 'Skill not found' },
      };
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function POST(request: NextRequest): Promise<NextResponse<A2AResponse>> {
  const body: A2ARequest = await request.json();

  if (body.method !== 'message/send') {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32601, message: 'Method not found' },
    }, { headers: CORS_HEADERS });
  }

  const message = body.params?.message;
  if (!message || !message.parts) {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'Invalid params' },
    });
  }

  const dataPart = message.parts.find((p) => p.kind === 'data');
  if (!dataPart || !dataPart.data) {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'No data part found' },
    });
  }

  const skillId = dataPart.data.skillId;
  if (!skillId) {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'No skillId specified' },
    });
  }

  const result = await executeSkill(skillId);

  return NextResponse.json({
    jsonrpc: '2.0',
    id: body.id,
    result: {
      role: 'agent',
      parts: [
        { kind: 'text', text: result.message },
        { kind: 'data', data: result.data },
      ],
      messageId: message.messageId,
      kind: 'message',
    },
  }, { headers: CORS_HEADERS });
}


