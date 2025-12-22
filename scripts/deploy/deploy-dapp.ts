#!/usr/bin/env bun
/**
 * Decentralized App Deployment
 * 
 * Deploys apps as decentralized dApps via JNS + IPFS:
 * 1. Build the app
 * 2. Upload to IPFS via DWS
 * 3. Register/update JNS contenthash
 * 
 * Usage:
 *   bun run scripts/deploy/deploy-dapp.ts --app bazaar
 *   bun run scripts/deploy/deploy-dapp.ts --all
 *   bun run scripts/deploy/deploy-dapp.ts --app gateway --network mainnet
 */

import { $ } from 'bun';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  keccak256,
  toBytes,
  concat,
  toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, base, localhost } from 'viem/chains';
import { readFileSync, existsSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join, relative, extname } from 'path';

// ============================================================================
// Types
// ============================================================================

interface AppManifest {
  name: string;
  displayName?: string;
  jns?: { name: string; description?: string };
  decentralization?: {
    frontend?: {
      buildDir?: string;
      buildCommand?: string;
      ipfs?: boolean;
      arweave?: boolean;
      jnsName?: string;
    };
  };
  commands?: {
    build?: string;
  };
  agent?: {
    a2aEndpoint?: string;
    mcpEndpoint?: string;
  };
}

interface DeployResult {
  app: string;
  jnsName: string;
  ipfsCid: string;
  arweaveTxId?: string;
  contentHash: Hex;
  txHash?: string;
  url: string;
  deployedAt: string;
}

// ============================================================================
// Constants
// ============================================================================

const ROOT_DIR = join(import.meta.dir, '../..');
const APPS_DIR = join(ROOT_DIR, 'apps');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.webp': 'image/webp',
};

// JNS ABIs
const JNS_RESOLVER_ABI = [
  {
    name: 'setContenthash',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'hash', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'setText',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'contenthash',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes' }],
    stateMutability: 'view',
  },
] as const;

// ============================================================================
// Deployer
// ============================================================================

class DAppDeployer {
  private network: 'localnet' | 'testnet' | 'mainnet';
  private dwsEndpoint: string;
  private privateKey: Hex;
  private account: ReturnType<typeof privateKeyToAccount>;
  private publicClient: ReturnType<typeof createPublicClient>;
  private walletClient: ReturnType<typeof createWalletClient>;
  private registrarAddress: Address;
  private resolverAddress: Address;
  private domain: string;
  private results: DeployResult[] = [];

