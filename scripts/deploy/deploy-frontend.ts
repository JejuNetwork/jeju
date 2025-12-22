#!/usr/bin/env bun
/**
 * @internal Used by CLI: `jeju deploy frontend <name>`
 * 
 * Deploy Frontend to IPFS + JNS
 * 
 * Builds a frontend app, uploads to IPFS, and updates the JNS contenthash.
 * 
 * Usage:
 *   jeju deploy frontend <app-name> [--network localnet|testnet|mainnet]
 * 
 * Examples:
 *   bun scripts/deploy-frontend.ts leaderboard
 *   bun scripts/deploy-frontend.ts bazaar --network testnet
 */

import { spawn } from 'bun';
import { existsSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { createPublicClient, createWalletClient, http, type Address, type Hex, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia, localhost } from 'viem/chains';

// Configuration
interface DeployConfig {
  appName: string;
  network: 'localnet' | 'testnet' | 'mainnet';
  buildDir: string;
  jnsName: string;
  ipfsApiUrl: string;
  rpcUrl: string;
  jnsRegistryAddress: Address;
  jnsResolverAddress: Address;
  privateKey: Hex;
}

interface DeployResult {
  cid: string;
  contenthash: Hex;
  jnsName: string;
  txHash?: string;
  gatewayUrl: string;
}

// JNS Resolver ABI
const JNS_RESOLVER_ABI = [
  {
    name: 'setContenthash',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'hash', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'contenthash',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes' }],
  },
] as const;

// Compute namehash for JNS name
function namehash(name: string): Hex {
  let node = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;
  
  if (name === '') return node;
  
  const labels = name.split('.');
  
  for (let i = labels.length - 1; i >= 0; i--) {
    const label = labels[i]!;
    const labelHash = keccak256(toBytes(label));
    node = keccak256(toBytes(node + labelHash.slice(2))) as Hex;
  }
  
  return node;
}

// Encode CID as contenthash (IPFS format)
// Contenthash format: 0xe3 (ipfs namespace) + multihash bytes
// Reference: https://github.com/ensdomains/content-hash/blob/master/src/content-hash.js
function encodeContenthash(cid: string): Hex {
  // Remove any protocol prefix
  const cleanCid = cid.replace(/^ipfs:\/\//, '').replace(/^\/ipfs\//, '');
  
  // CIDv0 format (Qm...): base58 encoded multihash
  // Multihash format: <hash-type><hash-length><hash>
  // For SHA2-256: 0x12 (hash type) + 0x20 (32 bytes) + 32-byte hash = 34 bytes total
  if (cleanCid.startsWith('Qm')) {
    // Decode base58 CIDv0 to get multihash bytes
    // CIDv0 is just the multihash, so we decode it directly
    const multihash = decodeBase58(cleanCid);
    
    if (multihash.length < 34) {
      throw new Error(`Invalid CIDv0 multihash length: expected 34 bytes, got ${multihash.length}`);
    }
    
    // Verify it's SHA2-256 (0x12 0x20)
    if (multihash[0] !== 0x12 || multihash[1] !== 0x20) {
      throw new Error(`Unsupported multihash type: expected SHA2-256 (0x12 0x20), got 0x${multihash[0]!.toString(16)} 0x${multihash[1]!.toString(16)}`);
    }
    
    // Encode as contenthash: 0xe3 (ipfs) + multihash bytes
    return ('0x' + 'e3' + Buffer.from(multihash).toString('hex')) as Hex;
  }
  
  // CIDv1 format: multibase encoded
  // Format: <multibase-prefix><cid-version><codec><multihash>
  // Common prefixes: b (base32), z (base58), m (base64), u (base64url)
  const multibasePrefix = cleanCid[0];
  
  if (multibasePrefix === 'b') {
    // Base32 CIDv1
    const cidBytes = Buffer.from(cleanCid.slice(1), 'base32');
    // Extract multihash (skip version byte 0x01 and codec byte 0x70 for dag-pb)
    // Multihash starts after version + codec
    const multihashStart = 2; // Skip version (1 byte) and codec (1 byte)
    const multihash = cidBytes.slice(multihashStart);
    
    // Encode as contenthash: 0xe3 (ipfs) + multihash bytes
    return ('0x' + 'e3' + Buffer.from(multihash).toString('hex')) as Hex;
  }
  
  if (multibasePrefix === 'z') {
    // Base58 CIDv1
    const cidBytes = decodeBase58(cleanCid.slice(1));
    const multihashStart = 2; // Skip version + codec
    const multihash = cidBytes.slice(multihashStart);
    
    return ('0x' + 'e3' + Buffer.from(multihash).toString('hex')) as Hex;
  }
  
  throw new Error(
    `Unsupported CID format: ${cleanCid.slice(0, 10)}...\n` +
    'Supported formats: CIDv0 (Qm...), CIDv1 base32 (b...), CIDv1 base58 (z...)\n' +
    'For other formats, install multiformats: bun add multiformats'
  );
}

// Base58 decoding (simplified implementation)
// Uses the Bitcoin base58 alphabet
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function decodeBase58(input: string): Buffer {
  let num = BigInt(0);
  let leadingZeros = 0;
  
  // Count leading zeros (represented as '1' in base58)
  for (let i = 0; i < input.length && input[i] === '1'; i++) {
    leadingZeros++;
  }
  
  // Convert base58 to BigInt
  for (let i = leadingZeros; i < input.length; i++) {
    const char = input[i];
    if (!char) break;
    
    const index = BASE58_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base58 character: ${char}`);
    }
    num = num * BigInt(58) + BigInt(index);
  }
  
  // Convert BigInt to bytes
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num % BigInt(256)));
    num = num / BigInt(256);
  }
  
  // Add leading zeros
  return Buffer.from([...Array(leadingZeros).fill(0), ...bytes]);
}

// Build the app
async function buildApp(appPath: string): Promise<void> {
  console.log('📦 Building app...');
  
  const proc = spawn(['bun', 'run', 'build'], {
    cwd: appPath,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Build failed with exit code ${exitCode}`);
  }
  
  console.log('✅ Build complete');
}

// Get all files in a directory recursively
function getAllFiles(dir: string, baseDir: string = dir): string[] {
  const files: string[] = [];
  
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    
    if (stat.isDirectory()) {
      files.push(...getAllFiles(fullPath, baseDir));
    } else {
      files.push(relative(baseDir, fullPath));
    }
  }
  
  return files;
}

