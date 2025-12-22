import { NextRequest, NextResponse } from 'next/server';
import { validateQuery, validateBody, errorResponse } from '@/lib/validation';
import { getIssuesQuerySchema, createIssueSchema } from '@/lib/validation/schemas';
import { getDwsUrl } from '@/config/contracts';

// GET /api/issues - List issues
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = validateQuery(getIssuesQuerySchema, searchParams);

    const dwsUrl = getDwsUrl();
    const params = new URLSearchParams();
    if (query.page) params.set('page', query.page.toString());
    if (query.limit) params.set('limit', query.limit.toString());
    if (query.repo) params.set('repo', query.repo);
    if (query.status) params.set('status', query.status);
    
    const res = await fetch(`${dwsUrl}/git/issues?${params.toString()}`);
    
    if (!res.ok) {
      return NextResponse.json({ issues: [], total: 0, page: query.page });
    }

    const data = await res.json();
    return NextResponse.json({ issues: data.issues || [], total: data.total || 0, page: query.page });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}

// POST /api/issues - Create a new issue
export async function POST(request: NextRequest) {
  try {
    const body = await validateBody(createIssueSchema, request.json());

    const dwsUrl = getDwsUrl();
    const res = await fetch(`${dwsUrl}/git/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return errorResponse('Failed to create issue', res.status);
    }

    const issue = await res.json();
    return NextResponse.json(issue, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}
