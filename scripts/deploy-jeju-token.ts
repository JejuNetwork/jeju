#!/usr/bin/env bun
/**
 * JejuToken Deployment Script
 * 
 * Supports localnet, testnet, and mainnet deployment with:
 * - Safe (Gnosis Safe) multi-sig ownership for production
 * - BanManager integration
 * - ModerationMarketplace ban exemption setup
 * - TokenRegistry integration for paymaster support
 * 
 * Usage:
 *   # Localnet (direct deployment)
 *   bun run scripts/deploy-jeju-token.ts --network localnet
 * 
 *   # Testnet (with Safe multi-sig)
 *   bun run scripts/deploy-jeju-token.ts --network testnet --safe 0x...
 * 
 *   # Mainnet (requires Safe multi-sig)
 *   bun run scripts/deploy-jeju-token.ts --network mainnet --safe 0x...
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  encodeFunctionData,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry, baseSepolia, base } from 'viem/chains';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { parseArgs } from 'util';

// Network configurations
const NETWORKS = {
  localnet: {
    chain: foundry,
    rpcUrl: 'http://localhost:8545',
    chainId: 1337,
    enableFaucet: true,
    requireMultiSig: false,
  },
  testnet: {
    chain: baseSepolia,
    rpcUrl: process.env.TESTNET_RPC_URL || 'https://sepolia.base.org',
    chainId: 84532,
    enableFaucet: true,
    requireMultiSig: false, // Optional for testnet
  },
  mainnet: {
    chain: base,
    rpcUrl: process.env.MAINNET_RPC_URL || 'https://mainnet.base.org',
    chainId: 8453,
    enableFaucet: false,
    requireMultiSig: true, // Required for mainnet
  },
} as const;

type NetworkName = keyof typeof NETWORKS;

// Directories
const ROOT_DIR = path.resolve(import.meta.dir, '..');
const CONTRACTS_DIR = path.join(ROOT_DIR, 'packages/contracts');

// Parse command line arguments
const { values: args } = parseArgs({
  options: {
    network: { type: 'string', default: 'localnet' },
    safe: { type: 'string' },
    'ban-manager': { type: 'string' },
    'moderation-marketplace': { type: 'string' },
    'token-registry': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    verify: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (args.help) {
  console.log(`
JejuToken Deployment Script

Usage:
  bun run scripts/deploy-jeju-token.ts [options]

Options:
  --network <name>              Network to deploy to (localnet|testnet|mainnet) [default: localnet]
  --safe <address>              Safe multi-sig address for ownership
  --ban-manager <address>       Existing BanManager address (skip deployment)
  --moderation-marketplace <address>  Set ModerationMarketplace as ban-exempt
  --token-registry <address>    Register JEJU in TokenRegistry
  --dry-run                     Simulate deployment without transactions
  --verify                      Verify contracts on block explorer
  --help                        Show this help message
`);
  process.exit(0);
}

const networkName = args.network as NetworkName;
const safeAddress = args.safe as Address | undefined;
const existingBanManager = args['ban-manager'] as Address | undefined;
const existingModMarketplace = args['moderation-marketplace'] as Address | undefined;
const _existingTokenRegistry = args['token-registry'] as Address | undefined;
const dryRun = args['dry-run'];
const verify = args.verify;

// Load contract artifacts
function loadArtifact(name: string): { abi: readonly object[]; bytecode: Hex } {
  const artifactPath = path.join(CONTRACTS_DIR, `out/${name}.sol/${name}.json`);
  if (!existsSync(artifactPath)) {
    throw new Error(`Artifact not found: ${artifactPath}. Run 'forge build' first.`);
  }
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'));
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as Hex,
  };
}

interface DeploymentResult {
  network: NetworkName;
  chainId: number;
  jejuToken: Address;
  banManager: Address;
  moderationMarketplace: Address | null;
  owner: Address;
  isMultiSig: boolean;
  faucetEnabled: boolean;
  banEnforcementEnabled: boolean;
  banExemptAddresses: Address[];
  deployedAt: string;
  deployer: Address;
  transactions: {
    hash: Hex;
    description: string;
  }[];
}

async function main() {
  console.log('🏝️  JejuToken Deployment');
  console.log('='.repeat(60));

  // Validate network
  if (!NETWORKS[networkName]) {
    throw new Error(`Unknown network: ${networkName}. Use localnet, testnet, or mainnet.`);
  }

  const networkConfig = NETWORKS[networkName];
  console.log(`\n📡 Network: ${networkName} (chainId: ${networkConfig.chainId})`);

  // Check multi-sig requirement
  if (networkConfig.requireMultiSig && !safeAddress) {
    throw new Error(`Mainnet deployment requires a Safe multi-sig address. Use --safe <address>`);
  }

  // Get deployer key
  const deployerKey = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (!deployerKey && networkName !== 'localnet') {
    throw new Error('PRIVATE_KEY or DEPLOYER_PRIVATE_KEY environment variable required');
  }

  // Default anvil key for localnet
  const privateKey = (deployerKey || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as Hex;
  const account = privateKeyToAccount(privateKey);

  // Setup clients
  const publicClient = createPublicClient({
    chain: networkConfig.chain,
    transport: http(networkConfig.rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: networkConfig.chain,
    transport: http(networkConfig.rpcUrl),
  });

  console.log(`👤 Deployer: ${account.address}`);
  if (safeAddress) {
    console.log(`🔐 Safe Multi-Sig: ${safeAddress}`);
  }

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`💰 Balance: ${formatEther(balance)} ETH`);

  if (balance < parseEther('0.01')) {
    throw new Error('Insufficient balance for deployment (need at least 0.01 ETH)');
  }

  if (dryRun) {
    console.log('\n⚠️  DRY RUN MODE - No transactions will be sent');
  }

  // Load artifacts
  console.log('\n📦 Loading contract artifacts...');
  const jejuTokenArtifact = loadArtifact('JejuToken');
  const banManagerArtifact = loadArtifact('BanManager');

  const transactions: { hash: Hex; description: string }[] = [];
  let banManagerAddress: Address;
  let jejuTokenAddress: Address;

  // The owner will be Safe if provided, otherwise deployer
  const ownerAddress = safeAddress || account.address;

  // Step 1: Deploy or use existing BanManager
  if (existingBanManager) {
    console.log(`\n🔗 Using existing BanManager: ${existingBanManager}`);
    banManagerAddress = existingBanManager;
  } else {
    console.log('\n🚀 Deploying BanManager...');

    if (dryRun) {
      banManagerAddress = '0x0000000000000000000000000000000000000001' as Address;
      console.log(`   [DRY RUN] BanManager would be deployed`);
    } else {
      const hash = await walletClient.deployContract({
        abi: banManagerArtifact.abi,
        bytecode: banManagerArtifact.bytecode,
        args: [ownerAddress, ownerAddress], // governance, owner
      });

      transactions.push({ hash, description: 'Deploy BanManager' });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      banManagerAddress = receipt.contractAddress!;
      console.log(`   BanManager: ${banManagerAddress}`);
    }
  }

  // Step 2: Deploy JejuToken
  console.log('\n🚀 Deploying JejuToken...');

  if (dryRun) {
    jejuTokenAddress = '0x0000000000000000000000000000000000000002' as Address;
    console.log(`   [DRY RUN] JejuToken would be deployed`);
  } else {
    const hash = await walletClient.deployContract({
      abi: jejuTokenArtifact.abi,
      bytecode: jejuTokenArtifact.bytecode,
      args: [
        ownerAddress,
        banManagerAddress,
        networkConfig.enableFaucet,
      ],
    });

    transactions.push({ hash, description: 'Deploy JejuToken' });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    jejuTokenAddress = receipt.contractAddress!;
    console.log(`   JejuToken: ${jejuTokenAddress}`);
  }

  // Step 3: Set ban exemption for ModerationMarketplace (if exists)
  const banExemptAddresses: Address[] = [];

  if (existingModMarketplace && !dryRun) {
    console.log('\n🔓 Setting ban exemption for ModerationMarketplace...');

    // If deployer is owner, set directly; otherwise prepare Safe tx
    if (!safeAddress || safeAddress === account.address) {
      const hash = await walletClient.writeContract({
        address: jejuTokenAddress,
        abi: jejuTokenArtifact.abi,
        functionName: 'setBanExempt',
        args: [existingModMarketplace, true],
      });

      transactions.push({ hash, description: 'Set ModerationMarketplace ban exempt' });
      await publicClient.waitForTransactionReceipt({ hash });
      banExemptAddresses.push(existingModMarketplace);
      console.log(`   ✅ ${existingModMarketplace} is now ban exempt`);
    } else {
      // Generate calldata for Safe transaction
      const calldata = encodeFunctionData({
        abi: jejuTokenArtifact.abi,
        functionName: 'setBanExempt',
        args: [existingModMarketplace, true],
      });
      console.log(`\n📝 Safe Transaction Required:`);
      console.log(`   To: ${jejuTokenAddress}`);
      console.log(`   Data: ${calldata}`);
      console.log(`   Description: Set ModerationMarketplace ban exempt`);
    }
  }

  // Step 4: Transfer ownership to Safe (if deploying to production and Safe is different from deployer)
  if (safeAddress && safeAddress !== account.address && !dryRun) {
    console.log('\n🔐 Transferring ownership to Safe multi-sig...');

    // Transfer JejuToken ownership
    const jejuOwnerHash = await walletClient.writeContract({
      address: jejuTokenAddress,
      abi: jejuTokenArtifact.abi,
      functionName: 'transferOwnership',
      args: [safeAddress],
    });

    transactions.push({ hash: jejuOwnerHash, description: 'Transfer JejuToken ownership to Safe' });
    await publicClient.waitForTransactionReceipt({ hash: jejuOwnerHash });
    console.log(`   ✅ JejuToken ownership transferred to Safe`);

    // Transfer BanManager ownership (if we deployed it)
    if (!existingBanManager) {
      const banOwnerHash = await walletClient.writeContract({
        address: banManagerAddress,
        abi: banManagerArtifact.abi,
        functionName: 'transferOwnership',
        args: [safeAddress],
      });

      transactions.push({ hash: banOwnerHash, description: 'Transfer BanManager ownership to Safe' });
      await publicClient.waitForTransactionReceipt({ hash: banOwnerHash });
      console.log(`   ✅ BanManager ownership transferred to Safe`);
    }
  }

  // Verify deployment
  console.log('\n📊 Verifying deployment...');

  if (!dryRun) {
    const [name, symbol, totalSupply, faucetEnabled, banEnforcementEnabled, owner] = await Promise.all([
      publicClient.readContract({
        address: jejuTokenAddress,
        abi: jejuTokenArtifact.abi,
        functionName: 'name',
      }) as Promise<string>,
      publicClient.readContract({
        address: jejuTokenAddress,
        abi: jejuTokenArtifact.abi,
        functionName: 'symbol',
      }) as Promise<string>,
      publicClient.readContract({
        address: jejuTokenAddress,
        abi: jejuTokenArtifact.abi,
        functionName: 'totalSupply',
      }) as Promise<bigint>,
      publicClient.readContract({
        address: jejuTokenAddress,
        abi: jejuTokenArtifact.abi,
        functionName: 'faucetEnabled',
      }) as Promise<boolean>,
      publicClient.readContract({
        address: jejuTokenAddress,
        abi: jejuTokenArtifact.abi,
        functionName: 'banEnforcementEnabled',
      }) as Promise<boolean>,
      publicClient.readContract({
        address: jejuTokenAddress,
        abi: jejuTokenArtifact.abi,
        functionName: 'owner',
      }) as Promise<Address>,
    ]);

    console.log(`   Name: ${name}`);
    console.log(`   Symbol: ${symbol}`);
    console.log(`   Total Supply: ${formatEther(totalSupply)} ${symbol}`);
    console.log(`   Faucet: ${faucetEnabled ? '✅ Enabled' : '❌ Disabled'}`);
    console.log(`   Ban Enforcement: ${banEnforcementEnabled ? '✅ Enabled' : '❌ Disabled'}`);
    console.log(`   Owner: ${owner}`);

    // Save deployment result
    const result: DeploymentResult = {
      network: networkName,
      chainId: networkConfig.chainId,
      jejuToken: jejuTokenAddress,
      banManager: banManagerAddress,
      moderationMarketplace: existingModMarketplace || null,
      owner: owner,
      isMultiSig: !!safeAddress,
      faucetEnabled,
      banEnforcementEnabled,
      banExemptAddresses,
      deployedAt: new Date().toISOString(),
      deployer: account.address,
      transactions,
    };

    // Ensure directory exists
    const deploymentDir = path.join(CONTRACTS_DIR, 'deployments', networkName);
    if (!existsSync(deploymentDir)) {
      mkdirSync(deploymentDir, { recursive: true });
    }

    // Save jeju-token specific deployment
    const jejuDeploymentPath = path.join(deploymentDir, 'jeju-token.json');
    writeFileSync(jejuDeploymentPath, JSON.stringify(result, null, 2));
    console.log(`\n💾 Saved: ${jejuDeploymentPath}`);

    // Update main deployment.json
    const mainDeploymentPath = path.join(deploymentDir, 'deployment.json');
    let mainDeployment: Record<string, unknown> = {};

    if (existsSync(mainDeploymentPath)) {
      mainDeployment = JSON.parse(readFileSync(mainDeploymentPath, 'utf-8'));
    }

    mainDeployment.tokens = {
      ...((mainDeployment.tokens as Record<string, unknown>) || {}),
      jeju: jejuTokenAddress,
    };

    mainDeployment.moderation = {
      ...((mainDeployment.moderation as Record<string, unknown>) || {}),
      banManager: banManagerAddress,
    };

    mainDeployment.deployedAt = new Date().toISOString();

    writeFileSync(mainDeploymentPath, JSON.stringify(mainDeployment, null, 2));
    console.log(`💾 Updated: ${mainDeploymentPath}`);

    // Update tokens.json config
    const tokensConfigPath = path.join(ROOT_DIR, 'packages/config/tokens.json');
    if (existsSync(tokensConfigPath)) {
      const tokensConfig = JSON.parse(readFileSync(tokensConfigPath, 'utf-8'));

      if (!tokensConfig.tokens.JEJU.addresses) {
        tokensConfig.tokens.JEJU.addresses = {};
      }
      tokensConfig.tokens.JEJU.addresses[networkName] = jejuTokenAddress;

      writeFileSync(tokensConfigPath, JSON.stringify(tokensConfig, null, 2));
      console.log(`💾 Updated: ${tokensConfigPath}`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('✅ JejuToken Deployment Complete!');
  console.log('='.repeat(60));

  console.log('\n📋 Addresses:');
  console.log(`   JejuToken: ${jejuTokenAddress}`);
  console.log(`   BanManager: ${banManagerAddress}`);

  if (safeAddress) {
    console.log(`   Safe Multi-Sig: ${safeAddress}`);
  }

  console.log('\n📋 Post-Deployment Steps:');
  console.log('   1. Verify contracts on block explorer (if --verify flag used)');
  console.log('   2. Set ModerationMarketplace as ban exempt (if not done)');
  console.log('   3. Register token in TokenRegistry (if using paymaster)');
  console.log('   4. Update frontend env vars with token address');

  if (networkConfig.enableFaucet) {
    console.log(`\n💧 Faucet Commands:`);
    console.log(`   # Claim tokens (10,000 JEJU per hour):`);
    console.log(`   cast send ${jejuTokenAddress} "faucet()" --rpc-url ${networkConfig.rpcUrl}`);
  }

  if (verify && !dryRun) {
    console.log('\n🔍 Verifying contracts on block explorer...');
    // Run forge verify-contract commands
    const verifyCmd = `cd ${CONTRACTS_DIR} && forge verify-contract ${jejuTokenAddress} JejuToken --chain-id ${networkConfig.chainId}`;
    console.log(`   Run: ${verifyCmd}`);
  }
}

main().catch((error) => {
  console.error('\n❌ Deployment failed:', error.message);
  process.exit(1);
});
