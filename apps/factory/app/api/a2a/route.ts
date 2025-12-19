import { NextRequest } from 'next/server';
import { handleA2ARequest, handleAgentCard } from '@/lib/protocols/a2a-server';

// GET /api/a2a - Returns agent card for discovery
export async function GET() {
  return handleAgentCard();
}

// POST /api/a2a - Handle A2A requests
export async function POST(request: NextRequest) {
  return handleA2ARequest(request);
}

