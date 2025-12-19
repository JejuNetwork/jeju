import { NextRequest, NextResponse } from 'next/server';

// GET /api/jobs - List all jobs
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type'); // full-time, part-time, contract, bounty
  const remote = searchParams.get('remote');
  const skill = searchParams.get('skill');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');

  const jobs = [
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
      applications: 28,
    },
  ];

  return NextResponse.json({
    jobs,
    total: jobs.length,
    page,
    limit,
    hasMore: false,
  });
}

// POST /api/jobs - Create a new job posting
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { title, company, type, remote, location, salary, skills, description } = body;

  const job = {
    id: `job-${Date.now()}`,
    title,
    company,
    type,
    remote,
    location,
    salary,
    skills,
    description,
    createdAt: Date.now(),
    applications: 0,
  };

  return NextResponse.json(job, { status: 201 });
}

