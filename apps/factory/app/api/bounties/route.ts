import { NextRequest, NextResponse } from 'next/server';

// GET /api/bounties - List all bounties
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status'); // open, in_progress, review, completed
  const skill = searchParams.get('skill');
  const minReward = searchParams.get('minReward');
  const maxReward = searchParams.get('maxReward');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');

  // Mock data - in production this would query the BountyRegistry contract
  const bounties = [
    {
      id: '1',
      title: 'Implement ERC-4337 Account Abstraction',
      description: 'Create a smart contract wallet with ERC-4337 support',
      reward: '5000',
      currency: 'USDC',
      status: 'open',
      skills: ['Solidity', 'ERC-4337', 'Smart Contracts'],
      creator: '0x1234...5678',
      deadline: Date.now() + 7 * 24 * 60 * 60 * 1000,
      submissions: 3,
      createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
    },
    {
      id: '2',
      title: 'Build React Dashboard Component',
      description: 'Create a reusable analytics dashboard with charts',
      reward: '2500',
      currency: 'USDC',
      status: 'in_progress',
      skills: ['React', 'TypeScript', 'D3.js'],
      creator: '0xabcd...efgh',
      deadline: Date.now() + 14 * 24 * 60 * 60 * 1000,
      submissions: 1,
      createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
    },
  ];

  return NextResponse.json({
    bounties,
    total: bounties.length,
    page,
    limit,
    hasMore: false,
  });
}

// POST /api/bounties - Create a new bounty
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { title, description, reward, currency, skills, deadline, milestones } = body;

  // In production: call BountyRegistry.createBounty()
  const bounty = {
    id: `bounty-${Date.now()}`,
    title,
    description,
    reward,
    currency,
    skills,
    deadline,
    milestones,
    status: 'open',
    createdAt: Date.now(),
  };

  return NextResponse.json(bounty, { status: 201 });
}