// Upload directory to IPFS
async function uploadToIPFS(buildDir: string, ipfsApiUrl: string): Promise<string> {
  console.log('📤 Uploading to IPFS...');
  
  const files = getAllFiles(buildDir);
  console.log(`   Found ${files.length} files`);
  
  // Create FormData with all files
  const formData = new FormData();
  
  for (const filePath of files) {
    const fullPath = join(buildDir, filePath);
    const file = Bun.file(fullPath);
    const blob = await file.arrayBuffer();
    
    // IPFS expects the file path to be the form field name
    formData.append('file', new Blob([blob]), filePath);
  }
  
  // Upload to IPFS using the add endpoint with wrap-with-directory
  const response = await fetch(`${ipfsApiUrl}/api/v0/add?wrap-with-directory=true&pin=true`, {
    method: 'POST',
    body: formData,
  });
  
  if (!response.ok) {
    throw new Error(`IPFS upload failed: ${response.statusText}`);
  }
  
  // Parse the response - IPFS returns newline-delimited JSON
  const text = await response.text();
  const lines = text.trim().split('\n');
  
  // The last line is the directory hash
  const lastLine = JSON.parse(lines[lines.length - 1]) as { Hash: string; Name: string };
  const cid = lastLine.Hash;
  
  console.log(`✅ Uploaded to IPFS: ${cid}`);
  return cid;
}

// Update JNS contenthash
async function updateJNS(config: DeployConfig, cid: string): Promise<string | undefined> {
  console.log('🔗 Updating JNS contenthash...');
  
  const chain = config.network === 'mainnet' ? base
    : config.network === 'testnet' ? baseSepolia
    : { ...localhost, id: 9545 };
  
  const account = privateKeyToAccount(config.privateKey);
  
  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  });
  
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  });
  
  const node = namehash(config.jnsName);
  const contenthash = encodeContenthash(cid);
  
  console.log(`   JNS Name: ${config.jnsName}`);
  console.log(`   Node: ${node.slice(0, 10)}...`);
  console.log(`   Contenthash: ${contenthash.slice(0, 20)}...`);
  
  // Check if resolver is set
  if (config.jnsResolverAddress === '0x0000000000000000000000000000000000000000') {
    console.log('   ⚠️  JNS resolver not configured, skipping on-chain update');
    return undefined;
  }
  
  // Simulate the transaction
  const { request } = await publicClient.simulateContract({
    address: config.jnsResolverAddress,
    abi: JNS_RESOLVER_ABI,
    functionName: 'setContenthash',
    args: [node, contenthash],
    account,
  });
  
  // Execute the transaction
  const hash = await walletClient.writeContract(request);
  console.log(`   Transaction: ${hash}`);
  
  // Wait for confirmation
  await publicClient.waitForTransactionReceipt({ hash });
  console.log('✅ JNS updated');
  
  return hash;
}

