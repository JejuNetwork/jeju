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
import { checkDocker, checkFoundry, getNetworkDir, findMonorepoRoot } from '../lib/system';
import { CHAIN_CONFIG, type NetworkType } from '../types';
import { privateKeyToAccount } from 'viem/accounts';

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
    let account: ReturnType<typeof privateKeyToAccount> | null = null;
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
        account = privateKeyToAccount(privateKey as `0x${string}`);
        const chainConfig = CHAIN_CONFIG[network];
        
        try {
          balance = await getAccountBalance(chainConfig.rpcUrl, account.address);
          const balanceNum = parseFloat(balance);
          
          if (balanceNum < 0.1) {
            if (isDryRun) {
              logger.warn(`Low balance: ${balance} ETH (would fail in real deploy)`);
            } else {
              logger.error(`Insufficient balance: ${balance} ETH`);
              logger.newline();
              logger.info('Fund the deployer with at least 0.1 ETH:');
              logger.keyValue('Address', account.address);
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
      if (account) {
        logger.keyValue('Deployer', account.address);
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
    if (account) {
      saveConfig({
        network,
        lastDeployed: new Date().toISOString(),
        deployerAddress: account.address,
        contracts: deployContracts,
        infrastructure: deployInfra,
        apps: deployApps,
      });
    }

    // Summary
    logger.newline();
    logger.header('DONE');
    
    if (network === 'testnet') {
      logger.keyValue('RPC', 'https://testnet-rpc.jejunetwork.org');
      logger.keyValue('Explorer', 'https://explorer.testnet.jejunetwork.org');
    } else {
      logger.keyValue('RPC', 'https://rpc.jejunetwork.org');
      logger.keyValue('Explorer', 'https://explorer.jejunetwork.org');
    }
  });

function findMonorepoRootLocal(): string {
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
      const account = privateKeyToAccount(privateKey as `0x${string}`);
      logger.table([{
        label: 'Deployer Key',
        value: account.address.slice(0, 20) + '...',
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
      const account = privateKeyToAccount(privateKey as `0x${string}`);
      const config = CHAIN_CONFIG[network];
      
      try {
        const balance = await getAccountBalance(config.rpcUrl, account.address);
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

// Check subcommand - comprehensive deployment readiness check
deployCommand
  .command('check')
  .description('Comprehensive readiness check for deployment (infrastructure, keys, contracts, network)')
  .argument('[network]', 'testnet | mainnet', 'testnet')
  .action(async (networkArg) => {
    const network = networkArg as NetworkType;
    
    if (network === 'localnet') {
      logger.info('Use `jeju status` for localnet');
      return;
    }

    logger.header(`DEPLOYMENT CHECK - ${network.toUpperCase()}`);

    // Run the comprehensive check script
    const rootDir = findMonorepoRoot();
    const checkScript = join(rootDir, 'scripts/verify/check-testnet-readiness.ts');
    
    if (!existsSync(checkScript)) {
      logger.error('Check script not found');
      return;
    }

    await execa('bun', ['run', checkScript, network], {
      cwd: rootDir,
      stdio: 'inherit',
    });
  });

// Verify subcommand - verify OIF deployments
deployCommand
  .command('verify')
  .description('Verify contract deployments')
  .argument('<type>', 'oif | contracts')
  .argument('[network]', 'testnet | mainnet', 'testnet')
  .action(async (type, networkArg) => {
    const network = networkArg as NetworkType;
    
    if (type === 'oif') {
      const rootDir = findMonorepoRoot();
      const verifyScript = join(rootDir, 'scripts/verify/verify-oif-deployment.ts');
      
      if (!existsSync(verifyScript)) {
        logger.error('OIF verify script not found');
        return;
      }

      await execa('bun', ['run', verifyScript, network], {
        cwd: rootDir,
        stdio: 'inherit',
      });
    } else {
      logger.error(`Unknown verify type: ${type}`);
      logger.info('Available: oif');
    }
  });

// Component deployment subcommands
deployCommand
  .command('token')
  .description('Deploy NetworkToken and BanManager')
  .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
  .option('--safe <address>', 'Safe multi-sig address (required for testnet/mainnet)')
  .action(async (options) => {
    await runDeployScript('token', options.network, options);
  });

deployCommand
  .command('oif')
  .description('Deploy Open Intents Framework')
  .argument('[network]', 'localnet | testnet | mainnet', 'localnet')
  .option('--oracle-type <type>', 'Oracle type: simple, hyperlane, superchain')
  .action(async (network, options) => {
    await runDeployScript('oif', network, options);
  });

deployCommand
  .command('oif-multichain')
  .description('Deploy OIF to multiple chains')
  .option('--network <network>', 'Network: testnet | mainnet', 'testnet')
  .option('--all', 'Deploy to all configured chains')
  .action(async (options) => {
    await runDeployScript('oif-multichain', options.network, options);
  });

deployCommand
  .command('jns')
  .description('Deploy Jeju Name Service')
  .option('--network <network>', 'Network: localnet | testnet | mainnet', 'localnet')
  .action(async (options) => {
    await runDeployScript('jns', options.network, options);
  });

deployCommand
  .command('oracle')
  .description('Deploy and configure oracle network')
  .option('--network <network>', 'Network: localnet | testnet | mainnet', 'localnet')
  .option('--deploy', 'Deploy contracts')
  .option('--configure', 'Configure oracle node', true)
  .option('--verify', 'Verify contracts')
  .action(async (options) => {
    await runDeployScript('oracle/deploy-and-configure', options.network, options);
  });

deployCommand
  .command('dao')
  .description('Deploy DAO contracts')
  .option('--network <network>', 'Network: localnet | testnet | mainnet', 'localnet')
  .action(async (options) => {
    await runDeployScript('dao', options.network, options);
  });

deployCommand
  .command('governance')
  .description('Deploy governance contracts')
  .option('--network <network>', 'Network: localnet | testnet | mainnet', 'localnet')
  .action(async (options) => {
    await runDeployScript('governance', options.network, options);
  });

deployCommand
  .command('council')
  .description('Deploy Council contracts')
  .option('--network <network>', 'Network: localnet | testnet | mainnet', 'localnet')
  .action(async (options) => {
    await runDeployScript('council', options.network, options);
  });

deployCommand
  .command('launchpad')
  .description('Deploy token launchpad')
  .option('--network <network>', 'Network: localnet | testnet | mainnet', 'localnet')
  .action(async (options) => {
    await runDeployScript('launchpad', options.network, options);
  });

deployCommand
  .command('eil')
  .description('Deploy Ethereum Intent Layer')
  .option('--network <network>', 'Network: localnet | testnet | mainnet', 'localnet')
  .action(async (options) => {
    await runDeployScript('eil', options.network, options);
  });

deployCommand
  .command('eil-paymaster')
  .description('Deploy EIL Paymaster')
  .option('--network <network>', 'Network: localnet | testnet | mainnet', 'localnet')
  .action(async (options) => {
    await runDeployScript('eil-paymaster', options.network, options);
  });

deployCommand
  .command('account-abstraction')
  .description('Deploy account abstraction infrastructure')
  .option('--network <network>', 'Network: localnet | testnet | mainnet', 'localnet')
  .action(async (options) => {
    await runDeployScript('account-abstraction', options.network, options);
  });

deployCommand
  .command('federation')
  .description('Deploy federation contracts')
  .option('--network <network>', 'Network: localnet | testnet | mainnet', 'localnet')
  .action(async (options) => {
    await runDeployScript('federation', options.network, options);
  });

deployCommand
  .command('decentralization')
  .description('Deploy decentralization contracts')
  .option('--network <network>', 'Network: localnet | testnet | mainnet', 'localnet')
  .action(async (options) => {
    await runDeployScript('decentralization', options.network, options);
  });

deployCommand
  .command('oauth3')
  .description('Deploy OAuth3 contracts')
  .option('--network <network>', 'Network: localnet | testnet | mainnet', 'localnet')
  .action(async (options) => {
    await runDeployScript('oauth3', options.network, options);
  });

deployCommand
  .command('otc')
  .description('Deploy OTC trading contracts')
  .option('--network <network>', 'Network: localnet | testnet | mainnet', 'localnet')
  .action(async (options) => {
    await runDeployScript('otc', options.network, options);
  });

deployCommand
  .command('l1')
  .description('Deploy L1 contracts')
  .option('--network <network>', 'Network: testnet | mainnet', 'testnet')
  .action(async (options) => {
    await runDeployScript('deploy-l1-contracts', options.network, options);
  });

deployCommand
  .command('keys')
  .description('Generate operator keys for deployment')
  .option('--network <network>', 'Network: testnet | mainnet', 'testnet')
  .action(async (options) => {
    await runDeployScript('generate-operator-keys', options.network, options);
  });

deployCommand
  .command('zkbridge')
  .description('Deploy ZK bridge for cross-chain EVM-Solana bridging')
  .option('--network <network>', 'Network: testnet | mainnet', 'testnet')
  .option('--evm-only', 'Deploy EVM contracts only')
  .option('--solana-only', 'Deploy Solana programs only')
  .option('--dry-run', 'Simulate deployment')
  .action(async (_options) => {
    logger.error('ZK bridge deployment has been removed.');
    logger.info('Bridge deployment scripts have been deleted.');
    logger.info('Use packages/bridge/scripts/orchestrator.ts directly if needed.');
    process.exit(1);
  });

deployCommand
  .command('zkbridge-setup')
  .description('Setup ZK bridge infrastructure (SP1, Phala TEE)')
  .option('--sp1', 'Setup SP1 prover toolchain')
  .option('--phala', 'Setup Phala TEE endpoint')
  .option('--all', 'Setup all components', true)
  .action(async (_options) => {
    logger.error('ZK bridge setup has been removed.');
    logger.info('Setup scripts have been deleted.');
    logger.info('Refer to packages/bridge/README.md for manual setup instructions.');
    process.exit(1);
  });

deployCommand
  .command('messaging')
  .description('Deploy messaging contracts (KeyRegistry, MessageNodeRegistry)')
  .option('--network <network>', 'Network: localnet | testnet | mainnet', 'testnet')
  .option('--verify', 'Verify contracts on explorer')
  .action(async (options: { network: string; verify?: boolean }) => {
    const rootDir = findMonorepoRoot();
    const scriptPath = join(rootDir, 'packages/deployment/scripts/deploy-messaging-contracts.ts');
    
    if (!existsSync(scriptPath)) {
      logger.error('Messaging contracts deploy script not found');
      return;
    }
    
    const args: string[] = ['--network', options.network];
    if (options.verify) args.push('--verify');
    
    await execa('bun', ['run', scriptPath, ...args], {
      cwd: rootDir,
      stdio: 'inherit',
    });
  });

deployCommand
  .command('rollback')
  .description('Rollback deployment to a previous version')
  .option('--network <network>', 'Network: testnet | mainnet', 'testnet')
  .option('--backup <backup>', 'Backup name or "latest"', 'latest')
  .action(async (options) => {
    await runDeployScript('rollback-deployment', options.network, { backup: options.backup });
  });

deployCommand
  .command('app')
  .description('Deploy an app to the network')
  .argument('<app-name>', 'App name')
  .option('--network <network>', 'Network: localnet | testnet | mainnet', 'localnet')
  .action(async (appName, options) => {
    await runDeployScript('deploy-app', options.network, { app: appName });
  });

deployCommand
  .command('frontend')
  .description('Deploy frontend to IPFS and update JNS')
  .argument('<app-name>', 'App name')
  .option('--network <network>', 'Network: localnet | testnet | mainnet', 'localnet')
  .action(async (appName, options) => {
    await runDeployScript('deploy-frontend', options.network, { app: appName });
  });

deployCommand
  .command('dao-full')
  .description('Deploy full DAO stack')
  .option('--network <network>', 'Network: localnet | testnet', 'localnet')
  .action(async (options) => {
    await runDeployScript('deploy-dao-full', options.network, {});
  });

deployCommand
  .command('testnet-full')
  .description('Full testnet deployment (infrastructure + contracts)')
  .option('--skip-keys', 'Skip operator key generation')
  .option('--skip-l1', 'Skip L1 contract deployment')
  .option('--contracts-only', 'Deploy contracts only (skip infrastructure)')
  .action(async (options) => {
    const rootDir = findMonorepoRoot();
    const scriptPath = join(rootDir, 'scripts/deploy/testnet-full-crosschain.ts');
    
    if (!existsSync(scriptPath)) {
      logger.error('Testnet full deployment script not found');
      return;
    }

    const args: string[] = [];
    if (options.skipKeys) args.push('--skip-keys');
    if (options.skipL1) args.push('--skip-l1');
    if (options.contractsOnly) args.push('--contracts-only');

    await execa('bun', ['run', scriptPath, ...args], {
      cwd: rootDir,
      stdio: 'inherit',
    });
  });

deployCommand
  .command('contracts-testnet')
  .description('Deploy all contracts to testnet (Sepolia and Base Sepolia)')
  .action(async () => {
    logger.error('Contracts testnet deployment has been removed.');
    logger.info('Use individual deploy commands instead:');
    logger.info('  jeju deploy token --network testnet');
    logger.info('  jeju deploy oif --network testnet');
    logger.info('  jeju deploy jns --network testnet');
    process.exit(1);
  });

deployCommand
  .command('sync-configs')
  .description('Sync contract addresses across config files')
  .option('--network <network>', 'Network to sync', 'base-sepolia')
  .action(async (_options: { network: string }) => {
    logger.error('Sync configs functionality has been removed.');
    logger.info('Update config files manually after deployment.');
    process.exit(1);
  });

// Helper function to run deploy scripts
async function runDeployScript(scriptName: string, network: string, options: Record<string, unknown> = {}) {
  const rootDir = findMonorepoRoot();
  // Check if script is in deploy/ subdirectory or root scripts/
  let scriptPath = join(rootDir, 'scripts/deploy', `${scriptName}.ts`);
  if (!existsSync(scriptPath)) {
    // Also check root scripts/ for backwards compatibility
    scriptPath = join(rootDir, 'scripts', `${scriptName}.ts`);
  }
  
  if (!existsSync(scriptPath)) {
    logger.error(`Deploy script not found: ${scriptName}`);
    return;
  }

  logger.step(`Running deploy script: ${scriptName}`);
  
  const args: string[] = [];
  if (network && network !== 'localnet') {
    if (scriptName === 'jns' || scriptName === 'deploy-dao-full') {
      args.push(`--${network}`);
    } else if (scriptName === 'rollback-deployment') {
      args.push(`--network=${network}`);
    } else {
      args.push('--network', network);
    }
  }

  // Add other options as CLI args
  for (const [key, value] of Object.entries(options)) {
    if (key === 'network') continue; // Already handled
    if (value === true) {
      args.push(`--${key}`);
    } else if (value !== false && value !== undefined && value !== null) {
      if (key === 'backup') {
        args.push(`--backup=${value}`);
      } else if (key === 'app') {
        args.push(String(value));
      } else {
        args.push(`--${key}`, String(value));
      }
    }
  }

  await execa('bun', ['run', scriptPath, ...args], {
    cwd: rootDir,
    stdio: 'inherit',
  });
}
