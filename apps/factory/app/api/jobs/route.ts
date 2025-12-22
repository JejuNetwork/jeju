import { NextRequest, NextResponse } from 'next/server';
import { validateQuery, validateBody, errorResponse } from '@/lib/validation';
import { getJobsQuerySchema, createJobSchema } from '@/lib/validation/schemas';
import { getDwsUrl } from '@/config/contracts';

// GET /api/jobs - List all jobs
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = validateQuery(getJobsQuerySchema, searchParams);

    const dwsUrl = getDwsUrl();
    const params = new URLSearchParams();
    if (query.page) params.set('page', query.page.toString());
    if (query.limit) params.set('limit', query.limit.toString());
    if (query.type) params.set('type', query.type);
    if (query.status) params.set('status', query.status);
    
    const res = await fetch(`${dwsUrl}/api/jobs?${params.toString()}`);
    
    if (!res.ok) {
      return NextResponse.json({ jobs: [], total: 0, page: query.page, limit: query.limit, hasMore: false });
    }

    const data = await res.json();
    return NextResponse.json({
      jobs: data.jobs || [],
      total: data.total || 0,
      page: query.page,
      limit: query.limit,
      hasMore: data.hasMore || false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}

// POST /api/jobs - Create a new job posting
export async function POST(request: NextRequest) {
  try {
    const body = await validateBody(createJobSchema, request.json());

    const dwsUrl = getDwsUrl();
    const res = await fetch(`${dwsUrl}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return errorResponse('Failed to create job', res.status);
    }

    const job = await res.json();
    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}
