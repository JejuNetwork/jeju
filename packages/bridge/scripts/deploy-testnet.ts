#!/usr/bin/env bun

/**
 * ZKSolBridge Testnet Deployment
 *
 * Deploys ZK light client bridge infrastructure to testnets:
 * - Base Sepolia
 * - Sepolia
 * - Arbitrum Sepolia
 * - Solana Devnet
 *
 * No Hyperlane - pure ZK verification.
 */

import { Connection, Keypair } from '@solana/web3.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parseArgs } from 'util';
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia, baseSepolia, sepolia } from 'viem/chains';

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    'evm-only': { type: 'boolean', default: false },
    'solana-only': { type: 'boolean', default: false },
    'skip-verify': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (args.help) {
  console.log(`
ZKSolBridge Testnet Deployment

Usage: bun run deploy:testnet [options]

Options:
  --evm-only       Only deploy EVM contracts
  --solana-only    Only deploy Solana programs
  --skip-verify    Skip contract verification
  --dry-run        Simulate deployment without executing
  -h, --help       Show this help message

Required Environment Variables:
  DEPLOYER_PRIVATE_KEY    Private key for deployment
  BASE_SEPOLIA_RPC_URL    Base Sepolia RPC endpoint
  SEPOLIA_RPC_URL         Sepolia RPC endpoint (optional)
  ARBITRUM_SEPOLIA_RPC    Arbitrum Sepolia RPC endpoint (optional)
  SOLANA_DEVNET_RPC       Solana devnet RPC endpoint
  SOLANA_KEYPAIR_PATH     Path to Solana keypair JSON
`);
  process.exit(0);
}

// =============================================================================
// CONFIGURATION
// =============================================================================

interface ChainConfig {
  chainId: number;
  name: string;
  chain: typeof baseSepolia;
  rpcUrl: string;
  explorerUrl: string;
}

const CHAINS: ChainConfig[] = [
  {
    chainId: 84532,
    name: 'Base Sepolia',
    chain: baseSepolia,
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
  },
  {
    chainId: 11155111,
    name: 'Sepolia',
    chain: sepolia,
    rpcUrl: process.env.SEPOLIA_RPC_URL ?? 'https://rpc.sepolia.org',
    explorerUrl: 'https://sepolia.etherscan.io',
  },
  {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    chain: arbitrumSepolia,
    rpcUrl:
      process.env.ARBITRUM_SEPOLIA_RPC ??
      'https://sepolia-rollup.arbitrum.io/rpc',
    explorerUrl: 'https://sepolia.arbiscan.io',
  },
];

const DEPLOYMENTS_DIR = join(process.cwd(), '.testnet-deployments');

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  console.log('\n🚀 ZKSolBridge Testnet Deployment\n');
  console.log('='.repeat(60) + '\n');

  validateEnvironment();

  if (!existsSync(DEPLOYMENTS_DIR)) {
    mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  }

  const deployments: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    mode: 'testnet',
    bridgeType: 'zk-light-client',
    evm: {},
    solana: {},
  };

  if (!args['solana-only']) {
    console.log('📋 Deploying EVM ZK Light Client Contracts\n');

    for (const chain of CHAINS) {
      console.log(`\n${chain.name} (${chain.chainId}):`);
      console.log('-'.repeat(40));

      if (args['dry-run']) {
        console.log('  [DRY RUN] Would deploy to', chain.rpcUrl);
        continue;
      }

      const deployment = await deployToEVMChain(chain);
      (deployments.evm as Record<string, unknown>)[chain.chainId] = deployment;
    }
  }

  if (!args['evm-only']) {
    console.log('\n\n📋 Deploying Solana EVM Light Client Program\n');
    console.log('-'.repeat(40));

    if (args['dry-run']) {
      console.log('  [DRY RUN] Would deploy to Solana devnet');
    } else {
      const solanaDeployment = await deployToSolana();
      deployments.solana = solanaDeployment;
    }
  }

  const deploymentsPath = join(
    DEPLOYMENTS_DIR,
    `deployment-${Date.now()}.json`
  );
  writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log(`\n📁 Deployments saved to: ${deploymentsPath}`);

  console.log('\n' + '='.repeat(60));
  console.log('\n✅ Testnet Deployment Complete.\n');
  console.log('Deployed contracts:');

  for (const [chainId, deployment] of Object.entries(
    deployments.evm as Record<string, unknown>
  )) {
    const chain = CHAINS.find((c) => c.chainId === Number(chainId));
    const d = deployment as { lightClient?: string; bridge?: string };
    console.log(`  ${chain?.name ?? chainId}:`);
    console.log(`    Light Client: ${d.lightClient ?? 'N/A'}`);
    console.log(`    Bridge: ${d.bridge ?? 'N/A'}`);
  }

  if (deployments.solana && typeof deployments.solana === 'object') {
    const s = deployments.solana as {
      evmLightClient?: string;
      bridge?: string;
    };
    console.log(`  Solana Devnet:`);
    console.log(`    EVM Light Client: ${s.evmLightClient ?? 'N/A'}`);
    console.log(`    Bridge: ${s.bridge ?? 'N/A'}`);
  }

  console.log('\nNext steps:');
  console.log('  1. Build and deploy ZK circuits: bun run build:circuits');
  console.log('  2. Start the prover: bun run prover');
  console.log('  3. Run the relayer: bun run relayer');
  console.log('  4. Test transfers with bun run demo\n');
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
// EVM DEPLOYMENT
// =============================================================================

