/**
 * Hyperliquid Client for Cross-Chain Bridge
 * 
 * Supports both HyperEVM (EVM-compatible) and HyperCore (orderbook) interactions:
 * - HyperEVM: Standard EVM calls for DeFi operations
 * - HyperCore: Orderbook trading via API
 * 
 * Integration points:
 * - CCIP for bridging assets to/from Hyperliquid
 * - HyperEVM contracts for AMM/DeFi
 * - HyperCore API for orderbook trading
 */

import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  parseAbi,
  type PrivateKeyAccount,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ============ Hyperliquid Chain Definition ============

export const hyperliquidChain = {
  id: 998,
  name: 'Hyperliquid',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://api.hyperliquid.xyz/evm'] },
  },
  blockExplorers: {
    default: { name: 'Hyperliquid Explorer', url: 'https://explorer.hyperliquid.xyz' },
  },
} as const;

// ============ Contract ABIs ============

const CCIP_ROUTER_ABI = parseAbi([
  'function ccipSend(uint64 destinationChainSelector, (bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) payable returns (bytes32)',
  'function getFee(uint64 destinationChainSelector, (bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) view returns (uint256)',
  'function isChainSupported(uint64 chainSelector) view returns (bool)',
]);

const TOKEN_POOL_ABI = parseAbi([
  'function lockOrBurn(address originalSender, bytes receiver, uint256 amount, uint64 destChainSelector, bytes extraData) returns (bytes)',
  'function releaseOrMint(bytes originalSender, address receiver, uint256 amount, uint64 srcChainSelector, bytes extraData)',
  'function getToken() view returns (address)',
  'function getRateLimitAdmin() view returns (address)',
]);

const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

// ============ HyperCore API Types ============

interface HyperCoreOrder {
  coin: string;
  isBuy: boolean;
  sz: string;
  limitPx: string;
  reduceOnly: boolean;
  cloid?: string;
}

interface HyperCorePosition {
  coin: string;
  szi: string;
  entryPx: string;
  positionValue: string;
  unrealizedPnl: string;
  leverage: string;
}

interface HyperCoreMarket {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated: boolean;
}

// ============ Client Configuration ============

export interface HyperliquidClientConfig {
  privateKey?: Hex;
  hyperEvmRpc?: string;
  hyperCoreApi?: string;
  ccipRouterAddress?: Address;
}

// ============ Hyperliquid Client ============

export class HyperliquidClient {
  private config: HyperliquidClientConfig;
  private publicClient: PublicClient;
  private walletClient: WalletClient | null = null;
  private account: PrivateKeyAccount | null = null;

  constructor(config: HyperliquidClientConfig = {}) {
    this.config = {
      hyperEvmRpc: config.hyperEvmRpc ?? 'https://api.hyperliquid.xyz/evm',
      hyperCoreApi: config.hyperCoreApi ?? 'https://api.hyperliquid.xyz',
      ...config,
    };

    this.publicClient = createPublicClient({
      chain: hyperliquidChain,
      transport: http(this.config.hyperEvmRpc),
    });

    if (config.privateKey) {
      this.account = privateKeyToAccount(config.privateKey);
      this.walletClient = createWalletClient({
        chain: hyperliquidChain,
        transport: http(this.config.hyperEvmRpc),
        account: this.account,
      });
    }
  }

  // ============ HyperEVM Methods ============

