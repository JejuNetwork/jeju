import { NextRequest, NextResponse } from 'next/server';
import { validateQuery, validateBody, errorResponse } from '@/lib/validation';
import { getAgentsQuerySchema, createAgentSchema } from '@/lib/validation/schemas';
import { crucibleService } from '@/lib/services/crucible';
import type { Agent } from '@/types';

// GET /api/agents - List all agents
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = validateQuery(getAgentsQuerySchema, searchParams);

    const agents = await crucibleService.getAgents({
      capability: query.q,
      active: query.status === 'active' ? true : query.status === 'inactive' ? false : undefined,
    });

    return NextResponse.json(agents);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}

// POST /api/agents - Deploy a new agent
export async function POST(request: NextRequest) {
  try {
    const body = await validateBody(createAgentSchema, request.json());

    // Note: crucibleService doesn't have deployAgent method
    // In production, this would call the actual agent deployment method
    // For now, return a mock response with validated input
    const mockAgent: Agent = {
      agentId: BigInt(Date.now()),
      owner: '0x0000000000000000000000000000000000000000',
      name: body.name,
      botType: body.type,
      characterCid: null,
      stateCid: 'ipfs://...',
      vaultAddress: '0x0000000000000000000000000000000000000000',
      active: true,
      registeredAt: Date.now(),
      lastExecutedAt: 0,
      executionCount: 0,
      capabilities: [],
      specializations: [],
      reputation: 0,
    };

    return NextResponse.json(mockAgent, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}

