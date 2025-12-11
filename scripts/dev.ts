#!/usr/bin/env bun
/**
 * Jeju Development Environment
 * 
 * Starts chain infrastructure, then core apps, then vendor apps.
 * Ctrl+C stops everything cleanly.
 */

import { $ } from "bun";
import { spawn, type Subprocess } from "bun";
import { existsSync } from "fs";
import { join } from "path";
import { discoverAllApps, displayAppsSummary, getAutoStartApps, type JejuApp } from "./shared/discover-apps";
import { CORE_PORTS, INFRA_PORTS } from "@jejunetwork/config/ports";

// Configuration
const minimal = process.argv.includes("--minimal");
const noApps = process.argv.includes("--no-apps");
const noAccumulator = process.argv.includes("--no-accumulator");
const maxAppsArg = process.argv.find(arg => arg.startsWith("--max-apps="));
const maxApps = maxAppsArg ? parseInt(maxAppsArg.split("=")[1]) : undefined;
const onlyArg = process.argv.find(arg => arg.startsWith("--only="));
const onlyApps = onlyArg ? onlyArg.split("=")[1].split(",") : undefined;

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

let isShuttingDown = false;

async function cleanup() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log("\n\nShutting down...\n");
  
  for (const proc of processes) {
    proc.kill();
  }
  
  await $`bun run localnet:stop`.nothrow().quiet();
  await $`cd apps/indexer && npm run db:down`.nothrow().quiet();
  await $`rm -f apps/node-explorer/node-explorer.db`.nothrow().quiet();
  
  console.log("Stopped\n");
}

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(0);
});

process.on("uncaughtException", async (error) => {
  console.error("Uncaught exception:", error);
  await cleanup();
  process.exit(1);
});

process.on("unhandledRejection", async (reason) => {
  console.error("Unhandled rejection:", reason);
  await cleanup();
  process.exit(1);
});

function printHeader() {
  console.clear();
  console.log(`${COLORS.CYAN}${COLORS.BRIGHT}Jeju Localnet${COLORS.RESET}\n`);
}

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


function updateServiceStatus(id: string, status: ServiceInfo["status"]) {
  const service = services.get(id);
  if (service) {
    service.status = status;
  }
}

async function printDashboard(skipClear = false) {
  if (!skipClear) {
    console.clear();
  }
  
  console.log(`
${COLORS.GREEN}${COLORS.BRIGHT}JEJU READY${COLORS.RESET}
Ctrl+C to stop

${COLORS.BRIGHT}SERVICES${COLORS.RESET}
`);

  // Core services
  const coreServices = Array.from(services.entries()).filter(([, s]) => s.category === "core");
  for (const [, service] of coreServices) {
    printServiceLine(service);
  }

  console.log(`\n${COLORS.BRIGHT}INDEXER${COLORS.RESET}`);
  const indexerServices = Array.from(services.entries()).filter(([, s]) => s.category === "indexer");
  for (const [, service] of indexerServices) {
    printServiceLine(service);
  }

  if (!minimal) {
    console.log(`\n${COLORS.BRIGHT}MONITORING${COLORS.RESET}`);
    const monitoringServices = Array.from(services.entries()).filter(([, s]) => s.category === "monitoring");
    for (const [, service] of monitoringServices) {
      printServiceLine(service);
    }

    console.log(`\n${COLORS.BRIGHT}DOCS${COLORS.RESET}`);
    const docsServices = Array.from(services.entries()).filter(([, s]) => s.category === "docs");
    for (const [, service] of docsServices) {
      printServiceLine(service);
    }

    if (!noApps) {
      console.log(`\n${COLORS.BRIGHT}APPS${COLORS.RESET}`);
      const appServices = Array.from(services.entries()).filter(([, s]) => s.category === "apps");
      for (const [, service] of appServices) {
        printServiceLine(service);
      }
    }
  }

  console.log(`
${COLORS.BRIGHT}WALLET${COLORS.RESET}
  RPC URL:     http://127.0.0.1:9545
  Chain ID:    1337
  
  Test Key:    0xb71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291
  Address:     0x71562b71999873DB5b286dF957af199Ec94617F7
`);
}

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

