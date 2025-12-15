/**
 * Test Setup - Auto-starts services for integration tests
 * 
 * This setup automatically starts localnet and required services
 * before tests run, and cleans up afterward.
 * 
 * Usage:
 *   bun test --preload ./test/setup.ts
 *   OR: import './setup' in test files
 */

import { execa, type ExecaChildProcess } from "execa";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import type { Hex } from "viem";

// Configuration
const TEST_LOCK_FILE = "/tmp/jeju-test-services.lock";
const STARTUP_TIMEOUT = 60000;
const DEPLOYER_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// Service URLs
export const TEST_RPC_URL = process.env.TEST_RPC_URL || "http://127.0.0.1:8545";
export const TEST_STORAGE_URL = process.env.TEST_STORAGE_URL || "http://127.0.0.1:4010";
export const TEST_COMPUTE_URL = process.env.TEST_COMPUTE_URL || "http://127.0.0.1:4007";
export const TEST_GATEWAY_URL = process.env.TEST_GATEWAY_URL || "http://127.0.0.1:4003";
export const TEST_PRIVATE_KEY = DEPLOYER_KEY;

// Track processes we start
let startedProcesses: ExecaChildProcess[] = [];
let servicesStarted = false;
let rootDir: string | null = null;

/**
 * Find the monorepo root
 */
function findRoot(): string {
  if (rootDir) return rootDir;
  
  let dir = process.cwd();
  while (dir !== "/") {
    if (existsSync(join(dir, "bun.lock")) && existsSync(join(dir, "packages"))) {
      rootDir = dir;
      return dir;
    }
    dir = resolve(dir, "..");
  }
  return process.cwd();
}

/**
 * Check if a service is healthy
 */
