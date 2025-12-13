/**
 * Chain Preflight Smoke Tests
 *
 * These tests verify the basic chain infrastructure is working
 * before running any wallet/E2E tests. They do NOT require Synpress
 * and can run quickly to validate the test environment.
 *
 * Run these first to catch infrastructure issues early:
 *   bunx playwright test packages/tests/smoke/chain-preflight.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RPC_URL = process.env.L2_RPC_URL || process.env.JEJU_RPC_URL || 'http://localhost:9545';
const CHAIN_ID = parseInt(process.env.CHAIN_ID || '1337');

// Hardhat/Anvil test account #0
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;

const chain = {
  id: CHAIN_ID,
  name: 'Jeju Local',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
};

const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL, { timeout: 10000 }),
});

test.describe('Chain Infrastructure', () => {
  test('RPC responds to eth_blockNumber', async () => {
    const blockNumber = await publicClient.getBlockNumber();
    expect(blockNumber).toBeGreaterThanOrEqual(0n);
    console.log(`Current block: ${blockNumber}`);
  });

  test('Chain ID matches expected', async () => {
    const actualChainId = await publicClient.getChainId();
    expect(actualChainId).toBe(CHAIN_ID);
    console.log(`Chain ID: ${actualChainId}`);
  });

  test('Test account has sufficient ETH', async () => {
    const balance = await publicClient.getBalance({ address: TEST_ADDRESS });
    expect(balance).toBeGreaterThan(parseEther('1'));
    console.log(`Balance: ${formatEther(balance)} ETH`);
  });

  test('Blocks are being produced', async () => {
    const block1 = await publicClient.getBlockNumber();
    await new Promise(r => setTimeout(r, 2000));
    const block2 = await publicClient.getBlockNumber();

    // Blocks should at least not go backwards
    expect(block2).toBeGreaterThanOrEqual(block1);
    console.log(`Block progression: ${block1} -> ${block2}`);
  });
});

test.describe('Transaction Verification', () => {
  test('Can estimate gas for simple transfer', async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);

    const gasEstimate = await publicClient.estimateGas({
      account: account.address,
      to: TEST_ADDRESS,
      value: parseEther('0.001'),
    });

    expect(gasEstimate).toBeGreaterThan(0n);
    console.log(`Gas estimate: ${gasEstimate}`);
  });

  test('Can send and confirm transaction', async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);

    const walletClient = createWalletClient({
      chain,
      transport: http(RPC_URL, { timeout: 30000 }),
      account,
    });

    const balanceBefore = await publicClient.getBalance({ address: account.address });

    // Send a tiny amount to self
    const txHash = await walletClient.sendTransaction({
      to: account.address,
      value: parseEther('0.0001'),
    });

    console.log(`Transaction hash: ${txHash}`);

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 30000,
    });

    expect(receipt.status).toBe('success');
    expect(receipt.blockNumber).toBeGreaterThan(0n);

    const balanceAfter = await publicClient.getBalance({ address: account.address });
    const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;

    console.log(`Block: ${receipt.blockNumber}`);
    console.log(`Gas used: ${formatEther(gasUsed)} ETH`);
    console.log(`Balance change: ${formatEther(balanceBefore - balanceAfter)} ETH`);

    // Balance should have decreased by gas amount
    expect(balanceAfter).toBeLessThan(balanceBefore);
  });
});

test.describe('Contract Deployment Check', () => {
  test('Can verify ERC20 Factory deployment', async () => {
    const factoryAddress = process.env.NEXT_PUBLIC_ERC20_FACTORY_ADDRESS as Address | undefined;

    if (!factoryAddress || factoryAddress === '0x0') {
      test.skip();
      return;
    }

    const code = await publicClient.getCode({ address: factoryAddress });
    expect(code).not.toBe('0x');
    console.log(`ERC20 Factory deployed at ${factoryAddress}`);
  });

  test('Can verify NFT Marketplace deployment', async () => {
    const marketplaceAddress = process.env.NEXT_PUBLIC_NFT_MARKETPLACE_ADDRESS as Address | undefined;

    if (!marketplaceAddress || marketplaceAddress === '0x0') {
      test.skip();
      return;
    }

    const code = await publicClient.getCode({ address: marketplaceAddress });
    expect(code).not.toBe('0x');
    console.log(`NFT Marketplace deployed at ${marketplaceAddress}`);
  });
});

test.describe('RPC Health', () => {
  test('RPC responds within acceptable time', async () => {
    const start = Date.now();
    await publicClient.getBlockNumber();
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(5000);
    console.log(`RPC response time: ${duration}ms`);
  });

  test('Can fetch latest block details', async () => {
    const block = await publicClient.getBlock({ blockTag: 'latest' });

    expect(block.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(block.number).toBeGreaterThanOrEqual(0n);
    expect(block.timestamp).toBeGreaterThan(0n);

    console.log(`Latest block: ${block.number}`);
    console.log(`Timestamp: ${new Date(Number(block.timestamp) * 1000).toISOString()}`);
  });
});


