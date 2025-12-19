import { NextRequest, NextResponse } from 'next/server';

// GET /api/ci - List CI/CD workflow runs
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const repo = searchParams.get('repo');
  const status = searchParams.get('status'); // queued, running, success, failure
  const branch = searchParams.get('branch');
  const page = parseInt(searchParams.get('page') || '1');

  const runs = [
    {
      id: 'run-1',
      workflow: 'Build & Test',
      status: 'success',
      conclusion: 'success',
      branch: 'main',
      commit: 'abc1234',
      commitMessage: 'feat: add new feature',
      author: 'alice.eth',
      duration: 245,
      startedAt: Date.now() - 1 * 60 * 60 * 1000,
      completedAt: Date.now() - 1 * 60 * 60 * 1000 + 245000,
      jobs: [
        { name: 'Build', status: 'success', duration: 120 },
        { name: 'Test', status: 'success', duration: 90 },
        { name: 'Deploy', status: 'success', duration: 35 },
      ],
    },
    {
      id: 'run-2',
      workflow: 'Build & Test',
      status: 'running',
      branch: 'feature/auth',
      commit: 'def5678',
      commitMessage: 'wip: auth flow',
      author: 'bob.eth',
      startedAt: Date.now() - 5 * 60 * 1000,
      jobs: [
        { name: 'Build', status: 'success', duration: 120 },
        { name: 'Test', status: 'running' },
        { name: 'Deploy', status: 'pending' },
      ],
    },
  ];

  return NextResponse.json({ runs, total: runs.length, page });
}

// POST /api/ci - Trigger a new workflow run
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { repo, workflow, branch, inputs } = body;

  const run = {
    id: `run-${Date.now()}`,
    workflow,
    branch,
    inputs,
    status: 'queued',
    createdAt: Date.now(),
  };

  return NextResponse.json(run, { status: 201 });
}

