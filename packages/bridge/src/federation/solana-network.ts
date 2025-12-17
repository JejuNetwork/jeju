/**
 * Solana Network Federation Integration
 * Registers and manages Solana as a federated network in Jeju's NetworkRegistry
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  parseAbi,
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
  toBytes,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { mainnet, sepolia } from 'viem/chains';
import { Connection, PublicKey } from '@solana/web3.js';

const NETWORK_REGISTRY_ABI = parseAbi([
  'function registerNetwork(uint256 chainId, string name, string rpcUrl, string explorerUrl, string wsUrl, tuple(address identityRegistry, address solverRegistry, address inputSettler, address outputSettler, address liquidityVault, address governance, address oracle, address registryHub) contracts, bytes32 genesisHash) external payable',
  'function addStake(uint256 chainId) external payable',
  'function updateNetwork(uint256 chainId, string name, string rpcUrl, string explorerUrl, string wsUrl) external',
  'function updateContracts(uint256 chainId, tuple(address identityRegistry, address solverRegistry, address inputSettler, address outputSettler, address liquidityVault, address governance, address oracle, address registryHub) contracts) external',
  'function establishTrust(uint256 sourceChainId, uint256 targetChainId) external',
  'function getNetwork(uint256 chainId) view returns (tuple(uint256 chainId, string name, string rpcUrl, string explorerUrl, string wsUrl, address operator, tuple(address identityRegistry, address solverRegistry, address inputSettler, address outputSettler, address liquidityVault, address governance, address oracle, address registryHub) contracts, bytes32 genesisHash, uint256 registeredAt, uint256 stake, uint8 trustTier, bool isActive, bool isVerified, bool isSuperchain))',
  'function isTrusted(uint256 sourceChainId, uint256 targetChainId) view returns (bool)',
  'function isMutuallyTrusted(uint256 chainA, uint256 chainB) view returns (bool)',
  'function canParticipateInConsensus(uint256 chainId) view returns (bool)',
  'function getTrustedPeers(uint256 chainId) view returns (uint256[])',
  'event NetworkRegistered(uint256 indexed chainId, string name, address indexed operator, uint256 stake)',
  'event TrustEstablished(uint256 indexed sourceChainId, uint256 indexed targetChainId, address indexed attestedBy)',
]);

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

const SOLANA_CHAIN_ID = 101n;
const SOLANA_DEVNET_CHAIN_ID = 102n;
const MIN_STAKE = BigInt(1e18); // 1 ETH
const VERIFICATION_STAKE = BigInt(10e18); // 10 ETH

// 8004-solana program ID
const AGENT_REGISTRY_PROGRAM_ID = 'HvF3JqhahcX7JfhbDRYYCJ7S3f6nJdrqu5yi9shyTREp';

export interface NetworkRegistryConfig {
  evmRpcUrl: string;
  evmChainId: number;
  networkRegistryAddress: Address;
  privateKey: Hex;
}

export interface SolanaNetworkConfig {
  rpcUrl: string;
  wsUrl: string;
  explorerUrl: string;
  isDevnet: boolean;
  agentRegistryProgramId?: string;
  bridgeProgramId?: string;
}

export interface NetworkContracts {
  identityRegistry: Address;
  solverRegistry: Address;
  inputSettler: Address;
  outputSettler: Address;
  liquidityVault: Address;
  governance: Address;
  oracle: Address;
  registryHub: Address;
}

export interface SolanaNetworkInfo {
  chainId: bigint;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  wsUrl: string;
  operator: Address;
  contracts: NetworkContracts;
  genesisHash: Hex;
  registeredAt: bigint;
  stake: bigint;
  trustTier: number;
  isActive: boolean;
  isVerified: boolean;
  isSuperchain: boolean;
}

export enum TrustTier {
  UNSTAKED = 0,
  STAKED = 1,
  VERIFIED = 2,
}

export class SolanaNetworkRegistry {
  private config: NetworkRegistryConfig;
  private account: PrivateKeyAccount;
  private publicClient: ReturnType<typeof createPublicClient>;
  private walletClient: ReturnType<typeof createWalletClient>;

  constructor(config: NetworkRegistryConfig) {
    this.config = config;
    this.account = privateKeyToAccount(config.privateKey);

    const chain = config.evmChainId === 1 ? mainnet : sepolia;

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.evmRpcUrl),
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(config.evmRpcUrl),
    });
  }

  /**
   * Register Solana network in the federation
   */
  async registerSolanaNetwork(
    solanaConfig: SolanaNetworkConfig,
    stakeAmount: bigint = MIN_STAKE
  ): Promise<Hex> {
    const chainId = solanaConfig.isDevnet ? SOLANA_DEVNET_CHAIN_ID : SOLANA_CHAIN_ID;
    const name = solanaConfig.isDevnet ? 'Solana Devnet' : 'Solana Mainnet';

    // Get Solana genesis hash
    const genesisHash = await this.getSolanaGenesisHash(solanaConfig.rpcUrl);

    // Convert Solana program IDs to pseudo-addresses for EVM registry
    // These aren't real EVM addresses but serve as identifiers
    const contracts: NetworkContracts = {
      identityRegistry: this.programIdToAddress(solanaConfig.agentRegistryProgramId || AGENT_REGISTRY_PROGRAM_ID),
      solverRegistry: ZERO_ADDRESS, // Not yet deployed on Solana
      inputSettler: ZERO_ADDRESS, // Cross-chain settler
      outputSettler: ZERO_ADDRESS,
      liquidityVault: ZERO_ADDRESS,
      governance: ZERO_ADDRESS,
      oracle: ZERO_ADDRESS,
      registryHub: ZERO_ADDRESS,
    };

    const hash = await this.walletClient.writeContract({
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'registerNetwork',
      args: [
        chainId,
        name,
        solanaConfig.rpcUrl,
        solanaConfig.explorerUrl,
        solanaConfig.wsUrl,
        [
          contracts.identityRegistry,
          contracts.solverRegistry,
          contracts.inputSettler,
          contracts.outputSettler,
          contracts.liquidityVault,
          contracts.governance,
          contracts.oracle,
          contracts.registryHub,
        ],
        genesisHash,
      ],
      value: stakeAmount,
      account: this.account,
      chain: null,
    });

    return hash;
  }

  /**
   * Add stake to upgrade trust tier
   */
  async addStake(chainId: bigint, amount: bigint): Promise<Hex> {
    return await this.walletClient.writeContract({
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'addStake',
      args: [chainId],
      value: amount,
      account: this.account,
      chain: null,
    });
  }

  /**
   * Establish trust between Solana and an EVM chain
   */
  async establishTrust(evmChainId: bigint, solanaChainId: bigint): Promise<Hex> {
    return await this.walletClient.writeContract({
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'establishTrust',
      args: [evmChainId, solanaChainId],
      account: this.account,
      chain: null,
    });
  }

  /**
   * Update Solana network contracts (e.g., after new program deployments)
   */
  async updateContracts(chainId: bigint, contracts: NetworkContracts): Promise<Hex> {
    return await this.walletClient.writeContract({
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'updateContracts',
      args: [
        chainId,
        [
          contracts.identityRegistry,
          contracts.solverRegistry,
          contracts.inputSettler,
          contracts.outputSettler,
          contracts.liquidityVault,
          contracts.governance,
          contracts.oracle,
          contracts.registryHub,
        ],
      ],
      account: this.account,
      chain: null,
    });
  }

  /**
   * Get Solana network info from registry
   */
  async getSolanaNetworkInfo(isDevnet: boolean = false): Promise<SolanaNetworkInfo | null> {
    const chainId = isDevnet ? SOLANA_DEVNET_CHAIN_ID : SOLANA_CHAIN_ID;

    const result = await this.publicClient.readContract({
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'getNetwork',
      args: [chainId],
    }) as [
      bigint, string, string, string, string, Address,
      [Address, Address, Address, Address, Address, Address, Address, Address],
      Hex, bigint, bigint, number, boolean, boolean, boolean
    ];

    if (result[8] === 0n) return null; // Not registered

    return {
      chainId: result[0],
      name: result[1],
      rpcUrl: result[2],
      explorerUrl: result[3],
      wsUrl: result[4],
      operator: result[5],
      contracts: {
        identityRegistry: result[6][0],
        solverRegistry: result[6][1],
        inputSettler: result[6][2],
        outputSettler: result[6][3],
        liquidityVault: result[6][4],
        governance: result[6][5],
        oracle: result[6][6],
        registryHub: result[6][7],
      },
      genesisHash: result[7],
      registeredAt: result[8],
      stake: result[9],
      trustTier: result[10],
      isActive: result[11],
      isVerified: result[12],
      isSuperchain: result[13],
    };
  }

  /**
   * Check if Solana is trusted by an EVM chain
   */
  async isTrustedByChain(evmChainId: bigint, solanaIsDevnet: boolean = false): Promise<boolean> {
    const solanaChainId = solanaIsDevnet ? SOLANA_DEVNET_CHAIN_ID : SOLANA_CHAIN_ID;
    return await this.publicClient.readContract({
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'isTrusted',
      args: [evmChainId, solanaChainId],
    }) as boolean;
  }

  /**
   * Check if Solana and an EVM chain have mutual trust
   */
  async isMutuallyTrusted(evmChainId: bigint, solanaIsDevnet: boolean = false): Promise<boolean> {
    const solanaChainId = solanaIsDevnet ? SOLANA_DEVNET_CHAIN_ID : SOLANA_CHAIN_ID;
    return await this.publicClient.readContract({
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'isMutuallyTrusted',
      args: [evmChainId, solanaChainId],
    }) as boolean;
  }

  /**
   * Check if Solana can participate in federation consensus
   */
  async canParticipateInConsensus(solanaIsDevnet: boolean = false): Promise<boolean> {
    const solanaChainId = solanaIsDevnet ? SOLANA_DEVNET_CHAIN_ID : SOLANA_CHAIN_ID;
    return await this.publicClient.readContract({
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'canParticipateInConsensus',
      args: [solanaChainId],
    }) as boolean;
  }

  /**
   * Get all chains that trust Solana
   */
  async getTrustedPeers(solanaIsDevnet: boolean = false): Promise<bigint[]> {
    const solanaChainId = solanaIsDevnet ? SOLANA_DEVNET_CHAIN_ID : SOLANA_CHAIN_ID;
    return await this.publicClient.readContract({
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'getTrustedPeers',
      args: [solanaChainId],
    }) as bigint[];
  }

  // ============ Helper Methods ============

  /**
   * Get Solana genesis hash
   */
  private async getSolanaGenesisHash(rpcUrl: string): Promise<Hex> {
    const connection = new Connection(rpcUrl, 'confirmed');
    const genesisHash = await connection.getGenesisHash();
    // Convert base58 to bytes32 hex
    const bytes = new PublicKey(genesisHash).toBytes();
    return `0x${Buffer.from(bytes).toString('hex')}` as Hex;
  }

  /**
   * Convert Solana program ID to pseudo EVM address
   * Takes first 20 bytes of the pubkey
   */
  private programIdToAddress(programId: string): Address {
    const pubkey = new PublicKey(programId);
    const bytes = pubkey.toBytes();
    return `0x${Buffer.from(bytes.slice(0, 20)).toString('hex')}` as Address;
  }
}

