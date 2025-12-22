import { type NextRequest, NextResponse } from 'next/server'
import { handleMCPInfo, handleMCPRequest } from '@/lib/protocols/mcp-server'

/**
 * Sanitize and validate endpoint path segments
 * Prevents path traversal attacks by rejecting suspicious patterns
 */
function sanitizeEndpointPath(segments: string[]): string | null {
  // Reject empty segments, '..' traversal, or segments starting with '.'
  for (const segment of segments) {
    if (
      !segment ||
      segment === '..' ||
      segment.startsWith('.') ||
      segment.includes('\\')
    ) {
      return null
    }
    // Only allow alphanumeric, hyphens, and underscores
    if (!/^[a-zA-Z0-9_-]+$/.test(segment)) {
      return null
    }
  }
  return segments.join('/')
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ endpoint: string[] }> },
) {
  const { endpoint } = await params

  if (
    endpoint.length === 0 ||
    (endpoint.length === 1 && endpoint[0] === 'info')
  ) {
    return handleMCPInfo()
  }

  const path = sanitizeEndpointPath(endpoint)
  if (!path) {
    return NextResponse.json(
      { error: 'Invalid endpoint path' },
      { status: 400 },
    )
  }

  return handleMCPRequest(request, path)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ endpoint: string[] }> },
) {
  const { endpoint } = await params
  const path = sanitizeEndpointPath(endpoint)
  if (!path) {
    return NextResponse.json(
      { error: 'Invalid endpoint path' },
      { status: 400 },
    )
  }
  return handleMCPRequest(request, path)
}
