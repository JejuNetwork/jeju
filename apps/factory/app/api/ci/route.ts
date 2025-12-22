import { NextRequest, NextResponse } from 'next/server';
import { validateQuery, validateBody, errorResponse } from '@/lib/validation';
import { getCIQuerySchema, createCIRunSchema } from '@/lib/validation/schemas';
import type { CIRun } from '@/types';

// GET /api/ci - List CI/CD workflow runs
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = validateQuery(getCIQuerySchema, searchParams);

    const runs: CIRun[] = [
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
        createdAt: Date.now() - 1 * 60 * 60 * 1000,
        updatedAt: Date.now() - 1 * 60 * 60 * 1000 + 245000,
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
        createdAt: Date.now() - 5 * 60 * 1000,
        updatedAt: Date.now() - 5 * 60 * 1000,
      },
    ];

    return NextResponse.json({ runs, total: runs.length, page: query.page });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}

// POST /api/ci - Trigger a new workflow run
export async function POST(request: NextRequest) {
  try {
    const body = await validateBody(createCIRunSchema, request.json());

    const run: CIRun = {
      id: `run-${Date.now()}`,
      workflow: body.workflow,
      branch: body.branch,
      status: 'queued',
      commit: '',
      commitMessage: '',
      author: '',
      startedAt: Date.now(),
      jobs: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}

