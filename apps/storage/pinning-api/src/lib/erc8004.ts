/**
 * ERC-8004 Registry Integration for IPFS/Storage Service
 * 
 * Provides:
 * - User ban checking for file storage access (address-based + agent-based)
 * - Provider agent verification
 * - Agent-based provider discovery
 * - ModerationMarketplace integration
 */

import { type Address, createPublicClient, http, parseAbi } from 'viem';

const JEJU_CHAIN = {
  id: 1337,
  name: 'Jeju',
  network: 'jeju',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: {
    default: { http: [process.env.RPC_URL || 'http://localhost:9545'] },
    public: { http: [process.env.RPC_URL || 'http://localhost:9545'] },
  },
} as const;

// ============================================================================
// Contract ABIs
// ============================================================================

const IDENTITY_REGISTRY_ABI = parseAbi([
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function agentExists(uint256 agentId) external view returns (bool)',
  'function getMetadata(uint256 agentId, string key) external view returns (bytes)',
  'function getAgentsByTag(string tag) external view returns (uint256[])',
  'function tokenURI(uint256 tokenId) external view returns (string)',
]);

const BAN_MANAGER_ABI = parseAbi([
  'function isBanned(uint256 agentId) external view returns (bool)',
  'function getBanReason(uint256 agentId) external view returns (string)',
  'function isAccessAllowed(uint256 agentId, bytes32 appId) external view returns (bool)',
  'function isAddressBanned(address target) external view returns (bool)',
  'function isOnNotice(address target) external view returns (bool)',
  'function isPermanentlyBanned(address target) external view returns (bool)',
  'function isAddressAccessAllowed(address target, bytes32 appId) external view returns (bool)',
]);

const MODERATION_MARKETPLACE_ABI = parseAbi([
  'function isBanned(address user) external view returns (bool)',
]);

const STORAGE_REGISTRY_ABI = [
  {
    name: 'getProvider',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'owner', type: 'address' },
        { name: 'name', type: 'string' },
        { name: 'endpoint', type: 'string' },
        { name: 'providerType', type: 'uint8' },
        { name: 'attestationHash', type: 'bytes32' },
        { name: 'stake', type: 'uint256' },
        { name: 'registeredAt', type: 'uint256' },
        { name: 'agentId', type: 'uint256' },
        { name: 'active', type: 'bool' },
        { name: 'verified', type: 'bool' },
      ],
    }],
  },
  {
    name: 'getProviderByAgent',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'hasValidAgent',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'getAgentLinkedProviders',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
] as const;

// ============================================================================
// Configuration
// ============================================================================

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

const IDENTITY_REGISTRY_ADDRESS = (process.env.IDENTITY_REGISTRY_ADDRESS || ZERO_ADDRESS) as Address;
const BAN_MANAGER_ADDRESS = (process.env.BAN_MANAGER_ADDRESS || ZERO_ADDRESS) as Address;
const MODERATION_MARKETPLACE_ADDRESS = (process.env.MODERATION_MARKETPLACE_ADDRESS || ZERO_ADDRESS) as Address;
const STORAGE_REGISTRY_ADDRESS = (process.env.STORAGE_REGISTRY_ADDRESS || ZERO_ADDRESS) as Address;

const STORAGE_APP_ID = ('0x' + Buffer.from('jeju-storage').toString('hex').padEnd(64, '0')) as `0x${string}`;

// ============================================================================
// Types
// ============================================================================

export enum BanType {
  NONE = 0,
  ON_NOTICE = 1,
  CHALLENGED = 2,
  PERMANENT = 3
}

export interface BanCheckResult {
  allowed: boolean;
  reason?: string;
  banType?: BanType;
  onNotice?: boolean;
  canAppeal?: boolean;
}

export interface AgentInfo {
  agentId: bigint;
  owner: Address;
  exists: boolean;
  tokenUri?: string;
  metadata?: Record<string, string>;
}

export interface StorageProviderAgentInfo {
  providerAddress: Address;
  agentId: bigint;
  agentValid: boolean;
  endpoint: string;
  active: boolean;
}

// ============================================================================
// Client
// ============================================================================

function getPublicClient() {
  return createPublicClient({
    chain: JEJU_CHAIN,
    transport: http(),
  });
}

