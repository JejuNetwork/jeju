import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient, type Account } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { ChainId, ChainConfig, StrategyConfig } from '../types';
import { PRICE_ORACLE_ABI, CHAINLINK_AGGREGATOR_ABI } from '../lib/contracts';

interface PriceSource {
  token: string;
  symbol: string;
  chainlinkFeed?: string;
  dexPool?: string;
  lastPrice: bigint;
  lastUpdate: number;
}

interface TokenPrice {
  token: string;
  price: bigint;
  decimals: number;
  source: 'chainlink' | 'dex' | 'api';
  timestamp: number;
}

const CHAINLINK_FEEDS: Record<string, Record<string, string>> = {
  '1': { // Ethereum
    'ETH': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
    'BTC': '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
    'USDC': '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
  },
  '42161': { // Arbitrum
    'ETH': '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
    'BTC': '0x6ce185860a4963106506C203335A2910F5A5C4DD',
    'USDC': '0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3',
  },
  '10': { // Optimism
    'ETH': '0x13e3Ee699D1909E989722E753853AE30b17e08c5',
    'USDC': '0x16a9FA2FDa030272Ce99B29CF780dFA30361E0f3',
  },
  '8453': { // Base
    'ETH': '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
  },
};

const STALE_THRESHOLD_SEC = 3600; // 1 hour
const DEVIATION_THRESHOLD_BPS = 100; // 1%
const UPDATE_COOLDOWN_MS = 60000; // 1 minute between updates

// ============ Strategy Class ============

export class OracleKeeperStrategy {
  private publicClient: PublicClient | null = null;
  private walletClient: WalletClient | null = null;
  private account: Account;
  private priceOracleAddress: string = '';
  private priceSources: Map<string, PriceSource> = new Map();
  private lastUpdateByToken: Map<string, number> = new Map();
  private externalClients: Map<ChainId, PublicClient> = new Map();
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private config: StrategyConfig;
  private chainId: ChainId;

  constructor(
    chainId: ChainId,
    config: StrategyConfig,
    privateKey: string
  ) {
    this.chainId = chainId;
    this.config = config;
    this.account = privateKeyToAccount(privateKey as `0x${string}`);
  }

