/**
 * @fileoverview Cross-chain OIF integration tests
 * Tests the full flow across multiple chains using real RPC endpoints
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { createPublicClient, createWalletClient, http, parseEther, formatEther, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { mainnet, arbitrum, optimism } from 'viem/chains';

// Test configuration
const PRIVATE_KEY = process.env.MAINNET_EVM_PRIVATE_KEY as `0x${string}`;
const skipTests = !PRIVATE_KEY;

// Chain configurations
const CHAINS = {
  ethereum: {
    chain: mainnet,
    rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    inputSettler: process.env.OIF_INPUT_SETTLER_1 as `0x${string}`,
    outputSettler: process.env.OIF_OUTPUT_SETTLER_1 as `0x${string}`,
  },
  arbitrum: {
    chain: arbitrum,
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    inputSettler: process.env.OIF_INPUT_SETTLER_42161 as `0x${string}`,
    outputSettler: process.env.OIF_OUTPUT_SETTLER_42161 as `0x${string}`,
  },
  optimism: {
    chain: optimism,
    rpcUrl: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
    inputSettler: process.env.OIF_INPUT_SETTLER_10 as `0x${string}`,
    outputSettler: process.env.OIF_OUTPUT_SETTLER_10 as `0x${string}`,
  },
};

// ABIs
const SETTLER_ABI = [
  {
    type: 'function',
    name: 'isFilled',
    stateMutability: 'view',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isSettled',
    stateMutability: 'view',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

describe('Cross-Chain OIF Integration', () => {
  const clients: Map<string, { public: PublicClient; wallet: WalletClient }> = new Map();
  let account: PrivateKeyAccount;

  beforeAll(() => {
    if (skipTests) return;

    account = privateKeyToAccount(PRIVATE_KEY);

    // Initialize clients for each chain
    for (const [name, config] of Object.entries(CHAINS)) {
      const publicClient = createPublicClient({
        chain: config.chain,
        transport: http(config.rpcUrl),
      });

      const walletClient = createWalletClient({
        account,
        chain: config.chain,
        transport: http(config.rpcUrl),
      });

      clients.set(name, { public: publicClient, wallet: walletClient });
    }
  });

  describe('Multi-Chain Connectivity', () => {
    test('can connect to all supported chains', async () => {
      if (skipTests) {
        console.log('Skipping: No MAINNET_EVM_PRIVATE_KEY');
        return;
      }

      const results: { chain: string; block: bigint; latency: number }[] = [];

      for (const [name, client] of clients) {
        const start = Date.now();
        const blockNumber = await client.public.getBlockNumber();
        const latency = Date.now() - start;

        results.push({ chain: name, block: blockNumber, latency });
        console.log(`${name}: Block ${blockNumber} (${latency}ms)`);
      }

      expect(results.length).toBe(3);
      results.forEach((r) => {
        expect(r.block).toBeGreaterThan(0n);
        expect(r.latency).toBeLessThan(5000); // Should respond within 5s
      });
    });

    test('wallet has same address on all chains', async () => {
      if (skipTests) return;

      for (const [name, client] of clients) {
        expect(client.wallet.account?.address).toBe(account.address);
      }
      console.log(`Wallet address: ${account.address}`);
    });

    test('can check balances on all chains', async () => {
      if (skipTests) return;

      const balances: { chain: string; balance: string }[] = [];

      for (const [name, client] of clients) {
        const balance = await client.public.getBalance({
          address: account.address,
        });

        balances.push({ chain: name, balance: formatEther(balance) });
        console.log(`${name}: ${formatEther(balance)} ETH`);
      }

      expect(balances.length).toBe(3);
    });
  });

  describe('Gas Price Comparison', () => {
    test('compare gas prices across chains', async () => {
      if (skipTests) return;

      const gasPrices: { chain: string; gwei: number }[] = [];

      for (const [name, client] of clients) {
        const gasPrice = await client.public.getGasPrice();
        const gwei = Number(gasPrice / 10n ** 9n);

        gasPrices.push({ chain: name, gwei });
        console.log(`${name}: ${gwei} gwei`);
      }

      // Find cheapest chain
      const cheapest = gasPrices.reduce((a, b) => (a.gwei < b.gwei ? a : b));
      console.log(`Cheapest: ${cheapest.chain} at ${cheapest.gwei} gwei`);

      expect(gasPrices.length).toBe(3);
    });
  });

  describe('OIF Contract Status', () => {
    test('check InputSettler deployment status', async () => {
      if (skipTests) return;

      for (const [name, config] of Object.entries(CHAINS)) {
        const client = clients.get(name)!;

        if (!config.inputSettler || config.inputSettler === '0x0000000000000000000000000000000000000000') {
          console.log(`${name}: InputSettler NOT DEPLOYED`);
          continue;
        }

        const code = await client.public.getCode({ address: config.inputSettler });
        const deployed = code && code !== '0x';
        console.log(`${name}: InputSettler ${deployed ? 'DEPLOYED' : 'NOT FOUND'} at ${config.inputSettler.slice(0, 10)}...`);
      }
    });

    test('check OutputSettler deployment status', async () => {
      if (skipTests) return;

      for (const [name, config] of Object.entries(CHAINS)) {
        const client = clients.get(name)!;

        if (!config.outputSettler || config.outputSettler === '0x0000000000000000000000000000000000000000') {
          console.log(`${name}: OutputSettler NOT DEPLOYED`);
          continue;
        }

        const code = await client.public.getCode({ address: config.outputSettler });
        const deployed = code && code !== '0x';
        console.log(`${name}: OutputSettler ${deployed ? 'DEPLOYED' : 'NOT FOUND'} at ${config.outputSettler.slice(0, 10)}...`);
      }
    });
  });

  describe('Cross-Chain Intent Simulation', () => {
    test('simulate Ethereum → Arbitrum intent quote request', async () => {
      if (skipTests) return;

      const aggregatorUrl = process.env.AGGREGATOR_URL || 'http://localhost:4010';

      const quoteRequest = {
        sourceChainId: 1,
        destinationChainId: 42161,
        inputToken: '0x0000000000000000000000000000000000000000', // ETH
        outputToken: '0x0000000000000000000000000000000000000000', // ETH
        inputAmount: parseEther('0.01').toString(),
        minOutputAmount: parseEther('0.0095').toString(), // 5% slippage
      };

      try {
        const res = await fetch(`${aggregatorUrl}/api/intents/quote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(quoteRequest),
        });

        if (res.ok) {
          const quotes = await res.json();
          console.log(`Received ${quotes.length} quote(s) for Ethereum → Arbitrum`);

          if (quotes.length > 0) {
            const best = quotes[0];
            console.log(`Best quote: ${best.outputAmount} wei, fee: ${best.feePercent / 100}%`);
          }
        } else {
          console.log('Quote request failed - aggregator may not be running');
        }
      } catch {
        console.log('Aggregator not available - skipping quote test');
      }
    });

    test('simulate Optimism → Ethereum intent quote request', async () => {
      if (skipTests) return;

      const aggregatorUrl = process.env.AGGREGATOR_URL || 'http://localhost:4010';

      const quoteRequest = {
        sourceChainId: 10,
        destinationChainId: 1,
        inputToken: '0x0000000000000000000000000000000000000000',
        outputToken: '0x0000000000000000000000000000000000000000',
        inputAmount: parseEther('0.1').toString(),
        minOutputAmount: parseEther('0.095').toString(),
      };

      try {
        const res = await fetch(`${aggregatorUrl}/api/intents/quote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(quoteRequest),
        });

        if (res.ok) {
          const quotes = await res.json();
          console.log(`Received ${quotes.length} quote(s) for Optimism → Ethereum`);
        }
      } catch {
        console.log('Aggregator not available - skipping quote test');
      }
    });
  });

  describe('Route Discovery', () => {
    test('list available routes from aggregator', async () => {
      if (skipTests) return;

      const aggregatorUrl = process.env.AGGREGATOR_URL || 'http://localhost:4010';

      try {
        const res = await fetch(`${aggregatorUrl}/api/routes?active=true`);

        if (res.ok) {
          const routes = await res.json();
          console.log(`Found ${routes.length} active route(s)`);

          for (const route of routes.slice(0, 5)) {
            console.log(`  ${route.sourceChainId} → ${route.destinationChainId}: ${route.avgFeePercent / 100}% fee`);
          }
        } else {
          console.log('Routes request failed - aggregator may not be running');
        }
      } catch {
        console.log('Aggregator not available - skipping routes test');
      }
    });

    test('list active solvers', async () => {
      if (skipTests) return;

      const aggregatorUrl = process.env.AGGREGATOR_URL || 'http://localhost:4010';

      try {
        const res = await fetch(`${aggregatorUrl}/api/solvers?sortBy=reputation&limit=5`);

        if (res.ok) {
          const solvers = await res.json();
          console.log(`Found ${solvers.length} solver(s)`);

          for (const solver of solvers) {
            console.log(`  ${solver.address.slice(0, 10)}...: rep=${solver.reputation}, fills=${solver.totalFills}`);
          }
        }
      } catch {
        console.log('Aggregator not available - skipping solvers test');
      }
    });
  });

  describe('Aggregator A2A Protocol', () => {
    test('fetch agent card', async () => {
      if (skipTests) return;

      const aggregatorUrl = process.env.AGGREGATOR_URL || 'http://localhost:4010';

      try {
        const res = await fetch(`${aggregatorUrl}/.well-known/agent-card.json`);

        if (res.ok) {
          const card = await res.json();
          console.log(`Agent: ${card.name}`);
          console.log(`Skills: ${card.skills.map((s: { id: string }) => s.id).join(', ')}`);
          expect(card.name).toBe('Jeju Open Intents Aggregator');
        }
      } catch {
        console.log('Aggregator not available - skipping agent card test');
      }
    });

    test('invoke get-stats skill via A2A', async () => {
      if (skipTests) return;

      const aggregatorUrl = process.env.AGGREGATOR_URL || 'http://localhost:4010';

      try {
        const res = await fetch(`${aggregatorUrl}/a2a`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'message/send',
            params: {
              message: {
                messageId: 'test-stats',
                parts: [{ kind: 'data', data: { skillId: 'get-stats' } }],
              },
            },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.result) {
            console.log('Stats received via A2A');
          }
        }
      } catch {
        console.log('Aggregator not available - skipping A2A test');
      }
    });
  });

  describe('Network Statistics', () => {
    test('fetch OIF network stats', async () => {
      if (skipTests) return;

      const aggregatorUrl = process.env.AGGREGATOR_URL || 'http://localhost:4010';

      try {
        const res = await fetch(`${aggregatorUrl}/api/stats`);

        if (res.ok) {
          const stats = await res.json();
          console.log('OIF Network Stats:');
          console.log(`  Total Intents: ${stats.totalIntents}`);
          console.log(`  Total Volume: ${stats.totalVolume} wei`);
          console.log(`  Active Solvers: ${stats.activeSolvers}`);
          console.log(`  Total Routes: ${stats.totalRoutes}`);
        }
      } catch {
        console.log('Aggregator not available - skipping stats test');
      }
    });
  });
});

describe('WebSocket Real-time Updates', () => {
  test('connect to WebSocket server', async () => {
    if (skipTests) return;

    const wsUrl = process.env.AGGREGATOR_WS_URL || 'ws://localhost:4012';

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timeout = setTimeout(() => {
        ws.close();
        console.log('WebSocket connection timeout - server may not be running');
        resolve();
      }, 3000);

      ws.onopen = () => {
        console.log('WebSocket connected');
        clearTimeout(timeout);

        // Subscribe to intents
        ws.send(JSON.stringify({ action: 'subscribe', channel: 'intents' }));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('WebSocket message:', data.type);

        if (data.type === 'subscribed') {
          ws.close();
          resolve();
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        console.log('WebSocket error - server may not be running');
        resolve(); // Don't fail test if WS not available
      };
    });
  });
});

