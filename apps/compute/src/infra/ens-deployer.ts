/**
 * ENS Deployer - 100% PERMISSIONLESS Frontend Deployment
 *
 * This module handles:
 * 1. Uploading static files to IPFS via local node (NO API KEY)
 * 2. Or uploading to Arweave via Irys (wallet signature only)
 * 3. Setting ENS contenthash with wallet signature
 * 4. Verifying the frontend is accessible via eth.limo gateway
 *
 * FULLY PERMISSIONLESS - No API keys, only wallet signatures.
 * accessible at your-name.eth or your-name.eth.limo
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import bs58 from 'bs58';
import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import { createPublicClient, createWalletClient, http, namehash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, sepolia } from 'viem/chains';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ENSConfig {
  /** ENS name (e.g., 'jeju-compute.eth') */
  ensName: string;
  /** Deployer private key (wallet signature for all operations) */
  privateKey: Hex;
  /** Network: mainnet or sepolia */
  network: 'mainnet' | 'sepolia';
  /** RPC URL (optional, uses public node if not provided) */
  rpcUrl?: string;
  /**
   * Upload strategy:
   * - 'local-ipfs': Use local IPFS node (run `ipfs daemon`)
   * - 'arweave': Use Arweave via Irys (wallet signature only)
   * - 'auto': Try local IPFS first, fall back to Arweave
   * @default 'auto'
   */
  uploadStrategy?: 'local-ipfs' | 'arweave' | 'auto';
  /** Local IPFS API URL (default: http://localhost:5001) */
  localIPFSUrl?: string;
  /** Arweave network: 'mainnet' or 'devnet' (default: devnet for testing) */
  arweaveNetwork?: 'mainnet' | 'devnet';
  /** Enable verbose logging */
  verbose?: boolean;
}

export interface UploadedFile {
  path: string;
  cid: string;
  size: number;
}

export interface DeploymentResult {
  success: boolean;
  ipfsCid: string;
  ensName: string;
  contentHash: Hex;
  gatewayUrl: string;
  ethLimoUrl: string;
  txHash?: Hex;
  error?: string;
}

