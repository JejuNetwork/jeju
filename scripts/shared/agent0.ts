import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient, type Address, type Chain, keccak256, toUtf8Bytes, zeroAddress } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { readContract, waitForTransactionReceipt } from 'viem/actions';
import { parseAbi } from 'viem';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { Logger } from './logger';

const logger = new Logger({ prefix: 'agent0' });

export interface AppManifest {
  name: string;
  description: string;
  version?: string;
  port?: number;
  ports?: {
    main?: number;
    [key: string]: number | undefined;
  };
  commands?: {
    dev?: string;
    start?: string;
    build?: string;
    test?: string;
  };
  dependencies?: string[];
  tags?: string[];
  healthcheck?: string;
  agent?: {
    enabled?: boolean;
    a2aEndpoint?: string;
    mcpEndpoint?: string;
    tags?: string[];
    metadata?: Record<string, string>;
    trustModels?: ('open' | 'delegated' | 'verified' | 'staked')[];
    x402Support?: boolean;
  };
}

export interface Agent0Config {
  network: 'localnet' | 'testnet' | 'mainnet';
  privateKey: string;
  ipfsGateway?: string;
  pinataJwt?: string;
}

export interface RegistrationResult {
  agentId: string;
  tokenURI: string;
  txHash: string;
  chainId: number;
}

export interface AgentInfo {
  agentId: string;
  name: string;
  description: string;
  a2aEndpoint?: string;
  mcpEndpoint?: string;
  tags: string[];
  active: boolean;
  chainId: number;
}

const NETWORK_CONFIG: Record<string, {
  chainId: number;
  rpcUrl: string;
  registries: {
    IDENTITY: string;
    REPUTATION: string;
    VALIDATION: string;
  };
}> = {
  localnet: {
    chainId: 1337,
    rpcUrl: 'http://localhost:8545',
    registries: {
      IDENTITY: '',
      REPUTATION: '',
      VALIDATION: '',
    },
  },
  testnet: {
    chainId: 11155111, // Sepolia
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    registries: {
      // These are from the ERC-8004 canonical deployments on Sepolia
      IDENTITY: '0x0F7E3D1b3edcf09f134EA8F1ECa2C6A0e00b3E96',
      REPUTATION: '0x6C52Bd8E34bA87D4a2e1d59c1c5fDc4cb0d0bca5',
      VALIDATION: '0x3E8B2fD2C4E0d6fB12a1E5e8f9A6bC2fE4D8bE4a',
    },
  },
  mainnet: {
    chainId: 1, // Ethereum Mainnet
    rpcUrl: 'https://eth.llamarpc.com',
    registries: {
      // To be filled when deployed to mainnet
      IDENTITY: '',
      REPUTATION: '',
      VALIDATION: '',
    },
  },
};

// ============ Core Functions ============

/**
 * Load deployment addresses for localnet from deployment files
 */
function loadLocalnetAddresses(): void {
  const deploymentsDir = resolve(__dirname, '../../packages/contracts/deployments');
  
  // Try to load from identity-system-1337.json
  const identityPath = resolve(deploymentsDir, 'identity-system-1337.json');
  if (existsSync(identityPath)) {
    const deployments = JSON.parse(readFileSync(identityPath, 'utf-8')) as Record<string, string>;
    if (deployments.IdentityRegistry) {
      NETWORK_CONFIG.localnet.registries.IDENTITY = deployments.IdentityRegistry;
    }
    if (deployments.ReputationRegistry) {
      NETWORK_CONFIG.localnet.registries.REPUTATION = deployments.ReputationRegistry;
    }
    if (deployments.ValidationRegistry) {
      NETWORK_CONFIG.localnet.registries.VALIDATION = deployments.ValidationRegistry;
    }
    logger.info('Loaded localnet addresses from identity-system-1337.json');
  }
  
  // Also check localnet-addresses.json for additional addresses
  const localnetPath = resolve(deploymentsDir, 'localnet-addresses.json');
  if (existsSync(localnetPath)) {
    const deployments = JSON.parse(readFileSync(localnetPath, 'utf-8')) as Record<string, string>;
    if (deployments.identityRegistry) {
      NETWORK_CONFIG.localnet.registries.IDENTITY = deployments.identityRegistry;
    }
    if (deployments.reputationRegistry) {
      NETWORK_CONFIG.localnet.registries.REPUTATION = deployments.reputationRegistry;
    }
    if (deployments.validationRegistry) {
      NETWORK_CONFIG.localnet.registries.VALIDATION = deployments.validationRegistry;
    }
  }
}

