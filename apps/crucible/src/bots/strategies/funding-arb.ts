/**
 * Hyperliquid Funding Rate Arbitrage Strategy
 *
 * Captures funding rate payments by holding delta-neutral positions:
 * - When funding is positive: Long spot, Short perp (receive funding)
 * - When funding is negative: Short spot, Long perp (receive funding)
 *
 * Revenue Model:
 * - Funding payments every 8 hours (0.01% - 0.1% typical)
 * - Annualized yield: 10-100% APR during volatile markets
 * - Risk: Funding rate changes, liquidation risk on leveraged perps
 *
 * Supported Venues:
 * - Hyperliquid (primary perp venue)
 * - dYdX v4
 * - GMX v2
 * - Gains Network
 */

import { EventEmitter } from 'events';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  parseUnits,
  formatUnits,
  encodeFunctionData,
  parseAbi,
} from 'viem';
import { privateKeyToAccount, type Account } from 'viem/accounts';
import { arbitrum, base } from 'viem/chains';

// ============ Configuration ============

const HYPERLIQUID_API = 'https://api.hyperliquid.xyz';
const HYPERLIQUID_WS = 'wss://api.hyperliquid.xyz/ws';

// Minimum funding rate to open position (annualized)
const MIN_FUNDING_APR = 20; // 20% APR minimum

// Maximum position size per asset
const MAX_POSITION_USD = 50000;

// Minimum time to hold position (avoid opening/closing too frequently)
const MIN_HOLD_TIME_MS = 4 * 60 * 60 * 1000; // 4 hours

// Assets to monitor
const MONITORED_ASSETS = ['ETH', 'BTC', 'SOL', 'ARB', 'OP', 'MATIC', 'AVAX', 'ATOM'];

// DEX spot venues for hedging
const SPOT_VENUES: Record<string, { chain: number; router: Address; tokens: Record<string, Address> }> = {
  arbitrum: {
    chain: 42161,
    router: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', // Uniswap V3
    tokens: {
      ETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    },
  },
  base: {
    chain: 8453,
    router: '0x2626664c2603336E57B271c5C0b26F421741e481', // Uniswap V3
    tokens: {
      ETH: '0x4200000000000000000000000000000000000006',
      USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    },
  },
};

// ============ Types ============

interface FundingRate {
  asset: string;
  rate: number; // 8-hour rate
  predictedRate: number;
  annualizedApr: number;
  timestamp: number;
}

interface FundingPosition {
  id: string;
  asset: string;
  perpSide: 'long' | 'short';
  spotSide: 'long' | 'short';
  perpSize: number;
  spotSize: number;
  entryFundingRate: number;
  currentFundingRate: number;
  totalFundingEarned: number;
  openedAt: number;
  status: 'active' | 'closing' | 'closed';
}

interface HyperliquidMeta {
  universe: Array<{
    name: string;
    szDecimals: number;
  }>;
}

interface HyperliquidAssetCtx {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium: string;
  oraclePx: string;
  markPx: string;
}

interface HyperliquidState {
  assetPositions: Array<{
    position: {
      coin: string;
      szi: string;
      entryPx: string;
      positionValue: string;
      unrealizedPnl: string;
      leverage: { type: string; value: number };
    };
  }>;
  marginSummary: {
    accountValue: string;
    totalMarginUsed: string;
    totalNtlPos: string;
  };
}

// ============ Strategy Class ============

export class FundingArbStrategy extends EventEmitter {
  private evmPrivateKey: Hex;
  private positions: Map<string, FundingPosition> = new Map();
  private fundingRates: Map<string, FundingRate> = new Map();
  private running = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private evmClients: Map<number, { public: PublicClient; wallet: WalletClient }> = new Map();
  private assetMeta: Map<string, { szDecimals: number }> = new Map();

  constructor(evmPrivateKey: Hex, evmRpcUrls: Record<number, string>) {
    super();
    this.evmPrivateKey = evmPrivateKey;

    // Initialize EVM clients for spot hedging
    const account = privateKeyToAccount(evmPrivateKey);

    for (const [venue, config] of Object.entries(SPOT_VENUES)) {
      const rpcUrl = evmRpcUrls[config.chain];
      if (!rpcUrl) continue;

      const chain = config.chain === 42161 ? arbitrum : base;

      const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
      });

