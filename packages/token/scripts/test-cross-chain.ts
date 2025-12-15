#!/usr/bin/env bun
/**
 * Test Cross-Chain BBLN Transfers
 *
 * Tests the warp routes by:
 * 1. Approving BBLN to WarpRoute on Base Sepolia
 * 2. Sending tokens cross-chain to Sepolia
 * 3. Checking balances on both chains
 *
 * Usage:
 *   bun run scripts/test-cross-chain.ts
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  formatEther,
  parseEther,
  padHex,
  getAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, sepolia } from 'viem/chains';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

// Load .env from workspace root
const envPath = resolve(import.meta.dir, '../../../.env');
if (existsSync(envPath)) {
  const envFile = Bun.file(envPath);
  const envContent = await envFile.text();
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...valueParts] = trimmed.split('=');
    if (key && !process.env[key]) {
      process.env[key] = valueParts.join('=');
    }
  }
}

// =============================================================================
// DEPLOYED CONTRACTS
// =============================================================================

const DEPLOYED = {
  baseSepolia: {
    chainId: 84532,
    domainId: 84532,
    token: getAddress('0x3586d05d61523c81d2d79c4e1132ffa1b3bcad5f'),
    warpRoute: getAddress('0x2071a7d3b7e72ed0ee7a60da6d98edaeebdb3d2d'),
    rpc: process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org',
  },
  sepolia: {
    chainId: 11155111,
    domainId: 11155111,
    token: getAddress('0xa8f3b42dfb4cb9c583b487beec75c2d90e9cecab'),
    warpRoute: getAddress('0x5ea72ab480fa99f9bc8a00786faaf0d01fe88eb1'),
    rpc: process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com',
  },
  solanaDevnet: {
    mint: 'GXEEEAuq37vT7aQvNCvcoNsE2C1pXhrNt3PsG1pph2hF',
    domainId: 1399811150,
    mailbox: 'E588QtVUvresuXq2KoNEwAmoifCzYGpRBdHByN9KQMbi',
  },
};

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'allowance',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

const WARP_ABI = [
  {
    name: 'transferRemote',
    type: 'function',
    inputs: [
      { name: '_destination', type: 'uint32' },
      { name: '_recipient', type: 'bytes32' },
      { name: '_amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    name: 'quoteGasPayment',
    type: 'function',
    inputs: [{ name: '_destination', type: 'uint32' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'routers',
    type: 'function',
    inputs: [{ name: '', type: 'uint32' }],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'view',
  },
] as const;

function addressToBytes32(address: Address): Hex {
  return padHex(address, { size: 32 });
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('═'.repeat(60));
  console.log('🧪 CROSS-CHAIN BBLN TRANSFER TEST');
  console.log('═'.repeat(60));

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY required');
  }

  const account = privateKeyToAccount(privateKey as Hex);
  console.log(`\n📍 Account: ${account.address}`);

  // Create clients
  const baseSepoliaPublic = createPublicClient({
    chain: baseSepolia,
    transport: http(DEPLOYED.baseSepolia.rpc),
  });
  const baseSepoliaWallet = createWalletClient({
    chain: baseSepolia,
    transport: http(DEPLOYED.baseSepolia.rpc),
    account,
  });
  const sepoliaPublic = createPublicClient({
    chain: sepolia,
    transport: http(DEPLOYED.sepolia.rpc),
  });

  // ==========================================================================
  // Check Balances
  // ==========================================================================
  console.log('\n' + '─'.repeat(60));
  console.log('📊 Current Balances:');

  const baseBalance = await baseSepoliaPublic.readContract({
    address: DEPLOYED.baseSepolia.token,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  console.log(`   Base Sepolia BBLN: ${formatEther(baseBalance)}`);

  const sepoliaBalance = await sepoliaPublic.readContract({
    address: DEPLOYED.sepolia.token,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  console.log(`   Sepolia BBLN: ${formatEther(sepoliaBalance)}`);

  // ==========================================================================
  // Check Router Configuration
  // ==========================================================================
  console.log('\n' + '─'.repeat(60));
  console.log('🔧 Warp Route Configuration:');

  const sepoliaRouter = await baseSepoliaPublic.readContract({
    address: DEPLOYED.baseSepolia.warpRoute,
    abi: WARP_ABI,
    functionName: 'routers',
    args: [DEPLOYED.sepolia.domainId],
  });
  console.log(`   Base Sepolia -> Sepolia Router: ${sepoliaRouter}`);
  console.log(`   Expected: ${addressToBytes32(DEPLOYED.sepolia.warpRoute)}`);

  if (sepoliaRouter === addressToBytes32(DEPLOYED.sepolia.warpRoute)) {
    console.log('   ✅ Router configuration correct!');
  } else {
    console.log('   ❌ Router configuration mismatch!');
  }

  // ==========================================================================
  // Test Transfer (if balance > 0)
  // ==========================================================================
  if (baseBalance > 0n) {
    console.log('\n' + '─'.repeat(60));
    console.log('🚀 Test Cross-Chain Transfer:');

    const transferAmount = parseEther('1'); // 1 BBLN
    if (baseBalance < transferAmount) {
      console.log(`   ⚠️  Insufficient balance for test transfer`);
      return;
    }

    // Get gas quote
    const gasQuote = await baseSepoliaPublic.readContract({
      address: DEPLOYED.baseSepolia.warpRoute,
      abi: WARP_ABI,
      functionName: 'quoteGasPayment',
      args: [DEPLOYED.sepolia.domainId],
    });
    console.log(`   Gas quote: ${formatEther(gasQuote)} ETH`);

    // Check allowance
    const allowance = await baseSepoliaPublic.readContract({
      address: DEPLOYED.baseSepolia.token,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account.address, DEPLOYED.baseSepolia.warpRoute],
    });
    console.log(`   Current allowance: ${formatEther(allowance)}`);

    if (allowance < transferAmount) {
      console.log(`   Approving WarpRoute to spend BBLN...`);
      const approveTx = await baseSepoliaWallet.writeContract({
        address: DEPLOYED.baseSepolia.token,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [DEPLOYED.baseSepolia.warpRoute, transferAmount * 10n],
      });
      await baseSepoliaPublic.waitForTransactionReceipt({ hash: approveTx });
      console.log(`   ✅ Approved: ${approveTx}`);
    }

    // Transfer
    console.log(`\n   Sending ${formatEther(transferAmount)} BBLN to Sepolia...`);
    const transferTx = await baseSepoliaWallet.writeContract({
      address: DEPLOYED.baseSepolia.warpRoute,
      abi: WARP_ABI,
      functionName: 'transferRemote',
      args: [
        DEPLOYED.sepolia.domainId,
        addressToBytes32(account.address),
        transferAmount,
      ],
      value: gasQuote + parseEther('0.001'), // Add buffer for gas
    });
    const receipt = await baseSepoliaPublic.waitForTransactionReceipt({ hash: transferTx });
    console.log(`   ✅ Transfer sent: ${transferTx}`);
    console.log(`   Block: ${receipt.blockNumber}`);

    console.log(`
   📋 Transfer submitted! The Hyperlane relayer will deliver the message.
   
   Monitor at: https://explorer.hyperlane.xyz/message/${transferTx}
   
   Note: It may take a few minutes for the message to be relayed.
   Check Sepolia balance after relay completes.
`);
  } else {
    console.log('\n⚠️  No BBLN balance on Base Sepolia. Cannot test transfer.');
    console.log('   First transfer BBLN to your account on Base Sepolia.');
  }

  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log('\n' + '═'.repeat(60));
  console.log('📋 DEPLOYMENT SUMMARY');
  console.log('═'.repeat(60));
  console.log(`
Base Sepolia (Collateral):
  BBLN Token: ${DEPLOYED.baseSepolia.token}
  Warp Route: ${DEPLOYED.baseSepolia.warpRoute}
  Domain ID: ${DEPLOYED.baseSepolia.domainId}

Sepolia (Synthetic):
  BBLN Token: ${DEPLOYED.sepolia.token}
  Warp Route: ${DEPLOYED.sepolia.warpRoute}
  Domain ID: ${DEPLOYED.sepolia.domainId}

Solana Devnet (Synthetic):
  BBLN Mint: ${DEPLOYED.solanaDevnet.mint}
  Domain ID: ${DEPLOYED.solanaDevnet.domainId}
  Mailbox: ${DEPLOYED.solanaDevnet.mailbox}

View contracts:
  Base Sepolia: https://sepolia.basescan.org/address/${DEPLOYED.baseSepolia.warpRoute}
  Sepolia: https://sepolia.etherscan.io/address/${DEPLOYED.sepolia.warpRoute}
  Solana: https://explorer.solana.com/address/${DEPLOYED.solanaDevnet.mint}?cluster=devnet
`);
}

main().catch((error) => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
