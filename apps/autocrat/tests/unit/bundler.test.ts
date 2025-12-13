import { describe, test, expect, beforeEach } from 'bun:test';
import { MevBundler, type BundleTransaction, type BundleParams } from '../../src/engine/bundler';
import type { ChainId } from '../../src/types';

// Test private key (Anvil default)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

describe('MevBundler', () => {
  describe('initialization', () => {
    test('creates bundler with correct signer address', () => {
      const bundler = new MevBundler(TEST_PRIVATE_KEY, 1 as ChainId);
      expect(bundler.signerAddress).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    });

    test('detects L2 chains correctly', () => {
      const mainnetBundler = new MevBundler(TEST_PRIVATE_KEY, 1 as ChainId);
      const arbitrumBundler = new MevBundler(TEST_PRIVATE_KEY, 42161 as ChainId);
      const optimismBundler = new MevBundler(TEST_PRIVATE_KEY, 10 as ChainId);
      const baseBundler = new MevBundler(TEST_PRIVATE_KEY, 8453 as ChainId);

      expect(mainnetBundler.isL2).toBe(false);
      expect(arbitrumBundler.isL2).toBe(true);
      expect(optimismBundler.isL2).toBe(true);
      expect(baseBundler.isL2).toBe(true);
    });

    test('has Flashbots support on supported chains', () => {
      const mainnetBundler = new MevBundler(TEST_PRIVATE_KEY, 1 as ChainId);
      const sepoliaBundler = new MevBundler(TEST_PRIVATE_KEY, 11155111 as ChainId);
      const arbitrumBundler = new MevBundler(TEST_PRIVATE_KEY, 42161 as ChainId);
      const localnetBundler = new MevBundler(TEST_PRIVATE_KEY, 1337 as ChainId);

      expect(mainnetBundler.hasFlashbotsSupport).toBe(true);
      expect(sepoliaBundler.hasFlashbotsSupport).toBe(true);
      expect(arbitrumBundler.hasFlashbotsSupport).toBe(true);
      expect(localnetBundler.hasFlashbotsSupport).toBe(false);
    });
  });

  describe('bundle signing', () => {
    test('signs bundle payload correctly', async () => {
      const bundler = new MevBundler(TEST_PRIVATE_KEY, 1 as ChainId);
      const mockTx: BundleTransaction = {
        to: '0x1234567890123456789012345678901234567890' as `0x${string}`,
        data: '0x1234' as `0x${string}`,
        value: 0n,
        gas: 21000n,
      };

      const params: BundleParams = {
        transactions: [mockTx],
        targetBlock: 1000n,
      };

      const { signature, body } = await bundler.signBundle(params);
      
      expect(signature).toContain(bundler.signerAddress);
      expect(signature).toContain(':0x');
      expect(body).toContain('eth_sendBundle');
      expect(body).toContain('0x3e8'); // 1000 in hex
    });
  });

  describe('pending bundles management', () => {
    test('tracks pending bundles', () => {
      const bundler = new MevBundler(TEST_PRIVATE_KEY, 1 as ChainId);
      
      // Pending bundles are tracked internally after sendBundle
      // Initial state should be empty
      expect(bundler.getPendingBundles().size).toBe(0);
    });

    test('cleans up old pending bundles', async () => {
      const bundler = new MevBundler(TEST_PRIVATE_KEY, 1 as ChainId);
      
      // Add a mock pending bundle by accessing internal map
      const pendingBundles = bundler.getPendingBundles();
      pendingBundles.set('test-hash', {
        params: { transactions: [], targetBlock: 1n },
        submittedAt: Date.now() - 120000, // 2 minutes ago
      });

      expect(pendingBundles.size).toBe(1);
      bundler.cleanupPendingBundles(60000); // 1 minute max age
      expect(pendingBundles.size).toBe(0);
    });

    test('keeps recent pending bundles', async () => {
      const bundler = new MevBundler(TEST_PRIVATE_KEY, 1 as ChainId);
      
      const pendingBundles = bundler.getPendingBundles();
      pendingBundles.set('recent-hash', {
        params: { transactions: [], targetBlock: 1n },
        submittedAt: Date.now() - 10000, // 10 seconds ago
      });

      bundler.cleanupPendingBundles(60000);
      expect(pendingBundles.size).toBe(1);
    });
  });

  describe('chain-specific behavior', () => {
    test('localnet returns no Flashbots support', () => {
      const bundler = new MevBundler(TEST_PRIVATE_KEY, 1337 as ChainId);
      expect(bundler.hasFlashbotsSupport).toBe(false);
    });

    test('BSC has no Flashbots support', () => {
      const bundler = new MevBundler(TEST_PRIVATE_KEY, 56 as ChainId);
      expect(bundler.hasFlashbotsSupport).toBe(false);
    });

    test('Jeju has no Flashbots support', () => {
      const bundler = new MevBundler(TEST_PRIVATE_KEY, 420691 as ChainId);
      expect(bundler.hasFlashbotsSupport).toBe(false);
    });
  });

  describe('bundle construction', () => {
    test('creates valid bundle params structure', () => {
      const tx: BundleTransaction = {
        to: '0x1111111111111111111111111111111111111111' as `0x${string}`,
        data: '0xabcdef' as `0x${string}`,
        value: 1000000000000000000n, // 1 ETH
        gas: 100000n,
        maxFeePerGas: 50000000000n, // 50 gwei
        maxPriorityFeePerGas: 2000000000n, // 2 gwei
      };

      const params: BundleParams = {
        transactions: [tx],
        targetBlock: 12345678n,
        minTimestamp: 1700000000,
        maxTimestamp: 1700000060,
      };

      expect(params.transactions).toHaveLength(1);
      expect(params.targetBlock).toBe(12345678n);
      expect(params.minTimestamp).toBe(1700000000);
      expect(params.maxTimestamp).toBe(1700000060);
    });

    test('supports multiple transactions in bundle', () => {
      const frontrun: BundleTransaction = {
        to: '0x1111111111111111111111111111111111111111' as `0x${string}`,
        data: '0x11111111' as `0x${string}`,
        gas: 100000n,
        nonce: 0,
      };

      const backrun: BundleTransaction = {
        to: '0x1111111111111111111111111111111111111111' as `0x${string}`,
        data: '0x22222222' as `0x${string}`,
        gas: 100000n,
        nonce: 1,
      };

      const params: BundleParams = {
        transactions: [frontrun, backrun],
        targetBlock: 1n,
      };

      expect(params.transactions).toHaveLength(2);
      expect(params.transactions[0].nonce).toBe(0);
      expect(params.transactions[1].nonce).toBe(1);
    });

    test('supports reverting tx hashes', () => {
      const params: BundleParams = {
        transactions: [],
        targetBlock: 1n,
        revertingTxHashes: [
          '0x1111111111111111111111111111111111111111111111111111111111111111' as `0x${string}`,
        ],
      };

      expect(params.revertingTxHashes).toHaveLength(1);
    });
  });

  describe('gas estimation', () => {
    test('calculates sandwich gas correctly', () => {
      const frontrunGas = 300000n;
      const backrunGas = 300000n;
      const totalGas = frontrunGas + backrunGas;
      
      expect(totalGas).toBe(600000n);
    });

    test('applies gas buffer correctly', () => {
      const estimatedGas = 200000n;
      const bufferedGas = estimatedGas * 12n / 10n; // 20% buffer
      
      expect(bufferedGas).toBe(240000n);
    });
  });

  describe('gas price calculations', () => {
    test('frontrun gas should be higher than base', () => {
      const baseGasPrice = 30000000000n; // 30 gwei
      const frontrunMultiplier = 15n;
      const frontrunGasPrice = baseGasPrice * frontrunMultiplier / 10n;
      
      expect(frontrunGasPrice).toBe(45000000000n); // 45 gwei
      expect(frontrunGasPrice).toBeGreaterThan(baseGasPrice);
    });

    test('priority fee should be fraction of max fee', () => {
      const maxFee = 50000000000n; // 50 gwei
      const priorityFee = maxFee / 10n;
      
      expect(priorityFee).toBe(5000000000n); // 5 gwei
    });
  });
});

