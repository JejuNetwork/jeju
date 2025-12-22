import { NextRequest, NextResponse } from 'next/server';
import { validateQuery, validateBody, errorResponse } from '@/lib/validation';
import { getBountiesQuerySchema, createBountySchema } from '@/lib/validation/schemas';
import { getDwsUrl, getContractAddress } from '@/config/contracts';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { getRpcUrl } from '@/config/contracts';
import type { Bounty } from '@/types';

const BOUNTY_REGISTRY_ABI = [
  {
    name: 'getBounty',
    type: 'function',
    inputs: [{ name: 'bountyId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'creator', type: 'address' },
          { name: 'token', type: 'address' },
          { name: 'reward', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'metadataUri', type: 'string' },
          { name: 'submissionCount', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getBountyCount',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

// GET /api/bounties - List all bounties
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = validateQuery(getBountiesQuerySchema, searchParams);

    // Try DWS first for indexed bounties with metadata
    const dwsUrl = getDwsUrl();
    const dwsRes = await fetch(`${dwsUrl}/api/bounties?page=${query.page}&limit=${query.limit}`).catch(() => null);
    
    if (dwsRes?.ok) {
      const data = await dwsRes.json();
      return NextResponse.json({
        bounties: data.bounties || [],
        total: data.total || 0,
        page: query.page,
        limit: query.limit,
        hasMore: data.hasMore || false,
      });
    }

    // Fallback: Query BountyRegistry contract directly
    const publicClient = createPublicClient({
      transport: http(getRpcUrl()),
    });

    const bountyAddress = getContractAddress('bountyRegistry');
    const count = await publicClient.readContract({
      address: bountyAddress,
      abi: BOUNTY_REGISTRY_ABI,
      functionName: 'getBountyCount',
    }).catch(() => 0n);

    const bounties: Bounty[] = [];
    const start = (query.page - 1) * query.limit;
    const end = Math.min(start + query.limit, Number(count));

    for (let i = start; i < end; i++) {
      const data = await publicClient.readContract({
        address: bountyAddress,
        abi: BOUNTY_REGISTRY_ABI,
        functionName: 'getBounty',
        args: [BigInt(i)],
      }).catch(() => null);

      if (data) {
        bounties.push({
          id: i.toString(),
          title: `Bounty #${i}`,
          description: data.metadataUri,
          reward: data.reward.toString(),
          currency: 'TOKEN',
          status: ['open', 'in_progress', 'completed', 'cancelled'][data.status] as Bounty['status'],
          skills: [],
          creator: data.creator,
          deadline: Number(data.deadline) * 1000,
          submissions: Number(data.submissionCount),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    }

    return NextResponse.json({
      bounties,
      total: Number(count),
      page: query.page,
      limit: query.limit,
      hasMore: end < Number(count),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}

// POST /api/bounties - Create a new bounty
export async function POST(request: NextRequest) {
  try {
    const body = await validateBody(createBountySchema, request.json());

    // POST to DWS for indexing and return pending status
    const dwsUrl = getDwsUrl();
    const dwsRes = await fetch(`${dwsUrl}/api/bounties`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);

    if (dwsRes?.ok) {
      const bounty = await dwsRes.json();
      return NextResponse.json(bounty, { status: 201 });
    }

    // Return expected format - actual on-chain tx happens client-side
    const bounty: Bounty = {
      id: `pending-${Date.now()}`,
      title: body.title,
      description: body.description,
      reward: body.reward,
      currency: body.currency,
      skills: body.skills,
      deadline: body.deadline,
      milestones: body.milestones,
      status: 'open',
      creator: '0x0000000000000000000000000000000000000000',
      submissions: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    return NextResponse.json(bounty, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}
