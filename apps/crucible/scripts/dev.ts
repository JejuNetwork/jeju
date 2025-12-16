#!/usr/bin/env bun
/**
 * Crucible Dev Startup
 * Ensures localnet + contracts + DWS are ready, then starts Crucible server
 */

import { existsSync } from 'fs';
import { join } from 'path';

const LOCALNET_PORT = 9545;
const DWS_PORT = 4030;
const CRUCIBLE_PORT = parseInt(process.env.PORT ?? '3000');

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

async function checkDws(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${DWS_PORT}/health`, { signal: AbortSignal.timeout(2000) });
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
    console.log('⚠️  Anvil not found. Install: curl -L https://foundry.paradigm.xyz | bash');
    return false;
  }

  console.log('🔗 Starting localnet...');
  Bun.spawn([anvil, '--port', String(LOCALNET_PORT), '--chain-id', '1337'], {
    cwd: rootDir,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  for (let i = 0; i < 30; i++) {
    if (await checkRpc()) {
      console.log('✅ Localnet ready');
      return true;
    }
    await Bun.sleep(500);
  }
  return false;
}

async function bootstrapContracts(rootDir: string): Promise<boolean> {
  if (await checkContractsDeployed()) {
    console.log('✅ Contracts already deployed');
    return true;
  }

  const bootstrapScript = join(rootDir, 'scripts', 'bootstrap-localnet.ts');
  if (!existsSync(bootstrapScript)) {
    console.log('⚠️  No bootstrap script');
    return false;
  }

  console.log('📦 Bootstrapping contracts...');
  const proc = Bun.spawn(['bun', 'run', bootstrapScript], {
    cwd: rootDir,
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, L2_RPC_URL: `http://127.0.0.1:${LOCALNET_PORT}` },
  });

  const exitCode = await proc.exited;
  return exitCode === 0;
}

async function startDws(rootDir: string): Promise<boolean> {
  console.log('🌐 Starting DWS...');
  
  const dwsPath = join(rootDir, 'apps', 'dws');
  Bun.spawn(['bun', 'run', 'src/server/index.ts'], {
    cwd: dwsPath,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      PORT: String(DWS_PORT),
      L2_RPC_URL: `http://127.0.0.1:${LOCALNET_PORT}`,
    },
  });

  for (let i = 0; i < 30; i++) {
    if (await checkDws()) {
      console.log('✅ DWS ready');
      return true;
    }
    await Bun.sleep(500);
  }
  return false;
}

async function main() {
  const rootDir = findMonorepoRoot();
  
  console.log('\n=== Crucible Dev ===\n');

  // Check/start localnet
  if (!(await checkRpc())) {
    if (!(await startLocalnet(rootDir))) {
      console.log('❌ Failed to start localnet');
      process.exit(1);
    }
  } else {
    console.log('✅ Localnet already running');
  }

  // Bootstrap contracts
  if (process.env.BOOTSTRAP_CONTRACTS !== 'false') {
    await bootstrapContracts(rootDir);
  }

  // Check/start DWS
  if (!(await checkDws())) {
    if (!(await startDws(rootDir))) {
      console.log('⚠️  DWS not available - some features may not work');
    }
  } else {
    console.log('✅ DWS already running');
  }

  // Set environment
  process.env.L2_RPC_URL = `http://127.0.0.1:${LOCALNET_PORT}`;
  process.env.JEJU_RPC_URL = `http://127.0.0.1:${LOCALNET_PORT}`;
  process.env.RPC_URL = `http://127.0.0.1:${LOCALNET_PORT}`;
  process.env.DWS_URL = `http://127.0.0.1:${DWS_PORT}`;
  process.env.STORAGE_API_URL = `http://127.0.0.1:${DWS_PORT}/storage`;
  process.env.COMPUTE_MARKETPLACE_URL = `http://127.0.0.1:${DWS_PORT}/compute`;
  process.env.PORT = String(CRUCIBLE_PORT);
  process.env.PRIVATE_KEY = process.env.PRIVATE_KEY ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

  console.log(`\n🔥 Starting Crucible on port ${CRUCIBLE_PORT}...\n`);

  // Import and run the server directly
  await import('../src/server.ts');
}

main().catch(console.error);

