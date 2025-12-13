/**
 * JNS Gateway Server
 *
 * Resolves JNS names to IPFS content and serves static frontends.
 * This enables fully decentralized frontend hosting via JNS.
 *
 * Features:
 * - JNS name resolution to contenthash
 * - IPFS content serving with proper MIME types
 * - SPA fallback for client-side routing
 * - ENS fallback for Ethereum interop
 *
 * @example
 * example.jeju.network → resolves example.jeju → contenthash → IPFS gateway
 */

import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { normalize } from 'viem/ens';

const JNS_RESOLVER_ABI = [
  {
    name: 'contenthash',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes' }],
  },
  {
    name: 'addr',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'text',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'getAppInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [
      { name: 'appContract', type: 'address' },
      { name: 'appId', type: 'bytes32' },
      { name: 'agentId', type: 'uint256' },
      { name: 'endpoint', type: 'string' },
      { name: 'a2aEndpoint', type: 'string' },
      { name: 'contenthash_', type: 'bytes' },
    ],
  },
] as const;

const JNS_REGISTRY_ABI = [
  {
    name: 'resolver',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

interface JNSGatewayConfig {
  port: number;
  rpcUrl: string;
  jnsRegistryAddress: Address;
  ipfsGatewayUrl: string;
  defaultResolver?: Address;
  fallbackIpfsGateways?: string[];
}

interface ResolvedContent {
  cid: string;
  codec: 'ipfs' | 'ipns' | 'swarm' | 'arweave';
}

/**
 * Decode contenthash bytes to CID
 * Supports IPFS (0xe3), IPNS (0xe5), Swarm (0xe4), Arweave (0x90)
 */
function decodeContenthash(contenthash: Hex): ResolvedContent | null {
  if (!contenthash || contenthash === '0x' || contenthash.length < 4) {
    return null;
  }

  const bytes = Buffer.from(contenthash.slice(2), 'hex');
  if (bytes.length < 2) return null;

  const codec = bytes[0];
  const hashFn = bytes[1];

  // IPFS: 0xe3 + 0x01 (cidv1) or 0x00 (cidv0)
  if (codec === 0xe3) {
    // CIDv1 with dag-pb (0x70) and sha2-256 (0x12)
    if (bytes[1] === 0x01 && bytes[2] === 0x70 && bytes[3] === 0x12) {
      const cid = Buffer.from(bytes.slice(1)).toString('base64url');
      return { cid: `b${cid}`, codec: 'ipfs' }; // Base32 CIDv1
    }
    // CIDv0 - raw multihash
    if (hashFn === 0x12) {
      // SHA2-256 - return as hex since base58 encoding needs external library
      const multihash = bytes.slice(1);
      const cid = `Qm${Buffer.from(multihash.slice(2)).toString('hex')}`;
      return { cid, codec: 'ipfs' };
    }
    // Fallback: assume raw CID bytes after codec
    const cid = bytes.slice(1).toString('hex');
    return { cid, codec: 'ipfs' };
  }

  // IPNS: 0xe5
  if (codec === 0xe5) {
    const cid = Buffer.from(bytes.slice(1)).toString('base64url');
    return { cid: `k${cid}`, codec: 'ipns' };
  }

  // Swarm: 0xe4
  if (codec === 0xe4) {
    const hash = bytes.slice(1).toString('hex');
    return { cid: hash, codec: 'swarm' };
  }

  // Arweave: 0x90 (custom)
  if (codec === 0x90) {
    const txId = Buffer.from(bytes.slice(1)).toString('base64url');
    return { cid: txId, codec: 'arweave' };
  }

  return null;
}

/**
 * Compute namehash for JNS name
 */
function namehash(name: string): Hex {
  let node =
    '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

  if (name === '') return node;

  const labels = normalize(name).split('.');

  for (let i = labels.length - 1; i >= 0; i--) {
    const label = labels[i];
    const labelHash = keccak256(Buffer.from(label!, 'utf8'));
    node = keccak256(Buffer.concat([Buffer.from(node.slice(2), 'hex'), Buffer.from(labelHash.slice(2), 'hex')])) as Hex;
  }

  return node;
}

function keccak256(data: Buffer): Hex {
  const { keccak_256 } = require('@noble/hashes/sha3');
  return `0x${Buffer.from(keccak_256(data)).toString('hex')}` as Hex;
}

/**
 * Get MIME type from path
 */
function getMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    mjs: 'application/javascript',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    txt: 'text/plain',
    md: 'text/markdown',
    xml: 'application/xml',
    wasm: 'application/wasm',
  };
  return mimeTypes[ext ?? ''] ?? 'application/octet-stream';
}

