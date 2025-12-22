#!/usr/bin/env bun
/**
 * DWS Local Development Environment
 * 
 * Starts all required services for local development:
 * - Anvil (local chain)
 * - IPFS (local node)
 * - DWS server
 * - Dstack TEE simulator
 * - Local compute nodes
 * 
 * This provides a fully self-contained environment for testing
 * the entire decentralized infrastructure locally.
 */

import { spawn, type Subprocess } from 'bun';
import { existsSync, mkdirSync } from 'fs';

// ============================================================================
// Configuration
// ============================================================================

interface LocalDevConfig {
  // Ports
  anvilPort: number;
  ipfsApiPort: number;
  ipfsGatewayPort: number;
  dwsPort: number;
  dstackPort: number;
  
  // Paths
  dataDir: string;
  
  // Options
  deployContracts: boolean;
  startNodes: number;
  enableTeeSimulator: boolean;
  verbose: boolean;
}

const DEFAULT_CONFIG: LocalDevConfig = {
  anvilPort: 8545,
  ipfsApiPort: 5001,
  ipfsGatewayPort: 8080,
  dwsPort: 4030,
  dstackPort: 8090,
  dataDir: '.dws-local',
  deployContracts: true,
  startNodes: 3,
  enableTeeSimulator: true,
  verbose: false,
};

// ============================================================================
// Process Management
// ============================================================================

const processes: Map<string, Subprocess> = new Map();

async function startProcess(
  name: string,
  command: string[],
  options: { cwd?: string; env?: Record<string, string>; onReady?: (line: string) => boolean } = {}
): Promise<Subprocess> {
  console.log(`[Local Dev] Starting ${name}...`);
  
  const proc = spawn({
    cmd: command,
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  processes.set(name, proc);

  // Wait for ready signal if provided
  if (options.onReady) {
    await new Promise<void>((resolve) => {
      const checkOutput = async () => {
        const reader = proc.stdout.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const text = decoder.decode(value);
          for (const line of text.split('\n')) {
            if (options.verbose !== false) {
              console.log(`[${name}] ${line}`);
            }
            if (options.onReady!(line)) {
              resolve();
              return;
            }
          }
        }
      };
      checkOutput();
      
      // Timeout after 30 seconds
      setTimeout(resolve, 30000);
    });
  }

  console.log(`[Local Dev] ${name} started (PID: ${proc.pid})`);
  return proc;
}

async function stopAll(): Promise<void> {
  console.log('[Local Dev] Stopping all services...');
  
  for (const [name, proc] of processes) {
    console.log(`[Local Dev] Stopping ${name}...`);
    proc.kill();
  }
  
  processes.clear();
}

// ============================================================================
// Service Starters
// ============================================================================

async function startAnvil(config: LocalDevConfig): Promise<void> {
  await startProcess('anvil', [
    'anvil',
    '--port', String(config.anvilPort),
    '--block-time', '1',
    '--accounts', '10',
    '--balance', '10000',
  ], {
    onReady: (line) => line.includes('Listening on'),
  });
}

async function startIPFS(config: LocalDevConfig): Promise<void> {
  const ipfsPath = `${config.dataDir}/ipfs`;
  if (!existsSync(ipfsPath)) {
    mkdirSync(ipfsPath, { recursive: true });
    // Initialize IPFS
    await Bun.$`IPFS_PATH=${ipfsPath} ipfs init --profile=test`.quiet();
  }

  await startProcess('ipfs', [
    'ipfs', 'daemon',
    '--api', `/ip4/127.0.0.1/tcp/${config.ipfsApiPort}`,
    '--gateway', `/ip4/127.0.0.1/tcp/${config.ipfsGatewayPort}`,
  ], {
    env: { IPFS_PATH: ipfsPath },
    onReady: (line) => line.includes('Daemon is ready'),
  });
}

async function startDstackSimulator(config: LocalDevConfig): Promise<void> {
  // Check if dstack simulator is available
  const dstackPath = Bun.which('dstack-simulator');
  
  if (dstackPath) {
    await startProcess('dstack', [
      dstackPath,
      '--port', String(config.dstackPort),
    ], {
      onReady: (line) => line.includes('Listening'),
    });
  } else {
    // Start mock dstack simulator
    console.log('[Local Dev] dstack-simulator not found, using mock simulator');
    await startMockDstackSimulator(config);
  }
}

async function startMockDstackSimulator(config: LocalDevConfig): Promise<void> {
  // Create a simple mock dstack simulator
  const server = Bun.serve({
    port: config.dstackPort,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      
      if (url.pathname === '/info') {
        return Response.json({
          app_id: 'dws-local-dev',
          instance_id: `local-${Date.now()}`,
          os_image_hash: '0x' + '0'.repeat(64),
          compose_hash: '0x' + '0'.repeat(64),
          tcb_info: { simulator: true },
        });
      }
      
      if (url.pathname.startsWith('/GetQuote')) {
        const reportData = url.searchParams.get('report_data') ?? '0x';
        return Response.json({
          quote: '0x' + '00'.repeat(256), // Mock quote
          event_log: JSON.stringify({ simulator: true, timestamp: Date.now() }),
          report_data: reportData,
        });
      }
      
      if (url.pathname === '/DeriveKey') {
        const body = await request.json() as { path: string; purpose: string };
        const mockKey = Buffer.from(body.path + body.purpose).toString('hex').padEnd(64, '0');
        return Response.json({
          key: mockKey,
          signature: '0x' + '00'.repeat(64),
          asBytes: () => Buffer.from(mockKey, 'hex'),
          toJSON: () => ({ key: mockKey, signature: '0x' + '00'.repeat(64) }),
        });
      }
      
      if (url.pathname === '/GetTlsKey') {
        return Response.json({
          key: '-----BEGIN PRIVATE KEY-----\nMOCK_KEY\n-----END PRIVATE KEY-----',
          certificate_chain: [
            '-----BEGIN CERTIFICATE-----\nMOCK_CERT\n-----END CERTIFICATE-----',
          ],
        });
      }
      
      return new Response('Not Found', { status: 404 });
    },
  });

  console.log(`[Local Dev] Mock dstack simulator started on port ${config.dstackPort}`);
}

