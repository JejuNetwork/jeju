#!/usr/bin/env bun

/**
 * ZKSolBridge Testnet Deployment
 *
 * Deploys ZK light client bridge infrastructure to testnets:
 * - Base Sepolia (primary)
 * - Solana Devnet
 *
 * Integrates with Jeju Autocrat Council for governance.
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parseArgs } from 'util';
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    'evm-only': { type: 'boolean', default: false },
    'solana-only': { type: 'boolean', default: false },
    'skip-verify': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'governed': { type: 'boolean', default: true },
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
  --no-governed    Deploy without governance (admin mode)
  -h, --help       Show this help message

Required Environment Variables:
  DEPLOYER_PRIVATE_KEY    Private key for deployment
  BASE_SEPOLIA_RPC_URL    Base Sepolia RPC endpoint
  COUNCIL_ADDRESS         Autocrat Council contract address
  GUARDIAN_ADDRESS        Emergency guardian address (multisig)
  SOLANA_DEVNET_RPC       Solana devnet RPC endpoint
  SOLANA_KEYPAIR_PATH     Path to Solana keypair JSON
`);
  process.exit(0);
}

const CONTRACTS_DIR = join(process.cwd(), 'contracts');
const DEPLOYMENTS_DIR = join(process.cwd(), '.testnet-deployments');
const OUT_DIR = join(CONTRACTS_DIR, 'out');

interface DeploymentResult {
  verifier: Address;
  lightClient: Address;
  bridge: Address;
  token: Address;
  council: Address;
  guardian: Address;
  deployer: Address;
  chainId: number;
  txHashes: Record<string, Hex>;
}

async function main(): Promise<void> {
  console.log('\n🚀 ZKSolBridge Testnet Deployment\n');
  console.log('='.repeat(60) + '\n');

  validateEnvironment();

  if (!existsSync(DEPLOYMENTS_DIR)) {
    mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  }

  // Build contracts first
  console.log('📦 Building contracts...\n');
  try {
    execSync('forge build', { cwd: CONTRACTS_DIR, stdio: 'inherit' });
  } catch {
    console.error('Failed to build contracts');
    process.exit(1);
  }

  const deployments: {
    timestamp: string;
    mode: string;
    governed: boolean;
    evm: DeploymentResult | null;
    solana: Record<string, string> | null;
  } = {
    timestamp: new Date().toISOString(),
    mode: 'testnet',
    governed: args['governed'] ?? true,
    evm: null,
    solana: null,
  };

  if (!args['solana-only']) {
    console.log('\n📋 Deploying EVM Contracts to Base Sepolia\n');
    console.log('-'.repeat(60));

    if (args['dry-run']) {
      console.log('[DRY RUN] Would deploy to Base Sepolia');
    } else {
      deployments.evm = await deployToBaseSepolia();
    }
  }

  if (!args['evm-only']) {
    console.log('\n\n📋 Deploying Solana Programs to Devnet\n');
    console.log('-'.repeat(60));

    if (args['dry-run']) {
      console.log('[DRY RUN] Would deploy to Solana devnet');
    } else {
      deployments.solana = await deployToSolanaDevnet();
    }
  }

  // Save deployments
  const deploymentsPath = join(DEPLOYMENTS_DIR, `deployment-${Date.now()}.json`);
  writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));

  // Also save latest
  writeFileSync(
    join(DEPLOYMENTS_DIR, 'latest.json'),
    JSON.stringify(deployments, null, 2)
  );

  console.log(`\n📁 Deployments saved to: ${deploymentsPath}`);
  printSummary(deployments);
}

function validateEnvironment(): void {
  const required = ['DEPLOYER_PRIVATE_KEY'];
  const governed = args['governed'] ?? true;

  if (governed) {
    required.push('COUNCIL_ADDRESS', 'GUARDIAN_ADDRESS');
  }

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey?.startsWith('0x')) {
    console.error('DEPLOYER_PRIVATE_KEY must start with 0x');
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey as Hex);
  console.log(`Deployer: ${account.address}`);
  console.log(`Governed: ${governed}`);
  if (governed) {
    console.log(`Council: ${process.env.COUNCIL_ADDRESS}`);
    console.log(`Guardian: ${process.env.GUARDIAN_ADDRESS}`);
  }
  console.log('');
}

async function deployToBaseSepolia(): Promise<DeploymentResult> {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY as Hex;
  const account = privateKeyToAccount(privateKey);
  const governed = args['governed'] ?? true;
  const councilAddress = (process.env.COUNCIL_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address;
  const guardianAddress = (process.env.GUARDIAN_ADDRESS ?? account.address) as Address;

  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org';

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
    account,
  });

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance: ${(Number(balance) / 1e18).toFixed(4)} ETH\n`);

  if (balance < BigInt(1e16)) {
    console.warn('Warning: Low balance, deployment may fail\n');
  }

  const txHashes: Record<string, Hex> = {};

  // Load contract artifacts
  const verifierArtifact = JSON.parse(
    readFileSync(join(OUT_DIR, 'Groth16Verifier.sol', 'Groth16Verifier.json'), 'utf-8')
  );
  const lightClientArtifact = JSON.parse(
    readFileSync(join(OUT_DIR, 'SolanaLightClient.sol', 'SolanaLightClient.json'), 'utf-8')
  );
  const tokenArtifact = JSON.parse(
    readFileSync(join(OUT_DIR, 'CrossChainToken.sol', 'CrossChainToken.json'), 'utf-8')
  );

  // Deploy Groth16 Verifier
  console.log('1. Deploying Groth16 Verifier...');
  
  // Placeholder verification key values (replace with real ones from SP1)
  const alpha = [BigInt(0), BigInt(0)] as const;
  const beta = [BigInt(0), BigInt(0), BigInt(0), BigInt(0)] as const;
  const gamma = [BigInt(0), BigInt(0), BigInt(0), BigInt(0)] as const;
  const delta = [BigInt(0), BigInt(0), BigInt(0), BigInt(0)] as const;
  const ic: bigint[] = [];

  const verifierHash = await walletClient.deployContract({
    abi: verifierArtifact.abi,
    bytecode: verifierArtifact.bytecode.object as Hex,
    args: [alpha, beta, gamma, delta, ic],
  });
  txHashes.verifier = verifierHash;

  const verifierReceipt = await publicClient.waitForTransactionReceipt({
    hash: verifierHash,
  });
  const verifierAddress = verifierReceipt.contractAddress as Address;
  console.log(`   Address: ${verifierAddress}`);

  // Deploy Solana Light Client
  console.log('2. Deploying Solana Light Client...');
  const lightClientHash = await walletClient.deployContract({
    abi: lightClientArtifact.abi,
    bytecode: lightClientArtifact.bytecode.object as Hex,
    args: [verifierAddress],
  });
  txHashes.lightClient = lightClientHash;

  const lightClientReceipt = await publicClient.waitForTransactionReceipt({
    hash: lightClientHash,
  });
  const lightClientAddress = lightClientReceipt.contractAddress as Address;
  console.log(`   Address: ${lightClientAddress}`);

  // Deploy Bridge (governed or simple)
  let bridgeAddress: Address;
  if (governed) {
    console.log('3. Deploying Governed Bridge...');
    const bridgeArtifact = JSON.parse(
      readFileSync(join(OUT_DIR, 'GovernedBridge.sol', 'GovernedBridge.json'), 'utf-8')
    );

    const bridgeHash = await walletClient.deployContract({
      abi: bridgeArtifact.abi,
      bytecode: bridgeArtifact.bytecode.object as Hex,
      args: [
        lightClientAddress,
        verifierAddress,
        councilAddress,
        guardianAddress,
        BigInt(1e15), // 0.001 ETH base fee
        BigInt(1e11), // 0.0001 ETH per byte
      ],
    });
    txHashes.bridge = bridgeHash;

    const bridgeReceipt = await publicClient.waitForTransactionReceipt({
      hash: bridgeHash,
    });
    bridgeAddress = bridgeReceipt.contractAddress as Address;
  } else {
    console.log('3. Deploying CrossChain Bridge (admin mode)...');
    const bridgeArtifact = JSON.parse(
      readFileSync(join(OUT_DIR, 'CrossChainBridge.sol', 'CrossChainBridge.json'), 'utf-8')
    );

    const bridgeHash = await walletClient.deployContract({
      abi: bridgeArtifact.abi,
      bytecode: bridgeArtifact.bytecode.object as Hex,
      args: [
        lightClientAddress,
        verifierAddress,
        BigInt(1e15),
        BigInt(1e11),
      ],
    });
    txHashes.bridge = bridgeHash;

    const bridgeReceipt = await publicClient.waitForTransactionReceipt({
      hash: bridgeHash,
    });
    bridgeAddress = bridgeReceipt.contractAddress as Address;
  }
  console.log(`   Address: ${bridgeAddress}`);

  // Deploy Test Token
  console.log('4. Deploying Test Token (wSOL)...');
  const tokenHash = await walletClient.deployContract({
    abi: tokenArtifact.abi,
    bytecode: tokenArtifact.bytecode.object as Hex,
    args: [
      'Wrapped SOL',
      'wSOL',
      9, // SOL decimals
      BigInt(baseSepolia.id),
      BigInt(0),
      account.address,
    ],
  });
  txHashes.token = tokenHash;

  const tokenReceipt = await publicClient.waitForTransactionReceipt({
    hash: tokenHash,
  });
  const tokenAddress = tokenReceipt.contractAddress as Address;
  console.log(`   Address: ${tokenAddress}`);

  // Authorize bridge to mint
  console.log('5. Authorizing bridge...');
  const authHash = await walletClient.writeContract({
    address: tokenAddress,
    abi: parseAbi(['function setBridgeAuthorization(address bridge, bool authorized) external']),
    functionName: 'setBridgeAuthorization',
    args: [bridgeAddress, true],
  });
  txHashes.authorize = authHash;
  await publicClient.waitForTransactionReceipt({ hash: authHash });
  console.log('   Bridge authorized to mint/burn');

  console.log('\n✅ EVM deployment complete\n');

  return {
    verifier: verifierAddress,
    lightClient: lightClientAddress,
    bridge: bridgeAddress,
    token: tokenAddress,
    council: councilAddress,
    guardian: guardianAddress,
    deployer: account.address,
    chainId: baseSepolia.id,
    txHashes,
  };
}

async function deployToSolanaDevnet(): Promise<Record<string, string>> {
  const rpcUrl = process.env.SOLANA_DEVNET_RPC ?? 'https://api.devnet.solana.com';
  const keypairPath =
    process.env.SOLANA_KEYPAIR_PATH ??
    join(process.env.HOME ?? '~', '.config', 'solana', 'id.json');

  console.log(`RPC: ${rpcUrl}`);

  let payer: Keypair;
  try {
    const keypairData = JSON.parse(readFileSync(keypairPath, 'utf-8'));
    payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  } catch {
    console.log('Keypair not found, generating new one...');
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

  console.log(`Deployer: ${payer.publicKey.toBase58()}`);

  const connection = new Connection(rpcUrl, 'confirmed');
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${(balance / 1e9).toFixed(4)} SOL`);

  if (balance < 5e8) {
    console.log('Low balance, requesting airdrop...');
    try {
      const sig = await connection.requestAirdrop(payer.publicKey, 2e9);
      await connection.confirmTransaction(sig);
      console.log('Airdrop received');
    } catch {
      console.log('Airdrop failed - you may need to use a faucet');
    }
  }

  // Build and deploy with Anchor
  console.log('\nBuilding Solana programs...');
  const programsDir = join(process.cwd(), 'programs');

  try {
    execSync('anchor build', { cwd: programsDir, stdio: 'inherit' });
  } catch {
    console.log('Note: Anchor build requires placeholder keys - using development mode');
  }

  // Program IDs from Anchor.toml
  const evmLightClientId = 'EVMLightCL1111111111111111111111111111111111';
  const tokenBridgeId = 'TknBridge1111111111111111111111111111111111';

  console.log('\nProgram IDs:');
  console.log(`  EVM Light Client: ${evmLightClientId}`);
  console.log(`  Token Bridge: ${tokenBridgeId}`);

  console.log('\nNote: Deploy with:');
  console.log('  anchor deploy --provider.cluster devnet');

  return {
    deployer: payer.publicKey.toBase58(),
    evmLightClient: evmLightClientId,
    tokenBridge: tokenBridgeId,
    network: 'devnet',
    status: 'READY_TO_DEPLOY',
  };
}

function printSummary(deployments: {
  timestamp: string;
  mode: string;
  governed: boolean;
  evm: DeploymentResult | null;
  solana: Record<string, string> | null;
}): void {
  console.log('\n' + '='.repeat(60));
  console.log('\n✅ Testnet Deployment Summary\n');

  if (deployments.evm) {
    console.log('Base Sepolia:');
    console.log(`  Verifier:      ${deployments.evm.verifier}`);
    console.log(`  Light Client:  ${deployments.evm.lightClient}`);
    console.log(`  Bridge:        ${deployments.evm.bridge}`);
    console.log(`  Test Token:    ${deployments.evm.token}`);
    console.log(`  Council:       ${deployments.evm.council}`);
    console.log(`  Guardian:      ${deployments.evm.guardian}`);
    console.log(`  Governed:      ${deployments.governed}`);
  }

  if (deployments.solana) {
    console.log('\nSolana Devnet:');
    console.log(`  EVM Light Client: ${deployments.solana.evmLightClient}`);
    console.log(`  Token Bridge:     ${deployments.solana.tokenBridge}`);
    console.log(`  Status:           ${deployments.solana.status}`);
  }

  console.log('\nNext steps:');
  console.log('  1. If governed, create proposal in Autocrat Council');
  console.log('  2. Register tokens via governance proposal');
  console.log('  3. Start the relayer: bun run relayer');
  console.log('  4. Generate ZK keys: bun run build:circuits');
  console.log('  5. Test transfers\n');
}

main().catch((error) => {
  console.error('\nDeployment failed:', error);
  process.exit(1);
});
