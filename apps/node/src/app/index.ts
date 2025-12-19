#!/usr/bin/env bun
/**
 * Network Node App - Headless CLI
 * 
 * Simple commands:
 *   node start          # Start earning
 *   node stop           # Stop the node
 *   node status         # Check status
 *   node setup          # Configure wallet & services
 *   node earnings       # View earnings
 */

import { parseArgs } from 'util';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { createInterface } from 'readline';
import chalk from 'chalk';
import { createNodeClient } from '../lib/contracts';
import { createNodeServices } from '../lib/services';
import { detectHardware, meetsRequirements } from '../lib/hardware';
import type { ServiceRequirements } from '../lib/hardware';
import { formatEther } from 'viem';

// ============================================================================
// Types
// ============================================================================

export interface AppConfig {
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
  compute: {
    type: 'cpu' | 'gpu' | 'both';
    cpuCores: number;
    gpuIds: number[];
    pricePerHour: string;
    acceptNonTee: boolean;
  };
  bots: {
    enabled: boolean;
    dexArb: boolean;
    crossChainArb: boolean;
    liquidation: boolean;
  };
  autoClaim: boolean;
  autoStake: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

const DEFAULT_CONFIG: AppConfig = {
  version: '1.0.0',
  network: 'testnet',
  rpcUrl: 'https://testnet-rpc.jejunetwork.org',
  chainId: 420691,
  privateKey: '',
  walletAddress: '',
  services: {
    compute: true,
    storage: false,
    oracle: false,
    proxy: true,
    cron: true,
    rpc: false,
    xlp: false,
    solver: false,
    sequencer: false,
  },
  compute: {
    type: 'cpu',
    cpuCores: 4,
    gpuIds: [],
    pricePerHour: '0.01',
    acceptNonTee: true,
  },
  bots: {
    enabled: false,
    dexArb: false,
    crossChainArb: false,
    liquidation: false,
  },
  autoClaim: true,
  autoStake: false,
  logLevel: 'info',
};

const SERVICE_REQUIREMENTS: Record<string, ServiceRequirements> = {
  compute: { minCpuCores: 2, minMemoryMb: 4096, minStorageGb: 50, requiresGpu: false, requiresTee: false },
  storage: { minCpuCores: 4, minMemoryMb: 8192, minStorageGb: 500, requiresGpu: false, requiresTee: false },
  oracle: { minCpuCores: 2, minMemoryMb: 4096, minStorageGb: 50, requiresGpu: false, requiresTee: false },
  proxy: { minCpuCores: 2, minMemoryMb: 2048, minStorageGb: 20, requiresGpu: false, requiresTee: false },
  cron: { minCpuCores: 1, minMemoryMb: 1024, minStorageGb: 10, requiresGpu: false, requiresTee: false },
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

function loadConfig(): AppConfig {
  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(configPath, 'utf-8')) };
  }
  return DEFAULT_CONFIG;
}

