#!/usr/bin/env bun
/**
 * DWS Dev Startup
 * 
 * Ensures ALL required infrastructure is running before starting DWS:
 * - Docker services (CQL, IPFS, Cache, DA)
 * - Localnet (Anvil)
 * - Contracts deployed
 * 
 * NO FALLBACKS - all infrastructure must be running.
 * 
 * For full infrastructure management, use: jeju infra start
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { platform } from 'os';

const LOCALNET_PORT = 9545;
const DWS_PORT = parseInt(process.env.PORT ?? '4030');

// Required infrastructure services
const REQUIRED_SERVICES = {
  cql: { port: 4661, healthPath: '/health', name: 'CovenantSQL' },
  ipfs: { port: 5001, healthPath: '/api/v0/id', name: 'IPFS' },
  cache: { port: 4115, healthPath: '/health', name: 'Cache Service' },
  da: { port: 4010, healthPath: '/health', name: 'DA Server' },
} as const;

function findMonorepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'bun.lock')) && existsSync(join(dir, 'packages'))) {
      return dir;
    }
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

async function isDockerRunning(): Promise<boolean> {
  try {
    const proc = Bun.spawn(['docker', 'info'], { stdout: 'pipe', stderr: 'pipe' });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

async function startDocker(): Promise<boolean> {
  const os = platform();
  console.log('🐳 Starting Docker...');

  if (os === 'darwin') {
    // macOS - open Docker Desktop
    Bun.spawn(['open', '-a', 'Docker'], { stdout: 'pipe', stderr: 'pipe' });
    
    // Wait for Docker to be ready
    for (let i = 0; i < 60; i++) {
      await Bun.sleep(1000);
      if (await isDockerRunning()) {
        console.log('   ✅ Docker started');
        return true;
      }
      if (i % 10 === 9) {
        console.log(`   ⏳ Waiting for Docker... (${i + 1}s)`);
      }
    }
    return false;
  } else if (os === 'linux') {
    const proc = Bun.spawn(['sudo', 'systemctl', 'start', 'docker'], { 
      stdout: 'inherit', 
      stderr: 'inherit' 
    });
    await proc.exited;
    
    for (let i = 0; i < 30; i++) {
      await Bun.sleep(1000);
      if (await isDockerRunning()) {
        console.log('   ✅ Docker started');
        return true;
      }
    }
    return false;
  }
  
  console.log('   ❌ Please start Docker manually');
  return false;
}

async function checkServiceHealth(port: number, healthPath: string): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${healthPath}`, {
      method: healthPath.startsWith('/api/v0') ? 'POST' : 'GET',
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function startDockerServices(rootDir: string): Promise<boolean> {
  console.log('🐳 Starting Docker services...');
  
  const proc = Bun.spawn(['docker', 'compose', 'up', '-d', 'cql', 'ipfs', 'cache-service', 'da-server'], {
    cwd: rootDir,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    return false;
  }

  // Wait for services to be healthy
  console.log('   ⏳ Waiting for services...');
  for (let attempt = 0; attempt < 60; attempt++) {
    const allHealthy = await Promise.all(
      Object.entries(REQUIRED_SERVICES).map(async ([, config]) => 
        checkServiceHealth(config.port, config.healthPath)
      )
    );
    
    if (allHealthy.every(Boolean)) {
      return true;
    }
    
    await Bun.sleep(1000);
  }
  
  return false;
}

async function checkRpc(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${LOCALNET_PORT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function checkContractsDeployed(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${LOCALNET_PORT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getCode',
        params: ['0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9', 'latest'],
        id: 1,
      }),
    });
    const data = await response.json() as { result: string };
    return data.result && data.result !== '0x' && data.result.length > 2;
  } catch {
    return false;
  }
}

async function startLocalnet(rootDir: string): Promise<boolean> {
  const anvil = Bun.which('anvil');
  if (!anvil) {
    console.log('❌ Anvil not found. Install: curl -L https://foundry.paradigm.xyz | bash');
    return false;
  }

  console.log('🔗 Starting localnet...');
  Bun.spawn([anvil, '--port', String(LOCALNET_PORT), '--chain-id', '1337'], {
    cwd: rootDir,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  for (let i = 0; i < 30; i++) {
    if (await checkRpc()) {
      console.log('   ✅ Localnet ready');
      return true;
    }
    await Bun.sleep(500);
  }
  return false;
}

async function bootstrapContracts(rootDir: string): Promise<boolean> {
  if (await checkContractsDeployed()) {
    console.log('   ✅ Contracts already deployed');
    return true;
  }

  const bootstrapScript = join(rootDir, 'scripts', 'bootstrap-localnet.ts');
  if (!existsSync(bootstrapScript)) {
    console.log('   ⚠️  No bootstrap script found');
    return false;
  }

  console.log('   📦 Bootstrapping contracts...');
  const proc = Bun.spawn(['bun', 'run', bootstrapScript], {
    cwd: rootDir,
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, L2_RPC_URL: `http://127.0.0.1:${LOCALNET_PORT}` },
  });

  const exitCode = await proc.exited;
  return exitCode === 0;
}

async function verifyInfrastructure(): Promise<{ ready: boolean; missing: string[] }> {
  const missing: string[] = [];
  
  for (const [, config] of Object.entries(REQUIRED_SERVICES)) {
    const healthy = await checkServiceHealth(config.port, config.healthPath);
    if (!healthy) {
      missing.push(config.name);
    }
  }
  
  return { ready: missing.length === 0, missing };
}

async function main() {
  const rootDir = findMonorepoRoot();
  
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                        DWS Dev Mode                          ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  All infrastructure required - no fallbacks.                 ║');
  console.log('║  Tip: Use `jeju infra start` for full management.            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Step 1: Check/start Docker
  console.log('1️⃣  Docker');
  if (!(await isDockerRunning())) {
    if (!(await startDocker())) {
      console.log('   ❌ Docker is not running. Please start Docker Desktop.');
      process.exit(1);
    }
  } else {
    console.log('   ✅ Docker running');
  }

  // Step 2: Check/start infrastructure services
  console.log('\n2️⃣  Services');
  let infraCheck = await verifyInfrastructure();
  
  if (!infraCheck.ready) {
    console.log(`   Missing: ${infraCheck.missing.join(', ')}`);
    if (!(await startDockerServices(rootDir))) {
      console.log('   ❌ Failed to start Docker services');
      console.log('   Try: docker compose up -d');
      process.exit(1);
    }
    
    infraCheck = await verifyInfrastructure();
    if (!infraCheck.ready) {
      console.log(`   ❌ Services not healthy: ${infraCheck.missing.join(', ')}`);
      process.exit(1);
    }
  }
  
  for (const [, config] of Object.entries(REQUIRED_SERVICES)) {
    console.log(`   ✅ ${config.name}`);
  }

  // Step 3: Check/start localnet
  console.log('\n3️⃣  Localnet');
  if (!(await checkRpc())) {
    if (!(await startLocalnet(rootDir))) {
      console.log('   ❌ Failed to start localnet');
      process.exit(1);
    }
  } else {
    console.log('   ✅ Localnet running');
  }

  // Step 4: Bootstrap contracts
  console.log('\n4️⃣  Contracts');
  if (process.env.BOOTSTRAP_CONTRACTS !== 'false') {
    await bootstrapContracts(rootDir);
  } else {
    console.log('   ⏭️  Skipped');
  }

  // Step 5: Set environment and start DWS
  process.env.L2_RPC_URL = `http://127.0.0.1:${LOCALNET_PORT}`;
  process.env.JEJU_RPC_URL = `http://127.0.0.1:${LOCALNET_PORT}`;
  process.env.PORT = String(DWS_PORT);
  process.env.CQL_URL = 'http://127.0.0.1:4661';
  process.env.IPFS_API_URL = 'http://127.0.0.1:5001';
  process.env.DA_URL = 'http://127.0.0.1:4010';
  process.env.CACHE_URL = 'http://127.0.0.1:4115';

  console.log('\n5️⃣  DWS Server');
  console.log(`   Port: ${DWS_PORT}`);
  console.log(`   RPC:  http://127.0.0.1:${LOCALNET_PORT}`);
  console.log(`   CQL:  http://127.0.0.1:4661\n`);

  // Import and run the server directly
  await import('../src/server/index.ts');
}

main().catch((err) => {
  console.error('❌ Startup failed:', err);
  process.exit(1);
});

