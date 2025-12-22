import { type NextRequest, NextResponse } from 'next/server'
import {
  errorResponse,
  expect,
  requireAuth,
  validateBody,
  validateQuery,
} from '@/lib/validation'
import {
  createBountySchema,
  getBountiesQuerySchema,
} from '@/lib/validation/schemas'
import type { Bounty } from '@/types'

// GET /api/bounties - List all bounties
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const query = validateQuery(getBountiesQuerySchema, searchParams)

    // Mock data - in production this would query the BountyRegistry contract
    const bounties: Bounty[] = [
      {
        id: '1',
        title: 'Implement ERC-4337 Account Abstraction',
        description: 'Create a smart contract wallet with ERC-4337 support',
        reward: '5000',
        currency: 'USDC',
        status: 'open',
        skills: ['Solidity', 'ERC-4337', 'Smart Contracts'],
        creator: expect(
          '0x1234567890123456789012345678901234567890' as const,
          'Creator address required',
        ),
        deadline: Date.now() + 7 * 24 * 60 * 60 * 1000,
        submissions: 3,
        createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
      },
      {
        id: '2',
        title: 'Build React Dashboard Component',
        description: 'Create a reusable analytics dashboard with charts',
        reward: '2500',
        currency: 'USDC',
        status: 'in_progress',
        skills: ['React', 'TypeScript', 'D3.js'],
        creator: expect(
          '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as const,
          'Creator address required',
        ),
        deadline: Date.now() + 14 * 24 * 60 * 60 * 1000,
        submissions: 1,
        createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
      },
    ]

    return NextResponse.json({
      bounties,
      total: bounties.length,
      page: query.page,
      limit: query.limit,
      hasMore: false,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return errorResponse(message, 400)
  }
}

// POST /api/bounties - Create a new bounty
// Requires authentication - only authenticated users can create bounties
export async function POST(request: NextRequest) {
  // Verify authentication for state-changing operation
  const authResult = await requireAuth(request)
  if ('error' in authResult) {
    return authResult.error
  }

  const body = await validateBody(createBountySchema, request.json())

  // In production: call BountyRegistry.createBounty()
  // Use the authenticated address as the creator
  const bounty: Bounty = {
    id: `bounty-${Date.now()}`,
    title: body.title,
    description: body.description,
    reward: body.reward,
    currency: body.currency,
    skills: body.skills,
    deadline: body.deadline,
    milestones: body.milestones,
    status: 'open',
    creator: authResult.auth.address,
    submissions: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  return NextResponse.json(bounty, { status: 201 })
}
