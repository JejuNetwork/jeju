import type { ChainId, Token, CrossChainArbOpportunity, StrategyConfig } from '../types';

interface ChainPrice {
  chainId: ChainId;
  token: string;
  price: bigint;
  reserve: bigint;
  lastUpdate: number;
}

interface BridgeCost {
  sourceChainId: ChainId;
  destChainId: ChainId;
  baseCost: bigint;
  timeSec: number;
}

const BRIDGE_COSTS: BridgeCost[] = [
  // Ethereum -> L2s (via canonical bridge)
  { sourceChainId: 1, destChainId: 42161, baseCost: BigInt(1e15), timeSec: 600 }, // ~$3
  { sourceChainId: 1, destChainId: 10, baseCost: BigInt(1e15), timeSec: 600 },
  { sourceChainId: 1, destChainId: 8453, baseCost: BigInt(1e15), timeSec: 600 },
  { sourceChainId: 1, destChainId: 420691, baseCost: BigInt(5e14), timeSec: 300 }, // Jeju
  // L2 -> Ethereum (7 day withdrawal, or fast via EIL)
  { sourceChainId: 42161, destChainId: 1, baseCost: BigInt(2e15), timeSec: 60 }, // Fast via EIL
  { sourceChainId: 10, destChainId: 1, baseCost: BigInt(2e15), timeSec: 60 },
  { sourceChainId: 8453, destChainId: 1, baseCost: BigInt(2e15), timeSec: 60 },
  { sourceChainId: 420691, destChainId: 1, baseCost: BigInt(1e15), timeSec: 30 }, // Jeju fast
  // L2 <-> L2 (via Jeju or fast bridges)
  { sourceChainId: 42161, destChainId: 10, baseCost: BigInt(1e15), timeSec: 120 },
  { sourceChainId: 42161, destChainId: 8453, baseCost: BigInt(1e15), timeSec: 120 },
  { sourceChainId: 10, destChainId: 8453, baseCost: BigInt(1e15), timeSec: 120 },
  { sourceChainId: 420691, destChainId: 42161, baseCost: BigInt(8e14), timeSec: 60 },
  { sourceChainId: 420691, destChainId: 10, baseCost: BigInt(8e14), timeSec: 60 },
  { sourceChainId: 420691, destChainId: 8453, baseCost: BigInt(8e14), timeSec: 60 },
];

const PRICE_STALE_MS = 30000;
const MIN_PRICE_DIFF_BPS = 50;
const OPPORTUNITY_TTL_MS = 10000;

export class CrossChainArbStrategy {
  private prices: Map<string, ChainPrice> = new Map(); // "chainId-token" -> price
  private bridgeCosts: Map<string, BridgeCost> = new Map(); // "src-dest" -> cost
  private opportunities: Map<string, CrossChainArbOpportunity> = new Map();
  private tokens: Map<string, Token> = new Map(); // token address -> Token info
  private config: StrategyConfig;
  private supportedChains: ChainId[];

  constructor(supportedChains: ChainId[], config: StrategyConfig) {
    this.supportedChains = supportedChains;
    this.config = config;

    // Initialize bridge costs
    for (const cost of BRIDGE_COSTS) {
      if (supportedChains.includes(cost.sourceChainId) && supportedChains.includes(cost.destChainId)) {
        this.bridgeCosts.set(`${cost.sourceChainId}-${cost.destChainId}`, cost);
      }
    }
  }

  /**
   * Initialize with tokens to monitor
   */
  initialize(tokens: Token[]): void {
    console.log(`🌐 Initializing cross-chain arbitrage strategy`);
    console.log(`   Monitoring ${tokens.length} tokens across ${this.supportedChains.length} chains`);

    for (const token of tokens) {
      this.tokens.set(token.address.toLowerCase(), token);
    }
  }

  /**
   * Update price for a token on a chain
   */
  updatePrice(chainId: ChainId, token: string, price: bigint, reserve: bigint = 0n): void {
    const key = `${chainId}-${token.toLowerCase()}`;

    this.prices.set(key, {
      chainId,
      token: token.toLowerCase(),
      price,
      reserve,
      lastUpdate: Date.now(),
    });

    // Check for arbitrage opportunities
    this.checkArbitrageForToken(token);
  }

  /**
   * Bulk update prices from DEX pool
   */
  updateFromPool(
    chainId: ChainId,
    token0: string,
    token1: string,
    reserve0: bigint,
    reserve1: bigint,
    token0PriceUsd: bigint
  ): void {
    // Calculate token1 price from reserves and token0 price
    // price1 = (reserve0 / reserve1) * price0
    if (reserve1 > 0n) {
      const token1PriceUsd = (reserve0 * token0PriceUsd) / reserve1;
      this.updatePrice(chainId, token0, token0PriceUsd, reserve0);
      this.updatePrice(chainId, token1, token1PriceUsd, reserve1);
    }
  }

  /**
   * Get current opportunities
   */
  getOpportunities(): CrossChainArbOpportunity[] {
    // Clean expired opportunities
    const now = Date.now();
    for (const [id, opp] of this.opportunities) {
      if (opp.expiresAt < now) {
        this.opportunities.delete(id);
      }
    }

    return Array.from(this.opportunities.values())
      .filter(o => o.status === 'DETECTED')
      .sort((a, b) => b.priceDiffBps - a.priceDiffBps);
  }

  /**
   * Mark opportunity as executing
   */
  markExecuting(opportunityId: string): void {
    const opp = this.opportunities.get(opportunityId);
    if (opp) {
      opp.status = 'EXECUTING';
    }
  }

