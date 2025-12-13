/**
 * Thorough Tests for EIL (Ethereum Interop Layer) SDK
 * 
 * Tests:
 * - Merkle tree batch operations
 * - Cross-chain transfer helpers
 * - Fee calculation
 * - Multi-chain UserOp batch building
 */

import { describe, test, expect } from 'bun:test';
import { ethers } from 'ethers';
import {
  EILClient,
  estimateCrossChainFee,
  formatTransfer,
  calculateOptimalFee,
  type TransferRequest,
  type MultiChainUserOp,
  type EILConfig,
} from './eil';

// Test fixtures
const TEST_CONFIG: EILConfig = {
  l1RpcUrl: 'http://localhost:8545',
  l2RpcUrl: 'http://localhost:9545',
  l1StakeManager: '0x1234567890123456789012345678901234567890',
  crossChainPaymaster: '0x9876543210987654321098765432109876543210',
  l1ChainId: 11155111,
  l2ChainId: 420690,
};

const TEST_WALLET = ethers.Wallet.createRandom();

describe('EIL SDK', () => {
  describe('EILClient', () => {
    describe('constructor', () => {
      test('should create client with valid config', () => {
        const client = new EILClient(TEST_CONFIG, TEST_WALLET);
        expect(client).toBeDefined();
      });

      test('should accept optional entryPoint', () => {
        const configWithEntryPoint = {
          ...TEST_CONFIG,
          entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
        };
        const client = new EILClient(configWithEntryPoint, TEST_WALLET);
        expect(client).toBeDefined();
      });
    });

    describe('buildMultiChainBatch()', () => {
      test('should build merkle tree from operations', async () => {
        const client = new EILClient(TEST_CONFIG, TEST_WALLET);
        
        const operations: MultiChainUserOp[] = [
          {
            chainId: 1,
            target: '0x1111111111111111111111111111111111111111',
            calldata: '0x12345678',
            value: 0n,
            gasLimit: 100000n,
          },
          {
            chainId: 8453,
            target: '0x2222222222222222222222222222222222222222',
            calldata: '0x87654321',
            value: ethers.parseEther('0.1'),
            gasLimit: 150000n,
          },
        ];

        const result = await client.buildMultiChainBatch(operations);
        
        expect(result.merkleRoot).toBeDefined();
        expect(result.merkleRoot).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.leaves).toHaveLength(2);
        expect(result.proofs).toHaveLength(2);
      });

      test('should produce unique leaves for different operations', async () => {
        const client = new EILClient(TEST_CONFIG, TEST_WALLET);
        
        const op1: MultiChainUserOp = {
          chainId: 1,
          target: '0x1111111111111111111111111111111111111111',
          calldata: '0x12345678',
          value: 0n,
          gasLimit: 100000n,
        };
        
        const op2: MultiChainUserOp = {
          chainId: 1,
          target: '0x1111111111111111111111111111111111111111',
          calldata: '0x87654321', // Different calldata
          value: 0n,
          gasLimit: 100000n,
        };

        const result = await client.buildMultiChainBatch([op1, op2]);
        expect(result.leaves[0]).not.toBe(result.leaves[1]);
      });

      test('should handle single operation', async () => {
        const client = new EILClient(TEST_CONFIG, TEST_WALLET);
        
        const operations: MultiChainUserOp[] = [
          {
            chainId: 1,
            target: '0x1111111111111111111111111111111111111111',
            calldata: '0x',
            value: 0n,
            gasLimit: 21000n,
          },
        ];

        const result = await client.buildMultiChainBatch(operations);
        
        expect(result.merkleRoot).toBeDefined();
        expect(result.leaves).toHaveLength(1);
        expect(result.proofs).toHaveLength(1);
      });

      test('should handle many operations', async () => {
        const client = new EILClient(TEST_CONFIG, TEST_WALLET);
        
        const operations: MultiChainUserOp[] = Array.from({ length: 16 }, (_, i) => ({
          chainId: i % 4 + 1,
          target: `0x${(i + 1).toString(16).padStart(40, '0')}` as `0x${string}`,
          calldata: `0x${i.toString(16).padStart(8, '0')}`,
          value: BigInt(i) * ethers.parseEther('0.01'),
          gasLimit: BigInt(21000 + i * 1000),
        }));

        const result = await client.buildMultiChainBatch(operations);
        
        expect(result.leaves).toHaveLength(16);
        expect(result.proofs).toHaveLength(16);
        
        // Each proof should be log2(16) = 4 elements
        for (const proof of result.proofs) {
          expect(proof.length).toBeLessThanOrEqual(4);
        }
      });

      test('should generate valid proofs', async () => {
        const client = new EILClient(TEST_CONFIG, TEST_WALLET);
        
        const operations: MultiChainUserOp[] = [
          {
            chainId: 1,
            target: '0x1111111111111111111111111111111111111111',
            calldata: '0x12345678',
            value: 0n,
            gasLimit: 100000n,
          },
          {
            chainId: 8453,
            target: '0x2222222222222222222222222222222222222222',
            calldata: '0x87654321',
            value: 0n,
            gasLimit: 100000n,
          },
        ];

        const result = await client.buildMultiChainBatch(operations);
        
        // Verify each operation
        for (let i = 0; i < operations.length; i++) {
          const isValid = client.verifyOperation(
            operations[i],
            result.merkleRoot,
            result.proofs[i]
          );
          expect(isValid).toBe(true);
        }
      });
    });

    describe('verifyOperation()', () => {
      test('should verify valid operation', async () => {
        const client = new EILClient(TEST_CONFIG, TEST_WALLET);
        
        const operation: MultiChainUserOp = {
          chainId: 1,
          target: '0x1111111111111111111111111111111111111111',
          calldata: '0x12345678',
          value: 0n,
          gasLimit: 100000n,
        };

        const result = await client.buildMultiChainBatch([operation]);
        const isValid = client.verifyOperation(operation, result.merkleRoot, result.proofs[0]);
        
        expect(isValid).toBe(true);
      });

      test('should reject modified operation', async () => {
        const client = new EILClient(TEST_CONFIG, TEST_WALLET);
        
        const operation: MultiChainUserOp = {
          chainId: 1,
          target: '0x1111111111111111111111111111111111111111',
          calldata: '0x12345678',
          value: 0n,
          gasLimit: 100000n,
        };

        const result = await client.buildMultiChainBatch([operation]);
        
        // Modify the operation
        const modifiedOp = { ...operation, value: 1n };
        const isValid = client.verifyOperation(modifiedOp, result.merkleRoot, result.proofs[0]);
        
        expect(isValid).toBe(false);
      });

      test('should reject wrong proof', async () => {
        const client = new EILClient(TEST_CONFIG, TEST_WALLET);
        
        const operations: MultiChainUserOp[] = [
          {
            chainId: 1,
            target: '0x1111111111111111111111111111111111111111',
            calldata: '0x12345678',
            value: 0n,
            gasLimit: 100000n,
          },
          {
            chainId: 8453,
            target: '0x2222222222222222222222222222222222222222',
            calldata: '0x87654321',
            value: 0n,
            gasLimit: 100000n,
          },
        ];

        const result = await client.buildMultiChainBatch(operations);
        
        // Use proof from wrong operation
        const isValid = client.verifyOperation(
          operations[0],
          result.merkleRoot,
          result.proofs[1] // Wrong proof!
        );
        
        expect(isValid).toBe(false);
      });
    });

    describe('signMultiChainBatch()', () => {
      test('should sign merkle root', async () => {
        const client = new EILClient(TEST_CONFIG, TEST_WALLET);
        
        const operations: MultiChainUserOp[] = [
          {
            chainId: 1,
            target: '0x1111111111111111111111111111111111111111',
            calldata: '0x12345678',
            value: 0n,
            gasLimit: 100000n,
          },
        ];

        const batch = await client.buildMultiChainBatch(operations);
        const signature = await client.signMultiChainBatch(batch.merkleRoot);
        
        expect(signature).toBeDefined();
        expect(signature).toMatch(/^0x[a-fA-F0-9]+$/);
        expect(signature.length).toBe(132); // 65 bytes = 130 chars + 0x
      });

      test('should produce consistent signatures', async () => {
        const client = new EILClient(TEST_CONFIG, TEST_WALLET);
        const merkleRoot = '0x' + '1'.repeat(64);
        
        const sig1 = await client.signMultiChainBatch(merkleRoot);
        const sig2 = await client.signMultiChainBatch(merkleRoot);
        
        expect(sig1).toBe(sig2);
      });

      test('should produce different signatures for different roots', async () => {
        const client = new EILClient(TEST_CONFIG, TEST_WALLET);
        
        const sig1 = await client.signMultiChainBatch('0x' + '1'.repeat(64));
        const sig2 = await client.signMultiChainBatch('0x' + '2'.repeat(64));
        
        expect(sig1).not.toBe(sig2);
      });
    });
  });

  describe('estimateCrossChainFee()', () => {
    test('should calculate fee with both gas prices', () => {
      const amount = ethers.parseEther('100');
      const sourceGasPrice = ethers.parseUnits('20', 'gwei');
      const destGasPrice = ethers.parseUnits('10', 'gwei');
      
      const fee = estimateCrossChainFee(amount, sourceGasPrice, destGasPrice);
      
      expect(fee).toBeGreaterThan(0n);
    });

    test('should include base fee', () => {
      const fee = estimateCrossChainFee(
        ethers.parseEther('1'),
        0n,
        0n
      );
      
      // Should still have base fee even with zero gas
      const baseFee = ethers.parseEther('0.0005');
      expect(fee).toBeGreaterThanOrEqual(baseFee);
    });

    test('should scale with gas prices', () => {
      const amount = ethers.parseEther('100');
      
      const lowFee = estimateCrossChainFee(
        amount,
        ethers.parseUnits('10', 'gwei'),
        ethers.parseUnits('10', 'gwei')
      );
      
      const highFee = estimateCrossChainFee(
        amount,
        ethers.parseUnits('100', 'gwei'),
        ethers.parseUnits('100', 'gwei')
      );
      
      expect(highFee).toBeGreaterThan(lowFee);
    });

    test('should handle zero gas prices', () => {
      const fee = estimateCrossChainFee(ethers.parseEther('1'), 0n, 0n);
      expect(fee).toBeDefined();
      expect(fee).toBeGreaterThan(0n); // Base fee
    });

    test('should handle very high gas prices', () => {
      const extremeGas = ethers.parseUnits('10000', 'gwei');
      const fee = estimateCrossChainFee(ethers.parseEther('1'), extremeGas, extremeGas);
      expect(fee).toBeDefined();
    });
  });

  describe('formatTransfer()', () => {
    test('should format transfer request', () => {
      const request: TransferRequest = {
        requestId: '0x123',
        sourceChain: 1,
        destinationChain: 8453,
        sourceToken: '0x1111111111111111111111111111111111111111',
        destinationToken: '0x2222222222222222222222222222222222222222',
        amount: ethers.parseEther('100'),
        maxFee: ethers.parseEther('0.01'),
        recipient: '0x3333333333333333333333333333333333333333',
        deadline: Date.now() + 3600000,
      };

      const formatted = formatTransfer(request);
      
      expect(formatted).toContain('Transfer');
      expect(formatted).toContain('100');
      expect(formatted).toContain('chain 1');
      expect(formatted).toContain('chain 8453');
    });

    test('should handle small amounts', () => {
      const request: TransferRequest = {
        requestId: '0x123',
        sourceChain: 1,
        destinationChain: 8453,
        sourceToken: '0x1111111111111111111111111111111111111111',
        destinationToken: '0x2222222222222222222222222222222222222222',
        amount: 1n, // 1 wei
        maxFee: 0n,
        recipient: '0x3333333333333333333333333333333333333333',
        deadline: Date.now(),
      };

      const formatted = formatTransfer(request);
      expect(formatted).toBeDefined();
    });

    test('should handle zero amount', () => {
      const request: TransferRequest = {
        requestId: '0x123',
        sourceChain: 1,
        destinationChain: 8453,
        sourceToken: '0x1111111111111111111111111111111111111111',
        destinationToken: '0x2222222222222222222222222222222222222222',
        amount: 0n,
        maxFee: 0n,
        recipient: '0x3333333333333333333333333333333333333333',
        deadline: Date.now(),
      };

      const formatted = formatTransfer(request);
      expect(formatted).toContain('0');
    });
  });

  describe('calculateOptimalFee()', () => {
    test('should return maxFee and feeIncrement', () => {
      const baseFee = ethers.parseEther('0.001');
      const result = calculateOptimalFee(baseFee);
      
      expect(result.maxFee).toBeDefined();
      expect(result.feeIncrement).toBeDefined();
    });

    test('should scale with urgency multiplier', () => {
      const baseFee = ethers.parseEther('0.001');
      
      const normal = calculateOptimalFee(baseFee, 1);
      const urgent = calculateOptimalFee(baseFee, 2);
      
      expect(urgent.maxFee).toBeGreaterThan(normal.maxFee);
    });

    test('should calculate increment as fraction of maxFee', () => {
      const baseFee = ethers.parseEther('0.001');
      const result = calculateOptimalFee(baseFee, 1);
      
      // Increment should be maxFee / 50
      expect(result.feeIncrement).toBe(result.maxFee / 50n);
    });

    test('should handle zero base fee', () => {
      const result = calculateOptimalFee(0n);
      
      expect(result.maxFee).toBe(0n);
      expect(result.feeIncrement).toBe(0n);
    });

    test('should handle fractional urgency', () => {
      const baseFee = ethers.parseEther('0.001');
      const result = calculateOptimalFee(baseFee, 0.5);
      
      expect(result.maxFee).toBeGreaterThan(0n);
      expect(result.maxFee).toBeLessThan(baseFee);
    });

    test('should handle high urgency', () => {
      const baseFee = ethers.parseEther('0.001');
      const result = calculateOptimalFee(baseFee, 10);
      
      expect(result.maxFee).toBeGreaterThan(baseFee * 9n);
    });
  });

  describe('integration scenarios', () => {
    test('should support complete cross-chain flow', async () => {
      const client = new EILClient(TEST_CONFIG, TEST_WALLET);
      
      // 1. Estimate fee
      const baseFee = estimateCrossChainFee(
        ethers.parseEther('100'),
        ethers.parseUnits('20', 'gwei'),
        ethers.parseUnits('10', 'gwei')
      );
      expect(baseFee).toBeGreaterThan(0n);
      
      // 2. Calculate optimal fee
      const { maxFee, feeIncrement } = calculateOptimalFee(baseFee, 1.5);
      expect(maxFee).toBeGreaterThan(baseFee);
      expect(feeIncrement).toBeGreaterThan(0n);
      
      // 3. Build multi-chain batch
      const operations: MultiChainUserOp[] = [
        {
          chainId: TEST_CONFIG.l2ChainId,
          target: '0x1111111111111111111111111111111111111111',
          calldata: '0x12345678',
          value: ethers.parseEther('0.1'),
          gasLimit: 100000n,
        },
      ];
      
      const batch = await client.buildMultiChainBatch(operations);
      expect(batch.merkleRoot).toBeDefined();
      
      // 4. Sign batch
      const signature = await client.signMultiChainBatch(batch.merkleRoot);
      expect(signature).toBeDefined();
      
      // 5. Verify operation
      const isValid = client.verifyOperation(
        operations[0],
        batch.merkleRoot,
        batch.proofs[0]
      );
      expect(isValid).toBe(true);
    });
  });

  describe('boundary conditions', () => {
    test('should handle max uint256 values in operations', async () => {
      const client = new EILClient(TEST_CONFIG, TEST_WALLET);
      const maxUint256 = 2n ** 256n - 1n;
      
      const operations: MultiChainUserOp[] = [
        {
          chainId: 1,
          target: '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
          calldata: '0x' + 'FF'.repeat(100),
          value: maxUint256,
          gasLimit: maxUint256,
        },
      ];

      const result = await client.buildMultiChainBatch(operations);
      expect(result.merkleRoot).toBeDefined();
    });

    test('should handle empty calldata', async () => {
      const client = new EILClient(TEST_CONFIG, TEST_WALLET);
      
      const operations: MultiChainUserOp[] = [
        {
          chainId: 1,
          target: '0x1111111111111111111111111111111111111111',
          calldata: '0x',
          value: 0n,
          gasLimit: 21000n,
        },
      ];

      const result = await client.buildMultiChainBatch(operations);
      expect(result.merkleRoot).toBeDefined();
    });

    test('should handle different chain IDs correctly', async () => {
      const client = new EILClient(TEST_CONFIG, TEST_WALLET);
      
      const chainIds = [1, 10, 137, 8453, 42161, 420690];
      const operations: MultiChainUserOp[] = chainIds.map(chainId => ({
        chainId,
        target: '0x1111111111111111111111111111111111111111',
        calldata: '0x12345678',
        value: 0n,
        gasLimit: 100000n,
      }));

      const result = await client.buildMultiChainBatch(operations);
      expect(result.leaves).toHaveLength(chainIds.length);
      
      // Each should produce unique leaf
      const uniqueLeaves = new Set(result.leaves);
      expect(uniqueLeaves.size).toBe(chainIds.length);
    });
  });
});