// Main deployment function
async function deploy(config: DeployConfig): Promise<DeployResult> {
  const appPath = join(process.cwd(), 'apps', config.appName);
  
  if (!existsSync(appPath)) {
    throw new Error(`App not found: ${appPath}`);
  }
  
  // Check for build directory
  const possibleBuildDirs = ['dist', 'build', 'out', '.next/static', '.output/public'];
  let buildDir = '';
  
  for (const dir of possibleBuildDirs) {
    const fullPath = join(appPath, dir);
    if (existsSync(fullPath)) {
      buildDir = fullPath;
      break;
    }
  }
  
  // Build the app
  await buildApp(appPath);
  
  // Find build directory after build
  if (!buildDir) {
    for (const dir of possibleBuildDirs) {
      const fullPath = join(appPath, dir);
      if (existsSync(fullPath)) {
        buildDir = fullPath;
        break;
      }
    }
  }
  
  if (!buildDir) {
    throw new Error(`Build directory not found in ${appPath}`);
  }
  
  console.log(`📁 Build directory: ${buildDir}`);
  
  // Upload to IPFS
  const cid = await uploadToIPFS(buildDir, config.ipfsApiUrl);
  const contenthash = encodeContenthash(cid);
  
  // Update JNS
  const txHash = await updateJNS(config, cid);
  
  // Get gateway URL
  const gatewayUrl = config.network === 'localnet'
    ? `http://localhost:4180/ipfs/${cid}`
    : `https://dweb.link/ipfs/${cid}`;
  
  return {
    cid,
    contenthash,
    jnsName: config.jnsName,
    txHash,
    gatewayUrl,
  };
}

// Parse command line arguments
function parseArgs(): DeployConfig {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: bun scripts/deploy-frontend.ts <app-name> [--network localnet|testnet|mainnet]');
    process.exit(1);
  }
  
  const appName = args[0];
  let network: 'localnet' | 'testnet' | 'mainnet' = 'localnet';
  
  const networkIndex = args.indexOf('--network');
  if (networkIndex !== -1 && args[networkIndex + 1]) {
    network = args[networkIndex + 1] as typeof network;
  }
  
  // Load manifest to get JNS name
  const manifestPath = join(process.cwd(), 'apps', appName, 'jeju-manifest.json');
  let jnsName = `${appName}.jeju`;
  
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(Bun.file(manifestPath).text() as unknown as string) as { jns?: { name?: string }; decentralization?: { frontend?: { jnsName?: string } } };
    jnsName = manifest.decentralization?.frontend?.jnsName ?? manifest.jns?.name ?? jnsName;
  }
  
  // Network-specific configuration
  const networkConfigs = {
    localnet: {
      ipfsApiUrl: process.env.IPFS_API_URL ?? 'http://localhost:5001',
      rpcUrl: process.env.RPC_URL ?? 'http://localhost:9545',
      jnsRegistryAddress: (process.env.JNS_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address,
      jnsResolverAddress: (process.env.JNS_RESOLVER_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address,
    },
    testnet: {
      ipfsApiUrl: process.env.IPFS_API_URL ?? 'https://ipfs.infura.io:5001',
      rpcUrl: process.env.RPC_URL ?? 'https://sepolia.base.org',
      jnsRegistryAddress: (process.env.JNS_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address,
      jnsResolverAddress: (process.env.JNS_RESOLVER_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address,
    },
    mainnet: {
      ipfsApiUrl: process.env.IPFS_API_URL ?? 'https://ipfs.infura.io:5001',
      rpcUrl: process.env.RPC_URL ?? 'https://mainnet.base.org',
      jnsRegistryAddress: (process.env.JNS_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address,
      jnsResolverAddress: (process.env.JNS_RESOLVER_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address,
    },
  };
  
  const privateKey = process.env.PRIVATE_KEY as Hex | undefined;
  if (!privateKey) {
    console.error('❌ PRIVATE_KEY environment variable required');
    process.exit(1);
  }
  
  return {
    appName,
    network,
    buildDir: '',
    jnsName,
    privateKey,
    ...networkConfigs[network],
  };
}

// Main
async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║              🏝️  JEJU FRONTEND DEPLOYMENT                                     ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  const config = parseArgs();
  
  console.log(`📱 App:      ${config.appName}`);
  console.log(`🌐 Network:  ${config.network}`);
  console.log(`🔗 JNS:      ${config.jnsName}`);
  console.log('');
  
  const result = await deploy(config);
  
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  ✅ DEPLOYMENT COMPLETE                                                        ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  IPFS CID:     ${result.cid.padEnd(54)}║
║  JNS Name:     ${result.jnsName.padEnd(54)}║
║  Gateway:      ${result.gatewayUrl.slice(0, 54).padEnd(54)}║
${result.txHash ? `║  TX Hash:      ${result.txHash.slice(0, 54).padEnd(54)}║\n` : ''}║                                                                               ║
║  Access via:                                                                  ║
║    ${result.gatewayUrl.padEnd(68)}║
║    https://${config.jnsName}.network/                                          ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);
}

main().catch((err) => {
  console.error('❌ Deployment failed:', err.message);
  process.exit(1);
});