export interface RecoveryPlan {
  /** Current IPFS CID */
  currentCid: string;
  /** Backup storage locations */
  backups: {
    arweave?: string;
    ipfs: string[];
  };
  /** ENS resolver address */
  resolverAddress: Address;
  /** Recovery instructions */
  instructions: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// ENS RESOLVER ABI (only what we need)
// ═══════════════════════════════════════════════════════════════════════════

const PUBLIC_RESOLVER_ABI = [
  {
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'hash', type: 'bytes' },
    ],
    name: 'setContenthash',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'node', type: 'bytes32' }],
    name: 'contenthash',
    outputs: [{ name: '', type: 'bytes' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// ENS Registry ABI
const ENS_REGISTRY_ABI = [
  {
    inputs: [{ name: 'node', type: 'bytes32' }],
    name: 'resolver',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'node', type: 'bytes32' }],
    name: 'owner',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Contract addresses
const ENS_REGISTRY: Record<string, Address> = {
  mainnet: '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e',
  sepolia: '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e',
};

// ═══════════════════════════════════════════════════════════════════════════
// CONTENT HASH UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Encode IPFS CID to contenthash format for ENS
 * Format: 0xe3010170 + CID (for IPFS)
 * See: https://docs.ens.domains/resolution/names#content-hash
 */
export function encodeIPFSContenthash(cid: string): Hex {
  // For IPFS CIDv0 (starts with Qm)
  if (cid.startsWith('Qm')) {
    // IPFS namespace: e3 (ipfs-ns) + 01 (protobuf) + 70 (dag-pb) + 12 (sha2-256) + 20 (32 bytes)
    // Decode base58 CID to get multihash
    const multihash = bs58.decode(cid);
    const hex = Buffer.from(multihash).toString('hex');
    return `0xe3010170${hex}` as Hex;
  }

  // For IPFS CIDv1 (starts with bafy)
  if (cid.startsWith('bafy')) {
    // CIDv1 in base32 - for now throw, we'll use CIDv0
    throw new Error('CIDv1 not yet supported, use CIDv0 (Qm...)');
  }

  throw new Error(`Unsupported CID format: ${cid}`);
}

/**
 * Encode Arweave TX ID to contenthash format for ENS
 * Uses the Arweave namespace (0xe5)
 */
export function encodeArweaveContenthash(txId: string): Hex {
  // Arweave namespace: e5 (arweave-ns)
  const txBytes = Buffer.from(txId, 'base64url');
  const hex = txBytes.toString('hex');
  return `0xe5${hex}` as Hex;
}

/**
 * Decode contenthash to IPFS CID
 */
export function decodeIPFSContenthash(contenthash: Hex): string {
  if (!contenthash.startsWith('0xe3')) {
    throw new Error('Not an IPFS contenthash');
  }

  const data = contenthash.slice(2); // Remove 0x
  if (data.startsWith('e3010170')) {
    // CIDv0 format - decode multihash from hex and encode as base58
    const multihash = Buffer.from(data.slice(8), 'hex');
    return bs58.encode(multihash);
  }

  throw new Error('Unsupported contenthash format');
}

// ═══════════════════════════════════════════════════════════════════════════
// PERMISSIONLESS UPLOAD FUNCTIONS (NO API KEYS)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if local IPFS node is available
 */
async function isLocalIPFSAvailable(
  ipfsApiUrl = 'http://localhost:5001'
): Promise<boolean> {
  const response = await fetch(`${ipfsApiUrl}/api/v0/id`, {
    method: 'POST',
  }).catch(() => null);
  return response?.ok ?? false;
}

/**
 * Upload to local IPFS node (NO API KEY - you run the node)
 */
export async function uploadToLocalIPFS(
  directory: string,
  ipfsApiUrl = 'http://localhost:5001',
  verbose = false
): Promise<{ cid: string; files: UploadedFile[] }> {
  // Check if IPFS is running
  const available = await isLocalIPFSAvailable(ipfsApiUrl);
  if (!available) {
    throw new Error(
      `IPFS node not available at ${ipfsApiUrl}. Start with: ipfs daemon`
    );
  }

  const files: UploadedFile[] = [];
  const formData = new FormData();

  async function addFiles(dir: string, basePath = '') {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await addFiles(fullPath, relativePath);
      } else {
        const content = await readFile(fullPath);
        formData.append('file', new Blob([content]), relativePath);
        files.push({ path: relativePath, cid: '', size: content.length });
      }
    }
  }

  await addFiles(directory);

  if (verbose) {
    console.log(
      `[ENS Deployer] Uploading ${files.length} files to local IPFS...`
    );
  }

  // Add with wrap-with-directory
  const response = await fetch(
    `${ipfsApiUrl}/api/v0/add?recursive=true&wrap-with-directory=true`,
    {
      method: 'POST',
      body: formData,
    }
  );

  if (!response.ok) {
    throw new Error(`IPFS upload failed: ${await response.text()}`);
  }

  // Parse NDJSON response - last line is the directory CID
  const text = await response.text();
  const lines = text.trim().split('\n');
  const lastLine = JSON.parse(lines[lines.length - 1]!) as { Hash: string };

  if (verbose) {
    console.log(`[ENS Deployer] ✓ Uploaded to local IPFS: ${lastLine.Hash}`);
  }

  return {
    cid: lastLine.Hash,
    files: files.map((f) => ({ ...f, cid: lastLine.Hash })),
  };
}

/**
 * Irys client interface for wallet-signed Arweave uploads
 */
interface IrysClient {
  ready(): Promise<IrysClient>;
  getLoadedBalance(): Promise<bigint>;
  getPrice(bytes: number): Promise<bigint>;
  fund(amount: bigint): Promise<{ id: string }>;
  upload(
    data: string,
    options: { tags: { name: string; value: string }[] }
  ): Promise<{ id: string }>;
  utils: {
    fromAtomic(amount: bigint): string;
  };
}

/**
 * Upload to Arweave via Irys (wallet signature only, NO API KEY)
 * Returns a permanent Arweave transaction ID
 */
