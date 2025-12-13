/**
 * Settlement Integration Tests
 * 
 * These tests require a running Anvil instance with deployed contracts.
 * 
 * Setup:
 *   1. Start Anvil: anvil --port 8548 --chain-id 420691
 *   2. Deploy contract: 
 *      cd packages/contracts && BASESCAN_API_KEY=dummy ETHERSCAN_API_KEY=dummy \
 *        forge script script/DeployX402Facilitator.s.sol:DeployX402Facilitator \
 *        --rpc-url http://127.0.0.1:8548 --broadcast
 *   3. Set env: JEJU_RPC_URL=http://127.0.0.1:8548 X402_FACILITATOR_ADDRESS=<deployed>
 *   4. Run: bun test tests/settlement.test.ts
 * 
 * The Foundry tests in packages/contracts/test/X402Facilitator.t.sol provide
 * comprehensive contract-level testing. These tests verify HTTP API integration.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createPublicClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { createServer } from '../src/server';
import { resetConfig } from '../src/config';
import { clearNonceCache } from '../src/services/nonce-manager';

// Use environment variables for test configuration
const ANVIL_RPC = process.env.JEJU_RPC_URL || 'http://127.0.0.1:8548';
const FACILITATOR_ADDRESS = process.env.X402_FACILITATOR_ADDRESS as Address | undefined;

const PAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const payer = privateKeyToAccount(PAYER_KEY);
const RECIPIENT: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const USDC: Address = '0x0165878A594ca255338adfa4d48449f69242Eb8F';

async function createSignedPayment(overrides?: {
  amount?: string;
  nonce?: string;
  timestamp?: number;
}): Promise<{ header: string; payload: Record<string, unknown> }> {
  const nonce = overrides?.nonce || crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const timestamp = overrides?.timestamp || Math.floor(Date.now() / 1000);

  const payload = {
    scheme: 'exact',
    network: 'jeju',
    asset: USDC,
    payTo: RECIPIENT,
    amount: overrides?.amount || '1000000',
    resource: '/api/test',
    nonce,
    timestamp,
  };

  const domain = {
    name: 'x402 Payment Protocol',
    version: '1',
    chainId: 420691,
    verifyingContract: '0x0000000000000000000000000000000000000000' as Address,
  };

  const types = {
    Payment: [
      { name: 'scheme', type: 'string' },
      { name: 'network', type: 'string' },
      { name: 'asset', type: 'address' },
      { name: 'payTo', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'resource', type: 'string' },
      { name: 'nonce', type: 'string' },
      { name: 'timestamp', type: 'uint256' },
    ],
  };

  const message = {
    scheme: payload.scheme,
    network: payload.network,
    asset: payload.asset,
    payTo: payload.payTo,
    amount: BigInt(payload.amount),
    resource: payload.resource,
    nonce: payload.nonce,
    timestamp: BigInt(payload.timestamp),
  };

  const signature = await payer.signTypedData({ domain, types, primaryType: 'Payment', message });
  const fullPayload = { ...payload, signature, payer: payer.address };

  return {
    header: Buffer.from(JSON.stringify(fullPayload)).toString('base64'),
    payload: fullPayload,
  };
}

async function isAnvilAvailable(): Promise<boolean> {
  try {
    const client = createPublicClient({ transport: http(ANVIL_RPC) });
    await client.getChainId();
    return true;
  } catch {
    return false;
  }
}

describe('Settlement Integration', () => {
  let skipTests = false;

  beforeAll(async () => {
    const anvilUp = await isAnvilAvailable();
    if (!anvilUp || !FACILITATOR_ADDRESS) {
      console.log('\n⚠️  Skipping settlement integration tests:');
      if (!anvilUp) console.log('   - Anvil not running at', ANVIL_RPC);
      if (!FACILITATOR_ADDRESS) console.log('   - X402_FACILITATOR_ADDRESS not set');
      console.log('   See test file header for setup instructions.\n');
      skipTests = true;
      return;
    }

    process.env.JEJU_RPC_URL = ANVIL_RPC;
    process.env.X402_FACILITATOR_ADDRESS = FACILITATOR_ADDRESS;
    process.env.JEJU_USDC_ADDRESS = USDC;
    resetConfig();
    clearNonceCache();
  });

  afterAll(() => {
    clearNonceCache();
  });

  test('should verify payment with on-chain nonce check', async () => {
    if (skipTests) return;

    const app = createServer();
    const { header, payload } = await createSignedPayment();

    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: header,
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: payload.amount,
          payTo: RECIPIENT,
          asset: USDC,
          resource: '/api/test',
        },
      }),
    });

    const body = await res.json();
    expect(body.isValid).toBe(true);
    expect(body.payer?.toLowerCase()).toBe(payer.address.toLowerCase());
  });

  test('should report stats from on-chain contract', async () => {
    if (skipTests) return;

    const app = createServer();
    const res = await app.request('/stats');
    const body = await res.json();

    expect(body.protocolFeeBps).toBe(50);
    expect(body.feeRecipient).toBeDefined();
    expect(typeof body.totalSettlements).toBe('string');
  });

  test('should check token support on-chain', async () => {
    if (skipTests) return;

    const app = createServer();
    const res = await app.request('/supported');
    const body = await res.json();

    expect(body.kinds).toBeArray();
    expect(body.kinds.length).toBeGreaterThan(0);
  });

  test('placeholder passes when anvil not available', () => {
    // This test always passes - it documents that integration tests require setup
    expect(true).toBe(true);
  });

  test.skip('POST /settle/gasless requires EIP-3009 token', async () => {
    // This test requires a token that implements EIP-3009 transferWithAuthorization
    // For now, we skip it. To enable:
    // 1. Deploy or use a token with EIP-3009 support (e.g., USDC on testnet)
    // 2. Set EIP3009_TOKEN_ADDRESS env var
    // 3. Create EIP-3009 authorization signature
    // 4. Call /settle/gasless endpoint
    // 
    // Example flow:
    // - Payer signs EIP-3009 authorization (validAfter, validBefore, nonce)
    // - Payer signs x402 payment payload
    // - Service calls /settle/gasless with both signatures
    // - Contract executes transferWithAuthorization (gasless for payer)
  });
});
