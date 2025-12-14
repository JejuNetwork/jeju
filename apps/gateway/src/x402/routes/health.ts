import { Hono } from 'hono';
import type { StatsResponse } from '../lib/types';
import { ZERO_ADDRESS } from '../lib/chains';
import { config, getConfigStatus } from '../config';
import { createClients, getFacilitatorStats } from '../services/settler';
import { getNonceCacheStats } from '../services/nonce-manager';

const app = new Hono();
const serviceStartTime = Date.now();

app.get('/', async (c) => {
  const cfg = config();
  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  try {
    const { publicClient } = await createClients(cfg.network);
    await publicClient.getBlockNumber();
  } catch {
    status = 'degraded';
  }

  if (cfg.facilitatorAddress === ZERO_ADDRESS && cfg.environment === 'production') {
    status = 'unhealthy';
  }

  const configStatus = await getConfigStatus();
  const nonceStats = await getNonceCacheStats();

  return c.json({
    service: cfg.serviceName,
    version: cfg.serviceVersion,
    status,
    mode: cfg.environment,
    chainId: cfg.chainId,
    network: cfg.network,
    facilitatorAddress: cfg.facilitatorAddress,
    endpoints: { verify: 'POST /verify', settle: 'POST /settle', supported: 'GET /supported', stats: 'GET /stats' },
    kms: configStatus.kmsEnabled ? configStatus.keySource : 'disabled',
    distributed: nonceStats.distributed,
    timestamp: Date.now(),
  }, status === 'unhealthy' ? 503 : 200);
});

app.get('/stats', async (c) => {
  const cfg = config();
  try {
    const { publicClient } = await createClients(cfg.network);
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
    const { publicClient } = await createClients(config().network);
    await publicClient.getBlockNumber();
    return c.json({ status: 'ok', timestamp: Date.now() });
  } catch {
    return c.json({ status: 'error', timestamp: Date.now() }, 503);
  }
});

app.get('/ready', async (c) => {
  const cfg = config();
  const configStatus = await getConfigStatus();
  
  const ready = configStatus.keySource !== 'none' && cfg.facilitatorAddress !== ZERO_ADDRESS;
  return c.json({ status: ready ? 'ready' : 'not_ready', timestamp: Date.now() }, ready ? 200 : 503);
});

export default app;
