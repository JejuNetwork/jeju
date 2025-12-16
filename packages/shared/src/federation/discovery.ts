import {
  createPublicClient,
  http,
  type PublicClient,
  type Address,
} from 'viem';
import type { NetworkInfo, FederatedSolver, NetworkLiquidity, DiscoveryConfig } from './types';
import { NETWORK_REGISTRY_ABI, FEDERATED_SOLVER_ABI, FEDERATED_LIQUIDITY_ABI } from './abis';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export class FederationDiscovery {
  private config: DiscoveryConfig;
  private hubClient: PublicClient;
  private cache: Map<string, CacheEntry<NetworkInfo | NetworkInfo[] | FederatedSolver[] | NetworkLiquidity[]>>;
  private cacheTtl: number;

  constructor(config: DiscoveryConfig) {
    this.config = config;
    this.hubClient = createPublicClient({ transport: http(config.hubRpcUrl) });
    this.cache = new Map();
    this.cacheTtl = config.cacheTtlMs ?? 300000; // 5 minutes default
  }

  private getCached<T>(key: string): T | null {
    if (!this.config.cacheEnabled) return null;
    
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > this.cacheTtl) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data as T;
  }

  private setCache<T extends NetworkInfo | NetworkInfo[] | FederatedSolver[] | NetworkLiquidity[]>(key: string, data: T): void {
    if (!this.config.cacheEnabled) return;
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  async discoverNetworks(): Promise<NetworkInfo[]> {
    const cacheKey = 'networks:all';
    const cached = this.getCached<NetworkInfo[]>(cacheKey);
    if (cached) return cached;

    const chainIds = await this.hubClient.readContract({
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'getActiveNetworks',
    }) as bigint[];

    const networks: NetworkInfo[] = [];

    for (const chainId of chainIds) {
      const network = await this.getNetwork(Number(chainId));
      if (network) networks.push(network);
    }

    this.setCache(cacheKey, networks);
    return networks;
  }

  async getNetwork(chainId: number): Promise<NetworkInfo | null> {
    const cacheKey = `network:${chainId}`;
    const cached = this.getCached<NetworkInfo>(cacheKey);
    if (cached) return cached;

    const result = await this.hubClient.readContract({
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'getNetwork',
      args: [BigInt(chainId)],
    }).catch(() => null);

    if (!result) return null;

    const network = result as unknown as NetworkInfo;
    this.setCache(cacheKey, network);
    return network;
  }

  async getVerifiedNetworks(): Promise<NetworkInfo[]> {
    const cacheKey = 'networks:verified';
    const cached = this.getCached<NetworkInfo[]>(cacheKey);
    if (cached) return cached;

    const chainIds = await this.hubClient.readContract({
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'getVerifiedNetworks',
    }) as bigint[];

    const networks: NetworkInfo[] = [];

    for (const chainId of chainIds) {
      const network = await this.getNetwork(Number(chainId));
      if (network) networks.push(network);
    }

    this.setCache(cacheKey, networks);
    return networks;
  }

  async getTrustedPeers(chainId: number): Promise<number[]> {
    const result = await this.hubClient.readContract({
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'getTrustedPeers',
      args: [BigInt(chainId)],
    }) as bigint[];

    return result.map(id => Number(id));
  }

  async isTrusted(sourceChainId: number, targetChainId: number): Promise<boolean> {
    return this.hubClient.readContract({
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'isTrusted',
      args: [BigInt(sourceChainId), BigInt(targetChainId)],
    }) as Promise<boolean>;
  }

  async findRoutes(sourceChainId: number, destChainId: number): Promise<{
    direct: boolean;
    hops: number[];
    trustedPath: boolean;
  }> {
    const isTrusted = await this.isTrusted(sourceChainId, destChainId);
    
    if (isTrusted) {
      return { direct: true, hops: [], trustedPath: true };
    }

    const sourcePeers = await this.getTrustedPeers(sourceChainId);
    
    for (const peer of sourcePeers) {
      const peerTrustsDest = await this.isTrusted(peer, destChainId);
      if (peerTrustsDest) {
        return { direct: false, hops: [peer], trustedPath: true };
      }
    }

    return { direct: false, hops: [], trustedPath: false };
  }

  async discoverSolversForRoute(
    federatedSolverAddress: Address,
    localRpcUrl: string,
    sourceChainId: number,
    destChainId: number
  ): Promise<FederatedSolver[]> {
    const localClient = createPublicClient({ transport: http(localRpcUrl) });

    const solverIds = await localClient.readContract({
      address: federatedSolverAddress,
      abi: FEDERATED_SOLVER_ABI,
      functionName: 'getSolversForRoute',
      args: [BigInt(sourceChainId), BigInt(destChainId)],
    }) as `0x${string}`[];

    const solvers: FederatedSolver[] = [];

    for (const solverId of solverIds) {
      const solver = await localClient.readContract({
        address: federatedSolverAddress,
        abi: FEDERATED_SOLVER_ABI,
        functionName: 'getSolver',
        args: [solverId],
      }) as unknown as FederatedSolver;

      if (solver.isActive) {
        solvers.push(solver);
      }
    }

    return solvers.sort((a, b) => {
      const aRate = a.totalFills > 0 ? (a.successfulFills * 10000) / a.totalFills : 10000;
      const bRate = b.totalFills > 0 ? (b.successfulFills * 10000) / b.totalFills : 10000;
      const aScore = Number(a.totalStake / BigInt(1e18)) * Number(aRate);
      const bScore = Number(b.totalStake / BigInt(1e18)) * Number(bRate);
      return bScore - aScore;
    });
  }

  async discoverLiquidity(
    federatedLiquidityAddress: Address,
    localRpcUrl: string
  ): Promise<{ totalEth: bigint; totalToken: bigint; networks: NetworkLiquidity[] }> {
    const localClient = createPublicClient({ transport: http(localRpcUrl) });

    const [totalEth, totalToken] = await localClient.readContract({
      address: federatedLiquidityAddress,
      abi: FEDERATED_LIQUIDITY_ABI,
      functionName: 'getTotalFederatedLiquidity',
    }) as [bigint, bigint];

    return { totalEth, totalToken, networks: [] };
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export function createFederationDiscovery(config: DiscoveryConfig): FederationDiscovery {
  return new FederationDiscovery(config);
}

