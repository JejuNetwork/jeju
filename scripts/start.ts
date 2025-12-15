#!/usr/bin/env bun
/**
<<<<<<< HEAD
 * Jeju Network Startup Script
 * 
 * Starts all infrastructure services and validates they're healthy
 * before allowing applications to start. Ensures a fully permissionless,
 * resilient network with no single points of failure.
 * 
 * Services Started:
 * - IPFS (storage)
 * - Cache Service (Redis-compatible)
 * - DA Server (data availability with vault)
 * - JNS Gateway (name resolution)
 * - Trigger Service (compute triggers)
 * - PostgreSQL (for Subsquid indexer)
 * 
 * Usage:
 *   bun run scripts/start.ts
 *   bun run scripts/start.ts --wait-only  # Just wait for services
 *   bun run scripts/start.ts --check      # Health check only
 */

import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

interface ServiceHealth {
  name: string;
  url: string;
  healthy: boolean;
  error?: string;
  latencyMs?: number;
}

interface StartupResult {
  success: boolean;
  services: ServiceHealth[];
  errors: string[];
}

const SERVICES = [
  { name: 'IPFS', url: 'http://localhost:5001/api/v0/id', method: 'POST', healthPath: '' },
  { name: 'Cache', url: 'http://localhost:4115/health', method: 'GET', healthPath: '/health' },
  { name: 'DA Server', url: 'http://localhost:4010/health', method: 'GET', healthPath: '/health' },
  { name: 'PostgreSQL', url: 'postgres://localhost:5434', method: 'TCP', port: 5434 },
];

const MAX_RETRIES = 30;
const RETRY_DELAY_MS = 2000;

async function checkServiceHealth(service: typeof SERVICES[0]): Promise<ServiceHealth> {
  const startTime = Date.now();
  
  if (service.method === 'TCP') {
    const net = await import('net');
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(5000);
      
      socket.on('connect', () => {
        socket.destroy();
        resolve({
          name: service.name,
          url: service.url,
          healthy: true,
          latencyMs: Date.now() - startTime,
        });
      });
      
      socket.on('error', (err) => {
        socket.destroy();
        resolve({
          name: service.name,
          url: service.url,
          healthy: false,
          error: err.message,
          latencyMs: Date.now() - startTime,
        });
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        resolve({
          name: service.name,
          url: service.url,
          healthy: false,
          error: 'Connection timeout',
          latencyMs: Date.now() - startTime,
        });
      });
      
      socket.connect(service.port!, 'localhost');
    });
  }
  
  const response = await fetch(service.url, {
    method: service.method as 'GET' | 'POST',
    signal: AbortSignal.timeout(5000),
  }).catch((e: Error) => ({ ok: false, error: e.message }));
  
  const latencyMs = Date.now() - startTime;
  
  if ('error' in response) {
    return {
      name: service.name,
      url: service.url,
      healthy: false,
      error: response.error,
      latencyMs,
    };
  }
  
  return {
    name: service.name,
    url: service.url,
    healthy: response.ok,
    error: response.ok ? undefined : `HTTP ${response.status}`,
    latencyMs,
  };
}

async function waitForServices(): Promise<ServiceHealth[]> {
  console.log('⏳ Waiting for services to be healthy...\n');
  
  const results: ServiceHealth[] = [];
  
  for (const service of SERVICES) {
    console.log(`   Checking ${service.name}...`);
    
    let healthy = false;
    let lastHealth: ServiceHealth | null = null;
    
    for (let attempt = 0; attempt < MAX_RETRIES && !healthy; attempt++) {
      lastHealth = await checkServiceHealth(service);
      healthy = lastHealth.healthy;
      
      if (!healthy && attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        process.stdout.write(`   Retry ${attempt + 1}/${MAX_RETRIES}...\r`);
      }
    }
    
    if (healthy && lastHealth) {
      console.log(`   ✅ ${service.name} healthy (${lastHealth.latencyMs}ms)`);
    } else if (lastHealth) {
      console.log(`   ❌ ${service.name} FAILED: ${lastHealth.error}`);
    }
    
    results.push(lastHealth!);
  }
  
  return results;
}

