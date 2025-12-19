import { NextRequest, NextResponse } from 'next/server';

// GET /api/containers - List all containers
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const org = searchParams.get('org');
  const search = searchParams.get('q');

  // Mock data - in production this would query the ContainerRegistry contract
  const containers = [
    {
      id: '1',
      name: 'jeju/protocol',
      tag: 'latest',
      digest: 'sha256:abc123...',
      size: 156000000,
      platform: 'linux/amd64',
      downloads: 8420,
      createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
    },
    {
      id: '2',
      name: 'jeju/gateway',
      tag: 'v1.2.0',
      digest: 'sha256:def456...',
      size: 89000000,
      platform: 'linux/arm64',
      downloads: 3210,
      createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
    },
  ];

  return NextResponse.json({ containers, total: containers.length });
}

// POST /api/containers - Push a new container image
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, tag, digest, size, platform, labels } = body;

  const container = {
    id: `container-${Date.now()}`,
    name,
    tag,
    digest,
    size,
    platform,
    labels,
    createdAt: Date.now(),
  };

  return NextResponse.json(container, { status: 201 });
}

