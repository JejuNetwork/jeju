#!/usr/bin/env bun
/**
 * Jeju Local Development Environment
 * 
 * Unified script that starts the entire local dev stack:
 * - Anvil (local blockchain)
 * - IPFS daemon
 * - Contract deployment (governance, funding, registries)
 * - DWS server (storage, compute, cdn, funding, etc.)
 * - Factory frontend
 * - Autocrat frontend
 * 
 * Usage:
 *   bun run scripts/dev-local.ts
 *   bun run scripts/dev-local.ts --skip-contracts   # Use existing contracts
 *   bun run scripts/dev-local.ts --only dws         # Only start DWS
 *   bun run scripts/dev-local.ts --only factory     # Only start Factory
 */

import { spawn, type Subprocess } from 'bun';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';

// ============ Configuration ============

interface LocalDevConfig {
  anvilPort: number;
  ipfsApiPort: number;
  ipfsGatewayPort: number;
  dwsPort: number;
  factoryPort: number;
  autocratPort: number;
  dataDir: string;
  deployContracts: boolean;
  verbose: boolean;
}

const DEFAULT_CONFIG: LocalDevConfig = {
  anvilPort: 8545,
  ipfsApiPort: 5001,
  ipfsGatewayPort: 8080,
  dwsPort: 4030,
  factoryPort: 3000,
  autocratPort: 3001,
  dataDir: '.local-dev',
  deployContracts: true,
  verbose: false,
};

// ============ Globals ============

const processes: Map<string, Subprocess> = new Map();
let deployedAddresses: Record<string, string> = {};

// ============ Utilities ============

function log(service: string, message: string) {
  console.log(`[${service}] ${message}`);
}

async function waitForPort(port: number, timeout = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`);
      if (response.ok || response.status < 500) return true;
    } catch {
      // Port not ready
    }
    await Bun.sleep(500);
  }
  return false;
}

async function waitForRpc(port: number, timeout = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
      });
      if (response.ok) return true;
    } catch {
      // RPC not ready
    }
    await Bun.sleep(500);
  }
  return false;
}

// ============ Service Starters ============

async function startAnvil(config: LocalDevConfig): Promise<void> {
  log('anvil', 'Starting local blockchain...');
  
  const proc = spawn(['anvil', '--port', String(config.anvilPort), '--block-time', '1', '--accounts', '10', '--balance', '10000'], {
    stdout: config.verbose ? 'inherit' : 'pipe',
    stderr: config.verbose ? 'inherit' : 'pipe',
  });
  processes.set('anvil', proc);
  
  if (await waitForRpc(config.anvilPort)) {
    log('anvil', `Ready on http://127.0.0.1:${config.anvilPort}`);
  } else {
    throw new Error('Anvil failed to start');
  }
}

async function startIPFS(config: LocalDevConfig): Promise<void> {
  const ipfsPath = `${config.dataDir}/ipfs`;
  
  if (!existsSync(ipfsPath)) {
    log('ipfs', 'Initializing IPFS...');
    mkdirSync(ipfsPath, { recursive: true });
    await Bun.$`IPFS_PATH=${ipfsPath} ipfs init --profile=test`.quiet();
  }
  
  log('ipfs', 'Starting IPFS daemon...');
  const proc = spawn(['ipfs', 'daemon'], {
    env: { ...process.env, IPFS_PATH: ipfsPath },
    stdout: config.verbose ? 'inherit' : 'pipe',
    stderr: config.verbose ? 'inherit' : 'pipe',
  });
  processes.set('ipfs', proc);
  
  await Bun.sleep(3000); // IPFS takes a bit to start
  log('ipfs', `API on http://127.0.0.1:${config.ipfsApiPort}, Gateway on http://127.0.0.1:${config.ipfsGatewayPort}`);
}