async function startDockerCompose(): Promise<void> {
  const composePath = join(process.cwd(), 'docker-compose.yml');
  
  if (!existsSync(composePath)) {
    throw new Error(`docker-compose.yml not found at ${composePath}`);
  }
  
  console.log('🐳 Starting Docker Compose services...\n');
  
  execSync('docker compose up -d', {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  
  console.log('');
}

async function startLocalnet(): Promise<void> {
  console.log('⛓️  Starting localnet...\n');
  
  const checkCmd = 'cast block-number --rpc-url http://127.0.0.1:9545 2>/dev/null';
  try {
    execSync(checkCmd, { encoding: 'utf-8', stdio: 'pipe' });
    console.log('   ✅ Localnet already running\n');
    return;
  } catch {
    // Not running, start it
  }
  
  const proc = spawn('bun', ['run', 'localnet:start'], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
  });
  proc.unref();
  
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      execSync(checkCmd, { encoding: 'utf-8', stdio: 'pipe' });
      console.log('   ✅ Localnet started\n');
      return;
    } catch {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  
  throw new Error('Localnet failed to start');
}

async function bootstrapContracts(): Promise<void> {
  console.log('📝 Bootstrapping contracts...\n');
  
  const deploymentPath = join(process.cwd(), 'packages/contracts/deployments/localnet-complete.json');
  if (existsSync(deploymentPath)) {
    console.log('   ✅ Contracts already deployed\n');
    return;
  }
  
  execSync('bun run scripts/bootstrap-localnet-complete.ts', {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  
  console.log('');
}

async function printEnvVars(): Promise<void> {
  console.log('📋 Environment variables for apps:\n');
  console.log('   export COVENANTSQL_NODES=http://localhost:4661');
  console.log('   export IPFS_GATEWAY_URL=http://localhost:4180');
  console.log('   export IPFS_API_URL=http://localhost:5001');
  console.log('   export CACHE_SERVICE_URL=http://localhost:4115');
  console.log('   export DA_SERVER_URL=http://localhost:4010');
  console.log('   export JEJU_RPC_URL=http://localhost:9545');
  console.log('');
}

async function main(): Promise<StartupResult> {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const waitOnly = args.includes('--wait-only');
  
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                    JEJU NETWORK STARTUP                           ║');
  console.log('║                   100% Permissionless                             ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log('\n');
  
  const errors: string[] = [];
  
  if (checkOnly) {
    const health = await Promise.all(SERVICES.map(checkServiceHealth));
    console.log('Service Health:\n');
    for (const h of health) {
      const status = h.healthy ? '✅' : '❌';
      const latency = h.latencyMs ? ` (${h.latencyMs}ms)` : '';
      const error = h.error ? ` - ${h.error}` : '';
      console.log(`   ${status} ${h.name}${latency}${error}`);
    }
    console.log('');
    
    const allHealthy = health.every(h => h.healthy);
    return { success: allHealthy, services: health, errors };
  }
  
  if (!waitOnly) {
    try {
      await startDockerCompose();
    } catch (e) {
      const error = `Docker Compose failed: ${(e as Error).message}`;
      console.error(`❌ ${error}`);
      errors.push(error);
    }
  }
  
  const services = await waitForServices();
  const allHealthy = services.every(s => s.healthy);
  
  if (!allHealthy) {
    console.log('\n❌ Some services failed to start. Check Docker logs:');
    console.log('   docker compose logs');
    console.log('');
    
    for (const s of services.filter(s => !s.healthy)) {
      errors.push(`${s.name}: ${s.error}`);
    }
    
    return { success: false, services, errors };
  }
  
  if (!waitOnly) {
    try {
      await startLocalnet();
      await bootstrapContracts();
    } catch (e) {
      const error = `Chain setup failed: ${(e as Error).message}`;
      console.error(`❌ ${error}`);
      errors.push(error);
      return { success: false, services, errors };
    }
  }
  
  await printEnvVars();
  
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                    ✅ NETWORK READY                               ║');
  console.log('╠═══════════════════════════════════════════════════════════════════╣');
  console.log('║  All services are healthy and running.                            ║');
  console.log('║  No fallbacks. No single points of failure.                       ║');
  console.log('║                                                                   ║');
  console.log('║  Start apps: bun run dev                                          ║');
  console.log('║  Stop all:   docker compose down && bun run localnet:stop         ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log('\n');
  
  return { success: true, services, errors };
}

if (import.meta.main) {
  main().then((result) => {
    process.exit(result.success ? 0 : 1);
  }).catch((e) => {
    console.error('❌ Startup failed:', e);
    process.exit(1);
  });
}

export { main as start, checkServiceHealth, waitForServices };
=======
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
 */

import { $ } from 'bun';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '..');
const SECRETS_DIR = join(ROOT, 'secrets');
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments');
const COMPOSE_FILE = join(ROOT, 'docker-compose.decentralized.yml');

// Default private keys for local development (DO NOT USE IN PRODUCTION)
const DEV_KEYS = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  sequencer1: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  sequencer2: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  sequencer3: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  batcher: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  proposer: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  challenger: '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
  coordinator: '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
};

async function ensureSecrets(): Promise<void> {
  if (!existsSync(SECRETS_DIR)) {
    mkdirSync(SECRETS_DIR, { recursive: true });
  }

  const jwtPath = join(SECRETS_DIR, 'jwt-secret.txt');
  if (!existsSync(jwtPath)) {
    const jwt = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;
    writeFileSync(jwtPath, jwt);
    console.log('✓ Generated JWT secret');
  }
}

async function createEnvFile(): Promise<void> {
  const envPath = join(ROOT, '.env');
  
  const env = `
# Decentralized Development Environment
# Generated by scripts/start.ts

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
  console.log('✓ Created .env');
}

async function deployContracts(): Promise<Record<string, string>> {
  console.log('\n📜 Deploying contracts...\n');

  process.chdir(join(ROOT, 'packages/contracts'));
  
  // Deploy using Forge
  const result = await $`forge script script/Deploy.s.sol:Deploy \
    --rpc-url http://localhost:8545 \
    --broadcast \
    --legacy \
    --private-key ${DEV_KEYS.deployer} 2>&1`.text();
  
  console.log(result);

  // Parse addresses from output
  const addresses: Record<string, string> = {};
  const addressMatches = result.matchAll(/(\w+Registry|\w+Timelock|\w+Factory|\w+Prover|\w+Adapter).*?(0x[a-fA-F0-9]{40})/g);
  
  for (const match of addressMatches) {
    const name = match[1].toLowerCase().replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
    addresses[name] = match[2];
  }

  // Save deployment file
  if (!existsSync(DEPLOYMENTS_DIR)) {
    mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  }

  const deploymentPath = join(DEPLOYMENTS_DIR, 'localnet.json');
  writeFileSync(deploymentPath, JSON.stringify({
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
  }, null, 2));

  console.log(`\n✓ Deployment saved to ${deploymentPath}`);
  return addresses;
}

async function startServices(): Promise<void> {
  console.log('\n🚀 Starting decentralized services...\n');

  // Start docker-compose
  process.chdir(ROOT);
  
  await $`docker-compose -f ${COMPOSE_FILE} up -d geth-l1 2>&1`.text();
  console.log('✓ Started L1 Geth');

  // Wait for L1 to be ready
  console.log('⏳ Waiting for L1...');
  await Bun.sleep(5000);
  
  // Check L1 health
  let l1Ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const resp = await fetch('http://localhost:8545', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
      });
      if (resp.ok) {
        l1Ready = true;
        break;
      }
    } catch {
      await Bun.sleep(1000);
    }
  }

  if (!l1Ready) {
    console.error('✗ L1 not ready after 30s');
    process.exit(1);
  }
  console.log('✓ L1 is ready');

  // Deploy contracts if requested
  if (process.argv.includes('--deploy-contracts')) {
    await deployContracts();
  }

  // Start remaining services
  await $`docker-compose -f ${COMPOSE_FILE} up -d 2>&1`.text();
  console.log('✓ Started all services');
}

async function stopServices(): Promise<void> {
  console.log('\n🛑 Stopping services...\n');
  
  process.chdir(ROOT);
  await $`docker-compose -f ${COMPOSE_FILE} down 2>&1`.text();
  console.log('✓ Stopped all services');
}

async function showStatus(): Promise<void> {
  console.log('\n📊 Status\n');

  process.chdir(ROOT);
  const status = await $`docker-compose -f ${COMPOSE_FILE} ps --format json 2>&1`.text();
  
  try {
    const services = status.split('\n').filter(Boolean).map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);

    console.log('Service'.padEnd(30) + 'Status'.padEnd(15) + 'Ports');
    console.log('-'.repeat(70));

    for (const svc of services) {
      const name = (svc.Name || svc.Service || 'unknown').padEnd(30);
      const state = (svc.State || svc.Status || 'unknown').padEnd(15);
      const ports = svc.Ports || svc.Publishers?.map((p: { PublishedPort: number }) => p.PublishedPort).join(', ') || '';
      console.log(`${name}${state}${ports}`);
    }
  } catch {
    console.log(status);
  }

  // Check endpoints
  console.log('\n🔌 Endpoints:\n');
  
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
      console.log(`  ${ep.name.padEnd(20)} ${resp.ok ? '✓' : '✗'} ${ep.url}`);
    } catch {
      console.log(`  ${ep.name.padEnd(20)} ✗ ${ep.url}`);
    }
  }
}

async function main(): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                    Network Decentralization                       ║
╚══════════════════════════════════════════════════════════════════╝
`);

  if (process.argv.includes('--stop')) {
    await stopServices();
    return;
  }

  if (process.argv.includes('--status')) {
    await showStatus();
    return;
  }

  // Ensure prerequisites
  await ensureSecrets();
  await createEnvFile();
  
  // Start services
  await startServices();
  
  // Show status
  await Bun.sleep(5000);
  await showStatus();

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  Services running. Use --status to check, --stop to shutdown.   ║
╚══════════════════════════════════════════════════════════════════╝
`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
>>>>>>> 85cacfe8c2dcc33c81338e0d1acfaed656c52cde
