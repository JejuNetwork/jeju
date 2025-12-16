/**
 * Bun Global Test Setup
 * 
 * Handles test infrastructure setup for bun test runs.
 * Works in two modes:
 * 1. Standalone: Starts localnet + DWS services
 * 2. Managed: Detects existing infrastructure from `jeju test`
 * 
 * Usage in bunfig.toml:
 *   preload = ["@jejunetwork/tests/bun-global-setup"]
 * 
 * Or programmatically:
 *   import { setup, teardown } from '@jejunetwork/tests/bun-global-setup';
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Subprocess } from 'bun';

// Infrastructure state
let localnetProcess: Subprocess | null = null;
let dwsProcess: Subprocess | null = null;
let setupComplete = false;
let isExternalInfra = false;

// Default ports
const LOCALNET_PORT = 9545;
const DWS_PORT = 4030;

// Environment URLs
const RPC_URL = process.env.L2_RPC_URL || process.env.JEJU_RPC_URL || `http://127.0.0.1:${LOCALNET_PORT}`;
const DWS_URL = process.env.DWS_URL || `http://127.0.0.1:${DWS_PORT}`;

interface InfraStatus {
  rpc: boolean;
  dws: boolean;
  rpcUrl: string;
  dwsUrl: string;
}

async function checkPort(port: number, path = '/'): Promise<boolean> {
  try {
    const url = `http://127.0.0.1:${port}${path}`;
    const response = await fetch(url, { 
      method: path === '/' ? 'GET' : 'POST',
      signal: AbortSignal.timeout(2000),
      ...(path !== '/' && {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function checkRpc(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function checkDws(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function checkInfrastructure(): Promise<InfraStatus> {
  const [rpc, dws] = await Promise.all([
    checkRpc(RPC_URL),
    checkDws(DWS_URL),
  ]);
  
  return { rpc, dws, rpcUrl: RPC_URL, dwsUrl: DWS_URL };
}

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

async function startLocalnet(rootDir: string): Promise<void> {
  console.log('Starting localnet...');
  
  // Check if anvil is available
  const anvil = Bun.which('anvil');
  if (!anvil) {
    console.warn('Anvil not found. Install foundry: curl -L https://foundry.paradigm.xyz | bash');
    return;
  }

  localnetProcess = Bun.spawn([anvil, '--port', String(LOCALNET_PORT), '--chain-id', '1337'], {
    cwd: rootDir,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Wait for localnet to be ready
  for (let i = 0; i < 30; i++) {
    if (await checkRpc(`http://127.0.0.1:${LOCALNET_PORT}`)) {
      console.log('Localnet ready');
      return;
    }
    await Bun.sleep(1000);
  }
  
  throw new Error('Localnet failed to start');
}

async function startDws(rootDir: string): Promise<void> {
  console.log('Starting DWS...');
  
  const dwsPath = join(rootDir, 'apps', 'dws');
  if (!existsSync(dwsPath)) {
    console.warn('DWS app not found');
    return;
  }

  dwsProcess = Bun.spawn(['bun', 'run', 'dev'], {
    cwd: dwsPath,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      PORT: String(DWS_PORT),
      L2_RPC_URL: `http://127.0.0.1:${LOCALNET_PORT}`,
      JEJU_RPC_URL: `http://127.0.0.1:${LOCALNET_PORT}`,
    },
  });

  // Wait for DWS to be ready
  for (let i = 0; i < 30; i++) {
    if (await checkDws(`http://127.0.0.1:${DWS_PORT}`)) {
      console.log('DWS ready');
      return;
    }
    await Bun.sleep(1000);
  }
  
  throw new Error('DWS failed to start');
}

async function bootstrapContracts(rootDir: string): Promise<boolean> {
  // Check if contracts are already deployed
  const rpcUrl = `http://127.0.0.1:${LOCALNET_PORT}`;
  try {
    const response = await fetch(rpcUrl, {
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
    if (data.result && data.result !== '0x' && data.result.length > 2) {
      console.log('Contracts already deployed');
      return true;
    }
  } catch {
    // Continue to deploy
  }

  console.log('Bootstrapping contracts...');
  
  const bootstrapScript = join(rootDir, 'scripts', 'bootstrap-localnet.ts');
  if (!existsSync(bootstrapScript)) {
    console.warn('Bootstrap script not found, skipping contract deployment');
    return false;
  }

  try {
    const proc = Bun.spawn(['bun', 'run', bootstrapScript], {
      cwd: rootDir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        L2_RPC_URL: rpcUrl,
        JEJU_RPC_URL: rpcUrl,
      },
    });

    const exitCode = await proc.exited;
    if (exitCode === 0) {
      console.log('Contracts bootstrapped');
      return true;
    } else {
      console.warn('Bootstrap failed, continuing without contracts');
      return false;
    }
  } catch (error) {
    console.warn(`Bootstrap error: ${error}`);
    return false;
  }
}

async function stopProcess(proc: Subprocess | null): Promise<void> {
  if (!proc) return;
  
  try {
    proc.kill();
    await proc.exited;
  } catch {
    // Process may already be dead
  }
}

/**
 * Setup test infrastructure
 * Call this in beforeAll or as a preload
 */