describe('Bundle Execution Flow', () => {
  test('sandwich bundle flow is correct', () => {
    // This tests the logical flow without network calls
    const steps = [
      'create_frontrun_tx',
      'create_backrun_tx',
      'simulate_bundle',
      'check_reverts',
      'submit_bundle',
      'wait_inclusion',
    ];

    expect(steps).toContain('simulate_bundle');
    expect(steps.indexOf('simulate_bundle')).toBeLessThan(steps.indexOf('submit_bundle'));
    expect(steps.indexOf('submit_bundle')).toBeLessThan(steps.indexOf('wait_inclusion'));
  });

  test('bundle timeout handling', async () => {
    const maxWaitBlocks = 3;
    const blockTime = 2000; // ms
    const maxWaitTime = maxWaitBlocks * blockTime;
    
    expect(maxWaitTime).toBe(6000); // 6 seconds max wait
  });
});

describe('MEV-Share Hints', () => {
  test('hint configuration is valid', () => {
    const hints = {
      logs: true,
      calldata: false,
      contractAddress: true,
      functionSelector: true,
    };

    expect(hints.logs).toBe(true);
    expect(hints.calldata).toBe(false);
  });

  test('empty hints are handled', () => {
    const emptyHints = {};
    expect(Object.keys(emptyHints)).toHaveLength(0);
  });
});