export function saveConfig(config: AppConfig): void {
  const configPath = getConfigPath();
  const configDir = dirname(configPath);
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function log(level: string, message: string): void {
  const timestamp = new Date().toISOString().slice(11, 19);
  const colors: Record<string, (s: string) => string> = {
    debug: chalk.gray,
    info: chalk.blue,
    warn: chalk.yellow,
    error: chalk.red,
    success: chalk.green,
  };
  console.log(`${chalk.dim(timestamp)} ${colors[level]?.(`[${level.toUpperCase()}]`) || ''} ${message}`);
}

async function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const text = defaultValue ? `${question} [${chalk.dim(defaultValue)}]: ` : `${question}: `;
    rl.question(text, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

async function promptYesNo(question: string, defaultValue = true): Promise<boolean> {
  const answer = await prompt(`${question} ${defaultValue ? '[Y/n]' : '[y/N]'}`);
  if (!answer) return defaultValue;
  return answer.toLowerCase().startsWith('y');
}

function printBanner() {
  console.log(chalk.cyan(`
   ╦╔═╗ ╦╦ ╦  ╔╗╔╔═╗╔╦╗╔═╗
   ║║╣  ║║ ║  ║║║║ ║ ║║║╣ 
  ╚╝╚═╝╚╝╚═╝  ╝╚╝╚═╝═╩╝╚═╝
`));
  console.log(chalk.dim('  Run infrastructure. Earn rewards.\n'));
}

// ============================================================================
// Commands
// ============================================================================

async function cmdSetup(): Promise<void> {
  console.log(chalk.bold('\n  Quick Setup\n'));
  
  const config = loadConfig();
  const hardware = detectHardware();
  
  // Show hardware
  console.log(`  ${chalk.bold('Your Machine:')}`);
  console.log(`    CPU: ${hardware.cpu.coresPhysical} cores`);
  console.log(`    RAM: ${(hardware.memory.totalMb / 1024).toFixed(0)} GB`);
  console.log(`    GPU: ${hardware.gpus.length > 0 ? hardware.gpus[0].name : 'None'}`);
  console.log(`    Docker: ${hardware.docker.runtimeAvailable ? 'Ready' : 'Not running'}\n`);
  
  // Network
  const network = await prompt('  Network (testnet/mainnet)', config.network);
  config.network = network as 'testnet' | 'mainnet';
  config.rpcUrl = config.network === 'mainnet' 
    ? 'https://rpc.jejunetwork.org' 
    : 'https://testnet-rpc.jejunetwork.org';
  config.chainId = config.network === 'mainnet' ? 420690 : 420691;
  
  // Wallet
  if (!config.privateKey) {
    console.log(chalk.bold('\n  Wallet Setup'));
    const hasKey = await promptYesNo('  Do you have a private key?', false);
    if (hasKey) {
      const key = await prompt('  Enter private key (0x...)');
      if (key) {
        config.privateKey = key.startsWith('0x') ? key : `0x${key}`;
        try {
          const { privateKeyToAccount } = await import('viem/accounts');
          config.walletAddress = privateKeyToAccount(config.privateKey as `0x${string}`).address;
          console.log(chalk.green(`    ✓ Wallet: ${config.walletAddress}`));
        } catch {
          console.log(chalk.yellow('    ⚠ Invalid key'));
        }
      }
    } else {
      console.log('    Set JEJU_PRIVATE_KEY env var or run setup again later.\n');
    }
  }
  
  // Services
  console.log(chalk.bold('\n  Services (what do you want to earn from?)'));
  config.services.compute = await promptYesNo('    Compute (share CPU/GPU)', true);
  config.services.proxy = await promptYesNo('    Proxy (share bandwidth)', true);
  config.services.storage = await promptYesNo('    Storage (share disk)', false);
  
  // Bots
  console.log(chalk.bold('\n  Trading Bots (optional, 50/50 profit split)'));
  config.bots.enabled = await promptYesNo('    Enable trading bots?', false);
  
  saveConfig(config);
  console.log(chalk.green(`\n  ✓ Saved to ${getConfigPath()}`));
  console.log(chalk.bold('\n  Next: Run `jeju-node start` to begin earning\n'));
}

async function cmdStatus(): Promise<void> {
  const config = loadConfig();
  const hardware = detectHardware();
  
  console.log(chalk.bold('\n  Node Status\n'));
  
  // Connection
  let connected = false;
  let blockNum = 0;
  try {
    const res = await fetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
    });
    const data = await res.json() as { result?: string };
    if (data.result) {
      connected = true;
      blockNum = parseInt(data.result, 16);
    }
  } catch { /* ignore */ }
  
  console.log(`  ${chalk.bold('Network')}`);
  console.log(`    ${config.network} ${connected ? chalk.green('● Connected') : chalk.red('● Disconnected')}`);
  if (connected) console.log(`    Block ${blockNum.toLocaleString()}`);
  
  // Wallet
  console.log(`\n  ${chalk.bold('Wallet')}`);
  if (config.walletAddress) {
    console.log(`    ${config.walletAddress.slice(0, 10)}...${config.walletAddress.slice(-8)}`);
    if (connected) {
      try {
        const client = createNodeClient(config.rpcUrl, config.chainId, config.privateKey);
        const balance = await client.publicClient.getBalance({ address: config.walletAddress as `0x${string}` });
        console.log(`    Balance: ${formatEther(balance)} ETH`);
      } catch { /* ignore */ }
    }
  } else {
    console.log(chalk.yellow('    Not configured - run `jeju-node setup`'));
  }
  
  // Hardware
  console.log(`\n  ${chalk.bold('Hardware')}`);
  console.log(`    CPU: ${hardware.cpu.coresPhysical} cores`);
  console.log(`    RAM: ${(hardware.memory.totalMb / 1024).toFixed(1)} GB`);
  console.log(`    GPU: ${hardware.gpus.length > 0 ? hardware.gpus[0].name : 'None'}`);
  console.log(`    TEE: ${hardware.tee.attestationAvailable ? 'Available' : 'Not available'}`);
  
  // Services
  console.log(`\n  ${chalk.bold('Services')}`);
  const enabledServices = Object.entries(config.services).filter(([_, v]) => v).map(([k]) => k);
  console.log(`    ${enabledServices.length > 0 ? enabledServices.join(', ') : 'None enabled'}`);
  
  console.log();
}