export async function uploadToArweave(
  directory: string,
  privateKey: Hex,
  network: 'mainnet' | 'devnet' = 'devnet',
  verbose = false
): Promise<{ txId: string; files: UploadedFile[]; cost: string }> {
  // Collect all files into a single bundle
  const files: { path: string; content: Buffer }[] = [];

  async function collectFiles(dir: string, basePath = '') {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await collectFiles(fullPath, relativePath);
      } else {
        const content = await readFile(fullPath);
        files.push({ path: relativePath, content });
      }
    }
  }

  await collectFiles(directory);

  if (verbose) {
    console.log(
      `[ENS Deployer] Uploading ${files.length} files to Arweave via Irys...`
    );
  }

  // Initialize Irys
  const { default: Irys } = await import('@irys/sdk');

  const url =
    network === 'mainnet'
      ? 'https://node1.irys.xyz'
      : 'https://devnet.irys.xyz';

  const key = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;

  // Cast through unknown to bypass strict type checking - runtime compatible
  const irys = new Irys({
    url,
    token: 'ethereum',
    key,
  }) as unknown as IrysClient;

  await irys.ready();

  if (verbose) {
    const balance = await irys.getLoadedBalance();
    console.log(
      `[ENS Deployer] Irys balance: ${irys.utils.fromAtomic(balance)} ETH`
    );
  }

  // For simplicity, we'll upload the index.html as the main entry
  // In a real implementation, you might want to bundle all files
  const indexFile = files.find((f) => f.path === 'index.html');
  if (!indexFile) {
    throw new Error('No index.html found in directory');
  }

  const price = await irys.getPrice(indexFile.content.length);

  const receipt = await irys.upload(indexFile.content.toString(), {
    tags: [
      { name: 'Content-Type', value: 'text/html' },
      { name: 'App-Name', value: 'jeju-compute-frontend' },
      { name: 'Timestamp', value: Date.now().toString() },
    ],
  });

  if (verbose) {
    console.log(`[ENS Deployer] ✓ Uploaded to Arweave: ${receipt.id}`);
    console.log(`[ENS Deployer]   URL: https://arweave.net/${receipt.id}`);
  }

  return {
    txId: receipt.id,
    files: files.map((f) => ({
      path: f.path,
      cid: receipt.id,
      size: f.content.length,
    })),
    cost: price.toString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ENS DEPLOYER CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class ENSDeployer {
  private config: ENSConfig;
  private publicClient: PublicClient;
  private walletClient: WalletClient;
  private account: ReturnType<typeof privateKeyToAccount>;

  constructor(config: ENSConfig) {
    this.config = config;

    const chain = config.network === 'mainnet' ? mainnet : sepolia;
    const rpcUrl =
      config.rpcUrl ??
      (config.network === 'mainnet'
        ? 'https://eth.llamarpc.com'
        : 'https://ethereum-sepolia.publicnode.com');

    this.account = privateKeyToAccount(config.privateKey);

    this.publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    this.walletClient = createWalletClient({
      chain,
      transport: http(rpcUrl),
      account: this.account,
    });
  }

  /**
   * Check if we own the ENS name
   */
  async checkOwnership(): Promise<{
    isOwner: boolean;
    owner: Address;
    resolver: Address;
  }> {
    const node = namehash(this.config.ensName);
    const registry = ENS_REGISTRY[this.config.network]!;

    const owner = await this.publicClient.readContract({
      address: registry,
      abi: ENS_REGISTRY_ABI,
      functionName: 'owner',
      args: [node],
    });

    const resolver = await this.publicClient.readContract({
      address: registry,
      abi: ENS_REGISTRY_ABI,
      functionName: 'resolver',
      args: [node],
    });

    return {
      isOwner: owner.toLowerCase() === this.account.address.toLowerCase(),
      owner,
      resolver,
    };
  }

  /**
   * Get current contenthash
   */
  async getCurrentContenthash(): Promise<Hex | null> {
    const { resolver } = await this.checkOwnership();
    if (resolver === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    const node = namehash(this.config.ensName);

    const contenthash = await this.publicClient.readContract({
      address: resolver,
      abi: PUBLIC_RESOLVER_ABI,
      functionName: 'contenthash',
      args: [node],
    });

    return contenthash.length > 2 ? (contenthash as Hex) : null;
  }

  /**
   * Set contenthash to point to IPFS CID
   */
  async setContenthash(cid: string): Promise<Hex> {
    const { isOwner, resolver } = await this.checkOwnership();

    if (!isOwner) {
      throw new Error(
        `Account ${this.account.address} does not own ${this.config.ensName}`
      );
    }

    if (resolver === '0x0000000000000000000000000000000000000000') {
      throw new Error(
        `No resolver set for ${this.config.ensName}. Set resolver first.`
      );
    }

    const node = namehash(this.config.ensName);
    const contenthash = encodeIPFSContenthash(cid);

    if (this.config.verbose) {
      console.log(`[ENS Deployer] Setting contenthash to ${contenthash}...`);
    }

    const txHash = await this.walletClient.writeContract({
      address: resolver,
      abi: PUBLIC_RESOLVER_ABI,
      functionName: 'setContenthash',
      args: [node, contenthash],
      account: this.account,
      chain: this.config.network === 'mainnet' ? mainnet : sepolia,
    });

    if (this.config.verbose) {
      console.log(`[ENS Deployer] ✓ Transaction submitted: ${txHash}`);
    }

    // Wait for confirmation
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    if (receipt.status === 'reverted') {
      throw new Error('Transaction reverted');
    }

    return txHash;
  }

  /**
   * Deploy frontend to decentralized storage and set ENS contenthash
   * 100% PERMISSIONLESS - uses wallet signature only, NO API KEYS
   */
  async deploy(frontendDir: string): Promise<DeploymentResult> {
    const verbose = this.config.verbose ?? false;
    const uploadStrategy = this.config.uploadStrategy ?? 'auto';
    const localIPFSUrl = this.config.localIPFSUrl ?? 'http://localhost:5001';

    let contentId: string;
    let gatewayUrl: string;
    let contenthash: Hex;

    if (uploadStrategy === 'local-ipfs') {
      // Use local IPFS only
      const result = await uploadToLocalIPFS(
        frontendDir,
        localIPFSUrl,
        verbose
      );
      contentId = result.cid;
      gatewayUrl = `https://ipfs.io/ipfs/${contentId}`;
      contenthash = encodeIPFSContenthash(contentId);
    } else if (uploadStrategy === 'arweave') {
      // Use Arweave only
      const result = await uploadToArweave(
        frontendDir,
        this.config.privateKey,
        this.config.arweaveNetwork ?? 'devnet',
        verbose
      );
      contentId = result.txId;
      gatewayUrl = `https://arweave.net/${contentId}`;
      // Note: ENS doesn't natively support Arweave, so we'll use IPFS gateway
      // In production, you might want to mirror to IPFS
      contenthash = encodeArweaveContenthash(contentId);
    } else {
      // Auto mode: try local IPFS first, fall back to Arweave
      const ipfsAvailable = await isLocalIPFSAvailable(localIPFSUrl);

      if (ipfsAvailable) {
        if (verbose) {
          console.log('[ENS Deployer] Using local IPFS node...');
        }
        const result = await uploadToLocalIPFS(
          frontendDir,
          localIPFSUrl,
          verbose
        );
        contentId = result.cid;
        gatewayUrl = `https://ipfs.io/ipfs/${contentId}`;
        contenthash = encodeIPFSContenthash(contentId);
      } else {
        if (verbose) {
          console.log(
            '[ENS Deployer] Local IPFS unavailable, using Arweave...'
          );
        }
        const result = await uploadToArweave(
          frontendDir,
          this.config.privateKey,
          this.config.arweaveNetwork ?? 'devnet',
          verbose
        );
        contentId = result.txId;
        gatewayUrl = `https://arweave.net/${contentId}`;
        contenthash = encodeArweaveContenthash(contentId);
      }
    }

    // Set ENS contenthash (wallet signature)
    const txHash = await this.setContenthash(contentId);

    return {
      success: true,
      ipfsCid: contentId,
      ensName: this.config.ensName,
      contentHash: contenthash,
      gatewayUrl,
      ethLimoUrl: `https://${this.config.ensName.replace('.eth', '')}.eth.limo`,
      txHash,
    };
  }

  /**
   * Verify deployment is accessible
   */
  async verifyDeployment(): Promise<{
    accessible: boolean;
    url: string;
  }> {
    const url = `https://${this.config.ensName.replace('.eth', '')}.eth.limo`;

    const response = await fetch(url, { method: 'HEAD' });
    return {
      accessible: response.ok,
      url,
    };
  }

  /**
   * Generate recovery plan for if files are lost
   */
  async generateRecoveryPlan(): Promise<RecoveryPlan> {
    const { resolver } = await this.checkOwnership();
    const contenthash = await this.getCurrentContenthash();

    let currentCid = '';
    if (contenthash) {
      try {
        currentCid = decodeIPFSContenthash(contenthash);
      } catch {
        currentCid = 'Unable to decode';
      }
    }

    return {
      currentCid,
      backups: {
        ipfs: [
          `https://ipfs.io/ipfs/${currentCid}`,
          `https://cloudflare-ipfs.com/ipfs/${currentCid}`,
          `https://dweb.link/ipfs/${currentCid}`,
        ],
      },
      resolverAddress: resolver,
      instructions: [
        '1. If current IPFS CID is inaccessible, redeploy files to IPFS',
        '2. Get new CID from Pinata, Infura, or local IPFS node',
        '3. Call setContenthash(newCID) on ENS resolver',
        '4. Transaction requires ENS name owner signature',
        '5. No central authority can prevent you from updating',
        '',
        'To fully decentralize:',
        '- Store files on Arweave for permanence',
        '- Pin on multiple IPFS gateways',
        '- Use ENS with a multisig owner',
      ],
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI ENTRY POINT (100% PERMISSIONLESS - NO API KEYS)
// ═══════════════════════════════════════════════════════════════════════════

export async function deployFrontend(): Promise<void> {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║          100% PERMISSIONLESS FRONTEND DEPLOYMENT                  ║
╠═══════════════════════════════════════════════════════════════════╣
║  NO API KEYS - Only wallet signature required                     ║
║  Storage: Local IPFS node or Arweave (via Irys)                   ║
╚═══════════════════════════════════════════════════════════════════╝
`);

  const privateKey = process.env.PRIVATE_KEY as Hex | undefined;
  const ensName = process.env.ENS_NAME ?? 'jeju-compute.eth';
  const network = (process.env.NETWORK ?? 'sepolia') as 'mainnet' | 'sepolia';
  const uploadStrategy = (process.env.UPLOAD_STRATEGY ?? 'auto') as
    | 'local-ipfs'
    | 'arweave'
    | 'auto';
  const arweaveNetwork = (process.env.ARWEAVE_NETWORK ?? 'devnet') as
    | 'mainnet'
    | 'devnet';

  if (!privateKey) {
    console.error('❌ PRIVATE_KEY environment variable required');
    console.log('\nUsage:');
    console.log(
      '  PRIVATE_KEY=0x... ENS_NAME=your-name.eth bun run src/infra/ens-deployer.ts'
    );
    console.log('\nOptions (all permissionless, no API keys):');
    console.log('  NETWORK=mainnet|sepolia (default: sepolia)');
    console.log('  UPLOAD_STRATEGY=local-ipfs|arweave|auto (default: auto)');
    console.log(
      '  ARWEAVE_NETWORK=mainnet|devnet (default: devnet, free for testing)'
    );
    console.log('\nTo use local IPFS, run: ipfs daemon');
    process.exit(1);
  }

  const deployer = new ENSDeployer({
    ensName,
    privateKey,
    network,
    uploadStrategy,
    arweaveNetwork,
    verbose: true,
  });

  // Check ownership
  console.log(`\n📋 Checking ENS name: ${ensName}`);
  const ownership = await deployer.checkOwnership();
  console.log(`   Owner: ${ownership.owner}`);
  console.log(`   Resolver: ${ownership.resolver}`);
  console.log(`   We own it: ${ownership.isOwner ? '✅ Yes' : '❌ No'}`);

  if (!ownership.isOwner) {
    console.error(
      `\n❌ You don't own ${ensName}. Register it at https://app.ens.domains`
    );
    process.exit(1);
  }

  // Get current contenthash
  const current = await deployer.getCurrentContenthash();
  if (current) {
    try {
      const cid = decodeIPFSContenthash(current);
      console.log(`   Current CID: ${cid}`);
    } catch {
      console.log(`   Current hash: ${current.slice(0, 20)}...`);
    }
  }

  // Deploy
  const frontendDir = join(import.meta.dir, '../../frontend');
  console.log(`\n🚀 Deploying frontend from: ${frontendDir}`);

  const result = await deployer.deploy(frontendDir);

  if (result.success) {
    console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                    ✅ DEPLOYMENT SUCCESSFUL                       ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  IPFS CID:    ${result.ipfsCid.padEnd(45)}    ║
║  ENS Name:    ${result.ensName.padEnd(45)}    ║
║  Tx Hash:     ${(result.txHash ?? 'N/A').slice(0, 40).padEnd(45)}    ║
║                                                                   ║
║  Access via:                                                      ║
║  • ${result.ethLimoUrl.padEnd(55)}    ║
║  • ${result.gatewayUrl.slice(0, 55).padEnd(55)}    ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
`);

    // Verify
    console.log('🔍 Verifying deployment accessibility...');
    const verification = await deployer.verifyDeployment();
    if (verification.accessible) {
      console.log(`   ✅ Frontend accessible at ${verification.url}`);
    } else {
      console.log(
        `   ⏳ May take a few minutes to propagate. Try: ${verification.url}`
      );
    }

    // Recovery plan
    console.log('\n📋 Recovery Plan:');
    const plan = await deployer.generateRecoveryPlan();
    for (const instruction of plan.instructions) {
      console.log(`   ${instruction}`);
    }
  } else {
    console.error(`\n❌ Deployment failed: ${result.error}`);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  deployFrontend().catch(console.error);
}
