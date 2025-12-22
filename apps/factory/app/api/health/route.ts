import { NextResponse } from 'next/server';
import { expect } from '@/lib/validation';

const DWS_API_URL = process.env.NEXT_PUBLIC_DWS_URL || 'http://localhost:3456';
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:9545';

export async function GET() {
  const services: Record<string, boolean> = {
    factory: true,
    dws: false,
    rpc: false,
  };

  // Check DWS health
  try {
    expect(DWS_API_URL, 'DWS_API_URL must be configured');
    const response = await fetch(`${DWS_API_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    services.dws = response.ok;
  } catch (error) {
    if (error instanceof Error && error.message.includes('must be configured')) {
      throw error;
    }
    services.dws = false;
  }

  // Check RPC connectivity
  try {
    expect(RPC_URL, 'RPC_URL must be configured');
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(5000),
    });
    services.rpc = response.ok;
  } catch (error) {
    if (error instanceof Error && error.message.includes('must be configured')) {
      throw error;
    }
    services.rpc = false;
  }

  const allHealthy = Object.values(services).every(Boolean);

  return NextResponse.json({
    status: allHealthy ? 'healthy' : 'degraded',
    services,
    timestamp: Date.now(),
    version: '1.0.0',
  }, {
    status: allHealthy ? 200 : 503,
  });
}

