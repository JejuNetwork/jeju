/**
 * Bazaar MCP API Route
 */

import { NextRequest } from 'next/server';
import { handleMCPRequest, handleMCPInfo } from '@/lib/mcp-server';

export async function GET() {
  return handleMCPInfo();
}

export async function POST(request: NextRequest) {
  // Parse the endpoint from the URL
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const endpoint = pathParts.slice(2).join('/'); // Remove 'api/mcp'
  
  return handleMCPRequest(request, endpoint || 'initialize');
}
