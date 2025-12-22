import { NextRequest, NextResponse } from 'next/server';
import { validateQuery, validateBody, errorResponse } from '@/lib/validation';
import { getPullsQuerySchema, createPullRequestSchema } from '@/lib/validation/schemas';
import { getDwsUrl } from '@/config/contracts';

// GET /api/pulls - List pull requests
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = validateQuery(getPullsQuerySchema, searchParams);

    const dwsUrl = getDwsUrl();
    const params = new URLSearchParams();
    if (query.page) params.set('page', query.page.toString());
    if (query.limit) params.set('limit', query.limit.toString());
    if (query.repo) params.set('repo', query.repo);
    if (query.status) params.set('status', query.status);
    
    const res = await fetch(`${dwsUrl}/git/pulls?${params.toString()}`);
    
    if (!res.ok) {
      return NextResponse.json({ pulls: [], total: 0, page: query.page });
    }

    const data = await res.json();
    return NextResponse.json({ pulls: data.pulls || [], total: data.total || 0, page: query.page });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}

// POST /api/pulls - Create a new pull request
export async function POST(request: NextRequest) {
  try {
    const body = await validateBody(createPullRequestSchema, request.json());

    const dwsUrl = getDwsUrl();
    const res = await fetch(`${dwsUrl}/git/pulls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return errorResponse('Failed to create pull request', res.status);
    }

    const pr = await res.json();
    return NextResponse.json(pr, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}