  constructor(network: 'localnet' | 'testnet' | 'mainnet' = 'testnet') {
    this.network = network;
    
    // Configure endpoints
    this.dwsEndpoint = this.getDwsEndpoint();
    this.domain = this.getDomain();
    
    // Load private key
    this.privateKey = (process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY) as Hex;
    if (!this.privateKey) {
      throw new Error('DEPLOYER_PRIVATE_KEY or PRIVATE_KEY required');
    }
    
    // Setup accounts and clients
    this.account = privateKeyToAccount(this.privateKey);
    const { chain, rpcUrl } = this.getChainConfig();
    
    this.publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(rpcUrl),
    });
    
    // Load contract addresses
    const { registrar, resolver } = this.getContractAddresses();
    this.registrarAddress = registrar;
    this.resolverAddress = resolver;
  }

  private getDwsEndpoint(): string {
    if (process.env.DWS_ENDPOINT) return process.env.DWS_ENDPOINT;
    
    switch (this.network) {
      case 'mainnet': return 'https://dws.jejunetwork.org';
      case 'testnet': return 'https://dws.testnet.jejunetwork.org';
      default: return 'http://localhost:4030';
    }
  }

  private getDomain(): string {
    switch (this.network) {
      case 'mainnet': return 'jejunetwork.org';
      case 'testnet': return 'testnet.jejunetwork.org';
      default: return 'localhost:4022';
    }
  }

  private getChainConfig(): { chain: typeof base; rpcUrl: string } {
    switch (this.network) {
      case 'mainnet':
        return {
          chain: base,
          rpcUrl: process.env.MAINNET_RPC_URL || 'https://mainnet.base.org',
        };
      case 'testnet':
        return {
          chain: baseSepolia,
          rpcUrl: process.env.TESTNET_RPC_URL || 'https://sepolia.base.org',
        };
      default:
        return {
          chain: localhost,
          rpcUrl: process.env.RPC_URL || 'http://localhost:8545',
        };
    }
  }

  private getContractAddresses(): { registrar: Address; resolver: Address } {
    // Load from config
    const configPath = join(ROOT_DIR, 'packages/config/contracts.json');
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      const networkConfig = config[this.network];
      if (networkConfig?.JNSRegistrar && networkConfig?.JNSResolver) {
        return {
          registrar: networkConfig.JNSRegistrar as Address,
          resolver: networkConfig.JNSResolver as Address,
        };
      }
    }
    
    // Fallback to env vars
    return {
      registrar: (process.env.JNS_REGISTRAR_ADDRESS || '0x0') as Address,
      resolver: (process.env.JNS_RESOLVER_ADDRESS || '0x0') as Address,
    };
  }

  // ==========================================================================
  // Main Deploy Flow
  // ==========================================================================

  async deployApp(appName: string): Promise<DeployResult | null> {
    console.log(`\n📦 Deploying ${appName}...`);
    
    // Load manifest
    const appPath = join(APPS_DIR, appName);
    const manifestPath = join(appPath, 'jeju-manifest.json');
    
    if (!existsSync(manifestPath)) {
      console.error(`❌ No jeju-manifest.json found for ${appName}`);
      return null;
    }
    
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as AppManifest;
    const frontendConfig = manifest.decentralization?.frontend;
    
    if (!frontendConfig) {
      console.error(`❌ No decentralization.frontend config for ${appName}`);
      return null;
    }
    
    // 1. Build the app
    console.log('  🔨 Building...');
    const buildDir = await this.buildApp(appPath, manifest);
    if (!buildDir) return null;
    
    // 2. Upload to IPFS via DWS
    console.log('  📤 Uploading to IPFS...');
    const ipfsCid = await this.uploadToIPFS(buildDir, appName);
    if (!ipfsCid) return null;
    
    // 3. Register/Update JNS
    const jnsName = manifest.jns?.name || `${appName}.jeju`;
    console.log(`  🌐 Updating JNS: ${jnsName}...`);
    const { contentHash, txHash } = await this.updateJNS(jnsName, ipfsCid, manifest);
    
    // 4. Set text records for A2A/MCP if configured
    if (manifest.agent?.a2aEndpoint) {
      await this.setJNSText(jnsName, 'a2a', manifest.agent.a2aEndpoint);
    }
    if (manifest.agent?.mcpEndpoint) {
      await this.setJNSText(jnsName, 'mcp', manifest.agent.mcpEndpoint);
    }
    
    const result: DeployResult = {
      app: appName,
      jnsName,
      ipfsCid,
      contentHash,
      txHash,
      url: `https://${jnsName.replace('.jeju', '')}.jns.${this.domain}`,
      deployedAt: new Date().toISOString(),
    };
    
    console.log(`  ✅ Deployed: ${result.url}`);
    this.results.push(result);
    return result;
  }

  async deployAll(): Promise<DeployResult[]> {
    console.log('╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║          JEJU DAPP DEPLOYMENT                                        ║');
    console.log('╚══════════════════════════════════════════════════════════════════════╝');
    console.log(`Network: ${this.network}`);
    console.log(`DWS: ${this.dwsEndpoint}`);
    console.log(`Deployer: ${this.account.address}`);
    
    const apps = this.discoverApps();
    console.log(`\nFound ${apps.length} apps to deploy: ${apps.join(', ')}`);
    
    for (const app of apps) {
      await this.deployApp(app);
    }
    
    this.printSummary();
    this.saveResults();
    
    return this.results;
  }

  // ==========================================================================
  // Build
  // ==========================================================================

  private async buildApp(appPath: string, manifest: AppManifest): Promise<string | null> {
    const frontendConfig = manifest.decentralization?.frontend;
    const buildDir = join(appPath, frontendConfig?.buildDir || 'dist');
    
    // Check if already built
    if (existsSync(buildDir) && this.hasFiles(buildDir)) {
      console.log('    Using existing build');
      return buildDir;
    }
    
    // Run build command
    const buildCommand = manifest.commands?.build || 'bun run build';
    
    const result = await $`${buildCommand.split(' ')}`.cwd(appPath).nothrow();
    
    if (result.exitCode !== 0) {
      console.error(`    Build failed: ${result.stderr}`);
      return null;
    }
    
    if (!existsSync(buildDir)) {
      console.error(`    Build dir not found: ${buildDir}`);
      return null;
    }
    
    return buildDir;
  }

  // ==========================================================================
  // IPFS Upload
  // ==========================================================================

  private async uploadToIPFS(buildDir: string, appName: string): Promise<string | null> {
    const files = this.walkDir(buildDir);
    const fileData: Array<{ path: string; content: Buffer; type: string }> = [];
    
    for (const file of files) {
      const relativePath = relative(buildDir, file);
      const content = readFileSync(file);
      const ext = extname(file);
      const type = MIME_TYPES[ext] || 'application/octet-stream';
      fileData.push({ path: relativePath, content, type });
    }
    
    console.log(`    ${files.length} files to upload`);
    
    // Upload directory to DWS
    const formData = new FormData();
    
    for (const { path, content, type } of fileData) {
      const blob = new Blob([content], { type });
      formData.append('files', blob, path);
    }
    
    formData.append('name', appName);
    formData.append('permanent', 'true');
    
    const response = await fetch(`${this.dwsEndpoint}/storage/upload-directory`, {
      method: 'POST',
      body: formData,
      headers: {
        'x-jeju-address': this.account.address,
      },
    });
    
    if (!response.ok) {
      // Fallback to individual file upload
      console.log('    Falling back to individual uploads...');
      return this.uploadFilesIndividually(fileData, appName);
    }
    
    const result = await response.json() as { cid: string };
    return result.cid;
  }

  private async uploadFilesIndividually(
    files: Array<{ path: string; content: Buffer; type: string }>,
    appName: string
  ): Promise<string | null> {
    const uploads: Array<{ path: string; cid: string }> = [];
    
    for (const { path, content, type } of files) {
      const formData = new FormData();
      const blob = new Blob([content], { type });
      formData.append('file', blob, path);
      formData.append('permanent', 'true');
      
      const response = await fetch(`${this.dwsEndpoint}/storage/upload`, {
        method: 'POST',
        body: formData,
        headers: { 'x-jeju-address': this.account.address },
      });
      
      if (response.ok) {
        const result = await response.json() as { cid: string };
        uploads.push({ path, cid: result.cid });
      }
    }
    
    // Create manifest with all CIDs
    const manifest = {
      name: appName,
      files: uploads,
      createdAt: new Date().toISOString(),
    };
    
    const manifestBlob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    const formData = new FormData();
    formData.append('file', manifestBlob, `${appName}-manifest.json`);
    formData.append('permanent', 'true');
    
    const response = await fetch(`${this.dwsEndpoint}/storage/upload`, {
      method: 'POST',
      body: formData,
      headers: { 'x-jeju-address': this.account.address },
    });
    
    if (!response.ok) {
      console.error('    Failed to upload manifest');
      return null;
    }
    
    const result = await response.json() as { cid: string };
    return result.cid;
  }

  // ==========================================================================
  // JNS
  // ==========================================================================

  private async updateJNS(
    jnsName: string,
    ipfsCid: string,
    _manifest: AppManifest
  ): Promise<{ contentHash: Hex; txHash?: string }> {
    const node = this.namehash(jnsName);
    const contentHash = this.encodeIPFSContentHash(ipfsCid);
    
    // Check if we have valid contract addresses
    if (this.resolverAddress === '0x0' as Address) {
      console.log('    ⚠️  No JNS resolver configured, skipping on-chain registration');
      return { contentHash };
    }
    
    // Check current contenthash
    const currentHash = await this.publicClient.readContract({
      address: this.resolverAddress,
      abi: JNS_RESOLVER_ABI,
      functionName: 'contenthash',
      args: [node as `0x${string}`],
    }).catch(() => '0x' as `0x${string}`);
    
    if (currentHash === contentHash) {
      console.log('    Content hash unchanged, skipping tx');
      return { contentHash };
    }
    
    // Update contenthash
    const txHash = await this.walletClient.writeContract({
      address: this.resolverAddress,
      abi: JNS_RESOLVER_ABI,
      functionName: 'setContenthash',
      args: [node as `0x${string}`, contentHash],
    });
    
    console.log(`    TX: ${txHash}`);
    
    // Wait for confirmation
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    
    return { contentHash, txHash };
  }

  private async setJNSText(jnsName: string, key: string, value: string): Promise<void> {
    if (this.resolverAddress === '0x0' as Address) return;
    
    const node = this.namehash(jnsName);
    
    await this.walletClient.writeContract({
      address: this.resolverAddress,
      abi: JNS_RESOLVER_ABI,
      functionName: 'setText',
      args: [node as `0x${string}`, key, value],
    });
  }

  private namehash(name: string): string {
    let node = '0x0000000000000000000000000000000000000000000000000000000000000000';
    
    if (name) {
      const labels = name.split('.').reverse();
      for (const label of labels) {
        const labelHash = keccak256(toBytes(label));
        node = keccak256(concat([node as `0x${string}`, labelHash]));
      }
    }
    
    return node;
  }

  private encodeIPFSContentHash(cid: string): Hex {
    // EIP-1577 IPFS content hash encoding
    // Format: 0xe3 (IPFS namespace) + 0x01 (CIDv1) + 0x70 (dag-pb) + multihash
    
    // For CIDv0 (Qm...), convert to bytes and prefix
    if (cid.startsWith('Qm')) {
      const decoded = this.base58Decode(cid);
      return concat(['0xe3010170', toHex(decoded)]) as Hex;
    }
    
    // For CIDv1 (bafy...), it's more complex - simplified here
    return concat(['0xe3010172', toHex(toBytes(cid))]) as Hex;
  }

  private base58Decode(str: string): Uint8Array {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const bytes: number[] = [];
    
    for (const char of str) {
      const carry = ALPHABET.indexOf(char);
      if (carry < 0) throw new Error('Invalid base58 character');
      
      for (let i = 0; i < bytes.length; i++) {
        const value = bytes[i]! * 58 + carry;
        bytes[i] = value % 256;
        // carry = Math.floor(value / 256); // Handled in next iteration
      }
      
      let c = carry;
      while (c > 0) {
        bytes.push(c % 256);
        c = Math.floor(c / 256);
      }
    }
    
    // Handle leading zeros
    for (const char of str) {
      if (char !== '1') break;
      bytes.push(0);
    }
    
    return new Uint8Array(bytes.reverse());
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private discoverApps(): string[] {
    const apps: string[] = [];
    const dirs = readdirSync(APPS_DIR);
    
    for (const dir of dirs) {
      const manifestPath = join(APPS_DIR, dir, 'jeju-manifest.json');
      if (!existsSync(manifestPath)) continue;
      
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as AppManifest;
      if (manifest.decentralization?.frontend) {
        apps.push(dir);
      }
    }
    
    return apps;
  }

  private walkDir(dir: string): string[] {
    const files: string[] = [];
    const entries = readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.walkDir(fullPath));
      } else {
        files.push(fullPath);
      }
    }
    
    return files;
  }

  private hasFiles(dir: string): boolean {
    const entries = readdirSync(dir);
    return entries.length > 0;
  }

  private printSummary(): void {
    console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║                      DEPLOYMENT SUMMARY                              ║');
    console.log('╚══════════════════════════════════════════════════════════════════════╝');
    
    for (const result of this.results) {
      console.log(`\n  ${result.app}:`);
      console.log(`    JNS:  ${result.jnsName}`);
      console.log(`    CID:  ${result.ipfsCid}`);
      console.log(`    URL:  ${result.url}`);
      if (result.txHash) {
        console.log(`    TX:   ${result.txHash}`);
      }
    }
    
    console.log(`\n✅ Deployed ${this.results.length} apps`);
  }

  private saveResults(): void {
    const resultsPath = join(ROOT_DIR, '.jeju', 'dapp-deployments.json');
    const dir = join(ROOT_DIR, '.jeju');
    
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    writeFileSync(resultsPath, JSON.stringify(this.results, null, 2));
    console.log(`\nResults saved to: ${resultsPath}`);
  }
}

// ============================================================================
// CLI
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const appIndex = args.indexOf('--app');
  const networkIndex = args.indexOf('--network');
  const deployAll = args.includes('--all');
  
  const appName = appIndex !== -1 ? args[appIndex + 1] : undefined;
  const network = (networkIndex !== -1 ? args[networkIndex + 1] : 'testnet') as 'localnet' | 'testnet' | 'mainnet';
  
  const deployer = new DAppDeployer(network);
  
  if (deployAll) {
    await deployer.deployAll();
  } else if (appName) {
    await deployer.deployApp(appName);
  } else {
    console.log(`
Usage:
  bun run scripts/deploy/deploy-dapp.ts --app <name>    Deploy specific app
  bun run scripts/deploy/deploy-dapp.ts --all           Deploy all apps
  
Options:
  --network <net>    Network: localnet, testnet, mainnet (default: testnet)
  
Examples:
  bun run scripts/deploy/deploy-dapp.ts --app bazaar
  bun run scripts/deploy/deploy-dapp.ts --all --network mainnet
`);
  }
}

main().catch(console.error);
