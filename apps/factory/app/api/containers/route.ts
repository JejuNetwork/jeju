import { NextRequest, NextResponse } from 'next/server';
import { validateQuery, validateBody, errorResponse } from '@/lib/validation';
import { getContainersQuerySchema, createContainerSchema } from '@/lib/validation/schemas';
import { dwsClient } from '@/lib/services/dws';

// GET /api/containers - List all containers
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    validateQuery(getContainersQuerySchema, searchParams);

    const repository = searchParams.get('repository') || undefined;
    
    // Use DWS client to fetch real container images
    const images = await dwsClient.listImages(repository).catch(() => []);
    
    // Transform to ContainerImage format
    const containers = images.map((img, idx) => ({
      id: `container-${idx}`,
      name: img.name,
      tag: img.tag,
      digest: img.digest,
      size: img.size,
      platform: `${img.os}/${img.architecture}`,
      downloads: 0,
      createdAt: img.pushedAt,
      updatedAt: img.pushedAt,
    }));

    return NextResponse.json({ containers, total: containers.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}

// POST /api/containers - Push a new container image
export async function POST(request: NextRequest) {
  try {
    const body = await validateBody(createContainerSchema, request.json());

    // In production, this would accept a tarball and push to DWS
    // For now, return the expected response structure
    const container = {
      id: `container-${Date.now()}`,
      name: body.name,
      tag: body.tag,
      digest: body.digest,
      size: body.size,
      platform: body.platform,
      labels: body.labels,
      downloads: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    return NextResponse.json(container, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}