// ============================================================================
// Ban Check Cache
// ============================================================================

interface CacheEntry {
  result: BanCheckResult;
  cachedAt: number;
}

const banCache = new Map<string, CacheEntry>();
const CACHE_TTL = 10000; // 10 seconds

function getCachedBan(address: string): BanCheckResult | null {
  const cached = banCache.get(address.toLowerCase());
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.result;
  }
  return null;
}

function setCachedBan(address: string, result: BanCheckResult): void {
  banCache.set(address.toLowerCase(), { result, cachedAt: Date.now() });
}

// ============================================================================
// User Functions
// ============================================================================

/**
 * Check if a user is banned from using storage services
 * Uses both address-based (ModerationMarketplace) and agent-based (BanManager) checks
 */
export async function checkUserBan(userAddress: Address): Promise<BanCheckResult> {
  // Check cache first
  const cached = getCachedBan(userAddress);
  if (cached) return cached;

  // Default to allowed if no contracts configured
  if (BAN_MANAGER_ADDRESS === ZERO_ADDRESS && MODERATION_MARKETPLACE_ADDRESS === ZERO_ADDRESS) {
    return { allowed: true };
  }

  const client = getPublicClient();

  // 1. Check address-based ban via BanManager (new system)
  if (BAN_MANAGER_ADDRESS !== ZERO_ADDRESS) {
    const [isAddressBanned, isOnNotice] = await Promise.all([
      client.readContract({
        address: BAN_MANAGER_ADDRESS,
        abi: BAN_MANAGER_ABI,
        functionName: 'isAddressBanned',
        args: [userAddress],
      }).catch(() => false),
      client.readContract({
        address: BAN_MANAGER_ADDRESS,
        abi: BAN_MANAGER_ABI,
        functionName: 'isOnNotice',
        args: [userAddress],
      }).catch(() => false),
    ]);

    if (isAddressBanned || isOnNotice) {
      const result: BanCheckResult = {
        allowed: false,
        reason: isOnNotice ? 'Account on notice - pending moderation review' : 'Account banned from network',
        banType: isOnNotice ? BanType.ON_NOTICE : BanType.PERMANENT,
        onNotice: isOnNotice,
        canAppeal: !isOnNotice,
      };
      setCachedBan(userAddress, result);
      return result;
    }

    // Also check address-based app access
    const addressAllowed = await client.readContract({
      address: BAN_MANAGER_ADDRESS,
      abi: BAN_MANAGER_ABI,
      functionName: 'isAddressAccessAllowed',
      args: [userAddress, STORAGE_APP_ID],
    }).catch(() => true);

    if (!addressAllowed) {
      const result: BanCheckResult = {
        allowed: false,
        reason: 'Access denied for storage service',
      };
      setCachedBan(userAddress, result);
      return result;
    }
  }

  // 2. Check ModerationMarketplace ban status
  if (MODERATION_MARKETPLACE_ADDRESS !== ZERO_ADDRESS) {
    const marketplaceBanned = await client.readContract({
      address: MODERATION_MARKETPLACE_ADDRESS,
      abi: MODERATION_MARKETPLACE_ABI,
      functionName: 'isBanned',
      args: [userAddress],
    }).catch(() => false);

    if (marketplaceBanned) {
      const result: BanCheckResult = {
        allowed: false,
        reason: 'Banned via Moderation Marketplace',
        canAppeal: true,
      };
      setCachedBan(userAddress, result);
      return result;
    }
  }

  // User is allowed
  const result: BanCheckResult = { allowed: true };
  setCachedBan(userAddress, result);
  return result;
}

// ============================================================================
// Agent Functions
// ============================================================================

/**
 * Get agent information by ID
 */
export async function getAgentInfo(agentId: bigint): Promise<AgentInfo | null> {
  if (IDENTITY_REGISTRY_ADDRESS === ZERO_ADDRESS) {
    return null;
  }

  const client = getPublicClient();

  const exists = await client.readContract({
    address: IDENTITY_REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'agentExists',
    args: [agentId],
  });

  if (!exists) {
    return { agentId, owner: ZERO_ADDRESS, exists: false };
  }

  const owner = await client.readContract({
    address: IDENTITY_REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'ownerOf',
    args: [agentId],
  });

  const tokenUri = await client.readContract({
    address: IDENTITY_REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'tokenURI',
    args: [agentId],
  });

  return {
    agentId,
    owner,
    exists: true,
    tokenUri,
  };
}

