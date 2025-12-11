/**
 * Multi-Chain Balance Discovery
 *
 * Discovers user's token balances across multiple chains for optimal payment selection.
 * This enables cross-chain payments via OIF without user having to manually bridge.
 *
 * Supported Chains:
 * - Ethereum Mainnet (1)
 * - Arbitrum One (42161)
 * - Optimism (10)
 * - Base (8453)
 * - Jeju Mainnet (420691)
 * - Jeju Testnet (420690)
 */

import { createPublicClient, http, Address, parseAbi, PublicClient } from 'viem';

// ============ Types ============

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  nativeCurrency: {
    symbol: string;
    decimals: number;
  };
  tokens: TokenConfig[];
  crossChainPaymaster?: Address;
  oifInputSettler?: Address;
}

export interface TokenConfig {
  address: Address;
  symbol: string;
  decimals: number;
  isNative?: boolean;
  coingeckoId?: string;
}

export interface TokenBalance {
  chainId: number;
  chainName: string;
  address: Address;
  symbol: string;
  decimals: number;
  balance: bigint;
  balanceFormatted: string;
  usdValue?: number;
  isNative: boolean;
}

export interface MultiChainBalances {
  user: Address;
  totalUsdValue: number;
  balances: TokenBalance[];
  byChain: Map<number, TokenBalance[]>;
  byToken: Map<string, TokenBalance[]>; // symbol -> balances across chains
  lastUpdated: number;
}

// ============ Default Chain Configs ============

