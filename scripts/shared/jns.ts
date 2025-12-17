import { createPublicClient, http, type PublicClient, type Address, type Chain, keccak256, stringToBytes, namehash as viemNamehash, zeroAddress, zeroHash, parseAbi } from 'viem';
import { readContract } from 'viem/actions';

export interface JNSConfig {
  registry: Address;
  resolver: Address;
  registrar: Address;
  reverseRegistrar: Address;
  rpcUrl: string;
  chain?: Chain;
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

const GRACE_PERIOD = 90 * 24 * 60 * 60;

const JNS_REGISTRY_ABI = parseAbi([
  'function owner(bytes32 node) view returns (address)',
  'function resolver(bytes32 node) view returns (address)',
  'function recordExists(bytes32 node) view returns (bool)',
]);

const JNS_RESOLVER_ABI = parseAbi([
  'function addr(bytes32 node) view returns (address)',
  'function text(bytes32 node, string key) view returns (string)',
  'function contenthash(bytes32 node) view returns (bytes)',
  'function getAppInfo(bytes32 node) view returns (address appContract, bytes32 appId, uint256 agentId, string endpoint, string a2aEndpoint, bytes contenthash_)',
  'function name(bytes32 node) view returns (string)',
]);

const JNS_REGISTRAR_ABI = parseAbi([
  'function available(string name) view returns (bool)',
  'function nameExpires(string name) view returns (uint256)',
  'function ownerOf(string name) view returns (address)',
  'function rentPrice(string name, uint256 duration) view returns (uint256)',
]);

const JNS_REVERSE_REGISTRAR_ABI = parseAbi([
  'function nameOf(address addr) view returns (string)',
  'function node(address addr) view returns (bytes32)',
]);

export function computeNamehash(name: string): `0x${string}` {
  return viemNamehash(name);
}

export function computeLabelhash(label: string): `0x${string}` {
  return keccak256(stringToBytes(label));
}
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
  private client: PublicClient;
  private registry: Address;
  private registrar: Address;
  private reverseRegistrar: Address;

