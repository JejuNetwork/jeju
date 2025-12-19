import { NextRequest, NextResponse } from 'next/server';
import { crucibleClient } from '@/lib/services/crucible';

// GET /api/agents - List all agents
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const status = searchParams.get('status');
  const search = searchParams.get('q');

  const agents = await crucibleClient.listAgents({
    type: type || undefined,
    status: status || undefined,
    search: search || undefined,
  });

  return NextResponse.json(agents);
}

// POST /api/agents - Deploy a new agent
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, type, config, modelId } = body;

  const agent = await crucibleClient.deployAgent({
    name,
    type,
    config,
    modelId,
  });

  return NextResponse.json(agent, { status: 201 });
}