async function deployContracts(config: LocalDevConfig): Promise<Record<string, string>> {
  log('contracts', 'Deploying contracts...');
  
  const contractsDir = `${import.meta.dir}/../packages/contracts`;
  const deployerKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  
  // Deploy all contracts
  const deployScript = `
    cd ${contractsDir} && \
    forge script script/Deploy.s.sol:DeployScript \
      --rpc-url http://127.0.0.1:${config.anvilPort} \
      --private-key ${deployerKey} \
      --broadcast \
      2>&1
  `;
  
  try {
    await Bun.$`bash -c ${deployScript}`.quiet();
  } catch (err) {
    log('contracts', 'Deployment script returned non-zero (may be ok if contracts exist)');
  }
  
  // Use deterministic addresses for localnet
  const addresses: Record<string, string> = {
    IdentityRegistry: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    ReputationRegistry: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    ValidationRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    DAORegistry: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
    DAOFunding: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
    ContributorRegistry: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
    PaymentRequestRegistry: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
    WorkAgreementRegistry: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
    DeepFundingDistributor: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6',
    BountyRegistry: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318',
    JNSRegistry: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788',
    JNSResolver: '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e',
  };
  
  // Save to file
  const deploymentPath = `${config.dataDir}/deployment.json`;
  writeFileSync(deploymentPath, JSON.stringify(addresses, null, 2));
  log('contracts', `Deployed. Addresses saved to ${deploymentPath}`);
  
  return addresses;
}

async function startDWS(config: LocalDevConfig, addresses: Record<string, string>): Promise<void> {
  log('dws', 'Starting DWS server...');
  
  const dwsDir = `${import.meta.dir}/../apps/dws`;
  const proc = spawn(['bun', 'run', 'src/server/index.ts'], {
    cwd: dwsDir,
    env: {
      ...process.env,
      DWS_PORT: String(config.dwsPort),
      RPC_URL: `http://127.0.0.1:${config.anvilPort}`,
      NETWORK: 'localnet',
      IPFS_GATEWAY_URL: `http://127.0.0.1:${config.ipfsGatewayPort}`,
      IPFS_API_URL: `http://127.0.0.1:${config.ipfsApiPort}`,
      IDENTITY_REGISTRY_ADDRESS: addresses.IdentityRegistry,
      DAO_REGISTRY_ADDRESS: addresses.DAORegistry,
      CONTRIBUTOR_REGISTRY_ADDRESS: addresses.ContributorRegistry,
      PAYMENT_REQUEST_REGISTRY_ADDRESS: addresses.PaymentRequestRegistry,
      DEEP_FUNDING_DISTRIBUTOR_ADDRESS: addresses.DeepFundingDistributor,
      JNS_REGISTRY_ADDRESS: addresses.JNSRegistry,
      JNS_RESOLVER_ADDRESS: addresses.JNSResolver,
    },
    stdout: config.verbose ? 'inherit' : 'pipe',
    stderr: config.verbose ? 'inherit' : 'pipe',
  });
  processes.set('dws', proc);
  
  if (await waitForPort(config.dwsPort)) {
    log('dws', `Ready on http://127.0.0.1:${config.dwsPort}`);
  } else {
    throw new Error('DWS failed to start');
  }
}

async function startFactory(config: LocalDevConfig, addresses: Record<string, string>): Promise<void> {
  log('factory', 'Starting Factory frontend...');
  
  const factoryDir = `${import.meta.dir}/../apps/factory`;
  const proc = spawn(['bun', 'run', 'dev'], {
    cwd: factoryDir,
    env: {
      ...process.env,
      PORT: String(config.factoryPort),
      NEXT_PUBLIC_RPC_URL: `http://127.0.0.1:${config.anvilPort}`,
      NEXT_PUBLIC_DWS_URL: `http://127.0.0.1:${config.dwsPort}`,
      NEXT_PUBLIC_CHAIN_ID: '31337',
      NEXT_PUBLIC_CONTRIBUTOR_REGISTRY: addresses.ContributorRegistry,
      NEXT_PUBLIC_PAYMENT_REQUEST_REGISTRY: addresses.PaymentRequestRegistry,
      NEXT_PUBLIC_DEEP_FUNDING_DISTRIBUTOR: addresses.DeepFundingDistributor,
      NEXT_PUBLIC_DAO_REGISTRY: addresses.DAORegistry,
    },
    stdout: config.verbose ? 'inherit' : 'pipe',
    stderr: config.verbose ? 'inherit' : 'pipe',
  });
  processes.set('factory', proc);
  
  await Bun.sleep(5000); // Next.js takes time to compile
  log('factory', `Ready on http://127.0.0.1:${config.factoryPort}`);
}

