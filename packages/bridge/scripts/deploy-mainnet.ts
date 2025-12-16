#!/usr/bin/env bun

/**
 * @deprecated Use 'jeju deploy zkbridge --network mainnet' instead
 * 
 * ZKSolBridge Mainnet Deployment
 *
 * Deploys ZK light client bridge infrastructure to mainnets:
 * - Ethereum
 * - Base
 * - Arbitrum
 * - Optimism
 * - BSC
 * - Solana Mainnet
 *
 * PRODUCTION DEPLOYMENT - USE WITH CAUTION
 * 
 * Usage:
 *   jeju deploy zkbridge --network mainnet
 *   jeju deploy zkbridge --network mainnet --dry-run
 */

import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parseArgs } from 'util';
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  type Hex,
  http,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum, base, bsc, mainnet, optimism } from 'viem/chains';

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    'dry-run': { type: 'boolean', default: true },
    force: { type: 'boolean', default: false },
    chain: { type: 'string', short: 'c' },
    'skip-confirmation': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (args.help) {
  console.log(`
ZKSolBridge Mainnet Deployment

Usage: bun run deploy:mainnet [options]

Options:
  --dry-run              Simulate deployment (default: true)
  --force                Execute actual deployment
  --chain <name>         Deploy to specific chain only
  --skip-confirmation    Skip confirmation prompts
  -h, --help             Show this help message

Required Environment Variables:
  DEPLOYER_PRIVATE_KEY    Private key for deployment
  ETH_RPC                 Ethereum mainnet RPC
  BASE_RPC                Base mainnet RPC
  ARBITRUM_RPC            Arbitrum mainnet RPC
  OPTIMISM_RPC            Optimism mainnet RPC
  BSC_RPC                 BSC mainnet RPC
  SOLANA_RPC              Solana mainnet RPC
  SOLANA_KEYPAIR_PATH     Path to Solana keypair

WARNING: This script deploys to PRODUCTION networks.
`);
  process.exit(0);
}

// =============================================================================
// CONFIGURATION
// =============================================================================

interface ChainConfig {
  chainId: number;
  name: string;
  chain: typeof mainnet;
  rpcUrl: string;
  explorerUrl: string;
  minBalance: bigint;
}

const CHAINS: ChainConfig[] = [
  {
    chainId: 1,
    name: 'Ethereum',
    chain: mainnet,
    rpcUrl: process.env.ETH_RPC ?? '',
    explorerUrl: 'https://etherscan.io',
    minBalance: BigInt(5e17),
  },
  {
    chainId: 8453,
    name: 'Base',
    chain: base,
    rpcUrl: process.env.BASE_RPC ?? '',
    explorerUrl: 'https://basescan.org',
    minBalance: BigInt(1e17),
  },
  {
    chainId: 42161,
    name: 'Arbitrum',
    chain: arbitrum,
    rpcUrl: process.env.ARBITRUM_RPC ?? '',
    explorerUrl: 'https://arbiscan.io',
    minBalance: BigInt(1e17),
  },
  {
    chainId: 10,
    name: 'Optimism',
    chain: optimism,
    rpcUrl: process.env.OPTIMISM_RPC ?? '',
    explorerUrl: 'https://optimistic.etherscan.io',
    minBalance: BigInt(1e17),
  },
  {
    chainId: 56,
    name: 'BSC',
    chain: bsc,
    rpcUrl: process.env.BSC_RPC ?? '',
    explorerUrl: 'https://bscscan.com',
    minBalance: BigInt(1e17),
  },
];