async function cmdStart(): Promise<void> {
  const config = loadConfig();
  
  printBanner();
  
  if (!config.privateKey && !process.env.JEJU_PRIVATE_KEY) {
    console.log(chalk.yellow('  No wallet configured.'));
    console.log('  Run `jeju-node setup` or set JEJU_PRIVATE_KEY\n');
    return;
  }
  
  // Use env var if available
  if (process.env.JEJU_PRIVATE_KEY) {
    config.privateKey = process.env.JEJU_PRIVATE_KEY;
  }
  
  log('info', `Starting on ${config.network}...`);
  
  // Detect hardware
  const hardware = detectHardware();
  log('info', `Hardware: ${hardware.cpu.coresPhysical} CPU cores, ${(hardware.memory.totalMb / 1024).toFixed(0)}GB RAM`);
  if (hardware.gpus.length > 0) {
    log('info', `GPU: ${hardware.gpus[0].name}`);
  }
  
  // Check RPC
  try {
    const res = await fetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
    });
    const data = await res.json() as { result?: string };
    if (!data.result) throw new Error('No response');
    log('success', 'Connected to network');
  } catch {
    log('error', `Cannot connect to ${config.rpcUrl}`);
    process.exit(1);
  }
  
  // Create services
  const client = createNodeClient(config.rpcUrl, config.chainId, config.privateKey);
  const services = createNodeServices(client);
  
  // Start enabled services
  const started: string[] = [];
  
  for (const [name, enabled] of Object.entries(config.services)) {
    if (!enabled) continue;
    
    const req = SERVICE_REQUIREMENTS[name];
    if (req) {
      const check = meetsRequirements(hardware, req);
      if (!check.meets) {
        log('warn', `Skipping ${name}: ${check.issues[0]}`);
        continue;
      }
    }
    
    started.push(name);
    log('info', `Starting ${name}...`);
    
    // Start service polling
    if (name === 'cron') {
      startCronService(services.cron);
    }
  }
  
  log('success', `Running ${started.length} services: ${started.join(', ')}`);
  log('info', 'Press Ctrl+C to stop');
  
  // Keep running
  let running = true;
  process.on('SIGINT', () => { running = false; });
  process.on('SIGTERM', () => { running = false; });
  
  while (running) {
    await new Promise(r => setTimeout(r, 60000));
  }
  
  log('success', 'Stopped');
}

function startCronService(cronService: ReturnType<typeof createNodeServices>['cron']) {
  let available = true;
  
  const poll = async () => {
    if (!available) return;
    try {
      const triggers = await cronService.getActiveTriggers();
      if (triggers.length > 0) {
        log('debug', `${triggers.length} cron triggers active`);
      }
    } catch (e) {
      if (String(e).includes('returned no data')) {
        log('warn', 'Cron contract not deployed - service paused');
        available = false;
      }
    }
  };
  
  poll();
  setInterval(poll, 30000);
}

async function cmdEarnings(): Promise<void> {
  const config = loadConfig();
  
  console.log(chalk.bold('\n  Earnings Summary\n'));
  
  if (!config.walletAddress) {
    console.log(chalk.yellow('  No wallet configured. Run `jeju-node setup`\n'));
    return;
  }
  
  console.log(`  ${chalk.dim('Coming soon: earnings tracking and history')}\n`);
}