// Solana Light Client bytecode placeholder - deploy actual verified contract
const SOLANA_LIGHT_CLIENT_BYTECODE = '0x' as const;
const BRIDGE_BYTECODE = '0x' as const;

async function deployToEVMChain(
  chainConfig: ChainConfig
): Promise<Record<string, unknown>> {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY as Hex;
  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain: chainConfig.chain,
    transport: http(chainConfig.rpcUrl),
  });

  const walletClient = createWalletClient({
    chain: chainConfig.chain,
    transport: http(chainConfig.rpcUrl),
    account,
  });

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`  Balance: ${(Number(balance) / 1e18).toFixed(4)} ETH`);

  if (balance < BigInt(1e16)) {
    console.log('  Warning: Low balance, deployment may fail');
  }

  // Deploy Solana Light Client (ZK verifier)
  console.log('  Deploying Solana Light Client...');

  // For now, log that we need the actual compiled contracts
  if (SOLANA_LIGHT_CLIENT_BYTECODE === '0x') {
    console.log('  Note: Compile contracts first with: bun run build:contracts');
    console.log('  Skipping actual deployment - bytecode not available');

    return {
      lightClient: 'NEEDS_DEPLOYMENT',
      bridge: 'NEEDS_DEPLOYMENT',
      chainId: chainConfig.chainId,
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

  // Deploy Bridge
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
  console.log(`  Tx: ${chainConfig.explorerUrl}/tx/${bridgeHash}`);

  return {
    lightClient: lightClientAddress,
    bridge: bridgeAddress,
    lightClientTx: lightClientHash,
    bridgeTx: bridgeHash,
    chainId: chainConfig.chainId,
    deployer: account.address,
  };
}

// =============================================================================
// SOLANA DEPLOYMENT
// =============================================================================

async function deployToSolana(): Promise<Record<string, unknown>> {
  const rpcUrl =
    process.env.SOLANA_DEVNET_RPC ?? 'https://api.devnet.solana.com';
  const keypairPath =
    process.env.SOLANA_KEYPAIR_PATH ??
    join(process.env.HOME ?? '~', '.config', 'solana', 'id.json');

  console.log(`  RPC: ${rpcUrl}`);

  let payer: Keypair;
  try {
    const keypairData = JSON.parse(readFileSync(keypairPath, 'utf-8'));
    payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  } catch (_error) {
    console.log('  Keypair not found, generating new one');
    payer = Keypair.generate();

    const solanaDir = join(DEPLOYMENTS_DIR, 'solana');
    if (!existsSync(solanaDir)) {
      mkdirSync(solanaDir, { recursive: true });
    }
    writeFileSync(
      join(solanaDir, 'keypair.json'),
      JSON.stringify(Array.from(payer.secretKey))
    );
  }

  console.log(`  Deployer: ${payer.publicKey.toBase58()}`);

  const connection = new Connection(rpcUrl, 'confirmed');
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`  Balance: ${(balance / 1e9).toFixed(4)} SOL`);

  if (balance < 1e8) {
    console.log('  Low balance, requesting airdrop...');
    try {
      const sig = await connection.requestAirdrop(payer.publicKey, 1e9);
      await connection.confirmTransaction(sig);
      console.log('  Airdrop received');
    } catch (_error) {
      console.log('  Airdrop failed, deployment may fail');
    }
  }

  // Solana programs need to be built with Anchor first
  console.log('  Note: Build Solana programs first with: bun run build:programs');
  console.log('  Then deploy with: anchor deploy');

  return {
    deployer: payer.publicKey.toBase58(),
    evmLightClient: 'BUILD_REQUIRED',
    bridge: 'BUILD_REQUIRED',
    network: 'devnet',
  };
}

// =============================================================================
// RUN
// =============================================================================

main().catch((error) => {
  console.error('\nDeployment failed:', error);
  process.exit(1);
});