async function isServiceHealthy(url: string, isRpc = false): Promise<boolean> {
  try {
    if (isRpc) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", id: 1 }),
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    }
    
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Wait for a service to become healthy
 */
async function waitForService(name: string, url: string, isRpc = false, timeout = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await isServiceHealthy(url, isRpc)) {
      console.log(`✓ ${name} ready`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${name} did not start within ${timeout}ms`);
}

/**
 * Check if another test process is managing services
 */
function isLocked(): boolean {
  if (!existsSync(TEST_LOCK_FILE)) return false;
  
  try {
    const lockData = JSON.parse(readFileSync(TEST_LOCK_FILE, "utf-8"));
    const age = Date.now() - lockData.timestamp;
    // Lock expires after 5 minutes
    return age < 300000;
  } catch {
    return false;
  }
}

/**
 * Acquire lock for service management
 */
function acquireLock(): boolean {
  if (isLocked()) return false;
  
  writeFileSync(TEST_LOCK_FILE, JSON.stringify({
    pid: process.pid,
    timestamp: Date.now(),
  }));
  return true;
}

/**
 * Release lock
 */
function releaseLock(): void {
  try {
    if (existsSync(TEST_LOCK_FILE)) {
      const lockData = JSON.parse(readFileSync(TEST_LOCK_FILE, "utf-8"));
      if (lockData.pid === process.pid) {
        require("fs").unlinkSync(TEST_LOCK_FILE);
      }
    }
  } catch {
    // Ignore
  }
}

/**
 * Start localnet using Anvil
 */
async function startLocalnet(): Promise<void> {
  const root = findRoot();
  console.log("Starting Anvil localnet...");
  
  // Use Anvil for testing
  const proc = execa("anvil", [
    "--port", "8545",
    "--chain-id", "1337",
    "--accounts", "10",
    "--balance", "10000",
    "--silent",
  ], {
    cwd: root,
    stdio: "pipe",
    detached: true,
  });
  startedProcesses.push(proc);
  
  await waitForService("Chain", TEST_RPC_URL, true, STARTUP_TIMEOUT);
}

/**
 * Deploy contracts to localnet
 */
async function deployContracts(): Promise<void> {
  const root = findRoot();
  const contractsDir = join(root, "packages/contracts");
  
  if (!existsSync(join(contractsDir, "foundry.toml"))) {
    console.log("No contracts to deploy");
    return;
  }
  
  console.log("Deploying contracts...");
  
  try {
    await execa("forge", [
      "script",
      "script/Deploy.s.sol:DeployAll",
      "--rpc-url", TEST_RPC_URL,
      "--private-key", DEPLOYER_KEY,
      "--broadcast",
    ], {
      cwd: contractsDir,
      stdio: "pipe",
    });
    console.log("✓ Contracts deployed");
  } catch (error) {
    console.log("⚠ Contract deployment failed (may already be deployed)");
  }
}

/**
 * Start app services (storage, compute, gateway)
 */
async function startServices(): Promise<void> {
  const root = findRoot();
  
  // Start each service
  const services = [
    { name: "Storage", dir: "apps/storage", port: 4010, cmd: "bun run dev:api" },
    { name: "Compute", dir: "apps/compute", port: 4007, cmd: "bun run dev" },
    { name: "Gateway", dir: "apps/gateway", port: 4003, cmd: "bun run start:a2a" },
  ];
  
  for (const svc of services) {
    const svcDir = join(root, svc.dir);
    if (!existsSync(svcDir)) continue;
    
    console.log(`Starting ${svc.name}...`);
    
    const [cmd, ...args] = svc.cmd.split(" ");
    const proc = execa(cmd, args, {
      cwd: svcDir,
      stdio: "pipe",
      detached: true,
      env: {
        ...process.env,
        PORT: String(svc.port),
        RPC_URL: TEST_RPC_URL,
        CHAIN_ID: "1337",
      },
    });
    startedProcesses.push(proc);
  }
  
  // Wait for services to be ready
  await Promise.all([
    waitForService("Storage", TEST_STORAGE_URL).catch(() => console.log("⚠ Storage not available")),
    waitForService("Compute", TEST_COMPUTE_URL).catch(() => console.log("⚠ Compute not available")),
    waitForService("Gateway", TEST_GATEWAY_URL).catch(() => console.log("⚠ Gateway not available")),
  ]);
}

/**
 * Stop all started services
 */
async function stopServices(): Promise<void> {
  console.log("Stopping test services...");
  
  for (const proc of startedProcesses) {
    try {
      proc.kill("SIGTERM");
    } catch {
      // Ignore
    }
  }
  
  startedProcesses = [];
  releaseLock();
}

/**
 * Initialize test environment
 * Call this in beforeAll() or at start of tests
 */
export async function setupTestEnvironment(): Promise<{
  rpcUrl: string;
  storageUrl: string;
  computeUrl: string;
  gatewayUrl: string;
  privateKey: Hex;
  chainRunning: boolean;
  servicesRunning: boolean;
}> {
  // Check if services are already running
  const chainRunning = await isServiceHealthy(TEST_RPC_URL, true);
  const storageRunning = await isServiceHealthy(TEST_STORAGE_URL);
  const computeRunning = await isServiceHealthy(TEST_COMPUTE_URL);
  const gatewayRunning = await isServiceHealthy(TEST_GATEWAY_URL);
  
  if (chainRunning && storageRunning && computeRunning && gatewayRunning) {
    console.log("All services already running");
    return {
      rpcUrl: TEST_RPC_URL,
      storageUrl: TEST_STORAGE_URL,
      computeUrl: TEST_COMPUTE_URL,
      gatewayUrl: TEST_GATEWAY_URL,
      privateKey: TEST_PRIVATE_KEY,
      chainRunning: true,
      servicesRunning: true,
    };
  }
  
  // Try to acquire lock and start services
  if (!servicesStarted && acquireLock()) {
    try {
      if (!chainRunning) {
        await startLocalnet();
        await deployContracts();
      }
      
      if (!storageRunning || !computeRunning || !gatewayRunning) {
        await startServices();
      }
      
      servicesStarted = true;
      
      // Register cleanup
      process.on("exit", stopServices);
      process.on("SIGINT", async () => { await stopServices(); process.exit(130); });
      process.on("SIGTERM", async () => { await stopServices(); process.exit(143); });
      
    } catch (error) {
      console.error("Failed to start services:", error);
      releaseLock();
    }
  }
  
  // Final status check
  const finalChainStatus = await isServiceHealthy(TEST_RPC_URL, true);
  const finalServicesStatus = (
    await isServiceHealthy(TEST_STORAGE_URL) &&
    await isServiceHealthy(TEST_COMPUTE_URL) &&
    await isServiceHealthy(TEST_GATEWAY_URL)
  );
  
  return {
    rpcUrl: TEST_RPC_URL,
    storageUrl: TEST_STORAGE_URL,
    computeUrl: TEST_COMPUTE_URL,
    gatewayUrl: TEST_GATEWAY_URL,
    privateKey: TEST_PRIVATE_KEY,
    chainRunning: finalChainStatus,
    servicesRunning: finalServicesStatus,
  };
}

/**
 * Cleanup test environment
 * Call this in afterAll()
 */
export async function teardownTestEnvironment(): Promise<void> {
  await stopServices();
}

// Export for easy testing
export { isServiceHealthy, waitForService };

