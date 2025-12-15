#!/usr/bin/env bun
/**
 * Deploy experimental token contracts to testnet
 * 
 * This script integrates with Jeju's deployment infrastructure:
 * - Uses DEPLOYER_PRIVATE_KEY from Jeju's env
 * - Deploys to Sepolia as home chain
 * - Configures cross-chain warp routes
 * 
 * Usage:
 *   cd vendor/babylon/packages/experimental-token
 *   bun run scripts/deploy-testnet.ts
 * 
 * Or from Jeju root:
 *   bun run vendor/babylon/packages/experimental-token/scripts/deploy-testnet.ts
 */

import { createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia, baseSepolia, arbitrumSepolia } from 'viem/chains';
import { MultiChainLauncher } from '../src/deployer/multi-chain-launcher';
import { preloadAllArtifacts } from '../src/deployer/contract-deployer';
import { TESTNET_CHAINS } from '../src/config/chains';
import type { DeploymentConfig } from '../src/types';

// Load environment
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY as Hex;
const VALIDATOR_ADDRESSES = process.env.VALIDATOR_ADDRESSES?.split(',') || [];
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║     Cross-Chain Token Deployment (Testnet)                   ║
║     Sepolia → Base Sepolia → Arbitrum Sepolia                ║
╚══════════════════════════════════════════════════════════════╝
`);

  // Validate environment
  if (!DEPLOYER_PRIVATE_KEY && !DRY_RUN) {
    console.error('❌ DEPLOYER_PRIVATE_KEY not set');
    console.error('   Set it in .env or run with --dry-run');
    process.exit(1);
  }

  if (VALIDATOR_ADDRESSES.length === 0 && !DRY_RUN) {
    console.error('❌ VALIDATOR_ADDRESSES not set');
    console.error('   Required for Hyperlane ISM configuration');
    process.exit(1);
  }

  // Create account
  const account = DEPLOYER_PRIVATE_KEY
    ? privateKeyToAccount(DEPLOYER_PRIVATE_KEY)
    : privateKeyToAccount(
        '0x0000000000000000000000000000000000000000000000000000000000000001'
      );

  console.log(`Deployer: ${account.address}`);
  console.log(`Validators: ${VALIDATOR_ADDRESSES.length}`);
  console.log(`Dry Run: ${DRY_RUN}`);
  console.log();

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE');
    console.log();
    console.log('Would deploy to:');
    console.log('  • Sepolia (11155111) - Home chain');
    console.log('  • Base Sepolia (84532)');
    console.log('  • Arbitrum Sepolia (421614)');
    console.log();
    console.log('Contracts to deploy:');
    console.log('  • BabylonToken');
    console.log('  • TokenVesting');
    console.log('  • FeeDistributor');
    console.log('  • WarpRoute');
    console.log('  • Presale (optional)');
    console.log('  • CCALauncher (optional)');
    console.log();
    console.log('To deploy, run without --dry-run:');
    console.log(
      '  DEPLOYER_PRIVATE_KEY=0x... VALIDATOR_ADDRESSES=0x...,0x... bun run scripts/deploy-testnet.ts'
    );
    return;
  }

  // Preload artifacts
  console.log('Loading contract artifacts...');
  await preloadAllArtifacts();
  console.log('✓ Artifacts loaded');

  // Create wallet clients
  const chains = [
    { chain: sepolia, chainId: 11155111, isHome: true },
    { chain: baseSepolia, chainId: 84532, isHome: false },
    { chain: arbitrumSepolia, chainId: 421614, isHome: false },
  ];

  const walletClients = new Map();
  for (const { chain, chainId } of chains) {
    const client = createWalletClient({
      account,
      chain,
      transport: http(),
    });
    walletClients.set(chainId, client);
  }

  // Build deployment config
  const config: DeploymentConfig = {
    token: {
      name: 'Test Token',
      symbol: 'TEST',
      decimals: 18,
      totalSupply: BigInt('1000000000000000000000000000'), // 1B tokens
      allocation: {
        publicSale: 30,
        presale: 10,
        team: 15,
        advisors: 5,
        ecosystem: 25,
        liquidity: 10,
        stakingRewards: 5,
      },
      fees: {
        transferFeeBps: 100, // 1%
        distribution: {
          holders: 40,
          creators: 20,
          treasury: 20,
          lps: 10,
          burn: 10,
        },
      },
      maxWalletPercent: 5,
      maxTxPercent: 1,
    },
    owner: account.address,
    chains: TESTNET_CHAINS.filter(
      (c) => c.chainType === 'evm' && c.chainId !== 420690
    ),
    deploymentSalt: `0x${'0'.repeat(64)}` as Hex,
    presale: {
      enabled: false,
      priceUsd: 0.01,
      softCapUsd: 10000,
      hardCapUsd: 100000,
      startTime: 0,
      endTime: 0,
    },
    cca: {
      enabled: false,
      startPrice: BigInt(0),
      reservePrice: BigInt(0),
      duration: 0,
    },
    liquidity: {
      allocations: [],
    },
    hyperlane: {
      validators: VALIDATOR_ADDRESSES,
      routes: [],
    },
  };

  // Deploy
  const launcher = new MultiChainLauncher(config, (progress) => {
    console.log(
      `[${progress.completedSteps}/${progress.totalSteps}] ${progress.currentStep?.name}: ${progress.currentStep?.status}`
    );
  });

  console.log();
  console.log('Starting deployment...');
  console.log();

  const result = await launcher.deploy(walletClients);

  console.log();
  console.log(
    '═══════════════════════════════════════════════════════════════'
  );
  console.log('DEPLOYMENT COMPLETE');
  console.log(
    '═══════════════════════════════════════════════════════════════'
  );
  console.log();

  for (const deployment of result.deployments) {
    console.log(`Chain ${deployment.chainId}:`);
    console.log(`  Token: ${deployment.token}`);
    console.log(`  WarpRoute: ${deployment.warpRoute}`);
    console.log();
  }

  // Save deployment
  const outputPath = `./deployments/testnet-${Date.now()}.json`;
  await Bun.write(
    outputPath,
    JSON.stringify(
      result,
      (_, v) => (typeof v === 'bigint' ? v.toString() : v),
      2
    )
  );
  console.log(`Saved to: ${outputPath}`);
}

main().catch((err) => {
  console.error('❌ Deployment failed:', err);
  process.exit(1);
});
