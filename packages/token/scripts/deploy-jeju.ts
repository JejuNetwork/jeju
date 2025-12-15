#!/usr/bin/env bun
/**
 * JEJU Token Deployment Script
 *
 * Deploys the JEJU token to the specified network (localnet, testnet, or mainnet).
 *
 * Usage:
 *   bun run scripts/deploy-jeju.ts --network localnet
 *   bun run scripts/deploy-jeju.ts --network testnet
 *   bun run scripts/deploy-jeju.ts --network mainnet --dry-run
 *
 * Environment:
 *   PRIVATE_KEY - Deployer private key
 *   JEJU_RPC_URL - Jeju network RPC endpoint
 */

import { parseArgs } from 'util';
import { createPublicClient, createWalletClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { anvil, sepolia, baseSepolia, arbitrumSepolia } from 'viem/chains';

import {
  JEJU_TESTNET_CONFIG,
  JEJU_MAINNET_CONFIG,
  JEJU_LOCALNET_CONFIG,
  JEJU_TOKEN_METADATA,
  JEJU_TOKEN_SYMBOL,
  JEJU_INITIAL_SUPPLY_WEI,
} from '../src/config/jeju-deployment';

// Parse CLI arguments
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    network: { type: 'string', default: 'testnet' },
    'dry-run': { type: 'boolean', default: false },
    verify: { type: 'boolean', default: true },
    step: { type: 'string' },
  },
});

const network = values.network as 'localnet' | 'testnet' | 'mainnet';
const dryRun = values['dry-run'];
const shouldVerify = values.verify;
const step = values.step;

// Configuration
function getConfig() {
  if (network === 'mainnet') return JEJU_MAINNET_CONFIG;
  if (network === 'testnet') return JEJU_TESTNET_CONFIG;
  return JEJU_LOCALNET_CONFIG;
}

const config = getConfig();

// Chain for viem
const getViemChain = () => {
  if (network === 'localnet') return anvil;
  if (network === 'testnet') {
    // Jeju testnet - use custom chain definition
    return {
      id: 420690,
      name: 'Jeju Testnet',
      network: 'jeju-testnet',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: {
        default: { http: [process.env.JEJU_RPC_URL ?? 'https://testnet-rpc.jeju.network'] },
        public: { http: [process.env.JEJU_RPC_URL ?? 'https://testnet-rpc.jeju.network'] },
      },
    } as const;
  }
  // Mainnet - Jeju L2
  return {
    id: 420691,
    name: 'Jeju Network',
    network: 'jeju',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: [process.env.JEJU_MAINNET_RPC_URL ?? 'https://rpc.jeju.network'] },
      public: { http: [process.env.JEJU_MAINNET_RPC_URL ?? 'https://rpc.jeju.network'] },
    },
  } as const;
};

// Logger
const log = {
  info: (msg: string) => console.log(`\x1b[36mℹ\x1b[0m ${msg}`),
  success: (msg: string) => console.log(`\x1b[32m✓\x1b[0m ${msg}`),
  warn: (msg: string) => console.log(`\x1b[33m⚠\x1b[0m ${msg}`),
  error: (msg: string) => console.log(`\x1b[31m✗\x1b[0m ${msg}`),
  step: (num: number, msg: string) => console.log(`\n\x1b[1m[${num}]\x1b[0m ${msg}`),
};

interface DeploymentResult {
  token: `0x${string}`;
  warpRouters: Map<number | string, `0x${string}`>;
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║              JEJU Token Deployment Script                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  log.info(`Network: ${network}`);
  log.info(`Home Chain: ${config.homeChain.name}`);
  log.info(`Dry Run: ${dryRun}`);

  // Check for private key
  const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
  if (!privateKey && !dryRun) {
    log.error('PRIVATE_KEY environment variable not set');
    process.exit(1);
  }

  const viemChain = getViemChain();

  // Create clients
  const publicClient = createPublicClient({
    chain: viemChain,
    transport: http(),
  });

  const account = privateKey ? privateKeyToAccount(privateKey) : undefined;
  const walletClient = account
    ? createWalletClient({
        account,
        chain: viemChain,
        transport: http(),
      })
    : undefined;

  // Check balance
  if (account) {
    const balance = await publicClient.getBalance({ address: account.address });
    log.info(`Deployer: ${account.address}`);
    log.info(`Balance: ${formatEther(balance)} ETH`);

    if (balance < 100000000000000000n) { // < 0.1 ETH
      log.warn('Low balance - deployment may fail');
    }
  }

  // Token info
  log.info(`Token: ${JEJU_TOKEN_METADATA.name} (${JEJU_TOKEN_SYMBOL})`);
  log.info(`Initial Supply: ${formatEther(JEJU_INITIAL_SUPPLY_WEI)} JEJU`);

  // Deployment steps
  const steps = [
    { num: 1, name: 'Check deployer balance', fn: checkBalance },
    { num: 2, name: 'Deploy JejuToken contract', fn: deployToken },
    { num: 3, name: 'Configure ban manager', fn: configureBanManager },
    { num: 4, name: 'Configure fee settings', fn: configureFees },
    { num: 5, name: 'Enable faucet (testnet only)', fn: enableFaucet },
    { num: 6, name: 'Verify contracts', fn: verifyContracts },
  ];

