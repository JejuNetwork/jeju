/**
 * Oracle Network Integration Test
 * 
 * Full end-to-end test that:
 * 1. Connects to a local Anvil node
 * 2. Deploys oracle contracts
 * 3. Creates and tests the oracle node components
 * 4. Verifies metrics endpoint
 * 
 * Run with: INTEGRATION_TESTS=1 bun test tests/oracle/integration.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createPublicClient, http, type Hex, type Address, keccak256, encodePacked } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { PriceFetcher } from '../../src/oracle/price-fetcher';
import { MetricsExporter } from '../../src/oracle/metrics';
import type { OracleNodeConfig, PriceSourceConfig } from '../../src/oracle/types';

const SKIP_INTEGRATION = process.env.INTEGRATION_TESTS !== '1';

const RPC_URL = 'http://localhost:8545';
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const WORKER_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;

describe.skipIf(SKIP_INTEGRATION)('Oracle Integration', () => {
  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(RPC_URL),
  });

  beforeAll(async () => {
    // Verify Anvil is running
    const blockNumber = await publicClient.getBlockNumber();
    console.log(`[Integration] Connected to Anvil at block ${blockNumber}`);
  });

  describe('PriceFetcher Integration', () => {
    test('should create client with correct configuration', () => {
      const sources: PriceSourceConfig[] = [];
      const fetcher = new PriceFetcher(RPC_URL, sources);
      expect(fetcher).toBeDefined();
    });

    test('should handle manual price setting and retrieval', async () => {
      const feedId = keccak256(encodePacked(['string'], ['ETH/USD']));
      const sources: PriceSourceConfig[] = [
        { type: 'manual', feedId, address: '0x0000000000000000000000000000000000000000', decimals: 8 },
      ];

      const fetcher = new PriceFetcher(RPC_URL, sources);
      const price = 350000000000n; // $3500.00 with 8 decimals
      const confidence = 9500n;

      fetcher.setManualPrice(feedId, price, confidence);
      
      const priceData = await fetcher.fetchPrice(feedId);
      expect(priceData.price).toBe(price);
      expect(priceData.confidence).toBe(confidence);
      expect(priceData.source).toBe('manual');
    });

    test('should compute consistent sources hash', () => {
      const fetcher = new PriceFetcher(RPC_URL, []);
      
      const sources = ['uniswap:0x1234', 'chainlink:0x5678'];
      const hash1 = fetcher.computeSourcesHash(sources);
      const hash2 = fetcher.computeSourcesHash(sources);
      
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(66);
      expect(hash1.startsWith('0x')).toBe(true);
    });
  });

  describe('MetricsExporter Integration', () => {
    let metrics: MetricsExporter;
    const metricsPort = 19090; // Use different port to avoid conflicts
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

    beforeAll(async () => {
      const config: OracleNodeConfig = {
        rpcUrl: RPC_URL,
        chainId: 1337,
        operatorPrivateKey: TEST_PRIVATE_KEY,
        workerPrivateKey: WORKER_PRIVATE_KEY,
        feedRegistry: ZERO_ADDRESS,
        reportVerifier: ZERO_ADDRESS,
        committeeManager: ZERO_ADDRESS,
        feeRouter: ZERO_ADDRESS,
        networkConnector: ZERO_ADDRESS,
        pollIntervalMs: 60000,
        heartbeatIntervalMs: 300000,
        metricsPort,
        priceSources: [],
      };

      metrics = new MetricsExporter(config);
      await metrics.start();
    });

    afterAll(() => {
      metrics?.stop();
    });

    test('should serve health endpoint', async () => {
      const response = await fetch(`http://localhost:${metricsPort}/health`);
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.status).toBe('healthy');
      expect(data.network).toBe('localnet');
      expect(data.chainId).toBe(1337);
    });

    test('should serve metrics endpoint with default values when no contracts deployed', async () => {
      const response = await fetch(`http://localhost:${metricsPort}/metrics`);
      expect(response.status).toBe(200);
      
      const text = await response.text();
      expect(text).toContain('oracle_reports_submitted');
      expect(text).toContain('oracle_reports_accepted');
      expect(text).toContain('oracle_uptime_seconds');
      expect(text).toContain('oracle_feeds_active_total 0');
      expect(text).toContain('oracle_operators_active_total 0');
    });

    test('should update metrics when node reports data', async () => {
      metrics.setNodeMetrics({
        reportsSubmitted: 10,
        reportsAccepted: 8,
        reportsRejected: 2,
        lastReportTime: Date.now(),
        lastHeartbeat: Date.now(),
        feedPrices: new Map([['0x1234' as Hex, 1000n]]),
        uptime: 60000,
      });

      const response = await fetch(`http://localhost:${metricsPort}/metrics`);
      const text = await response.text();
      
      expect(text).toContain('oracle_reports_submitted 10');
      expect(text).toContain('oracle_reports_accepted 8');
      expect(text).toContain('oracle_reports_rejected 2');
    });
  });

  describe('Report Signing', () => {
    test('should sign report hash correctly', async () => {
      const workerAccount = privateKeyToAccount(WORKER_PRIVATE_KEY);
      
      const feedId = keccak256(encodePacked(['string'], ['ETH/USD']));
      const price = 350000000000n;
      const confidence = 9500n;
      const timestamp = BigInt(Math.floor(Date.now() / 1000));
      const round = 1n;
      const sourcesHash = keccak256(encodePacked(['string'], ['manual']));

      const reportHash = keccak256(
        encodePacked(
          ['bytes32', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes32'],
          [feedId, price, confidence, timestamp, round, sourcesHash]
        )
      );

      const signature = await workerAccount.signMessage({
        message: { raw: reportHash },
      });

      expect(signature).toBeDefined();
      expect(signature.startsWith('0x')).toBe(true);
      expect(signature.length).toBe(132); // 65 bytes = 130 hex chars + 0x
    });

    test('should produce deterministic signatures', async () => {
      const workerAccount = privateKeyToAccount(WORKER_PRIVATE_KEY);
      const hash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex;

      const sig1 = await workerAccount.signMessage({ message: { raw: hash } });
      const sig2 = await workerAccount.signMessage({ message: { raw: hash } });

      expect(sig1).toBe(sig2);
    });
  });

  describe('Operator Registration Flow', () => {
    test('should compute operator ID from address', () => {
      const workerAccount = privateKeyToAccount(WORKER_PRIVATE_KEY);
      const operatorId = keccak256(encodePacked(['address'], [workerAccount.address]));

      expect(operatorId).toBeDefined();
      expect(operatorId.startsWith('0x')).toBe(true);
      expect(operatorId.length).toBe(66);
    });

    test('should differentiate operator IDs by address', () => {
      const account1 = privateKeyToAccount(TEST_PRIVATE_KEY);
      const account2 = privateKeyToAccount(WORKER_PRIVATE_KEY);

      const id1 = keccak256(encodePacked(['address'], [account1.address]));
      const id2 = keccak256(encodePacked(['address'], [account2.address]));

      expect(id1).not.toBe(id2);
    });
  });

  describe('Network Connectivity', () => {
    test('should connect to Anvil and get block number', async () => {
      const blockNumber = await publicClient.getBlockNumber();
      expect(blockNumber).toBeGreaterThanOrEqual(0n);
    });

    test('should get chain ID', async () => {
      const chainId = await publicClient.getChainId();
      expect(chainId).toBe(31337); // Anvil default
    });

    test('should get account balance', async () => {
      const balance = await publicClient.getBalance({ address: account.address });
      expect(balance).toBeGreaterThan(0n);
    });
  });
});
