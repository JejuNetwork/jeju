#!/usr/bin/env bun
/**
 * Network Node Daemon - CLI mode for headless operation
 * 
 * Complete CLI for configuring and running a network node on headless servers
 * 
 * Usage:
 *   jeju-node init                    # Interactive setup wizard
 *   jeju-node config                  # View/edit configuration
 *   jeju-node start                   # Start the daemon
 *   jeju-node status                  # Show current status
 *   jeju-node wallet                  # Wallet management
 *   jeju-node register                # Register for services
 */

import { parseArgs } from 'util';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { createInterface } from 'readline';
import chalk from 'chalk';
import { createNodeClient, getContractAddresses } from '../lib/contracts';
import { createNodeServices } from '../lib/services';
import { detectHardware, getComputeCapabilities, meetsRequirements, NON_TEE_WARNING } from '../lib/hardware';
import type { HardwareInfo, ServiceRequirements } from '../lib/hardware';
import { formatEther, parseEther } from 'viem';

// ============================================================================
// Types
// ============================================================================

export interface DaemonConfig {
  version: string;
  network: 'mainnet' | 'testnet' | 'localnet';
  rpcUrl: string;
  chainId: number;
  privateKey: string;
  walletAddress: string;
  services: {
    compute: boolean;
    storage: boolean;
    oracle: boolean;
    proxy: boolean;
    cron: boolean;
    rpc: boolean;
    xlp: boolean;
    solver: boolean;
    sequencer: boolean;
  };
  computeConfig: {
    type: 'cpu' | 'gpu' | 'both';
    cpuCores: number;
    gpuIds: number[];
    useDocker: boolean;
    pricePerHour: string;
    acceptNonTee: boolean;
  };
  bots: {
    dex_arb: boolean;
    cross_chain_arb: boolean;
    sandwich: boolean;
    liquidation: boolean;
    oracle_keeper: boolean;
    solver: boolean;
  };
  botConfig: {
    capitalAllocation: string;
    maxGasGwei: number;
    minProfitBps: number;
  };
  autoClaim: boolean;
  autoStake: boolean;
  autoClaimThreshold: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

const DEFAULT_CONFIG: DaemonConfig = {
  version: '1.0.0',
  network: 'localnet',
  rpcUrl: 'http://127.0.0.1:8545',
  chainId: 1337,
  privateKey: '',
  walletAddress: '',
  services: {
    compute: false,
    storage: false,
    oracle: false,
    proxy: false,
    cron: true, // Free to run
    rpc: false,
    xlp: false,
    solver: false,
    sequencer: false,
  },
  computeConfig: {
    type: 'cpu',
    cpuCores: 4,
    gpuIds: [],
    useDocker: true,
    pricePerHour: '0.01',
    acceptNonTee: false,
  },
  bots: {
    dex_arb: false,
    cross_chain_arb: false,
    sandwich: false,
    liquidation: false,
    oracle_keeper: false,
    solver: false,
  },
  botConfig: {
    capitalAllocation: '1.0',
    maxGasGwei: 50,
    minProfitBps: 50,
  },
  autoClaim: true,
  autoStake: false,
  autoClaimThreshold: '0.1',
  logLevel: 'info',
};

const SERVICE_REQUIREMENTS: Record<string, ServiceRequirements> = {
  compute: {
    minCpuCores: 2,
    minMemoryMb: 4 * 1024,
    minStorageGb: 50,
    requiresGpu: false,
    requiresTee: false,
  },
  compute_gpu: {
    minCpuCores: 4,
    minMemoryMb: 8 * 1024,
    minStorageGb: 100,
    requiresGpu: true,
    minGpuMemoryMb: 8000,
    requiresTee: false,
  },
  storage: {
    minCpuCores: 4,
    minMemoryMb: 8 * 1024,
    minStorageGb: 500,
    requiresGpu: false,
    requiresTee: false,
  },
  oracle: {
    minCpuCores: 2,
    minMemoryMb: 4 * 1024,
    minStorageGb: 50,
    requiresGpu: false,
    requiresTee: false,
  },
  proxy: {
    minCpuCores: 2,
    minMemoryMb: 2 * 1024,
    minStorageGb: 20,
    requiresGpu: false,
    requiresTee: false,
  },
  cron: {
    minCpuCores: 1,
    minMemoryMb: 1 * 1024,
    minStorageGb: 10,
    requiresGpu: false,
    requiresTee: false,
  },
  rpc: {
    minCpuCores: 8,
    minMemoryMb: 16 * 1024,
    minStorageGb: 500,
    requiresGpu: false,
    requiresTee: false,
  },
  sequencer: {
    minCpuCores: 8,
    minMemoryMb: 32 * 1024,
    minStorageGb: 2000,
    requiresGpu: false,
    requiresTee: false,
  },
};

// ============================================================================
// Utilities
// ============================================================================

function getConfigDir(): string {
  return join(homedir(), '.jeju-node');
}

function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

function loadConfig(customPath?: string): DaemonConfig {
  const configPath = customPath || getConfigPath();
  
  if (existsSync(configPath)) {
    const content = readFileSync(configPath, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
  }
  
  return DEFAULT_CONFIG;
}

export function saveConfig(config: DaemonConfig, customPath?: string): void {
  const configPath = customPath || getConfigPath();
  const configDir = dirname(configPath);
  
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function log(level: string, message: string): void {
  const timestamp = new Date().toISOString();
  const colors: Record<string, (s: string) => string> = {
    debug: chalk.gray,
    info: chalk.blue,
    warn: chalk.yellow,
    error: chalk.red,
    success: chalk.green,
  };
  
  const colorFn = colors[level] || chalk.white;
  console.log(`${chalk.dim(timestamp)} ${colorFn(`[${level.toUpperCase()}]`)} ${message}`);
}

async function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  return new Promise((resolve) => {
    const promptText = defaultValue 
      ? `${question} [${chalk.dim(defaultValue)}]: `
      : `${question}: `;
    
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

async function promptYesNo(question: string, defaultValue = true): Promise<boolean> {
  const suffix = defaultValue ? '[Y/n]' : '[y/N]';
  const answer = await prompt(`${question} ${suffix}`);
  
  if (!answer) return defaultValue;
  return answer.toLowerCase().startsWith('y');
}

function printBanner() {
  console.log(chalk.cyan(`
     ██╗███████╗     ██╗██╗   ██╗
     ██║██╔════╝     ██║██║   ██║
     ██║█████╗       ██║██║   ██║
██   ██║██╔══╝  ██   ██║██║   ██║
╚█████╔╝███████╗╚█████╔╝╚██████╔╝
 ╚════╝ ╚══════╝ ╚════╝  ╚═════╝ 
`));
  console.log(chalk.dim('  Network Node - Headless Mode\n'));
}

// ============================================================================
// Commands
// ============================================================================

async function cmdInit(): Promise<void> {
  console.log(chalk.bold('\n  Network Node Setup Wizard\n'));
  console.log('  This will configure your node for headless operation.\n');
  
  const config = loadConfig();
  const hardware = detectHardware();
  const capabilities = getComputeCapabilities(hardware);
  
  // Show detected hardware
  console.log(chalk.bold('  Detected Hardware:'));
  console.log(`    CPU: ${hardware.cpu.coresPhysical} cores (${hardware.cpu.name})`);
  console.log(`    RAM: ${(hardware.memory.totalMb / 1024).toFixed(1)} GB`);
  console.log(`    GPU: ${hardware.gpus.length > 0 ? hardware.gpus.map(g => g.name).join(', ') : 'None'}`);
  console.log(`    TEE: ${hardware.tee.attestationAvailable ? 'Available' : 'Not available'}`);
  console.log(`    Docker: ${hardware.docker.available ? `${hardware.docker.version}` : 'Not installed'}`);
  console.log();
  
  // Network selection
  console.log(chalk.bold('  1. Network Selection\n'));
  const networkChoice = await prompt('  Select network (mainnet/testnet/localnet)', 'localnet');
  config.network = networkChoice as 'mainnet' | 'testnet' | 'localnet';
  
  switch (config.network) {
    case 'mainnet':
      config.rpcUrl = 'https://rpc.jeju.network';
      config.chainId = 420690;
      break;
    case 'testnet':
      config.rpcUrl = 'https://testnet-rpc.jeju.network';
      config.chainId = 420691;
      break;
    case 'localnet':
      config.rpcUrl = 'http://127.0.0.1:8545';
      config.chainId = 1337;
      break;
  }
  
  const customRpc = await prompt('  Custom RPC URL (leave empty for default)', config.rpcUrl);
  if (customRpc) config.rpcUrl = customRpc;
  
  // Wallet setup
  console.log(chalk.bold('\n  2. Wallet Configuration\n'));
  
  const hasKey = await promptYesNo('  Do you have a private key to use?', !!config.privateKey);
  if (hasKey) {
    const key = await prompt('  Enter private key (0x...)', config.privateKey || '');
    if (key) {
      config.privateKey = key.startsWith('0x') ? key : `0x${key}`;
      // Derive address
      try {
        const client = createNodeClient(config.rpcUrl, config.chainId, config.privateKey);
        config.walletAddress = client.walletClient?.account?.address || '';
        console.log(chalk.green(`    ✓ Wallet address: ${config.walletAddress}`));
      } catch {
        console.log(chalk.yellow('    ⚠ Could not derive address from key'));
      }
    }
  } else {
    console.log('  You can set JEJU_PRIVATE_KEY environment variable later.');
    console.log('  Generate a new key with: openssl rand -hex 32');
  }
  
  // Service selection
  console.log(chalk.bold('\n  3. Service Configuration\n'));
  console.log('  Select services to run (based on your hardware):\n');
  
  // Compute
  if (capabilities.cpuCompute.available || capabilities.gpuCompute.available) {
    config.services.compute = await promptYesNo('  Enable Compute Provider (CPU/GPU inference)?');
    
    if (config.services.compute) {
      if (capabilities.gpuCompute.available) {
        const useGpu = await promptYesNo('    Include GPU compute?', true);
        config.computeConfig.type = useGpu ? (capabilities.cpuCompute.available ? 'both' : 'gpu') : 'cpu';
        
        if (useGpu) {
          config.computeConfig.gpuIds = hardware.gpus.map((_, i) => i);
        }
      } else {
        config.computeConfig.type = 'cpu';
      }
      
      // TEE warning
      const isNonTee = !capabilities.cpuCompute.teeAvailable && !capabilities.gpuCompute.teeAvailable;
      if (isNonTee) {
        console.log(chalk.yellow('\n' + NON_TEE_WARNING + '\n'));
        config.computeConfig.acceptNonTee = await promptYesNo('    Accept non-confidential compute mode?', false);
        if (!config.computeConfig.acceptNonTee) {
          console.log(chalk.yellow('    Compute service disabled due to TEE requirement.'));
          config.services.compute = false;
        }
      }
      
      if (config.services.compute) {
        config.computeConfig.cpuCores = parseInt(
          await prompt('    CPU cores to allocate', String(Math.floor(hardware.cpu.coresPhysical / 2)))
        );
        config.computeConfig.pricePerHour = await prompt('    Price per hour (ETH)', '0.01');
      }
    }
  } else {
    console.log(chalk.dim('  Compute: Not available (insufficient hardware)'));
  }
  
  // Oracle
  const oracleReq = meetsRequirements(hardware, SERVICE_REQUIREMENTS.oracle);
  if (oracleReq.meets) {
    config.services.oracle = await promptYesNo('  Enable Oracle Provider (price feeds)?');
  } else {
    console.log(chalk.dim(`  Oracle: Not available (${oracleReq.issues.join(', ')})`));
  }
  
  // Storage
  const storageReq = meetsRequirements(hardware, SERVICE_REQUIREMENTS.storage);
  if (storageReq.meets) {
    config.services.storage = await promptYesNo('  Enable Storage Provider (decentralized storage)?');
  } else {
    console.log(chalk.dim(`  Storage: Not available (${storageReq.issues.join(', ')})`));
  }
  
  // Proxy
  const proxyReq = meetsRequirements(hardware, SERVICE_REQUIREMENTS.proxy);
  if (proxyReq.meets) {
    config.services.proxy = await promptYesNo('  Enable Proxy Provider (residential bandwidth)?');
  }
  
  // Cron (always available)
  config.services.cron = await promptYesNo('  Enable Cron Executor (scheduled tasks)?', true);
  
  // RPC
  const rpcReq = meetsRequirements(hardware, SERVICE_REQUIREMENTS.rpc);
  if (rpcReq.meets) {
    config.services.rpc = await promptYesNo('  Enable RPC Node (decentralized RPC)?');
  }
  
  // Bots
  console.log(chalk.bold('\n  4. Bot Configuration\n'));
  const enableBots = await promptYesNo('  Enable trading bots (50% profit share with treasury)?');
  
  if (enableBots) {
    config.bots.dex_arb = await promptYesNo('    DEX Arbitrage?', true);
    config.bots.cross_chain_arb = await promptYesNo('    Cross-chain Arbitrage?');
    config.bots.liquidation = await promptYesNo('    Liquidation Bot?');
    config.bots.oracle_keeper = await promptYesNo('    Oracle Keeper?');
    
    const enableSandwich = await promptYesNo('    Sandwich Bot (controversial)?', false);
    config.bots.sandwich = enableSandwich;
    
    if (Object.values(config.bots).some(v => v)) {
      config.botConfig.capitalAllocation = await prompt('    Capital allocation (ETH)', '1.0');
      config.botConfig.maxGasGwei = parseInt(await prompt('    Max gas (gwei)', '50'));
      config.botConfig.minProfitBps = parseInt(await prompt('    Min profit (bps)', '50'));
    }
  }
  
  // Earnings
  console.log(chalk.bold('\n  5. Earnings Configuration\n'));
  config.autoClaim = await promptYesNo('  Auto-claim rewards?', true);
  if (config.autoClaim) {
    config.autoClaimThreshold = await prompt('    Claim threshold (ETH)', '0.1');
  }
  config.autoStake = await promptYesNo('  Auto-stake earnings?', false);
  
  // Save config
  saveConfig(config);
  console.log(chalk.green(`\n  ✓ Configuration saved to ${getConfigPath()}`));
  
  // Show summary
  console.log(chalk.bold('\n  Configuration Summary:\n'));
  console.log(`    Network: ${config.network} (${config.rpcUrl})`);
  console.log(`    Wallet: ${config.walletAddress || 'Not configured'}`);
  console.log(`    Services: ${Object.entries(config.services).filter(([_, v]) => v).map(([k]) => k).join(', ') || 'None'}`);
  console.log(`    Bots: ${Object.entries(config.bots).filter(([_, v]) => v).map(([k]) => k).join(', ') || 'None'}`);
  console.log(`    Auto-claim: ${config.autoClaim ? `Yes (threshold: ${config.autoClaimThreshold} ETH)` : 'No'}`);
  
  console.log(chalk.bold('\n  Next Steps:\n'));
  console.log('    1. Start the daemon: bun run daemon start');
  console.log('    2. Check status: bun run daemon status');
  console.log('    3. View logs: tail -f ~/.jeju-node/daemon.log\n');
}

async function cmdConfig(args: string[]): Promise<void> {
  const config = loadConfig();
  
  if (args.length === 0) {
    // Show current config
    console.log(chalk.bold('\n  Current Configuration:\n'));
    console.log(JSON.stringify(config, null, 2));
    console.log(`\n  Config file: ${getConfigPath()}\n`);
    return;
  }
  
  const [action, key, value] = args;
  
  if (action === 'set' && key && value) {
    // Set a config value
    const keys = key.split('.');
    let obj: Record<string, unknown> = config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      obj = obj[keys[i]] as Record<string, unknown>;
    }
    
    const finalKey = keys[keys.length - 1];
    
    // Parse value
    if (value === 'true') obj[finalKey] = true;
    else if (value === 'false') obj[finalKey] = false;
    else if (!isNaN(Number(value))) obj[finalKey] = Number(value);
    else obj[finalKey] = value;
    
    saveConfig(config);
    console.log(chalk.green(`✓ Set ${key} = ${value}`));
  } else if (action === 'get' && key) {
    // Get a config value
    const keys = key.split('.');
    let obj: unknown = config;
    
    for (const k of keys) {
      obj = (obj as Record<string, unknown>)[k];
    }
    
    console.log(obj);
  } else {
    console.log(`
Usage:
  bun run daemon config                    # Show all config
  bun run daemon config get <key>          # Get a value
  bun run daemon config set <key> <value>  # Set a value

Examples:
  bun run daemon config set network testnet
  bun run daemon config set services.compute true
  bun run daemon config set computeConfig.cpuCores 8
`);
  }
}

async function cmdStatus(): Promise<void> {
  const config = loadConfig();
  const hardware = detectHardware();
  const capabilities = getComputeCapabilities(hardware);
  
  console.log(chalk.bold('\n  Network Node Status\n'));
  
  // Network
  console.log(chalk.bold('  Network:'));
  console.log(`    Network: ${config.network}`);
  console.log(`    RPC: ${config.rpcUrl}`);
  console.log(`    Chain ID: ${config.chainId}`);
  
  // Check RPC connection
  try {
    const response = await fetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
    });
    const data = await response.json() as { result?: string };
    if (data.result) {
      console.log(`    Block: ${parseInt(data.result, 16)}`);
      console.log(`    Status: ${chalk.green('Connected')}`);
    }
  } catch {
    console.log(`    Status: ${chalk.red('Disconnected')}`);
  }
  
  // Wallet
  console.log(chalk.bold('\n  Wallet:'));
  if (config.walletAddress) {
    console.log(`    Address: ${config.walletAddress}`);
    
    try {
      const client = createNodeClient(config.rpcUrl, config.chainId, config.privateKey);
      const balance = await client.publicClient.getBalance({ address: config.walletAddress as `0x${string}` });
      console.log(`    Balance: ${formatEther(balance)} ETH`);
    } catch {
      console.log(`    Balance: ${chalk.dim('Unable to fetch')}`);
    }
  } else {
    console.log(`    Status: ${chalk.yellow('Not configured')}`);
  }
  
  // Hardware
  console.log(chalk.bold('\n  Hardware:'));
  console.log(`    CPU: ${hardware.cpu.coresPhysical} cores @ ${hardware.cpu.frequencyMhz} MHz`);
  console.log(`    RAM: ${(hardware.memory.totalMb / 1024).toFixed(1)} GB (${(hardware.memory.availableMb / 1024).toFixed(1)} GB free)`);
  console.log(`    GPU: ${hardware.gpus.length > 0 ? hardware.gpus.map(g => `${g.name} (${g.memoryTotalMb}MB)`).join(', ') : 'None'}`);
  console.log(`    TEE: ${hardware.tee.attestationAvailable ? 'Available' : 'Not available'}`);
  console.log(`    Docker: ${hardware.docker.runtimeAvailable ? `Running (${hardware.docker.version})` : hardware.docker.available ? 'Installed but not running' : 'Not installed'}`);
  
  // Services
  console.log(chalk.bold('\n  Configured Services:'));
  for (const [service, enabled] of Object.entries(config.services)) {
    const status = enabled ? chalk.green('Enabled') : chalk.dim('Disabled');
    const req = SERVICE_REQUIREMENTS[service];
    const meets = req ? meetsRequirements(hardware, req).meets : true;
    const hwStatus = meets ? '' : chalk.yellow(' (hw not met)');
    console.log(`    ${service}: ${status}${hwStatus}`);
  }
  
  // Bots
  console.log(chalk.bold('\n  Configured Bots:'));
  for (const [bot, enabled] of Object.entries(config.bots)) {
    const status = enabled ? chalk.green('Enabled') : chalk.dim('Disabled');
    console.log(`    ${bot}: ${status}`);
  }
  
  // Warnings
  if (capabilities.warnings.length > 0) {
    console.log(chalk.bold('\n  Warnings:'));
    for (const warning of capabilities.warnings) {
      console.log(chalk.yellow(`    ⚠ ${warning}`));
    }
  }
  
  console.log();
}

async function cmdWallet(args: string[]): Promise<void> {
  const config = loadConfig();
  const [action] = args;
  
  if (action === 'generate') {
    // Generate new wallet
    const { privateKeyToAccount } = await import('viem/accounts');
    const privateKey = `0x${[...Array(64)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')}` as `0x${string}`;
    const account = privateKeyToAccount(privateKey);
    
    console.log(chalk.bold('\n  New Wallet Generated:\n'));
    console.log(`    Address: ${account.address}`);
    console.log(`    Private Key: ${privateKey}`);
    console.log(chalk.yellow('\n  ⚠ Save this private key securely! It cannot be recovered.\n'));
    
    const save = await promptYesNo('  Save to config?');
    if (save) {
      config.privateKey = privateKey;
      config.walletAddress = account.address;
      saveConfig(config);
      console.log(chalk.green('  ✓ Wallet saved to config\n'));
    }
  } else if (action === 'import') {
    const key = await prompt('  Enter private key (0x...)');
    if (key) {
      try {
        const { privateKeyToAccount } = await import('viem/accounts');
        const privateKey = key.startsWith('0x') ? key as `0x${string}` : `0x${key}` as `0x${string}`;
        const account = privateKeyToAccount(privateKey);
        
        config.privateKey = privateKey;
        config.walletAddress = account.address;
        saveConfig(config);
        
        console.log(chalk.green(`\n  ✓ Wallet imported: ${account.address}\n`));
      } catch (e) {
        console.log(chalk.red(`\n  ✗ Invalid private key: ${e}\n`));
      }
    }
  } else if (action === 'balance') {
    if (!config.walletAddress) {
      console.log(chalk.yellow('\n  No wallet configured. Run: bun run daemon wallet import\n'));
      return;
    }
    
    try {
      const client = createNodeClient(config.rpcUrl, config.chainId, config.privateKey);
      const balance = await client.publicClient.getBalance({ address: config.walletAddress as `0x${string}` });
      console.log(`\n  Balance: ${formatEther(balance)} ETH\n`);
    } catch (e) {
      console.log(chalk.red(`\n  Error fetching balance: ${e}\n`));
    }
  } else {
    console.log(`
Usage:
  bun run daemon wallet generate   # Generate new wallet
  bun run daemon wallet import     # Import existing wallet
  bun run daemon wallet balance    # Check balance
`);
  }
}

async function cmdRegister(args: string[]): Promise<void> {
  const config = loadConfig();
  const [service] = args;
  
  if (!service) {
    console.log(`
Usage:
  bun run daemon register compute   # Register as compute provider
  bun run daemon register oracle    # Register as oracle provider
  bun run daemon register storage   # Register as storage provider
`);
    return;
  }
  
  if (!config.privateKey) {
    console.log(chalk.red('\n  Error: No wallet configured. Run: bun run daemon wallet import\n'));
    return;
  }
  
  const client = createNodeClient(config.rpcUrl, config.chainId, config.privateKey);
  const services = createNodeServices(client);
  const hardware = detectHardware();
  
  if (service === 'compute') {
    console.log(chalk.bold('\n  Registering as Compute Provider...\n'));
    
    services.compute.setHardware(hardware);
    if (config.computeConfig.acceptNonTee) {
      services.compute.acknowledgeNonTeeRisk();
    }
    
    try {
      const hash = await services.compute.registerService({
        modelId: 'generic-compute',
        endpoint: `http://${config.walletAddress}:8080/compute`,
        pricePerInputToken: parseEther(config.computeConfig.pricePerHour) / 1000000n,
        pricePerOutputToken: parseEther(config.computeConfig.pricePerHour) / 1000000n,
        stakeAmount: parseEther('0.1'),
        computeType: config.computeConfig.type,
        computeMode: config.computeConfig.acceptNonTee ? 'non-tee' : 'tee',
        cpuCores: config.computeConfig.cpuCores,
        gpuIds: config.computeConfig.gpuIds,
        acceptNonTeeRisk: config.computeConfig.acceptNonTee,
      });
      
      console.log(chalk.green(`  ✓ Registered! TX: ${hash}\n`));
    } catch (e) {
      console.log(chalk.red(`  ✗ Registration failed: ${e}\n`));
    }
  } else if (service === 'oracle') {
    console.log(chalk.bold('\n  Registering as Oracle Provider...\n'));
    
    try {
      const hash = await services.oracle.register({
        agentId: 1n,
        stakeAmount: parseEther('1.0'),
        markets: ['ETH/USD', 'BTC/USD', 'JEJU/USD'],
      });
      
      console.log(chalk.green(`  ✓ Registered! TX: ${hash}\n`));
    } catch (e) {
      console.log(chalk.red(`  ✗ Registration failed: ${e}\n`));
    }
  } else if (service === 'storage') {
    console.log(chalk.bold('\n  Registering as Storage Provider...\n'));
    
    try {
      const hash = await services.storage.register({
        endpoint: `http://${config.walletAddress}:9000/storage`,
        capacityGB: 100,
        pricePerGBMonth: parseEther('0.001'),
        stakeAmount: parseEther('0.5'),
      });
      
      console.log(chalk.green(`  ✓ Registered! TX: ${hash}\n`));
    } catch (e) {
      console.log(chalk.red(`  ✗ Registration failed: ${e}\n`));
    }
  } else {
    console.log(`
Usage:
  bun run daemon register compute   # Register as compute provider
  bun run daemon register oracle    # Register as oracle provider
  bun run daemon register storage   # Register as storage provider
`);
  }
}

async function cmdStart(): Promise<void> {
  const config = loadConfig();
  printBanner();
  
  log('info', `Starting daemon on ${config.network}...`);
  
  if (!config.privateKey) {
    log('warn', 'No private key configured. Some services require a wallet.');
    log('info', 'Run: bun run daemon wallet import');
  }
  
  // Detect hardware
  log('info', 'Detecting hardware...');
  const hardware = detectHardware();
  log('info', `CPU: ${hardware.cpu.coresPhysical} cores, RAM: ${(hardware.memory.totalMb / 1024).toFixed(1)} GB`);
  log('info', `GPUs: ${hardware.gpus.length > 0 ? hardware.gpus.map(g => g.name).join(', ') : 'None'}`);
  log('info', `TEE: ${hardware.tee.attestationAvailable ? 'Available' : 'Not available'}`);
  
  // Check RPC connection
  log('info', `Connecting to ${config.rpcUrl}...`);
  
  try {
    const response = await fetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
    });
    const data = await response.json() as { result?: string };
    if (!data.result) throw new Error('No result');
    log('success', 'Connected to network');
  } catch {
    log('error', `Cannot connect to RPC at ${config.rpcUrl}`);
    log('info', 'Make sure the network is running. For localnet, run: bun run jeju dev');
    process.exit(1);
  }
  
