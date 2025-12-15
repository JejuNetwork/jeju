#!/usr/bin/env bun
/**
 * Start Decentralized Stack
 * 
 * This script starts the complete decentralized infrastructure:
 * - L1 nodes (Geth, Reth, Nethermind)
 * - L2 sequencer nodes (Geth, Reth, Nethermind)
 * - OP Stack services (op-node, op-batcher, op-proposer)
 * - Decentralization services (consensus, challenger, threshold signer)
 * - Proxy network (coordinator + nodes)
 * 
 * Usage:
 *   bun run scripts/start.ts
 *   bun run scripts/start.ts --deploy-contracts
 *   bun run scripts/start.ts --stop
 *   bun run scripts/start.ts --status
 */

import { $ } from 'bun';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { logger } from './shared/logger';

const ROOT = join(import.meta.dir, '..');
const SECRETS_DIR = join(ROOT, 'secrets');
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments');
const COMPOSE_FILE = join(ROOT, 'docker-compose.yml');

const isProduction = process.env.NODE_ENV === 'production' || process.env.NETWORK === 'mainnet' || process.env.NETWORK === 'testnet';
const isLocalDev = !isProduction;

// Default private keys ONLY for local development (NEVER used in production)
// In production, all keys MUST come from environment variables or secrets manager
const DEV_KEYS = isLocalDev ? {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  sequencer1: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  sequencer2: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  sequencer3: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  batcher: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  proposer: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  challenger: '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
  coordinator: '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
} : null;

function validateAddress(address: string, name: string): void {
  if (!address || address === '0x0000000000000000000000000000000000000000') {
    throw new Error(`${name} address is not set or is zero address`);
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error(`${name} address is invalid: ${address}`);
  }
}

function validatePrivateKey(key: string | undefined, name: string): void {
  if (!key) {
    throw new Error(`${name} private key is not set`);
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(key)) {
    throw new Error(`${name} private key is invalid format`);
  }
}

function getPrivateKey(keyName: string, envVar: string): string {
  if (isProduction) {
    const key = process.env[envVar];
    if (!key) {
      throw new Error(`Production mode requires ${envVar} environment variable. Hardcoded keys are not allowed in production.`);
    }
    validatePrivateKey(key, envVar);
    return key;
  }
  
  // Local dev: use env var if set, otherwise fall back to dev key
  const envKey = process.env[envVar];
  if (envKey) {
    validatePrivateKey(envKey, envVar);
    return envKey;
  }
  
  if (!DEV_KEYS) {
    throw new Error(`DEV_KEYS not available and ${envVar} not set`);
  }
  
  const devKey = DEV_KEYS[keyName as keyof typeof DEV_KEYS];
  if (!devKey) {
    throw new Error(`Dev key ${keyName} not found and ${envVar} not set`);
  }
  
  logger.warn(`Using default dev key for ${keyName}. Set ${envVar} to use custom key.`);
  return devKey;
}

function validateRequiredEnvVars(): void {
  if (isProduction) {
    const requiredVars = [
      'DEPLOYER_PRIVATE_KEY',
      'SEQUENCER_1_PRIVATE_KEY',
      'SEQUENCER_2_PRIVATE_KEY',
      'SEQUENCER_3_PRIVATE_KEY',
    ];

    const missing: string[] = [];
    for (const varName of requiredVars) {
      const value = process.env[varName];
      if (!value) {
        missing.push(varName);
      } else {
        try {
          validatePrivateKey(value, varName);
        } catch (e) {
          throw new Error(`Invalid ${varName}: ${(e as Error).message}`);
        }
      }
    }

    if (missing.length > 0) {
      throw new Error(`Production mode requires all environment variables: ${missing.join(', ')}\nDo not use hardcoded keys in production.`);
    }
    
    logger.info('Production mode: All required environment variables validated');
  } else {
    logger.info('Local dev mode: Using default dev keys (set env vars to override)');
  }
}

