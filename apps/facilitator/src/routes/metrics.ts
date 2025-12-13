import { Hono } from 'hono';
import { config } from '../config';
import { getNonceCacheStats } from '../services/nonce-manager';

const app = new Hono();
const serviceStartTime = Date.now();

app.get('/metrics', async (c) => {
  const cfg = config();
  const nonceStats = getNonceCacheStats();
  const uptime = Math.floor((Date.now() - serviceStartTime) / 1000);

  const metrics = [
    `# HELP facilitator_uptime_seconds Uptime in seconds`,
    `# TYPE facilitator_uptime_seconds gauge`,
    `facilitator_uptime_seconds{network="${cfg.network}"} ${uptime}`,
    '',
    `# HELP facilitator_nonce_cache_total Total number of nonces in cache`,
    `# TYPE facilitator_nonce_cache_total gauge`,
    `facilitator_nonce_cache_total{network="${cfg.network}"} ${nonceStats.total}`,
    '',
    `# HELP facilitator_nonce_cache_pending Number of pending nonces`,
    `# TYPE facilitator_nonce_cache_pending gauge`,
    `facilitator_nonce_cache_pending{network="${cfg.network}"} ${nonceStats.pending}`,
    '',
    `# HELP facilitator_nonce_cache_used Number of used nonces`,
    `# TYPE facilitator_nonce_cache_used gauge`,
    `facilitator_nonce_cache_used{network="${cfg.network}"} ${nonceStats.used}`,
    '',
    `# HELP facilitator_chain_id Chain ID`,
    `# TYPE facilitator_chain_id gauge`,
    `facilitator_chain_id{network="${cfg.network}"} ${cfg.chainId}`,
    '',
    `# HELP facilitator_protocol_fee_bps Protocol fee in basis points`,
    `# TYPE facilitator_protocol_fee_bps gauge`,
    `facilitator_protocol_fee_bps{network="${cfg.network}"} ${cfg.protocolFeeBps}`,
    '',
    `# HELP facilitator_environment Environment (production/development)`,
    `# TYPE facilitator_environment gauge`,
    `facilitator_environment{network="${cfg.network}",env="${cfg.environment}"} 1`,
  ].join('\n');

  return c.text(metrics, 200, { 'Content-Type': 'text/plain; version=0.0.4' });
});

export default app;