  // Create client and services
  const client = createNodeClient(config.rpcUrl, config.chainId, config.privateKey || undefined);
  const services = createNodeServices(client);
  
  // Start enabled services
  const activeServices: string[] = [];
  
  for (const [service, enabled] of Object.entries(config.services)) {
    if (!enabled) continue;
    
    const requirements = SERVICE_REQUIREMENTS[service];
    if (requirements) {
      const result = meetsRequirements(hardware, requirements);
      if (!result.meets) {
        log('warn', `Skipping ${service}: ${result.issues.join(', ')}`);
        continue;
      }
    }
    
    activeServices.push(service);
    log('info', `Starting ${service} service...`);
    
    switch (service) {
      case 'cron':
        startCronExecutor(services.cron, config);
        break;
      case 'oracle':
        if (config.privateKey) {
          startOracleSubmitter(services.oracle, config);
        }
        break;
      default:
        log('debug', `${service} service started`);
    }
  }
  
  // Start enabled bots
  const activeBots: string[] = [];
  
  for (const [bot, enabled] of Object.entries(config.bots)) {
    if (!enabled) continue;
    activeBots.push(bot);
    log('info', `Starting ${bot} bot...`);
  }
  
  if (activeServices.length === 0 && activeBots.length === 0) {
    log('warn', 'No services or bots enabled.');
    log('info', 'Run: bun run daemon init');
    return;
  }
  
