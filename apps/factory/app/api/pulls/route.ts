import { NextRequest, NextResponse } from 'next/server';

// GET /api/pulls - List pull requests
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const repo = searchParams.get('repo');
  const status = searchParams.get('status'); // open, closed, merged
  const author = searchParams.get('author');
  const page = parseInt(searchParams.get('page') || '1');

  const pulls = [
    {
      id: '45',
      number: 45,
      title: 'Fix contract verification on Base Sepolia',
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

  return NextResponse.json({ pulls, total: pulls.length, page });
}

// POST /api/pulls - Create a new pull request
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { repo, title, body: prBody, sourceBranch, targetBranch, isDraft } = body;

  const pr = {
    id: `pr-${Date.now()}`,
    number: Math.floor(Math.random() * 1000),
    repo,
    title,
    body: prBody,
    sourceBranch,
    targetBranch,
    isDraft,
    status: 'open',
    createdAt: Date.now(),
  };

  return NextResponse.json(pr, { status: 201 });
}