/**
 * Get network configuration with registry addresses
 */
export function getNetworkConfig(network: 'localnet' | 'testnet' | 'mainnet'): typeof NETWORK_CONFIG['localnet'] {
  if (network === 'localnet') {
    loadLocalnetAddresses();
  }
  return NETWORK_CONFIG[network];
}

/**
 * Load jeju-manifest.json from an app directory
 */
export function loadAppManifest(appDir: string): AppManifest {
  const manifestPath = resolve(appDir, 'jeju-manifest.json');
  
  if (!existsSync(manifestPath)) {
    throw new Error(`jeju-manifest.json not found in ${appDir}`);
  }
  
  return JSON.parse(readFileSync(manifestPath, 'utf-8'));
}

/**
 * Create viem client and account for a network
 */
export function createSigner(config: Agent0Config): { client: PublicClient; walletClient: WalletClient; account: PrivateKeyAccount } {
  const networkConfig = getNetworkConfig(config.network);
  const account = privateKeyToAccount(config.privateKey as `0x${string}`);
  const chain = { id: networkConfig.chainId, name: config.network } as Chain;
  
  const client = createPublicClient({
    chain,
    transport: http(networkConfig.rpcUrl),
  });
  
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(networkConfig.rpcUrl),
  });
  
  return { client, walletClient, account };
}

// ============ Minimal ABI for IdentityRegistry ============

const IDENTITY_REGISTRY_ABI = parseAbi([
  'function register(string calldata tokenURI_) external returns (uint256 agentId)',
  'function register(string calldata tokenURI_, tuple(string key, bytes value)[] calldata metadata) external returns (uint256 agentId)',
  'function setAgentUri(uint256 agentId, string calldata newTokenURI) external',
  'function setMetadata(uint256 agentId, string calldata key, bytes calldata value) external',
  'function getMetadata(uint256 agentId, string calldata key) external view returns (bytes memory)',
  'function tokenURI(uint256 tokenId) external view returns (string memory)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function totalAgents() external view returns (uint256)',
  'function agentExists(uint256 agentId) external view returns (bool)',
  'function updateTags(uint256 agentId, string[] calldata tags_) external',
  'function getAgentTags(uint256 agentId) external view returns (string[] memory)',
  'function getAgentsByTag(string calldata tag) external view returns (uint256[] memory)',
  'event Registered(uint256 indexed agentId, address indexed owner, uint8 tier, uint256 stakedAmount, string tokenURI)',
  'event AgentUriUpdated(uint256 indexed agentId, string newTokenURI)',
]);

// ============ Registration Functions ============

/**
 * Build a registration file from jeju-manifest.json
 */
export function buildRegistrationFile(
  manifest: AppManifest, 
  appUrl: string,
  ownerAddress: string
): Record<string, unknown> {
  const registrationFile: Record<string, unknown> = {
    name: manifest.name,
    description: manifest.description,
    endpoints: [],
    trustModels: manifest.agent?.trustModels || ['open'],
    owners: [ownerAddress],
    operators: [],
    active: true,
    x402support: manifest.agent?.x402Support || false,
    metadata: {
      version: manifest.version || '1.0.0',
      ...(manifest.agent?.metadata || {}),
    },
    updatedAt: Math.floor(Date.now() / 1000),
  };
  
  // Add A2A endpoint if configured
  if (manifest.agent?.a2aEndpoint) {
    (registrationFile.endpoints as Array<{ type: string; value: string; meta?: Record<string, string> }>).push({
      type: 'a2a',
      value: manifest.agent.a2aEndpoint.startsWith('http') 
        ? manifest.agent.a2aEndpoint 
        : `${appUrl}${manifest.agent.a2aEndpoint}`,
      meta: { version: '0.30' },
    });
  }
  
  // Add MCP endpoint if configured
  if (manifest.agent?.mcpEndpoint) {
    (registrationFile.endpoints as Array<{ type: string; value: string; meta?: Record<string, string> }>).push({
      type: 'mcp',
      value: manifest.agent.mcpEndpoint.startsWith('http')
        ? manifest.agent.mcpEndpoint
        : `${appUrl}${manifest.agent.mcpEndpoint}`,
      meta: { version: '2025-06-18' },
    });
  }
  
  return registrationFile;
}

/**
 * Upload registration file to IPFS (simplified - uses HTTP endpoint)
 */
