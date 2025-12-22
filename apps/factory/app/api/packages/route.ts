import { NextRequest, NextResponse } from 'next/server';
import { validateQuery, errorResponse, expect } from '@/lib/validation';
import { getPackagesQuerySchema, packageMetadataSchema } from '@/lib/validation/schemas';
import { dwsClient } from '@/lib/services/dws';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = validateQuery(getPackagesQuerySchema, searchParams);

    const packages = await dwsClient.searchPackages(query.q || '');
    return NextResponse.json(packages);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const tarball = formData.get('tarball');
    const metadataJson = formData.get('metadata');

    expect(tarball, 'Tarball file is required');
    expect(metadataJson, 'Metadata is required');

    if (!(tarball instanceof Blob)) {
      throw new Error('Tarball must be a file');
    }

    if (typeof metadataJson !== 'string') {
      throw new Error('Metadata must be a JSON string');
    }

    let metadata: unknown;
    try {
      metadata = JSON.parse(metadataJson);
    } catch {
      throw new Error('Invalid JSON in metadata');
    }

    const validatedMetadata = packageMetadataSchema.parse(metadata);

    const pkg = await dwsClient.publishPackage(tarball, validatedMetadata);
    return NextResponse.json(pkg);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}



