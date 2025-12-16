#!/usr/bin/env bun
/**
 * @deprecated Use 'jeju token deploy solana' instead
 * 
 * Deploy SPL Token to Solana
 *
 * Deploys an SPL token to Solana devnet/mainnet with Hyperlane warp route setup.
 *
 * Usage:
 *   jeju token deploy solana --network devnet
 *   jeju token deploy solana --network mainnet
 *   jeju token deploy solana --network devnet --dry-run
 *
 * Environment:
 *   SOLANA_PRIVATE_KEY - Base58 encoded private key
 *   TOKEN_NAME - Token name (default: "Jeju Token")
 *   TOKEN_SYMBOL - Token symbol (default: "JEJU")
 *   TOKEN_DECIMALS - Decimals (default: 9)
 *   INITIAL_SUPPLY - Initial supply (default: 1000000000)
 */

import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { SolanaInfraManager } from '../src/integration/solana-infra';
import bs58 from 'bs58';

// Parse arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const networkArg = args.find((a) => a === 'mainnet') ?? 'devnet';
const network = networkArg as 'mainnet' | 'devnet';

// Configuration
const config = {
  name: process.env.TOKEN_NAME ?? 'Jeju Token',
  symbol: process.env.TOKEN_SYMBOL ?? 'JEJU',
  decimals: Number(process.env.TOKEN_DECIMALS ?? '9'),
  initialSupply: BigInt(process.env.INITIAL_SUPPLY ?? '1000000000') * 10n ** 9n,
};

async function main() {
  console.log('='.repeat(60));
  console.log(`Solana SPL Token Deployment${isDryRun ? ' (DRY RUN)' : ''}`);
  console.log('='.repeat(60));
  console.log(`Network: ${network}`);
  console.log(`Token: ${config.name} (${config.symbol})`);
  console.log(`Decimals: ${config.decimals}`);
  console.log(
    `Initial Supply: ${(config.initialSupply / 10n ** BigInt(config.decimals)).toLocaleString()}`
  );
  console.log('');

  // Initialize Solana infrastructure
  const solana = new SolanaInfraManager(network);
  console.log('Checking Solana connection...');

  const status = await solana.getStatus();
  console.log(`  Slot: ${status.slot}`);
  console.log(`  Block Height: ${status.blockHeight}`);
  console.log(`  Latency: ${status.latency}ms`);
  console.log('');

  // Get keypair
  let keypair: Keypair;
  const privateKeyEnv = process.env.SOLANA_PRIVATE_KEY;

  if (privateKeyEnv) {
    const privateKeyBytes = bs58.decode(privateKeyEnv);
    keypair = Keypair.fromSecretKey(privateKeyBytes);
  } else {
    // Generate new keypair for testing
    keypair = Keypair.generate();
    console.log('WARNING: Generated new keypair (no SOLANA_PRIVATE_KEY set)');
    console.log(
      `  Public Key: ${keypair.publicKey.toBase58()}`
    );

    if (network === 'devnet' && !isDryRun) {
      console.log('  Requesting airdrop...');
      await solana.airdrop(keypair.publicKey, 2);
      console.log('  Airdrop complete');
    }
  }

  const balance = await solana.getBalance(keypair.publicKey);
  console.log(`Deployer: ${keypair.publicKey.toBase58()}`);
  console.log(`Balance: ${balance} SOL`);
  console.log('');

  if (isDryRun) {
    console.log('DRY RUN - Would deploy:');
    console.log(`  Token: ${config.name}`);
    console.log(`  Symbol: ${config.symbol}`);
    console.log(`  Decimals: ${config.decimals}`);
    console.log(
      `  Initial Supply: ${(config.initialSupply / 10n ** BigInt(config.decimals)).toLocaleString()}`
    );
    console.log('');
    console.log('To deploy for real, run without --dry-run');
    return;
  }

  if (balance < 0.1) {
    throw new Error(
      `Insufficient SOL balance: ${balance}. Need at least 0.1 SOL for deployment.`
    );
  }

  console.log('Deploying SPL token...');
  const result = await solana.deployToken(keypair, {
    name: config.name,
    symbol: config.symbol,
    decimals: config.decimals,
    initialSupply: config.initialSupply,
    mintAuthority: keypair.publicKey,
  });

  console.log('');
  console.log('='.repeat(60));
  console.log('DEPLOYMENT COMPLETE');
  console.log('='.repeat(60));
  console.log(`Mint Address: ${result.mint.toBase58()}`);
  console.log(`Signature: ${result.signature}`);
  console.log(`Explorer: ${result.explorerUrl}`);
  console.log('');
  console.log('Next steps:');
  console.log('1. Save the mint address for warp route configuration');
  console.log('2. Deploy Hyperlane warp route using hyperlane CLI');
  console.log('3. Configure cross-chain transfers');
}

main().catch((err) => {
  console.error('Deployment failed:', err);
  process.exit(1);
});