export async function uploadToIPFS(
  registrationFile: Record<string, unknown>,
  ipfsUrl: string = 'http://localhost:5001'
): Promise<string> {
  const response = await fetch(`${ipfsUrl}/api/v0/add`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: JSON.stringify(registrationFile, null, 2),
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to upload to IPFS: ${response.statusText}`);
  }
  
  const result = await response.json() as { Hash: string };
  return `ipfs://${result.Hash}`;
}

/**
 * Register an app as an ERC-8004 agent
 */
export async function registerApp(
  config: Agent0Config,
  manifest: AppManifest,
  _appUrl: string,
  tokenURI?: string
): Promise<RegistrationResult> {
  const networkConfig = getNetworkConfig(config.network);
  const { client, walletClient, account } = createSigner(config);
  
  if (!networkConfig.registries.IDENTITY) {
    throw new Error(`IdentityRegistry not deployed on ${config.network}`);
  }
  
  // Get owner address for logging
  const ownerAddress = account.address;
  
  // Use provided tokenURI or empty string (can be set later)
  const finalTokenURI = tokenURI || '';
  
  logger.info(`Registering agent: ${manifest.name}`);
  logger.info(`  Network: ${config.network} (chainId: ${networkConfig.chainId})`);
  logger.info(`  Owner: ${ownerAddress}`);
  
  // Call register
  const hash = await walletClient.writeContract({
    address: networkConfig.registries.IDENTITY as Address,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'register',
    args: [finalTokenURI],
    account,
  });
  
  const receipt = await waitForTransactionReceipt(client, { hash });
  
  // Extract agentId from logs
  const registeredEvent = receipt.logs.find(
    (log) => log.topics[0] === keccak256(toUtf8Bytes('Registered(uint256,address,uint8,uint256,string)'))
  );
  
  let agentId: string;
  if (registeredEvent && registeredEvent.topics[1]) {
    agentId = BigInt(registeredEvent.topics[1]).toString();
  } else {
    // Fallback: get totalAgents and assume it's the latest
    const total = await readContract(client, {
      address: networkConfig.registries.IDENTITY as Address,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'totalAgents',
    });
    agentId = total.toString();
  }
  
  const formattedAgentId = `${networkConfig.chainId}:${agentId}`;
  
  logger.success(`Agent registered successfully!`);
  logger.info(`  Agent ID: ${formattedAgentId}`);
  logger.info(`  TX Hash: ${hash}`);
  
  // Set tags if configured
  if (manifest.agent?.tags && manifest.agent.tags.length > 0) {
    logger.info(`Setting tags: ${manifest.agent.tags.join(', ')}`);
    const tagHash = await walletClient.writeContract({
      address: networkConfig.registries.IDENTITY as Address,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'updateTags',
      args: [BigInt(agentId), manifest.agent.tags],
      account,
    });
    await waitForTransactionReceipt(client, { hash: tagHash });
  }
  
  return {
    agentId: formattedAgentId,
    tokenURI: finalTokenURI,
    txHash: hash,
    chainId: networkConfig.chainId,
  };
}

/**
 * Update an existing agent's registration
 */
export async function updateAgentUri(
  config: Agent0Config,
  agentId: string,
  newTokenURI: string
): Promise<string> {
  const networkConfig = getNetworkConfig(config.network);
  const { client, walletClient, account } = createSigner(config);
  
  // Parse agentId (format: chainId:tokenId)
  const tokenId = agentId.includes(':') ? agentId.split(':')[1] : agentId;
  
  logger.info(`Updating agent ${agentId} URI to: ${newTokenURI}`);
  
  const hash = await walletClient.writeContract({
    address: networkConfig.registries.IDENTITY as Address,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'setAgentUri',
    args: [BigInt(tokenId), newTokenURI],
    account,
  });
  
  await waitForTransactionReceipt(client, { hash });
  
  logger.success(`Agent URI updated! TX: ${hash}`);
  
  return hash;
}

/**
 * Update agent metadata
 */
export async function updateAgentMetadata(
  config: Agent0Config,
  agentId: string,
  key: string,
  value: string
): Promise<string> {
  const networkConfig = getNetworkConfig(config.network);
  const { client, walletClient, account } = createSigner(config);
  
  const tokenId = agentId.includes(':') ? agentId.split(':')[1] : agentId;
  
  const hash = await walletClient.writeContract({
    address: networkConfig.registries.IDENTITY as Address,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'setMetadata',
    args: [BigInt(tokenId), key, toUtf8Bytes(value)],
    account,
  });
  
  await waitForTransactionReceipt(client, { hash });
  
  return hash;
}

// ============ Discovery Functions ============

/**
 * Get agent info by ID
 */
export async function getAgentInfo(
  config: Agent0Config,
  agentId: string
): Promise<AgentInfo | null> {
  const networkConfig = getNetworkConfig(config.network);
  const chain = { id: networkConfig.chainId, name: config.network } as Chain;
  const client = createPublicClient({
    chain,
    transport: http(networkConfig.rpcUrl),
  });
  
  const tokenId = agentId.includes(':') ? agentId.split(':')[1] : agentId;
  
  // Check if agent exists
  const exists = await readContract(client, {
    address: networkConfig.registries.IDENTITY as Address,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'agentExists',
    args: [BigInt(tokenId)],
  });
  if (!exists) {
    return null;
  }
  
  // Get token URI
  const tokenURI = await readContract(client, {
    address: networkConfig.registries.IDENTITY as Address,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'tokenURI',
    args: [BigInt(tokenId)],
  });
  
  // Get tags
  const tags = await readContract(client, {
    address: networkConfig.registries.IDENTITY as Address,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getAgentTags',
    args: [BigInt(tokenId)],
  });
  
  // If tokenURI is an IPFS or HTTP URL, fetch the registration file
  let registrationFile: Record<string, unknown> = {};
  if (tokenURI) {
    const fetchUrl = tokenURI.startsWith('ipfs://')
      ? `https://ipfs.io/ipfs/${tokenURI.slice(7)}`
      : tokenURI;
    
    const response = await fetch(fetchUrl);
    if (response.ok) {
      registrationFile = await response.json() as Record<string, unknown>;
    }
  }
  
  // Extract endpoints
  const endpoints = (registrationFile.endpoints || []) as Array<{ type: string; value: string }>;
  const a2aEndpoint = endpoints.find(e => e.type === 'a2a')?.value;
  const mcpEndpoint = endpoints.find(e => e.type === 'mcp')?.value;
  
  return {
    agentId: `${networkConfig.chainId}:${tokenId}`,
    name: registrationFile.name as string || '',
    description: registrationFile.description as string || '',
    a2aEndpoint,
    mcpEndpoint,
    tags: tags as string[],
    active: registrationFile.active as boolean || false,
    chainId: networkConfig.chainId,
  };
}

/**
 * Find agents by tag
 */
export async function findAgentsByTag(
  config: Agent0Config,
  tag: string
): Promise<string[]> {
  const networkConfig = getNetworkConfig(config.network);
  const chain = { id: networkConfig.chainId, name: config.network } as Chain;
  const client = createPublicClient({
    chain,
    transport: http(networkConfig.rpcUrl),
  });
  
  const agentIds = await readContract(client, {
    address: networkConfig.registries.IDENTITY as Address,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getAgentsByTag',
    args: [tag],
  });
  return (agentIds as bigint[]).map((id) => `${networkConfig.chainId}:${id.toString()}`);
}

/**
 * Get all registered network app agents
 */
export async function getNetworkAppAgents(config: Agent0Config): Promise<string[]> {
  // Network apps should use the "jeju-app" tag
  return findAgentsByTag(config, 'jeju-app');
}

// ============ Utility Functions ============

/**
 * Detect current network from environment
 */
export function detectNetwork(): 'localnet' | 'testnet' | 'mainnet' {
  const env = process.env.JEJU_NETWORK || process.env.NODE_ENV;
  
  if (env === 'production' || env === 'mainnet') {
    return 'mainnet';
  }
  if (env === 'testnet' || env === 'staging') {
    return 'testnet';
  }
  return 'localnet';
}

/**
 * Get signer private key from environment
 */
export function getSignerFromEnv(): string {
  const privateKey = process.env.PRIVATE_KEY 
    || process.env.DEPLOYER_PRIVATE_KEY
    || process.env.AGENT_PRIVATE_KEY;
  
  if (!privateKey) {
    throw new Error('No private key found in environment. Set PRIVATE_KEY, DEPLOYER_PRIVATE_KEY, or AGENT_PRIVATE_KEY');
  }
  
  return privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
}

/**
 * Create default Agent0Config from environment
 */
export function createConfigFromEnv(): Agent0Config {
  return {
    network: detectNetwork(),
    privateKey: getSignerFromEnv(),
    ipfsGateway: process.env.IPFS_GATEWAY,
    pinataJwt: process.env.PINATA_JWT,
  };
}

