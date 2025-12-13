import { Hono } from 'hono';
import type { SupportedResponse } from '../lib/types';
import { config } from '../config';
import { CHAIN_CONFIGS, ZERO_ADDRESS } from '../lib/chains';

const app = new Hono();

app.get('/', (c) => {
  const cfg = config();
  const networks = Object.keys(CHAIN_CONFIGS);

  const kinds: Array<{ scheme: 'exact' | 'upto'; network: string }> = [];

  for (const network of networks) {
    const chainConfig = CHAIN_CONFIGS[network];
    const hasFacilitator = chainConfig.facilitator !== ZERO_ADDRESS;
    const isPrimary = network === cfg.network;

    if (hasFacilitator || cfg.environment === 'development' || isPrimary) {
      kinds.push({ scheme: 'exact', network }, { scheme: 'upto', network });
    }
  }

  const response: SupportedResponse = {
    kinds,
    x402Version: 1,
    facilitator: {
      name: cfg.serviceName,
      version: cfg.serviceVersion,
      url: cfg.serviceUrl,
    },
  };

  return c.json(response);
});

app.get('/networks', (c) => {
  const networks = Object.keys(CHAIN_CONFIGS);

  const details = networks.map((network) => {
    const chainConfig = CHAIN_CONFIGS[network];
    return {
      network,
      chainId: chainConfig.chainId,
      name: chainConfig.name,
      usdc: chainConfig.usdc,
      facilitator: chainConfig.facilitator,
      blockExplorer: chainConfig.blockExplorer || null,
    };
  });

  return c.json({ networks: details });
});

app.get('/tokens/:network', (c) => {
  const network = c.req.param('network');
  const chainConfig = CHAIN_CONFIGS[network];

  if (!chainConfig) {
    return c.json({ error: `Unsupported network: ${network}` }, 400);
  }

  const tokens = [];

  if (chainConfig.usdc !== ZERO_ADDRESS) {
    tokens.push({
      address: chainConfig.usdc,
      symbol: 'USDC',
      decimals: 6,
      name: 'USD Coin',
    });
  }

  tokens.push({
    address: ZERO_ADDRESS,
    symbol: chainConfig.nativeCurrency.symbol,
    decimals: chainConfig.nativeCurrency.decimals,
    name: chainConfig.nativeCurrency.name,
  });

  return c.json({ network, tokens });
});

export default app;