  /**
   * Initialize oracle keeper
   */
  async initialize(
    chainConfig: ChainConfig,
    priceOracleAddress: string,
    externalChains: ChainConfig[] = []
  ): Promise<void> {
    console.log(`🔮 Initializing oracle keeper strategy`);
    console.log(`   PriceOracle: ${priceOracleAddress}`);
    console.log(`   Keeper: ${this.account.address}`);

    this.priceOracleAddress = priceOracleAddress;

    const chain = {
      id: chainConfig.chainId,
      name: chainConfig.name,
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [chainConfig.rpcUrl] } },
    };

    this.publicClient = createPublicClient({
      chain,
      transport: http(chainConfig.rpcUrl),
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(chainConfig.rpcUrl),
    });

    // Initialize external chain clients for price fetching
    for (const extConfig of externalChains) {
      const extChain = {
        id: extConfig.chainId,
        name: extConfig.name,
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [extConfig.rpcUrl] } },
      };

      const client = createPublicClient({
        chain: extChain,
        transport: http(extConfig.rpcUrl),
      });

      this.externalClients.set(extConfig.chainId, client);
    }
  }

  /**
   * Add a token to monitor
   */
  addToken(token: string, symbol: string, chainlinkFeed?: string, dexPool?: string): void {
    this.priceSources.set(token.toLowerCase(), {
      token: token.toLowerCase(),
      symbol,
      chainlinkFeed,
      dexPool,
      lastPrice: 0n,
      lastUpdate: 0,
    });
  }

  /**
   * Start monitoring prices
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    console.log(`   Starting price monitoring...`);

    // Check prices every 30 seconds
    this.checkInterval = setInterval(() => this.checkPrices(), 30000);

    // Initial check
    this.checkPrices();
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    this.running = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Force update a token price
   */
  async forceUpdate(token: string): Promise<{
    success: boolean;
    txHash?: string;
    error?: string;
  }> {
    const source = this.priceSources.get(token.toLowerCase());
    if (!source) {
      return { success: false, error: 'Token not configured' };
    }

    const price = await this.fetchExternalPrice(source);
    if (!price) {
      return { success: false, error: 'Could not fetch external price' };
    }

    return this.updatePrice(token, price.price, price.decimals);
  }

  // ============ Private Methods ============

  private async checkPrices(): Promise<void> {
    if (!this.publicClient || !this.priceOracleAddress) return;

    for (const [token, source] of this.priceSources) {
      await this.checkToken(token, source);
    }
  }

  private async checkToken(token: string, source: PriceSource): Promise<void> {
    if (!this.publicClient) return;

    // Check cooldown
    const lastUpdate = this.lastUpdateByToken.get(token) || 0;
    if (Date.now() - lastUpdate < UPDATE_COOLDOWN_MS) return;

    try {
      // Get on-chain price
      const onChainResult = await this.publicClient.readContract({
        address: this.priceOracleAddress as `0x${string}`,
        abi: PRICE_ORACLE_ABI,
        functionName: 'getPrice',
        args: [token as `0x${string}`],
      }) as [bigint, bigint];

      const [onChainPrice, decimals] = onChainResult;

      // Check if stale
      const isFresh = await this.publicClient.readContract({
        address: this.priceOracleAddress as `0x${string}`,
        abi: PRICE_ORACLE_ABI,
        functionName: 'isPriceFresh',
        args: [token as `0x${string}`],
      }) as boolean;

      // Get external price
      const externalPrice = await this.fetchExternalPrice(source);
      if (!externalPrice) return;

      // Check if update needed
      let shouldUpdate = false;
      let reason = '';

      if (!isFresh) {
        shouldUpdate = true;
        reason = 'stale';
      } else if (onChainPrice > 0n) {
        // Check deviation
        const diff = onChainPrice > externalPrice.price
          ? onChainPrice - externalPrice.price
          : externalPrice.price - onChainPrice;
        const deviationBps = Number((diff * 10000n) / onChainPrice);

        if (deviationBps > DEVIATION_THRESHOLD_BPS) {
          shouldUpdate = true;
          reason = `deviation ${deviationBps} bps`;
        }
      } else {
        // No price set yet
        shouldUpdate = true;
        reason = 'no price';
      }

      if (shouldUpdate) {
        console.log(`🔮 Updating ${source.symbol} price (${reason})`);
        await this.updatePrice(token, externalPrice.price, externalPrice.decimals);
      }
    } catch (error) {
      console.error(`Error checking ${source.symbol}:`, error);
    }
  }

  private async fetchExternalPrice(source: PriceSource): Promise<TokenPrice | null> {
    // Try Chainlink first
    if (source.chainlinkFeed) {
      const price = await this.fetchChainlinkPrice(source.symbol, source.chainlinkFeed);
      if (price) return price;
    }

    // Fallback to DEX price if configured
    if (source.dexPool) {
      // Would implement DEX price fetching here
      // For now, skip
    }

    return null;
  }

  private async fetchChainlinkPrice(
    symbol: string,
    feedAddress: string
  ): Promise<TokenPrice | null> {
    // Use Ethereum mainnet for Chainlink prices
    const client = this.externalClients.get(1 as ChainId);
    if (!client) return null;

    try {
      const result = await client.readContract({
        address: feedAddress as `0x${string}`,
        abi: CHAINLINK_AGGREGATOR_ABI,
        functionName: 'latestRoundData',
      }) as [bigint, bigint, bigint, bigint, bigint];

      const [, answer, , updatedAt] = result;

      // Check if Chainlink data is fresh
      const ageSeconds = Math.floor(Date.now() / 1000) - Number(updatedAt);
      if (ageSeconds > STALE_THRESHOLD_SEC) {
        console.warn(`Chainlink ${symbol} data is stale (${ageSeconds}s old)`);
        return null;
      }

      // Get decimals
      const decimals = await client.readContract({
        address: feedAddress as `0x${string}`,
        abi: CHAINLINK_AGGREGATOR_ABI,
        functionName: 'decimals',
      }) as number;

      // Convert to 18 decimals
      const priceScaled = answer * BigInt(10 ** (18 - decimals));

      return {
        token: symbol,
        price: priceScaled,
        decimals: 18,
        source: 'chainlink',
        timestamp: Number(updatedAt),
      };
    } catch (error) {
      console.error(`Error fetching Chainlink price for ${symbol}:`, error);
      return null;
    }
  }

  private async updatePrice(
    token: string,
    price: bigint,
    decimals: number
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    if (!this.walletClient || !this.publicClient) {
      return { success: false, error: 'Not initialized' };
    }

    try {
      const hash = await this.walletClient.writeContract({
        address: this.priceOracleAddress as `0x${string}`,
        abi: PRICE_ORACLE_ABI,
        functionName: 'setPrice',
        args: [token as `0x${string}`, price, BigInt(decimals)],
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'reverted') {
        return { success: false, error: 'Transaction reverted' };
      }

      this.lastUpdateByToken.set(token, Date.now());

      // Update local cache
      const source = this.priceSources.get(token.toLowerCase());
      if (source) {
        source.lastPrice = price;
        source.lastUpdate = Date.now();
      }

      console.log(`   ✓ Price updated: ${hash}`);

      return { success: true, txHash: hash };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}