async function ensureSecrets(): Promise<void> {
  if (!existsSync(SECRETS_DIR)) {
    mkdirSync(SECRETS_DIR, { recursive: true });
    logger.debug(`Created secrets directory: ${SECRETS_DIR}`);
  }

  const jwtPath = join(SECRETS_DIR, 'jwt-secret.txt');
  if (!existsSync(jwtPath)) {
    const jwt = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;
    writeFileSync(jwtPath, jwt);
    logger.success('Generated JWT secret');
  } else {
    logger.debug('JWT secret already exists');
  }
}

async function createEnvFile(): Promise<void> {
  const envPath = join(ROOT, '.env');
  
  // In production, don't create .env file - use environment variables directly
  if (isProduction) {
    logger.info('Production mode: Skipping .env file creation. Use environment variables or secrets manager.');
    return;
  }
  
  // Only create .env in local dev mode
  if (existsSync(envPath)) {
    logger.debug('.env file already exists, skipping creation');
    return;
  }
  
  if (!DEV_KEYS) {
    throw new Error('Cannot create .env file: DEV_KEYS not available');
  }
  
  const env = `
# Decentralized Development Environment
# Generated by scripts/start.ts
# WARNING: This file contains development keys. Never commit to version control.

# Deployer
DEPLOYER_PRIVATE_KEY=${DEV_KEYS.deployer}

# Sequencer Keys
SEQUENCER_1_PRIVATE_KEY=${DEV_KEYS.sequencer1}
SEQUENCER_2_PRIVATE_KEY=${DEV_KEYS.sequencer2}
SEQUENCER_3_PRIVATE_KEY=${DEV_KEYS.sequencer3}

# OP Stack
BATCHER_PRIVATE_KEY=${DEV_KEYS.batcher}
PROPOSER_PRIVATE_KEY=${DEV_KEYS.proposer}
CHALLENGER_PRIVATE_KEY=${DEV_KEYS.challenger}

# Decentralization Services
SIGNER_THRESHOLD=2

# Proxy Network
COORDINATOR_PRIVATE_KEY=${DEV_KEYS.coordinator}
NODE_1_PRIVATE_KEY=${DEV_KEYS.sequencer2}

# Contract addresses (populated after deployment)
SEQUENCER_REGISTRY_ADDRESS=
THRESHOLD_BATCH_SUBMITTER_ADDRESS=
DISPUTE_GAME_FACTORY_ADDRESS=
PROVER_ADDRESS=
PROXY_REGISTRY_ADDRESS=
PROXY_PAYMENT_ADDRESS=
`.trim();

  writeFileSync(envPath, env);
  logger.success('Created .env file for local development');
}

async function checkL1Health(rpcUrl: string, maxRetries = 30): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const resp = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.result) {
          return true;
        }
      }
    } catch {
      // Continue retrying
    }
    await Bun.sleep(1000);
  }
  return false;
}

