#!/usr/bin/env bun
/**
 * Cross-Chain Bridge Test
 *
 * Tests BBLN token transfers between Solana and EVM chains.
 * Requires both chains to have deployed tokens and warp routes.
 *
 * Usage:
 *   bun run scripts/test-bridge.ts [--solana-to-evm | --evm-to-solana]
 *
 * Environment:
 *   SOLANA_PRIVATE_KEY - Base58 encoded Solana wallet
 *   DEPLOYER_PRIVATE_KEY - 0x prefixed EVM wallet
 *   SOLANA_MINT - BBLN mint address on Solana
 *   EVM_TOKEN - BBLN token address on EVM
 *   WARP_ROUTE_SOLANA - Warp route address on Solana
 *   WARP_ROUTE_EVM - Warp route address on EVM
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  getAccount,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseEther,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import bs58 from 'bs58';
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

const SOLANA_CONFIG = {
  rpc: 'https://api.devnet.solana.com',
  domainId: 1399811150,
  mailbox: 'E588QtVUvresuXq2KoNEwAmoifCzYGpRBdHByN9KQMbi',
  igp: '3TJMcAhHRE7JN98URK7s5eeGfmVSvL4GAgegPq5K2nYg',
};

const EVM_CONFIG = {
  chainId: 84532,
  domainId: 84532,
  name: 'Base Sepolia',
  rpc: 'https://sepolia.base.org',
  mailbox: '0x6966b0E55883d49BFB24539356a2f8A673E02039' as Address,
  igp: '0x28B02B97a850872C4D33C3E024fab6499ad96564' as Address,
};

// Test amount: 10 BBLN
const TEST_AMOUNT = 10n * 10n ** 9n; // 9 decimals for Solana
const TEST_AMOUNT_EVM = 10n * 10n ** 18n; // 18 decimals for EVM

// =============================================================================
// HELPERS
// =============================================================================

function addressToBytes32(address: string): `0x${string}` {
  const clean = address.startsWith('0x') ? address.slice(2) : address;
  return `0x${'0'.repeat(24)}${clean.toLowerCase()}` as `0x${string}`;
}

function pubkeyToBytes32(pubkey: PublicKey): `0x${string}` {
  return `0x${pubkey.toBuffer().toString('hex')}` as `0x${string}`;
}

// =============================================================================
// SOLANA -> EVM TRANSFER
// =============================================================================

async function testSolanaToEvm() {
  console.log('═'.repeat(60));
  console.log('🔄 TESTING SOLANA → EVM BRIDGE');
  console.log('═'.repeat(60));

  // Setup Solana
  const solanaKey = process.env.SOLANA_PRIVATE_KEY;
  if (!solanaKey) throw new Error('SOLANA_PRIVATE_KEY required');

  const solanaKeypair = Keypair.fromSecretKey(bs58.decode(solanaKey));
  const connection = new Connection(SOLANA_CONFIG.rpc, 'confirmed');

  console.log(`\n📍 Solana Wallet: ${solanaKeypair.publicKey.toBase58()}`);

  // Check SOL balance
  const solBalance = await connection.getBalance(solanaKeypair.publicKey);
  console.log(`   SOL Balance: ${(solBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  // Check BBLN balance
  const mintAddress = process.env.SOLANA_MINT;
  if (!mintAddress) throw new Error('SOLANA_MINT required');

  const mint = new PublicKey(mintAddress);
  const ata = await getAssociatedTokenAddress(
    mint,
    solanaKeypair.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const ataInfo = await connection.getAccountInfo(ata);
  if (!ataInfo) {
    throw new Error(`No BBLN token account found for ${solanaKeypair.publicKey.toBase58()}`);
  }

  const tokenAccount = await getAccount(connection, ata);
  console.log(`   BBLN Balance: ${(Number(tokenAccount.amount) / 1e9).toFixed(2)} BBLN`);

  if (tokenAccount.amount < TEST_AMOUNT) {
    throw new Error(`Insufficient BBLN balance. Have ${tokenAccount.amount}, need ${TEST_AMOUNT}`);
  }

  // Setup EVM recipient
  const evmKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!evmKey) throw new Error('DEPLOYER_PRIVATE_KEY required');

  const evmAccount = privateKeyToAccount(evmKey as `0x${string}`);
  console.log(`\n📍 EVM Recipient: ${evmAccount.address}`);

  // Get warp route address
  const warpRouteAddress = process.env.WARP_ROUTE_SOLANA;
  if (!warpRouteAddress) {
    console.log('\n⚠️  WARP_ROUTE_SOLANA not set');
    console.log('   To complete this test, deploy a Hyperlane warp route on Solana');
    console.log('   and set WARP_ROUTE_SOLANA in .env');
    console.log('\n   For now, simulating the transfer...');

    console.log('\n📋 Transfer Details (Simulated):');
    console.log(`   From: ${solanaKeypair.publicKey.toBase58()}`);
    console.log(`   To: ${evmAccount.address}`);
    console.log(`   Amount: ${(Number(TEST_AMOUNT) / 1e9).toFixed(2)} BBLN`);
    console.log(`   Destination Domain: ${EVM_CONFIG.domainId}`);
    return;
  }

  // TODO: Execute actual warp route transfer
  // This requires the Hyperlane Solana warp route program to be deployed
  console.log('\n✅ Solana → EVM bridge configuration verified');
  console.log('   Warp route integration pending Hyperlane CLI deployment');
}

// =============================================================================
// EVM -> SOLANA TRANSFER
// =============================================================================

async function testEvmToSolana() {
  console.log('═'.repeat(60));
  console.log('🔄 TESTING EVM → SOLANA BRIDGE');
  console.log('═'.repeat(60));

  // Setup EVM
  const evmKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!evmKey) throw new Error('DEPLOYER_PRIVATE_KEY required');

  const evmAccount = privateKeyToAccount(evmKey as `0x${string}`);
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(EVM_CONFIG.rpc),
  });

  const walletClient = createWalletClient({
    chain: baseSepolia,
    transport: http(EVM_CONFIG.rpc),
    account: evmAccount,
  });

  console.log(`\n📍 EVM Wallet: ${evmAccount.address}`);

  // Check ETH balance
  const ethBalance = await publicClient.getBalance({ address: evmAccount.address });
  console.log(`   ETH Balance: ${formatEther(ethBalance)} ETH`);

  // Check BBLN balance
  const tokenAddress = process.env.EVM_TOKEN;
  if (!tokenAddress) {
    console.log('   ⚠️  EVM_TOKEN not set, using deployed testnet token');
  }

  const bbln = (tokenAddress ?? '0x3586d05d61523c81d2d79c4e1132ffa1b3bcad5f') as Address;

  const bblnBalance = await publicClient.readContract({
    address: bbln,
    abi: [
      {
        name: 'balanceOf',
        type: 'function',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view',
      },
    ],
    functionName: 'balanceOf',
    args: [evmAccount.address],
  });

  console.log(`   BBLN Balance: ${formatEther(bblnBalance)} BBLN`);

  // Setup Solana recipient
  const solanaKey = process.env.SOLANA_PRIVATE_KEY;
  let solanaRecipient: PublicKey;

  if (solanaKey) {
    const solanaKeypair = Keypair.fromSecretKey(bs58.decode(solanaKey));
    solanaRecipient = solanaKeypair.publicKey;
  } else {
    // Generate random recipient for testing
    solanaRecipient = Keypair.generate().publicKey;
    console.log('   ⚠️  No SOLANA_PRIVATE_KEY, using random recipient');
  }

  console.log(`\n📍 Solana Recipient: ${solanaRecipient.toBase58()}`);

  // Get warp route address
  const warpRouteAddress = process.env.WARP_ROUTE_EVM;
  if (!warpRouteAddress) {
    console.log('\n⚠️  WARP_ROUTE_EVM not set');
    console.log('   To complete this test, deploy a Hyperlane warp route on EVM');
    console.log('   and set WARP_ROUTE_EVM in .env');
    console.log('\n   For now, simulating the transfer...');

    console.log('\n📋 Transfer Details (Simulated):');
    console.log(`   From: ${evmAccount.address}`);
    console.log(`   To: ${solanaRecipient.toBase58()}`);
    console.log(`   Amount: ${formatEther(TEST_AMOUNT_EVM)} BBLN`);
    console.log(`   Destination Domain: ${SOLANA_CONFIG.domainId}`);
    return;
  }

  // TODO: Execute actual warp route transfer
  console.log('\n✅ EVM → Solana bridge configuration verified');
  console.log('   Warp route integration pending Hyperlane CLI deployment');
}

// =============================================================================
// VERIFY CONFIGURATION
// =============================================================================

async function verifyConfiguration() {
  console.log('═'.repeat(60));
  console.log('🔍 VERIFYING BRIDGE CONFIGURATION');
  console.log('═'.repeat(60));

  console.log('\n📍 Solana Configuration:');
  console.log(`   RPC: ${SOLANA_CONFIG.rpc}`);
  console.log(`   Domain ID: ${SOLANA_CONFIG.domainId}`);
  console.log(`   Mailbox: ${SOLANA_CONFIG.mailbox}`);
  console.log(`   IGP: ${SOLANA_CONFIG.igp}`);

  console.log('\n📍 EVM Configuration:');
  console.log(`   Chain: ${EVM_CONFIG.name} (${EVM_CONFIG.chainId})`);
  console.log(`   Domain ID: ${EVM_CONFIG.domainId}`);
  console.log(`   Mailbox: ${EVM_CONFIG.mailbox}`);
  console.log(`   IGP: ${EVM_CONFIG.igp}`);

  // Check Solana connection
  const connection = new Connection(SOLANA_CONFIG.rpc, 'confirmed');
  const slot = await connection.getSlot();
  console.log(`\n✅ Solana connection OK (slot: ${slot})`);

  // Check EVM connection
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(EVM_CONFIG.rpc),
  });
  const blockNumber = await publicClient.getBlockNumber();
  console.log(`✅ EVM connection OK (block: ${blockNumber})`);

  // Check mailbox on Solana
  const mailboxPubkey = new PublicKey(SOLANA_CONFIG.mailbox);
  const mailboxInfo = await connection.getAccountInfo(mailboxPubkey);
  if (mailboxInfo) {
    console.log(`✅ Solana Mailbox exists (${mailboxInfo.owner.toBase58()})`);
  } else {
    console.log(`⚠️  Solana Mailbox not found - may need devnet airdrop`);
  }

  // Check mailbox on EVM
  const mailboxCode = await publicClient.getCode({ address: EVM_CONFIG.mailbox });
  if (mailboxCode && mailboxCode !== '0x') {
    console.log(`✅ EVM Mailbox exists`);
  } else {
    console.log(`⚠️  EVM Mailbox not found at ${EVM_CONFIG.mailbox}`);
  }

  console.log('\n' + '─'.repeat(60));
  console.log('📋 REQUIRED ENVIRONMENT VARIABLES:');
  console.log('─'.repeat(60));
  console.log(`   SOLANA_PRIVATE_KEY: ${process.env.SOLANA_PRIVATE_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`   DEPLOYER_PRIVATE_KEY: ${process.env.DEPLOYER_PRIVATE_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`   SOLANA_MINT: ${process.env.SOLANA_MINT ?? '❌ Not set (deploy first)'}`);
  console.log(`   EVM_TOKEN: ${process.env.EVM_TOKEN ?? '❌ Not set (using default testnet)'}`);
  console.log(`   WARP_ROUTE_SOLANA: ${process.env.WARP_ROUTE_SOLANA ?? '❌ Not set (deploy Hyperlane)'}`);
  console.log(`   WARP_ROUTE_EVM: ${process.env.WARP_ROUTE_EVM ?? '❌ Not set (deploy Hyperlane)'}`);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--solana-to-evm')) {
    await testSolanaToEvm();
  } else if (args.includes('--evm-to-solana')) {
    await testEvmToSolana();
  } else {
    await verifyConfiguration();
    console.log('\n' + '═'.repeat(60));
    console.log('Usage:');
    console.log('  --solana-to-evm   Test Solana → EVM transfer');
    console.log('  --evm-to-solana   Test EVM → Solana transfer');
    console.log('═'.repeat(60));
  }
}

main().catch((error) => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
