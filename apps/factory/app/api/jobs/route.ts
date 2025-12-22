import { NextRequest, NextResponse } from 'next/server';
import { validateQuery, validateBody, errorResponse } from '@/lib/validation';
import { getJobsQuerySchema, createJobSchema } from '@/lib/validation/schemas';
import type { Job } from '@/types';

// GET /api/jobs - List all jobs
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = validateQuery(getJobsQuerySchema, searchParams);

    const jobs: Job[] = [
      {
        id: '1',
        title: 'Senior Solidity Developer',
        company: 'Jeju Network',
        companyLogo: 'https://avatars.githubusercontent.com/u/1?v=4',
        type: 'full-time',
        remote: true,
        location: 'Remote',
        salary: { min: 150000, max: 200000, currency: 'USD' },
        skills: ['Solidity', 'Foundry', 'EVM'],
        description: 'Build core smart contracts for the Jeju ecosystem',
        createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
        applications: 45,
      },
      {
        id: '2',
        title: 'Frontend Engineer',
        company: 'DeFi Protocol',
        companyLogo: 'https://avatars.githubusercontent.com/u/2?v=4',
        type: 'contract',
        remote: true,
        location: 'Remote',
        salary: { min: 100, max: 150, currency: 'USD', period: 'hour' },
        skills: ['React', 'TypeScript', 'Web3'],
        description: 'Build beautiful DeFi interfaces',
        createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
        applications: 28,
      },
    ];

    return NextResponse.json({
      jobs,
      total: jobs.length,
      page: query.page,
      limit: query.limit,
      hasMore: false,
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

    const job: Job = {
      id: `job-${Date.now()}`,
      title: body.title,
      company: body.company,
      type: body.type,
      remote: body.remote,
      location: body.location,
      salary: body.salary,
      skills: body.skills,
      description: body.description,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      applications: 0,
    };

    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}