async function deployContracts(): Promise<Record<string, string>> {
  logger.info('Deploying contracts...');

  if (!existsSync(join(ROOT, 'packages/contracts'))) {
    throw new Error(`packages/contracts directory not found at ${join(ROOT, 'packages/contracts')}`);
  }

  const contractsDir = join(ROOT, 'packages/contracts');
  process.chdir(contractsDir);
  
  // Check if DeployStage2.s.sol exists
  const deployScript = join(contractsDir, 'script/DeployStage2.s.sol');
  if (!existsSync(deployScript)) {
    throw new Error(`Deploy script not found: ${deployScript}`);
  }

  // Get deployer key (production-safe)
  const deployerKey = getPrivateKey('deployer', 'DEPLOYER_PRIVATE_KEY');
  const rpcUrl = process.env.L1_RPC_URL || 'http://localhost:8545';
  
  logger.debug(`Using RPC: ${rpcUrl}`);
  logger.debug(`Deploy script: ${deployScript}`);

  // Deploy using Forge
  let result: string;
  try {
    result = await $`forge script script/DeployStage2.s.sol:DeployStage2 \
      --rpc-url ${rpcUrl} \
      --broadcast \
      --legacy \
      --private-key ${deployerKey} 2>&1`.text();
    
    logger.debug('Forge deployment output received');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Forge deployment command failed: ${errorMessage}`);
    throw new Error(`Contract deployment command failed: ${errorMessage}`);
  }
  
  logger.info('Deployment output:', result.substring(0, 500));

  // Check if deployment actually succeeded
  if (result.includes('Error') || result.includes('FAILED') || result.includes('revert')) {
    const errorOutput = result.substring(0, 1000);
    logger.error(`Contract deployment failed. Output: ${errorOutput}`);
    throw new Error(`Contract deployment failed. Check logs for details. Output preview: ${errorOutput.substring(0, 200)}`);
  }

  // Parse addresses from output
  const addresses: Record<string, string> = {};
  const addressMatches = result.matchAll(/(\w+Registry|\w+Timelock|\w+Factory|\w+Prover|\w+Adapter).*?(0x[a-fA-F0-9]{40})/g);
  
  for (const match of addressMatches) {
    const name = match[1].toLowerCase().replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
    addresses[name] = match[2];
    validateAddress(match[2], name);
  }

  // Save deployment file
  if (!existsSync(DEPLOYMENTS_DIR)) {
    mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  }

  const deploymentPath = join(DEPLOYMENTS_DIR, 'localnet.json');
  const deploymentData = {
    network: 'localnet',
    chainId: 1337,
    deployer: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    timestamp: Date.now(),
    sequencerRegistry: addresses.sequencer_registry || '',
    governanceTimelock: addresses.governance_timelock || '',
    disputeGameFactory: addresses.dispute_game_factory || '',
    prover: addresses.prover || '',
    l2OutputOracleAdapter: addresses.l2_output_oracle_adapter || '',
    optimismPortalAdapter: addresses.optimism_portal_adapter || '',
  };

  // Validate all addresses before saving
  for (const [key, value] of Object.entries(deploymentData)) {
    if (key !== 'network' && key !== 'chainId' && key !== 'deployer' && key !== 'timestamp') {
      if (value && value !== '') {
        validateAddress(value, key);
      }
    }
  }

  writeFileSync(deploymentPath, JSON.stringify(deploymentData, null, 2));

  logger.success(`Deployment saved to ${deploymentPath}`);
  logger.info(`Deployed ${Object.keys(addresses).length} contracts`);
  return addresses;
}

async function startServices(): Promise<void> {
  logger.info('Starting decentralized services...');

  if (!existsSync(COMPOSE_FILE)) {
    throw new Error(`Docker compose file not found: ${COMPOSE_FILE}`);
  }

  // Start docker-compose
  process.chdir(ROOT);
  
  try {
    await $`docker compose -f ${COMPOSE_FILE} up -d geth-l1 2>&1`.text();
    logger.success('Started L1 Geth');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to start L1 Geth: ${errorMessage}`);
    throw new Error(`Failed to start L1 Geth: ${errorMessage}`);
  }

  // Wait for L1 to be ready with proper health check
  logger.info('Waiting for L1 to be ready...');
  const l1Ready = await checkL1Health('http://localhost:8545');

  if (!l1Ready) {
    logger.error('L1 not ready after 30s - health check failed');
    throw new Error('L1 not ready after 30s. Check Docker logs: docker compose logs geth-l1');
  }
  logger.success('L1 is ready');

  // Deploy contracts if requested
  if (process.argv.includes('--deploy-contracts')) {
    try {
      await deployContracts();
    } catch (error) {
      logger.error(`Contract deployment failed: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.stack) {
        logger.debug(`Stack trace: ${error.stack}`);
      }
      throw error;
    }
  }

  // Start remaining services
  try {
    await $`docker compose -f ${COMPOSE_FILE} up -d 2>&1`.text();
    logger.success('Started all services');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to start remaining services: ${errorMessage}`);
    throw new Error(`Failed to start services: ${errorMessage}`);
  }
}