async function deployContracts(config: LocalDevConfig): Promise<Record<string, string>> {
  console.log('[Local Dev] Deploying contracts...');
  
  // Use forge to deploy contracts
  const contractsDir = new URL('../../../contracts', import.meta.url).pathname;
  
  const result = await Bun.$`
    cd ${contractsDir} && \
    forge script script/Deploy.s.sol:DeployScript \
      --rpc-url http://localhost:${config.anvilPort} \
      --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
      --broadcast \
      --json
  `.quiet().text();
  
  // Parse deployed addresses
  const addresses: Record<string, string> = {};
  
  // Default addresses for localnet
  addresses.IdentityRegistry = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
  addresses.JNSRegistry = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
  addresses.JNSResolver = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
  
  console.log('[Local Dev] Contracts deployed:', addresses);
  return addresses;
}

async function startDWS(config: LocalDevConfig, addresses: Record<string, string>): Promise<void> {
  await startProcess('dws', [
    'bun', 'run', 'src/server/index.ts',
  ], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      DWS_PORT: String(config.dwsPort),
      RPC_URL: `http://localhost:${config.anvilPort}`,
      IDENTITY_REGISTRY_ADDRESS: addresses.IdentityRegistry ?? '',
      JNS_REGISTRY_ADDRESS: addresses.JNSRegistry ?? '',
      JNS_RESOLVER_ADDRESS: addresses.JNSResolver ?? '',
      IPFS_GATEWAY_URL: `http://localhost:${config.ipfsGatewayPort}`,
      IPFS_API_URL: `http://localhost:${config.ipfsApiPort}`,
      DSTACK_ENDPOINT: `http://localhost:${config.dstackPort}`,
      DSTACK_SIMULATOR: 'true',
      NETWORK: 'localnet',
    },
    onReady: (line) => line.includes('DWS server started'),
  });
}