const DEPLOYMENTS_DIR = join(process.cwd(), '.mainnet-deployments');

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  console.log('\n🚀 ZKSolBridge MAINNET Deployment\n');
  console.log('⚠️  '.repeat(15));
  console.log('⚠️  WARNING: PRODUCTION DEPLOYMENT');
  console.log('⚠️  '.repeat(15));
  console.log('\n' + '='.repeat(60) + '\n');

  if (!args.force && !args['dry-run']) {
    console.log('Error: Mainnet deployment requires --force flag');
    console.log('   Use --dry-run to simulate deployment first');
    process.exit(1);
  }

  if (args['dry-run']) {
    console.log('DRY RUN MODE - No transactions will be executed\n');
  }

  validateEnvironment();

  if (!args['skip-confirmation'] && args.force) {
    console.log('\nYou are about to deploy to MAINNET');
    console.log('   This will spend real funds and cannot be undone.\n');

    const confirmed = await promptConfirmation('Type "DEPLOY" to continue: ');
    if (confirmed !== 'DEPLOY') {
      console.log('Deployment cancelled');
      process.exit(0);
    }
  }

  if (!existsSync(DEPLOYMENTS_DIR)) {
    mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  }

  const deployments: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    mode: 'mainnet',
    bridgeType: 'zk-light-client',
    dryRun: args['dry-run'],
    evm: {},
    solana: {},
  };

  let chainsToDepoy = CHAINS;
  if (args.chain) {
    chainsToDepoy = CHAINS.filter(
      (c) => c.name.toLowerCase() === args.chain?.toLowerCase()
    );
    if (chainsToDepoy.length === 0) {
      console.error(`Error: Chain not found: ${args.chain}`);
      process.exit(1);
    }
  }

  console.log('Deploying EVM ZK Light Client Contracts\n');

  for (const chain of chainsToDepoy) {
    console.log(`\n${chain.name} (${chain.chainId}):`);
    console.log('-'.repeat(40));

    if (!chain.rpcUrl) {
      console.log(`  RPC not configured, skipping`);
      continue;
    }

    if (args['dry-run']) {
      await simulateEVMDeployment(chain);
    } else {
      const deployment = await deployToEVMChain(chain);
      (deployments.evm as Record<string, unknown>)[chain.chainId] = deployment;
    }
  }

  if (!args.chain || args.chain.toLowerCase() === 'solana') {
    console.log('\n\nDeploying Solana EVM Light Client Program\n');
    console.log('-'.repeat(40));

    if (args['dry-run']) {
      await simulateSolanaDeployment();
    } else {
      const solanaDeployment = await deployToSolana();
      deployments.solana = solanaDeployment;
    }
  }

  const deploymentsPath = join(
    DEPLOYMENTS_DIR,
    `deployment-${args['dry-run'] ? 'dryrun-' : ''}${Date.now()}.json`
  );
  writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log(`\nDeployment record saved to: ${deploymentsPath}`);

  console.log('\n' + '='.repeat(60));
  if (args['dry-run']) {
    console.log('\nDry Run Complete.\n');
    console.log('To execute actual deployment:');
    console.log('  bun run deploy:mainnet:force\n');
  } else {
    console.log('\nMainnet Deployment Complete.\n');
    console.log('IMPORTANT POST-DEPLOYMENT STEPS:');
    console.log('  1. Verify all contracts on block explorers');
    console.log('  2. Set up monitoring and alerts');
    console.log('  3. Configure rate limits');
    console.log('  4. Initialize light client with genesis state');
    console.log('  5. Transfer ownership to multisig\n');
  }
}

// =============================================================================
// VALIDATION
// =============================================================================

function validateEnvironment(): void {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    console.error('Error: DEPLOYER_PRIVATE_KEY not set');
    process.exit(1);
  }

  if (!privateKey.startsWith('0x')) {
    console.error('Error: DEPLOYER_PRIVATE_KEY must start with 0x');
    process.exit(1);
  }

  console.log('Environment validated\n');

  const account = privateKeyToAccount(privateKey as Hex);
  console.log(`Deployer: ${account.address}\n`);
}

// =============================================================================
// SIMULATION
// =============================================================================

async function simulateEVMDeployment(chain: ChainConfig): Promise<void> {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY as Hex;
  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain: chain.chain,
    transport: http(chain.rpcUrl),
  });

  try {
    const balance = await publicClient.getBalance({ address: account.address });
    console.log(`  Balance: ${formatEther(balance)} ETH`);

    if (balance < chain.minBalance) {
      console.log(
        `  Insufficient balance (min: ${formatEther(chain.minBalance)} ETH)`
      );
    } else {
      console.log('  Sufficient balance for deployment');
    }

    const gasPrice = await publicClient.getGasPrice();
    console.log(`  Gas Price: ${(Number(gasPrice) / 1e9).toFixed(2)} gwei`);

    const estimatedCost = gasPrice * BigInt(3000000);
    console.log(`  Estimated Cost: ~${formatEther(estimatedCost)} ETH`);

    console.log('  [DRY RUN] Would deploy Solana Light Client + Bridge');
  } catch (error) {
    console.log(
      `  RPC Error: ${error instanceof Error ? error.message : 'Unknown'}`
    );
  }
}

