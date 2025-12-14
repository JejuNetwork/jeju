/**
 * Bazaar A2A API Route
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleA2ARequest, handleAgentCard } from '@/lib/a2a-server';

export async function GET(request: NextRequest) {
  // Check if requesting agent card
  if (request.nextUrl.pathname.includes('.well-known/agent-card.json') || 
      request.nextUrl.searchParams.get('card') === 'true') {
    return handleAgentCard();
  }
  
  // Return API info
  return NextResponse.json({
    service: 'bazaar-a2a',
    version: '1.0.0',
    description: 'Jeju Bazaar A2A Server',
    agentCard: '/api/a2a?card=true',
  });
}

export async function POST(request: NextRequest) {
  return handleA2ARequest(request);
}