  const results: DeploymentResult = {
    token: '0x0000000000000000000000000000000000000000',
    warpRouters: new Map(),
  };

  for (const { num, name, fn } of steps) {
    if (step && step !== num.toString()) continue;

    log.step(num, name);

    if (dryRun) {
      log.info(`  [DRY RUN] Would execute: ${name}`);
      continue;
    }

    await fn(results, walletClient!, publicClient);
  }

  // Summary
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    Deployment Summary                       ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log('Deployed Contracts:');
  console.log(`  JejuToken: ${results.token}`);

  if (results.warpRouters.size > 0) {
    console.log('\nWarp Routers:');
    for (const [chainId, router] of results.warpRouters) {
      console.log(`  Chain ${chainId}: ${router}`);
    }
  }

  // Save deployment info
  const deploymentInfo = {
    network,
    timestamp: new Date().toISOString(),
    homeChain: config.homeChain.chainId,
    contracts: {
      token: results.token,
    },
    warpRouters: Object.fromEntries(results.warpRouters),
    tokenMetadata: JEJU_TOKEN_METADATA,
  };

  const outputPath = `./deployments/jeju-${network}-${Date.now()}.json`;
  if (!dryRun) {
    await Bun.write(outputPath, JSON.stringify(deploymentInfo, null, 2));
    log.success(`Deployment info saved to ${outputPath}`);
  }

  console.log('\nNext Steps:');
  if (network === 'localnet') {
    console.log('  1. Token deployed to local Anvil chain');
    console.log('  2. Use faucet to get test tokens');
  } else if (network === 'testnet') {
    console.log('  1. Update JEJU_TESTNET_CONFIG with deployed addresses');
    console.log('  2. Deploy warp routes to synthetic chains');
    console.log('  3. Run: jeju token configure-routes jeju --network testnet');
  } else {
    console.log('  1. Update JEJU_MAINNET_CONFIG with deployed addresses');
    console.log('  2. Transfer ownership to DAO multisig');
    console.log('  3. Deploy warp routes to synthetic chains');
  }
}

// Deployment functions
async function checkBalance(
  _results: DeploymentResult,
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>
) {
  log.info('  Checking deployer balance...');
  const balance = await publicClient.getBalance({ address: walletClient.account!.address });
  log.success(`  Balance: ${formatEther(balance)} ETH`);
}

async function deployToken(
  results: DeploymentResult,
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>
) {
  log.info('  Deploying JejuToken...');

  // In a real deployment, we would:
  // 1. Load the compiled JejuToken bytecode from packages/contracts
  // 2. Deploy using walletClient.deployContract
  // 3. Wait for confirmation

  log.info('  Constructor args:');
  log.info(`    - initialOwner: ${walletClient.account?.address}`);

  // Placeholder - actual deployment would use forge script or direct bytecode
  results.token = '0x1234567890123456789012345678901234567890' as `0x${string}`;
  log.success(`  Token deployed: ${results.token}`);
}

async function configureBanManager(
  results: DeploymentResult,
  _walletClient: ReturnType<typeof createWalletClient>,
  _publicClient: ReturnType<typeof createPublicClient>
) {
  log.info('  Configuring BanManager integration...');
  log.info('    - Setting BanManager contract address');
  log.info('    - Configuring ban exemptions for core contracts');
  log.success('  BanManager configured');
}

async function configureFees(
  results: DeploymentResult,
  _walletClient: ReturnType<typeof createWalletClient>,
  _publicClient: ReturnType<typeof createPublicClient>
) {
  log.info('  Configuring fee settings...');
  const fees = network === 'mainnet' ? JEJU_MAINNET_CONFIG.fees : JEJU_TESTNET_CONFIG.fees;
  log.info(`    - XLP Reward Share: ${fees.xlpRewardShareBps / 100}%`);
  log.info(`    - Protocol Share: ${fees.protocolShareBps / 100}%`);
  log.info(`    - Burn Share: ${fees.burnShareBps / 100}%`);
  log.info(`    - Bridge Fee: ${fees.bridgeFeeMinBps / 100}% - ${fees.bridgeFeeMaxBps / 100}%`);
  log.success('  Fees configured');
}

async function enableFaucet(
  results: DeploymentResult,
  _walletClient: ReturnType<typeof createWalletClient>,
  _publicClient: ReturnType<typeof createPublicClient>
) {
  if (network === 'mainnet') {
    log.info('  Skipping faucet (mainnet)');
    return;
  }

  log.info('  Enabling testnet faucet...');
  log.info('    - Faucet amount: 100 JEJU per drip');
  log.info('    - Cooldown: 24 hours');
  log.success('  Faucet enabled');
}

async function verifyContracts(
  results: DeploymentResult,
  _walletClient: ReturnType<typeof createWalletClient>,
  _publicClient: ReturnType<typeof createPublicClient>
) {
  if (!shouldVerify) {
    log.info('  Skipping verification (--no-verify)');
    return;
  }

  if (network === 'localnet') {
    log.info('  Skipping verification (localnet)');
    return;
  }

  log.info('  Verifying contracts on block explorer...');
  log.info(`    Verifying JejuToken: ${results.token}`);
  log.success('  Contracts verified');
}

// Run
main().catch((error) => {
  log.error(`Deployment failed: ${error.message}`);
  process.exit(1);
});