/**
 * Register both Solana mainnet and devnet in the federation
 */
export async function registerSolanaNetworks(
  config: NetworkRegistryConfig,
  stakePerNetwork: bigint = MIN_STAKE
): Promise<{ mainnet?: Hex; devnet?: Hex }> {
  const registry = new SolanaNetworkRegistry(config);
  const results: { mainnet?: Hex; devnet?: Hex } = {};

  // Register Solana Mainnet
  const mainnetConfig: SolanaNetworkConfig = {
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    wsUrl: 'wss://api.mainnet-beta.solana.com',
    explorerUrl: 'https://explorer.solana.com',
    isDevnet: false,
    agentRegistryProgramId: AGENT_REGISTRY_PROGRAM_ID,
  };

  const mainnetInfo = await registry.getSolanaNetworkInfo(false);
  if (!mainnetInfo) {
    results.mainnet = await registry.registerSolanaNetwork(mainnetConfig, stakePerNetwork);
    console.log(`Registered Solana Mainnet: ${results.mainnet}`);
  } else {
    console.log('Solana Mainnet already registered');
  }

  // Register Solana Devnet
  const devnetConfig: SolanaNetworkConfig = {
    rpcUrl: 'https://api.devnet.solana.com',
    wsUrl: 'wss://api.devnet.solana.com',
    explorerUrl: 'https://explorer.solana.com?cluster=devnet',
    isDevnet: true,
    agentRegistryProgramId: AGENT_REGISTRY_PROGRAM_ID,
  };

  const devnetInfo = await registry.getSolanaNetworkInfo(true);
  if (!devnetInfo) {
    results.devnet = await registry.registerSolanaNetwork(devnetConfig, stakePerNetwork);
    console.log(`Registered Solana Devnet: ${results.devnet}`);
  } else {
    console.log('Solana Devnet already registered');
  }

  return results;
}

/**
 * Establish mutual trust between all Jeju EVM chains and Solana
 */
export async function establishSolanaTrust(
  config: NetworkRegistryConfig,
  evmChainIds: bigint[],
  solanaIsDevnet: boolean = false
): Promise<Hex[]> {
  const registry = new SolanaNetworkRegistry(config);
  const solanaChainId = solanaIsDevnet ? SOLANA_DEVNET_CHAIN_ID : SOLANA_CHAIN_ID;
  const txHashes: Hex[] = [];

  for (const evmChainId of evmChainIds) {
    // Establish trust from EVM to Solana
    const isTrusted = await registry.isTrustedByChain(evmChainId, solanaIsDevnet);
    if (!isTrusted) {
      const hash = await registry.establishTrust(evmChainId, solanaChainId);
      txHashes.push(hash);
      console.log(`Established trust: Chain ${evmChainId} -> Solana (${solanaIsDevnet ? 'devnet' : 'mainnet'}): ${hash}`);
    }
  }

  return txHashes;
}

export function createSolanaNetworkRegistry(config: NetworkRegistryConfig): SolanaNetworkRegistry {
  return new SolanaNetworkRegistry(config);
}

