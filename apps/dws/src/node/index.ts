/**
 * DWS Provider Node
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createPublicClient, createWalletClient, http, formatEther, type Address, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { getBalance } from 'viem/actions';
import { inferChainFromRpcUrl } from '../../../../scripts/shared/chain-utils';

const app = new Hono();
app.use('/*', cors({ origin: '*' }));

const privateKey = process.env.PRIVATE_KEY;
const rpcUrl = process.env.RPC_URL || 'http://localhost:9545';

let account: PrivateKeyAccount | null = null;
let client: PublicClient | null = null;
let address: Address | null = null;

async function initializeWallet(): Promise<void> {
  if (!privateKey) {
    console.log('[DWS Node] No PRIVATE_KEY set, running in read-only mode');
    return;
  }

  account = privateKeyToAccount(privateKey as `0x${string}`);
  const chain = inferChainFromRpcUrl(rpcUrl);
  client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  address = account.address;
  console.log(`[DWS Node] Initialized with address: ${address}`);
}

app.get('/health', async (c) => {
  return c.json({ status: 'healthy', service: 'dws-node', address: address || 'read-only', rpcUrl });
});

app.get('/status', async (c) => {
  const balance = client && address ? formatEther(await getBalance(client, { address })) : '0';
  return c.json({ address: address || 'read-only', balance, registered: false, reputation: 0, services: ['storage', 'compute'], uptime: process.uptime() * 1000 });
});

app.post('/storage/pin', async (c) => {
  if (!wallet) return c.json({ error: 'Read-only mode' }, 403);
  const body = await c.req.json<{ cid: string; size: number }>();
  return c.json({ success: true, cid: body.cid, pinnedAt: Date.now() });
});

app.post('/compute/inference', async (c) => {
  const body = await c.req.json<{ model: string; prompt: string }>();
  return c.json({ id: crypto.randomUUID(), model: body.model, response: `Mock response from DWS node: ${body.prompt.slice(0, 100)}...`, timestamp: Date.now() });
});

app.get('/earnings', async (c) => {
  return c.json({ total: '0', storage: '0', compute: '0', pending: '0' });
});

app.post('/withdraw', async (c) => {
  if (!wallet) return c.json({ error: 'Read-only mode' }, 403);
  return c.json({ success: false, error: 'No earnings to withdraw' });
});

const PORT = parseInt(process.env.DWS_NODE_PORT || '4031', 10);

if (import.meta.main) {
  initializeWallet();
  console.log(`[DWS Node] Running at http://localhost:${PORT}`);
  Bun.serve({ port: PORT, fetch: app.fetch });
}

export { app as nodeApp };
