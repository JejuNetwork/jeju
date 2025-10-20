#!/usr/bin/env bun
/**
 * @fileoverview Complete Jeju Development Environment  
 * @module scripts/dev
 * 
 * ONE COMMAND STARTS EVERYTHING:
 * - Kurtosis Localnet (L1 + L2)
 * - Subsquid Indexer + GraphQL
 * - Node Explorer (UI + API + Collector)
 * - Documentation (VitePress)
 * - ALL APPS (apps/ directory)
 * - ALL VENDOR APPS (vendor/ directory)
 * 
 * Usage:
 *   bun run dev    # Starts everything, auto-managed lifecycle
 * 
 * Lifecycle:
 *   - Auto starts: localnet + indexer + all services + all apps
 *   - Ctrl+C: Stops everything cleanly, no orphans
 *   - No manual intervention needed
 */

import { $ } from "bun";
import { spawn, type Subprocess } from "bun";
import { existsSync } from "fs";
import { join } from "path";
import { discoverAllApps, displayAppsSummary, getAutoStartApps, type JejuApp } from "./shared/discover-apps";
import { CORE_PORTS, INFRA_PORTS } from "../config/ports";

// Configuration
const minimal = process.argv.includes("--minimal");
const noApps = process.argv.includes("--no-apps");
const maxAppsArg = process.argv.find(arg => arg.startsWith("--max-apps="));
const maxApps = maxAppsArg ? parseInt(maxAppsArg.split("=")[1]) : undefined;

const processes: Subprocess[] = [];
const services: Map<string, ServiceInfo> = new Map();

interface ServiceInfo {
  name: string;
  description: string;
  url?: string;
  port?: number;
  status: "starting" | "running" | "error" | "stopped";
  process?: Subprocess;
  category: "core" | "indexer" | "monitoring" | "docs" | "apps";
}

// Colors
const COLORS = {
  RESET: '\x1b[0m',
  BRIGHT: '\x1b[1m',
  DIM: '\x1b[2m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  RED: '\x1b[31m',
  BLUE: '\x1b[34m',
  CYAN: '\x1b[36m',
  MAGENTA: '\x1b[35m',
};

// Cleanup handler
let isShuttingDown = false;

async function cleanup() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log("\n\n🛑 Shutting down all services...\n");
  
  // Kill all spawned processes
  for (const proc of processes) {
    try {
      proc.kill();
    } catch (e) {
      // Ignore errors
    }
  }
  
  // Stop localnet
  console.log("🧹 Stopping localnet...");
  await $`bun run scripts/localnet/stop.ts`.nothrow().quiet();
  
  // Stop indexer
  console.log("🧹 Stopping indexer...");
  await $`cd apps/indexer && npm run db:down`.nothrow().quiet();
  
  // Clean node explorer database
  console.log("🧹 Cleaning node explorer database...");
  await $`rm -f apps/node-explorer/node-explorer.db`.nothrow().quiet();
  
  console.log("\n✅ All services stopped\n");
}

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(0);
});

// Handle unhandled errors
process.on("uncaughtException", async (error) => {
  console.error("\n❌ Uncaught exception:", error);
  await cleanup();
  process.exit(1);
});

process.on("unhandledRejection", async (reason) => {
  console.error("\n❌ Unhandled rejection:", reason);
  await cleanup();
  process.exit(1);
});

/**
 * Print header
 */
function printHeader() {
  console.clear();
  console.log(`
${COLORS.CYAN}${COLORS.BRIGHT}🌴 Jeju Localnet${COLORS.RESET}`);
}

/**
 * Check if a service is responding
 */
