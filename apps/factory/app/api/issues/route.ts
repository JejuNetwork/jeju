import { NextRequest, NextResponse } from 'next/server';

// GET /api/issues - List issues
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const repo = searchParams.get('repo');
  const status = searchParams.get('status'); // open, closed
  const label = searchParams.get('label');
  const assignee = searchParams.get('assignee');
  const page = parseInt(searchParams.get('page') || '1');

  const issues = [
    {
      id: '42',
      number: 42,
      title: 'Bug: Smart contract verification fails on Base Sepolia',
      status: 'open',
      author: { name: 'alice.eth', avatar: 'https://avatars.githubusercontent.com/u/1?v=4' },
      labels: ['bug', 'help wanted'],
      assignees: [{ name: 'bob.eth', avatar: 'https://avatars.githubusercontent.com/u/2?v=4' }],
      comments: 8,
      createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
      updatedAt: Date.now() - 1 * 60 * 60 * 1000,
    },
  ];

  return NextResponse.json({ issues, total: issues.length, page });
}

// POST /api/issues - Create a new issue
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { repo, title, body: issueBody, labels, assignees } = body;

  const issue = {
    id: `issue-${Date.now()}`,
    number: Math.floor(Math.random() * 1000),
    repo,
    title,
    body: issueBody,
    labels,
    assignees,
    status: 'open',
    createdAt: Date.now(),
    comments: 0,
  };

  return NextResponse.json(issue, { status: 201 });
}

