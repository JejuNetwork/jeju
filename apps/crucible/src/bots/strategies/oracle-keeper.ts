import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient, type Account } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { ChainId, ChainConfig, StrategyConfig } from '../autocrat-types';
import { PRICE_ORACLE_ABI, CHAINLINK_AGGREGATOR_ABI } from '../lib/contracts';

interface PriceSource {
  token: string;
  symbol: string;
  chainlinkFeed?: string;
  pythPriceId?: string;
  redstoneDataFeed?: string;
  dexPool?: string;
  lastPrice: bigint;
  lastUpdate: number;
}

interface TokenPrice {
  token: string;
  price: bigint;
  decimals: number;
  source: 'chainlink' | 'pyth' | 'redstone' | 'dex' | 'api';
  timestamp: number;
}

// Pyth Network contract addresses
const PYTH_CONTRACTS: Record<string, string> = {
  '1': '0x4305FB66699C3B2702D4d05CF36551390A4c69C6',      // Ethereum
  '42161': '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C',  // Arbitrum
  '10': '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C',     // Optimism
  '8453': '0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a',   // Base
  '137': '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C',    // Polygon
  '56': '0x4D7E825f80bDf85e913E0DD2A2D54927e9dE1594',     // BSC
};

// Pyth Price Feed IDs (mainnet)
const PYTH_PRICE_IDS: Record<string, string> = {
  'ETH': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  'BTC': '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  'USDC': '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  'SOL': '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  'ARB': '0x3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5',
  'OP': '0x385f64d993f7b77d8182ed5003d97c60aa3361f3cecfe711544d2d59165e9bdf',
};

// Chainlink Automation registrar addresses
const CHAINLINK_AUTOMATION_REGISTRAR: Record<string, string> = {
  '1': '0xDb8e8e2ccb5C033938736aa89Fe4fa1eDfD15a1d',      // Ethereum
  '42161': '0x37D9dC70bfcd8BC77Ec2858836B923c560E891D1',  // Arbitrum
  '10': '0x3f8aF1E3E1c4f4f05e9D3d1f7e05F8ee51cE8a5D',     // Optimism
  '8453': '0xE226D5aCae908252CcA3F6cEFa577815B8D4a9af',   // Base
  '137': '0x9a811502d843E5a03913d5A2cfb646c11463467A',    // Polygon
};

