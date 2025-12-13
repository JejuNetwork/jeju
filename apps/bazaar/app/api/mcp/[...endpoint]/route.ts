/**
 * Bazaar MCP Dynamic Endpoint Route
 */

import { NextRequest } from 'next/server';
import { handleMCPRequest } from '@/lib/mcp-server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ endpoint: string[] }> }
) {
  const { endpoint } = await params;
  const endpointPath = endpoint.join('/');
  return handleMCPRequest(request, endpointPath);
}