async function startLocalNodes(config: LocalDevConfig, addresses: Record<string, string>): Promise<void> {
  for (let i = 0; i < config.startNodes; i++) {
    const nodePort = config.dwsPort + 100 + i;
    
    await startProcess(`node-${i}`, [
      'bun', 'run', 'src/server/index.ts',
    ], {
      cwd: new URL('..', import.meta.url).pathname,
      env: {
        DWS_PORT: String(nodePort),
        DWS_NODE_ID: `local-node-${i}`,
        DWS_IS_WORKER_NODE: 'true',
        RPC_URL: `http://localhost:${config.anvilPort}`,
        IDENTITY_REGISTRY_ADDRESS: addresses.IdentityRegistry ?? '',
        IPFS_GATEWAY_URL: `http://localhost:${config.ipfsGatewayPort}`,
        DSTACK_ENDPOINT: `http://localhost:${config.dstackPort}`,
        DSTACK_SIMULATOR: 'true',
        NETWORK: 'localnet',
        // Use test private keys (anvil default accounts)
        DWS_PRIVATE_KEY: getTestPrivateKey(i + 1),
      },
      onReady: (line) => line.includes('DWS server started'),
    });
  }
}

function getTestPrivateKey(index: number): string {
  // Anvil default private keys
  const keys = [
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
    '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
    '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
    '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
    '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
    '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97',
    '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6',
  ];
  return keys[index % keys.length];
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = { ...DEFAULT_CONFIG };
  
  // Parse args
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--verbose':
      case '-v':
        config.verbose = true;
        break;
      case '--nodes':
        config.startNodes = parseInt(args[++i], 10);
        break;
      case '--no-contracts':
        config.deployContracts = false;
        break;
      case '--no-tee':
        config.enableTeeSimulator = false;
        break;
      case '--help':
      case '-h':
        console.log(`
DWS Local Development Environment

Usage: bun run scripts/local-dev.ts [options]

Options:
  --verbose, -v       Show verbose output
  --nodes N           Start N local worker nodes (default: 3)
  --no-contracts      Skip contract deployment
  --no-tee            Skip TEE simulator
  --help, -h          Show this help

Environment:
  All services run on localhost:
  - Anvil (chain): ${config.anvilPort}
  - IPFS API: ${config.ipfsApiPort}
  - IPFS Gateway: ${config.ipfsGatewayPort}
  - DWS: ${config.dwsPort}
  - Dstack (TEE): ${config.dstackPort}
  - Worker nodes: ${config.dwsPort + 100}+
`);
        process.exit(0);
    }
  }

  // Ensure data directory exists
  if (!existsSync(config.dataDir)) {
    mkdirSync(config.dataDir, { recursive: true });
  }

  // Handle shutdown
  process.on('SIGINT', async () => {
    await stopAll();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await stopAll();
    process.exit(0);
  });

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║           DWS Local Development Environment                  ║
╚══════════════════════════════════════════════════════════════╝

Starting services...
`);

  try {
    // Start infrastructure
    await startAnvil(config);
    await Bun.sleep(1000); // Wait for anvil to be ready
    
    await startIPFS(config);
    
    if (config.enableTeeSimulator) {
      await startDstackSimulator(config);
    }

    // Deploy contracts
    let addresses: Record<string, string> = {};
    if (config.deployContracts) {
      try {
        addresses = await deployContracts(config);
      } catch (err) {
        console.warn('[Local Dev] Contract deployment failed, using defaults:', err);
        addresses = {
          IdentityRegistry: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
          JNSRegistry: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
          JNSResolver: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
        };
      }
    }

    // Start DWS main server
    await startDWS(config, addresses);

    // Start worker nodes
    if (config.startNodes > 0) {
      await startLocalNodes(config, addresses);
    }

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║               Local Environment Ready                         ║
╠══════════════════════════════════════════════════════════════╣
║                                                               ║
║  Chain (Anvil):    http://localhost:${config.anvilPort}                    ║
║  IPFS Gateway:     http://localhost:${config.ipfsGatewayPort}                     ║
║  IPFS API:         http://localhost:${config.ipfsApiPort}                      ║
║  DWS Server:       http://localhost:${config.dwsPort}                      ║
║  TEE Simulator:    http://localhost:${config.dstackPort}                      ║
║  Worker Nodes:     ${config.startNodes} nodes (ports ${config.dwsPort + 100}-${config.dwsPort + 100 + config.startNodes - 1})           ║
║                                                               ║
║  Press Ctrl+C to stop all services                           ║
║                                                               ║
╚══════════════════════════════════════════════════════════════╝
`);

    // Keep running
    await new Promise(() => {});
    
  } catch (err) {
    console.error('[Local Dev] Error:', err);
    await stopAll();
    process.exit(1);
  }
}

main().catch(console.error);