async function waitForService(id: string, url: string, maxWait = 60000) {
  const startTime = Date.now();
  const serviceName = services.get(id)?.name || id;
  
  let attempts = 0;
  while (Date.now() - startTime < maxWait) {
    if (await healthCheck(url, 3000)) {
      updateServiceStatus(id, "running");
      console.log(`${serviceName} ready`);
      return true;
    }
    
    attempts++;
    if (attempts % 5 === 0) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      console.log(`  waiting for ${serviceName}... (${elapsed}s)`);
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }
  
  updateServiceStatus(id, "error");
  console.log(`${COLORS.RED}${serviceName} failed to start${COLORS.RESET}`);
  return false;
}


async function killPortProcesses(ports: number[]) {
  for (const port of ports) {
    const pidsResult = await $`lsof -ti:${port}`.nothrow().quiet();
    if (pidsResult.exitCode !== 0) continue;
    
    const pids = pidsResult.stdout.toString().trim().split('\n').filter(Boolean);
    for (const pid of pids) {
      const psResult = await $`ps -p ${pid} -o command=`.nothrow().quiet();
      const command = psResult.stdout.toString();
      if (command.includes('docker') || command.includes('Docker')) continue;
      await $`kill -9 ${pid}`.nothrow().quiet();
    }
  }
}

async function setupPortForwarding(staticPort: number, dynamicPort: number, name: string): Promise<Subprocess | null> {
  console.log(`Forwarding ${name}: localhost:${staticPort} -> localhost:${dynamicPort}`);
  
  await $`lsof -ti:${staticPort} | xargs kill -9`.nothrow().quiet();
  
  const socatCheck = await $`which socat`.nothrow().quiet();
  if (socatCheck.exitCode !== 0) {
    const platform = process.platform;
    console.log(`${COLORS.RED}socat not found${COLORS.RESET}`);
    console.log(`\nInstall socat:\n`);
    if (platform === 'darwin') {
      console.log(`  macOS:   brew install socat`);
    } else if (platform === 'linux') {
      console.log(`  Ubuntu:  sudo apt-get install socat`);
      console.log(`  Fedora:  sudo dnf install socat`);
      console.log(`  Arch:    sudo pacman -S socat`);
    } else if (platform === 'win32') {
      console.log(`  Windows: choco install socat`);
      console.log(`           or use WSL2 with: sudo apt-get install socat`);
    } else {
      console.log(`  Install socat for your platform`);
    }
    console.log('');
    process.exit(1);
  }
  
  const proc = spawn({
    cmd: ["socat", `TCP-LISTEN:${staticPort},fork,reuseaddr`, `TCP:127.0.0.1:${dynamicPort}`],
    stdout: "pipe",
    stderr: "pipe",
  });
  
  processes.push(proc);
  return proc;
}