      const walletClient = createWalletClient({
        account,
        chain,
        transport: http(rpcUrl),
      });

      // Cast needed due to viem type re-exports in monorepo
      this.evmClients.set(config.chain, { public: publicClient as PublicClient, wallet: walletClient as unknown as WalletClient });
    }
  }

  async initialize(): Promise<void> {
    console.log('💰 Initializing funding rate arbitrage strategy...');

    // Fetch Hyperliquid metadata
    const metaResponse = await fetch(`${HYPERLIQUID_API}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'meta' }),
    });

    const meta = await metaResponse.json() as HyperliquidMeta;

    for (const asset of meta.universe) {
      this.assetMeta.set(asset.name, { szDecimals: asset.szDecimals });
    }

    console.log(`   Loaded ${this.assetMeta.size} asset configs`);

    // Initial funding rate fetch
    await this.fetchFundingRates();
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    console.log('   Starting funding rate monitoring...');

    // Poll funding rates every minute
    this.pollInterval = setInterval(() => this.pollFundingRates(), 60000);

    // Initial poll
    this.pollFundingRates();
  }

  stop(): void {
    this.running = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  getPositions(): FundingPosition[] {
    return Array.from(this.positions.values());
  }

  getFundingRates(): FundingRate[] {
    return Array.from(this.fundingRates.values())
      .sort((a, b) => Math.abs(b.annualizedApr) - Math.abs(a.annualizedApr));
  }

  // ============ Core Logic ============

  private async pollFundingRates(): Promise<void> {
    await this.fetchFundingRates();
    await this.evaluateOpportunities();
    await this.managePositions();
  }

  private async fetchFundingRates(): Promise<void> {
    const response = await fetch(`${HYPERLIQUID_API}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    });

    const data = await response.json() as [HyperliquidMeta, HyperliquidAssetCtx[]];
    const [meta, assetCtxs] = data;

    for (let i = 0; i < meta.universe.length; i++) {
      const asset = meta.universe[i];
      const ctx = assetCtxs[i];

      if (!MONITORED_ASSETS.includes(asset.name)) continue;

      const fundingRate8h = parseFloat(ctx.funding);
      const annualizedApr = fundingRate8h * 3 * 365 * 100; // 3 periods per day * 365 days

      this.fundingRates.set(asset.name, {
        asset: asset.name,
        rate: fundingRate8h,
        predictedRate: fundingRate8h, // Would use prediction model in production
        annualizedApr,
        timestamp: Date.now(),
      });
    }
  }

  private async evaluateOpportunities(): Promise<void> {
    for (const [asset, funding] of this.fundingRates) {
      // Skip if already have position
      if (this.positions.has(asset)) continue;

      // Check if funding rate is attractive enough
      if (Math.abs(funding.annualizedApr) < MIN_FUNDING_APR) continue;

      // Determine position direction
      // Positive funding = longs pay shorts, so we want to be short perp + long spot
      // Negative funding = shorts pay longs, so we want to be long perp + short spot
      const perpSide: 'long' | 'short' = funding.rate > 0 ? 'short' : 'long';
      const spotSide: 'long' | 'short' = funding.rate > 0 ? 'long' : 'short';

      console.log(`💰 Funding opportunity: ${asset}`);
      console.log(`   Rate: ${(funding.rate * 100).toFixed(4)}% (${funding.annualizedApr.toFixed(1)}% APR)`);
      console.log(`   Strategy: ${perpSide.toUpperCase()} perp, ${spotSide.toUpperCase()} spot`);

      // Open position
      const result = await this.openFundingPosition(asset, perpSide, spotSide, funding.rate);

      if (result.success) {
        console.log(`   ✓ Position opened`);
        this.emit('positionOpened', result.position);
      } else {
        console.log(`   ✗ Failed: ${result.error}`);
      }
    }
  }

  private async managePositions(): Promise<void> {
    for (const [asset, position] of this.positions) {
      const currentFunding = this.fundingRates.get(asset);
      if (!currentFunding) continue;

      // Update position with current funding
      position.currentFundingRate = currentFunding.rate;

      // Check if we should close
      const holdTime = Date.now() - position.openedAt;
      const fundingFlipped = (position.entryFundingRate > 0) !== (currentFunding.rate > 0);
      const fundingTooLow = Math.abs(currentFunding.annualizedApr) < MIN_FUNDING_APR / 2;

      if (holdTime > MIN_HOLD_TIME_MS && (fundingFlipped || fundingTooLow)) {
        console.log(`💰 Closing ${asset} position (funding ${fundingFlipped ? 'flipped' : 'too low'})`);

        const closeResult = await this.closeFundingPosition(asset);
        if (closeResult.success) {
          console.log(`   ✓ Position closed, earned: $${closeResult.profit?.toFixed(2)}`);
          this.emit('positionClosed', position, closeResult.profit);
        }
      }
    }
  }

  // ============ Position Management ============

  private async openFundingPosition(
    asset: string,
    perpSide: 'long' | 'short',
    spotSide: 'long' | 'short',
    fundingRate: number
  ): Promise<{ success: boolean; position?: FundingPosition; error?: string }> {
    // Calculate position size based on available capital and risk limits
    const positionSizeUsd = Math.min(MAX_POSITION_USD, 10000); // Start with $10k max

    // 1. Open perp position on Hyperliquid
    const perpResult = await this.openHyperliquidPerp(asset, perpSide, positionSizeUsd);
    if (!perpResult.success) {
      return { success: false, error: `Perp open failed: ${perpResult.error}` };
    }

    // 2. Open spot hedge on EVM
    const spotResult = await this.openSpotHedge(asset, spotSide, positionSizeUsd);
    if (!spotResult.success) {
      // Close perp position to unwind
      await this.closeHyperliquidPerp(asset);
      return { success: false, error: `Spot hedge failed: ${spotResult.error}` };
    }

    // 3. Create position record
    const position: FundingPosition = {
      id: `funding-${asset}-${Date.now()}`,
      asset,
      perpSide,
      spotSide,
      perpSize: positionSizeUsd,
      spotSize: positionSizeUsd,
      entryFundingRate: fundingRate,
      currentFundingRate: fundingRate,
      totalFundingEarned: 0,
      openedAt: Date.now(),
      status: 'active',
    };

    this.positions.set(asset, position);

    return { success: true, position };
  }

  private async closeFundingPosition(
    asset: string
  ): Promise<{ success: boolean; profit?: number; error?: string }> {
    const position = this.positions.get(asset);
    if (!position) {
      return { success: false, error: 'Position not found' };
    }

    position.status = 'closing';

    // 1. Close perp position
    const perpResult = await this.closeHyperliquidPerp(asset);
    if (!perpResult.success) {
      return { success: false, error: `Perp close failed: ${perpResult.error}` };
    }

    // 2. Close spot hedge
    const spotResult = await this.closeSpotHedge(asset, position.spotSide, position.spotSize);
    if (!spotResult.success) {
      return { success: false, error: `Spot close failed: ${spotResult.error}` };
    }

    // 3. Calculate profit (funding earned - trading costs)
    const holdTimeHours = (Date.now() - position.openedAt) / (1000 * 60 * 60);
    const fundingPeriods = holdTimeHours / 8;
    const avgFundingRate = (position.entryFundingRate + position.currentFundingRate) / 2;
    const fundingEarned = position.perpSize * avgFundingRate * fundingPeriods;

    // Estimate trading costs (0.1% round trip)
    const tradingCosts = position.perpSize * 0.001 * 2;

    const netProfit = fundingEarned - tradingCosts;

    // 4. Update position
    position.status = 'closed';
    position.totalFundingEarned = netProfit;
    this.positions.delete(asset);

    return { success: true, profit: netProfit };
  }

  // ============ Hyperliquid Integration ============

  private async openHyperliquidPerp(
    asset: string,
    side: 'long' | 'short',
    sizeUsd: number
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
    // Get current price
    const pricesResponse = await fetch(`${HYPERLIQUID_API}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids' }),
    });

    const prices = await pricesResponse.json() as Record<string, string>;
    const price = parseFloat(prices[asset]);

    if (!price) {
      return { success: false, error: `No price for ${asset}` };
    }

    const assetConfig = this.assetMeta.get(asset);
    const szDecimals = assetConfig?.szDecimals || 4;
    const size = sizeUsd / price;
    const sizeFormatted = size.toFixed(szDecimals);

    // Get asset index
    const metaResponse = await fetch(`${HYPERLIQUID_API}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'meta' }),
    });

    const meta = await metaResponse.json() as HyperliquidMeta;
    const assetIndex = meta.universe.findIndex(a => a.name === asset);

    if (assetIndex === -1) {
      return { success: false, error: `Asset ${asset} not found` };
    }

    const isBuy = side === 'long';
    const slippagePrice = isBuy ? price * 1.002 : price * 0.998;

    console.log(`   Placing HL ${side} order: ${sizeFormatted} ${asset} @ ${slippagePrice.toFixed(2)}`);

    // Build and sign order for Hyperliquid
    const timestamp = Date.now();
    const nonce = timestamp;

    const orderAction = {
      type: 'order',
      orders: [{
        a: assetIndex,
        b: isBuy,
        p: slippagePrice.toFixed(5),
        s: sizeFormatted,
        r: false,
        t: { limit: { tif: 'Ioc' } },
      }],
      grouping: 'na',
    };

    // Hyperliquid uses EIP-712 typed data signing with a specific domain
    // chainId 1337 is used for L1 action signing (not 998 which is HyperEVM)
    const domain = {
      name: 'HyperliquidSignTransaction',
      version: '1',
      chainId: 1337,
      verifyingContract: '0x0000000000000000000000000000000000000000' as const,
    };

    const types = {
      'HyperliquidTransaction:Approve': [
        { name: 'hyperliquidChain', type: 'string' },
        { name: 'signatureChainId', type: 'uint64' },
        { name: 'nonce', type: 'uint64' },
      ],
    };

    // Sign the action using correct Hyperliquid L1 signing format
    const account = privateKeyToAccount(this.evmPrivateKey);

    const signature = await account.signTypedData({
      domain,
      types,
      primaryType: 'HyperliquidTransaction:Approve',
      message: {
        hyperliquidChain: 'Mainnet',
        signatureChainId: BigInt(1337),
        nonce: BigInt(nonce),
      },
    });

    // Parse signature into r, s, v components
    const r = signature.slice(0, 66);
    const s = `0x${signature.slice(66, 130)}`;
    const v = parseInt(signature.slice(130, 132), 16);

    // Submit order to Hyperliquid
    const orderResponse = await fetch(`${HYPERLIQUID_API}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: orderAction,
        nonce,
        signature: { r, s, v },
        vaultAddress: null,
      }),
    });

    const orderResult = await orderResponse.json() as { 
      status: string; 
      response?: { data?: { statuses: Array<{ resting?: { oid: number } }> } };
    };

    if (orderResult.status !== 'ok') {
      return { success: false, error: `Order failed: ${JSON.stringify(orderResult)}` };
    }

    const orderId = orderResult.response?.data?.statuses?.[0]?.resting?.oid?.toString() || `hl-${timestamp}`;

    console.log(`   ✓ HL order placed: ${orderId}`);

    return {
      success: true,
      orderId,
    };
  }

  private async closeHyperliquidPerp(
    asset: string
  ): Promise<{ success: boolean; error?: string }> {
    // Query current position
    const account = privateKeyToAccount(this.evmPrivateKey);
    
    const stateResponse = await fetch(`${HYPERLIQUID_API}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clearinghouseState',
        user: account.address,
      }),
    });

    const state = await stateResponse.json() as HyperliquidState;
    
    const position = state.assetPositions.find(p => p.position.coin === asset);
    if (!position) {
      console.log(`   No HL position for ${asset}`);
      return { success: true };
    }

    const size = parseFloat(position.position.szi);
    if (Math.abs(size) < 0.0001) {
      return { success: true };
    }

    // Close by placing opposite order
    const isLong = size > 0;
    const closeResult = await this.openHyperliquidPerp(
      asset,
      isLong ? 'short' : 'long',
      Math.abs(size) * parseFloat(position.position.entryPx)
    );

    if (!closeResult.success) {
      return { success: false, error: closeResult.error };
    }

    console.log(`   ✓ HL position closed`);
    return { success: true };
  }

  // ============ Spot Hedging ============

  private async openSpotHedge(
    asset: string,
    side: 'long' | 'short',
    sizeUsd: number
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const venue = SPOT_VENUES.arbitrum;
    const clients = this.evmClients.get(venue.chain);

    if (!clients) {
      return { success: false, error: 'Arbitrum client not configured' };
    }

    const tokenAddress = venue.tokens[asset] as Address | undefined;
    const usdcAddress = venue.tokens.USDC as Address;

    if (!tokenAddress || !usdcAddress) {
      return { success: false, error: `Token ${asset} not supported for spot` };
    }

    const account = privateKeyToAccount(this.evmPrivateKey);

    // Uniswap V3 SwapRouter02 on Arbitrum
    const swapRouterAddress = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45' as Address;

    const SWAP_ROUTER_ABI = parseAbi([
      'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
    ]);

    const ERC20_ABI = parseAbi([
      'function approve(address spender, uint256 amount) returns (bool)',
      'function balanceOf(address owner) view returns (uint256)',
    ]);

    if (side === 'long') {
      // Buy token with USDC
      console.log(`   Buying $${sizeUsd} of ${asset} on Arbitrum`);

      const amountIn = parseUnits(sizeUsd.toString(), 6); // USDC has 6 decimals

      // Approve USDC
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [swapRouterAddress, amountIn],
      });

      const approveHash = await clients.wallet.sendTransaction({
        to: usdcAddress,
        data: approveData,
        account,
        chain: null,
      });
      await clients.public.waitForTransactionReceipt({ hash: approveHash });

      // Swap USDC -> Token
      const swapData = encodeFunctionData({
        abi: SWAP_ROUTER_ABI,
        functionName: 'exactInputSingle',
        args: [{
          tokenIn: usdcAddress,
          tokenOut: tokenAddress,
          fee: 3000, // 0.3% pool
          recipient: account.address,
          amountIn,
          amountOutMinimum: 0n, // Use slippage protection in production
          sqrtPriceLimitX96: 0n,
        }],
      });

      const swapHash = await clients.wallet.sendTransaction({
        to: swapRouterAddress,
        data: swapData,
        account,
        chain: null,
      });

      await clients.public.waitForTransactionReceipt({ hash: swapHash });
      console.log(`   ✓ Spot buy tx: ${swapHash}`);

      return { success: true, txHash: swapHash };
    } else {
      // Short selling requires borrowing or margin - using GMX/Aave
      // For now, we can implement a simple spot sell if we hold the token
      console.log(`   Selling $${sizeUsd} of ${asset} on Arbitrum (short hedge)`);

      // Check token balance
      const balance = await clients.public.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [account.address],
      });

      if (balance === 0n) {
        return { success: false, error: `No ${asset} balance to sell for short hedge` };
      }

      // Approve token
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [swapRouterAddress, balance],
      });

      const approveHash = await clients.wallet.sendTransaction({
        to: tokenAddress,
        data: approveData,
        account,
        chain: null,
      });
      await clients.public.waitForTransactionReceipt({ hash: approveHash });

      // Swap Token -> USDC
      const swapData = encodeFunctionData({
        abi: SWAP_ROUTER_ABI,
        functionName: 'exactInputSingle',
        args: [{
          tokenIn: tokenAddress,
          tokenOut: usdcAddress,
          fee: 3000,
          recipient: account.address,
          amountIn: balance,
          amountOutMinimum: 0n,
          sqrtPriceLimitX96: 0n,
        }],
      });

      const swapHash = await clients.wallet.sendTransaction({
        to: swapRouterAddress,
        data: swapData,
        account,
        chain: null,
      });

      await clients.public.waitForTransactionReceipt({ hash: swapHash });
      console.log(`   ✓ Spot sell tx: ${swapHash}`);

      return { success: true, txHash: swapHash };
    }
  }

  private async closeSpotHedge(
    asset: string,
    side: 'long' | 'short',
    sizeUsd: number
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    // Close is the opposite of open
    const closeSide = side === 'long' ? 'short' : 'long';
    console.log(`   Closing ${side} spot position: $${sizeUsd} ${asset}`);
    return this.openSpotHedge(asset, closeSide, sizeUsd);
  }

  // ============ Analytics ============

  getTotalEarnings(): number {
    let total = 0;
    for (const position of this.positions.values()) {
      total += position.totalFundingEarned;
    }
    return total;
  }

  getActivePositionValue(): number {
    let total = 0;
    for (const position of this.positions.values()) {
      if (position.status === 'active') {
        total += position.perpSize;
      }
    }
    return total;
  }
}

// ============ Factory ============

export function createFundingArbStrategy(
  evmPrivateKey: Hex,
  evmRpcUrls: Record<number, string>
): FundingArbStrategy {
  return new FundingArbStrategy(evmPrivateKey, evmRpcUrls);
}

