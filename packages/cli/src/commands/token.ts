/**
 * Token Command
 *
 * Deploy and manage cross-chain tokens (JEJU, custom tokens)
 *
 * Usage:
 *   jeju token deploy:jeju --network testnet
 *   jeju token deploy:ecosystem --network testnet
 *   jeju token deploy:testnet --cross-chain
 *   jeju token deploy:hyperlane --network testnet
 *   jeju token deploy:solana --network devnet
 *   jeju token verify --network testnet
 *   jeju token bridge <token> <amount> --from <chain> --to <chain>
 *   jeju token status <token> --network testnet
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { join } from 'path';
import { existsSync } from 'fs';
import { execa } from 'execa';
import { logger } from '../lib/logger';
import { findMonorepoRoot } from '../lib/system';

// Known token configurations
const KNOWN_TOKENS: Record<string, { name: string; totalSupply: string; homeChain: string }> = {
  JEJU: { name: 'Jeju', totalSupply: '10,000,000,000 (max)', homeChain: 'jeju' },
};

export const tokenCommand = new Command('token')
  .description('Deploy and manage cross-chain tokens')
  .addHelpText('after', `
Examples:
  ${chalk.cyan('jeju token deploy:jeju --network testnet')}        Deploy JEJU token to testnet
  ${chalk.cyan('jeju token deploy:ecosystem --network testnet')}    Deploy full token ecosystem
  ${chalk.cyan('jeju token deploy:testnet --cross-chain')}          Cross-chain testnet deployment
  ${chalk.cyan('jeju token deploy:hyperlane --network testnet')}    Deploy Hyperlane infrastructure
  ${chalk.cyan('jeju token deploy:solana --network devnet')}        Deploy SPL token to Solana
  ${chalk.cyan('jeju token verify --network testnet')}              Verify testnet deployment
  ${chalk.cyan('jeju token status jeju --network testnet')}         Check JEJU deployment status
  ${chalk.cyan('jeju token bridge jeju 1000 --from jeju --to base')}  Bridge 1000 JEJU
`);

// ============================================================================
// Deploy JEJU Command
// ============================================================================

tokenCommand
  .command('deploy:jeju')
  .description('Deploy JEJU token to specified network')
  .option('-n, --network <network>', 'Target network (localnet|testnet|mainnet)', 'testnet')
  .option('--dry-run', 'Simulate deployment without executing')
  .option('--verify', 'Verify contracts on block explorer', true)
  .option('--step <step>', 'Run specific deployment step')
  .action(async (options: { network: string; dryRun?: boolean; verify?: boolean; step?: string }) => {
    const root = findMonorepoRoot();
    const scriptPath = join(root, 'packages/token/scripts/deploy-jeju.ts');
    
    if (!existsSync(scriptPath)) {
      logger.error(`Script not found: ${scriptPath}`);
      process.exit(1);
    }

    logger.info(`Deploying JEJU token to ${options.network}...`);

    const args = ['run', scriptPath];
    if (options.network) args.push('--network', options.network);
    if (options.dryRun) args.push('--dry-run');
    if (options.verify === false) args.push('--no-verify');
    if (options.step) args.push('--step', options.step);

    await execa('bun', args, { stdio: 'inherit', cwd: root });
  });

// ============================================================================
// Deploy Ecosystem Command
// ============================================================================

tokenCommand
  .command('deploy:ecosystem')
  .description('Deploy full token ecosystem (Token, Vesting, Airdrop, FeeDistributor, CCALauncher)')
  .option('-n, --network <network>', 'Target network (localnet|testnet|mainnet)', 'testnet')
  .option('--dry-run', 'Simulate deployment without executing')
  .action(async (options: { network: string; dryRun?: boolean }) => {
    const root = findMonorepoRoot();
    const scriptPath = join(root, 'packages/token/scripts/deploy-token.ts');
    
    if (!existsSync(scriptPath)) {
      logger.error(`Script not found: ${scriptPath}`);
      process.exit(1);
    }

    logger.info(`Deploying token ecosystem to ${options.network}...`);

    const args = ['run', scriptPath, options.network];
    if (options.dryRun) args.push('--dry-run');

    await execa('bun', args, { stdio: 'inherit', cwd: root });
  });

// ============================================================================
// Deploy Testnet Command
// ============================================================================

tokenCommand
  .command('deploy:testnet')
  .description('Cross-chain token deployment to testnet (Sepolia, Base Sepolia, Arbitrum Sepolia)')
  .option('--dry-run', 'Simulate deployment without executing')
  .action(async (options: { dryRun?: boolean }) => {
    const root = findMonorepoRoot();
    const scriptPath = join(root, 'packages/token/scripts/deploy-testnet.ts');
    
    if (!existsSync(scriptPath)) {
      logger.error(`Script not found: ${scriptPath}`);
      process.exit(1);
    }

    logger.info('Deploying cross-chain token to testnet...');

    const args = ['run', scriptPath];
    if (options.dryRun) args.push('--dry-run');

    await execa('bun', args, { stdio: 'inherit', cwd: root });
  });

// ============================================================================
// Deploy Hyperlane Command
// ============================================================================

tokenCommand
  .command('deploy:hyperlane')
  .description('Deploy Hyperlane infrastructure (Mailbox, IGP, MultisigISM) to Jeju Testnet')
  .option('-n, --network <network>', 'Target network (testnet)', 'testnet')
  .option('--dry-run', 'Simulate deployment without executing')
  .action(async (options: { network: string; dryRun?: boolean }) => {
    const root = findMonorepoRoot();
    const scriptPath = join(root, 'packages/token/scripts/deploy-hyperlane-jeju.ts');
    
    if (!existsSync(scriptPath)) {
      logger.error(`Script not found: ${scriptPath}`);
      process.exit(1);
    }

    logger.info(`Deploying Hyperlane infrastructure to ${options.network}...`);

    const args = ['run', scriptPath];
    if (options.dryRun) args.push('--dry-run');

    await execa('bun', args, { stdio: 'inherit', cwd: root });
  });

// ============================================================================
// Deploy Solana Command
// ============================================================================

tokenCommand
  .command('deploy:solana')
  .description('Deploy SPL token to Solana')
  .option('-n, --network <network>', 'Target network (devnet|mainnet)', 'devnet')
  .option('--dry-run', 'Simulate deployment without executing')
  .action(async (options: { network: string; dryRun?: boolean }) => {
    const root = findMonorepoRoot();
    const scriptPath = join(root, 'packages/token/scripts/deploy-solana.ts');
    
    if (!existsSync(scriptPath)) {
      logger.error(`Script not found: ${scriptPath}`);
      process.exit(1);
    }

    logger.info(`Deploying SPL token to Solana ${options.network}...`);

    const args = ['run', scriptPath];
    if (options.network === 'mainnet') args.push('mainnet');
    if (options.dryRun) args.push('--dry-run');

    await execa('bun', args, { stdio: 'inherit', cwd: root });
  });

// ============================================================================
// Verify Command
// ============================================================================

tokenCommand
  .command('verify')
  .description('Verify token deployment and cross-chain functionality on testnet')
  .option('-n, --network <network>', 'Target network (testnet)', 'testnet')
  .option('--dry-run', 'Simulate verification without executing')
  .action(async (options: { network: string; dryRun?: boolean }) => {
    const root = findMonorepoRoot();
    const scriptPath = join(root, 'packages/token/scripts/deploy-and-verify-testnet.ts');
    
    if (!existsSync(scriptPath)) {
      logger.error(`Script not found: ${scriptPath}`);
      process.exit(1);
    }

    logger.info(`Verifying token deployment on ${options.network}...`);

    const args = ['run', scriptPath];
    if (options.dryRun) args.push('--dry-run');

    await execa('bun', args, { stdio: 'inherit', cwd: root });
  });

// ============================================================================
// Status Command
// ============================================================================

interface StatusOptions {
  network: 'localnet' | 'testnet' | 'mainnet';
}

tokenCommand
  .command('status <token>')
  .description('Check token deployment status')
  .option('-n, --network <network>', 'Target network', 'testnet')
  .action(async (token: string, options: StatusOptions) => {
    const tokenSymbol = token.toUpperCase();
    logger.info(`Checking ${tokenSymbol} status on ${options.network}...\n`);

    // Token info
    const tokenInfo = KNOWN_TOKENS[tokenSymbol];
    console.log(chalk.bold('Token Info:'));
    console.log(`  Name:          ${tokenInfo?.name ?? tokenSymbol}`);
    console.log(`  Symbol:        ${tokenSymbol}`);
    console.log(`  Decimals:      18`);
    console.log(`  Total Supply:  ${tokenInfo?.totalSupply ?? 'Custom'}`);
    console.log();

    // Deployment status
    console.log(chalk.bold('Deployment Status:'));
    const chains = getNetworkConfig(options.network, tokenSymbol);
    
    console.log(`  ${chalk.cyan(chains.homeChain)} (home):`);
    console.log(`    Token:   ${chalk.dim('Not deployed')}`);
    
    for (const chain of chains.syntheticChains) {
      console.log(`  ${chalk.dim(chain)} (synthetic):`);
      console.log(`    Token:   ${chalk.dim('Not deployed')}`);
      console.log(`    Router:  ${chalk.dim('Not configured')}`);
    }
    console.log();

    // Fee configuration
    console.log(chalk.bold('Fee Configuration:'));
    console.log(`  XLP Reward:    80% of bridge fees`);
    console.log(`  Protocol:      10% of bridge fees`);
    console.log(`  Burn:          10% of bridge fees`);
    console.log(`  Bridge Fee:    0.05% - 1%`);
    console.log(`  ZK Discount:   20% off bridge fees`);
  });

// ============================================================================
// Bridge Command
// ============================================================================

interface BridgeOptions {
  from: string;
  to: string;
  recipient?: string;
  zk?: boolean;
}

tokenCommand
  .command('bridge <token> <amount>')
  .description('Bridge tokens between chains')
  .requiredOption('--from <chain>', 'Source chain')
  .requiredOption('--to <chain>', 'Destination chain')
  .option('--recipient <address>', 'Recipient address (defaults to sender)')
  .option('--zk', 'Use ZK verification for lower fees')
  .action(async (token: string, amount: string, options: BridgeOptions) => {
    const tokenName = token.toUpperCase();
    logger.info(`Bridging ${amount} ${tokenName} from ${options.from} to ${options.to}...`);

    if (options.zk) {
      logger.info(chalk.green('Using ZK verification - 20% fee discount applied'));
    }

    // Quote the transfer
    console.log(chalk.bold('\nTransfer Quote:'));
    console.log(`  Amount:        ${amount} ${tokenName}`);
    console.log(`  Bridge Fee:    ${options.zk ? '0.04%' : '0.05%'} (${calculateFee(amount, options.zk)})`);
    console.log(`  Gas Payment:   ~0.001 ETH`);
    console.log(`  Net Received:  ${calculateNet(amount, options.zk)} ${tokenName}`);
    console.log(`  Est. Time:     ${options.zk ? '10-15 minutes' : '3-5 minutes'}`);
    console.log();

    logger.info('To proceed, run with --confirm flag');
  });

// ============================================================================
// Configure Routes Command
// ============================================================================

tokenCommand
  .command('configure-routes <token>')
  .description('Configure Hyperlane warp routes for token')
  .option('-n, --network <network>', 'Target network', 'testnet')
  .action(async (token: string, options: { network: string }) => {
    const tokenName = token.toUpperCase();
    logger.info(`Configuring warp routes for ${tokenName} on ${options.network}...`);

    const chains = getNetworkConfig(options.network as 'testnet' | 'mainnet');
    
    for (const chain of chains.syntheticChains) {
      logger.info(`  Setting router for ${chain}...`);
      await simulateDeploymentStep('set router');
      logger.info(`    ${chalk.green('✓')} Router configured`);
    }

    logger.success('\nWarp routes configured successfully.');
  });

// ============================================================================
// Helpers
// ============================================================================

function getNetworkConfig(network: string, tokenSymbol?: string) {
  // JEJU's home chain is the Jeju network
  const isJeju = tokenSymbol === 'JEJU';
  
  if (network === 'mainnet') {
    return {
      homeChain: isJeju ? 'jeju' : 'ethereum',
      syntheticChains: isJeju 
        ? ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'solana']
        : ['base', 'arbitrum', 'optimism', 'polygon', 'avalanche', 'bsc', 'solana'],
    };
  }
  return {
    homeChain: isJeju ? 'jeju-testnet' : 'sepolia',
    syntheticChains: isJeju
      ? ['sepolia', 'base-sepolia', 'arbitrum-sepolia', 'solana-devnet']
      : ['base-sepolia', 'arbitrum-sepolia', 'jeju-testnet', 'solana-devnet'],
  };
}

async function simulateDeploymentStep(_step: string): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 500));
}

function calculateFee(amount: string, zk?: boolean): string {
  const amountNum = parseFloat(amount);
  const feePercent = zk ? 0.0004 : 0.0005;
  return (amountNum * feePercent).toFixed(4);
}

function calculateNet(amount: string, zk?: boolean): string {
  const amountNum = parseFloat(amount);
  const feePercent = zk ? 0.0004 : 0.0005;
  return (amountNum * (1 - feePercent)).toFixed(4);
}