/**
 * Get agents tagged as storage providers
 */
export async function getStorageAgents(): Promise<bigint[]> {
  if (IDENTITY_REGISTRY_ADDRESS === ZERO_ADDRESS) {
    return [];
  }

  const client = getPublicClient();

  const agentIds = await client.readContract({
    address: IDENTITY_REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getAgentsByTag',
    args: ['storage'],
  });

  return agentIds;
}

// ============================================================================
// Provider Functions
// ============================================================================

/**
 * Get storage provider by their agent ID
 */
export async function getProviderByAgentId(agentId: bigint): Promise<Address | null> {
  if (STORAGE_REGISTRY_ADDRESS === ZERO_ADDRESS) {
    return null;
  }

  const client = getPublicClient();

  const providerAddress = await client.readContract({
    address: STORAGE_REGISTRY_ADDRESS,
    abi: STORAGE_REGISTRY_ABI,
    functionName: 'getProviderByAgent',
    args: [agentId],
  });

  return providerAddress === ZERO_ADDRESS ? null : providerAddress;
}

/**
 * Check if a storage provider has a valid linked agent
 */
export async function verifyProviderAgent(providerAddress: Address): Promise<boolean> {
  if (STORAGE_REGISTRY_ADDRESS === ZERO_ADDRESS) {
    return true; // No registry configured, allow all
  }

  const client = getPublicClient();

  return client.readContract({
    address: STORAGE_REGISTRY_ADDRESS,
    abi: STORAGE_REGISTRY_ABI,
    functionName: 'hasValidAgent',
    args: [providerAddress],
  });
}

/**
 * Get all storage providers with linked agents
 */
export async function getAgentLinkedProviders(): Promise<StorageProviderAgentInfo[]> {
  if (STORAGE_REGISTRY_ADDRESS === ZERO_ADDRESS) {
    return [];
  }

  const client = getPublicClient();

  const addresses = await client.readContract({
    address: STORAGE_REGISTRY_ADDRESS,
    abi: STORAGE_REGISTRY_ABI,
    functionName: 'getAgentLinkedProviders',
    args: [],
  });

  const providers: StorageProviderAgentInfo[] = [];
  
  for (const addr of addresses) {
    const provider = await client.readContract({
      address: STORAGE_REGISTRY_ADDRESS,
      abi: STORAGE_REGISTRY_ABI,
      functionName: 'getProvider',
      args: [addr],
    });

    providers.push({
      providerAddress: addr,
      agentId: provider.agentId,
      agentValid: provider.agentId > 0n,
      endpoint: provider.endpoint,
      active: provider.active,
    });
  }

  return providers;
}

/**
 * Check if an agent is allowed to access storage services
 */
export async function checkAgentStorageAccess(agentId: bigint): Promise<BanCheckResult> {
  if (BAN_MANAGER_ADDRESS === ZERO_ADDRESS) {
    return { allowed: true };
  }

  const client = getPublicClient();

  const isBanned = await client.readContract({
    address: BAN_MANAGER_ADDRESS,
    abi: BAN_MANAGER_ABI,
    functionName: 'isBanned',
    args: [agentId],
  });

  if (isBanned) {
    const reason = await client.readContract({
      address: BAN_MANAGER_ADDRESS,
      abi: BAN_MANAGER_ABI,
      functionName: 'getBanReason',
      args: [agentId],
    });
    return { allowed: false, reason };
  }

  const isAllowed = await client.readContract({
    address: BAN_MANAGER_ADDRESS,
    abi: BAN_MANAGER_ABI,
    functionName: 'isAccessAllowed',
    args: [agentId, STORAGE_APP_ID],
  });

  if (!isAllowed) {
    return { allowed: false, reason: 'Access denied for storage service' };
  }

  return { allowed: true };
}

/**
 * Clear ban cache for a specific address
 */
export function clearBanCache(address?: string): void {
  if (address) {
    banCache.delete(address.toLowerCase());
  } else {
    banCache.clear();
  }
}
