import { NextRequest, NextResponse } from 'next/server';
import { dwsClient } from '@/lib/services/dws';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q') || '';

  const packages = await dwsClient.searchPackages(query);
  return NextResponse.json(packages);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const tarball = formData.get('tarball') as Blob;
  const metadataJson = formData.get('metadata') as string;
  const metadata = JSON.parse(metadataJson);

  const pkg = await dwsClient.publishPackage(tarball, metadata);
  return NextResponse.json(pkg);
}