  /**
   * Mark opportunity as completed/failed
   */
  markCompleted(opportunityId: string, success: boolean): void {
    const opp = this.opportunities.get(opportunityId);
    if (opp) {
      opp.status = success ? 'COMPLETED' : 'FAILED';
    }
  }

  // ============ Private Methods ============

  private checkArbitrageForToken(tokenAddress: string): void {
    const tokenLower = tokenAddress.toLowerCase();
    const now = Date.now();

    // Get prices for this token across all chains
    const chainPrices: ChainPrice[] = [];

    for (const chainId of this.supportedChains) {
      const key = `${chainId}-${tokenLower}`;
      const price = this.prices.get(key);

      if (price && now - price.lastUpdate < PRICE_STALE_MS) {
        chainPrices.push(price);
      }
    }

    if (chainPrices.length < 2) return;

    // Find min and max prices
    let minPrice = chainPrices[0];
    let maxPrice = chainPrices[0];

    for (const cp of chainPrices) {
      if (cp.price < minPrice.price) minPrice = cp;
      if (cp.price > maxPrice.price) maxPrice = cp;
    }

    // Calculate price difference
    if (minPrice.price === 0n) return;

    const priceDiff = maxPrice.price - minPrice.price;
    const priceDiffBps = Number((priceDiff * 10000n) / minPrice.price);

    if (priceDiffBps < MIN_PRICE_DIFF_BPS) return;

    // Get bridge cost
    const bridgeKey = `${minPrice.chainId}-${maxPrice.chainId}`;
    const bridgeCost = this.bridgeCosts.get(bridgeKey);

    if (!bridgeCost) return;

    // Calculate optimal trade size and expected profit
    const { inputAmount, profit, netProfit } = this.calculateOptimalTrade(
      minPrice,
      maxPrice,
      bridgeCost
    );

    if (netProfit <= 0n) return;

    // Check against minimum profit threshold
    const netProfitBps = Number((netProfit * 10000n) / inputAmount);
    if (netProfitBps < this.config.minProfitBps) return;

    // Record opportunity
    this.recordOpportunity(tokenLower, minPrice, maxPrice, inputAmount, profit, netProfit, priceDiffBps, bridgeCost);
  }

  private calculateOptimalTrade(
    buyPrice: ChainPrice,
    sellPrice: ChainPrice,
    bridgeCost: BridgeCost
  ): { inputAmount: bigint; profit: bigint; netProfit: bigint } {
    // Simple calculation: trade up to 1% of smaller reserve
    const maxTradeSize = (buyPrice.reserve < sellPrice.reserve ? buyPrice.reserve : sellPrice.reserve) / 100n;

    // Use 0.1 ETH as minimum meaningful trade
    const inputAmount = maxTradeSize > BigInt(1e17) ? maxTradeSize : BigInt(1e17);

    // Gross profit from price difference
    // Buy at buyPrice, sell at sellPrice
    // Value in = inputAmount (in token terms)
    // Value out = inputAmount * (sellPrice / buyPrice)
    // Profit = inputAmount * ((sellPrice - buyPrice) / buyPrice)
    const grossProfit = (inputAmount * (sellPrice.price - buyPrice.price)) / buyPrice.price;

    // Net profit after bridge costs and gas
    // Assume 500k gas on each chain at 50 gwei = ~0.025 ETH each
    const gasCostPerChain = BigInt(25e15); // 0.025 ETH
    const totalCost = bridgeCost.baseCost + gasCostPerChain * 2n;

    // Convert cost to token terms using buyPrice
    // cost_in_tokens = cost_in_eth * eth_price / token_price
    // Simplified: assume ETH = $3000, use buyPrice as token USD price
    const ethPriceUsd = BigInt(3000e18);
    const costInTokens = (totalCost * ethPriceUsd) / buyPrice.price;

    const netProfit = grossProfit - costInTokens;

    return { inputAmount, profit: grossProfit, netProfit };
  }

  private recordOpportunity(
    token: string,
    buyPrice: ChainPrice,
    sellPrice: ChainPrice,
    inputAmount: bigint,
    profit: bigint,
    netProfit: bigint,
    priceDiffBps: number,
    bridgeCost: BridgeCost
  ): void {
    const id = `xchain-${buyPrice.chainId}-${sellPrice.chainId}-${token}-${Date.now()}`;

    const tokenInfo = this.tokens.get(token);
    if (!tokenInfo) {
      throw new Error(`Token ${token} not registered for cross-chain arbitrage`);
    }

    const opportunity: CrossChainArbOpportunity = {
      id,
      type: 'CROSS_CHAIN_ARBITRAGE',
      sourceChainId: buyPrice.chainId,
      destChainId: sellPrice.chainId,
      token: tokenInfo,
      sourcePrice: buyPrice.price.toString(),
      destPrice: sellPrice.price.toString(),
      priceDiffBps,
      inputAmount: inputAmount.toString(),
      expectedProfit: profit.toString(),
      bridgeCost: bridgeCost.baseCost.toString(),
      netProfitWei: netProfit.toString(),
      netProfitUsd: '0', // Would need to calculate
      detectedAt: Date.now(),
      expiresAt: Date.now() + OPPORTUNITY_TTL_MS,
      status: 'DETECTED',
    };

    this.opportunities.set(id, opportunity);

    console.log(
      `🌐 Cross-chain arb detected: ${tokenInfo.symbol} ${priceDiffBps} bps diff ` +
      `(${buyPrice.chainId} → ${sellPrice.chainId})`
    );
  }
}
