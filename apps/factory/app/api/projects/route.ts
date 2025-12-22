import { NextRequest, NextResponse } from 'next/server';
import { validateQuery, validateBody, errorResponse, expect } from '@/lib/validation';
import { getProjectsQuerySchema, createProjectSchema } from '@/lib/validation/schemas';
import type { Project } from '@/types';

// GET /api/projects - List all projects
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = validateQuery(getProjectsQuerySchema, searchParams);

    const projects: Project[] = [
      {
        id: '1',
        name: 'Jeju Protocol v2',
        description: 'Next generation of the Jeju Protocol',
        status: 'active',
        visibility: 'public',
        owner: expect('0x1234567890123456789012345678901234567890' as const, 'Owner address required'),
        members: 8,
        tasks: { total: 45, completed: 28, inProgress: 12, pending: 5 },
        milestones: [
          { name: 'Core Contracts', progress: 100 },
          { name: 'Frontend', progress: 65 },
          { name: 'Testing', progress: 40 },
        ],
        createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
      },
    ];

    return NextResponse.json({ projects, total: projects.length, page: query.page, limit: query.limit });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}

// POST /api/projects - Create a new project
export async function POST(request: NextRequest) {
  try {
    const body = await validateBody(createProjectSchema, request.json());

    const project: Project = {
      id: `project-${Date.now()}`,
      name: body.name,
      description: body.description,
      visibility: body.visibility,
      status: 'active',
      owner: expect('0x0000000000000000000000000000000000000000' as const, 'Owner address required'),
      members: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tasks: { total: 0, completed: 0, inProgress: 0, pending: 0 },
      milestones: [],
    };

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}