  log('success', `Started ${activeServices.length} services and ${activeBots.length} bots`);
  log('info', 'Daemon running. Press Ctrl+C to stop.');
  
  // Graceful shutdown
  let running = true;
  
  process.on('SIGINT', () => {
    log('info', 'Shutting down...');
    running = false;
  });
  
  process.on('SIGTERM', () => {
    log('info', 'Shutting down...');
    running = false;
  });
  
  // Auto-claim loop
  if (config.autoClaim && config.privateKey) {
    setInterval(async () => {
      try {
        // Check pending rewards and claim if above threshold
        log('debug', 'Checking for claimable rewards...');
      } catch (e) {
        log('error', `Auto-claim error: ${e}`);
      }
    }, 60 * 60 * 1000); // Every hour
  }
  
  // Main loop
  while (running) {
    await new Promise(resolve => setTimeout(resolve, 60000));
  }
  
  log('success', 'Daemon stopped.');
}

function startCronExecutor(cronService: ReturnType<typeof createNodeServices>['cron'], _config: DaemonConfig) {
  log('info', 'Cron executor polling every 30 seconds');
  let contractAvailable = true;
  
  const poll = async () => {
    if (!contractAvailable) return; // Skip if contract not deployed
    
    try {
      const triggers = await cronService.getActiveTriggers();
      if (triggers.length > 0) {
        log('debug', `Found ${triggers.length} active triggers`);
      }
    } catch (e) {
      const errorMsg = String(e);
      // Handle contract not deployed gracefully
      if (errorMsg.includes('returned no data') || errorMsg.includes('is not a contract')) {
        if (contractAvailable) {
          log('warn', 'Cron contract not deployed on this network - cron service paused');
          contractAvailable = false;
        }
      } else {
        log('error', `Cron poll error: ${e}`);
      }
    }
  };
  
  poll();
  setInterval(poll, 30000);
}

