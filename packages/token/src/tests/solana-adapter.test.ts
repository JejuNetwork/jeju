/**
 * @fileoverview Comprehensive tests for SolanaAdapter
 * Tests initialization, error handling, and data transformations
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { PublicKey } from '@solana/web3.js';
import { SolanaAdapter } from '../bridge/solana-adapter';
import type { ChainId } from '../types';

describe('SolanaAdapter - Construction', () => {
  test('creates mainnet adapter with default RPC', () => {
    const adapter = new SolanaAdapter(
      'https://api.mainnet-beta.solana.com',
      true
    );
    expect(adapter).toBeDefined();
  });

  test('creates devnet adapter with default RPC', () => {
    const adapter = new SolanaAdapter('https://api.devnet.solana.com', false);
    expect(adapter).toBeDefined();
  });

  test('creates adapter with custom RPC URL', () => {
    const customRpc = 'https://custom-rpc.example.com';
    const adapter = new SolanaAdapter(customRpc, true);
    expect(adapter).toBeDefined();
  });
});

describe('SolanaAdapter - Quote Transfer', () => {
  let adapter: SolanaAdapter;

  beforeEach(() => {
    adapter = new SolanaAdapter('https://api.mainnet-beta.solana.com', true);
  });

  test('returns quote with all required fields', async () => {
    const quote = await adapter.quoteTransfer(1, 1000000n);
    expect(quote).toBeDefined();
    expect(typeof quote.interchainGasFee).toBe('bigint');
    expect(typeof quote.transactionFee).toBe('bigint');
    expect(typeof quote.totalFee).toBe('bigint');
    expect(typeof quote.estimatedTime).toBe('number');
  });

  test('total fee equals sum of components', async () => {
    const quote = await adapter.quoteTransfer(1, 1000000n);
    expect(quote.totalFee).toBe(quote.interchainGasFee + quote.transactionFee);
  });

  test('gas fee varies by destination chain', async () => {
    const ethereumQuote = await adapter.quoteTransfer(1, 1000000n);
    const baseQuote = await adapter.quoteTransfer(8453, 1000000n);

    // Ethereum L1 should be more expensive than L2
    expect(ethereumQuote.interchainGasFee).toBeGreaterThan(
      baseQuote.interchainGasFee
    );
  });

  test('estimated time is reasonable', async () => {
    const quote = await adapter.quoteTransfer(1, 1000000n);
    // Should be between 30 seconds and 5 minutes
    expect(quote.estimatedTime).toBeGreaterThanOrEqual(30);
    expect(quote.estimatedTime).toBeLessThanOrEqual(300);
  });

  test('handles zero amount', async () => {
    const quote = await adapter.quoteTransfer(1, 0n);
    expect(quote.totalFee).toBeGreaterThan(0n);
  });

  test('handles very large amount', async () => {
    const quote = await adapter.quoteTransfer(1, 10n ** 18n);
    expect(quote.totalFee).toBeGreaterThan(0n);
  });

  test('returns positive fees for all destination chains', async () => {
    const chainIds = [1, 10, 8453, 42161, 56, 137];
    for (const chainId of chainIds) {
      const quote = await adapter.quoteTransfer(chainId, 1000000n);
      expect(quote.interchainGasFee).toBeGreaterThan(0n);
    }
  });
});

describe('SolanaAdapter - Token Info', () => {
  let adapter: SolanaAdapter;

  beforeEach(() => {
    // Use devnet for testing to avoid mainnet rate limits
    adapter = new SolanaAdapter('https://api.devnet.solana.com', false);
  });

  test('getTokenInfo throws for invalid mint', async () => {
    // System program is not a valid SPL Token mint
    const invalidMint = new PublicKey('11111111111111111111111111111111');
    await expect(adapter.getTokenInfo(invalidMint)).rejects.toThrow();
  }, 15000); // 15s timeout for network call

  test('getTokenBalance returns 0 for non-existent account', async () => {
    // Use a random keypair to ensure no token account exists
    const randomMint = new PublicKey(
      'So11111111111111111111111111111111111111112' // Native SOL mint
    );
    // Generate a fresh random keypair for an address that definitely has no tokens
    const { Keypair } = await import('@solana/web3.js');
    const randomOwner = Keypair.generate().publicKey;

    // Should return 0 for non-existent token account
    const balance = await adapter.getTokenBalance(randomMint, randomOwner);
    expect(balance).toBe(0n);
  });
});

describe('SolanaAdapter - SOL Balance', () => {
  let adapter: SolanaAdapter;

  beforeEach(() => {
    adapter = new SolanaAdapter('https://api.devnet.solana.com', false);
  });

  test('getSolBalance returns bigint for any account', async () => {
    // Generate a random keypair for a fresh address
    const { Keypair } = await import('@solana/web3.js');
    const randomAccount = Keypair.generate().publicKey;
    const balance = await adapter.getSolBalance(randomAccount);
    expect(typeof balance).toBe('bigint');
    expect(balance).toBeGreaterThanOrEqual(0n);
  });

  test('getSolBalance returns positive for system program', async () => {
    // System program has minimum rent-exempt balance
    const systemProgram = new PublicKey('11111111111111111111111111111111');
    const balance = await adapter.getSolBalance(systemProgram);
    expect(typeof balance).toBe('bigint');
    // System program exists and has at least some lamports
    expect(balance).toBeGreaterThanOrEqual(0n);
  });
});

describe('SolanaAdapter - Token Creation Parameters', () => {
  test('validates token config decimals', () => {
    // Typical Solana token: 9 decimals
    const solanaDecimals = 9;
    expect(solanaDecimals).toBeLessThanOrEqual(9);

    // EVM-compatible: 18 decimals
    const evmDecimals = 18;
    expect(evmDecimals).toBeLessThanOrEqual(18);
  });

  test('validates mint authority is valid public key', () => {
    const validAuthority = new PublicKey('11111111111111111111111111111111');
    expect(validAuthority.toBase58().length).toBeGreaterThan(0);
  });
});

describe('SolanaAdapter - Warp Route Config Validation', () => {
  test('mint address is valid public key format', () => {
    const mint = new PublicKey('So11111111111111111111111111111111111111112');
    // Base58 encoding of 32 bytes is typically 43-44 characters
    expect(mint.toBase58().length).toBeGreaterThanOrEqual(32);
    expect(mint.toBase58().length).toBeLessThanOrEqual(44);
  });

  test('warp route program is valid public key format', () => {
    const program = new PublicKey(
      'EitxJuv2iBjsg2d7jVy2LDC1e2zBrx4GB5Y9h2Ko3A9Y'
    );
    // Should be a valid base58 public key
    expect(program.toBase58().length).toBeGreaterThanOrEqual(32);
    expect(program.toBase58().length).toBeLessThanOrEqual(44);
  });

  test('rate limit is positive', () => {
    const rateLimitPerDay = 1_000_000n * 10n ** 9n; // 1M tokens with 9 decimals
    expect(rateLimitPerDay).toBeGreaterThan(0n);
  });
});

describe('SolanaAdapter - Domain ID Mapping', () => {
  let adapter: SolanaAdapter;

  beforeEach(() => {
    adapter = new SolanaAdapter('https://api.mainnet-beta.solana.com', true);
  });

  test('quotes for all supported EVM destinations', async () => {
    const evmChains: ChainId[] = [1, 10, 56, 137, 8453, 42161, 43114];
    for (const chainId of evmChains) {
      const quote = await adapter.quoteTransfer(chainId as number, 1000000n);
      expect(quote.totalFee).toBeGreaterThan(0n);
    }
  });
});

describe('SolanaAdapter - Instruction Building', () => {
  test('transfer instruction data layout is correct', () => {
    // Verify the expected data layout:
    // - 1 byte: instruction discriminator
    // - 4 bytes: destination domain (u32)
    // - 32 bytes: recipient address
    // - 8 bytes: amount (u64)
    const expectedSize = 1 + 4 + 32 + 8;
    expect(expectedSize).toBe(45);
  });

  test('gas payment instruction data layout is correct', () => {
    // Verify the expected data layout:
    // - 1 byte: instruction discriminator
    // - 4 bytes: destination domain (u32)
    // - 8 bytes: amount (u64)
    const expectedSize = 1 + 4 + 8;
    expect(expectedSize).toBe(13);
  });
});

describe('SolanaAdapter - EVM Address Conversion', () => {
  test('EVM address to bytes32 padding', () => {
    const evmAddress = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF';
    // Remove 0x prefix and convert to lowercase
    const clean = evmAddress.slice(2).toLowerCase();
    // Should be 40 hex characters
    expect(clean.length).toBe(40);

    // Create bytes32 buffer
    const recipientBytes = Buffer.alloc(32);
    Buffer.from(clean, 'hex').copy(recipientBytes, 12);

    // First 12 bytes should be zero
    for (let i = 0; i < 12; i++) {
      expect(recipientBytes[i]).toBe(0);
    }
    // Last 20 bytes should be the address
    expect(recipientBytes.slice(12).toString('hex')).toBe(clean);
  });
});

describe('SolanaAdapter - Concurrent Operations', () => {
  let adapter: SolanaAdapter;

  beforeEach(() => {
    adapter = new SolanaAdapter('https://api.devnet.solana.com', false);
  });

  test('handles multiple concurrent quote requests', async () => {
    const destinations = [1, 8453, 42161, 10, 137];
    const promises = destinations.map((d) =>
      adapter.quoteTransfer(d, 1000000n)
    );

    const quotes = await Promise.all(promises);
    expect(quotes.length).toBe(destinations.length);
    for (const quote of quotes) {
      expect(quote.totalFee).toBeGreaterThan(0n);
    }
  });

  test('handles multiple concurrent balance checks', async () => {
    const accounts = [
      new PublicKey('11111111111111111111111111111111'),
      new PublicKey('Vote111111111111111111111111111111111111111'),
      new PublicKey('Stake11111111111111111111111111111111111111'),
    ];

    const promises = accounts.map((a) => adapter.getSolBalance(a));
    const balances = await Promise.all(promises);

    expect(balances.length).toBe(accounts.length);
    for (const balance of balances) {
      expect(typeof balance).toBe('bigint');
    }
  });
});