export async function setup(): Promise<void> {
  if (setupComplete) return;

  console.log('\n=== Test Setup ===\n');

  // Check if infrastructure already running (from jeju test or manual start)
  const status = await checkInfrastructure();
  
  if (status.rpc && status.dws) {
    console.log('Infrastructure already running (external)');
    console.log(`  RPC: ${status.rpcUrl}`);
    console.log(`  DWS: ${status.dwsUrl}`);
    isExternalInfra = true;
    setupComplete = true;
    setEnvVars(status);
    return;
  }

  // Need to start infrastructure
  isExternalInfra = false;
  const rootDir = findMonorepoRoot();
  console.log(`Monorepo root: ${rootDir}`);

  // Start what's missing
  if (!status.rpc) {
    await startLocalnet(rootDir);
  } else {
    console.log('RPC already running');
  }

  // Bootstrap contracts by default in dev (set BOOTSTRAP_CONTRACTS=false to skip)
  const shouldBootstrap = process.env.BOOTSTRAP_CONTRACTS !== 'false';
  if (shouldBootstrap) {
    await bootstrapContracts(rootDir);
  }

  if (!status.dws) {
    await startDws(rootDir);
  } else {
    console.log('DWS already running');
  }

  // Set environment variables
  const newStatus = await checkInfrastructure();
  setEnvVars(newStatus);

  // Create test output directory
  const outputDir = join(process.cwd(), 'test-results');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Write setup info
  writeFileSync(join(outputDir, 'setup.json'), JSON.stringify({
    rpcUrl: newStatus.rpcUrl,
    dwsUrl: newStatus.dwsUrl,
    startTime: new Date().toISOString(),
    external: isExternalInfra,
  }, null, 2));

  setupComplete = true;
  console.log('\n=== Setup Complete ===\n');
}

function setEnvVars(status: InfraStatus): void {
  process.env.L2_RPC_URL = status.rpcUrl;
  process.env.JEJU_RPC_URL = status.rpcUrl;
  process.env.DWS_URL = status.dwsUrl;
  process.env.STORAGE_API_URL = `${status.dwsUrl}/storage`;
  process.env.COMPUTE_MARKETPLACE_URL = `${status.dwsUrl}/compute`;
  process.env.IPFS_GATEWAY = `${status.dwsUrl}/cdn`;
  process.env.CDN_URL = `${status.dwsUrl}/cdn`;
}

/**
 * Teardown test infrastructure
 * Call this in afterAll
 */
export async function teardown(): Promise<void> {
  if (!setupComplete) return;
  
  // Don't stop externally managed infrastructure
  if (isExternalInfra) {
    console.log('Skipping teardown (external infrastructure)');
    return;
  }

  console.log('\n=== Test Teardown ===\n');

  await stopProcess(dwsProcess);
  dwsProcess = null;

  await stopProcess(localnetProcess);
  localnetProcess = null;

  setupComplete = false;
  console.log('Teardown complete');
}

/**
 * Get current infrastructure status
 */
export async function getStatus(): Promise<InfraStatus> {
  return checkInfrastructure();
}

/**
 * Check if setup has been run
 */
export function isReady(): boolean {
  return setupComplete;
}

// Handle process exit
process.on('beforeExit', async () => {
  await teardown();
});

process.on('SIGINT', async () => {
  await teardown();
  process.exit(130);
});

process.on('SIGTERM', async () => {
  await teardown();
  process.exit(143);
});

// Auto-run setup when imported as preload
if (process.env.BUN_TEST === 'true' || process.argv.includes('test')) {
  setup().catch(console.error);
}

export default { setup, teardown, getStatus, isReady };

