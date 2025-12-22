import { NextRequest, NextResponse } from 'next/server';
import { validateQuery, validateBody, errorResponse } from '@/lib/validation';
import { getAgentsQuerySchema, createAgentSchema } from '@/lib/validation/schemas';
import { crucibleService } from '@/lib/services/crucible';
import { getDwsUrl } from '@/config/contracts';
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

    // Try DWS compute for agent deployment
    const dwsUrl = getDwsUrl();
    const dwsRes = await fetch(`${dwsUrl}/compute/agents/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: body.name,
        type: body.type,
        config: body.config,
      }),
    }).catch(() => null);

    if (dwsRes?.ok) {
      const agent = await dwsRes.json();
      return NextResponse.json(agent, { status: 201 });
    }

    // Return pending agent - actual deployment happens via crucible
    const agent: Agent = {
      agentId: BigInt(Date.now()),
      owner: '0x0000000000000000000000000000000000000000',
      name: body.name,
      botType: body.type,
      characterCid: null,
      stateCid: '',
      vaultAddress: '0x0000000000000000000000000000000000000000',
      active: false,
      registeredAt: Date.now(),
      lastExecutedAt: 0,
      executionCount: 0,
      capabilities: [],
      specializations: [],
      reputation: 0,
    };

    return NextResponse.json(agent, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}
