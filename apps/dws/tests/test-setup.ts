/**
 * DWS Test Setup
 * 
 * This file sets up the test environment including:
 * - Starting anvil (local blockchain)
 * - Deploying contracts
 * - Registering a mock inference node
 * - Starting DWS server
 */

import { spawn, type Subprocess } from 'bun';
import { existsSync } from 'fs';
import { join } from 'path';

let anvilProcess: Subprocess | null = null;
let dwsProcess: Subprocess | null = null;
let inferenceProcess: Subprocess | null = null;
let isSetup = false;

const ANVIL_PORT = 9545;
const DWS_PORT = 4030;
const INFERENCE_PORT = 4031;

const RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;
const DWS_URL = `http://127.0.0.1:${DWS_PORT}`;
const INFERENCE_URL = `http://127.0.0.1:${INFERENCE_PORT}`;

function findMonorepoRoot(): string {
  let dir = import.meta.dir;
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

async function waitForService(url: string, path = '/health', maxAttempts = 60): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch {
      // Keep trying
    }
    await Bun.sleep(500);
  }
  return false;
}

async function waitForAnvil(): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return true;
    } catch {
      // Keep trying
    }
    await Bun.sleep(500);
  }
  return false;
}

async function startAnvil(): Promise<boolean> {
  console.log('[Test Setup] Starting Anvil...');
  
  // Check if already running
  if (await waitForAnvil()) {
    console.log('[Test Setup] Anvil already running');
    return true;
  }
  
  const anvil = Bun.which('anvil');
  if (!anvil) {
    console.error('[Test Setup] Anvil not found. Install: curl -L https://foundry.paradigm.xyz | bash');
    return false;
  }
  
  anvilProcess = spawn([anvil, '--port', String(ANVIL_PORT), '--chain-id', '1337', '--silent'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  
  if (await waitForAnvil()) {
    console.log('[Test Setup] Anvil started');
    return true;
  }
  
  console.error('[Test Setup] Failed to start Anvil');
  return false;
}

async function deployContracts(): Promise<boolean> {
  console.log('[Test Setup] Deploying contracts...');
  
  const rootDir = findMonorepoRoot();
  const bootstrapScript = join(rootDir, 'scripts', 'bootstrap', 'bootstrap-localnet-complete.ts');
  
  if (!existsSync(bootstrapScript)) {
    console.warn('[Test Setup] No bootstrap script found, skipping contract deployment');
    return true;
  }
  
  const proc = spawn(['bun', 'run', bootstrapScript], {
    cwd: rootDir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { 
      ...process.env, 
      JEJU_RPC_URL: RPC_URL,
      L2_RPC_URL: RPC_URL,
    },
  });
  
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    console.error('[Test Setup] Contract deployment failed:', stderr);
    return false;
  }
  
  console.log('[Test Setup] Contracts deployed');
  return true;
}

async function startDWS(): Promise<boolean> {
  console.log('[Test Setup] Starting DWS server...');
  
  // Check if already running
  if (await waitForService(DWS_URL, '/health', 5)) {
    console.log('[Test Setup] DWS already running');
    return true;
  }
  
  const rootDir = findMonorepoRoot();
  const dwsDir = join(rootDir, 'apps', 'dws');
  
  dwsProcess = spawn(['bun', 'run', 'src/server/index.ts'], {
    cwd: dwsDir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      PORT: String(DWS_PORT),
      L2_RPC_URL: RPC_URL,
      JEJU_RPC_URL: RPC_URL,
      BOOTSTRAP_CONTRACTS: 'false',
    },
  });
  
  if (await waitForService(DWS_URL, '/health', 30)) {
    console.log('[Test Setup] DWS started');
    return true;
  }
  
  console.error('[Test Setup] Failed to start DWS');
  return false;
}

