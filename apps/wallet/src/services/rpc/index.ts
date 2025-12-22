/**
 * Network RPC Service
 * All RPC calls go through the network infrastructure
 */

import { createPublicClient, http, type PublicClient, type Chain, type Address, type Hex, formatEther } from 'viem';
import { mainnet, base, arbitrum, optimism, bsc } from 'viem/chains';

// Supported chains - unified view, no chain switching
export const SUPPORTED_CHAINS = {
  1: { ...mainnet, name: 'Ethereum' },
  8453: { ...base, name: 'Base' },
  42161: { ...arbitrum, name: 'Arbitrum' },
  10: { ...optimism, name: 'Optimism' },
  56: { ...bsc, name: 'BSC' },
} as const;

export type SupportedChainId = keyof typeof SUPPORTED_CHAINS;

// Network RPC endpoints
const JEJU_RPC_BASE = import.meta.env.VITE_JEJU_RPC_URL || 'https://rpc.jejunetwork.org';

export function getNetworkRpc(chainId: SupportedChainId): string {
  const chainNames: Record<SupportedChainId, string> = {
    1: 'eth',
    8453: 'base',
    42161: 'arbitrum',
    10: 'optimism',
    56: 'bsc',
  };
  return `${JEJU_RPC_BASE}/${chainNames[chainId]}`;
}


class RPCService {
  private clients: Map<SupportedChainId, PublicClient> = new Map();
  private requestCache: Map<string, { data: unknown; timestamp: number }> = new Map();
  private cacheTTL = 5000; // 5 seconds

  getClient(chainId: SupportedChainId): PublicClient {
    if (!this.clients.has(chainId)) {
      const chain = SUPPORTED_CHAINS[chainId];
      const client = createPublicClient({
        chain: chain as Chain,
        transport: http(getNetworkRpc(chainId), {
          timeout: 10000,
          retryCount: 2,
          onFetchRequest: (request) => {
            // Add X402 payment headers if needed
            const headers = new Headers(request.headers);
            headers.set('X-Network-Client', 'wallet');
            return new Request(request.url, { ...request, headers });
          },
        }),
      });
      this.clients.set(chainId, client);
    }
    return this.clients.get(chainId)!;
  }

  async getBalance(chainId: SupportedChainId, address: Address): Promise<bigint> {
    const cacheKey = `balance:${chainId}:${address}`;
    const cached = this.getFromCache<bigint>(cacheKey);
    if (cached !== null) return cached;

    const client = this.getClient(chainId);
    const balance = await client.getBalance({ address });
    this.setCache(cacheKey, balance);
    return balance;
  }

  async getTokenBalance(chainId: SupportedChainId, tokenAddress: Address, ownerAddress: Address): Promise<bigint> {
    const cacheKey = `tokenBalance:${chainId}:${tokenAddress}:${ownerAddress}`;
    const cached = this.getFromCache<bigint>(cacheKey);
    if (cached !== null) return cached;

    const client = this.getClient(chainId);
    const balance = await client.readContract({
      address: tokenAddress,
      abi: [{ name: 'balanceOf', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }],
      functionName: 'balanceOf',
      args: [ownerAddress],
    }) as bigint;
    
    this.setCache(cacheKey, balance);
    return balance;
  }

  async getGasPrice(chainId: SupportedChainId): Promise<bigint> {
    const cacheKey = `gasPrice:${chainId}`;
    const cached = this.getFromCache<bigint>(cacheKey);
    if (cached !== null) return cached;

    const client = this.getClient(chainId);
    const gasPrice = await client.getGasPrice();
    this.setCache(cacheKey, gasPrice, 3000); // 3s cache for gas
    return gasPrice;
  }

  async estimateGas(chainId: SupportedChainId, tx: { to: Address; from: Address; data?: Hex; value?: bigint }): Promise<bigint> {
    const client = this.getClient(chainId);
    return client.estimateGas(tx);
  }

  async sendRawTransaction(chainId: SupportedChainId, signedTx: Hex): Promise<Hex> {
    const client = this.getClient(chainId);
    return client.sendRawTransaction({ serializedTransaction: signedTx });
  }

  async getTransaction(chainId: SupportedChainId, hash: Hex) {
    const client = this.getClient(chainId);
    return client.getTransaction({ hash });
  }

  async getTransactionReceipt(chainId: SupportedChainId, hash: Hex) {
    const client = this.getClient(chainId);
    return client.getTransactionReceipt({ hash });
  }

  async waitForTransaction(chainId: SupportedChainId, hash: Hex) {
    const client = this.getClient(chainId);
    return client.waitForTransactionReceipt({ hash });
  }

  async call(chainId: SupportedChainId, params: { to: Address; data: Hex }) {
    const client = this.getClient(chainId);
    return client.call(params);
  }

  // Get balances across all chains for an address
  async getAllBalances(address: Address): Promise<{ chainId: SupportedChainId; balance: bigint; formatted: string }[]> {
    const chainIds = Object.keys(SUPPORTED_CHAINS).map(Number) as SupportedChainId[];
    const results = await Promise.all(
      chainIds.map(async (chainId) => {
        const balance = await this.getBalance(chainId, address);
        return { chainId, balance, formatted: formatEther(balance) };
      })
    );
    return results;
  }

  private getFromCache<T>(key: string): T | null {
    const entry = this.requestCache.get(key);
    if (entry && Date.now() - entry.timestamp < this.cacheTTL) {
      return entry.data as T;
    }
    return null;
  }

  private setCache(key: string, data: unknown, ttl?: number) {
    this.requestCache.set(key, { data, timestamp: Date.now() });
    // Clean old entries periodically
    if (this.requestCache.size > 1000) {
      const now = Date.now();
      for (const [k, v] of this.requestCache) {
        if (now - v.timestamp > (ttl || this.cacheTTL)) {
          this.requestCache.delete(k);
        }
      }
    }
  }
}

export const rpcService = new RPCService();
export { RPCService };