  constructor(config: JNSConfig) {
    this.client = createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    });
    this.registry = config.registry;
    this.registrar = config.registrar;
    this.reverseRegistrar = config.reverseRegistrar;
  }

  /**
   * Resolve a name to its records
   */
  async resolve(name: string): Promise<JNSResolvedRecord | null> {
    const fullName = formatJNSName(name);
    const node = computeNamehash(fullName);

    // Check if record exists
    let exists: boolean;
    try {
      exists = await readContract(this.client, {
        address: this.registry,
        abi: JNS_REGISTRY_ABI,
        functionName: 'recordExists',
        args: [node],
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      if (process.env.DEBUG) {
        console.warn(`Failed to check record existence for ${name}: ${errorMessage}`);
      }
      return null;
    }
    if (!exists) return null;

    // Get resolver address
    let resolverAddr: Address;
    try {
      resolverAddr = await readContract(this.client, {
        address: this.registry,
        abi: JNS_REGISTRY_ABI,
        functionName: 'resolver',
        args: [node],
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      if (process.env.DEBUG) {
        console.warn(`Failed to get resolver for ${name}: ${errorMessage}`);
      }
      return null;
    }
    if (resolverAddr === zeroAddress) return null;

    // Fetch all records
    let address: Address | null;
    let contenthash: `0x${string}` | null;
    let appInfo: [Address | null, `0x${string}` | null, bigint, string | null, string | null, `0x${string}` | null];
    
    try {
      [address, contenthash, appInfo] = await Promise.all([
        readContract(this.client, {
          address: resolverAddr,
          abi: JNS_RESOLVER_ABI,
          functionName: 'addr',
          args: [node],
        }).catch((err) => {
          if (process.env.DEBUG) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            console.warn(`Failed to get address for ${name}: ${errorMessage}`);
          }
          return null;
        }),
        readContract(this.client, {
          address: resolverAddr,
          abi: JNS_RESOLVER_ABI,
          functionName: 'contenthash',
          args: [node],
        }).catch((err) => {
          if (process.env.DEBUG) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            console.warn(`Failed to get contenthash for ${name}: ${errorMessage}`);
          }
          return null;
        }),
        readContract(this.client, {
          address: resolverAddr,
          abi: JNS_RESOLVER_ABI,
          functionName: 'getAppInfo',
          args: [node],
        }).catch((err) => {
          if (process.env.DEBUG) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            console.warn(`Failed to get app info for ${name}: ${errorMessage}`);
          }
          return [null, null, 0n, null, null, null] as [Address | null, `0x${string}` | null, bigint, string | null, string | null, `0x${string}` | null];
        }),
      ]);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      if (process.env.DEBUG) {
        console.warn(`Failed to fetch records for ${name}: ${errorMessage}`);
      }
      return null;
    }

    // Fetch common text records
    const textKeys = ['url', 'description', 'avatar', 'com.github', 'com.twitter'];
    const texts: Record<string, string> = {};
    
    for (const key of textKeys) {
      try {
        const value = await readContract(this.client, {
          address: resolverAddr,
          abi: JNS_RESOLVER_ABI,
          functionName: 'text',
          args: [node, key],
        });
        if (value && value !== '') {
          texts[key] = value;
        }
      } catch (err) {
        // Text records are optional, silently skip on error
        if (process.env.DEBUG) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          console.warn(`Failed to get text record ${key} for ${name}: ${errorMessage}`);
        }
      }
    }

    return {
      name: fullName,
      node,
      address: address && address !== zeroAddress ? address : null,
      contenthash: contenthash && contenthash !== '0x' ? contenthash : null,
      texts,
      app: {
        contract: appInfo[0] && appInfo[0] !== zeroAddress ? appInfo[0] : null,
        appId: appInfo[1] && appInfo[1] !== zeroHash ? appInfo[1] : null,
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
    const name = await readContract(this.client, {
      address: this.reverseRegistrar,
      abi: JNS_REVERSE_REGISTRAR_ABI,
      functionName: 'nameOf',
      args: [address],
    }).catch(() => '');
    return name || null;
  }

  /**
   * Check if a name is available
   */
  async isAvailable(name: string): Promise<boolean> {
    const label = parseJNSName(name);
    return await readContract(this.client, {
      address: this.registrar,
      abi: JNS_REGISTRAR_ABI,
      functionName: 'available',
      args: [label],
    });
  }

  /**
   * Get name info (owner, expiration, etc.)
   */
  async getNameInfo(name: string): Promise<JNSNameInfo | null> {
    const label = parseJNSName(name);
    const fullName = formatJNSName(label);
    const node = computeNamehash(fullName);

    const [available, owner, expires, resolverAddr] = await Promise.all([
      readContract(this.client, {
        address: this.registrar,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'available',
        args: [label],
      }),
      readContract(this.client, {
        address: this.registrar,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'ownerOf',
        args: [label],
      }).catch(() => zeroAddress),
      readContract(this.client, {
        address: this.registrar,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'nameExpires',
        args: [label],
      }),
      readContract(this.client, {
        address: this.registry,
        abi: JNS_REGISTRY_ABI,
        functionName: 'resolver',
        args: [node],
      }).catch(() => zeroAddress),
    ]);

    if (owner === zeroAddress && available) {
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
    return await readContract(this.client, {
      address: this.registrar,
      abi: JNS_REGISTRAR_ABI,
      functionName: 'rentPrice',
      args: [label, duration],
    });
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
  docs: 'docs.jeju',
  monitoring: 'monitoring.jeju',
} as const;

export type NetworkApp = keyof typeof JEJU_APPS;

/**
 * Get the JNS name: getNetworkName() app
 */
export function getAppJNSName(app: NetworkApp): string {
  return JEJU_APPS[app];
}

/**
 * Resolve a network app to its endpoint
 */
export async function resolveAppEndpoint(
  client: JNSClient,
  app: NetworkApp
): Promise<string | null> {
  const name = getAppJNSName(app);
  const record = await client.resolve(name);
  return record?.app.endpoint || record?.texts['url'] || null;
}


