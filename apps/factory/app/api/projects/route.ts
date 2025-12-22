import { NextRequest, NextResponse } from 'next/server';
import { validateQuery, validateBody, errorResponse } from '@/lib/validation';
import { getProjectsQuerySchema, createProjectSchema } from '@/lib/validation/schemas';
import { getDwsUrl } from '@/config/contracts';

// GET /api/projects - List all projects
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = validateQuery(getProjectsQuerySchema, searchParams);

    const dwsUrl = getDwsUrl();
    const params = new URLSearchParams();
    if (query.page) params.set('page', query.page.toString());
    if (query.limit) params.set('limit', query.limit.toString());
    if (query.q) params.set('q', query.q);
    
    const res = await fetch(`${dwsUrl}/api/projects?${params.toString()}`);
    
    if (!res.ok) {
      return NextResponse.json({ projects: [], total: 0, page: query.page, limit: query.limit });
    }

    const data = await res.json();
    return NextResponse.json({ 
      projects: data.projects || [], 
      total: data.total || 0, 
      page: query.page, 
      limit: query.limit 
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}

// POST /api/projects - Create a new project
export async function POST(request: NextRequest) {
  try {
    const body = await validateBody(createProjectSchema, request.json());

    const dwsUrl = getDwsUrl();
    const res = await fetch(`${dwsUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return errorResponse('Failed to create project', res.status);
    }

    const project = await res.json();
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}
