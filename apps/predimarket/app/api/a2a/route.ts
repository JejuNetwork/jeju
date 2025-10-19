/**
 * A2A (Agent-to-Agent) JSON-RPC endpoint for Predimarket
 * Enables autonomous agents to discover and interact with prediction markets
 */

import { NextRequest, NextResponse } from 'next/server';

// CORS headers for A2A cross-origin requests
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

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
  const indexerUrl = process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:4350/graphql';

  switch (skillId) {
    case 'list-markets': {
      const query = `
        query GetMarkets {
          predimarkets(limit: 20, orderBy: createdAt_DESC) {
            id
            sessionId
            question
            yesOdds
            noOdds
            totalVolume
            resolved
            outcome
          }
        }
      `;

      const response = await fetch(indexerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      const result = await response.json();
      const markets = result.data?.predimarkets || [];

      return {
        message: `Found ${markets.length} prediction markets`,
        data: { markets },
      };
    }

    case 'get-market-odds': {
      return {
        message: 'Market odds query requires market ID parameter',
        data: { note: 'Provide sessionId in request data' },
      };
    }

    case 'list-user-positions': {
      return {
        message: 'User positions query requires address parameter',
        data: { note: 'Provide userAddress in request data' },
      };
    }

    default:
      return {
        message: 'Unknown skill',
        data: { error: 'Skill not found' },
      };
  }
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


