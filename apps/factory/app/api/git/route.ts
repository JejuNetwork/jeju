import { NextRequest, NextResponse } from 'next/server';
import { dwsClient } from '@/lib/services/dws';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const owner = searchParams.get('owner');

  const repos = await dwsClient.listRepositories(owner || undefined);
  return NextResponse.json(repos);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, description, isPrivate } = body;

  const repo = await dwsClient.createRepository({
    name,
    description,
    isPrivate,
  });

  return NextResponse.json(repo);
}



