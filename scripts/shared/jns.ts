/**
 * JNS (Jeju Name Service) Shared Client Utilities
 * 
 * Provides:
 * - Name resolution (name → address)
 * - Reverse resolution (address → name)
 * - App record lookup
 * - Name availability checking
 * - Registration helpers
 */

import { ethers } from 'ethers';
import type { Address } from 'viem';

// ============ Types ============

export interface JNSConfig {
  registry: Address;
  resolver: Address;
  registrar: Address;
  reverseRegistrar: Address;
  rpcUrl: string;
}

export interface JNSResolvedRecord {
  name: string;
  node: string;
  address: Address | null;
  contenthash: string | null;
  texts: Record<string, string>;
  app: {
    contract: Address | null;
    appId: string | null;
    agentId: bigint;
    endpoint: string | null;
    a2aEndpoint: string | null;
  };
}

export interface JNSNameInfo {
  name: string;
  owner: Address;
  resolver: Address;
  expiresAt: number;
  isExpired: boolean;
  inGracePeriod: boolean;
}

// ============ Constants ============

const GRACE_PERIOD = 90 * 24 * 60 * 60; // 90 days in seconds

// ============ ABIs ============

const JNS_REGISTRY_ABI = [
  'function owner(bytes32 node) view returns (address)',
  'function resolver(bytes32 node) view returns (address)',
  'function recordExists(bytes32 node) view returns (bool)',
];

const JNS_RESOLVER_ABI = [
  'function addr(bytes32 node) view returns (address)',
  'function text(bytes32 node, string key) view returns (string)',
  'function contenthash(bytes32 node) view returns (bytes)',
  'function getAppInfo(bytes32 node) view returns (address appContract, bytes32 appId, uint256 agentId, string endpoint, string a2aEndpoint, bytes contenthash_)',
  'function name(bytes32 node) view returns (string)',
];

const JNS_REGISTRAR_ABI = [
  'function available(string name) view returns (bool)',
  'function nameExpires(string name) view returns (uint256)',
  'function ownerOf(string name) view returns (address)',
  'function rentPrice(string name, uint256 duration) view returns (uint256)',
];

const JNS_REVERSE_REGISTRAR_ABI = [
  'function nameOf(address addr) view returns (string)',
  'function node(address addr) view returns (bytes32)',
];

// ============ Core Functions ============

/**
 * Compute the namehash for a JNS name
 */
export function computeNamehash(name: string): string {
  return ethers.namehash(name);
}

/**
 * Compute the labelhash for a label
 */
export function computeLabelhash(label: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

/**
 * Validate a JNS name
 */
export function validateName(name: string): { valid: boolean; error?: string } {
  if (name.length < 3) {
    return { valid: false, error: 'Name must be at least 3 characters' };
  }

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
    return { valid: false, error: 'Name can only contain lowercase letters, numbers, and hyphens' };
  }

  if (name.includes('--')) {
    return { valid: false, error: 'Name cannot contain consecutive hyphens' };
  }

  return { valid: true };
}

/**
 * Format a name with .jeju suffix
 */
export function formatJNSName(label: string): string {
  if (label.endsWith('.jeju')) return label;
  return `${label}.jeju`;
}

/**
 * Parse a JNS name to get the label
 */
export function parseJNSName(name: string): string {
  return name.replace('.jeju', '');
}

// ============ Client Class ============

export class JNSClient {
  private provider: ethers.JsonRpcProvider;
  private config: JNSConfig;
  private registry: ethers.Contract;
  private registrar: ethers.Contract;
  private reverseRegistrar: ethers.Contract;

  constructor(config: JNSConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.registry = new ethers.Contract(config.registry, JNS_REGISTRY_ABI, this.provider);
    this.registrar = new ethers.Contract(config.registrar, JNS_REGISTRAR_ABI, this.provider);
    this.reverseRegistrar = new ethers.Contract(config.reverseRegistrar, JNS_REVERSE_REGISTRAR_ABI, this.provider);
  }

  /**
   * Resolve a name to its records
   */
  async resolve(name: string): Promise<JNSResolvedRecord | null> {
    const fullName = formatJNSName(name);
    const node = computeNamehash(fullName);

    // Check if record exists
    const exists = await this.registry.recordExists(node);
    if (!exists) return null;

    // Get resolver address
    const resolverAddr = await this.registry.resolver(node);
    if (resolverAddr === ethers.ZeroAddress) return null;

    const resolver = new ethers.Contract(resolverAddr, JNS_RESOLVER_ABI, this.provider);

    // Fetch all records
    const [address, contenthash, appInfo] = await Promise.all([
      resolver.addr(node).catch(() => null),
      resolver.contenthash(node).catch(() => null),
      resolver.getAppInfo(node).catch(() => [null, null, 0n, null, null, null]),
    ]);

    // Fetch common text records
    const textKeys = ['url', 'description', 'avatar', 'com.github', 'com.twitter'];
    const texts: Record<string, string> = {};
    
    for (const key of textKeys) {
      const value = await resolver.text(node, key).catch(() => '');
      if (value) texts[key] = value;
    }

    return {
      name: fullName,
      node,
      address: address && address !== ethers.ZeroAddress ? address : null,
      contenthash: contenthash && contenthash !== '0x' ? contenthash : null,
      texts,
      app: {
        contract: appInfo[0] && appInfo[0] !== ethers.ZeroAddress ? appInfo[0] : null,
        appId: appInfo[1] && appInfo[1] !== ethers.ZeroHash ? appInfo[1] : null,
        agentId: appInfo[2],
        endpoint: appInfo[3] || null,
        a2aEndpoint: appInfo[4] || null,
      },
    };
  }

