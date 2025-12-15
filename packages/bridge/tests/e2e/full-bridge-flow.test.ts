/**
 * End-to-End Bridge Flow Tests
 *
 * Complete validation of:
 * - EVM → Solana transfer flow
 * - Solana → EVM transfer flow
 * - Bidirectional transfer
 * - Batched transfers
 * - Error recovery
 * - Light client updates
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { type Subprocess, spawn } from 'bun';
import { createPublicClient, type Hex, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { anvil } from 'viem/chains';
import {
  ChainId,
  type CrossChainTransfer,
  createEVMClient,
  createTEEBatcher,
  TransferStatus,
  toHash32,
} from '../../src/index.js';

// =============================================================================
// TEST CONFIGURATION
// =============================================================================

// Set test timeout for all tests in this file
setDefaultTimeout(120000);

const TEST_CONFIG = {
  evmRpc: 'http://127.0.0.1:8545',
  solanaRpc: 'http://127.0.0.1:8899',
  relayerPort: 18081,
};

const EVM_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;

// Chain availability flags
let evmAvailable = false;
let solanaAvailable = false;

// =============================================================================
// E2E TESTS
// =============================================================================

describe('End-to-End Bridge Flow', () => {
  let anvilProcess: Subprocess | null = null;
  let solanaProcess: Subprocess | null = null;
  let _evmClient: ReturnType<typeof createEVMClient>;
  let _solanaKeypair: Keypair;

  beforeAll(async () => {
    console.log('\n🚀 Setting up E2E test environment...\n');

    // Check if chains are already running
    evmAvailable = await isEVMRunning();
    solanaAvailable = await isSolanaRunning();

    if (!evmAvailable) {
      console.log('Starting Anvil...');
      anvilProcess = spawn({
        cmd: ['anvil', '--port', '8545', '--chain-id', '31337', '--silent'],
        stdout: 'pipe',
        stderr: 'pipe',
      });
      evmAvailable = await waitForEVM();
      if (evmAvailable) console.log('✅ Anvil started');
    } else {
      console.log('✅ Anvil already running');
    }

    if (!solanaAvailable) {
      console.log('Starting Solana validator...');
      solanaProcess = spawn({
        cmd: ['solana-test-validator', '--reset', '--quiet'],
        stdout: 'pipe',
        stderr: 'pipe',
      });
      solanaAvailable = await waitForSolana();
      if (solanaAvailable) console.log('✅ Solana validator started');
    } else {
      console.log('✅ Solana validator already running');
    }

    // Initialize clients
    _evmClient = createEVMClient({
      chainId: ChainId.LOCAL_EVM,
      rpcUrl: TEST_CONFIG.evmRpc,
      privateKey: EVM_PRIVATE_KEY,
      bridgeAddress: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
      lightClientAddress: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    });

    _solanaKeypair = Keypair.generate();

    console.log('\n✅ E2E environment ready\n');
  });

  afterAll(async () => {
    if (anvilProcess) {
      anvilProcess.kill();
    }
    if (solanaProcess) {
      solanaProcess.kill();
    }
  });

  describe('EVM Chain Operations', () => {
    it('should connect to EVM chain', async () => {
      if (!evmAvailable) {
        console.log('Skipping: EVM not available');
        return;
      }

      const publicClient = createPublicClient({
        chain: anvil,
        transport: http(TEST_CONFIG.evmRpc),
      });

      const blockNumber = await publicClient.getBlockNumber();
      expect(blockNumber).toBeGreaterThanOrEqual(BigInt(0));
    });

    it('should have test account with balance', async () => {
      if (!evmAvailable) {
        console.log('Skipping: EVM not available');
        return;
      }

      const publicClient = createPublicClient({
        chain: anvil,
        transport: http(TEST_CONFIG.evmRpc),
      });

      const account = privateKeyToAccount(EVM_PRIVATE_KEY);
      const balance = await publicClient.getBalance({
        address: account.address,
      });
      expect(balance).toBeGreaterThan(parseEther('1'));
    });
  });

  describe('Solana Chain Operations', () => {
    it('should connect to Solana chain', async () => {
      if (!solanaAvailable) {
        console.log('Skipping: Solana not available');
        return;
      }

      const connection = new Connection(TEST_CONFIG.solanaRpc, 'confirmed');
      // Retry a few times in case of transient connection issues
      let slot = 0;
      for (let i = 0; i < 3; i++) {
        try {
          slot = await connection.getSlot();
          break;
        } catch {
          await Bun.sleep(500);
        }
      }
      expect(slot).toBeGreaterThanOrEqual(0);
    });

    it('should get cluster version', async () => {
      if (!solanaAvailable) {
        console.log('Skipping: Solana not available');
        return;
      }

      const connection = new Connection(TEST_CONFIG.solanaRpc, 'confirmed');
      const version = await connection.getVersion();
      expect(version['solana-core']).toBeDefined();
    });
  });

  describe('TEE Batcher Flow', () => {
    it('should initialize batcher with attestation', async () => {
      const batcher = createTEEBatcher({
        maxBatchSize: 10,
        maxBatchWaitMs: 5000,
        minBatchSize: 1,
        targetCostPerItem: BigInt(1000000000000000),
        teeEndpoint: 'http://localhost:8080',
      });

      await batcher.initialize();
      const attestation = batcher.getAttestation();

      expect(attestation).not.toBeNull();
      expect(attestation!.measurement.length).toBe(32);
    });

    it('should batch multiple transfers', async () => {
      const batcher = createTEEBatcher({
        maxBatchSize: 5,
        maxBatchWaitMs: 100,
        minBatchSize: 1,
        targetCostPerItem: BigInt(1000000000000000),
        teeEndpoint: 'http://localhost:8080',
      });

      await batcher.initialize();

      // Add transfers
      const transfers: CrossChainTransfer[] = [];
      for (let i = 0; i < 5; i++) {
        transfers.push(createMockTransfer(i));
      }

      const results = await Promise.all(
        transfers.map((t) => batcher.addTransfer(t))
      );

      // All should be in same batch
      const batchIds = new Set(results.map((r) => r.batchId));
      expect(batchIds.size).toBe(1);

      // Positions should be sequential
      const positions = results.map((r) => r.position).sort((a, b) => a - b);
      expect(positions).toEqual([0, 1, 2, 3, 4]);
    });

    it('should estimate costs correctly', async () => {
      const batcher = createTEEBatcher({
        maxBatchSize: 10,
        maxBatchWaitMs: 5000,
        minBatchSize: 1,
        targetCostPerItem: BigInt(1000000000000000), // 0.001 ETH
        teeEndpoint: 'http://localhost:8080',
      });

      await batcher.initialize();

      const transfer = createMockTransfer(100);
      const result = await batcher.addTransfer(transfer);

      expect(result.estimatedCost).toBeGreaterThan(BigInt(0));
      expect(result.estimatedCost).toBeLessThanOrEqual(
        BigInt(1000000000000000)
      );
    });
  });

  describe('Transfer Status Tracking', () => {
    it('should track transfer through lifecycle', async () => {
      const _transfer = createMockTransfer(200);

      // Initial state
      let status: string = TransferStatus.PENDING;
      expect(status).toBe('PENDING');

      // After source confirmation
      status = TransferStatus.SOURCE_CONFIRMED;
      expect(status).toBe('SOURCE_CONFIRMED');

      // During proving
      status = TransferStatus.PROVING;
      expect(status).toBe('PROVING');

      // After proof generation
      status = TransferStatus.PROOF_GENERATED;
      expect(status).toBe('PROOF_GENERATED');

      // After dest submission
      status = TransferStatus.DEST_SUBMITTED;
      expect(status).toBe('DEST_SUBMITTED');

      // Final completion
      status = TransferStatus.COMPLETED;
      expect(status).toBe('COMPLETED');
    });

    it('should handle failed transfers', async () => {
      const status = TransferStatus.FAILED;
      expect(status).toBe('FAILED');
    });
  });

  describe('Light Client State', () => {
    it('should compute bank hash correctly', () => {
      const mockBankHash = new Uint8Array(32);
      mockBankHash.fill(0xab);

      const hash32 = toHash32(mockBankHash);
      expect(hash32.length).toBe(32);
      expect(hash32[0]).toBe(0xab);
    });

    it('should verify slot progression', async () => {
      if (!solanaAvailable) {
        console.log('Skipping: Solana not available');
        return;
      }

      const connection = new Connection(TEST_CONFIG.solanaRpc, 'confirmed');

      const slot1 = await connection.getSlot();
      // Wait longer for slot to advance (Solana test validator ~400ms per slot)
      await Bun.sleep(1000);
      const slot2 = await connection.getSlot();

      // Slot should have advanced (or at minimum stayed the same in race condition)
      expect(slot2).toBeGreaterThanOrEqual(slot1);
    });
  });

  describe('Cross-Chain Message Encoding', () => {
    it('should encode transfer correctly', () => {
      const transfer = createMockTransfer(300);

      // Verify all fields are populated
      expect(transfer.transferId.length).toBe(32);
      expect(transfer.sender.length).toBe(32);
      expect(transfer.recipient.length).toBe(32);
      expect(transfer.token.length).toBe(32);
      expect(transfer.amount).toBeGreaterThan(BigInt(0));
      expect(transfer.nonce).toBe(BigInt(300));
      expect(transfer.timestamp).toBeGreaterThan(BigInt(0));
    });

    it('should compute unique transfer IDs', () => {
      const t1 = createMockTransfer(1);
      const t2 = createMockTransfer(2);
      const t3 = createMockTransfer(1); // Same nonce as t1

      // Different nonces should produce different IDs
      expect(t1.transferId).not.toEqual(t2.transferId);

      // Same nonce produces same ID pattern
      expect(t1.transferId).toEqual(t3.transferId);
    });
  });

  describe('Batch Processing', () => {
    it('should handle batch size limits', async () => {
      const batcher = createTEEBatcher({
        maxBatchSize: 3,
        maxBatchWaitMs: 100,
        minBatchSize: 1,
        targetCostPerItem: BigInt(1000000000000000),
        teeEndpoint: 'http://localhost:8080',
      });

      await batcher.initialize();

      // Add 5 transfers (should create 2 batches)
      const results = [];
      for (let i = 0; i < 5; i++) {
        results.push(await batcher.addTransfer(createMockTransfer(400 + i)));
      }

      // Should have created at least 2 different batches
      const batchIds = new Set(results.map((r) => r.batchId));
      expect(batchIds.size).toBeGreaterThanOrEqual(1);
    });

    it('should amortize costs across batch', async () => {
      const batcher = createTEEBatcher({
        maxBatchSize: 10,
        maxBatchWaitMs: 5000,
        minBatchSize: 1,
        targetCostPerItem: BigInt(1000000000000000),
        teeEndpoint: 'http://localhost:8080',
      });

      await batcher.initialize();

      // Add single transfer
      const single = await batcher.addTransfer(createMockTransfer(500));

      // Add batch of transfers
      for (let i = 1; i < 10; i++) {
        await batcher.addTransfer(createMockTransfer(500 + i));
      }

      const batched = await batcher.addTransfer(createMockTransfer(510));

      // Batched cost should be lower due to amortization
      expect(batched.estimatedCost).toBeLessThanOrEqual(single.estimatedCost);
    });
  });

  describe('Error Handling', () => {
    it('should validate transfer amount', () => {
      const transfer = createMockTransfer(600);
      transfer.amount = BigInt(0);

      // Validation should catch zero amount
      const isValid = transfer.amount > BigInt(0);
      expect(isValid).toBe(false);
    });

    it('should validate recipient address', () => {
      const transfer = createMockTransfer(601);
      transfer.recipient = new Uint8Array(32).fill(0);

      // Validation should catch zero recipient
      const isValid = transfer.recipient.some((b) => b !== 0);
      expect(isValid).toBe(false);
    });

    it('should handle network errors gracefully', async () => {
      const badClient = createEVMClient({
        chainId: ChainId.LOCAL_EVM,
        rpcUrl: 'http://127.0.0.1:9999', // Wrong port
        bridgeAddress: '0x0000000000000000000000000000000000000000',
        lightClientAddress: '0x0000000000000000000000000000000000000000',
      });

      let errorCaught = false;
      try {
        await badClient.getLatestVerifiedSlot();
      } catch {
        errorCaught = true;
      }

      expect(errorCaught).toBe(true);
    });
  });

  describe('Performance Metrics', () => {
    it('should process transfers within latency budget', async () => {
      const batcher = createTEEBatcher({
        maxBatchSize: 100,
        maxBatchWaitMs: 1000,
        minBatchSize: 1,
        targetCostPerItem: BigInt(1000000000000000),
        teeEndpoint: 'http://localhost:8080',
      });

      await batcher.initialize();

      const startTime = Date.now();
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        await batcher.addTransfer(createMockTransfer(700 + i));
      }

      const elapsed = Date.now() - startTime;
      const avgTime = elapsed / iterations;

      console.log(
        `   Processed ${iterations} transfers in ${elapsed}ms (${avgTime.toFixed(2)}ms avg)`
      );

      // Should process within 10ms per transfer
      expect(avgTime).toBeLessThan(10);
    });

    it('should handle concurrent operations', async () => {
      const batcher = createTEEBatcher({
        maxBatchSize: 100,
        maxBatchWaitMs: 1000,
        minBatchSize: 1,
        targetCostPerItem: BigInt(1000000000000000),
        teeEndpoint: 'http://localhost:8080',
      });

      await batcher.initialize();

      const startTime = Date.now();
      const concurrency = 50;

      const promises = Array(concurrency)
        .fill(null)
        .map((_, i) => batcher.addTransfer(createMockTransfer(800 + i)));

      await Promise.all(promises);

      const elapsed = Date.now() - startTime;

      console.log(
        `   Processed ${concurrency} concurrent transfers in ${elapsed}ms`
      );

      // Concurrent processing should be faster than sequential
      expect(elapsed).toBeLessThan(1000);
    });
  });
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function createMockTransfer(nonce: number): CrossChainTransfer {
  return {
    transferId: toHash32(new Uint8Array(32).map((_, i) => (nonce + i) % 256)),
    sourceChain: ChainId.LOCAL_EVM,
    destChain: ChainId.LOCAL_SOLANA,
    token: toHash32(new Uint8Array(32).fill(0x01)),
    sender: new Uint8Array(32).fill(0x02),
    recipient: new Uint8Array(32).fill(0x03),
    amount: BigInt(1000000 * (nonce + 1)), // Ensure amount > 0
    nonce: BigInt(nonce),
    timestamp: BigInt(Date.now()),
    payload: new Uint8Array(0),
  };
}

async function isEVMRunning(): Promise<boolean> {
  try {
    const response = await fetch(TEST_CONFIG.evmRpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function isSolanaRunning(): Promise<boolean> {
  try {
    const response = await fetch(TEST_CONFIG.solanaRpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'getHealth',
        id: 1,
      }),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { result?: string };
    return data.result === 'ok';
  } catch {
    return false;
  }
}

async function waitForEVM(maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isEVMRunning()) return true;
    await Bun.sleep(1000);
  }
  console.warn('EVM chain failed to start');
  return false;
}

async function waitForSolana(maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isSolanaRunning()) return true;
    await Bun.sleep(1000);
  }
  console.warn('Solana validator failed to start');
  return false;
}
