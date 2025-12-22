import { type NextRequest, NextResponse } from 'next/server'
import { errorResponse, validateBody, validateQuery } from '@/lib/validation'
import {
  createContainerSchema,
  getContainersQuerySchema,
} from '@/lib/validation/schemas'
import type { ContainerImage } from '@/types'

// GET /api/containers - List all containers
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    validateQuery(getContainersQuerySchema, searchParams)

    // Mock data - in production this would query the ContainerRegistry contract
    const containers: ContainerImage[] = [
      {
        id: '1',
        name: 'jeju/protocol',
        tag: 'latest',
        digest:
          'sha256:abc123def4567890123456789012345678901234567890123456789012345678',
        size: 156000000,
        platform: 'linux/amd64',
        downloads: 8420,
        createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
      },
      {
        id: '2',
        name: 'jeju/gateway',
        tag: 'v1.2.0',
        digest:
          'sha256:def456abc1237890123456789012345678901234567890123456789012345678',
        size: 89000000,
        platform: 'linux/arm64',
        downloads: 3210,
        createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
      },
    ]

    return NextResponse.json({ containers, total: containers.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return errorResponse(message, 400)
  }
}

// POST /api/containers - Push a new container image
export async function POST(request: NextRequest) {
  try {
    const body = await validateBody(createContainerSchema, request.json())

    const container: ContainerImage = {
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
    }

    return NextResponse.json(container, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return errorResponse(message, 400)
  }
}