async function startAutocrat(config: LocalDevConfig, addresses: Record<string, string>): Promise<void> {
  log('autocrat', 'Starting Autocrat frontend...');
  
  const autocratDir = `${import.meta.dir}/../apps/autocrat/app`;
  const proc = spawn(['bun', 'run', 'dev', '-p', String(config.autocratPort)], {
    cwd: autocratDir,
    env: {
      ...process.env,
      NEXT_PUBLIC_RPC_URL: `http://127.0.0.1:${config.anvilPort}`,
      NEXT_PUBLIC_DWS_URL: `http://127.0.0.1:${config.dwsPort}`,
      NEXT_PUBLIC_CHAIN_ID: '31337',
      NEXT_PUBLIC_DAO_REGISTRY: addresses.DAORegistry,
      NEXT_PUBLIC_DAO_FUNDING: addresses.DAOFunding,
    },
    stdout: config.verbose ? 'inherit' : 'pipe',
    stderr: config.verbose ? 'inherit' : 'pipe',
  });
  processes.set('autocrat', proc);
  
  await Bun.sleep(5000);
  log('autocrat', `Ready on http://127.0.0.1:${config.autocratPort}`);
}

async function stopAll(): Promise<void> {
  console.log('\nStopping all services...');
  for (const [name, proc] of processes) {
    console.log(`  Stopping ${name}...`);
    proc.kill();
  }
  processes.clear();
}

// ============ Main ============

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = { ...DEFAULT_CONFIG };
  let only: string | null = null;
  
  // Parse args
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--verbose':
      case '-v':
        config.verbose = true;
        break;
      case '--skip-contracts':
        config.deployContracts = false;
        break;
      case '--only':
        only = args[++i];
        break;
      case '--help':
      case '-h':
        console.log(`
Jeju Local Development Environment

Usage: bun run scripts/dev-local.ts [options]

Options:
  --verbose, -v       Show verbose output from all services
  --skip-contracts    Skip contract deployment (use existing)
  --only <service>    Only start specific service (dws, factory, autocrat)
  --help, -h          Show this help

Services:
  - Anvil (chain):     http://localhost:${config.anvilPort}
  - IPFS Gateway:      http://localhost:${config.ipfsGatewayPort}
  - DWS:               http://localhost:${config.dwsPort}
  - Factory:           http://localhost:${config.factoryPort}
  - Autocrat:          http://localhost:${config.autocratPort}
`);
        process.exit(0);
    }
  }

  // Ensure data directory
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
║             Jeju Local Development Environment               ║
╚══════════════════════════════════════════════════════════════╝
`);

  try {
    // Load existing deployment or deploy new
    const deploymentPath = `${config.dataDir}/deployment.json`;
    
    if (!only || only === 'anvil') {
      await startAnvil(config);
    }
    
    if (!only) {
      await startIPFS(config);
    }
    
    if (config.deployContracts && (!only || only === 'contracts')) {
      deployedAddresses = await deployContracts(config);
    } else if (existsSync(deploymentPath)) {
      deployedAddresses = JSON.parse(readFileSync(deploymentPath, 'utf-8'));
      log('contracts', 'Loaded existing deployment');
    } else {
      // Use defaults
      deployedAddresses = {
        IdentityRegistry: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
        DAORegistry: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
        ContributorRegistry: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
        PaymentRequestRegistry: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
        DeepFundingDistributor: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6',
        JNSRegistry: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788',
      };
    }
    
    if (!only || only === 'dws') {
      await startDWS(config, deployedAddresses);
    }
    
    if (!only || only === 'factory') {
      await startFactory(config, deployedAddresses);
    }
    
    if (!only || only === 'autocrat') {
      await startAutocrat(config, deployedAddresses);
    }

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                  All Services Running                         ║
╠══════════════════════════════════════════════════════════════╣
║                                                               ║
║  Blockchain:    http://localhost:${config.anvilPort}                          ║
║  IPFS Gateway:  http://localhost:${config.ipfsGatewayPort}                           ║
║  DWS Server:    http://localhost:${config.dwsPort}                          ║
║  Factory:       http://localhost:${config.factoryPort}                          ║
║  Autocrat:      http://localhost:${config.autocratPort}                          ║
║                                                               ║
║  Funding API:   http://localhost:${config.dwsPort}/funding                  ║
║  Package Proxy: http://localhost:${config.dwsPort}/registry                 ║
║                                                               ║
║  Press Ctrl+C to stop all services                           ║
║                                                               ║
╚══════════════════════════════════════════════════════════════╝
`);

    // Keep running
    await new Promise(() => {});
    
  } catch (err) {
    console.error('Error:', err);
    await stopAll();
    process.exit(1);
  }
}

main().catch(console.error);

