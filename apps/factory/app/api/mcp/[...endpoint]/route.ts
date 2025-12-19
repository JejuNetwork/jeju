import { NextRequest } from 'next/server';
import { handleMCPRequest, handleMCPInfo } from '@/lib/protocols/mcp-server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ endpoint: string[] }> }
) {
  const { endpoint } = await params;
  const path = endpoint.join('/');
  
  if (path === '' || path === 'info') {
    return handleMCPInfo();
  }
  
  return handleMCPRequest(request, path);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ endpoint: string[] }> }
) {
  const { endpoint } = await params;
  const path = endpoint.join('/');
  return handleMCPRequest(request, path);
}

