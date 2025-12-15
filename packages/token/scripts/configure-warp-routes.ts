#!/usr/bin/env bun
/**
 * Configure Deployed Warp Routes
 *
 * Completes configuration for already deployed warp routes
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  getAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, sepolia } from 'viem/chains';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

// Load .env
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
    token: '0x3586d05d61523c81d2d79c4e1132ffa1b3bcad5f' as Address,
    warpRoute: '0x2071a7d3b7e72ed0ee7a60da6d98edaeebdb3d2d' as Address,
    igp: getAddress('0x28B02B97a850872C4D33C3E024fab6499ad96564'),
    rpc: process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org',
  },
  sepolia: {
    token: '0xa8f3b42dfb4cb9c583b487beec75c2d90e9cecab' as Address,
    warpRoute: '0x5ea72ab480fa99f9bc8a00786faaf0d01fe88eb1' as Address,
    igp: getAddress('0x6f2756380FD49228ae25Aa7F2817993cB74Ecc56'),
    rpc: process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com',
  },
};

const WARP_ABI = [
  {
    name: 'setInterchainGasPaymaster',
    type: 'function',
    inputs: [{ name: '_igp', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

const TOKEN_ABI = [
  {
    name: 'setMinter',
    type: 'function',
    inputs: [
      { name: 'minter', type: 'address' },
      { name: 'authorized', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

async function main() {
  console.log('═'.repeat(60));
  console.log('🔧 CONFIGURING WARP ROUTES');
  console.log('═'.repeat(60));

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY required');
  }

  const account = privateKeyToAccount(privateKey as Hex);
  console.log(`\n📍 Deployer: ${account.address}`);

  // Sepolia client
  const sepoliaPublic = createPublicClient({
    chain: sepolia,
    transport: http(DEPLOYED.sepolia.rpc),
  });
  const sepoliaWallet = createWalletClient({
    chain: sepolia,
    transport: http(DEPLOYED.sepolia.rpc),
    account,
  });

  // Set IGP on Sepolia WarpRoute
  console.log('\n📦 Setting IGP on Sepolia WarpRoute...');
  const igpTx = await sepoliaWallet.writeContract({
    address: DEPLOYED.sepolia.warpRoute,
    abi: WARP_ABI,
    functionName: 'setInterchainGasPaymaster',
    args: [DEPLOYED.sepolia.igp],
  });
  await sepoliaPublic.waitForTransactionReceipt({ hash: igpTx });
  console.log(`   ✅ IGP set: ${igpTx}`);

  // Authorize WarpRoute as minter
  console.log('\n📦 Authorizing WarpRoute as minter on Sepolia BBLN...');
  const minterTx = await sepoliaWallet.writeContract({
    address: DEPLOYED.sepolia.token,
    abi: TOKEN_ABI,
    functionName: 'setMinter',
    args: [DEPLOYED.sepolia.warpRoute, true],
  });
  await sepoliaPublic.waitForTransactionReceipt({ hash: minterTx });
  console.log(`   ✅ WarpRoute authorized as minter: ${minterTx}`);

  console.log('\n' + '═'.repeat(60));
  console.log('✅ CONFIGURATION COMPLETE');
  console.log('═'.repeat(60));
  console.log(`
📋 Deployed Contracts:

Base Sepolia (Collateral):
  Token: ${DEPLOYED.baseSepolia.token}
  WarpRoute: ${DEPLOYED.baseSepolia.warpRoute}

Sepolia (Synthetic):
  Token: ${DEPLOYED.sepolia.token}
  WarpRoute: ${DEPLOYED.sepolia.warpRoute}
`);
}

main().catch((error) => {
  console.error('\n❌ Configuration failed:', error);
  process.exit(1);
});