const DEFAULT_CHAINS: ChainConfig[] = [
  {
    chainId: 1,
    name: 'Ethereum',
    rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    tokens: [
      { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18, isNative: true },
      { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
      { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
      { address: '0x6B175474E89094C44Da98b954EeaDcB7fCDb4AD66', symbol: 'DAI', decimals: 18 },
    ],
  },
  {
    chainId: 42161,
    name: 'Arbitrum',
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    tokens: [
      { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18, isNative: true },
      { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6 },
      { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT', decimals: 6 },
    ],
  },
  {
    chainId: 10,
    name: 'Optimism',
    rpcUrl: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    tokens: [
      { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18, isNative: true },
      { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', symbol: 'USDC', decimals: 6 },
      { address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', symbol: 'USDT', decimals: 6 },
    ],
  },
  {
    chainId: 8453,
    name: 'Base',
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    tokens: [
      { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18, isNative: true },
      { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 },
    ],
  },
  {
    chainId: 420691,
    name: 'Jeju',
    rpcUrl: process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545',
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    tokens: [
      { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18, isNative: true },
    ],
  },
];

// ============ ABIs ============

const ERC20_BALANCE_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);

// ============ Discovery Service ============

export class MultiChainDiscovery {
  private chains: ChainConfig[];
  private clients: Map<number, PublicClient> = new Map();
  private balanceCache: Map<string, MultiChainBalances> = new Map();
  private cacheTimeout = 30000; // 30 seconds

  constructor(chains?: ChainConfig[]) {
    this.chains = chains || DEFAULT_CHAINS;
    this.initializeClients();
  }

  private initializeClients(): void {
    for (const chain of this.chains) {
      const client = createPublicClient({
        transport: http(chain.rpcUrl),
      });
      this.clients.set(chain.chainId, client as PublicClient);
    }
  }

  /**
   * Add a custom chain
   */
  addChain(chain: ChainConfig): void {
    this.chains.push(chain);
    const client = createPublicClient({
      transport: http(chain.rpcUrl),
    });
    this.clients.set(chain.chainId, client as PublicClient);
  }

  /**
   * Add a custom token to track on a chain
   */
  addToken(chainId: number, token: TokenConfig): void {
    const chain = this.chains.find((c) => c.chainId === chainId);
    if (chain) {
      chain.tokens.push(token);
    }
  }

  /**
   * Discover all balances for a user across all chains
   */
  async discoverBalances(user: Address, forceRefresh = false): Promise<MultiChainBalances> {
    const cacheKey = user.toLowerCase();

    // Check cache
    if (!forceRefresh) {
      const cached = this.balanceCache.get(cacheKey);
      if (cached && Date.now() - cached.lastUpdated < this.cacheTimeout) {
        return cached;
      }
    }

    const balances: TokenBalance[] = [];
    const byChain = new Map<number, TokenBalance[]>();
    const byToken = new Map<string, TokenBalance[]>();

    // Query all chains in parallel
    const chainPromises = this.chains.map(async (chain) => {
      const client = this.clients.get(chain.chainId);
      if (!client) return [];

      const chainBalances: TokenBalance[] = [];

      // Query all tokens on this chain in parallel
      const tokenPromises = chain.tokens.map(async (token) => {
        try {
          let balance: bigint;

          if (token.isNative || token.address === '0x0000000000000000000000000000000000000000') {
            balance = await client.getBalance({ address: user });
          } else {
            balance = await client.readContract({
              address: token.address,
              abi: ERC20_BALANCE_ABI,
              functionName: 'balanceOf',
              args: [user],
            }) as bigint;
          }

          if (balance > 0n) {
            return {
              chainId: chain.chainId,
              chainName: chain.name,
              address: token.address,
              symbol: token.symbol,
              decimals: token.decimals,
              balance,
              balanceFormatted: this.formatBalance(balance, token.decimals),
              isNative: token.isNative || false,
            };
          }
        } catch (e) {
          // Silently skip failed balance checks
          console.debug(`Failed to get ${token.symbol} balance on ${chain.name}:`, e);
        }
        return null;
      });

      const results = await Promise.all(tokenPromises);
      for (const result of results) {
        if (result) chainBalances.push(result);
      }

      return chainBalances;
    });

    const chainResults = await Promise.all(chainPromises);

    // Aggregate results
    for (const chainBalances of chainResults) {
      for (const balance of chainBalances) {
        balances.push(balance);

        // Group by chain
        const chainList = byChain.get(balance.chainId) || [];
        chainList.push(balance);
        byChain.set(balance.chainId, chainList);

        // Group by token symbol
        const tokenList = byToken.get(balance.symbol) || [];
        tokenList.push(balance);
        byToken.set(balance.symbol, tokenList);
      }
    }

    // Calculate total USD value (would need price oracle in production)
    const totalUsdValue = this.estimateUsdValue(balances);

    const result: MultiChainBalances = {
      user,
      totalUsdValue,
      balances,
      byChain,
      byToken,
      lastUpdated: Date.now(),
    };

    this.balanceCache.set(cacheKey, result);
    return result;
  }

  /**
   * Get balances on a specific chain
   */
  async getChainBalances(user: Address, chainId: number): Promise<TokenBalance[]> {
    const all = await this.discoverBalances(user);
    return all.byChain.get(chainId) || [];
  }

  /**
   * Get balances for a specific token across all chains
   */
  async getTokenBalances(user: Address, symbol: string): Promise<TokenBalance[]> {
    const all = await this.discoverBalances(user);
    return all.byToken.get(symbol) || [];
  }

  /**
   * Find the best chain to use a specific token
   * Returns the chain with highest balance
   */
  async findBestChainForToken(user: Address, symbol: string): Promise<{
    chainId: number;
    chainName: string;
    balance: bigint;
  } | null> {
    const tokenBalances = await this.getTokenBalances(user, symbol);
    if (tokenBalances.length === 0) return null;

    const best = tokenBalances.reduce((prev, current) =>
      current.balance > prev.balance ? current : prev
    );

    return {
      chainId: best.chainId,
      chainName: best.chainName,
      balance: best.balance,
    };
  }

  /**
   * Get tokens that exist on multiple chains
   */
  async getCrossChainTokens(user: Address): Promise<Map<string, TokenBalance[]>> {
    const all = await this.discoverBalances(user);
    const crossChain = new Map<string, TokenBalance[]>();

    for (const [symbol, balances] of all.byToken) {
      if (balances.length > 1) {
        crossChain.set(symbol, balances);
      }
    }

    return crossChain;
  }

  /**
   * Get summary of user's multi-chain holdings
   */
  async getSummary(user: Address): Promise<{
    totalChains: number;
    totalTokens: number;
    totalUsdValue: number;
    topTokens: Array<{ symbol: string; totalBalance: string; chains: number }>;
  }> {
    const all = await this.discoverBalances(user);

    const topTokens: Array<{ symbol: string; totalBalance: string; chains: number }> = [];

    for (const [symbol, balances] of all.byToken) {
      const totalBalance = balances.reduce((sum, b) => sum + b.balance, 0n);
      const decimals = balances[0]?.decimals || 18;

      topTokens.push({
        symbol,
        totalBalance: this.formatBalance(totalBalance, decimals),
        chains: balances.length,
      });
    }

    // Sort by number of chains (cross-chain tokens first)
    topTokens.sort((a, b) => b.chains - a.chains);

    return {
      totalChains: all.byChain.size,
      totalTokens: all.balances.length,
      totalUsdValue: all.totalUsdValue,
      topTokens: topTokens.slice(0, 10),
    };
  }

  // ============ Private Helpers ============

  private formatBalance(balance: bigint, decimals: number): string {
    const formatted = Number(balance) / 10 ** decimals;
    if (formatted >= 1000) return formatted.toFixed(2);
    if (formatted >= 1) return formatted.toFixed(4);
    return formatted.toFixed(6);
  }

  private estimateUsdValue(balances: TokenBalance[]): number {
    // Stablecoins are 1:1 USD - for ETH and other tokens, return 0
    // Real prices should come from price oracle in production
    let total = 0;
    for (const balance of balances) {
      const amount = Number(balance.balance) / 10 ** balance.decimals;
      if (balance.symbol === 'USDC' || balance.symbol === 'USDT' || balance.symbol === 'DAI') {
        total += amount;
      }
      // Don't estimate ETH price - that's fake data
    }
    return total;
  }

  // ============ Static Helpers ============

  /**
   * Get supported chains
   */
  getSupportedChains(): Array<{ chainId: number; name: string }> {
    return this.chains.map((c) => ({ chainId: c.chainId, name: c.name }));
  }

  /**
   * Get supported tokens on a chain
   */
  getSupportedTokens(chainId: number): TokenConfig[] {
    const chain = this.chains.find((c) => c.chainId === chainId);
    return chain?.tokens || [];
  }
}

// ============ Factory Functions ============

let globalDiscovery: MultiChainDiscovery | null = null;

/**
 * Get global discovery instance
 */
export function getDiscovery(): MultiChainDiscovery {
  if (!globalDiscovery) {
    globalDiscovery = new MultiChainDiscovery();
  }
  return globalDiscovery;
}

/**
 * Create a custom discovery instance
 */
export function createDiscovery(chains?: ChainConfig[]): MultiChainDiscovery {
  return new MultiChainDiscovery(chains);
}

/**
 * Quick helper to get all balances for a user
 */
export async function discoverAllBalances(user: Address): Promise<MultiChainBalances> {
  return getDiscovery().discoverBalances(user);
}

/**
 * Quick helper to find best token to use
 */
export async function findBestPaymentSource(
  user: Address,
  amount: bigint
): Promise<TokenBalance | null> {
  const all = await discoverAllBalances(user);

  // Find cheapest option that covers the amount
  // Prioritize stablecoins for consistency
  const stablecoins = ['USDC', 'USDT', 'DAI'];

  for (const symbol of stablecoins) {
    const balances = all.byToken.get(symbol);
    if (!balances) continue;

    const suitable = balances.find((b) => b.balance >= amount);
    if (suitable) return suitable;
  }

  // Fall back to ETH
  const ethBalances = all.byToken.get('ETH');
  if (ethBalances) {
    const suitable = ethBalances.find((b) => b.balance >= amount);
    if (suitable) return suitable;
  }

  // Return highest balance of anything
  if (all.balances.length > 0) {
    return all.balances.reduce((prev, curr) =>
      curr.balance > prev.balance ? curr : prev
    );
  }

  return null;
}