async function stopServices(): Promise<void> {
  logger.info('Stopping services...');
  
  process.chdir(ROOT);
  try {
    await $`docker compose -f ${COMPOSE_FILE} down 2>&1`.text();
    logger.success('Stopped all services');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to stop services: ${errorMessage}`);
    throw new Error(`Failed to stop services: ${errorMessage}`);
  }
}

async function showStatus(): Promise<void> {
  logger.info('Checking service status...');

  process.chdir(ROOT);
  let status: string;
  try {
    status = await $`docker compose -f ${COMPOSE_FILE} ps --format json 2>&1`.text();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to get service status: ${errorMessage}`);
    throw new Error(`Failed to get service status: ${errorMessage}`);
  }
  
  try {
    const services = status.split('\n').filter(Boolean).map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);

    logger.info('Service Status:');
    logger.info('Service'.padEnd(30) + 'Status'.padEnd(15) + 'Ports');
    logger.info('-'.repeat(70));

    for (const svc of services) {
      const name = (svc.Name || svc.Service || 'unknown').padEnd(30);
      const state = (svc.State || svc.Status || 'unknown').padEnd(15);
      const ports = svc.Ports || svc.Publishers?.map((p: { PublishedPort: number }) => p.PublishedPort).join(', ') || '';
      const isHealthy = state.toLowerCase().includes('running') || state.toLowerCase().includes('up');
      if (isHealthy) {
        logger.info(`${name}${state}${ports}`);
      } else {
        logger.warn(`${name}${state}${ports}`);
      }
    }
  } catch (error) {
    logger.warn(`Failed to parse service status: ${error instanceof Error ? error.message : String(error)}`);
    logger.info('Raw status:', status);
  }

  // Check endpoints
  logger.info('Endpoint Health:');
  
  const endpoints = [
    { name: 'L1 Geth', url: 'http://localhost:8545' },
    { name: 'L1 Reth', url: 'http://localhost:8645' },
    { name: 'L1 Nethermind', url: 'http://localhost:8745' },
    { name: 'L2 Geth Seq', url: 'http://localhost:9545' },
    { name: 'L2 Reth Seq', url: 'http://localhost:9645' },
    { name: 'L2 Nethermind Seq', url: 'http://localhost:9745' },
    { name: 'Proxy Coordinator', url: 'http://localhost:4020/health' },
    { name: 'Prometheus', url: 'http://localhost:9090' },
    { name: 'Grafana', url: 'http://localhost:3001' },
  ];

  for (const ep of endpoints) {
    try {
      const resp = await fetch(ep.url, { signal: AbortSignal.timeout(2000) });
      if (resp.ok) {
        logger.info(`  ${ep.name.padEnd(20)} ✓ ${ep.url}`);
      } else {
        logger.warn(`  ${ep.name.padEnd(20)} ✗ ${ep.url} (HTTP ${resp.status})`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`  ${ep.name.padEnd(20)} ✗ ${ep.url} (${errorMessage})`);
    }
  }
}

async function main(): Promise<void> {
  logger.box(`
Network Decentralization
Mode: ${isProduction ? 'PRODUCTION' : 'LOCAL DEVELOPMENT'}
  `);

  if (process.argv.includes('--stop')) {
    try {
      await stopServices();
    } catch (error) {
      logger.error(`Failed to stop services: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.stack) {
        logger.debug(`Stack trace: ${error.stack}`);
      }
      process.exit(1);
    }
    return;
  }

  if (process.argv.includes('--status')) {
    try {
      await showStatus();
    } catch (error) {
      logger.error(`Failed to show status: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.stack) {
        logger.debug(`Stack trace: ${error.stack}`);
      }
      process.exit(1);
    }
    return;
  }

  // Ensure prerequisites
  try {
    await ensureSecrets();
    await createEnvFile();
  } catch (error) {
    logger.error(`Failed to setup prerequisites: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      logger.debug(`Stack trace: ${error.stack}`);
    }
    process.exit(1);
  }
  
  // Validate required environment variables
  try {
    validateRequiredEnvVars();
  } catch (error) {
    logger.error(`Environment validation failed: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      logger.debug(`Stack trace: ${error.stack}`);
    }
    process.exit(1);
  }
  
  // Start services
  try {
    await startServices();
  } catch (error) {
    logger.error(`Failed to start services: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      logger.debug(`Stack trace: ${error.stack}`);
    }
    process.exit(1);
  }
  
  // Show status
  await Bun.sleep(5000);
  try {
    await showStatus();
  } catch (error) {
    logger.warn(`Failed to show status: ${error instanceof Error ? error.message : String(error)}`);
  }

  logger.box(`
Services running. Use --status to check, --stop to shutdown.
  `);
}

main().catch(err => {
  logger.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) {
    logger.error(`Stack trace: ${err.stack}`);
  }
  process.exit(1);
});