export class JNSGateway {
  private app: Hono;
  private config: JNSGatewayConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;
  private cache: Map<string, { content: ResolvedContent; expiry: number }> =
    new Map();
  private readonly CACHE_TTL = 300_000; // 5 minutes

  constructor(config: JNSGatewayConfig) {
    this.config = config;
    this.app = new Hono();

    const chain =
      config.rpcUrl.includes('sepolia') ||
      config.rpcUrl.includes('testnet')
        ? baseSepolia
        : base;

    this.client = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    });

    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.use('*', cors());

    // Health check
    this.app.get('/health', (c) =>
      c.json({ status: 'healthy', service: 'jns-gateway' })
    );

    // Direct CID access
    this.app.get('/ipfs/:cid{.+}', async (c) => {
      const cid = c.req.param('cid');
      const path = c.req.path.replace(`/ipfs/${cid}`, '') || '/';
      return this.serveIpfsContent(c, cid, path);
    });

    // JNS resolution API
    this.app.get('/api/resolve/:name', async (c) => {
      const name = c.req.param('name');
      const content = await this.resolveJNS(name);

      if (!content) {
        return c.json({ error: 'Name not found or no contenthash' }, 404);
      }

      return c.json({
        name,
        cid: content.cid,
        codec: content.codec,
        gatewayUrl: this.getGatewayUrl(content),
      });
    });

    // JNS name serving - catch all for name.jeju paths
    this.app.get('/:name{[a-z0-9-]+\\.jeju}/*', async (c) => {
      const name = c.req.param('name');
      const path = c.req.path.replace(`/${name}`, '') || '/index.html';
      return this.serveJNSContent(c, name, path);
    });

    // Host-based JNS resolution
    this.app.get('*', async (c) => {
      const host = c.req.header('host') ?? '';

      // Check if this is a JNS subdomain (e.g., app.jeju.network)
      const jnsMatch = host.match(/^([a-z0-9-]+)\.jeju\.(network|io|local)/);
      if (jnsMatch && jnsMatch[1]) {
        const name = `${jnsMatch[1]}.jeju`;
        const path = c.req.path === '/' ? '/index.html' : c.req.path;
        return this.serveJNSContent(c, name, path);
      }

      return c.text('JNS Gateway - Use *.jeju.network for name resolution', 200);
    });
  }

  /**
   * Resolve JNS name to content
   */
  async resolveJNS(name: string): Promise<ResolvedContent | null> {
    // Check cache
    const cached = this.cache.get(name);
    if (cached && cached.expiry > Date.now()) {
      return cached.content;
    }

    const node = namehash(name);

    // Get resolver address
    let resolverAddr: Address;
    if (this.config.defaultResolver) {
      resolverAddr = this.config.defaultResolver;
    } else {
      resolverAddr = (await this.client.readContract({
        address: this.config.jnsRegistryAddress,
        abi: JNS_REGISTRY_ABI,
        functionName: 'resolver',
        args: [node],
      })) as Address;
    }

    if (resolverAddr === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    // Get contenthash
    const contenthash = (await this.client.readContract({
      address: resolverAddr,
      abi: JNS_RESOLVER_ABI,
      functionName: 'contenthash',
      args: [node],
    })) as Hex;

    const content = decodeContenthash(contenthash);

    if (content) {
      this.cache.set(name, { content, expiry: Date.now() + this.CACHE_TTL });
    }

    return content;
  }

  /**
   * Serve content from JNS-resolved CID
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async serveJNSContent(c: Context<any>, name: string, path: string): Promise<Response> {
    const content = await this.resolveJNS(name);

    if (!content) {
      return c.text(`JNS name "${name}" not found or has no contenthash`, 404);
    }

    return this.serveIpfsContent(c, content.cid, path);
  }

  /**
   * Serve content from IPFS
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async serveIpfsContent(c: Context<any>, cid: string, path: string): Promise<Response> {
    const gateways = [
      this.config.ipfsGatewayUrl,
      ...(this.config.fallbackIpfsGateways ?? []),
    ];

    let lastError: Error | null = null;

    for (const gateway of gateways) {
      const url = `${gateway}/ipfs/${cid}${path}`;

      const response = await fetch(url, {
        headers: { Accept: '*/*' },
        signal: AbortSignal.timeout(10000),
      }).catch((e: unknown) => {
        lastError = e instanceof Error ? e : new Error(String(e));
        return null;
      });

      if (response?.ok) {
        const contentType =
          response.headers.get('content-type') ?? getMimeType(path);

        return new Response(response.body, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-Content-CID': cid,
            'X-Gateway': gateway,
          },
        });
      }

      // Try index.html for directory paths (SPA support)
      if (response?.status === 404 && !path.includes('.')) {
        const indexUrl = `${gateway}/ipfs/${cid}/index.html`;
        const indexResponse = await fetch(indexUrl, {
          signal: AbortSignal.timeout(10000),
        }).catch(() => null);

        if (indexResponse?.ok) {
          return new Response(indexResponse.body, {
            status: 200,
            headers: {
              'Content-Type': 'text/html',
              'Cache-Control': 'public, max-age=3600',
              'X-Content-CID': cid,
              'X-Gateway': gateway,
              'X-SPA-Fallback': 'true',
            },
          });
        }
      }
    }

    return c.text(
      `Failed to fetch content: ${(lastError as Error | null)?.message ?? 'Unknown error'}`,
      502
    );
  }

  /**
   * Get gateway URL for content
   */
  private getGatewayUrl(content: ResolvedContent): string {
    switch (content.codec) {
      case 'ipfs':
        return `${this.config.ipfsGatewayUrl}/ipfs/${content.cid}`;
      case 'ipns':
        return `${this.config.ipfsGatewayUrl}/ipns/${content.cid}`;
      case 'arweave':
        return `https://arweave.net/${content.cid}`;
      case 'swarm':
        return `https://gateway.ethswarm.org/bzz/${content.cid}`;
      default:
        return `${this.config.ipfsGatewayUrl}/ipfs/${content.cid}`;
    }
  }

  getApp(): Hono {
    return this.app;
  }

  async start(): Promise<void> {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                      JNS Gateway                           ║
║          Decentralized Frontend Serving via JNS            ║
╠═══════════════════════════════════════════════════════════╣
║  RPC:           ${this.config.rpcUrl.slice(0, 38).padEnd(38)}║
║  Registry:      ${this.config.jnsRegistryAddress.slice(0, 38).padEnd(38)}║
║  IPFS Gateway:  ${this.config.ipfsGatewayUrl.slice(0, 38).padEnd(38)}║
║  Port:          ${this.config.port.toString().padEnd(38)}║
╚═══════════════════════════════════════════════════════════╝
`);

    Bun.serve({
      port: this.config.port,
      fetch: this.app.fetch,
    });

    console.log(`JNS Gateway listening on port ${this.config.port}`);
  }
}

/**
 * Start JNS Gateway from environment
 */
export async function startJNSGateway(): Promise<JNSGateway> {
  const config: JNSGatewayConfig = {
    port: parseInt(process.env.JNS_GATEWAY_PORT ?? '4005', 10),
    rpcUrl: process.env.JEJU_RPC_URL ?? process.env.RPC_URL ?? 'http://localhost:9545',
    jnsRegistryAddress: (process.env.JNS_REGISTRY_ADDRESS ??
      '0x0000000000000000000000000000000000000000') as Address,
    ipfsGatewayUrl:
      process.env.IPFS_GATEWAY_URL ?? 'https://dweb.link',
    defaultResolver: process.env.JNS_RESOLVER_ADDRESS as Address | undefined,
    fallbackIpfsGateways: [
      'https://ipfs.io',
      'https://cloudflare-ipfs.com',
      'https://gateway.pinata.cloud',
    ],
  };

  const gateway = new JNSGateway(config);
  await gateway.start();
  return gateway;
}

// CLI entry point
if (import.meta.main) {
  startJNSGateway();
}
