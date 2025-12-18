#!/usr/bin/env bun
/**
 * Autocrat Dev Startup
 * Ensures localnet + contracts + DWS are ready, then starts Autocrat server
 * 
 * All contracts are auto-deployed and DAOs are seeded on startup.
 */

import { existsSync } from 'fs';
import { join } from 'path';

// Use port 8545 (geth dev) if available, otherwise 9545 (anvil)
const RPC_PORT = parseInt(process.env.RPC_PORT ?? '8545');
const DWS_PORT = 4030;
const AUTOCRAT_PORT = parseInt(process.env.PORT ?? '8010');
const DEPLOYER_KEY = process.env.DEPLOYER_KEY ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// Deployed contract addresses (set after deployment)
let contractAddresses: Record<string, string> = {};

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

async function checkRpc(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}`, {
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

async function ensureDeployerFunded(rpcUrl: string): Promise<void> {
  // Get the geth dev account (has funds)
  const accountsResp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_accounts', params: [], id: 1 }),
  });
  const accounts = await accountsResp.json() as { result: string[] };
  const devAccount = accounts.result?.[0];
  
  if (!devAccount) {
    console.log('⚠️  No dev account found - using deployer key directly');
    return;
  }

  // Check deployer balance
  const deployerAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  const balanceResp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [deployerAddress, 'latest'], id: 1 }),
  });
  const balance = await balanceResp.json() as { result: string };
  
  if (BigInt(balance.result) < BigInt('1000000000000000000')) {
    console.log('💰 Funding deployer account...');
    await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_sendTransaction',
        params: [{ from: devAccount, to: deployerAddress, value: '0x8ac7230489e80000' }], // 10 ETH
        id: 1,
      }),
    });
    await Bun.sleep(2000); // Wait for tx
    console.log('✅ Deployer funded');
  }
}

async function checkDAORegistryDeployed(rpcUrl: string, addr: string): Promise<boolean> {
  if (!addr || addr === '0x0000000000000000000000000000000000000000') return false;
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getCode', params: [addr, 'latest'], id: 1 }),
    });
    const data = await response.json() as { result: string };
    return data.result && data.result !== '0x' && data.result.length > 2;
  } catch {
    return false;
  }
}

async function deployDAOContracts(rootDir: string, rpcUrl: string): Promise<boolean> {
  // Check if already deployed from env
  const existingRegistry = process.env.DAO_REGISTRY_ADDRESS;
  if (existingRegistry && await checkDAORegistryDeployed(rpcUrl, existingRegistry)) {
    console.log('✅ DAO contracts already deployed');
    contractAddresses = {
      DAO_REGISTRY: existingRegistry,
      DAO_FUNDING: process.env.DAO_FUNDING_ADDRESS ?? '',
      FEE_CONFIG: process.env.FEE_CONFIG_ADDRESS ?? '',
    };
    return true;
  }

  console.log('📦 Deploying DAO contracts...');
  
  // Ensure deployer has funds
  await ensureDeployerFunded(rpcUrl);
  
  // Run forge deployment
  const contractsDir = join(rootDir, 'packages', 'contracts');
  const proc = Bun.spawn(['forge', 'script', 'script/DeployDAORegistry.s.sol', '--rpc-url', rpcUrl, '--broadcast'], {
    cwd: contractsDir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, DEPLOYER_KEY },
  });

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    console.error('❌ Contract deployment failed:', stderr);
    return false;
  }

  // Parse deployed addresses from output
  const registryMatch = output.match(/DAO_REGISTRY_ADDRESS=\s*(0x[a-fA-F0-9]+)/);
  const fundingMatch = output.match(/DAO_FUNDING_ADDRESS=\s*(0x[a-fA-F0-9]+)/);
  const feeConfigMatch = output.match(/FEE_CONFIG_ADDRESS=\s*(0x[a-fA-F0-9]+)/);
  
  if (registryMatch) {
    contractAddresses = {
      DAO_REGISTRY: registryMatch[1],
      DAO_FUNDING: fundingMatch?.[1] ?? '',
      FEE_CONFIG: feeConfigMatch?.[1] ?? '',
    };
    console.log('✅ DAO contracts deployed:');
    console.log(`   DAORegistry: ${contractAddresses.DAO_REGISTRY}`);
    console.log(`   DAOFunding: ${contractAddresses.DAO_FUNDING}`);
    console.log(`   FeeConfig: ${contractAddresses.FEE_CONFIG}`);
    return true;
  }

  // Fallback: check common deployment addresses
  const commonAddresses = [
    '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  ];
  
  for (const addr of commonAddresses) {
    if (await checkDAORegistryDeployed(rpcUrl, addr)) {
      contractAddresses.DAO_REGISTRY = addr;
      contractAddresses.DAO_FUNDING = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
      contractAddresses.FEE_CONFIG = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
      console.log('✅ Found deployed contracts');
      return true;
    }
  }
  
  console.log('⚠️  Could not verify deployment');
  return false;
}

async function checkInferenceProvider(): Promise<{ provider: string; available: boolean }> {
  const providers = [
    { name: 'groq', env: 'GROQ_API_KEY' },
    { name: 'openrouter', env: 'OPENROUTER_API_KEY' },
    { name: 'openai', env: 'OPENAI_API_KEY' },
    { name: 'anthropic', env: 'ANTHROPIC_API_KEY' },
    { name: 'together', env: 'TOGETHER_API_KEY' },
  ];
  
  for (const p of providers) {
    if (process.env[p.env]) {
      return { provider: p.name, available: true };
    }
  }
  
  return { provider: 'none', available: false };
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
      RPC_URL: `http://127.0.0.1:${RPC_PORT}`,
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
  const rpcUrl = `http://127.0.0.1:${RPC_PORT}`;
  
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║       AUTOCRAT MULTI-DAO GOVERNANCE        ║');
  console.log('╚════════════════════════════════════════════╝\n');

  // Check RPC
  if (!(await checkRpc(RPC_PORT))) {
    console.log(`❌ RPC not available at port ${RPC_PORT}`);
    console.log('   Start with: docker compose up -d');
    process.exit(1);
  }
  console.log(`✅ RPC available at port ${RPC_PORT}`);

  // Deploy contracts
  if (process.env.SKIP_DEPLOY !== 'true') {
    await deployDAOContracts(rootDir, rpcUrl);
  }

  // Check/start DWS
  if (!(await checkDws())) {
    if (!(await startDws(rootDir))) {
      console.log('⚠️  DWS not available');
    }
  } else {
    console.log('✅ DWS already running');
  }

  // Check inference provider
  const inference = await checkInferenceProvider();
  if (inference.available) {
    console.log(`✅ Inference provider: ${inference.provider}`);
  } else {
    console.log('⚠️  No inference provider configured');
    console.log('   Set one of: GROQ_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY');
    console.log('   Get free key: https://console.groq.com');
  }

  // Set environment
  process.env.RPC_URL = rpcUrl;
  process.env.JEJU_RPC_URL = rpcUrl;
  process.env.L2_RPC_URL = rpcUrl;
  process.env.DWS_URL = `http://127.0.0.1:${DWS_PORT}`;
  process.env.DWS_COMPUTE_URL = `http://127.0.0.1:${DWS_PORT}/compute`;
  process.env.PORT = String(AUTOCRAT_PORT);
  process.env.PRIVATE_KEY = process.env.PRIVATE_KEY ?? DEPLOYER_KEY;
  
  // Set contract addresses
  if (contractAddresses.DAO_REGISTRY) {
    process.env.DAO_REGISTRY_ADDRESS = contractAddresses.DAO_REGISTRY;
    process.env.DAO_FUNDING_ADDRESS = contractAddresses.DAO_FUNDING;
    process.env.FEE_CONFIG_ADDRESS = contractAddresses.FEE_CONFIG;
  }

  console.log(`\n🤖 Starting Autocrat on port ${AUTOCRAT_PORT}...\n`);

  // Import and run the server directly
  await import('../src/index.ts');
}

main().catch(console.error);

