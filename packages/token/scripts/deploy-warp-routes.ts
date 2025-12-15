#!/usr/bin/env bun
/**
 * Deploy Hyperlane Warp Routes for BBLN Token
 *
 * Deploys our custom WarpRoute contracts to enable cross-chain transfers
 * between Base Sepolia and Sepolia testnets.
 *
 * Usage:
 *   bun run scripts/deploy-warp-routes.ts
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
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, sepolia } from 'viem/chains';
import { deployContract } from '../src/deployer/contract-deployer';
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
// CONFIGURATION
// =============================================================================

// BBLN Token on Base Sepolia (already deployed)
const BBLN_BASE_SEPOLIA = '0x3586d05d61523c81d2d79c4e1132ffa1b3bcad5f' as Address;

// Hyperlane infrastructure
const HYPERLANE_CONFIG = {
  baseSepolia: {
    chainId: 84532,
    domainId: 84532,
    mailbox: '0x6966b0E55883d49BFB24539356a2f8A673E02039' as Address,
    igp: '0x28B02B97a850872C4D33C3E024fab6499ad96564' as Address,
    rpc: process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org',
  },
  sepolia: {
    chainId: 11155111,
    domainId: 11155111,
    mailbox: '0xfFAEF09B3cd11D9b20d1a19bECca54EEC2884766' as Address,
    igp: '0x6f2756380FD49228ae25Aa7F2817993cB74Ecc56' as Address,
    rpc: process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com',
  },
};

function addressToBytes32(address: Address): Hex {
  return padHex(address, { size: 32 });
}

// =============================================================================
// DEPLOYMENT
// =============================================================================

async function main() {
  console.log('═'.repeat(60));
  console.log('🚀 BBLN WARP ROUTE DEPLOYMENT');
  console.log('═'.repeat(60));

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY required');
  }

  const account = privateKeyToAccount(privateKey as Hex);
  console.log(`\n📍 Deployer: ${account.address}`);

  // Create clients for both chains
  const baseSepoliaPublic = createPublicClient({
    chain: baseSepolia,
    transport: http(HYPERLANE_CONFIG.baseSepolia.rpc),
  });
  const baseSepoliaWallet = createWalletClient({
    chain: baseSepolia,
    transport: http(HYPERLANE_CONFIG.baseSepolia.rpc),
    account,
  });

  const sepoliaPublic = createPublicClient({
    chain: sepolia,
    transport: http(HYPERLANE_CONFIG.sepolia.rpc),
  });
  const sepoliaWallet = createWalletClient({
    chain: sepolia,
    transport: http(HYPERLANE_CONFIG.sepolia.rpc),
    account,
  });

  // Check balances
  const baseBalance = await baseSepoliaPublic.getBalance({ address: account.address });
  const sepoliaBalance = await sepoliaPublic.getBalance({ address: account.address });

  console.log(`\n💰 Base Sepolia Balance: ${formatEther(baseBalance)} ETH`);
  console.log(`💰 Sepolia Balance: ${formatEther(sepoliaBalance)} ETH`);

  // ==========================================================================
  // Deploy Warp Route on Base Sepolia (Collateral mode)
  // ==========================================================================
  console.log('\n' + '─'.repeat(60));
  console.log('📦 Deploying WarpRoute on Base Sepolia (Collateral)...');

  const { address: warpRouteBaseSepolia, txHash: txBase } = await deployContract(
    baseSepoliaPublic,
    baseSepoliaWallet,
    'WarpRoute',
    [
      HYPERLANE_CONFIG.baseSepolia.mailbox, // mailbox
      BBLN_BASE_SEPOLIA, // token
      true, // isCollateral
      account.address, // owner
    ]
  );

  console.log(`   ✅ Base Sepolia WarpRoute: ${warpRouteBaseSepolia}`);
  console.log(`   Tx: ${txBase}`);

  // ==========================================================================
  // Deploy BBLN Token on Sepolia (Synthetic) 
  // Then deploy Warp Route
  // ==========================================================================
  console.log('\n' + '─'.repeat(60));
  console.log('📦 Deploying BBLN Token on Sepolia (Synthetic)...');

  const { address: bblnSepolia, txHash: txTokenSepolia } = await deployContract(
    sepoliaPublic,
    sepoliaWallet,
    'BabylonToken',
    [
      'Babylon', // name
      'BBLN', // symbol
      0n, // initial supply (synthetic - minted by warp route)
      account.address, // owner
      false, // isHomeChain (synthetic chain)
    ]
  );

  console.log(`   ✅ Sepolia BBLN Token: ${bblnSepolia}`);
  console.log(`   Tx: ${txTokenSepolia}`);

  console.log('\n📦 Deploying WarpRoute on Sepolia (Synthetic)...');

  const { address: warpRouteSepolia, txHash: txWarpSepolia } = await deployContract(
    sepoliaPublic,
    sepoliaWallet,
    'WarpRoute',
    [
      HYPERLANE_CONFIG.sepolia.mailbox, // mailbox
      bblnSepolia, // token
      false, // isCollateral (synthetic mode)
      account.address, // owner
    ]
  );

  console.log(`   ✅ Sepolia WarpRoute: ${warpRouteSepolia}`);
  console.log(`   Tx: ${txWarpSepolia}`);

  // ==========================================================================
  // Configure Warp Routes (enroll remote routers)
  // ==========================================================================
  console.log('\n' + '─'.repeat(60));
  console.log('🔧 Configuring Warp Routes...');

  // Enroll Sepolia router on Base Sepolia
  console.log('   Enrolling Sepolia router on Base Sepolia...');
  const enrollBaseTx = await baseSepoliaWallet.writeContract({
    address: warpRouteBaseSepolia,
    abi: [
      {
        name: 'enrollRemoteRouter',
        type: 'function',
        inputs: [
          { name: '_domain', type: 'uint32' },
          { name: '_router', type: 'bytes32' },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ],
    functionName: 'enrollRemoteRouter',
    args: [HYPERLANE_CONFIG.sepolia.domainId, addressToBytes32(warpRouteSepolia)],
  });
  await baseSepoliaPublic.waitForTransactionReceipt({ hash: enrollBaseTx });
  console.log(`   ✅ Enrolled on Base Sepolia: ${enrollBaseTx}`);

  // Enroll Base Sepolia router on Sepolia
  console.log('   Enrolling Base Sepolia router on Sepolia...');
  const enrollSepoliaTx = await sepoliaWallet.writeContract({
    address: warpRouteSepolia,
    abi: [
      {
        name: 'enrollRemoteRouter',
        type: 'function',
        inputs: [
          { name: '_domain', type: 'uint32' },
          { name: '_router', type: 'bytes32' },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ],
    functionName: 'enrollRemoteRouter',
    args: [HYPERLANE_CONFIG.baseSepolia.domainId, addressToBytes32(warpRouteBaseSepolia)],
  });
  await sepoliaPublic.waitForTransactionReceipt({ hash: enrollSepoliaTx });
  console.log(`   ✅ Enrolled on Sepolia: ${enrollSepoliaTx}`);

  // Set IGP on both routes
  console.log('   Setting IGP on Base Sepolia...');
  const igpBaseTx = await baseSepoliaWallet.writeContract({
    address: warpRouteBaseSepolia,
    abi: [
      {
        name: 'setInterchainGasPaymaster',
        type: 'function',
        inputs: [{ name: '_igp', type: 'address' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ],
    functionName: 'setInterchainGasPaymaster',
    args: [HYPERLANE_CONFIG.baseSepolia.igp],
  });
  await baseSepoliaPublic.waitForTransactionReceipt({ hash: igpBaseTx });
  console.log(`   ✅ IGP set on Base Sepolia: ${igpBaseTx}`);

  console.log('   Setting IGP on Sepolia...');
  const igpSepoliaTx = await sepoliaWallet.writeContract({
    address: warpRouteSepolia,
    abi: [
      {
        name: 'setInterchainGasPaymaster',
        type: 'function',
        inputs: [{ name: '_igp', type: 'address' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ],
    functionName: 'setInterchainGasPaymaster',
    args: [HYPERLANE_CONFIG.sepolia.igp],
  });
  await sepoliaPublic.waitForTransactionReceipt({ hash: igpSepoliaTx });
  console.log(`   ✅ IGP set on Sepolia: ${igpSepoliaTx}`);

  // ==========================================================================
  // Authorize WarpRoute as minter on Sepolia BBLN
  // ==========================================================================
  console.log('\n' + '─'.repeat(60));
  console.log('🔧 Authorizing WarpRoute as minter on Sepolia BBLN...');

  const setMinterTx = await sepoliaWallet.writeContract({
    address: bblnSepolia,
    abi: [
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
    ],
    functionName: 'setMinter',
    args: [warpRouteSepolia, true],
  });
  await sepoliaPublic.waitForTransactionReceipt({ hash: setMinterTx });
  console.log(`   ✅ WarpRoute authorized as minter: ${setMinterTx}`);

  // ==========================================================================
  // Summary
  // ==========================================================================
  const deployment = {
    timestamp: new Date().toISOString(),
    deployer: account.address,
    baseSepolia: {
      chainId: HYPERLANE_CONFIG.baseSepolia.chainId,
      domainId: HYPERLANE_CONFIG.baseSepolia.domainId,
      token: BBLN_BASE_SEPOLIA,
      warpRoute: warpRouteBaseSepolia,
      type: 'collateral',
    },
    sepolia: {
      chainId: HYPERLANE_CONFIG.sepolia.chainId,
      domainId: HYPERLANE_CONFIG.sepolia.domainId,
      token: bblnSepolia,
      warpRoute: warpRouteSepolia,
      type: 'synthetic',
    },
  };

  // Save deployment
  const deploymentPath = resolve(import.meta.dir, `../deployments/warp-routes-${Date.now()}.json`);
  await Bun.write(deploymentPath, JSON.stringify(deployment, null, 2));

  console.log('\n' + '═'.repeat(60));
  console.log('✅ WARP ROUTE DEPLOYMENT COMPLETE');
  console.log('═'.repeat(60));
  console.log(`
📋 Deployment Summary:

Base Sepolia (Collateral):
  Token: ${BBLN_BASE_SEPOLIA}
  WarpRoute: ${warpRouteBaseSepolia}
  Domain ID: ${HYPERLANE_CONFIG.baseSepolia.domainId}

Sepolia (Synthetic):
  Token: ${bblnSepolia}
  WarpRoute: ${warpRouteSepolia}
  Domain ID: ${HYPERLANE_CONFIG.sepolia.domainId}

Deployment saved: ${deploymentPath}

🔄 To test cross-chain transfer:
  1. Approve BBLN to WarpRoute on Base Sepolia
  2. Call transferRemote(${HYPERLANE_CONFIG.sepolia.domainId}, <recipient_bytes32>, <amount>)
  3. Wait for Hyperlane relayer to deliver message
  4. Check BBLN balance on Sepolia
`);
}

main().catch((error) => {
  console.error('\n❌ Deployment failed:', error);
  process.exit(1);
});
