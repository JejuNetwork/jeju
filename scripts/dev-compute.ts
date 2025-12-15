#!/usr/bin/env bun
/**
 * Start compute development environment
 * 
 * Starts:
 * - Anvil (local blockchain)
 * - Deploys compute contracts
 * - Worker runtime server
 * - Compute node
 * - Seeds local providers
 */

import { $ } from 'bun';
import { spawn } from 'node:child_process';

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const RPC_URL = 'http://127.0.0.1:9545';

interface Service {
  name: string;
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
  port?: number;
  healthCheck?: string;
}

const services: Service[] = [
  {
    name: 'anvil',
    command: ['anvil', '--port', '9545', '--block-time', '1'],
    port: 9545,
    healthCheck: RPC_URL,
  },
  {
    name: 'compute-node',
    command: ['bun', 'run', 'dev:test'],
    cwd: 'apps/compute',
    env: { COMPUTE_PORT: '4007', RPC_URL },
    port: 4007,
  },
  {
    name: 'worker-runtime',
    command: ['bun', 'run', 'workers:dev'],
    cwd: 'apps/compute',
    env: { WORKER_SERVER_PORT: '4020', RPC_URL },
    port: 4020,
  },
  {
    name: 'mpc-node',
    command: ['bun', 'run', 'mpc:dev'],
    cwd: 'apps/compute',
    env: { MPC_PORT: '4010', RPC_URL },
    port: 4010,
  },
];

const processes: Map<string, ReturnType<typeof spawn>> = new Map();

async function checkPort(port: number): Promise<boolean> {
  const result = await $`lsof -i :${port}`.quiet().nothrow();
  return result.exitCode !== 0; // Port is available if lsof fails
}

async function waitForHealth(url: string, maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await $`curl -s ${url}`.quiet().nothrow();
    if (result.exitCode === 0) return true;
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function deployContracts(): Promise<Record<string, string>> {
  console.log('📜 Deploying compute contracts...');
  
  const result = await $`cd packages/contracts && forge script script/Deploy.s.sol:DeployScript --rpc-url ${RPC_URL} --broadcast --private-key ${TEST_PRIVATE_KEY}`.quiet().nothrow();
  
  if (result.exitCode !== 0) {
    console.error('⚠️  Contract deployment failed, using mock addresses');
    return {
      COMPUTE_REGISTRY_ADDRESS: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      WORKER_REGISTRY_ADDRESS: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
      LEDGER_ADDRESS: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
      INFERENCE_ADDRESS: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
    };
  }

  // Parse addresses from broadcast output
  // For now, return mock addresses
  return {
    COMPUTE_REGISTRY_ADDRESS: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    WORKER_REGISTRY_ADDRESS: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    LEDGER_ADDRESS: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    INFERENCE_ADDRESS: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
  };
}

async function seedLocalProviders(addresses: Record<string, string>): Promise<void> {
  console.log('🌱 Seeding local providers...');
  
  const env = {
    ...process.env,
    PROVIDER_PRIVATE_KEY: TEST_PRIVATE_KEY,
    COMPUTE_REGISTRY_ADDRESS: addresses.COMPUTE_REGISTRY_ADDRESS,
    WORKER_REGISTRY_ADDRESS: addresses.WORKER_REGISTRY_ADDRESS,
    RPC_URL,
  };

  const result = await $`bun scripts/seed-providers.ts --network localnet --dry-run`.env(env).quiet().nothrow();
  
  if (result.exitCode === 0) {
    console.log('✅ Local providers seeded (dry run)');
  } else {
    console.log('⚠️  Provider seeding skipped (contracts not fully deployed)');
  }
}

async function startService(service: Service): Promise<void> {
  if (service.port && !await checkPort(service.port)) {
    console.log(`⚠️  Port ${service.port} in use, skipping ${service.name}`);
    return;
  }

  const env = { ...process.env, ...service.env };
  const cwd = service.cwd ? `${process.cwd()}/${service.cwd}` : process.cwd();

  console.log(`🚀 Starting ${service.name}...`);

  const proc = spawn(service.command[0], service.command.slice(1), {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout?.on('data', (data) => {
    const lines = data.toString().split('\n').filter((l: string) => l.trim());
    lines.forEach((line: string) => console.log(`[${service.name}] ${line}`));
  });

  proc.stderr?.on('data', (data) => {
    const lines = data.toString().split('\n').filter((l: string) => l.trim());
    lines.forEach((line: string) => console.log(`[${service.name}] ${line}`));
  });

  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.log(`⚠️  ${service.name} exited with code ${code}`);
    }
    processes.delete(service.name);
  });

  processes.set(service.name, proc);

  // Wait for health check
  if (service.healthCheck) {
    const healthy = await waitForHealth(service.healthCheck);
    if (!healthy) {
      console.log(`⚠️  ${service.name} health check failed`);
    }
  } else if (service.port) {
    await new Promise(r => setTimeout(r, 2000)); // Give it time to start
  }
}

async function shutdown(): Promise<void> {
  console.log('\n🛑 Shutting down services...');
  for (const [name, proc] of processes) {
    console.log(`   Stopping ${name}...`);
    proc.kill('SIGTERM');
  }
  process.exit(0);
}

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║              Jeju Compute Dev Environment                  ║
╠═══════════════════════════════════════════════════════════╣
║  Anvil RPC:      http://127.0.0.1:9545                    ║
║  Compute Node:   http://127.0.0.1:4007                    ║
║  Worker Runtime: http://127.0.0.1:4020                    ║
║  MPC Node:       http://127.0.0.1:4010                    ║
╚═══════════════════════════════════════════════════════════╝
`);

  // Handle shutdown
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start anvil first
  await startService(services[0]);
  await new Promise(r => setTimeout(r, 2000));

  // Deploy contracts
  const addresses = await deployContracts();
  
  // Update service env with contract addresses
  for (const service of services.slice(1)) {
    service.env = { ...service.env, ...addresses };
  }

  // Start other services
  for (const service of services.slice(1)) {
    await startService(service);
  }

  // Seed providers
  await seedLocalProviders(addresses);

  console.log(`
✅ Dev environment ready!

Available services:
  • Anvil RPC:      curl http://127.0.0.1:9545
  • Compute Node:   curl http://127.0.0.1:4007/health
  • Worker Runtime: curl http://127.0.0.1:4020/health
  • MPC Node:       curl http://127.0.0.1:4010/health

Deploy a worker:
  curl -X POST http://127.0.0.1:4020/api/v1/workers \\
    -H "Content-Type: application/json" \\
    -d '{"name":"hello","code":"export default { fetch() { return { status: 200, body: \"Hello!\" }; } }"}'

Press Ctrl+C to stop all services.
`);

  // Keep running
  await new Promise(() => {});
}

main().catch(console.error);
