/**
 * A2A Server for Leaderboard
 */

import { NextRequest, NextResponse } from 'next/server';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Payment',
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (body.method !== 'message/send') {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32601, message: 'Method not found' }
    }, { headers: CORS_HEADERS });
  }

  const message = body.params?.message;
  if (!message) {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'Invalid params' }
    }, { headers: CORS_HEADERS });
  }

  const dataPart = message.parts.find((p: { kind: string }) => p.kind === 'data');
  const skillId = dataPart?.data?.skillId;

  let result;
  switch (skillId) {
    case 'get-leaderboard':
      result = { message: 'Leaderboard data', data: { contributors: [] } };
      break;
    case 'get-contributor-profile':
      result = { message: 'Contributor profile', data: { profile: {} } };
      break;
    case 'get-repo-stats':
      result = { message: 'Repository stats', data: { stats: {} } };
      break;
    case 'claim-rewards':
      result = { message: 'Rewards claim', data: { amount: '0' } };
      break;
    default:
      result = { message: 'Unknown skill', data: {} };
  }

  return NextResponse.json({
    jsonrpc: '2.0',
    id: body.id,
    result: {
      role: 'agent',
      parts: [{ kind: 'text', text: result.message }, { kind: 'data', data: result.data }],
      messageId: message.messageId,
      kind: 'message'
    }
  }, { headers: CORS_HEADERS });
}