  /**
   * Resolve an address to its primary name (reverse lookup)
   */
  async reverseLookup(address: Address): Promise<string | null> {
    const name = await this.reverseRegistrar.nameOf(address).catch(() => '');
    return name || null;
  }

  /**
   * Check if a name is available
   */
  async isAvailable(name: string): Promise<boolean> {
    const label = parseJNSName(name);
    return await this.registrar.available(label);
  }

  /**
   * Get name info (owner, expiration, etc.)
   */
  async getNameInfo(name: string): Promise<JNSNameInfo | null> {
    const label = parseJNSName(name);
    const fullName = formatJNSName(label);
    const node = computeNamehash(fullName);

    const [available, owner, expires, resolverAddr] = await Promise.all([
      this.registrar.available(label),
      this.registrar.ownerOf(label).catch(() => ethers.ZeroAddress),
      this.registrar.nameExpires(label),
      this.registry.resolver(node).catch(() => ethers.ZeroAddress),
    ]);

    if (owner === ethers.ZeroAddress && available) {
      return null; // Name has never been registered
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = Number(expires);
    const isExpired = now > expiresAt;
    const inGracePeriod = isExpired && now <= expiresAt + GRACE_PERIOD;

    return {
      name: fullName,
      owner: owner as Address,
      resolver: resolverAddr as Address,
      expiresAt,
      isExpired,
      inGracePeriod,
    };
  }

  /**
   * Get registration price
   */
  async getPrice(name: string, durationYears: number = 1): Promise<bigint> {
    const label = parseJNSName(name);
    const duration = BigInt(durationYears * 365 * 24 * 60 * 60);
    return await this.registrar.rentPrice(label, duration);
  }

  /**
   * Resolve a name to just the address (simple lookup)
   */
  async resolveAddress(name: string): Promise<Address | null> {
    const record = await this.resolve(name);
    return record?.address || null;
  }

  /**
   * Get the A2A endpoint for a name
   */
  async getA2AEndpoint(name: string): Promise<string | null> {
    const record = await this.resolve(name);
    return record?.app.a2aEndpoint || null;
  }

  /**
   * Get all app info for a name
   */
  async getAppInfo(name: string): Promise<JNSResolvedRecord['app'] | null> {
    const record = await this.resolve(name);
    return record?.app || null;
  }
}

// ============ Factory Function ============

/**
 * Create a JNS client from deployment config
 */
export async function createJNSClient(rpcUrl: string, deploymentPath?: string): Promise<JNSClient> {
  // Try to load deployment from file
  let config: JNSConfig;

  if (deploymentPath) {
    const deployment = await Bun.file(deploymentPath).json();
    config = {
      registry: deployment.JNSRegistry,
      resolver: deployment.JNSResolver,
      registrar: deployment.JNSRegistrar,
      reverseRegistrar: deployment.JNSReverseRegistrar,
      rpcUrl,
    };
  } else {
    // Use environment variables
    config = {
      registry: (process.env.JNS_REGISTRY || '0x0000000000000000000000000000000000000000') as Address,
      resolver: (process.env.JNS_RESOLVER || '0x0000000000000000000000000000000000000000') as Address,
      registrar: (process.env.JNS_REGISTRAR || '0x0000000000000000000000000000000000000000') as Address,
      reverseRegistrar: (process.env.JNS_REVERSE_REGISTRAR || '0x0000000000000000000000000000000000000000') as Address,
      rpcUrl,
    };
  }

  return new JNSClient(config);
}

// ============ Canonical App Names ============

export const JEJU_APPS = {
  gateway: 'gateway.jeju',
  bazaar: 'bazaar.jeju',
  compute: 'compute.jeju',
  storage: 'storage.jeju',
  indexer: 'indexer.jeju',
  cloud: 'cloud.jeju',
  intents: 'intents.jeju',
  docs: 'docs.jeju',
  monitoring: 'monitoring.jeju',
} as const;

export type JejuApp = keyof typeof JEJU_APPS;

/**
 * Get the JNS name for a Jeju app
 */
export function getAppJNSName(app: JejuApp): string {
  return JEJU_APPS[app];
}

/**
 * Resolve a Jeju app to its endpoint
 */
export async function resolveAppEndpoint(
  client: JNSClient,
  app: JejuApp
): Promise<string | null> {
  const name = getAppJNSName(app);
  const record = await client.resolve(name);
  return record?.app.endpoint || record?.texts['url'] || null;
}