async function cmdConfig(args: string[]): Promise<void> {
  const config = loadConfig();
  const [action, key, value] = args;
  
  if (!action || action === 'show') {
    console.log(chalk.bold('\n  Current Config\n'));
    console.log(`  Network: ${config.network}`);
    console.log(`  Wallet: ${config.walletAddress || 'Not set'}`);
    console.log(`  Services: ${Object.entries(config.services).filter(([_, v]) => v).map(([k]) => k).join(', ')}`);
    console.log(`  Config: ${getConfigPath()}\n`);
    return;
  }
  
  if (action === 'set' && key && value) {
    const keys = key.split('.');
    let obj: Record<string, unknown> = config as unknown as Record<string, unknown>;
    for (let i = 0; i < keys.length - 1; i++) {
      obj = obj[keys[i]] as Record<string, unknown>;
    }
    const finalKey = keys[keys.length - 1];
    if (value === 'true') obj[finalKey] = true;
    else if (value === 'false') obj[finalKey] = false;
    else if (!isNaN(Number(value))) obj[finalKey] = Number(value);
    else obj[finalKey] = value;
    saveConfig(config);
    console.log(chalk.green(`✓ Set ${key} = ${value}`));
  } else if (action === 'get' && key) {
    const keys = key.split('.');
    let obj: unknown = config;
    for (const k of keys) {
      obj = (obj as Record<string, unknown>)[k];
    }
    console.log(obj);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      all: { type: 'boolean', short: 'a' },
      network: { type: 'string', short: 'n' },
      key: { type: 'string', short: 'k' },
    },
    allowPositionals: true,
  });
  
  const [command, ...args] = positionals;
  
  // Apply env overrides
  if (process.env.JEJU_NETWORK) {
    const config = loadConfig();
    config.network = process.env.JEJU_NETWORK as 'testnet' | 'mainnet';
    saveConfig(config);
  }
  
  if (values.help || !command) {
    printBanner();
    console.log(`${chalk.bold('Commands:')}
  start       Start earning (runs in foreground)
  stop        Stop the node
  status      Check node status
  setup       Configure wallet and services
  earnings    View earnings summary
  config      View/edit config

${chalk.bold('Options:')}
  -h, --help      Show help
  -v, --version   Show version
  -n, --network   Set network (testnet/mainnet)
  -k, --key       Set private key

${chalk.bold('Environment:')}
  JEJU_PRIVATE_KEY   Wallet private key
  JEJU_NETWORK       Network to use

${chalk.bold('Quick Start:')}
  1. jeju-node setup     # Configure your node
  2. jeju-node start     # Start earning
`);
    return;
  }
  
  if (values.version) {
    console.log('jeju-node v0.1.0');
    return;
  }
  
  // Apply flags
  if (values.network) {
    const config = loadConfig();
    config.network = values.network as 'testnet' | 'mainnet';
    config.rpcUrl = config.network === 'mainnet' ? 'https://rpc.jejunetwork.org' : 'https://testnet-rpc.jejunetwork.org';
    config.chainId = config.network === 'mainnet' ? 420690 : 420691;
    saveConfig(config);
  }
  
  if (values.key) {
    const config = loadConfig();
    config.privateKey = values.key;
    try {
      const { privateKeyToAccount } = await import('viem/accounts');
      config.walletAddress = privateKeyToAccount(config.privateKey as `0x${string}`).address;
    } catch { /* ignore */ }
    saveConfig(config);
  }
  
  if (values.all) {
    const config = loadConfig();
    config.services = {
      compute: true, storage: true, oracle: true, proxy: true,
      cron: true, rpc: true, xlp: true, solver: true, sequencer: false,
    };
    saveConfig(config);
  }
  
  switch (command) {
    case 'start':
      await cmdStart();
      break;
    case 'stop':
      console.log(chalk.yellow('\n  Use Ctrl+C to stop a running node\n'));
      break;
    case 'status':
      await cmdStatus();
      break;
    case 'setup':
    case 'init':
      await cmdSetup();
      break;
    case 'earnings':
      await cmdEarnings();
      break;
    case 'config':
      await cmdConfig(args);
      break;
    default:
      console.log(chalk.red(`Unknown command: ${command}`));
      console.log('Run `jeju-node --help` for usage');
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(chalk.red('Error:'), err.message);
    process.exit(1);
  });
}
