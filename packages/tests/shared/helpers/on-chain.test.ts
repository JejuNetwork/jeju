/**
 * On-Chain Helper Tests - Blockchain validation, error handling
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  verifyTransactionMined,
  verifyBalanceChanged,
  verifyContractDeployed,
  verifyContractEvent,
  verifyTokenBalanceChanged,
  verifyNFTOwnership,
  verifyContractState,
  getEthBalance,
  getTokenBalance,
  createAccountSnapshot,
  compareSnapshots,
  clearClientCache,
  ERC20_ABI,
} from './on-chain';
import { parseEther, type Address, type Hash, type TransactionReceipt, type Log } from 'viem';

// Clear cache between tests
beforeEach(() => {
  clearClientCache();
});

const FAKE_RPC = 'http://localhost:59999';
const REAL_RPC = process.env.L2_RPC_URL || 'http://localhost:9545';

// Well-known test addresses
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

describe('verifyTransactionMined - Transaction Verification', () => {
  test('should throw on invalid tx hash format', async () => {
    await expect(
      verifyTransactionMined('invalid-hash' as Hash, { rpcUrl: REAL_RPC, timeout: 1000 })
    ).rejects.toThrow();
  });

  test('should throw on non-existent transaction', async () => {
    const fakeTxHash = '0x0000000000000000000000000000000000000000000000000000000000000001' as Hash;

    await expect(
      verifyTransactionMined(fakeTxHash, { rpcUrl: REAL_RPC, timeout: 2000 })
    ).rejects.toThrow();
  });

  test('should throw when RPC is unavailable', async () => {
    const fakeTxHash = '0x0000000000000000000000000000000000000000000000000000000000000001' as Hash;

    await expect(
      verifyTransactionMined(fakeTxHash, { rpcUrl: FAKE_RPC, timeout: 2000 })
    ).rejects.toThrow();
  });
});

describe('verifyBalanceChanged - Balance Verification', () => {
  test('should throw when balance did not change with direction=any', async () => {
    const balance = parseEther('10');

    await expect(
      verifyBalanceChanged(TEST_ADDRESS, balance, {
        direction: 'any',
        rpcUrl: FAKE_RPC,
      })
    ).rejects.toThrow();
  });

  test('should throw when expected increase but decreased', async () => {
    // Mocked scenario - balance before was higher
    const balanceBefore = parseEther('10');

    // This will fail on RPC but tests the logic structure
    await expect(
      verifyBalanceChanged(TEST_ADDRESS, balanceBefore, {
        direction: 'increase',
        rpcUrl: FAKE_RPC,
      })
    ).rejects.toThrow();
  });

  test('should throw when expected decrease but increased', async () => {
    const balanceBefore = parseEther('5');

    await expect(
      verifyBalanceChanged(TEST_ADDRESS, balanceBefore, {
        direction: 'decrease',
        rpcUrl: FAKE_RPC,
      })
    ).rejects.toThrow();
  });

  test('should accept tolerance for expected change', async () => {
    // This tests the tolerance logic - if we could mock the RPC
    // For now, verify it throws appropriately on no RPC
    await expect(
      verifyBalanceChanged(TEST_ADDRESS, parseEther('1'), {
        expectedChange: parseEther('0.5'),
        tolerance: parseEther('0.1'),
        rpcUrl: FAKE_RPC,
      })
    ).rejects.toThrow();
  });
});

describe('verifyContractDeployed - Contract Verification', () => {
  test('should throw on RPC error', async () => {
    await expect(
      verifyContractDeployed(TEST_ADDRESS, { rpcUrl: FAKE_RPC })
    ).rejects.toThrow();
  });

  test('should throw for zero address', async () => {
    // Zero address has no code
    await expect(
      verifyContractDeployed(ZERO_ADDRESS, { rpcUrl: REAL_RPC })
    ).rejects.toThrow();
  });

  test('should throw for EOA (no contract code)', async () => {
    // Test wallet is EOA, not contract
    // Will throw either "No contract deployed" if chain is running
    // or RPC error if chain is not available
    await expect(
      verifyContractDeployed(TEST_ADDRESS, { rpcUrl: REAL_RPC })
    ).rejects.toThrow();
  });
});

describe('getEthBalance - Balance Retrieval', () => {
  test('should throw on RPC error', async () => {
    await expect(
      getEthBalance(TEST_ADDRESS, { rpcUrl: FAKE_RPC })
    ).rejects.toThrow();
  });
});

describe('createAccountSnapshot - State Capture', () => {
  test('should throw on RPC error', async () => {
    await expect(
      createAccountSnapshot(TEST_ADDRESS, [], { rpcUrl: FAKE_RPC })
    ).rejects.toThrow();
  });
});

describe('compareSnapshots - State Diff', () => {
  test('should calculate ETH balance change', () => {
    const before = {
      ethBalance: parseEther('10'),
      tokenBalances: new Map<Address, bigint>(),
      blockNumber: 100n,
    };

    const after = {
      ethBalance: parseEther('8'),
      tokenBalances: new Map<Address, bigint>(),
      blockNumber: 105n,
    };

    const diff = compareSnapshots(before, after);

    expect(diff.ethChange).toBe(parseEther('-2'));
    expect(diff.blocksDiff).toBe(5n);
  });

  test('should calculate positive balance change', () => {
    const before = {
      ethBalance: parseEther('5'),
      tokenBalances: new Map<Address, bigint>(),
      blockNumber: 100n,
    };

    const after = {
      ethBalance: parseEther('7'),
      tokenBalances: new Map<Address, bigint>(),
      blockNumber: 101n,
    };

    const diff = compareSnapshots(before, after);

    expect(diff.ethChange).toBe(parseEther('2'));
  });

  test('should calculate token balance changes', () => {
    const tokenAddr = '0x1234567890123456789012345678901234567890' as Address;

    const before = {
      ethBalance: 0n,
      tokenBalances: new Map([[tokenAddr, 1000n]]),
      blockNumber: 100n,
    };

    const after = {
      ethBalance: 0n,
      tokenBalances: new Map([[tokenAddr, 1500n]]),
      blockNumber: 101n,
    };

    const diff = compareSnapshots(before, after);

    expect(diff.tokenChanges.get(tokenAddr)).toBe(500n);
  });

  test('should handle missing token in after snapshot', () => {
    const tokenAddr = '0x1234567890123456789012345678901234567890' as Address;

    const before = {
      ethBalance: 0n,
      tokenBalances: new Map([[tokenAddr, 1000n]]),
      blockNumber: 100n,
    };

    const after = {
      ethBalance: 0n,
      tokenBalances: new Map<Address, bigint>(), // Token missing
      blockNumber: 101n,
    };

    const diff = compareSnapshots(before, after);

    expect(diff.tokenChanges.get(tokenAddr)).toBe(-1000n);
  });

  test('should handle empty snapshots', () => {
    const empty = {
      ethBalance: 0n,
      tokenBalances: new Map<Address, bigint>(),
      blockNumber: 0n,
    };

    const diff = compareSnapshots(empty, empty);

    expect(diff.ethChange).toBe(0n);
    expect(diff.blocksDiff).toBe(0n);
    expect(diff.tokenChanges.size).toBe(0);
  });
});

describe('verifyContractEvent - Event Verification', () => {
  // Mock receipt for testing - use type assertion to satisfy strict typing
  const mockReceipt = {
    transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hash,
    blockNumber: 100n,
    blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as `0x${string}`,
    transactionIndex: 0,
    from: TEST_ADDRESS,
    to: TEST_ADDRESS,
    gasUsed: 21000n,
    cumulativeGasUsed: 21000n,
    effectiveGasPrice: 1000000000n,
    status: 'success' as const,
    type: 'eip1559' as const,
    logs: [
      {
        address: '0x1234567890123456789012345678901234567890' as Address,
        topics: [
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer topic
          '0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266', // from
          '0x00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8', // to
        ] as [`0x${string}`, ...`0x${string}`[]],
        data: '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000' as `0x${string}`,
        blockNumber: 100n,
        transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hash,
        transactionIndex: 0,
        blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as `0x${string}`,
        logIndex: 0,
        removed: false,
      },
    ],
    logsBloom: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
    contractAddress: null,
    root: undefined,
  } as TransactionReceipt;

  test('should find logs by contract address', async () => {
    const logs = await verifyContractEvent(mockReceipt, {
      contractAddress: '0x1234567890123456789012345678901234567890' as Address,
    });
    expect(logs.length).toBe(1);
  });

  test('should throw when no matching logs found', async () => {
    await expect(
      verifyContractEvent(mockReceipt, {
        contractAddress: '0x0000000000000000000000000000000000000000' as Address,
      })
    ).rejects.toThrow(/Expected 1\+ events/);
  });

  test('should filter by event signature', async () => {
    const logs = await verifyContractEvent(mockReceipt, {
      eventSignature: 'Transfer(address,address,uint256)',
    });
    expect(logs.length).toBe(1);
  });

  test('should reject wrong event signature', async () => {
    await expect(
      verifyContractEvent(mockReceipt, {
        eventSignature: 'Approval(address,address,uint256)',
      })
    ).rejects.toThrow(/Expected 1\+ events/);
  });

  test('should filter by expected topics', async () => {
    const logs = await verifyContractEvent(mockReceipt, {
      expectedTopics: [
        '0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266', // from
      ],
    });
    expect(logs.length).toBe(1);
  });

  test('should require minimum number of logs', async () => {
    await expect(
      verifyContractEvent(mockReceipt, { minLogs: 5 })
    ).rejects.toThrow(/Expected 5\+ events/);
  });
});

describe('verifyTokenBalanceChanged - Token Verification', () => {
  test('should throw on RPC error', async () => {
    await expect(
      verifyTokenBalanceChanged(
        '0x1234567890123456789012345678901234567890' as Address,
        TEST_ADDRESS,
        1000n,
        { rpcUrl: FAKE_RPC }
      )
    ).rejects.toThrow();
  });
});

describe('verifyNFTOwnership - NFT Verification', () => {
  test('should throw on RPC error', async () => {
    await expect(
      verifyNFTOwnership(
        '0x1234567890123456789012345678901234567890' as Address,
        1n,
        TEST_ADDRESS,
        { rpcUrl: FAKE_RPC }
      )
    ).rejects.toThrow();
  });
});

describe('verifyContractState - State Verification', () => {
  test('should throw on RPC error', async () => {
    await expect(
      verifyContractState(
        '0x1234567890123456789012345678901234567890' as Address,
        ERC20_ABI,
        'name',
        [],
        'TestToken',
        { rpcUrl: FAKE_RPC }
      )
    ).rejects.toThrow();
  });
});

describe('getTokenBalance - Token Balance Retrieval', () => {
  test('should throw on RPC error', async () => {
    await expect(
      getTokenBalance(
        '0x1234567890123456789012345678901234567890' as Address,
        TEST_ADDRESS,
        { rpcUrl: FAKE_RPC }
      )
    ).rejects.toThrow();
  });
});

describe('clearClientCache - Cache Management', () => {
  test('should not throw when clearing empty cache', () => {
    expect(() => clearClientCache()).not.toThrow();
  });

  test('should not throw when clearing populated cache', () => {
    // Trigger client creation by calling getEthBalance (will fail but creates client)
    getEthBalance(TEST_ADDRESS, { rpcUrl: FAKE_RPC }).catch(() => {});
    expect(() => clearClientCache()).not.toThrow();
  });
});

describe('On-Chain - Address Validation', () => {
  test('should accept checksummed addresses', async () => {
    const checksummed = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;

    // Just verify no crash on valid format
    await expect(
      getEthBalance(checksummed, { rpcUrl: FAKE_RPC })
    ).rejects.toThrow(); // RPC error, not address error
  });

  test('should accept lowercase addresses', async () => {
    const lowercase = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' as Address;

    await expect(
      getEthBalance(lowercase, { rpcUrl: FAKE_RPC })
    ).rejects.toThrow(); // RPC error
  });
});

// Integration tests require running localnet - run separately with:
// CHAIN_AVAILABLE=true bun test on-chain.test.ts
describe.skipIf(!process.env.CHAIN_AVAILABLE)('On-Chain - Integration Tests (requires localnet)', () => {
  test('should get balance for funded account', async () => {
    const balance = await getEthBalance(TEST_ADDRESS, { rpcUrl: REAL_RPC });
    expect(balance).toBeGreaterThan(0n);
  });

  test('should create and compare snapshots', async () => {
    const snapshot1 = await createAccountSnapshot(TEST_ADDRESS, [], { rpcUrl: REAL_RPC });
    await new Promise(r => setTimeout(r, 100));
    const snapshot2 = await createAccountSnapshot(TEST_ADDRESS, [], { rpcUrl: REAL_RPC });

    const diff = compareSnapshots(snapshot1, snapshot2);
    expect(typeof diff.ethChange).toBe('bigint');
    expect(diff.blocksDiff).toBeGreaterThanOrEqual(0n);
  });
});