function startOracleSubmitter(
  oracleService: ReturnType<typeof createNodeServices>['oracle'],
  config: DaemonConfig
) {
  log('info', 'Oracle submitter running every 60 seconds');
  let contractAvailable = true;
  let notifiedNotRegistered = false;
  
  const submit = async () => {
    if (!contractAvailable) return;
    
    try {
      const state = await oracleService.getState(config.walletAddress as `0x${string}`);
      if (!state.isRegistered) {
        if (!notifiedNotRegistered) {
          log('warn', 'Not registered as oracle. Run: bun run daemon register oracle');
          notifiedNotRegistered = true;
        }
        return;
      }
      log('debug', 'Oracle check complete');
    } catch (e) {
      const errorMsg = String(e);
      if (errorMsg.includes('returned no data') || errorMsg.includes('is not a contract')) {
        if (contractAvailable) {
          log('warn', 'Oracle contract not deployed on this network - oracle service paused');
          contractAvailable = false;
        }
      } else {
        log('error', `Oracle error: ${e}`);
      }
    }
  };
  
  submit();
  setInterval(submit, 60000);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      config: { type: 'string', short: 'c' },
      all: { type: 'boolean', short: 'a' },
      minimal: { type: 'boolean', short: 'm' },
      network: { type: 'string', short: 'n' },
      key: { type: 'string', short: 'k' },
      verbose: { type: 'boolean', short: 'v' },
    },
    allowPositionals: true,
  });
  
  const [command, ...args] = positionals;
  
  // Apply overrides from environment
  if (process.env.JEJU_PRIVATE_KEY) {
    const config = loadConfig();
    config.privateKey = process.env.JEJU_PRIVATE_KEY;
    saveConfig(config);
  }
  
  if (values.help || !command) {
    printBanner();
    console.log(`
${chalk.bold('Usage:')}
  bun run daemon <command> [options]

${chalk.bold('Commands:')}
  init              Interactive setup wizard
  start             Start the daemon
  status            Show current status
  config            View/edit configuration
  wallet            Wallet management
  register          Register for services

${chalk.bold('Options:')}
  -h, --help              Show this help message
  -c, --config <path>     Custom config file path
  -a, --all               Enable all services
  -m, --minimal           Only essential services
  -n, --network <network> Network (mainnet, testnet, localnet)
  -k, --key <key>         Private key
  -v, --verbose           Verbose logging

${chalk.bold('Environment Variables:')}
  JEJU_PRIVATE_KEY        Wallet private key
  JEJU_RPC_URL            Custom RPC URL
  JEJU_NETWORK            Network to use

${chalk.bold('Quick Start:')}
  1. bun run daemon init              # Configure your node
  2. bun run daemon wallet generate   # Create a wallet
  3. bun run daemon start             # Start earning

${chalk.bold('Headless Server Setup:')}
  export JEJU_PRIVATE_KEY=0x...
  export JEJU_NETWORK=testnet
  bun run daemon start --all
`);
    return;
  }
  
  switch (command) {
    case 'init':
      await cmdInit();
      break;
    case 'config':
      await cmdConfig(args);
      break;
    case 'status':
      await cmdStatus();
      break;
    case 'wallet':
      await cmdWallet(args);
      break;
    case 'register':
      await cmdRegister(args);
      break;
    case 'start':
      // Apply command line overrides
      if (values.all || values.minimal || values.network || values.key) {
        const config = loadConfig();
        
        if (values.all) {
          config.services = { compute: true, storage: true, oracle: true, proxy: true, cron: true, rpc: true, xlp: true, solver: true, sequencer: false };
          config.bots = { dex_arb: true, cross_chain_arb: true, sandwich: false, liquidation: true, oracle_keeper: true, solver: true };
        }
        
        if (values.minimal) {
          config.services = { compute: false, storage: false, oracle: false, proxy: true, cron: true, rpc: false, xlp: false, solver: false, sequencer: false };
          config.bots = { dex_arb: false, cross_chain_arb: false, sandwich: false, liquidation: false, oracle_keeper: false, solver: false };
        }
        
        if (values.network) {
          config.network = values.network as 'mainnet' | 'testnet' | 'localnet';
          switch (config.network) {
            case 'mainnet': config.rpcUrl = 'https://rpc.jeju.network'; config.chainId = 420690; break;
            case 'testnet': config.rpcUrl = 'https://testnet-rpc.jeju.network'; config.chainId = 420691; break;
            case 'localnet': config.rpcUrl = 'http://127.0.0.1:8545'; config.chainId = 1337; break;
          }
        }
        
        if (values.key) {
          config.privateKey = values.key;
        }
        
        saveConfig(config);
      }
      
      await cmdStart();
      break;
    default:
      console.log(chalk.red(`Unknown command: ${command}`));
      console.log('Run: bun run daemon --help');
  }
}

// Only run main() when this file is executed directly
if (import.meta.main) {
  main().catch((error) => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
  });
}
