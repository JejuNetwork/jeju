import { type NextRequest, NextResponse } from 'next/server'
import { crucibleService } from '@/lib/services/crucible'
import { requireAuth, validateBody, validateQuery } from '@/lib/validation'
import {
  createAgentSchema,
  getAgentsQuerySchema,
} from '@/lib/validation/schemas'
import type { Agent } from '@/types'

// GET /api/agents - List all agents
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const query = validateQuery(getAgentsQuerySchema, searchParams)

  const agents = await crucibleService.getAgents({
    capability: query.q,
    active:
      query.status === 'active'
        ? true
        : query.status === 'inactive'
          ? false
          : undefined,
  })

  return NextResponse.json(agents)
}

// POST /api/agents - Deploy a new agent
// Requires authentication - only authenticated users can deploy agents
export async function POST(request: NextRequest) {
  // Verify authentication for state-changing operation
  const authResult = await requireAuth(request)
  if ('error' in authResult) {
    return authResult.error
  }

  const body = await validateBody(createAgentSchema, request.json())

  // Note: crucibleService doesn't have deployAgent method
  // In production, this would call the actual agent deployment method
  // For now, return a mock response with validated input
  // Use the authenticated address as the owner
  const mockAgent: Agent = {
    agentId: BigInt(Date.now()),
    owner: authResult.auth.address,
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
  }

  return NextResponse.json(mockAgent, { status: 201 })
}