async function simulateSolanaDeployment(): Promise<void> {
  const rpcUrl =
    process.env.SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com';

  try {
    const connection = new Connection(rpcUrl, 'confirmed');
    const keypairPath = process.env.SOLANA_KEYPAIR_PATH;

    if (!keypairPath || !existsSync(keypairPath)) {
      console.log('  Solana keypair not found');
      return;
    }

    const keypairData = JSON.parse(readFileSync(keypairPath, 'utf-8'));
    const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));

    console.log(`  Deployer: ${payer.publicKey.toBase58()}`);

    const balance = await connection.getBalance(payer.publicKey);
    console.log(`  Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

    if (balance < 0.5 * LAMPORTS_PER_SOL) {
      console.log('  Insufficient balance (min: 0.5 SOL)');
    } else {
      console.log('  Sufficient balance for deployment');
    }

    const slot = await connection.getSlot();
    console.log(`  Current Slot: ${slot}`);

    console.log('  [DRY RUN] Would deploy EVM Light Client program');
  } catch (error) {
    console.log(
      `  RPC Error: ${error instanceof Error ? error.message : 'Unknown'}`
    );
  }
}

// =============================================================================
// DEPLOYMENT
// =============================================================================

const SOLANA_LIGHT_CLIENT_BYTECODE = '0x' as const;
const BRIDGE_BYTECODE = '0x' as const;

async function deployToEVMChain(
  chain: ChainConfig
): Promise<Record<string, unknown>> {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY as Hex;
  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain: chain.chain,
    transport: http(chain.rpcUrl),
  });

  const walletClient = createWalletClient({
    chain: chain.chain,
    transport: http(chain.rpcUrl),
    account,
  });

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`  Balance: ${formatEther(balance)} ETH`);

  if (balance < chain.minBalance) {
    throw new Error(`Insufficient balance on ${chain.name}`);
  }

  console.log('  Deploying Solana Light Client (ZK Verifier)...');

  if (SOLANA_LIGHT_CLIENT_BYTECODE === '0x') {
    console.log('  Note: Compile contracts first with: bun run build:contracts');
    console.log('  Skipping deployment - bytecode not available');

    return {
      lightClient: 'NEEDS_DEPLOYMENT',
      bridge: 'NEEDS_DEPLOYMENT',
      chainId: chain.chainId,
      deployer: account.address,
    };
  }

  const lightClientHash = await walletClient.deployContract({
    abi: [],
    bytecode: SOLANA_LIGHT_CLIENT_BYTECODE,
    args: [],
  });

  const lightClientReceipt = await publicClient.waitForTransactionReceipt({
    hash: lightClientHash,
  });

  const lightClientAddress = lightClientReceipt.contractAddress as Address;
  console.log(`  Solana Light Client: ${lightClientAddress}`);

  console.log('  Deploying Bridge...');

  const bridgeHash = await walletClient.deployContract({
    abi: [],
    bytecode: BRIDGE_BYTECODE,
    args: [lightClientAddress],
  });

  const bridgeReceipt = await publicClient.waitForTransactionReceipt({
    hash: bridgeHash,
  });

  const bridgeAddress = bridgeReceipt.contractAddress as Address;
  console.log(`  Bridge: ${bridgeAddress}`);
  console.log(`  Tx: ${chain.explorerUrl}/tx/${bridgeHash}`);

  return {
    lightClient: lightClientAddress,
    bridge: bridgeAddress,
    lightClientTx: lightClientHash,
    bridgeTx: bridgeHash,
    chainId: chain.chainId,
    deployer: account.address,
  };
}

async function deployToSolana(): Promise<Record<string, unknown>> {
  const rpcUrl =
    process.env.SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com';
  const keypairPath = process.env.SOLANA_KEYPAIR_PATH;

  if (!keypairPath || !existsSync(keypairPath)) {
    throw new Error('Solana keypair not found');
  }

  const keypairData = JSON.parse(readFileSync(keypairPath, 'utf-8'));
  const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log(`  Deployer: ${payer.publicKey.toBase58()}`);

  const connection = new Connection(rpcUrl, 'confirmed');
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`  Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    throw new Error('Insufficient SOL balance');
  }

  console.log('  Note: Build Solana programs first with: bun run build:programs');
  console.log('  Then deploy with: anchor deploy');

  return {
    deployer: payer.publicKey.toBase58(),
    evmLightClient: 'BUILD_REQUIRED',
    bridge: 'BUILD_REQUIRED',
    network: 'mainnet-beta',
  };
}

// =============================================================================
// UTILITIES
// =============================================================================

async function promptConfirmation(message: string): Promise<string> {
  process.stdout.write(message);

  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode?.(false);
    stdin.resume();
    stdin.once('data', (data) => {
      resolve(data.toString().trim());
    });
  });
}

// =============================================================================
// RUN
// =============================================================================

main().catch((error) => {
  console.error('\nDeployment failed:', error);
  process.exit(1);
});
