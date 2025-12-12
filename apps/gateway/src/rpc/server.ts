/**
 * RPC Gateway Server
 * Multi-chain RPC proxy with stake-based rate limiting and X402 payments
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { isAddress, type Address } from 'viem';

import { CHAINS, getChain, isChainSupported, getMainnetChains, getTestnetChains } from './config/chains.js';
import { rateLimiter, getRateLimitStats, RATE_LIMITS } from './middleware/rate-limiter.js';
import { proxyRequest, proxyBatchRequest, getEndpointHealth, getChainStats } from './proxy/rpc-proxy.js';
import { createApiKey, getApiKeysForAddress, revokeApiKeyById, getApiKeyStats } from './services/api-keys.js';
import { generatePaymentRequirement, getPaymentInfo, getCredits, purchaseCredits, processPayment } from './services/x402-payments.js';

export const rpcApp = new Hono();

const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',') || ['*'];
const MAX_API_KEYS_PER_ADDRESS = 10;

// Middleware
rpcApp.use('*', secureHeaders());
rpcApp.use('*', cors({
  origin: CORS_ORIGINS,
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-Api-Key', 'X-Wallet-Address', 'X-Payment'],
  exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'X-RateLimit-Tier', 'X-RPC-Latency-Ms', 'X-Payment-Required'],
  maxAge: 86400,
}));
rpcApp.use('*', logger());
rpcApp.use('/v1/*', rateLimiter());

rpcApp.onError((err, c) => {
  console.error(`[RPC Gateway Error] ${err.message}`, err.stack);
  return c.json({ error: 'Internal server error' }, 500);
});

function getValidatedAddress(c: { req: { header: (name: string) => string | undefined } }): Address | null {
  const address = c.req.header('X-Wallet-Address');
  if (!address || !isAddress(address)) return null;
  return address as Address;
}

// Health & Discovery
rpcApp.get('/', (c) => c.json({
  service: 'jeju-rpc-gateway',
  version: '1.0.0',
  description: 'Multi-chain RPC Gateway with stake-based rate limiting',
  endpoints: { chains: '/v1/chains', rpc: '/v1/rpc/:chainId', keys: '/v1/keys', usage: '/v1/usage', health: '/health' },
}));

rpcApp.get('/health', (c) => {
  const chainStats = getChainStats();
  const rateLimitStats = getRateLimitStats();
  const apiKeyStats = getApiKeyStats();
  const endpointHealth = getEndpointHealth();
  const unhealthyEndpoints = Object.entries(endpointHealth).filter(([, h]) => !h.healthy).map(([url]) => url);
  const status = unhealthyEndpoints.length > chainStats.supported / 2 ? 'degraded' : 'ok';

  return c.json({
    status,
    service: 'rpc-gateway',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    chains: { ...chainStats, unhealthyEndpoints: unhealthyEndpoints.length },
    rateLimits: rateLimitStats,
    apiKeys: { total: apiKeyStats.total, active: apiKeyStats.active },
  });
});

// Chain Information
rpcApp.get('/v1/chains', (c) => {
  const testnet = c.req.query('testnet');
  const chains = testnet === 'true' ? getTestnetChains() : testnet === 'false' ? getMainnetChains() : Object.values(CHAINS);

  return c.json({
    chains: chains.map(chain => ({
      chainId: chain.chainId,
      name: chain.name,
      shortName: chain.shortName,
      rpcEndpoint: `/v1/rpc/${chain.chainId}`,
      explorerUrl: chain.explorerUrl,
      isTestnet: chain.isTestnet,
      nativeCurrency: chain.nativeCurrency,
    })),
    totalCount: chains.length,
  });
});

rpcApp.get('/v1/chains/:chainId', (c) => {
  const chainId = Number(c.req.param('chainId'));
  if (!isChainSupported(chainId)) return c.json({ error: `Unsupported chain: ${chainId}` }, 404);

  const chain = getChain(chainId);
  const health = getEndpointHealth();

  return c.json({
    chainId: chain.chainId,
    name: chain.name,
    shortName: chain.shortName,
    rpcEndpoint: `/v1/rpc/${chain.chainId}`,
    explorerUrl: chain.explorerUrl,
    isTestnet: chain.isTestnet,
    nativeCurrency: chain.nativeCurrency,
    endpoints: {
      primary: { url: chain.rpcUrl, healthy: health[chain.rpcUrl]?.healthy ?? true },
      fallbacks: chain.fallbackRpcs.map(url => ({ url, healthy: health[url]?.healthy ?? true })),
    },
  });
});

// RPC Proxy
rpcApp.post('/v1/rpc/:chainId', async (c) => {
  const chainId = Number(c.req.param('chainId'));
  if (!isChainSupported(chainId)) {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: `Unsupported chain: ${chainId}` } }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: Invalid JSON' } }, 400);
  }

  // Get user address for x402 payment processing
  const userAddress = c.req.header('X-Wallet-Address');
  const paymentHeader = c.req.header('X-Payment');

  if (Array.isArray(body)) {
    if (body.length === 0) return c.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request: Empty batch' } }, 400);
    if (body.length > 100) return c.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request: Batch too large (max 100)' } }, 400);
    
    // Check x402 payment for batch (use first method as reference)
    const firstMethod = (body[0] as { method?: string })?.method || 'eth_call';
    const paymentResult = processPayment(paymentHeader, chainId, firstMethod, userAddress);
    if (!paymentResult.allowed) {
      c.header('X-Payment-Required', 'true');
      return c.json({ jsonrpc: '2.0', id: null, error: { code: 402, message: 'Payment required', data: paymentResult.requirement } }, 402);
    }
    
    const results = await proxyBatchRequest(chainId, body);
    return c.json(results.map(r => r.response));
  }

  if (!body || typeof body !== 'object' || !('method' in body)) {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request: Missing method' } }, 400);
  }

  const rpcBody = body as { jsonrpc: string; id: number | string; method: string; params?: unknown[] };
  
  // Check x402 payment for single request
  const paymentResult = processPayment(paymentHeader, chainId, rpcBody.method, userAddress);
  if (!paymentResult.allowed) {
    c.header('X-Payment-Required', 'true');
    return c.json({ jsonrpc: '2.0', id: rpcBody.id, error: { code: 402, message: 'Payment required', data: paymentResult.requirement } }, 402);
  }

  const result = await proxyRequest(chainId, rpcBody);
  c.header('X-RPC-Latency-Ms', String(result.latencyMs));
  if (result.usedFallback) c.header('X-RPC-Used-Fallback', 'true');

  return c.json(result.response);
});

// API Key Management
rpcApp.get('/v1/keys', async (c) => {
  const address = getValidatedAddress(c);
  if (!address) return c.json({ error: 'Valid X-Wallet-Address header required' }, 401);

  const keys = getApiKeysForAddress(address);
  return c.json({
    keys: keys.map(k => ({
      id: k.id,
      name: k.name,
      tier: k.tier,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      requestCount: k.requestCount,
      isActive: k.isActive,
    })),
  });
});

rpcApp.post('/v1/keys', async (c) => {
  const address = getValidatedAddress(c);
  if (!address) return c.json({ error: 'Valid X-Wallet-Address header required' }, 401);

  const existingKeys = getApiKeysForAddress(address);
  if (existingKeys.filter(k => k.isActive).length >= MAX_API_KEYS_PER_ADDRESS) {
    return c.json({ error: `Maximum API keys reached (${MAX_API_KEYS_PER_ADDRESS}). Revoke an existing key first.` }, 400);
  }

  let body: { name?: string };
  try { body = await c.req.json(); } catch { body = {}; }
  const name = (body.name || 'Default').slice(0, 100);
  const { key, record } = createApiKey(address, name);

  return c.json({
    message: 'API key created. Store this key securely - it cannot be retrieved again.',
    key,
    id: record.id,
    name: record.name,
    tier: record.tier,
    createdAt: record.createdAt,
  }, 201);
});

rpcApp.delete('/v1/keys/:keyId', async (c) => {
  const address = getValidatedAddress(c);
  const keyId = c.req.param('keyId');
  if (!address) return c.json({ error: 'Valid X-Wallet-Address header required' }, 401);
  if (!keyId || keyId.length !== 32) return c.json({ error: 'Invalid key ID format' }, 400);

  const success = revokeApiKeyById(keyId, address);
  if (!success) return c.json({ error: 'Key not found or not owned by this address' }, 404);

  return c.json({ message: 'API key revoked', id: keyId });
});

// Usage & Staking Info
rpcApp.get('/v1/usage', async (c) => {
  const address = getValidatedAddress(c);
  if (!address) return c.json({ error: 'Valid X-Wallet-Address header required' }, 401);

  const keys = getApiKeysForAddress(address);
  const activeKeys = keys.filter(k => k.isActive);
  const totalRequests = keys.reduce((sum, k) => sum + k.requestCount, 0);
  const tier = (c.res.headers.get('X-RateLimit-Tier') || 'FREE') as keyof typeof RATE_LIMITS;
  const remaining = c.res.headers.get('X-RateLimit-Remaining') || String(RATE_LIMITS.FREE);

  return c.json({
    address,
    currentTier: tier,
    rateLimit: RATE_LIMITS[tier],
    remaining: remaining === 'unlimited' ? -1 : Number(remaining),
    apiKeys: { total: keys.length, active: activeKeys.length, maxAllowed: MAX_API_KEYS_PER_ADDRESS },
    totalRequests,
    tiers: {
      FREE: { stake: '0', limit: RATE_LIMITS.FREE },
      BASIC: { stake: '100 JEJU', limit: RATE_LIMITS.BASIC },
      PRO: { stake: '1,000 JEJU', limit: RATE_LIMITS.PRO },
      UNLIMITED: { stake: '10,000 JEJU', limit: 'unlimited' },
    },
  });
});

rpcApp.get('/v1/stake', async (c) => c.json({
  contract: process.env.RPC_STAKING_ADDRESS || 'Not deployed',
  pricing: 'USD-denominated (dynamic based on JEJU price)',
  tiers: {
    FREE: { minUsd: 0, rateLimit: 10, description: '10 requests/minute' },
    BASIC: { minUsd: 10, rateLimit: 100, description: '100 requests/minute' },
    PRO: { minUsd: 100, rateLimit: 1000, description: '1,000 requests/minute' },
    UNLIMITED: { minUsd: 1000, rateLimit: 'unlimited', description: 'Unlimited requests' },
  },
  unbondingPeriod: '7 days',
  reputationDiscount: 'Up to 50% effective stake multiplier for high-reputation users',
  priceOracle: 'Chainlink-compatible, with $0.10 fallback',
}));

// X402 Payment Endpoints
rpcApp.get('/v1/payments', (c) => {
  const info = getPaymentInfo();
  return c.json({
    x402Enabled: info.enabled,
    pricing: { standard: info.pricing.standard.toString(), archive: info.pricing.archive.toString(), trace: info.pricing.trace.toString() },
    acceptedAssets: info.acceptedAssets,
    recipient: info.recipient,
    description: 'Pay-per-request pricing for RPC access without staking',
  });
});

rpcApp.get('/v1/payments/credits', (c) => {
  const address = getValidatedAddress(c);
  if (!address) return c.json({ error: 'Valid X-Wallet-Address header required' }, 401);
  const balance = getCredits(address);
  return c.json({ address, credits: balance.toString(), creditsFormatted: `${Number(balance) / 1e18} JEJU` });
});

rpcApp.post('/v1/payments/credits', async (c) => {
  const address = getValidatedAddress(c);
  if (!address) return c.json({ error: 'Valid X-Wallet-Address header required' }, 401);

  let body: { txHash?: string; amount?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const { txHash, amount } = body;
  if (!txHash || !amount) return c.json({ error: 'txHash and amount required' }, 400);

  const result = purchaseCredits(address, txHash, BigInt(amount));
  return c.json({ success: result.success, newBalance: result.newBalance.toString(), message: 'Credits added to your account' });
});

rpcApp.get('/v1/payments/requirement', (c) => {
  const chainId = Number(c.req.query('chainId') || '1');
  const method = c.req.query('method') || 'eth_blockNumber';
  return c.json(generatePaymentRequirement(chainId, method), 402);
});

// MCP Server Endpoints
const MCP_SERVER_INFO = {
  name: 'jeju-rpc-gateway',
  version: '1.0.0',
  description: 'Multi-chain RPC Gateway with stake-based rate limiting',
  capabilities: { resources: true, tools: true, prompts: false },
};

const MCP_RESOURCES = [
  { uri: 'rpc://chains', name: 'Supported Chains', description: 'All supported blockchain networks', mimeType: 'application/json' },
  { uri: 'rpc://health', name: 'Endpoint Health', description: 'Health status of all RPC endpoints', mimeType: 'application/json' },
  { uri: 'rpc://tiers', name: 'Rate Limit Tiers', description: 'Available staking tiers and rate limits', mimeType: 'application/json' },
];

const MCP_TOOLS = [
  { name: 'list_chains', description: 'List all supported chains', inputSchema: { type: 'object', properties: { testnet: { type: 'boolean' } } } },
  { name: 'get_chain', description: 'Get chain details', inputSchema: { type: 'object', properties: { chainId: { type: 'number' } }, required: ['chainId'] } },
  { name: 'create_api_key', description: 'Create new API key', inputSchema: { type: 'object', properties: { address: { type: 'string' }, name: { type: 'string' } }, required: ['address'] } },
  { name: 'check_rate_limit', description: 'Check rate limit for address', inputSchema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] } },
  { name: 'get_usage', description: 'Get usage statistics', inputSchema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] } },
];

rpcApp.post('/mcp/initialize', (c) => c.json({ protocolVersion: '2024-11-05', serverInfo: MCP_SERVER_INFO, capabilities: MCP_SERVER_INFO.capabilities }));
rpcApp.post('/mcp/resources/list', (c) => c.json({ resources: MCP_RESOURCES }));

rpcApp.post('/mcp/resources/read', async (c) => {
  let body: { uri: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  
  const { uri } = body;
  if (!uri || typeof uri !== 'string') return c.json({ error: 'Missing or invalid uri' }, 400);

  let contents: unknown;
  switch (uri) {
    case 'rpc://chains':
      contents = Object.values(CHAINS).map(chain => ({ chainId: chain.chainId, name: chain.name, isTestnet: chain.isTestnet, endpoint: `/v1/rpc/${chain.chainId}` }));
      break;
    case 'rpc://health':
      contents = getEndpointHealth();
      break;
    case 'rpc://tiers':
      contents = { FREE: { stake: 0, limit: 10 }, BASIC: { stake: 100, limit: 100 }, PRO: { stake: 1000, limit: 1000 }, UNLIMITED: { stake: 10000, limit: 'unlimited' } };
      break;
    default:
      return c.json({ error: 'Resource not found' }, 404);
  }

  return c.json({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(contents, null, 2) }] });
});

rpcApp.post('/mcp/tools/list', (c) => c.json({ tools: MCP_TOOLS }));

rpcApp.post('/mcp/tools/call', async (c) => {
  let body: { name: string; arguments: Record<string, unknown> };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const { name, arguments: args = {} } = body;
  if (!name || typeof name !== 'string') return c.json({ error: 'Missing or invalid tool name' }, 400);

  let result: unknown;
  let isError = false;

  switch (name) {
    case 'list_chains': {
      const testnet = args.testnet as boolean | undefined;
      let chains = Object.values(CHAINS);
      if (testnet !== undefined) chains = chains.filter(ch => ch.isTestnet === testnet);
      result = { chains: chains.map(ch => ({ chainId: ch.chainId, name: ch.name, isTestnet: ch.isTestnet })) };
      break;
    }
    case 'get_chain': {
      const chainId = args.chainId as number;
      if (typeof chainId !== 'number' || !isChainSupported(chainId)) { result = { error: `Unsupported chain: ${chainId}` }; isError = true; }
      else result = getChain(chainId);
      break;
    }
    case 'create_api_key': {
      const address = args.address as string;
      if (!address || !isAddress(address)) { result = { error: 'Invalid address' }; isError = true; break; }
      const existingKeys = getApiKeysForAddress(address as Address);
      if (existingKeys.filter(k => k.isActive).length >= MAX_API_KEYS_PER_ADDRESS) { result = { error: `Maximum API keys reached (${MAX_API_KEYS_PER_ADDRESS})` }; isError = true; break; }
      const keyName = ((args.name as string) || 'MCP Generated').slice(0, 100);
      const { key, record } = createApiKey(address as Address, keyName);
      result = { key, id: record.id, tier: record.tier };
      break;
    }
    case 'check_rate_limit': {
      const address = args.address as string;
      if (!address || !isAddress(address)) { result = { error: 'Invalid address' }; isError = true; break; }
      const keys = getApiKeysForAddress(address as Address);
      result = { address, apiKeys: keys.length, tiers: RATE_LIMITS };
      break;
    }
    case 'get_usage': {
      const address = args.address as string;
      if (!address || !isAddress(address)) { result = { error: 'Invalid address' }; isError = true; break; }
      const keys = getApiKeysForAddress(address as Address);
      result = { address, apiKeys: keys.length, totalRequests: keys.reduce((sum, k) => sum + k.requestCount, 0) };
      break;
    }
    default:
      result = { error: 'Tool not found' };
      isError = true;
  }

  return c.json({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError });
});

rpcApp.get('/mcp', (c) => c.json({
  server: MCP_SERVER_INFO.name,
  version: MCP_SERVER_INFO.version,
  description: MCP_SERVER_INFO.description,
  resources: MCP_RESOURCES,
  tools: MCP_TOOLS,
  capabilities: MCP_SERVER_INFO.capabilities,
}));

// Server startup function
export function startRpcServer(port = 4004, host = '0.0.0.0') {
  console.log(`🌐 RPC Gateway starting on http://${host}:${port}`);
  console.log(`   Supported chains: ${Object.keys(CHAINS).length}`);
  console.log(`   MCP endpoint: http://${host}:${port}/mcp`);
  console.log(`   RPC endpoint: http://${host}:${port}/v1/rpc/:chainId`);

  return {
    port,
    hostname: host,
    fetch: rpcApp.fetch,
  };
}

export default rpcApp;
