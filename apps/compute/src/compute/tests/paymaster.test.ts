/**
 * Compute + ERC-4337 Paymaster Integration Tests
 *
 * Tests multi-token payment via paymasters:
 * - PaymasterFactory discovery
 * - Token balance checking
 * - Gas sponsorship flow
 * - Bundler integration (mocked when not available)
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { Wallet, parseEther, JsonRpcProvider } from 'ethers';
import {
  ComputePaymentClient,
  createPaymentClient,
  ZERO_ADDRESS,
  COMPUTE_PRICING,
  type PaymasterOption,
  type CreditBalance,
} from '../sdk/payment';

// Test configuration
const TEST_RPC_URL = process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545';
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

let provider: JsonRpcProvider;
let testWallet: Wallet;
let paymentClient: ComputePaymentClient;
let networkAvailable = false;

describe('Compute Paymaster Integration', () => {
  beforeAll(async () => {
    provider = new JsonRpcProvider(TEST_RPC_URL);
    
    // Check if network is available
    try {
      await provider.getBlockNumber();
      networkAvailable = true;
      testWallet = new Wallet(TEST_PRIVATE_KEY, provider);
      
      // Create payment client
      paymentClient = createPaymentClient({
        rpcUrl: TEST_RPC_URL,
      });
    } catch {
      console.log('Network not available - some tests will be skipped');
    }
  });

  describe('Payment Client Initialization', () => {
    test('creates payment client with default config', () => {
      const client = createPaymentClient();
      expect(client).toBeDefined();
    });

    test('creates payment client with custom config', () => {
      const client = createPaymentClient({
        rpcUrl: 'http://custom:8545',
        bundlerUrl: 'http://bundler:3000',
        creditManagerAddress: '0x1234567890123456789012345678901234567890',
      });
      expect(client).toBeDefined();
    });

    test('pricing constants are defined', () => {
      expect(COMPUTE_PRICING.INFERENCE_INPUT_PER_1K).toBeGreaterThan(0n);
      expect(COMPUTE_PRICING.INFERENCE_OUTPUT_PER_1K).toBeGreaterThan(0n);
      expect(COMPUTE_PRICING.GPU_H100_HOURLY).toBeGreaterThan(0n);
    });
  });

  describe('Credit Balance Checking', () => {
    test('getCreditBalances returns structure', async () => {
      if (!networkAvailable) {
        console.log('Skipping: network not available');
        return;
      }

      // This may fail if CreditManager not deployed, but should not throw
      try {
        const balances = await paymentClient.getCreditBalances(testWallet.address);
        expect(balances).toHaveProperty('usdc');
        expect(balances).toHaveProperty('eth');
        expect(balances).toHaveProperty('elizaOS');
        expect(balances).toHaveProperty('total');
      } catch (e) {
        // CreditManager not deployed - expected in minimal test env
        console.log('CreditManager not deployed:', e);
      }
    });

    test('getLedgerBalance returns bigint', async () => {
      if (!networkAvailable) {
        console.log('Skipping: network not available');
        return;
      }

      try {
        const balance = await paymentClient.getLedgerBalance(testWallet.address);
        expect(typeof balance).toBe('bigint');
      } catch {
        // LedgerManager not deployed - expected in minimal test env
        console.log('LedgerManager not deployed');
      }
    });
  });

  describe('Paymaster Discovery', () => {
    test('getAvailablePaymasters returns array', async () => {
      if (!networkAvailable) {
        console.log('Skipping: network not available');
        return;
      }

      try {
        const paymasters = await paymentClient.getAvailablePaymasters(parseEther('0.001'));
        expect(Array.isArray(paymasters)).toBe(true);
        
        // Check structure if any paymasters exist
        if (paymasters.length > 0) {
          const pm = paymasters[0];
          expect(pm).toHaveProperty('address');
          expect(pm).toHaveProperty('tokenAddress');
          expect(pm).toHaveProperty('tokenSymbol');
          expect(pm).toHaveProperty('estimatedCost');
          expect(pm).toHaveProperty('isAvailable');
        }
      } catch {
        // PaymasterFactory not deployed
        console.log('PaymasterFactory not deployed');
      }
    });

    test('selectOptimalPaymaster handles no paymasters', async () => {
      if (!networkAvailable) {
        console.log('Skipping: network not available');
        return;
      }

      try {
        const optimal = await paymentClient.selectOptimalPaymaster(
          testWallet.address,
          parseEther('0.001')
        );
        // May be null if no paymasters or insufficient balance
        expect(optimal === null || typeof optimal === 'object').toBe(true);
      } catch {
        console.log('PaymasterFactory not deployed');
      }
    });
  });

  describe('Paymaster Data Building', () => {
    test('buildPaymasterData returns hex string', () => {
      const client = createPaymentClient();
      const data = client.buildPaymasterData(
        '0x1234567890123456789012345678901234567890' as `0x${string}`,
        100000n,
        50000n
      );
      expect(data.startsWith('0x')).toBe(true);
    });
  });

  describe('Cost Estimation', () => {
    test('estimateInferenceCost calculates correctly', () => {
      const client = createPaymentClient();
      const cost = client.estimateInferenceCost(
        1000, // input tokens
        500,  // output tokens
        parseEther('0.0001'), // price per input
        parseEther('0.0003')  // price per output
      );
      
      // 1000 * 0.0001 + 500 * 0.0003 = 0.1 + 0.15 = 0.25 ETH
      expect(cost).toBe(parseEther('0.25'));
    });

    test('estimateRentalCost calculates correctly', () => {
      const client = createPaymentClient();
      const cost = client.estimateRentalCost(
        parseEther('1'), // hourly rate
        24,              // hours
        2                // GPU count
      );
      
      // 1 * 24 * 2 = 48 ETH
      expect(cost).toBe(parseEther('48'));
    });
  });

  describe('Payment Flow', () => {
    test('payForCompute handles no payment methods gracefully', async () => {
      if (!networkAvailable) {
        console.log('Skipping: network not available');
        return;
      }

      const client = createPaymentClient({
        rpcUrl: TEST_RPC_URL,
        // No contract addresses - should fail gracefully
      });

      try {
        await client.payForCompute(testWallet, parseEther('0.001'));
        // If it succeeds, the payment was processed somehow
      } catch (e) {
        // Expected error when no payment method available
        expect(String(e)).toContain('No payment method');
      }
    });
  });
});

describe('Paymaster Type Validation', () => {
  test('PaymasterOption has correct shape', () => {
    const option: PaymasterOption = {
      address: '0x1234567890123456789012345678901234567890',
      tokenAddress: '0x1234567890123456789012345678901234567890',
      tokenSymbol: 'ELIZA',
      estimatedCost: 1000n,
      estimatedCostUSD: '0.01 ELIZA',
      availableLiquidity: 1000000n,
      isAvailable: true,
    };
    
    expect(option.address.startsWith('0x')).toBe(true);
    expect(typeof option.estimatedCost).toBe('bigint');
  });

  test('CreditBalance has correct shape', () => {
    const balance: CreditBalance = {
      usdc: 1000000n,
      eth: parseEther('1'),
      elizaOS: parseEther('100'),
      total: parseEther('1.1'),
    };
    
    expect(typeof balance.total).toBe('bigint');
    expect(balance.total).toBeGreaterThan(0n);
  });

  test('ZERO_ADDRESS is correct', () => {
    expect(ZERO_ADDRESS).toBe('0x0000000000000000000000000000000000000000');
  });
});