async function startJejuApp(app: JejuApp, l2RpcPort: string): Promise<void> {
  const devCommand = app.manifest.commands?.dev;
  if (!devCommand) return;

  const appName = app.manifest.displayName || app.name;
  console.log(`  ${appName}...`);
  
  const cmdParts = devCommand.split(' ');
  const appNameUpper = app.name.toUpperCase().replace(/-/g, '_');
  const mainPort = app.manifest.ports?.main;
  
  const appEnv: Record<string, string> = {
    ...process.env,
    RPC_URL: `http://localhost:${l2RpcPort}`,
    JEJU_RPC_URL: `http://localhost:${l2RpcPort}`,
    CHAIN_ID: "1337",
    PUBLIC_CDN_URL: process.env.PUBLIC_CDN_URL || 'http://localhost:8088',
  };
  
  if (mainPort) {
    const port = process.env[`${appNameUpper}_PORT`] || mainPort.toString();
    appEnv.PORT = port;
    appEnv.VITE_PORT = port;
    appEnv[`${appNameUpper}_PORT`] = port;
  }
  if (app.manifest.ports?.api) {
    appEnv[`${appNameUpper}_API_PORT`] = process.env[`${appNameUpper}_API_PORT`] || app.manifest.ports.api.toString();
    appEnv.API_PORT = app.manifest.ports.api.toString();
  }
  if (app.manifest.ports?.ui) {
    appEnv[`${appNameUpper}_UI_PORT`] = process.env[`${appNameUpper}_UI_PORT`] || app.manifest.ports.ui.toString();
  }
  if (app.manifest.ports?.game) {
    appEnv[`${appNameUpper}_GAME_PORT`] = process.env[`${appNameUpper}_GAME_PORT`] || app.manifest.ports.game.toString();
  }
  if (app.manifest.ports?.auth) {
    appEnv[`${appNameUpper}_AUTH_PORT`] = process.env[`${appNameUpper}_AUTH_PORT`] || app.manifest.ports.auth.toString();
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
    name: appName,
    description: app.manifest.description || '',
    url: mainPort ? `http://127.0.0.1:${mainPort}` : undefined,
    port: mainPort,
    status: "starting",
    category: "apps",
    process: proc,
  });
  
  let isReady = false;
  
  // stdout
  (async () => {
    if (!proc.stdout) return;
    const stdout = proc.stdout as unknown as AsyncIterable<Uint8Array>;
    for await (const chunk of stdout) {
      const text = new TextDecoder().decode(chunk).trim();
      if (!text) continue;
      const lower = text.toLowerCase();
      
      if (!isReady && (lower.includes('listening') || lower.includes('ready') || 
          lower.includes('compiled') || lower.includes('local:') || lower.includes('server running'))) {
        updateServiceStatus(serviceId, "running");
        isReady = true;
      }
      if (lower.includes('error')) {
        console.log(`${COLORS.RED}[${appName}]${COLORS.RESET} ${text}`);
      }
    }
  })();
  
  // stderr
  (async () => {
    if (!proc.stderr) return;
    const stderr = proc.stderr as unknown as AsyncIterable<Uint8Array>;
    for await (const chunk of stderr) {
      const text = new TextDecoder().decode(chunk).trim();
      if (!text) continue;
      const lower = text.toLowerCase();
      if (lower.includes('error') || lower.includes('fatal')) {
        console.log(`${COLORS.RED}[${appName}]${COLORS.RESET} ${text}`);
      }
    }
  })();
  
  // Wait for ready or timeout
  const startTime = Date.now();
  while (!isReady && (Date.now() - startTime) < 45000) {
    if (proc.exitCode !== null) {
      console.log(`${COLORS.RED}${appName} exited with code ${proc.exitCode}${COLORS.RESET}`);
      updateServiceStatus(serviceId, "error");
      return;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  
  // Monitor for crashes
  (async () => {
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      console.log(`${COLORS.RED}${appName} crashed (exit ${exitCode})${COLORS.RESET}`);
      updateServiceStatus(serviceId, "error");
    }
  })();
}

