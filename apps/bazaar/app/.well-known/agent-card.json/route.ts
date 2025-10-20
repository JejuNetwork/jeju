/**
 * A2A Agent Card Discovery Endpoint
 * Serves the agent card at /.well-known/agent-card.json
 */

import { NextResponse } from 'next/server';
import agentCard from '@/public/agent-card.json';

export async function GET() {
  return NextResponse.json(agentCard, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