// Redstone Data Service endpoints  
const REDSTONE_ENDPOINTS: Record<string, string> = {
  mainnet: 'https://api.redstone.finance/prices',
  testnet: 'https://api.redstone.finance/prices',
};

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

    const lastUpdate = this.lastUpdateByToken.get(token);
    if (lastUpdate !== undefined && Date.now() - lastUpdate < UPDATE_COOLDOWN_MS) return;

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
  }

  private async fetchExternalPrice(source: PriceSource): Promise<TokenPrice | null> {
    // Try Chainlink first (highest trust)
    if (source.chainlinkFeed) {
      const price = await this.fetchChainlinkPrice(source.symbol, source.chainlinkFeed);
      if (price) return price;
    }

    // Try Pyth Network (fast updates, good coverage)
    const pythPriceId = source.pythPriceId ?? PYTH_PRICE_IDS[source.symbol];
    if (pythPriceId) {
      const price = await this.fetchPythPrice(source.symbol, pythPriceId);
      if (price) return price;
    }

    // Try Redstone (many assets, competitive pricing)
    if (source.redstoneDataFeed || source.symbol) {
      const price = await this.fetchRedstonePrice(source.symbol);
      if (price) return price;
    }

    // Fallback to DEX price if configured
    if (source.dexPool) {
      // Would implement DEX price fetching here
      // For now, skip
    }

    return null;
  }

  /**
   * Fetch price from Pyth Network
   * Pyth provides fast, low-latency price updates
   */
  private async fetchPythPrice(symbol: string, priceId: string): Promise<TokenPrice | null> {
    const pythContract = PYTH_CONTRACTS[String(this.chainId)];
    if (!pythContract || !this.publicClient) return null;

    const PYTH_ABI = [{
      type: 'function',
      name: 'getPriceUnsafe',
      inputs: [{ name: 'id', type: 'bytes32' }],
      outputs: [{
        type: 'tuple',
        components: [
          { name: 'price', type: 'int64' },
          { name: 'conf', type: 'uint64' },
          { name: 'expo', type: 'int32' },
          { name: 'publishTime', type: 'uint256' },
        ],
      }],
      stateMutability: 'view',
    }] as const;

    try {
      const result = await this.publicClient.readContract({
        address: pythContract as `0x${string}`,
        abi: PYTH_ABI,
        functionName: 'getPriceUnsafe',
        args: [priceId as `0x${string}`],
      });

      const { price, expo, publishTime } = result as { price: bigint; conf: bigint; expo: number; publishTime: bigint };

      // Check staleness
      const ageSeconds = Math.floor(Date.now() / 1000) - Number(publishTime);
      if (ageSeconds > STALE_THRESHOLD_SEC) {
        console.warn(`Pyth ${symbol} data is stale (${ageSeconds}s old)`);
        return null;
      }

      // Convert to 18 decimals
      const exponent = Math.abs(expo);
      const priceScaled = expo < 0
        ? price * BigInt(10 ** (18 - exponent))
        : price * BigInt(10 ** (18 + exponent));

      return {
        token: symbol,
        price: priceScaled,
        decimals: 18,
        source: 'pyth',
        timestamp: Number(publishTime),
      };
    } catch (error) {
      console.error(`Error fetching Pyth price for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Fetch price from Redstone Finance
   * Provides prices for many long-tail assets
   */
  private async fetchRedstonePrice(symbol: string): Promise<TokenPrice | null> {
    try {
      const endpoint = REDSTONE_ENDPOINTS.mainnet;
      const response = await fetch(`${endpoint}?symbols=${symbol}&provider=redstone`);
      
      if (!response.ok) return null;

      const data = await response.json() as Record<string, { value: number; timestamp: number }>;
      const priceData = data[symbol];
      
      if (!priceData) return null;

      // Check staleness
      const ageSeconds = Math.floor(Date.now() / 1000) - Math.floor(priceData.timestamp / 1000);
      if (ageSeconds > STALE_THRESHOLD_SEC) {
        console.warn(`Redstone ${symbol} data is stale (${ageSeconds}s old)`);
        return null;
      }

      // Convert to 18 decimals (Redstone returns USD values)
      const priceScaled = BigInt(Math.floor(priceData.value * 1e18));

      return {
        token: symbol,
        price: priceScaled,
        decimals: 18,
        source: 'redstone',
        timestamp: Math.floor(priceData.timestamp / 1000),
      };
    } catch (error) {
      console.error(`Error fetching Redstone price for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Register as Chainlink Automation upkeep
   * This earns LINK rewards for keeping oracle prices updated
   */
  async registerChainlinkAutomation(
    name: string,
    gasLimit: number = 500000,
    linkFunding: bigint = BigInt(5e18) // 5 LINK
  ): Promise<{ success: boolean; upkeepId?: bigint; error?: string }> {
    const registrar = CHAINLINK_AUTOMATION_REGISTRAR[String(this.chainId)];
    if (!registrar || !this.walletClient || !this.publicClient) {
      return { success: false, error: 'Automation not supported on this chain' };
    }

    const REGISTRAR_ABI = [{
      type: 'function',
      name: 'registerUpkeep',
      inputs: [
        {
          name: 'requestParams',
          type: 'tuple',
          components: [
            { name: 'name', type: 'string' },
            { name: 'encryptedEmail', type: 'bytes' },
            { name: 'upkeepContract', type: 'address' },
            { name: 'gasLimit', type: 'uint32' },
            { name: 'adminAddress', type: 'address' },
            { name: 'triggerType', type: 'uint8' },
            { name: 'checkData', type: 'bytes' },
            { name: 'triggerConfig', type: 'bytes' },
            { name: 'offchainConfig', type: 'bytes' },
            { name: 'amount', type: 'uint96' },
          ],
        },
      ],
      outputs: [{ name: 'upkeepId', type: 'uint256' }],
      stateMutability: 'nonpayable',
    }] as const;

    try {
      const hash = await this.walletClient.writeContract({
        chain: this.walletClient.chain,
        account: this.account,
        address: registrar as `0x${string}`,
        abi: REGISTRAR_ABI,
        functionName: 'registerUpkeep',
        args: [{
          name,
          encryptedEmail: '0x' as `0x${string}`,
          upkeepContract: this.priceOracleAddress as `0x${string}`,
          gasLimit,
          adminAddress: this.account.address,
          triggerType: 0, // Conditional
          checkData: '0x' as `0x${string}`,
          triggerConfig: '0x' as `0x${string}`,
          offchainConfig: '0x' as `0x${string}`,
          amount: linkFunding,
        }],
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'reverted') {
        return { success: false, error: 'Registration reverted' };
      }

      // Parse upkeepId from logs (simplified)
      console.log(`   ✓ Registered Chainlink Automation: ${hash}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Update price via Pyth Network with updateData
   * This is the preferred method as it includes proof
   */
  async updatePriceWithPyth(
    token: string,
    pythUpdateData: `0x${string}`[]
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const pythContract = PYTH_CONTRACTS[String(this.chainId)];
    if (!pythContract || !this.walletClient || !this.publicClient) {
      return { success: false, error: 'Pyth not supported on this chain' };
    }

    const PYTH_UPDATE_ABI = [{
      type: 'function',
      name: 'updatePriceFeeds',
      inputs: [{ name: 'updateData', type: 'bytes[]' }],
      outputs: [],
      stateMutability: 'payable',
    }, {
      type: 'function',
      name: 'getUpdateFee',
      inputs: [{ name: 'updateData', type: 'bytes[]' }],
      outputs: [{ type: 'uint256' }],
      stateMutability: 'view',
    }] as const;

    try {
      // Get required fee
      const fee = await this.publicClient.readContract({
        address: pythContract as `0x${string}`,
        abi: PYTH_UPDATE_ABI,
        functionName: 'getUpdateFee',
        args: [pythUpdateData],
      });

      // Update prices
      const hash = await this.walletClient.writeContract({
        chain: this.walletClient.chain,
        account: this.account,
        address: pythContract as `0x${string}`,
        abi: PYTH_UPDATE_ABI,
        functionName: 'updatePriceFeeds',
        args: [pythUpdateData],
        value: fee,
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'reverted') {
        return { success: false, error: 'Pyth update reverted' };
      }

      this.lastUpdateByToken.set(token, Date.now());
      console.log(`   ✓ Pyth price updated: ${hash}`);

      return { success: true, txHash: hash };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get opportunities for oracle keeper rewards
   */
  getKeeperOpportunities(): Array<{
    token: string;
    symbol: string;
    reason: 'stale' | 'deviation' | 'missing';
    estimatedReward: bigint;
  }> {
    const opportunities: Array<{
      token: string;
      symbol: string;
      reason: 'stale' | 'deviation' | 'missing';
      estimatedReward: bigint;
    }> = [];

    for (const [token, source] of this.priceSources) {
      const lastUpdate = this.lastUpdateByToken.get(token);
      const ageSeconds = lastUpdate !== undefined 
        ? Math.floor((Date.now() - lastUpdate) / 1000)
        : STALE_THRESHOLD_SEC + 1; // If never updated, treat as stale

      if (ageSeconds > STALE_THRESHOLD_SEC) {
        opportunities.push({
          token,
          symbol: source.symbol,
          reason: 'stale',
          estimatedReward: BigInt(1e15), // ~0.001 ETH estimate
        });
      }
    }

    return opportunities;
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
        chain: this.walletClient.chain,
        account: this.account,
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