async function main() {
  printHeader();

  if (!minimal && !noApps && maxApps) {
    console.log(`Starting with max ${maxApps} apps\n`);
  }

  try {
    // Check Docker
    console.log(`Checking Docker...`);
    
    let dockerReady = false;
    for (let i = 0; i < 30; i++) {
      const ps = await $`docker ps`.nothrow().quiet();
      const info = await $`docker info`.nothrow().quiet();
      if (ps.exitCode === 0 && info.exitCode === 0) {
        dockerReady = true;
        console.log(`Docker ready\n`);
        break;
      }
      if (i === 0) console.log(`Waiting for Docker...`);
      await new Promise(r => setTimeout(r, 1000));
    }
    
    if (!dockerReady) {
      console.log(`${COLORS.RED}Docker not ready. Start Docker Desktop.${COLORS.RESET}`);
      process.exit(1);
    }
    
    // Port Cleanup
    console.log(`Cleaning ports...`);
    const allApps = discoverAllApps();
    const portsToClean: number[] = [
      INFRA_PORTS.GRAFANA.get(),
      INFRA_PORTS.PROMETHEUS.get(),
      CORE_PORTS.INDEXER_GRAPHQL.get(),
      CORE_PORTS.INDEXER_DATABASE.get(),
    ];
    
    for (const app of allApps) {
      if (app.manifest.ports) {
        if (app.manifest.ports.main) portsToClean.push(app.manifest.ports.main);
        if (app.manifest.ports.api) portsToClean.push(app.manifest.ports.api);
        if (app.manifest.ports.ui) portsToClean.push(app.manifest.ports.ui);
        if (app.manifest.ports.game) portsToClean.push(app.manifest.ports.game);
        if (app.manifest.ports.auth) portsToClean.push(app.manifest.ports.auth);
      }
    }
    
    await killPortProcesses(Array.from(new Set(portsToClean)));
    console.log(`Ports cleaned\n`);
    
    // Kurtosis Localnet
    console.log(`Starting localnet...`);
    
    services.set("localnet", {
      name: "Kurtosis Localnet (L1 + L2)",
      description: "Local blockchain network",
      status: "starting",
      category: "core",
    });

    const startResult = await $`bun run localnet:start`.nothrow();
    
    if (startResult.exitCode !== 0) {
      console.error(`${COLORS.RED}Failed to start localnet${COLORS.RESET}`);
      process.exit(1);
    }
    
    const portsFilePath = ".kurtosis/ports.json";
    if (!existsSync(portsFilePath)) {
      console.error(`${COLORS.RED}Ports file not found: ${portsFilePath}${COLORS.RESET}`);
      process.exit(1);
    }
    
    const portsFile = await Bun.file(portsFilePath).json();
    const l1RpcPortDynamic = portsFile.l1Port;
    const l2RpcPortDynamic = portsFile.l2Port;
    
    console.log(`Localnet running (L1:${l1RpcPortDynamic}, L2:${l2RpcPortDynamic})`);
    console.log(`Setting up port forwarding...`);
    
    const STATIC_L1_PORT = INFRA_PORTS.L1_RPC.get();
    const STATIC_L2_PORT = INFRA_PORTS.L2_RPC.get();
    
    await setupPortForwarding(STATIC_L1_PORT, l1RpcPortDynamic, "L1 RPC (Geth)");
    await setupPortForwarding(STATIC_L2_PORT, l2RpcPortDynamic, "L2 RPC (Jeju)");
    
    await new Promise(r => setTimeout(r, 1000));
    
    const l1RpcPort = STATIC_L1_PORT.toString();
    const l2RpcPort = STATIC_L2_PORT.toString();
    const l1RpcUrl = `http://localhost:${l1RpcPort}`;
    const l2RpcUrl = `http://localhost:${l2RpcPort}`;
    
    const l1RpcHealthy = await rpcHealthCheck(l1RpcUrl, 3000);
    const l2RpcHealthy = await rpcHealthCheck(l2RpcUrl, 3000);
    
    console.log(`L1: ${l1RpcUrl} ${l1RpcHealthy ? 'OK' : 'FAIL'}`);
    console.log(`L2: ${l2RpcUrl} ${l2RpcHealthy ? 'OK' : 'FAIL'}\n`);
    
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
      url: "http://127.0.0.1:9711",
      port: 9711,
      status: "running",
      category: "core",
    });

    // Bootstrap contracts
    const bootstrapFile = join(process.cwd(), 'packages', 'contracts', 'deployments', 'localnet-complete.json');
    if (!existsSync(bootstrapFile)) {
      console.log(`Bootstrapping contracts...`);
      const result = await $`bun run scripts/bootstrap-localnet-complete.ts`.env({
        ...process.env,
        JEJU_RPC_URL: l2RpcUrl,
        L2_RPC_URL: l2RpcUrl,
      }).nothrow();
      if (result.exitCode !== 0) {
        console.log(`Bootstrap failed, continuing anyway`);
      } else {
        console.log(`Bootstrap complete\n`);
      }
    } else {
      console.log(`Bootstrap already done\n`);
    }

    if (minimal) {
      await printDashboard();
      console.log(`Minimal mode - localnet only\n`);
      return;
    }

    // Indexer
    console.log(`Starting indexer...`);
    
    services.set("indexer", {
      name: "Subsquid Indexer",
      description: "Blockchain indexer",
      status: "starting",
      category: "indexer",
    });

    
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
        CHAIN_ID: "1337", // Jeju localnet chain ID
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

    // Log indexer errors only
    (async () => {
      if (!indexerProc.stdout) return;
      const stdout = indexerProc.stdout as unknown as AsyncIterable<Uint8Array>;
      for await (const chunk of stdout) {
        const text = new TextDecoder().decode(chunk);
        if (text.toLowerCase().includes("error")) {
          console.log(`${COLORS.RED}[Indexer]${COLORS.RESET} ${text.trim()}`);
        }
      }
    })();

    (async () => {
      if (!indexerProc.stderr) return;
      const stderr = indexerProc.stderr as unknown as AsyncIterable<Uint8Array>;
      for await (const chunk of stderr) {
        const text = new TextDecoder().decode(chunk);
        const lower = text.toLowerCase();
        if (lower.includes("error:") || lower.includes("fatal") || lower.includes("failed:")) {
          console.log(`${COLORS.RED}[Indexer]${COLORS.RESET} ${text.trim()}`);
        }
      }
    })();

    services.set("indexer-graphql", {
      name: "GraphQL API",
      description: "Query blockchain data",
      url: `http://127.0.0.1:${indexerGraphQLPort}/graphql`,
      port: indexerGraphQLPort,
      status: "starting",
      category: "indexer",
    });

    await new Promise(r => setTimeout(r, 15000));
    
    let graphqlReady = false;
    for (let i = 0; i < 30; i++) {
      if (await healthCheck(`http://localhost:${indexerGraphQLPort}/graphql`, 2000)) {
        updateServiceStatus("indexer-graphql", "running");
        updateServiceStatus("indexer-process", "running");
        updateServiceStatus("indexer", "running");
        graphqlReady = true;
        console.log(`Indexer ready\n`);
        break;
      }
      await new Promise(r => setTimeout(r, 3000));
    }

    if (!graphqlReady) {
      console.log(`Indexer not ready yet, continuing...\n`);
      updateServiceStatus("indexer", "error");
      updateServiceStatus("indexer-graphql", "error");
    }

    // Monitoring
    console.log(`Starting monitoring...`);

    if (existsSync("apps/monitoring/docker-compose.yml")) {
      await $`cd apps/monitoring && docker-compose down`.quiet().nothrow();
      const result = await $`cd apps/monitoring && docker-compose up -d`.nothrow();
      
      if (result.exitCode === 0) {
        const prometheusPort = INFRA_PORTS.PROMETHEUS.get();
        const grafanaPort = INFRA_PORTS.GRAFANA.get();
        
        services.set("prometheus", {
          name: "Prometheus",
          description: "",
          url: `http://127.0.0.1:${prometheusPort}`,
          port: prometheusPort,
          status: "running",
          category: "monitoring",
        });

        services.set("grafana", {
          name: "Grafana",
          description: "",
          url: `http://127.0.0.1:${grafanaPort}`,
          port: grafanaPort,
          status: "running",
          category: "monitoring",
        });
        console.log(`Monitoring ready\n`);
      } else {
        console.log(`Monitoring failed to start\n`);
      }
    }

    // Core Apps
    if (!noApps) {
      console.log(`Starting core apps...`);
      
      let allAppsToStart = getAutoStartApps();
      
      // Filter to specific apps if --only flag is provided
      if (onlyApps && onlyApps.length > 0) {
        allAppsToStart = allAppsToStart.filter(app => onlyApps.includes(app.name));
        console.log(`Filtering to only: ${onlyApps.join(", ")}`);
      }
      
      const coreApps = allAppsToStart.filter(app => 
        app.type === 'core' && app.name !== 'indexer' && app.name !== 'monitoring'
      );
      
      let coreAppsToStart = coreApps;
      if (maxApps && maxApps > 0) {
        coreAppsToStart = coreApps.slice(0, Math.ceil(maxApps / 2));
      }
      
      const nextJsCoreApps = coreAppsToStart.filter(app => (app.manifest.commands?.dev || '').includes('next dev'));
      const otherCoreApps = coreAppsToStart.filter(app => !nextJsCoreApps.includes(app));
      
      for (const app of otherCoreApps) {
        await startJejuApp(app, l2RpcPort);
      }
      for (const app of nextJsCoreApps) {
        await startJejuApp(app, l2RpcPort);
        await new Promise(r => setTimeout(r, 3000));
      }
      
      console.log(`Core apps started\n`);
      
      // Vendor Apps
      console.log(`Starting vendor apps...`);
      const vendorApps = allAppsToStart.filter(app => app.type === 'vendor');
      
      let vendorAppsToStart = vendorApps;
      if (maxApps && maxApps > 0) {
        vendorAppsToStart = vendorApps.slice(0, Math.floor(maxApps / 2));
      }
      
      const nextJsVendorApps = vendorAppsToStart.filter(app => (app.manifest.commands?.dev || '').includes('next dev'));
      const otherVendorApps = vendorAppsToStart.filter(app => !nextJsVendorApps.includes(app));
      
      for (const app of otherVendorApps) {
        await startJejuApp(app, l2RpcPort);
      }
      for (const app of nextJsVendorApps) {
        await startJejuApp(app, l2RpcPort);
        await new Promise(r => setTimeout(r, 3000));
      }
      
      console.log(`Vendor apps started\n`);
      displayAppsSummary();
    }

    // Health checks
    await new Promise(r => setTimeout(r, 5000));

    const servicesWithUrls = Array.from(services.entries()).filter(([, s]) => s.url && s.status === "starting");
    for (const [id, service] of servicesWithUrls) {
      if (id.includes('rpc')) continue;
      if (service.url) await waitForService(id, service.url, 30000);
    }

    if (services.has("prometheus")) {
      await waitForService("prometheus", `http://localhost:${INFRA_PORTS.PROMETHEUS.get()}/-/healthy`, 15000);
    }
    if (services.has("grafana")) {
      await waitForService("grafana", `http://localhost:${INFRA_PORTS.GRAFANA.get()}`, 15000);
    }

    const stillStarting = Array.from(services.entries()).filter(([, s]) => s.status === "starting");
    const errorServices = Array.from(services.entries()).filter(([, s]) => s.status === "error");
    const hasIssues = errorServices.length > 0 || stillStarting.length > 0;
    
    // Start token accumulator in background (for testnet funding)
    if (!noAccumulator && existsSync(join(process.cwd(), 'packages/deployment/.keys/testnet-deployer.json'))) {
      console.log(`Starting token accumulator (testnet funding)...`);
      const accumulatorProc = spawn({
        cmd: ["bun", "run", "scripts/token-accumulator.ts", "--watch"],
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
      });
      processes.push(accumulatorProc);
      
      // Log accumulator output (minimal)
      (async () => {
        if (!accumulatorProc.stdout) return;
        const stdout = accumulatorProc.stdout as unknown as AsyncIterable<Uint8Array>;
        for await (const chunk of stdout) {
          const text = new TextDecoder().decode(chunk).trim();
          if (text.includes('Bridge tx:') || text.includes('Summary:') || text.includes('low')) {
            console.log(`${COLORS.MAGENTA}[Accumulator]${COLORS.RESET} ${text}`);
          }
        }
      })();
    }
    
    await printDashboard(hasIssues);
    
    if (errorServices.length > 0) {
      console.log(`\n${COLORS.RED}Failed services:${COLORS.RESET}`);
      for (const [, service] of errorServices) {
        console.log(`  ${service.name}${service.url ? ` (${service.url})` : ''}`);
      }
    }
    
    if (stillStarting.length > 0) {
      console.log(`\n${COLORS.YELLOW}Still starting:${COLORS.RESET}`);
      for (const [, service] of stillStarting) {
        console.log(`  ${service.name}${service.url ? ` (${service.url})` : ''}`);
      }
    }

    await new Promise(() => {});
  } catch (error) {
    console.error(`Startup failed:`, error);
    await cleanup();
    process.exit(1);
  }
}

// Run
main();
