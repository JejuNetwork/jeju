#!/usr/bin/env bun
/**
 * Fund test accounts with ALL supported tokens for localnet testing
 * 
 * Distributes:
 * - elizaOS: 100,000 tokens (~$10,000)
 * - CLANKER: 1,000 tokens (~$26,140)
 * - VIRTUAL: 10,000 tokens (~$18,500)
 * - CLANKERMON: 50,000 tokens (~$7,500)
 * - USDC: 100,000 USDC
 * - ETH: 1,000 ETH
 */

import { createWalletClient, createPublicClient, http, parseEther, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { readFileSync } from 'fs';
import { join } from 'path';

const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// Anvil test accounts 0-9 (10 accounts)
const TEST_ACCOUNTS = [
  { name: 'Test Account #1', address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' },
  { name: 'Test Account #2', address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' },
  { name: 'Test Account #3', address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906' },
  { name: 'Test Account #4', address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65' },
  { name: 'Test Account #5', address: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc' },
  { name: 'Test Account #6', address: '0x976EA74026E726554dB657fA54763abd0C3a0aa9' },
  { name: 'Test Account #7', address: '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955' },
  { name: 'Test Account #8', address: '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f' },
  { name: 'Test Account #9', address: '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720' },
  { name: 'Test Account #10', address: '0xBcd4042DE499D14e55001CcbB24a551F3b954096' },
];

// Token amounts
const AMOUNTS = {
  elizaOS: parseEther('100000'),      // 100k elizaOS (~$10k)
  CLANKER: parseEther('1000'),        // 1k CLANKER (~$26k) 
  VIRTUAL: parseEther('10000'),       // 10k VIRTUAL (~$18.5k)
  CLANKERMON: parseEther('50000'),    // 50k CLANKERMON (~$7.5k)
  USDC: parseUnits('100000', 6),      // 100k USDC
  ETH: parseEther('1000'),            // 1000 ETH
};

async function loadTokenAddresses() {
  const deploymentPath = join(process.cwd(), 'contracts', 'deployments', 'localnet', 'multi-token-system.json');
  
  const deployment = JSON.parse(readFileSync(deploymentPath, 'utf-8'));
  
  return {
    elizaOS: deployment.elizaOS_token as `0x${string}`,
    CLANKER: deployment.clanker_token as `0x${string}`,
    VIRTUAL: deployment.virtual_token as `0x${string}`,
    CLANKERMON: deployment.clankermon_token as `0x${string}`,
    USDC: process.env.USDC_ADDRESS as `0x${string}` || '0x0000000000000000000000000000000000000000' as `0x${string}`,
  };
}

async function main() {
  console.log('💰 Funding Test Accounts with ALL Tokens');
  console.log('='.repeat(70));
  console.log('');

  const account = privateKeyToAccount(DEPLOYER_KEY);

  const rpcUrl = process.env.JEJU_RPC_URL || 'http://localhost:9545';

  const publicClient = createPublicClient({
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  });

  const erc20ABI = [
    {
      name: 'transfer',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      outputs: [{ type: 'bool' }],
    },
    {
      name: 'balanceOf',
      type: 'function',
      stateMutability: 'view',
      inputs: [{ name: 'account', type: 'address' }],
      outputs: [{ type: 'uint256' }],
    },
  ] as const;

  // Load token addresses
  const tokens = await loadTokenAddresses();

  console.log('Token Addresses:');
  console.log('  elizaOS:', tokens.elizaOS);
  console.log('  CLANKER:', tokens.CLANKER);
  console.log('  VIRTUAL:', tokens.VIRTUAL);
  console.log('  CLANKERMON:', tokens.CLANKERMON);
  console.log('  USDC:', tokens.USDC);
  console.log('');

  for (const testAccount of TEST_ACCOUNTS) {
    console.log(`📤 Funding ${testAccount.name} (${testAccount.address})...`);
    console.log('');

    // Fund elizaOS
    const elizaHash = await walletClient.writeContract({
      address: tokens.elizaOS,
      abi: erc20ABI,
      functionName: 'transfer',
      args: [testAccount.address as `0x${string}`, AMOUNTS.elizaOS],
    });
    await publicClient.waitForTransactionReceipt({ hash: elizaHash });
    console.log('  ✅ 100,000 elizaOS');

    // Fund CLANKER
    const clankerHash = await walletClient.writeContract({
      address: tokens.CLANKER,
      abi: erc20ABI,
      functionName: 'transfer',
      args: [testAccount.address as `0x${string}`, AMOUNTS.CLANKER],
    });
    await publicClient.waitForTransactionReceipt({ hash: clankerHash });
    console.log('  ✅ 1,000 CLANKER');

    // Fund VIRTUAL
    const virtualHash = await walletClient.writeContract({
      address: tokens.VIRTUAL,
      abi: erc20ABI,
      functionName: 'transfer',
      args: [testAccount.address as `0x${string}`, AMOUNTS.VIRTUAL],
    });
    await publicClient.waitForTransactionReceipt({ hash: virtualHash });
    console.log('  ✅ 10,000 VIRTUAL');

    // Fund CLANKERMON
    const clankermonHash = await walletClient.writeContract({
      address: tokens.CLANKERMON,
      abi: erc20ABI,
      functionName: 'transfer',
      args: [testAccount.address as `0x${string}`, AMOUNTS.CLANKERMON],
    });
    await publicClient.waitForTransactionReceipt({ hash: clankermonHash });
    console.log('  ✅ 50,000 CLANKERMON');

    // Fund USDC (if deployed)
    if (tokens.USDC !== '0x0000000000000000000000000000000000000000') {
      const usdcHash = await walletClient.writeContract({
        address: tokens.USDC,
        abi: erc20ABI,
        functionName: 'transfer',
        args: [testAccount.address as `0x${string}`, AMOUNTS.USDC],
      });
      await publicClient.waitForTransactionReceipt({ hash: usdcHash });
      console.log('  ✅ 100,000 USDC');
    }

    // Fund ETH
    const ethHash = await walletClient.sendTransaction({
      to: testAccount.address as `0x${string}`,
      value: AMOUNTS.ETH,
    });
    await publicClient.waitForTransactionReceipt({ hash: ethHash });
    console.log('  ✅ 1,000 ETH');
    console.log('');
  }

  console.log('');
  console.log('='.repeat(70));
  console.log('✅ All 10 test accounts funded with all tokens!');
  console.log('='.repeat(70));
  console.log('');
  console.log('Total distributed per account:');
  console.log('  • 100,000 elizaOS (~$10,000)');
  console.log('  • 1,000 CLANKER (~$26,140)');
  console.log('  • 10,000 VIRTUAL (~$18,500)');
  console.log('  • 50,000 CLANKERMON (~$7,500)');
  console.log('  • 100,000 USDC');
  console.log('  • 1,000 ETH');
  console.log('');
}

main().catch(console.error);
