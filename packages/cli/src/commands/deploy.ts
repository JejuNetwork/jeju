/**
 * jeju deploy - Deploy to testnet/mainnet
 */

import { Command } from 'commander';
import prompts from 'prompts';
import { execa } from 'execa';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { logger } from '../lib/logger';
import { checkRpcHealth, getAccountBalance } from '../lib/chain';
import { hasKeys, resolvePrivateKey } from '../lib/keys';
import { checkDocker, checkFoundry, getNetworkDir } from '../lib/system';
import { CHAIN_CONFIG, type NetworkType } from '../types';
import { Wallet } from 'ethers';

interface DeployConfig {
  network: NetworkType;
  lastDeployed?: string;
  deployerAddress?: string;
  contracts?: boolean;
  infrastructure?: boolean;
  apps?: boolean;
}

function getConfigPath(): string {
  return join(getNetworkDir(), 'deploy-config.json');
}

function loadConfig(): DeployConfig | null {
  const path = getConfigPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function saveConfig(config: DeployConfig): void {
  const dir = getNetworkDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}

export const deployCommand = new Command('deploy')
  .description('Deploy to testnet or mainnet')
  .argument('[network]', 'testnet | mainnet')
  .option('--contracts', 'Deploy only contracts')
  .option('--infrastructure', 'Deploy only infrastructure')
  .option('--apps', 'Deploy only apps')
  .option('--dry-run', 'Simulate without making changes')
  .option('-y, --yes', 'Skip confirmations')
  .action(async (networkArg, options) => {
    const savedConfig = loadConfig();
    const isDryRun = options.dryRun === true;
    
    // Determine network
    let network: NetworkType;
    if (networkArg) {
      network = networkArg as NetworkType;
    } else if (savedConfig?.network && savedConfig.network !== 'localnet') {
      const { useLastNetwork } = await prompts({
        type: 'confirm',
        name: 'useLastNetwork',
        message: `Deploy to ${savedConfig.network} again?`,
        initial: true,
      });
      
      if (useLastNetwork) {
        network = savedConfig.network;
      } else {
        const { selectedNetwork } = await prompts({
          type: 'select',
          name: 'selectedNetwork',
          message: 'Select network:',
          choices: [
            { title: 'Testnet', value: 'testnet' },
            { title: 'Mainnet', value: 'mainnet' },
          ],
        });
        if (!selectedNetwork) return;
        network = selectedNetwork;
      }
    } else {
      const { selectedNetwork } = await prompts({
        type: 'select',
        name: 'selectedNetwork',
        message: 'Select network:',
        choices: [
          { title: 'Testnet', value: 'testnet' },
          { title: 'Mainnet', value: 'mainnet' },
        ],
      });
      if (!selectedNetwork) return;
      network = selectedNetwork;
    }

    if (network === 'localnet') {
      logger.error('Use `jeju dev` for localnet');
      return;
    }

    logger.header(`DEPLOY TO ${network.toUpperCase()}`);

    if (isDryRun) {
      logger.warn('DRY RUN - simulating deployment');
    }

    // Check keys
    let wallet: Wallet | null = null;
    let balance = '0';

    if (!hasKeys(network)) {
      if (isDryRun) {
        logger.warn('Keys not configured (would prompt in real deploy)');
      } else {
        logger.warn(`No keys configured for ${network}`);
        
        const { generateKeys } = await prompts({
          type: 'confirm',
          name: 'generateKeys',
          message: 'Generate keys now?',
          initial: true,
        });

        if (generateKeys) {
          const { keysCommand } = await import('./keys');
          await keysCommand.parseAsync(['genesis', '-n', network], { from: 'user' });
          
          if (!hasKeys(network)) {
            logger.error('Key generation cancelled or failed');
            return;
          }
        } else {
          logger.info('Run: jeju keys genesis -n ' + network);
          return;
        }
      }
    }

    // Get wallet info if keys exist
    if (hasKeys(network)) {
      logger.success('Keys configured');
      
      try {
        const privateKey = resolvePrivateKey(network);
        wallet = new Wallet(privateKey);
        const chainConfig = CHAIN_CONFIG[network];
        
        try {
          balance = await getAccountBalance(chainConfig.rpcUrl, wallet.address as `0x${string}`);
          const balanceNum = parseFloat(balance);
          
          if (balanceNum < 0.1) {
            if (isDryRun) {
              logger.warn(`Low balance: ${balance} ETH (would fail in real deploy)`);
            } else {
              logger.error(`Insufficient balance: ${balance} ETH`);
              logger.newline();
              logger.info('Fund the deployer with at least 0.1 ETH:');
              logger.keyValue('Address', wallet.address);
              logger.keyValue('Network', network === 'testnet' ? 'Base Sepolia' : 'Base');
              
              if (network === 'testnet') {
                logger.newline();
                logger.info('Get testnet ETH from:');
                logger.info('  https://www.alchemy.com/faucets/base-sepolia');
              }
              return;
            }
          } else {
            logger.success(`Deployer funded: ${parseFloat(balance).toFixed(4)} ETH`);
          }
        } catch {
          if (isDryRun) {
            logger.warn(`Cannot connect to ${network} RPC (would fail in real deploy)`);
          } else {
            logger.error(`Cannot connect to ${network} RPC: ${chainConfig.rpcUrl}`);
            return;
          }
        }
      } catch {
        if (!isDryRun) {
          logger.error('Could not resolve deployer key');
          return;
        }
      }
    }

    // Determine what to deploy
    let deployContracts = options.contracts;
    let deployInfra = options.infrastructure;
    let deployApps = options.apps;
    
    if (!deployContracts && !deployInfra && !deployApps) {
      if (isDryRun) {
        // Default to all in dry-run
        deployContracts = true;
        deployInfra = true;
        deployApps = true;
      } else {
        const { deployChoice } = await prompts({
          type: 'select',
          name: 'deployChoice',
          message: 'What to deploy?',
          choices: [
            { title: 'Everything (contracts + infra + apps)', value: 'all' },
            { title: 'Contracts only', value: 'contracts' },
            { title: 'Infrastructure only', value: 'infrastructure' },
            { title: 'Apps only', value: 'apps' },
          ],
        });
        
        if (!deployChoice) return;
        
        if (deployChoice === 'all') {
          deployContracts = true;
          deployInfra = true;
          deployApps = true;
        } else {
          deployContracts = deployChoice === 'contracts';
          deployInfra = deployChoice === 'infrastructure';
          deployApps = deployChoice === 'apps';
        }
      }
    }

    // Check dependencies
    if (deployContracts && !isDryRun) {
      const foundryResult = await checkFoundry();
      if (foundryResult.status !== 'ok') {
        logger.error('Foundry required for contracts');
        logger.info('Install: curl -L https://foundry.paradigm.xyz | bash');
        return;
      }
      logger.success('Foundry available');
    }

    if (deployInfra && !isDryRun) {
      const dockerResult = await checkDocker();
      if (dockerResult.status !== 'ok') {
        logger.error('Docker required for infrastructure');
        return;
      }
      logger.success('Docker available');
    }

    // Confirmation
    if (!options.yes && !isDryRun) {
      logger.newline();
      logger.subheader('Deployment Plan');
      logger.keyValue('Network', network);
      if (wallet) {
        logger.keyValue('Deployer', wallet.address);
        logger.keyValue('Balance', `${parseFloat(balance).toFixed(4)} ETH`);
      }
      logger.keyValue('Contracts', deployContracts ? 'Yes' : 'No');
      logger.keyValue('Infrastructure', deployInfra ? 'Yes' : 'No');
      logger.keyValue('Apps', deployApps ? 'Yes' : 'No');
      logger.newline();

      const { proceed } = await prompts({
        type: 'confirm',
        name: 'proceed',
        message: `Deploy to ${network}?`,
        initial: false,
      });

      if (!proceed) {
        logger.info('Cancelled');
        return;
      }
    }

    const rootDir = findMonorepoRoot();

    // Deploy
    if (deployContracts) {
      await runDeployContracts(rootDir, network, isDryRun);
    }

    if (deployInfra) {
      await runDeployInfra(rootDir, network, isDryRun);
    }

    if (deployApps) {
      await runDeployApps(rootDir, network, isDryRun);
    }

    // Save config
    if (wallet) {
      saveConfig({
        network,
        lastDeployed: new Date().toISOString(),
        deployerAddress: wallet.address,
        contracts: deployContracts,
        infrastructure: deployInfra,
        apps: deployApps,
      });
    }

    // Summary
    logger.newline();
    logger.header('DONE');
    
    if (network === 'testnet') {
      logger.keyValue('RPC', 'https://rpc.testnet.jeju.network');
      logger.keyValue('Explorer', 'https://explorer.testnet.jeju.network');
    } else {
      logger.keyValue('RPC', 'https://rpc.jeju.network');
      logger.keyValue('Explorer', 'https://explorer.jeju.network');
    }
  });

function findMonorepoRoot(): string {
  let dir = process.cwd();
  while (dir !== '/') {
    if (existsSync(join(dir, 'bun.lock')) && existsSync(join(dir, 'packages'))) {
      return dir;
    }
    dir = join(dir, '..');
  }
  return process.cwd();
}

async function runDeployContracts(rootDir: string, network: NetworkType, dryRun: boolean): Promise<void> {
  logger.subheader('Contracts');
  
  const contractsDir = join(rootDir, 'packages/contracts');
  if (!existsSync(contractsDir)) {
    logger.warn('packages/contracts not found');
    return;
  }

  logger.step('Building...');
  if (!dryRun) {
    try {
      await execa('forge', ['build'], { cwd: contractsDir, stdio: 'pipe' });
    } catch {
      logger.error('Build failed');
      return;
    }
  }
  logger.success('Built');

  const deployScript = join(rootDir, `scripts/deploy/${network}.ts`);
  if (existsSync(deployScript)) {
    logger.step('Deploying...');
    if (!dryRun) {
      await execa('bun', ['run', deployScript], {
        cwd: rootDir,
        stdio: 'inherit',
        env: { ...process.env, NETWORK: network },
      });
    }
    logger.success('Deployed');
  } else {
    const forgeScript = join(contractsDir, 'script/Deploy.s.sol');
    if (existsSync(forgeScript)) {
      logger.step('Deploying via Forge...');
      if (!dryRun) {
        const rpcUrl = CHAIN_CONFIG[network].rpcUrl;
        await execa('forge', ['script', 'script/Deploy.s.sol', '--rpc-url', rpcUrl, '--broadcast'], {
          cwd: contractsDir,
          stdio: 'inherit',
        });
      }
      logger.success('Deployed');
    } else {
      logger.warn('No deploy script found');
    }
  }
}

async function runDeployInfra(rootDir: string, network: NetworkType, dryRun: boolean): Promise<void> {
  logger.subheader('Infrastructure');
  
  const deploymentDir = join(rootDir, 'packages/deployment');
  if (!existsSync(deploymentDir)) {
    logger.warn('packages/deployment not found');
    return;
  }

  const deployScript = join(deploymentDir, 'scripts/deploy-full.ts');
  if (existsSync(deployScript)) {
    logger.step('Deploying...');
    if (!dryRun) {
      await execa('bun', ['run', deployScript], {
        cwd: deploymentDir,
        stdio: 'inherit',
        env: { ...process.env, NETWORK: network },
      });
    }
    logger.success('Deployed');
  } else {
    logger.warn('No deploy script found');
  }
}

async function runDeployApps(rootDir: string, network: NetworkType, dryRun: boolean): Promise<void> {
  logger.subheader('Apps');
  
  logger.step('Building...');
  if (!dryRun) {
    await execa('bun', ['run', 'build'], {
      cwd: rootDir,
      stdio: 'pipe',
      reject: false,
    });
  }
  logger.success('Built');

  const k8sDir = join(rootDir, 'packages/deployment/kubernetes');
  const helmfilePath = join(k8sDir, 'helmfile.yaml');
  
  if (existsSync(helmfilePath)) {
    logger.step('Deploying to Kubernetes...');
    if (!dryRun) {
      await execa('helmfile', ['sync'], {
        cwd: k8sDir,
        stdio: 'inherit',
        env: { ...process.env, ENVIRONMENT: network },
      });
    }
    logger.success('Deployed');
  } else {
    logger.warn('No Kubernetes manifests found');
  }
}

// Preflight subcommand - check everything before deploying
deployCommand
  .command('preflight')
  .description('Pre-deployment checklist (keys, balance, dependencies)')
  .argument('[network]', 'Network: testnet | mainnet', 'testnet')
  .action(async (networkArg) => {
    const network = networkArg as NetworkType;
    
    if (network === 'localnet') {
      logger.info('For localnet, use: jeju dev');
      return;
    }

    logger.header(`PREFLIGHT CHECK: ${network.toUpperCase()}`);
    logger.newline();

    let allOk = true;

    // 1. Check keys
    logger.subheader('1. Keys');
    if (hasKeys(network)) {
      const privateKey = resolvePrivateKey(network);
      const wallet = new Wallet(privateKey);
      logger.table([{
        label: 'Deployer Key',
        value: wallet.address.slice(0, 20) + '...',
        status: 'ok',
      }]);
    } else {
      logger.table([{
        label: 'Deployer Key',
        value: 'Not configured',
        status: 'error',
      }]);
      logger.info('  Fix: jeju keys genesis -n ' + network);
      allOk = false;
    }

    // 2. Check balance
    logger.newline();
    logger.subheader('2. Balance');
    if (hasKeys(network)) {
      const privateKey = resolvePrivateKey(network);
      const wallet = new Wallet(privateKey);
      const config = CHAIN_CONFIG[network];
      
      try {
        const balance = await getAccountBalance(config.rpcUrl, wallet.address as `0x${string}`);
        const balanceNum = parseFloat(balance);
        const minBalance = 0.1;
        
        logger.table([{
          label: 'ETH Balance',
          value: `${balanceNum.toFixed(4)} ETH`,
          status: balanceNum >= minBalance ? 'ok' : 'error',
        }]);
        
        if (balanceNum < minBalance) {
          logger.info(`  Required: ${minBalance} ETH minimum`);
          logger.info('  Fix: Get testnet ETH from faucet:');
          logger.info('       jeju faucet --chain base');
          logger.info('       Or: https://www.alchemy.com/faucets/base-sepolia');
          allOk = false;
        }
      } catch {
        logger.table([{
          label: 'ETH Balance',
          value: 'Cannot connect to RPC',
          status: 'error',
        }]);
        allOk = false;
      }
    } else {
      logger.table([{
        label: 'ETH Balance',
        value: 'Skipped (no keys)',
        status: 'warn',
      }]);
    }

    // 3. Check Foundry
    logger.newline();
    logger.subheader('3. Dependencies');
    const foundryResult = await checkFoundry();
    logger.table([{
      label: 'Foundry',
      value: foundryResult.status === 'ok' ? 'Installed' : 'Not found',
      status: foundryResult.status === 'ok' ? 'ok' : 'error',
    }]);
    
    if (foundryResult.status !== 'ok') {
      logger.info('  Fix: curl -L https://foundry.paradigm.xyz | bash && foundryup');
      allOk = false;
    }

    // 4. Check contracts build
    const rootDir = findMonorepoRoot();
    const contractsDir = join(rootDir, 'packages/contracts');
    const outDir = join(contractsDir, 'out');
    
    logger.table([{
      label: 'Contracts',
      value: existsSync(outDir) ? 'Built' : 'Not built',
      status: existsSync(outDir) ? 'ok' : 'warn',
    }]);
    
    if (!existsSync(outDir)) {
      logger.info('  Fix: cd packages/contracts && forge build');
    }

    // Summary
    logger.newline();
    if (allOk) {
      logger.success('All checks passed. Ready to deploy.');
      logger.newline();
      logger.info(`Run: jeju deploy ${network} --token`);
    } else {
      logger.error('Some checks failed. Fix issues above before deploying.');
    }
  });

// Status subcommand
deployCommand
  .command('status')
  .description('Check deployment status')
  .argument('[network]', 'testnet | mainnet')
  .action(async (networkArg) => {
    const savedConfig = loadConfig();
    const network = (networkArg || savedConfig?.network || 'testnet') as NetworkType;
    
    if (network === 'localnet') {
      logger.info('Use `jeju status` for localnet');
      return;
    }
    
    const config = CHAIN_CONFIG[network];
    
    logger.header(`${network.toUpperCase()} STATUS`);
    
    const rpcHealthy = await checkRpcHealth(config.rpcUrl, 5000);
    logger.table([{
      label: 'RPC',
      value: config.rpcUrl,
      status: rpcHealthy ? 'ok' : 'error',
    }]);
    
    if (savedConfig?.lastDeployed && savedConfig.network === network) {
      logger.table([{
        label: 'Last deployed',
        value: new Date(savedConfig.lastDeployed).toLocaleString(),
        status: 'ok',
      }]);
      if (savedConfig.deployerAddress) {
        logger.table([{
          label: 'Deployer',
          value: savedConfig.deployerAddress,
          status: 'ok',
        }]);
      }
    }
    
    const rootDir = findMonorepoRoot();
    const deploymentsFile = join(rootDir, `packages/contracts/deployments/${network}/contracts.json`);
    
    if (existsSync(deploymentsFile)) {
      const deployments = JSON.parse(readFileSync(deploymentsFile, 'utf-8'));
      const count = Object.keys(deployments).length;
      logger.table([{
        label: 'Contracts',
        value: `${count} deployed`,
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
