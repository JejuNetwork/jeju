import { NextRequest, NextResponse } from 'next/server';
import { validateQuery, validateBody, errorResponse } from '@/lib/validation';
import { getPullsQuerySchema, createPullRequestSchema } from '@/lib/validation/schemas';
import type { PullRequest } from '@/types';

// GET /api/pulls - List pull requests
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = validateQuery(getPullsQuerySchema, searchParams);

    const pulls: PullRequest[] = [
      {
        id: '45',
        number: 45,
        repo: 'jeju/protocol',
        title: 'Fix contract verification on Base Sepolia',
        body: 'This PR fixes the contract verification issue...',
        status: 'open',
        isDraft: false,
        author: { name: 'bob.eth', avatar: 'https://avatars.githubusercontent.com/u/2?v=4' },
        sourceBranch: 'fix/verification',
        targetBranch: 'main',
        labels: ['bug fix', 'contracts'],
        reviewers: [
          { name: 'alice.eth', status: 'approved' },
          { name: 'charlie.eth', status: 'pending' },
        ],
        commits: 2,
        additions: 68,
        deletions: 5,
        changedFiles: 3,
        checks: { passed: 4, failed: 0, pending: 1 },
        createdAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 2 * 60 * 60 * 1000,
      },
    ];

    return NextResponse.json({ pulls, total: pulls.length, page: query.page });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}

// POST /api/pulls - Create a new pull request
export async function POST(request: NextRequest) {
  try {
    const body = await validateBody(createPullRequestSchema, request.json());

    const pr: PullRequest = {
      id: `pr-${Date.now()}`,
      number: Math.floor(Math.random() * 1000),
      repo: body.repo,
      title: body.title,
      body: body.body,
      sourceBranch: body.sourceBranch,
      targetBranch: body.targetBranch,
      isDraft: body.isDraft ?? false,
      status: 'open',
      author: { name: 'unknown' },
      labels: [],
      reviewers: [],
      commits: 0,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      checks: { passed: 0, failed: 0, pending: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    return NextResponse.json(pr, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}

