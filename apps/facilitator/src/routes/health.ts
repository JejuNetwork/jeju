import { Hono } from 'hono';
import type { HealthResponse, StatsResponse } from '../lib/types';
import { ZERO_ADDRESS } from '../lib/chains';
import { config } from '../config';
import { createClients, getFacilitatorStats } from '../services/settler';

const app = new Hono();
const serviceStartTime = Date.now();

app.get('/', async (c) => {
  const cfg = config();
  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  try {
    const { publicClient } = createClients(cfg.network);
    await publicClient.getBlockNumber();
  } catch {
    status = 'degraded';
  }

  if (cfg.facilitatorAddress === ZERO_ADDRESS && cfg.environment === 'production') {
    status = 'unhealthy';
  }

  const response: HealthResponse = {
    service: cfg.serviceName,
    version: cfg.serviceVersion,
    status,
    mode: cfg.environment,
    chainId: cfg.chainId,
    network: cfg.network,
    facilitatorAddress: cfg.facilitatorAddress,
    endpoints: { verify: 'POST /verify', settle: 'POST /settle', supported: 'GET /supported', stats: 'GET /stats' },
    timestamp: Date.now(),
  };

  return c.json(response, status === 'unhealthy' ? 503 : 200);
});

app.get('/stats', async (c) => {
  const cfg = config();
  try {
    const { publicClient } = createClients(cfg.network);
    const stats = await getFacilitatorStats(publicClient);

    const response: StatsResponse = {
      totalSettlements: stats.totalSettlements.toString(),
      totalVolumeUSD: stats.totalVolumeUSD.toString(),
      protocolFeeBps: Number(stats.protocolFeeBps),
      feeRecipient: stats.feeRecipient,
      supportedTokens: [cfg.usdcAddress],
      uptime: Math.floor((Date.now() - serviceStartTime) / 1000),
      timestamp: Date.now(),
    };
    return c.json(response);
  } catch (e) {
    return c.json({ error: `Failed to fetch stats: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
});

app.get('/health', async (c) => {
  try {
    const { publicClient } = createClients(config().network);
    await publicClient.getBlockNumber();
    return c.json({ status: 'ok', timestamp: Date.now() });
  } catch {
    return c.json({ status: 'error', timestamp: Date.now() }, 503);
  }
});

app.get('/ready', (c) => {
  const cfg = config();
  const walletReady = cfg.privateKey !== null;
  const facilitatorReady = cfg.facilitatorAddress !== ZERO_ADDRESS;

  if (walletReady && facilitatorReady) {
    return c.json({ status: 'ready', timestamp: Date.now() });
  }
  return c.json({ status: 'not_ready', wallet: walletReady, facilitator: facilitatorReady, timestamp: Date.now() }, 503);
});

export default app;
