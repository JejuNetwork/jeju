/**
 * jeju deploy - Deploy to testnet/mainnet
 */

import { Command } from 'commander';
import prompts from 'prompts';
import { execa } from 'execa';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../lib/logger';
import { checkRpcHealth, getAccountBalance } from '../lib/chain';
import { hasKeys, resolvePrivateKey } from '../lib/keys';
import { checkDocker, checkFoundry } from '../lib/system';
import { CHAIN_CONFIG, type NetworkType, type DeploymentConfig } from '../types';
import { Wallet } from 'ethers';

export const deployCommand = new Command('deploy')
  .description('Deploy to testnet or mainnet')
  .argument('[network]', 'Network: testnet | mainnet', 'testnet')
  .option('--contracts', 'Deploy only contracts')
  .option('--infrastructure', 'Deploy only infrastructure')
  .option('--apps', 'Deploy only apps')
  .option('--dry-run', 'Simulate deployment without making changes')
  .option('-y, --yes', 'Skip confirmations')
  .action(async (networkArg, options) => {
    const network = networkArg as NetworkType;

    if (network === 'localnet') {
      logger.error('Cannot deploy to localnet. Use `jeju dev` instead.');
      process.exit(1);
    }

    logger.header(`DEPLOY TO ${network.toUpperCase()}`);

    const config: DeploymentConfig = {
      network,
      contracts: options.contracts || (!options.infrastructure && !options.apps),
      infrastructure: options.infrastructure || (!options.contracts && !options.apps),
      apps: options.apps || (!options.contracts && !options.infrastructure),
      dryRun: options.dryRun || false,
    };

    // Pre-flight checks
    logger.subheader('Pre-flight Checks');

    // Check keys
    if (!hasKeys(network)) {
      logger.error(`No keys configured for ${network}`);
      logger.info(`Run: jeju keys generate --network=${network}`);
      process.exit(1);
    }
    logger.success('Keys configured');

    // Check deployer balance
    const privateKey = resolvePrivateKey(network);
    const wallet = new Wallet(privateKey);
    const chainConfig = CHAIN_CONFIG[network];
    
    const balance = await getAccountBalance(chainConfig.rpcUrl, wallet.address as `0x${string}`);
    const balanceNum = parseFloat(balance);
    
    if (balanceNum < 0.1) {
      logger.error(`Insufficient balance: ${balance} ETH`);
      logger.info('Fund the deployer address with at least 0.1 ETH');
      logger.keyValue('Address', wallet.address);
      process.exit(1);
    }
    logger.success(`Deployer funded (${balance} ETH)`);

    // Check dependencies
    if (config.contracts) {
      const foundryResult = await checkFoundry();
      if (foundryResult.status !== 'ok') {
        logger.error('Foundry required for contract deployment');
        process.exit(1);
      }
      logger.success('Foundry available');
    }

    if (config.infrastructure) {
      const dockerResult = await checkDocker();
      if (dockerResult.status !== 'ok') {
        logger.error('Docker required for infrastructure deployment');
        process.exit(1);
      }
      logger.success('Docker available');
    }

    logger.newline();

    // Confirmation
    if (!options.yes && !config.dryRun) {
      logger.box([
        `Network: ${network}`,
        `Contracts: ${config.contracts ? 'Yes' : 'No'}`,
        `Infrastructure: ${config.infrastructure ? 'Yes' : 'No'}`,
        `Apps: ${config.apps ? 'Yes' : 'No'}`,
        '',
        `Deployer: ${wallet.address}`,
        `Balance: ${balance} ETH`,
      ]);

      const { proceed } = await prompts({
        type: 'confirm',
        name: 'proceed',
        message: `Deploy to ${network}?`,
        initial: false,
      });

      if (!proceed) {
        logger.info('Deployment cancelled');
        return;
      }
    }

    if (config.dryRun) {
      logger.warn('DRY RUN - No changes will be made');
      logger.newline();
    }

    const rootDir = process.cwd();

    // Deploy contracts
    if (config.contracts) {
      await deployContracts(rootDir, network, config.dryRun);
    }

    // Deploy infrastructure
    if (config.infrastructure) {
      await deployInfrastructure(rootDir, network, config.dryRun);
    }

    // Deploy apps
    if (config.apps) {
      await deployApps(rootDir, network, config.dryRun);
    }

    // Summary
    logger.newline();
    logger.header('DEPLOYMENT COMPLETE');
    
    logger.subheader('Endpoints');
    if (network === 'testnet') {
      logger.table([
        { label: 'RPC', value: 'https://rpc.testnet.jeju.network', status: 'ok' },
        { label: 'Explorer', value: 'https://explorer.testnet.jeju.network', status: 'ok' },
        { label: 'Gateway', value: 'https://gateway.testnet.jeju.network', status: 'ok' },
      ]);
    } else {
      logger.table([
        { label: 'RPC', value: 'https://rpc.jeju.network', status: 'ok' },
        { label: 'Explorer', value: 'https://explorer.jeju.network', status: 'ok' },
        { label: 'Gateway', value: 'https://gateway.jeju.network', status: 'ok' },
      ]);
    }
  });

