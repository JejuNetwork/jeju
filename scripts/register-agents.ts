#!/usr/bin/env bun
/**
 * @title Register Jeju Apps as ERC-8004 Agents
 * @notice Registers all Jeju apps with proper A2A endpoints on the IdentityRegistry
 * 
 * Usage:
 *   bun scripts/register-agents.ts --network localnet --list
 *   bun scripts/register-agents.ts --network testnet --register --app bazaar
 *   bun scripts/register-agents.ts --network localnet --register-all
 */

import { resolve } from 'path';
import { readdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { Logger } from './shared/logger';
import { 
  loadJejuManifest, 
  registerApp, 
  getAgentInfo,
  createConfigFromEnv,
  getNetworkConfig,
  type JejuManifest,
  type Agent0Config
} from './shared/agent0';

const logger = new Logger({ prefix: 'register-agents' });

// ============ Types ============

interface AppInfo {
  name: string;
  path: string;
  manifest: JejuManifest;
  agentEnabled: boolean;
  a2aEndpoint?: string;
  port?: number;
}

interface RegistrationState {
  [appName: string]: {
    agentId: string;
    registeredAt: string;
    network: string;
    txHash: string;
  };
}

// ============ Constants ============

const APPS_DIR = resolve(__dirname, '../apps');
const VENDOR_DIR = resolve(__dirname, '../vendor');
const REGISTRATION_STATE_FILE = resolve(__dirname, '../.agent-registrations.json');

// ============ Helper Functions ============

function discoverApps(): AppInfo[] {
  const apps: AppInfo[] = [];
  
  // Discover apps in /apps directory
  if (existsSync(APPS_DIR)) {
    const appDirs = readdirSync(APPS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    
    for (const appDir of appDirs) {
      const appPath = resolve(APPS_DIR, appDir);
      const manifestPath = resolve(appPath, 'jeju-manifest.json');
      
      if (existsSync(manifestPath)) {
        try {
          const manifest = loadJejuManifest(appPath);
          apps.push({
            name: manifest.name || appDir,
            path: appPath,
            manifest,
            agentEnabled: manifest.agent?.enabled || false,
            a2aEndpoint: manifest.agent?.a2aEndpoint,
            port: manifest.ports?.main || manifest.port,
          });
        } catch {
          logger.warn(`Failed to load manifest for ${appDir}`);
        }
      }
    }
  }
  
  // Discover vendor apps
  if (existsSync(VENDOR_DIR)) {
    const vendorDirs = readdirSync(VENDOR_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    
    for (const vendorDir of vendorDirs) {
      const vendorPath = resolve(VENDOR_DIR, vendorDir);
      const manifestPath = resolve(vendorPath, 'jeju-manifest.json');
      
      if (existsSync(manifestPath)) {
        try {
          const manifest = loadJejuManifest(vendorPath);
          apps.push({
            name: manifest.name || vendorDir,
            path: vendorPath,
            manifest,
            agentEnabled: manifest.agent?.enabled || false,
            a2aEndpoint: manifest.agent?.a2aEndpoint,
            port: manifest.ports?.main || manifest.port,
          });
        } catch {
          logger.warn(`Failed to load manifest for vendor/${vendorDir}`);
        }
      }
    }
  }
  
  return apps;
}

function loadRegistrationState(): RegistrationState {
  if (existsSync(REGISTRATION_STATE_FILE)) {
    return JSON.parse(readFileSync(REGISTRATION_STATE_FILE, 'utf-8'));
  }
  return {};
}

function saveRegistrationState(state: RegistrationState): void {
  writeFileSync(REGISTRATION_STATE_FILE, JSON.stringify(state, null, 2));
}

function getAppUrl(app: AppInfo, network: string): string {
  const host = network === 'localnet' ? 'http://localhost' : 'https://jeju.network';
  return app.port ? `${host}:${app.port}` : host;
}

// ============ Commands ============

async function listApps(network: string): Promise<void> {
  const apps = discoverApps();
  const state = loadRegistrationState();
  
  logger.info('Discovered Jeju Apps:');
  logger.info('=====================');
  
  for (const app of apps) {
    const registration = state[`${network}:${app.name}`];
    const status = registration ? `[registered: ${registration.agentId}]` : '[not registered]';
    const agentStatus = app.agentEnabled ? '✓' : '✗';
    
    console.log(`  ${agentStatus} ${app.name.padEnd(20)} ${status}`);
    if (app.a2aEndpoint) {
      console.log(`      A2A: ${app.a2aEndpoint}`);
    }
    if (app.manifest.agent?.tags?.length) {
      console.log(`      Tags: ${app.manifest.agent.tags.join(', ')}`);
    }
  }
  
  const agentEnabledCount = apps.filter(a => a.agentEnabled).length;
  console.log('');
  logger.info(`Total: ${apps.length} apps, ${agentEnabledCount} with agent enabled`);
}

async function registerSingleApp(
  config: Agent0Config, 
  appName: string
): Promise<void> {
  const apps = discoverApps();
  const app = apps.find(a => a.name === appName);
  
  if (!app) {
    logger.error(`App not found: ${appName}`);
    logger.info(`Available apps: ${apps.map(a => a.name).join(', ')}`);
    process.exit(1);
  }
  
  if (!app.agentEnabled) {
    logger.error(`Agent not enabled for ${appName}. Add 'agent.enabled: true' to jeju-manifest.json`);
    process.exit(1);
  }
  
  const appUrl = getAppUrl(app, config.network);
  
  logger.info(`Registering ${appName} as ERC-8004 agent...`);
  logger.info(`  Network: ${config.network}`);
  logger.info(`  App URL: ${appUrl}`);
  
  const result = await registerApp(config, app.manifest, appUrl);
  
  // Save registration state
  const state = loadRegistrationState();
  state[`${config.network}:${app.name}`] = {
    agentId: result.agentId,
    registeredAt: new Date().toISOString(),
    network: config.network,
    txHash: result.txHash,
  };
  saveRegistrationState(state);
  
  logger.success(`Successfully registered ${appName}`);
  logger.info(`  Agent ID: ${result.agentId}`);
  logger.info(`  TX Hash: ${result.txHash}`);
}

async function registerAllApps(config: Agent0Config): Promise<void> {
  const apps = discoverApps().filter(a => a.agentEnabled);
  
  if (apps.length === 0) {
    logger.warn('No apps with agent.enabled = true found');
    return;
  }
  
  logger.info(`Registering ${apps.length} apps as ERC-8004 agents...`);
  
  const state = loadRegistrationState();
  const results: { app: string; success: boolean; agentId?: string; error?: string }[] = [];
  
  for (const app of apps) {
    const stateKey = `${config.network}:${app.name}`;
    
    // Skip if already registered
    if (state[stateKey]) {
      logger.info(`Skipping ${app.name} (already registered: ${state[stateKey].agentId})`);
      results.push({ app: app.name, success: true, agentId: state[stateKey].agentId });
      continue;
    }
    
    try {
      const appUrl = getAppUrl(app, config.network);
      const result = await registerApp(config, app.manifest, appUrl);
      
      state[stateKey] = {
        agentId: result.agentId,
        registeredAt: new Date().toISOString(),
        network: config.network,
        txHash: result.txHash,
      };
      
      results.push({ app: app.name, success: true, agentId: result.agentId });
      logger.success(`Registered ${app.name}: ${result.agentId}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.push({ app: app.name, success: false, error: errorMsg });
      logger.error(`Failed to register ${app.name}: ${errorMsg}`);
    }
  }
  
  saveRegistrationState(state);
  
  // Summary
  console.log('');
  logger.info('Registration Summary:');
  logger.info('====================');
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  for (const r of successful) {
    console.log(`  ✓ ${r.app}: ${r.agentId}`);
  }
  
  for (const r of failed) {
    console.log(`  ✗ ${r.app}: ${r.error}`);
  }
  
  console.log('');
  logger.info(`Total: ${successful.length} succeeded, ${failed.length} failed`);
}

async function verifyRegistration(
  config: Agent0Config, 
  agentId: string
): Promise<void> {
  logger.info(`Verifying agent ${agentId}...`);
  
  const agentInfo = await getAgentInfo(config, agentId);
  
  if (!agentInfo) {
    logger.error(`Agent not found: ${agentId}`);
    process.exit(1);
  }
  
  logger.success('Agent found:');
  console.log(`  Name: ${agentInfo.name}`);
  console.log(`  Description: ${agentInfo.description}`);
  console.log(`  A2A Endpoint: ${agentInfo.a2aEndpoint || 'Not set'}`);
  console.log(`  MCP Endpoint: ${agentInfo.mcpEndpoint || 'Not set'}`);
  console.log(`  Tags: ${agentInfo.tags.join(', ')}`);
  console.log(`  Active: ${agentInfo.active}`);
  console.log(`  Chain ID: ${agentInfo.chainId}`);
}

async function showNetworkStatus(network: string): Promise<void> {
  const networkConfig = getNetworkConfig(network as 'localnet' | 'testnet' | 'mainnet');
  
  logger.info(`Network: ${network}`);
  logger.info('===================');
  console.log(`  Chain ID: ${networkConfig.chainId}`);
  console.log(`  RPC URL: ${networkConfig.rpcUrl}`);
  console.log(`  Identity Registry: ${networkConfig.registries.IDENTITY || 'Not deployed'}`);
  console.log(`  Reputation Registry: ${networkConfig.registries.REPUTATION || 'Not deployed'}`);
  console.log(`  Validation Registry: ${networkConfig.registries.VALIDATION || 'Not deployed'}`);
}

// ============ Main ============

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  // Parse arguments
  const networkArg = args.find(a => a.startsWith('--network='))?.split('=')[1] 
    || (args.includes('--network') ? args[args.indexOf('--network') + 1] : 'localnet');
  const appArg = args.find(a => a.startsWith('--app='))?.split('=')[1]
    || (args.includes('--app') ? args[args.indexOf('--app') + 1] : undefined);
  const agentIdArg = args.find(a => a.startsWith('--agent-id='))?.split('=')[1]
    || (args.includes('--agent-id') ? args[args.indexOf('--agent-id') + 1] : undefined);
  
  const shouldList = args.includes('--list');
  const shouldRegister = args.includes('--register');
  const shouldRegisterAll = args.includes('--register-all');
  const shouldVerify = args.includes('--verify');
  const showStatus = args.includes('--status');
  const showHelp = args.includes('--help') || args.includes('-h');
  
  if (showHelp) {
    console.log(`
Jeju Agent Registration Tool

Usage:
  bun scripts/register-agents.ts [options]

Options:
  --network <network>    Network: localnet, testnet, mainnet (default: localnet)
  --list                 List all discoverable apps and their agent status
  --register --app <name> Register a specific app as an agent
  --register-all         Register all apps with agent.enabled = true
  --verify --agent-id <id> Verify an agent's registration
  --status               Show network configuration and registry addresses
  --help, -h             Show this help message

Examples:
  bun scripts/register-agents.ts --list
  bun scripts/register-agents.ts --network testnet --register --app bazaar
  bun scripts/register-agents.ts --register-all
  bun scripts/register-agents.ts --verify --agent-id 1337:1

Environment Variables:
  PRIVATE_KEY            Private key for signing transactions
  DEPLOYER_PRIVATE_KEY   Alternative private key variable
  JEJU_NETWORK           Default network (overridden by --network)
`);
    return;
  }
  
  if (showStatus) {
    await showNetworkStatus(networkArg);
    return;
  }
  
  if (shouldList) {
    await listApps(networkArg);
    return;
  }
  
  if (shouldVerify && agentIdArg) {
    const config = createConfigFromEnv();
    config.network = networkArg as 'localnet' | 'testnet' | 'mainnet';
    await verifyRegistration(config, agentIdArg);
    return;
  }
  
  if (shouldRegister && appArg) {
    const config = createConfigFromEnv();
    config.network = networkArg as 'localnet' | 'testnet' | 'mainnet';
    await registerSingleApp(config, appArg);
    return;
  }
  
  if (shouldRegisterAll) {
    const config = createConfigFromEnv();
    config.network = networkArg as 'localnet' | 'testnet' | 'mainnet';
    await registerAllApps(config);
    return;
  }
  
  // Default: show list
  await listApps(networkArg);
}

main().catch((error) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
