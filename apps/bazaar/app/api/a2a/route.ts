/**
 * Bazaar A2A API Route
 */

import { NextRequest, NextResponse } from 'next/server';
import { A2ARequestSchema } from '@/schemas/api';
import { expectValid } from '@/lib/validation';
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
    description: 'Network Bazaar A2A Server',
    agentCard: '/api/a2a?card=true',
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const validatedBody = expectValid(A2ARequestSchema, body, 'A2A request');
  return handleA2ARequest(request, validatedBody);
}
