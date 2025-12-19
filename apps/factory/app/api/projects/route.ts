import { NextRequest, NextResponse } from 'next/server';

// GET /api/projects - List all projects
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const owner = searchParams.get('owner');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');

  const projects = [
    {
      id: '1',
      name: 'Jeju Protocol v2',
      description: 'Next generation of the Jeju Protocol',
      status: 'active',
      owner: '0x1234...5678',
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

  return NextResponse.json({ projects, total: projects.length, page, limit });
}

// POST /api/projects - Create a new project
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, description, visibility } = body;

  const project = {
    id: `project-${Date.now()}`,
    name,
    description,
    visibility,
    status: 'active',
    createdAt: Date.now(),
    tasks: { total: 0, completed: 0, inProgress: 0, pending: 0 },
  };

  return NextResponse.json(project, { status: 201 });
}