  /**
   * Get token balance on HyperEVM
   */
  async getTokenBalance(token: Address, owner?: Address): Promise<bigint> {
    const ownerAddress = owner ?? this.account?.address;
    if (!ownerAddress) throw new Error('No owner address specified');

    return await this.publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [ownerAddress],
    });
  }

  /**
   * Approve token spending on HyperEVM
   */
  async approveToken(token: Address, spender: Address, amount: bigint): Promise<Hex> {
    if (!this.walletClient || !this.account) {
      throw new Error('Wallet not initialized');
    }

    const hash = await this.walletClient.writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender, amount],
    });

    return hash;
  }

  /**
   * Bridge tokens TO Hyperliquid via CCIP
   */
  async bridgeToHyperliquid(params: {
    token: Address;
    amount: bigint;
    sourceChainSelector: bigint;
    ccipRouter: Address;
    feeToken?: Address;
  }): Promise<{ messageId: Hex; fee: bigint }> {
    if (!this.walletClient || !this.account) {
      throw new Error('Wallet not initialized');
    }

    // Build CCIP message
    const message = {
      receiver: this.account.address as `0x${string}`,
      data: '0x' as `0x${string}`,
      tokenAmounts: [{ token: params.token, amount: params.amount }],
      feeToken: params.feeToken ?? '0x0000000000000000000000000000000000000000' as Address,
      extraArgs: '0x' as `0x${string}`,
    };

    // Get fee
    const fee = await this.publicClient.readContract({
      address: params.ccipRouter,
      abi: CCIP_ROUTER_ABI,
      functionName: 'getFee',
      args: [params.sourceChainSelector, message],
    });

    // Send CCIP message
    const hash = await this.walletClient.writeContract({
      address: params.ccipRouter,
      abi: CCIP_ROUTER_ABI,
      functionName: 'ccipSend',
      args: [params.sourceChainSelector, message],
      value: fee,
    });

    return { messageId: hash, fee };
  }

  // ============ HyperCore API Methods ============

  /**
   * Get available markets from HyperCore
   */
  async getMarkets(): Promise<HyperCoreMarket[]> {
    const response = await fetch(`${this.config.hyperCoreApi}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'meta' }),
    });

    const data = await response.json() as { universe: HyperCoreMarket[] };
    return data.universe;
  }

  /**
   * Get user positions from HyperCore
   */
  async getPositions(userAddress?: Address): Promise<HyperCorePosition[]> {
    const address = userAddress ?? this.account?.address;
    if (!address) throw new Error('No address specified');

    const response = await fetch(`${this.config.hyperCoreApi}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clearinghouseState',
        user: address,
      }),
    });

    const data = await response.json() as { assetPositions: { position: HyperCorePosition }[] };
    return data.assetPositions.map(ap => ap.position);
  }

  /**
   * Place an order on HyperCore orderbook
   * Note: Requires signing with Hyperliquid's specific signature format
   */
  async placeOrder(order: HyperCoreOrder): Promise<{ status: string; response?: Record<string, unknown> }> {
    if (!this.account) {
      throw new Error('Wallet not initialized');
    }

    // HyperCore uses a specific signing scheme
    // This is a placeholder - actual implementation needs Hyperliquid SDK
    const timestamp = Date.now();
    const orderAction = {
      type: 'order',
      orders: [order],
      grouping: 'na',
    };

    // Sign the action
    const signature = await this.signHyperCoreAction(orderAction, timestamp);

    const response = await fetch(`${this.config.hyperCoreApi}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: orderAction,
        nonce: timestamp,
        signature,
        vaultAddress: null,
      }),
    });

    const result = await response.json() as { status: string; response?: Record<string, unknown> };
    return result;
  }

  /**
   * Get orderbook for a specific market
   */
  async getOrderbook(coin: string): Promise<{
    coin: string;
    levels: { px: string; sz: string; n: number }[][];
  }> {
    const response = await fetch(`${this.config.hyperCoreApi}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'l2Book',
        coin,
      }),
    });

    return await response.json() as { coin: string; levels: { px: string; sz: string; n: number }[][] };
  }

  /**
   * Get mid price for a coin
   */
  async getMidPrice(coin: string): Promise<number> {
    const book = await this.getOrderbook(coin);
    if (book.levels.length < 2) throw new Error('Orderbook not available');

    const bestBid = parseFloat(book.levels[0]?.[0]?.px ?? '0');
    const bestAsk = parseFloat(book.levels[1]?.[0]?.px ?? '0');

    return (bestBid + bestAsk) / 2;
  }

  // ============ Arbitrage Detection ============

  /**
   * Check for arbitrage opportunity between HyperCore and external DEX
   */
  async checkArbOpportunity(params: {
    coin: string;
    externalPrice: number;
    minProfitBps: number;
  }): Promise<{
    hasOpportunity: boolean;
    direction: 'buy_hyper' | 'sell_hyper' | null;
    profitBps: number;
    estimatedProfit: number;
  }> {
    const hyperPrice = await this.getMidPrice(params.coin);
    const priceDiff = (hyperPrice - params.externalPrice) / params.externalPrice;
    const profitBps = Math.abs(priceDiff * 10000);

    if (profitBps < params.minProfitBps) {
      return { hasOpportunity: false, direction: null, profitBps: 0, estimatedProfit: 0 };
    }

    const direction = priceDiff > 0 ? 'sell_hyper' : 'buy_hyper';
    return {
      hasOpportunity: true,
      direction,
      profitBps,
      estimatedProfit: Math.abs(priceDiff * 1000), // Example for $1000 trade
    };
  }

  // ============ Private Methods ============

  private async signHyperCoreAction(action: Record<string, unknown>, timestamp: number): Promise<{ r: string; s: string; v: number }> {
    if (!this.account) throw new Error('No account');

    // Hyperliquid uses EIP-712 typed signing
    // This is a simplified placeholder
    const domain = {
      name: 'HyperliquidSignTransaction',
      version: '1',
      chainId: 998,
      verifyingContract: '0x0000000000000000000000000000000000000000' as Address,
    };

    const types = {
      HyperliquidTransaction: [
        { name: 'action', type: 'string' },
        { name: 'nonce', type: 'uint64' },
      ],
    };

    // Actual signing would use signTypedData
    return { r: '0x', s: '0x', v: 27 };
  }
}

// ============ Factory ============

export function createHyperliquidClient(config?: HyperliquidClientConfig): HyperliquidClient {
  return new HyperliquidClient(config);
}

