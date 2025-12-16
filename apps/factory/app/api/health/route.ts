import { NextResponse } from 'next/server';

const DWS_API_URL = process.env.NEXT_PUBLIC_DWS_URL || 'http://localhost:3456';

export async function GET() {
  const services: Record<string, boolean> = {
    factory: true,
    dws: false,
    rpc: false,
  };

  // Check DWS health
  try {
    const response = await fetch(`${DWS_API_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    services.dws = response.ok;
  } catch {
    services.dws = false;
  }

  // Check RPC connectivity
  try {
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:9545';
    const response = await fetch(rpcUrl, {
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
  } catch {
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