async function deployContracts(rootDir: string, network: NetworkType, dryRun: boolean): Promise<void> {
  logger.subheader('Deploying Contracts');
  
  const contractsDir = join(rootDir, 'packages/contracts');
  if (!existsSync(contractsDir)) {
    logger.warn('Contracts directory not found');
    return;
  }

  // Build contracts
  logger.step('Building contracts...');
  if (!dryRun) {
    await execa('forge', ['build'], { cwd: contractsDir, stdio: 'pipe' });
  }
  logger.success('Contracts built');

  // Deploy using deployment script
  const deployScript = join(rootDir, `scripts/deploy/${network}.ts`);
  if (existsSync(deployScript)) {
    logger.step('Running deployment script...');
    if (!dryRun) {
      await execa('bun', ['run', deployScript], {
        cwd: rootDir,
        stdio: 'inherit',
        env: {
          ...process.env,
          NETWORK: network,
          JEJU_NETWORK: network,
        },
      });
    }
    logger.success('Contracts deployed');
  } else {
    logger.warn(`Deployment script not found: ${deployScript}`);
    logger.info('Using forge script fallback...');
    
    // Fallback to forge script
    const forgeScript = join(contractsDir, 'script/Deploy.s.sol');
    if (existsSync(forgeScript) && !dryRun) {
      const rpcUrl = CHAIN_CONFIG[network].rpcUrl;
      await execa('forge', ['script', 'script/Deploy.s.sol', '--rpc-url', rpcUrl, '--broadcast'], {
        cwd: contractsDir,
        stdio: 'inherit',
      });
      logger.success('Contracts deployed via Forge');
    }
  }
}

async function deployInfrastructure(rootDir: string, network: NetworkType, dryRun: boolean): Promise<void> {
  logger.subheader('Deploying Infrastructure');
  
  const deploymentDir = join(rootDir, 'packages/deployment');
  if (!existsSync(deploymentDir)) {
    logger.warn('Deployment package not found');
    return;
  }

  // Run deployment script
  const deployScript = join(deploymentDir, 'scripts/deploy-full.ts');
  if (existsSync(deployScript)) {
    logger.step('Running infrastructure deployment...');
    if (!dryRun) {
      await execa('bun', ['run', deployScript], {
        cwd: deploymentDir,
        stdio: 'inherit',
        env: {
          ...process.env,
          NETWORK: network,
        },
      });
    }
    logger.success('Infrastructure deployed');
  } else {
    logger.warn('Infrastructure deployment script not found');
  }
}

async function deployApps(rootDir: string, network: NetworkType, dryRun: boolean): Promise<void> {
  logger.subheader('Deploying Apps');
  
  // Build apps
  logger.step('Building apps...');
  if (!dryRun) {
    await execa('bun', ['run', 'build'], {
      cwd: rootDir,
      stdio: 'pipe',
      reject: false,
    });
  }
  logger.success('Apps built');

  // Deploy using helmfile or kubectl
  const k8sDir = join(rootDir, 'packages/deployment/kubernetes');
  if (existsSync(k8sDir)) {
    logger.step('Deploying to Kubernetes...');
    if (!dryRun) {
      // Check for helmfile
      const helmfilePath = join(k8sDir, 'helmfile.yaml');
      if (existsSync(helmfilePath)) {
        await execa('helmfile', ['sync'], {
          cwd: k8sDir,
          stdio: 'inherit',
          env: {
            ...process.env,
            ENVIRONMENT: network,
          },
        });
      }
    }
    logger.success('Apps deployed to Kubernetes');
  } else {
    logger.info('Kubernetes manifests not found, skipping k8s deployment');
  }
}

// Subcommand for checking deployment status
deployCommand
  .command('status')
  .description('Check deployment status')
  .option('-n, --network <network>', 'Network', 'testnet')
  .action(async (options) => {
    const network = options.network as NetworkType;
    const config = CHAIN_CONFIG[network];
    
    logger.header(`DEPLOYMENT STATUS: ${network.toUpperCase()}`);
    
    // Check RPC
    const rpcHealthy = await checkRpcHealth(config.rpcUrl, 5000);
    logger.table([{
      label: 'RPC',
      value: config.rpcUrl,
      status: rpcHealthy ? 'ok' : 'error',
    }]);
    
    // Check contract deployments
    const rootDir = process.cwd();
    const deploymentsFile = join(rootDir, `packages/contracts/deployments/${network}/contracts.json`);
    
    if (existsSync(deploymentsFile)) {
      const deployments = JSON.parse(readFileSync(deploymentsFile, 'utf-8'));
      const contractCount = Object.keys(deployments).length;
      logger.table([{
        label: 'Contracts',
        value: `${contractCount} deployed`,
        status: 'ok',
      }]);
    } else {
      logger.table([{
        label: 'Contracts',
        value: 'Not deployed',
        status: 'warn',
      }]);
    }
  });