async function registerMockInferenceNode(): Promise<boolean> {
  console.log('[Test Setup] Registering mock inference node...');
  
  // Register a mock node that returns test responses
  try {
    const response = await fetch(`${DWS_URL}/compute/nodes/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: 'test-inference-node',
        endpoint: INFERENCE_URL,
        gpuTier: 1,
        capabilities: ['inference', 'embeddings'],
        provider: 'mock',
        models: ['*'],
        region: 'test',
        maxConcurrent: 100,
      }),
    });
    
    if (!response.ok) {
      console.warn('[Test Setup] Failed to register mock node:', await response.text());
      return false;
    }
    
    console.log('[Test Setup] Mock inference node registered');
    return true;
  } catch (error) {
    console.warn('[Test Setup] Could not register mock node:', (error as Error).message);
    return false;
  }
}

async function startMockInferenceServer(): Promise<boolean> {
  console.log('[Test Setup] Starting mock inference server...');
  
  // Check if already running
  if (await waitForService(INFERENCE_URL, '/health', 3)) {
    console.log('[Test Setup] Mock inference server already running');
    return true;
  }
  
  // Start a simple mock server
  const server = Bun.serve({
    port: INFERENCE_PORT,
    fetch: async (req) => {
      const url = new URL(req.url);
      
      if (url.pathname === '/health') {
        return Response.json({ status: 'healthy', provider: 'mock' });
      }
      
      if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
        const body = await req.json() as { model?: string; messages?: Array<{ content: string }> };
        return Response.json({
          id: `chatcmpl-test-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: body.model || 'mock-model',
          provider: 'mock',
          choices: [{
            index: 0,
            message: { 
              role: 'assistant', 
              content: `Mock response to: ${body.messages?.[0]?.content || 'test'}` 
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        });
      }
      
      if (url.pathname === '/v1/embeddings' && req.method === 'POST') {
        return Response.json({
          object: 'list',
          data: [{ object: 'embedding', index: 0, embedding: Array(1536).fill(0) }],
          model: 'mock-embeddings',
          usage: { prompt_tokens: 10, total_tokens: 10 },
        });
      }
      
      return new Response('Not Found', { status: 404 });
    },
  });
  
  // Store the server ref so it doesn't get GC'd
  (globalThis as Record<string, unknown>)._mockInferenceServer = server;
  
  console.log('[Test Setup] Mock inference server started');
  return true;
}

export async function setup(): Promise<void> {
  if (isSetup) return;
  
  console.log('\n[Test Setup] Setting up test environment...\n');
  
  // Start anvil
  if (!(await startAnvil())) {
    throw new Error('Failed to start Anvil');
  }
  
  // Deploy contracts
  if (!(await deployContracts())) {
    throw new Error('Failed to deploy contracts');
  }
  
  // Start mock inference server first
  if (!(await startMockInferenceServer())) {
    throw new Error('Failed to start mock inference server');
  }
  
  // Start DWS
  if (!(await startDWS())) {
    throw new Error('Failed to start DWS');
  }
  
  // Wait a bit for DWS to fully initialize
  await Bun.sleep(1000);
  
  // Register mock inference node
  await registerMockInferenceNode();
  
  isSetup = true;
  console.log('\n[Test Setup] Environment ready\n');
}

export async function teardown(): Promise<void> {
  console.log('[Test Setup] Cleaning up...');
  
  if (dwsProcess) {
    dwsProcess.kill();
    dwsProcess = null;
  }
  
  if (inferenceProcess) {
    inferenceProcess.kill();
    inferenceProcess = null;
  }
  
  // Don't kill anvil - let it run for faster test iterations
  // if (anvilProcess) {
  //   anvilProcess.kill();
  //   anvilProcess = null;
  // }
  
  const mockServer = (globalThis as Record<string, unknown>)._mockInferenceServer as { stop?: () => void } | undefined;
  if (mockServer?.stop) {
    mockServer.stop();
  }
  
  isSetup = false;
}

export function isReady(): boolean {
  return isSetup;
}

export async function getStatus(): Promise<{
  anvil: boolean;
  dws: boolean;
  inference: boolean;
  rpcUrl: string;
  dwsUrl: string;
  inferenceUrl: string;
}> {
  const [anvil, dws, inference] = await Promise.all([
    waitForAnvil().catch(() => false),
    waitForService(DWS_URL, '/health', 3).catch(() => false),
    waitForService(INFERENCE_URL, '/health', 3).catch(() => false),
  ]);
  
  return {
    anvil,
    dws,
    inference,
    rpcUrl: RPC_URL,
    dwsUrl: DWS_URL,
    inferenceUrl: INFERENCE_URL,
  };
}

export function getTestEnv(): { dwsUrl: string; rpcUrl: string; inferenceUrl: string } {
  return {
    dwsUrl: process.env.DWS_URL || DWS_URL,
    rpcUrl: process.env.L2_RPC_URL || RPC_URL,
    inferenceUrl: process.env.INFERENCE_URL || INFERENCE_URL,
  };
}

// Export for direct usage
export { RPC_URL, DWS_URL, INFERENCE_URL };