async function healthCheck(url: string, timeout = 5000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const response = await fetch(url, { 
      signal: controller.signal,
      method: 'GET',
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if an RPC endpoint is responding (JSON-RPC POST request)
 */
async function rpcHealthCheck(url: string, timeout = 5000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const response = await fetch(url, { 
      signal: controller.signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) return false;
    
    const data = await response.json();
    return data.result !== undefined;
  } catch {
    return false;
  }
}


/**
 * Update service status
 */
function updateServiceStatus(id: string, status: ServiceInfo["status"]) {
  const service = services.get(id);
  if (service) {
    service.status = status;
  }
}

/**
 * Print beautiful status dashboard
 * @param skipClear - Skip clearing console to preserve error logs
 */
async function printDashboard(skipClear = false) {
  if (!skipClear) {
    console.clear();
  }
  
  console.log(`
${COLORS.GREEN}${COLORS.BRIGHT}╔═══════════════════════════════════════════════════════════════════════╗
║                                                                       ║
║   ✅ JEJU - Ready!                                                 ║
║   Press Ctrl+C to stop (auto cleanup)                                ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝${COLORS.RESET}

${COLORS.BRIGHT}🌐 SERVICES${COLORS.RESET}
`);

  // Core services
  const coreServices = Array.from(services.entries()).filter(([, s]) => s.category === "core");
  for (const [, service] of coreServices) {
    printServiceLine(service);
  }

  console.log(`\n${COLORS.BRIGHT}📊 INDEXER & DATA${COLORS.RESET}`);
  const indexerServices = Array.from(services.entries()).filter(([, s]) => s.category === "indexer");
  for (const [, service] of indexerServices) {
    printServiceLine(service);
  }

  if (!minimal) {
    console.log(`\n${COLORS.BRIGHT}📈 MONITORING${COLORS.RESET}`);
    const monitoringServices = Array.from(services.entries()).filter(([, s]) => s.category === "monitoring");
    for (const [, service] of monitoringServices) {
      printServiceLine(service);
    }

    console.log(`\n${COLORS.BRIGHT}📚 DOCUMENTATION${COLORS.RESET}`);
    const docsServices = Array.from(services.entries()).filter(([, s]) => s.category === "docs");
    for (const [, service] of docsServices) {
      printServiceLine(service);
    }

    if (!noApps) {
      console.log(`\n${COLORS.BRIGHT}🎮 APPS & GAMES${COLORS.RESET}`);
      const appServices = Array.from(services.entries()).filter(([, s]) => s.category === "apps");
      for (const [, service] of appServices) {
        printServiceLine(service);
      }
    }
  }

  // Use static L2 port for wallet config
  const walletRpcUrl = "http://127.0.0.1:9545";

  console.log(`
${COLORS.CYAN}${COLORS.BRIGHT}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.RESET}
`);

  // Prominent wallet configuration section - ALWAYS VISIBLE
  console.log(`
${COLORS.MAGENTA}${COLORS.BRIGHT}╔═══════════════════════════════════════════════════════════════════════╗
║                                                                       ║
║   🦊 WALLET SETUP - Add Jeju Localnet to MetaMask                    ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝${COLORS.RESET}

${COLORS.BRIGHT}Open MetaMask → Networks → Add Network → Add Manually${COLORS.RESET}

  ${COLORS.CYAN}Network Name:${COLORS.RESET}   Jeju Localnet
  ${COLORS.CYAN}RPC URL:${COLORS.RESET}        ${COLORS.YELLOW}${COLORS.BRIGHT}${walletRpcUrl}${COLORS.RESET}  ${COLORS.RED}← COPY THIS (NEVER CHANGES!)${COLORS.RESET}
  ${COLORS.CYAN}Chain ID:${COLORS.RESET}       1337
  ${COLORS.CYAN}Currency:${COLORS.RESET}       ETH

${COLORS.GREEN}✅ This RPC URL is STATIC and never changes!${COLORS.RESET}
${COLORS.YELLOW}⚠️  IMPORTANT:${COLORS.RESET} This points to ${COLORS.BRIGHT}L2 (Jeju)${COLORS.RESET} where all apps/contracts live.

${COLORS.CYAN}💰 Pre-funded Test Account (Import to MetaMask):${COLORS.RESET}
   
   ${COLORS.BRIGHT}Private Key:${COLORS.RESET} 0xb71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291
   ${COLORS.BRIGHT}Address:${COLORS.RESET}     0x71562b71999873DB5b286dF957af199Ec94617F7
   ${COLORS.BRIGHT}Balance:${COLORS.RESET}     Unlimited ETH
   
   In MetaMask: ${COLORS.BRIGHT}Import Account${COLORS.RESET} → Paste private key above
`);

  console.log(`
${COLORS.CYAN}${COLORS.BRIGHT}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.RESET}

${COLORS.YELLOW}💡 Quick Actions:${COLORS.RESET}
  • Show wallet config: ${COLORS.BRIGHT}bun run wallet${COLORS.RESET}
  • Run tests:          bun run test
  • Deploy contracts:   bun run deploy:testnet
  • Stop services:      Ctrl+C (auto cleanup)

${COLORS.GREEN}✨ All systems running! Happy developing!${COLORS.RESET}
`);
}

/**
 * Print a single service line
 */
function printServiceLine(service: ServiceInfo) {
  const statusIcon = service.status === "running" ? "✅" : 
                     service.status === "starting" ? "🔄" :
                     service.status === "error" ? "❌" : "⏸️";
  
  const statusColor = service.status === "running" ? COLORS.GREEN : 
                      service.status === "starting" ? COLORS.YELLOW :
                      service.status === "error" ? COLORS.RED : COLORS.RESET;

  const nameWidth = 30;
  const name = service.name.padEnd(nameWidth);
  
  if (service.url) {
    const url = service.url.padEnd(40);
    console.log(`  ${statusIcon} ${COLORS.BRIGHT}${name}${COLORS.RESET} ${COLORS.CYAN}${url}${COLORS.RESET}`);
  } else {
    console.log(`  ${statusIcon} ${COLORS.BRIGHT}${name}${COLORS.RESET} ${statusColor}${service.status}${COLORS.RESET}`);
  }
}

/**
 * Wait for service to be healthy with progress indication
 */
async function waitForService(id: string, url: string, maxWait = 60000) {
  const startTime = Date.now();
  const interval = 2000;
  const serviceName = services.get(id)?.name || id;
  
  let attempts = 0;
  while (Date.now() - startTime < maxWait) {
    if (await healthCheck(url, 3000)) {
      updateServiceStatus(id, "running");
      console.log(`${COLORS.GREEN}✅ ${serviceName} is ready${COLORS.RESET}`);
      return true;
    }
    
    attempts++;
    if (attempts % 5 === 0) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      console.log(`${COLORS.YELLOW}   Still waiting for ${serviceName}... (${elapsed}s)${COLORS.RESET}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  updateServiceStatus(id, "error");
  console.log(`${COLORS.RED}❌ ${serviceName} failed to start (timeout after ${maxWait/1000}s)${COLORS.RESET}`);
  return false;
}


/**
 * Kill processes on specific ports to avoid conflicts
 * IMPORTANT: Skips Docker processes to avoid crashing Docker
 */
async function killPortProcesses(ports: number[]) {
  for (const port of ports) {
    console.log(`${COLORS.CYAN}🧹 Cleaning up port ${port}...${COLORS.RESET}`);
    
    // Get PIDs on this port
    const pidsResult = await $`lsof -ti:${port}`.nothrow().quiet();
    if (pidsResult.exitCode !== 0 || !pidsResult.stdout.toString().trim()) {
      continue; // No process on this port
    }
    
    const pids = pidsResult.stdout.toString().trim().split('\n');
    
    for (const pid of pids) {
      if (!pid) continue;
      
      // Check if this is a Docker process
      const psResult = await $`ps -p ${pid} -o command=`.nothrow().quiet();
      const command = psResult.stdout.toString();
      
      if (command.includes('docker') || command.includes('Docker')) {
        console.log(`${COLORS.YELLOW}   ⚠️  Skipping Docker process (PID ${pid}) on port ${port}${COLORS.RESET}`);
        continue;
      }
      
      // Safe to kill non-Docker process
      await $`kill -9 ${pid}`.nothrow().quiet();
    }
  }
}

/**
 * Setup static port forwarding from fixed ports to dynamic Kurtosis ports
 * This ensures wallets can always use the same RPC URLs
 */
async function setupPortForwarding(staticPort: number, dynamicPort: number, name: string): Promise<Subprocess | null> {
  console.log(`${COLORS.CYAN}🔗 Forwarding ${name}: localhost:${staticPort} → localhost:${dynamicPort}${COLORS.RESET}`);
  
  // Kill any existing process on the static port
  await $`lsof -ti:${staticPort} | xargs kill -9`.nothrow().quiet();
  
  // Check if socat is available
  const socatCheck = await $`which socat`.nothrow().quiet();
  
  if (socatCheck.exitCode === 0) {
    // Use socat for port forwarding (most reliable)
    const proc = spawn({
      cmd: ["socat", `TCP-LISTEN:${staticPort},fork,reuseaddr`, `TCP:127.0.0.1:${dynamicPort}`],
      stdout: "pipe",
      stderr: "pipe",
    });
    
    processes.push(proc);
    return proc;
  }
  
  // Fallback: use SSH local port forwarding (always available on macOS)
  const proc = spawn({
    cmd: ["ssh", "-N", "-L", `${staticPort}:127.0.0.1:${dynamicPort}`, "localhost"],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  
  processes.push(proc);
  return proc;
}

/**
 * Start a Jeju app from its manifest
 */
async function startJejuApp(app: JejuApp, l2RpcPort: string): Promise<void> {
  const devCommand = app.manifest.commands?.dev;
  
  if (!devCommand) {
    console.log(`${COLORS.YELLOW}   ⚠️  ${app.manifest.displayName || app.name}: No dev command${COLORS.RESET}`);
    return;
  }

  console.log(`${COLORS.CYAN}🚀 Starting ${app.manifest.displayName || app.name}...${COLORS.RESET}`);
  
  // Parse command
  const cmdParts = devCommand.split(' ');
  
  // Get ports from manifest with environment variable override support
  const appNameUpper = app.name.toUpperCase().replace(/-/g, '_');
  const mainPort = app.manifest.ports?.main;
  const apiPort = app.manifest.ports?.api;
  const uiPort = app.manifest.ports?.ui;
  const gamePort = app.manifest.ports?.game;
  const authPort = app.manifest.ports?.auth;
  
  // Build environment with prefixed variables
  const appEnv: Record<string, string> = {
    ...process.env,
    // RPC configuration (shared across all apps)
    RPC_URL: `http://localhost:${l2RpcPort}`,
    JEJU_RPC_URL: `http://localhost:${l2RpcPort}`,
    CHAIN_ID: "1337",
  };
  
  // Add port configuration with prefixed env var support
  if (mainPort) {
    const envVarName = `${appNameUpper}_PORT`;
    const port = process.env[envVarName] || mainPort.toString();
    appEnv.PORT = port;
    appEnv.VITE_PORT = port; // For Vite apps
    appEnv[envVarName] = port; // Prefixed version
  }
  
  if (apiPort) {
    appEnv[`${appNameUpper}_API_PORT`] = process.env[`${appNameUpper}_API_PORT`] || apiPort.toString();
    appEnv.API_PORT = apiPort.toString();
  }
  
  if (uiPort) {
    appEnv[`${appNameUpper}_UI_PORT`] = process.env[`${appNameUpper}_UI_PORT`] || uiPort.toString();
  }
  
  if (gamePort) {
    appEnv[`${appNameUpper}_GAME_PORT`] = process.env[`${appNameUpper}_GAME_PORT`] || gamePort.toString();
  }
  
  if (authPort) {
    appEnv[`${appNameUpper}_AUTH_PORT`] = process.env[`${appNameUpper}_AUTH_PORT`] || authPort.toString();
  }
  
  const proc = spawn({
    cmd: cmdParts,
    cwd: app.path,
    stdout: "pipe",
    stderr: "pipe",
    env: appEnv,
  });
  
  processes.push(proc);
  
  const serviceId = `${app.type}-${app.name}`;
  
  services.set(serviceId, {
    name: app.manifest.displayName || app.name,
    description: app.manifest.description || '',
    url: mainPort ? `http://localhost:${mainPort}` : undefined,
    port: mainPort,
    status: "starting",
    category: "apps",
    process: proc,
  });
  
  // Track stdout - log ALL output
  let isReady = false;
  (async () => {
    if (proc.stdout) {
      const stdout = proc.stdout as unknown as AsyncIterable<Uint8Array>;
      for await (const chunk of stdout) {
        const text = new TextDecoder().decode(chunk).trim();
        if (!text) continue;
        const lowerText = text.toLowerCase();
        
        // Always log output for visibility
        if (lowerText.includes('listening') || 
            lowerText.includes('ready') || 
            lowerText.includes('compiled successfully') ||
            lowerText.includes('local:') ||  // VitePress
            lowerText.includes('server running')) {  // Generic
          if (!isReady) {
            console.log(`${COLORS.GREEN}[${app.manifest.displayName || app.name} ✓]${COLORS.RESET} ${text}`);
            updateServiceStatus(serviceId, "running");
            isReady = true;
          }
        } else if (lowerText.includes('error')) {
          console.log(`${COLORS.RED}[${app.manifest.displayName || app.name} ERROR]${COLORS.RESET} ${text}`);
        } else {
          // Log other output in dimmed color to not overwhelm
          console.log(`${COLORS.DIM}[${app.manifest.displayName || app.name}]${COLORS.RESET} ${text}`);
        }
      }
    }
  })();
  
  // Track stderr - log ALL output, not just errors
  (async () => {
    if (proc.stderr) {
      const stderr = proc.stderr as unknown as AsyncIterable<Uint8Array>;
      for await (const chunk of stderr) {
        const text = new TextDecoder().decode(chunk).trim();
        if (!text) continue;
        
        // Log all stderr output with appropriate colors
        if (text.toLowerCase().includes('error') || text.toLowerCase().includes('fatal')) {
          console.log(`${COLORS.RED}[${app.manifest.displayName || app.name} ERROR]${COLORS.RESET} ${text}`);
        } else if (text.toLowerCase().includes('warn')) {
          console.log(`${COLORS.YELLOW}[${app.manifest.displayName || app.name} WARN]${COLORS.RESET} ${text}`);
        } else {
          // Log all other stderr output (some tools use stderr for normal output)
          console.log(`${COLORS.CYAN}[${app.manifest.displayName || app.name}]${COLORS.RESET} ${text}`);
        }
      }
    }
  })();
  
  console.log(`${COLORS.GREEN}✅ ${app.manifest.displayName || app.name} starting${mainPort ? ` on port ${mainPort}` : ''}${COLORS.RESET}`);
  
  // Wait for app to be ready (or timeout after 45 seconds)
  const startTime = Date.now();
  const timeout = 45000; // 45 seconds
  while (!isReady && (Date.now() - startTime) < timeout) {
    // Check if process is still alive
    if (proc.exitCode !== null) {
      console.log(`${COLORS.RED}❌ ${app.manifest.displayName || app.name} exited unexpectedly with code ${proc.exitCode}${COLORS.RESET}`);
      updateServiceStatus(serviceId, "error");
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  if (!isReady) {
    console.log(`${COLORS.YELLOW}⚠️  ${app.manifest.displayName || app.name} took longer than expected to start${COLORS.RESET}`);
    console.log(`${COLORS.YELLOW}   Process is still running, continuing anyway...${COLORS.RESET}`);
  }
  
  // Monitor for crashes after startup
  (async () => {
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      console.log(`${COLORS.RED}❌ ${app.manifest.displayName || app.name} crashed with exit code ${exitCode}${COLORS.RESET}`);
      updateServiceStatus(serviceId, "error");
    }
  })();
}

/**
 * Main dev environment startup
 */
async function main() {
  printHeader();

  // Show startup options
  if (!minimal && !noApps) {
    console.log(`${COLORS.YELLOW}💡 Starting full development environment${maxApps ? ` (max ${maxApps} apps)` : ' with all apps'}${COLORS.RESET}`);
    console.log(`${COLORS.YELLOW}   This may use significant memory (8-16GB)${COLORS.RESET}`);
    console.log(`${COLORS.YELLOW}   For lighter startup, use:${COLORS.RESET}`);
    console.log(`${COLORS.YELLOW}     bun run dev -- --minimal           ${COLORS.DIM}# Only localnet${COLORS.RESET}`);
    console.log(`${COLORS.YELLOW}     bun run dev -- --max-apps=4        ${COLORS.DIM}# Limit to 4 apps${COLORS.RESET}`);
    console.log(`${COLORS.YELLOW}     bun run dev -- --no-apps           ${COLORS.DIM}# Skip all apps${COLORS.RESET}\n`);
  }

  try {
    // ============================================================
    // PHASE -1: Check for resource-hungry processes
    // ============================================================
    const psCheck = await $`ps aux | grep -E '(synpress|playwright)' | grep -v grep`.nothrow().quiet();
    if (psCheck.exitCode === 0 && psCheck.stdout.toString().trim()) {
      console.log(`${COLORS.YELLOW}⚠️  Warning: Found running test processes (synpress/playwright)${COLORS.RESET}`);
      console.log(`${COLORS.YELLOW}   These may consume significant CPU/memory during app startup${COLORS.RESET}`);
      console.log(`${COLORS.YELLOW}   Consider stopping them first if you experience issues${COLORS.RESET}\n`);
    }
    
    // ============================================================
    // PHASE 0: Docker Readiness Check
    // ============================================================
    console.log(`\n${COLORS.CYAN}━━━ Checking Docker... ━━━${COLORS.RESET}\n`);
    
    let dockerReady = false;
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max wait
    
    while (!dockerReady && attempts < maxAttempts) {
      const dockerPsCheck = await $`docker ps`.nothrow().quiet();
      const dockerInfoCheck = await $`docker info`.nothrow().quiet();
      
      // Both docker ps AND docker info must succeed for full readiness
      if (dockerPsCheck.exitCode === 0 && dockerInfoCheck.exitCode === 0) {
        dockerReady = true;
        console.log(`${COLORS.GREEN}✅ Docker daemon is fully ready${COLORS.RESET}\n`);
      } else {
        if (attempts === 0) {
          console.log(`${COLORS.YELLOW}⏳ Waiting for Docker daemon to fully initialize...${COLORS.RESET}`);
        } else if (attempts % 5 === 0) {
          console.log(`${COLORS.YELLOW}   Still waiting... (${attempts}/${maxAttempts})${COLORS.RESET}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
      }
    }
    
    if (!dockerReady) {
      console.log(`${COLORS.RED}❌ Docker daemon not ready after ${maxAttempts} seconds${COLORS.RESET}`);
      console.log(`${COLORS.YELLOW}Please ensure Docker Desktop is fully started and try again${COLORS.RESET}`);
      process.exit(1);
    }
    
    // ============================================================
    // PHASE 1: Port Cleanup
    // ============================================================
    console.log(`\n${COLORS.CYAN}━━━ Cleaning up ports... ━━━${COLORS.RESET}\n`);
    
    // Discover all apps and extract their ports dynamically
    const allApps = discoverAllApps();
    const portsToClean: number[] = [
      // Infrastructure ports
      INFRA_PORTS.GRAFANA.get(),
      INFRA_PORTS.PROMETHEUS.get(),
      CORE_PORTS.INDEXER_GRAPHQL.get(),
      CORE_PORTS.INDEXER_DATABASE.get(),
    ];
    
    // Extract all ports from app manifests
    for (const app of allApps) {
      if (app.manifest.ports) {
        if (app.manifest.ports.main) portsToClean.push(app.manifest.ports.main);
        if (app.manifest.ports.api) portsToClean.push(app.manifest.ports.api);
        if (app.manifest.ports.ui) portsToClean.push(app.manifest.ports.ui);
        if (app.manifest.ports.game) portsToClean.push(app.manifest.ports.game);
        if (app.manifest.ports.auth) portsToClean.push(app.manifest.ports.auth);
      }
    }
    
    // Remove duplicates
    const uniquePorts = [...new Set(portsToClean)];
    console.log(`${COLORS.CYAN}🧹 Cleaning ${uniquePorts.length} ports...${COLORS.RESET}`);
    
    await killPortProcesses(uniquePorts);
    console.log(`${COLORS.GREEN}✅ Ports cleaned${COLORS.RESET}\n`);
    
    // ============================================================
    // PHASE 2: Kurtosis Localnet
    // ============================================================
    console.log(`\n${COLORS.CYAN}━━━ Phase 2: Starting Kurtosis Localnet ━━━${COLORS.RESET}\n`);
    
    services.set("localnet", {
      name: "Kurtosis Localnet (L1 + L2)",
      description: "Local blockchain network",
      status: "starting",
      category: "core",
    });

    const startResult = await $`bun run scripts/localnet/start.ts`.nothrow();
    
    if (startResult.exitCode !== 0) {
      console.error(`${COLORS.RED}❌ Failed to start localnet${COLORS.RESET}`);
      console.error(startResult.stderr.toString());
      process.exit(1);
    }
    
    // Read ports from cached file (saved by start.ts)
    const portsFilePath = ".kurtosis/ports.json";
    if (!existsSync(portsFilePath)) {
      console.error(`${COLORS.RED}❌ Ports file not found: ${portsFilePath}${COLORS.RESET}`);
      console.error(`${COLORS.YELLOW}   Localnet may have failed to start properly${COLORS.RESET}`);
      process.exit(1);
    }
    
    const portsFile = await Bun.file(portsFilePath).json();
    const l1RpcPortDynamic = portsFile.l1Port;
    const l2RpcPortDynamic = portsFile.l2Port;
    
    console.log(`${COLORS.GREEN}✅ Localnet ports detected:${COLORS.RESET}`);
    console.log(`   L1 RPC (Kurtosis): http://127.0.0.1:${l1RpcPortDynamic}`);
    console.log(`   L2 RPC (Kurtosis): http://127.0.0.1:${l2RpcPortDynamic}`);
    
    // Setup static port forwarding for wallet compatibility
    console.log(`\n${COLORS.CYAN}━━━ Setting up static RPC ports ━━━${COLORS.RESET}\n`);
    
    const STATIC_L1_PORT = INFRA_PORTS.L1_RPC.get();
    const STATIC_L2_PORT = INFRA_PORTS.L2_RPC.get();
    
    await setupPortForwarding(STATIC_L1_PORT, l1RpcPortDynamic, "L1 RPC (Geth)");
    await setupPortForwarding(STATIC_L2_PORT, l2RpcPortDynamic, "L2 RPC (Jeju)");
    
    // Give port forwarding a moment to initialize
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Use static ports for all services
    const l1RpcPort = STATIC_L1_PORT.toString();
    const l2RpcPort = STATIC_L2_PORT.toString();
    const l1RpcUrl = `http://localhost:${l1RpcPort}`;
    const l2RpcUrl = `http://localhost:${l2RpcPort}`;
    
    // Verify RPC connections with proper HTTP-only JSON-RPC requests
    console.log(`${COLORS.CYAN}🔍 Verifying RPC connections...${COLORS.RESET}`);
    
    const l1RpcHealthy = await rpcHealthCheck(l1RpcUrl, 3000);
    const l2RpcHealthy = await rpcHealthCheck(l2RpcUrl, 3000);
    
    console.log(`${COLORS.GREEN}✅ Static ports configured:${COLORS.RESET}`);
    console.log(`  ${l1RpcHealthy ? '✅' : '❌'} L1 RPC (Geth)                  ${l1RpcUrl}                   `);
    console.log(`  ${l2RpcHealthy ? '✅' : '❌'} L2 RPC (OP-Geth)               ${l2RpcUrl}                   `);
    if (l2RpcHealthy) {
      console.log(`                                                           ${COLORS.RED}← Use this for wallets${COLORS.RESET}`);
    }
    
    updateServiceStatus("localnet", "running");
    
    services.set("l1-rpc", {
      name: "L1 RPC (Geth)",
      description: "Base Layer 1 RPC",
      url: l1RpcUrl,
      port: parseInt(l1RpcPort),
      status: l1RpcHealthy ? "running" : "error",
      category: "core",
    });
    
    services.set("l2-rpc", {
      name: "L2 RPC (OP-Geth)",
      description: "Jeju Layer 2 RPC",
      url: l2RpcUrl,
      port: parseInt(l2RpcPort),
      status: l2RpcHealthy ? "running" : "error",
      category: "core",
    });
    
    services.set("kurtosis-ui", {
      name: "Kurtosis Dashboard",
      description: "Manage localnet",
      url: "http://localhost:9711",
      port: 9711,
      status: "running",
      category: "core",
    });

    console.log(`${COLORS.GREEN}✅ Localnet started${COLORS.RESET}`);

    // ============================================================
    // PHASE 2.5: Bootstrap Localnet (Auto-Deploy Contracts)
    // ============================================================
    console.log(`\n${COLORS.CYAN}━━━ Phase 2.5: Checking Bootstrap Status ━━━${COLORS.RESET}\n`);
    
    const bootstrapFile = join(process.cwd(), 'contracts', 'deployments', 'localnet-complete.json');
    if (!existsSync(bootstrapFile)) {
      console.log(`${COLORS.YELLOW}⚠️  Bootstrap not detected - running complete bootstrap...${COLORS.RESET}`);
      console.log(`${COLORS.CYAN}   This deploys all contracts, tokens, and paymaster system${COLORS.RESET}`);
      console.log(`${COLORS.CYAN}   First run may take 2-3 minutes...${COLORS.RESET}\n`);
      
      try {
        await $`bun run scripts/bootstrap-localnet-complete.ts`.env({
          ...process.env,
          JEJU_RPC_URL: l2RpcUrl,
          L2_RPC_URL: l2RpcUrl,
        });
        console.log(`${COLORS.GREEN}✅ Bootstrap complete${COLORS.RESET}\n`);
      } catch (error) {
        console.log(`${COLORS.YELLOW}⚠️  Bootstrap failed (continuing anyway)${COLORS.RESET}`);
        console.log(`${COLORS.YELLOW}   You can run manually: bun run scripts/bootstrap-localnet-complete.ts${COLORS.RESET}\n`);
      }
    } else {
      console.log(`${COLORS.GREEN}✅ Bootstrap already completed${COLORS.RESET}`);
      const bootstrap = await Bun.file(bootstrapFile).json();
      console.log(`${COLORS.DIM}   Tokens: ${bootstrap.contracts.usdc}, ${bootstrap.contracts.elizaOS}${COLORS.RESET}`);
      if (bootstrap.contracts.tokenRegistry) {
        console.log(`${COLORS.DIM}   Paymaster: ${bootstrap.contracts.tokenRegistry}${COLORS.RESET}`);
      }
      console.log('');
    }

    if (minimal) {
      await printDashboard();
      console.log(`\n${COLORS.YELLOW}Running in minimal mode - only localnet started${COLORS.RESET}\n`);
      return;
    }

    // ============================================================
    // PHASE 3: Subsquid Indexer
    // ============================================================
    console.log(`\n${COLORS.CYAN}━━━ Phase 3: Starting Subsquid Indexer ━━━${COLORS.RESET}\n`);
    
    services.set("indexer", {
      name: "Subsquid Indexer",
      description: "Blockchain indexer",
      status: "starting",
      category: "indexer",
    });

    // Skip explicit build - the dev command handles it
    console.log(`${COLORS.CYAN}📦 Indexer will build during startup...${COLORS.RESET}`);

    // Start indexer process (this runs predev which sets up DB, then starts processor and GraphQL)
    // Pass the L2 RPC URL to the indexer (already defined above)
    console.log(`${COLORS.CYAN}🔗 Connecting indexer to L2 RPC: ${l2RpcUrl}${COLORS.RESET}`);
    
    const indexerGraphQLPort = CORE_PORTS.INDEXER_GRAPHQL.get();
    const indexerDBPort = CORE_PORTS.INDEXER_DATABASE.get();
    
    const indexerProc = spawn({
      cmd: ["bun", "run", "dev"],
      cwd: process.cwd() + "/apps/indexer",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        RPC_ETH_HTTP: l2RpcUrl,
        START_BLOCK: "0",
        CHAIN_ID: "1337", // Jeju L2 localnet chain ID
        DB_NAME: "indexer",
        DB_PORT: indexerDBPort.toString(),
        GQL_PORT: indexerGraphQLPort.toString(),
        INDEXER_GRAPHQL_PORT: indexerGraphQLPort.toString(),
      },
    });
    
    processes.push(indexerProc);
    services.set("indexer-process", {
      name: "Indexer Process",
      description: "",
      status: "starting",
      category: "indexer",
      process: indexerProc,
    });

    // Stream indexer output for debugging
    (async () => {
      if (indexerProc.stdout) {
        const stdout = indexerProc.stdout as unknown as AsyncIterable<Uint8Array>;
        for await (const chunk of stdout) {
          const text = new TextDecoder().decode(chunk);
          if (text.includes("error") || text.includes("Error") || text.includes("failed")) {
            console.log(`${COLORS.RED}[Indexer]${COLORS.RESET} ${text.trim()}`);
          }
        }
      }
    })();

    (async () => {
      if (indexerProc.stderr) {
        const stderr = indexerProc.stderr as unknown as AsyncIterable<Uint8Array>;
        for await (const chunk of stderr) {
          const text = new TextDecoder().decode(chunk);
          const lowerText = text.toLowerCase();
          
          // Check if this is an actual error
          const isActualError = 
            lowerText.includes("error:") ||
            lowerText.includes("fatal") ||
            lowerText.includes("failed:") ||
            lowerText.includes("exception") ||
            lowerText.includes("econnrefused") ||
            lowerText.includes("enotfound") ||
            (lowerText.includes("error") && !lowerText.includes('"level":2'));
          
          // Known info/debug patterns (Subsquid uses stderr for structured logs)
          const isKnownInfo = 
            lowerText.includes('"level":2') || // Level 2 = info
            lowerText.includes('"msg":"up"') ||
            lowerText.includes('"msg":"migration') ||
            lowerText.includes("creating") ||
            lowerText.includes("created") ||
            lowerText.includes("starting") ||
            lowerText.includes("started") ||
            lowerText.includes("query:") ||
            lowerText.includes("create table");
          
          if (isKnownInfo) {
            // Normal startup logs - show in cyan
            console.log(`${COLORS.CYAN}[Indexer]${COLORS.RESET} ${text.trim()}`);
          } else if (isActualError) {
            // Real errors - show in red
            console.log(`${COLORS.RED}[Indexer Error]${COLORS.RESET} ${text.trim()}`);
          } else {
            // Unknown stderr output - show in yellow as warning
            console.log(`${COLORS.YELLOW}[Indexer]${COLORS.RESET} ${text.trim()}`);
          }
        }
      }
    })();

    // Add GraphQL service
    services.set("indexer-graphql", {
      name: "GraphQL API",
      description: "Query blockchain data",
      url: `http://localhost:${indexerGraphQLPort}/graphql`,
      port: indexerGraphQLPort,
      status: "starting",
      category: "indexer",
    });

    console.log(`${COLORS.YELLOW}⏳ Waiting for database setup and indexer to start...${COLORS.RESET}`);
    console.log(`${COLORS.CYAN}   This may take 30-60 seconds on first run${COLORS.RESET}`);
    
    // Wait for DB setup and services to start
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    // Check if GraphQL is ready with better progress indication
    let graphqlReady = false;
    console.log(`${COLORS.CYAN}   Waiting for GraphQL endpoint...${COLORS.RESET}`);
    
    for (let i = 0; i < 30; i++) {
      if (await healthCheck(`http://localhost:${indexerGraphQLPort}/graphql`, 2000)) {
        updateServiceStatus("indexer-graphql", "running");
        updateServiceStatus("indexer-process", "running");
        updateServiceStatus("indexer", "running");
        graphqlReady = true;
        console.log(`${COLORS.GREEN}✅ Indexer GraphQL ready at http://localhost:${indexerGraphQLPort}/graphql${COLORS.RESET}`);
        break;
      }
      
      // Show progress every 5 attempts
      if (i % 5 === 0 && i > 0) {
        console.log(`${COLORS.YELLOW}   Still waiting... (${i * 3}s elapsed)${COLORS.RESET}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    if (!graphqlReady) {
      console.log(`${COLORS.YELLOW}⚠️  Indexer taking longer than expected${COLORS.RESET}`);
      console.log(`${COLORS.YELLOW}   Check manually: http://localhost:${indexerGraphQLPort}/graphql${COLORS.RESET}`);
      updateServiceStatus("indexer", "error");
      updateServiceStatus("indexer-graphql", "error");
    }

    // ============================================================
    // PHASE 4: Core Services (Monitoring Stack)
    // ============================================================

    // ============================================================
    // PHASE 5: Monitoring
    // ============================================================
    console.log(`\n${COLORS.CYAN}━━━ Phase 5: Starting Monitoring ━━━${COLORS.RESET}\n`);

    if (existsSync("apps/monitoring/docker-compose.yml")) {
      console.log(`${COLORS.CYAN}🚀 Starting Prometheus and Grafana...${COLORS.RESET}`);
      
      // Stop any existing monitoring containers
      await $`cd apps/monitoring && docker-compose down`.quiet().nothrow();
      
      // Start monitoring stack
      const monitoringResult = await $`cd apps/monitoring && docker-compose up -d`.nothrow();
      
      if (monitoringResult.exitCode === 0) {
        const prometheusPort = INFRA_PORTS.PROMETHEUS.get();
        const grafanaPort = INFRA_PORTS.GRAFANA.get();
        
        services.set("prometheus", {
          name: "Prometheus",
          description: "Metrics database",
          url: `http://localhost:${prometheusPort}`,
          port: prometheusPort,
          status: "running",
          category: "monitoring",
        });

        services.set("grafana", {
          name: "Grafana",
          description: "Metrics dashboards",
          url: `http://localhost:${grafanaPort}`,
          port: grafanaPort,
          status: "running",
          category: "monitoring",
        });

        console.log(`${COLORS.GREEN}✅ Prometheus running on http://localhost:${prometheusPort}${COLORS.RESET}`);
        console.log(`${COLORS.GREEN}✅ Grafana running on http://localhost:${grafanaPort} (admin/admin)${COLORS.RESET}`);
      } else {
        console.log(`${COLORS.YELLOW}⚠️  Failed to start monitoring stack${COLORS.RESET}`);
        console.log(`${COLORS.YELLOW}   Try: cd apps/monitoring && docker-compose up -d${COLORS.RESET}`);
      }
    } else {
      console.log(`${COLORS.YELLOW}⚠️  Monitoring docker-compose not found${COLORS.RESET}`);
    }

    // ============================================================
    // PHASE 6: All Jeju Apps (apps/ + vendor/ - Auto-Discovery)
    // ============================================================
    if (!noApps) {
      console.log(`\n${COLORS.CYAN}━━━ Phase 6: Starting All Apps ━━━${COLORS.RESET}\n`);
      console.log(`${COLORS.YELLOW}📦 Auto-discovering apps from jeju-manifest.json${COLORS.RESET}\n`);
      
      // Discover all apps dynamically
      const appsToStart = getAutoStartApps();
      
      // Filter out indexer and monitoring (special infrastructure)
      const filteredApps = appsToStart.filter(app => 
        app.name !== 'indexer' && 
        app.name !== 'monitoring'
      );
      
      if (filteredApps.length === 0) {
        console.log(`${COLORS.YELLOW}ℹ️  No apps to start${COLORS.RESET}\n`);
      } else {
        displayAppsSummary();
        
        // Apply max apps limit if specified (total across both core and vendor)
        let appsToActuallyStart = filteredApps;
        if (maxApps && maxApps > 0) {
          appsToActuallyStart = filteredApps.slice(0, maxApps);
          const skippedCount = filteredApps.length - appsToActuallyStart.length;
          console.log(`${COLORS.YELLOW}📊 Starting ${maxApps} app(s) out of ${filteredApps.length} available${skippedCount > 0 ? ` (skipping ${skippedCount})` : ''}${COLORS.RESET}\n`);
          
          // Show which apps are being started
          const startingNames = appsToActuallyStart.map(a => a.manifest.displayName || a.name).join(', ');
          console.log(`${COLORS.CYAN}   Apps to start: ${startingNames}${COLORS.RESET}\n`);
        }
        
        // Group by type for better organization
        const coreApps = appsToActuallyStart.filter(a => a.type === 'core');
        const vendorApps = appsToActuallyStart.filter(a => a.type === 'vendor');
        
        if (coreApps.length > 0) {
          console.log(`${COLORS.CYAN}Starting ${coreApps.length} core app(s)...${COLORS.RESET}\n`);
          
          // Separate Next.js apps from others for staggered startup
          const nextJsApps = coreApps.filter(app => {
            const devCmd = app.manifest.commands?.dev || '';
            return devCmd.includes('next dev');
          });
          const otherApps = coreApps.filter(app => !nextJsApps.includes(app));
          
          // Start non-Next.js apps first (faster startup, less resource intensive)
          for (const app of otherApps) {
            await startJejuApp(app, l2RpcPort);
          }
          
          // Start Next.js apps one at a time with extra delay for compilation
          for (const app of nextJsApps) {
            console.log(`${COLORS.YELLOW}   ⏳ Starting Next.js app (requires compilation)...${COLORS.RESET}`);
            await startJejuApp(app, l2RpcPort);
            // Extra delay after Next.js apps to let compilation finish
            await new Promise(r => setTimeout(r, 3000));
          }
        }
        
        if (vendorApps.length > 0) {
          console.log(`\n${COLORS.CYAN}Starting ${vendorApps.length} vendor app(s)...${COLORS.RESET}\n`);
          
          // Separate Next.js apps from others
          const nextJsApps = vendorApps.filter(app => {
            const devCmd = app.manifest.commands?.dev || '';
            return devCmd.includes('next dev');
          });
          const otherApps = vendorApps.filter(app => !nextJsApps.includes(app));
          
          // Start non-Next.js apps first
          for (const app of otherApps) {
            await startJejuApp(app, l2RpcPort);
          }
          
          // Start Next.js apps one at a time with extra delay
          for (const app of nextJsApps) {
            console.log(`${COLORS.YELLOW}   ⏳ Starting Next.js app (requires compilation)...${COLORS.RESET}`);
            await startJejuApp(app, l2RpcPort);
            await new Promise(r => setTimeout(r, 3000));
          }
        }
        
        console.log(`\n${COLORS.GREEN}✅ All apps started${COLORS.RESET}\n`);
      }
    }

    // ============================================================
    // Final Status & Health Checks
    // ============================================================
    console.log(`\n${COLORS.CYAN}━━━ Waiting for services to be ready... ━━━${COLORS.RESET}\n`);
    
    // Give services time to start
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Dynamic health checks for all services with URLs
    const servicesWithUrls = Array.from(services.entries()).filter(([, s]) => s.url && s.status === "starting");
    
    console.log(`${COLORS.YELLOW}⏳ Checking ${servicesWithUrls.length} service(s)...${COLORS.RESET}`);
    
    for (const [id, service] of servicesWithUrls) {
      // Skip RPC endpoints (already verified)
      if (id.includes('rpc')) continue;
      
      // Try health check (service.url is guaranteed to exist due to filter above)
      if (service.url) {
        await waitForService(id, service.url, 30000);
      }
    }

    // Special handling for monitoring services
    if (services.has("prometheus")) {
      await waitForService("prometheus", `http://localhost:${INFRA_PORTS.PROMETHEUS.get()}/-/healthy`, 15000);
    }

    if (services.has("grafana")) {
      await waitForService("grafana", `http://localhost:${INFRA_PORTS.GRAFANA.get()}`, 15000);
    }

    // Check for services that haven't started
    const stillStarting = Array.from(services.entries()).filter(([, s]) => s.status === "starting");
    const errorServices = Array.from(services.entries()).filter(([, s]) => s.status === "error");
    
    // Don't clear console if there are errors or still-starting services (preserve logs)
    const hasIssues = errorServices.length > 0 || stillStarting.length > 0;
    
    // Print final dashboard (preserve logs if there are issues)
    await printDashboard(hasIssues);
    
    // Show detailed diagnostics for problem services
    if (errorServices.length > 0) {
      console.log(`\n${COLORS.RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.RESET}`);
      console.log(`${COLORS.RED}⚠️  ${errorServices.length} service(s) FAILED to start:${COLORS.RESET}`);
      console.log(`${COLORS.RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.RESET}\n`);
      for (const [, service] of errorServices) {
        console.log(`${COLORS.RED}❌ ${service.name}${COLORS.RESET}`);
        console.log(`   ${COLORS.YELLOW}Check error messages above marked [${service.name}]${COLORS.RESET}`);
        if (service.url) {
          console.log(`   Expected URL: ${service.url}`);
        }
        console.log();
      }
    }
    
    if (stillStarting.length > 0) {
      console.log(`\n${COLORS.YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.RESET}`);
      console.log(`${COLORS.YELLOW}⏳ ${stillStarting.length} service(s) still starting:${COLORS.RESET}`);
      console.log(`${COLORS.YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.RESET}\n`);
      for (const [, service] of stillStarting) {
        console.log(`${COLORS.YELLOW}🔄 ${service.name}${COLORS.RESET}`);
        if (service.url) {
          console.log(`   Will be at: ${service.url}`);
        }
        console.log(`   ${COLORS.CYAN}Scroll up to see [${service.name}] logs${COLORS.RESET}`);
        console.log();
      }
    }
    
    // Show actionable debugging tips
    if (hasIssues) {
      console.log(`${COLORS.CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.RESET}`);
      console.log(`${COLORS.CYAN}💡 How to Debug:${COLORS.RESET}`);
      console.log(`${COLORS.CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.RESET}\n`);
      console.log(`   1. Scroll UP to see detailed [ServiceName] error logs`);
      console.log(`   2. Check port conflicts: ${COLORS.BRIGHT}lsof -i :PORT${COLORS.RESET}`);
      console.log(`   3. Test app manually: ${COLORS.BRIGHT}cd apps/APP_NAME && npm run dev${COLORS.RESET}`);
      console.log(`   4. Check dependencies: ${COLORS.BRIGHT}cd apps/APP_NAME && npm install${COLORS.RESET}`);
      console.log(`   5. Reset everything: Ctrl+C, then ${COLORS.BRIGHT}bun run dev${COLORS.RESET} again\n`);
    }

    // Keep running
    await new Promise(() => {});
  } catch (error) {
    console.error(`\n${COLORS.RED}❌ Startup failed:${COLORS.RESET}`, error);
    await cleanup();
    process.exit(1);
  }
}

// Run
main();
