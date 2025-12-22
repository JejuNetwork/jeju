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
import {
  HyperCoreMarketsResponseSchema,
  HyperCoreClearinghouseResponseSchema,
  HyperCoreOrderResponseSchema,
  HyperCoreL2BookResponseSchema,
} from '../utils/index.js';

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

/** Imported from validation - re-export for local use */
import type { HyperCorePosition, HyperCoreMarket } from '../utils/index.js';

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
    // Default RPC endpoints are the official Hyperliquid endpoints
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

    return await this.walletClient.writeContract({
      chain: hyperliquidChain,
      account: this.account,
      address: token,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender, amount],
    });
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

    const messageId = await this.walletClient.writeContract({
      chain: hyperliquidChain,
      account: this.account,
      address: params.ccipRouter,
      abi: CCIP_ROUTER_ABI,
      functionName: 'ccipSend',
      args: [params.sourceChainSelector, message],
      value: fee,
    });

    return { messageId, fee };
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

    const json = await response.json();
    const data = HyperCoreMarketsResponseSchema.parse(json);
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

    const json = await response.json();
    const data = HyperCoreClearinghouseResponseSchema.parse(json);
    return data.assetPositions.map(ap => ap.position);
  }

  /**
   * Place an order on HyperCore orderbook
   * Uses Hyperliquid's EIP-712 typed data signing for L1 actions
   */
  async placeOrder(order: HyperCoreOrder): Promise<{ status: string; response?: Record<string, unknown> }> {
    if (!this.account) {
      throw new Error('Wallet not initialized');
    }

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

    const json = await response.json();
    const result = HyperCoreOrderResponseSchema.parse(json);
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

    const json = await response.json();
    return HyperCoreL2BookResponseSchema.parse(json);
  }

  /**
   * Get mid price for a coin
   */
  async getMidPrice(coin: string): Promise<number> {
    const book = await this.getOrderbook(coin);
    if (book.levels.length < 2) {
      throw new Error('Orderbook not available - insufficient levels');
    }

    const bidLevel = book.levels[0]?.[0];
    const askLevel = book.levels[1]?.[0];
    
    if (!bidLevel?.px || !askLevel?.px) {
      throw new Error('Orderbook has no bid or ask prices');
    }

    const bestBid = parseFloat(bidLevel.px);
    const bestAsk = parseFloat(askLevel.px);

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

  /**
   * Sign a HyperCore action using EIP-712 typed data signing
   * Follows Hyperliquid's L1 action signing specification
   */
  private async signHyperCoreAction(_action: Record<string, unknown>, timestamp: number): Promise<{ r: string; s: string; v: number }> {
    if (!this.account || !this.walletClient) {
      throw new Error('Wallet not initialized');
    }

    // Hyperliquid uses EIP-712 typed data signing with a specific domain
    // The domain matches their L1 action signing specification
    const domain = {
      name: 'HyperliquidSignTransaction',
      version: '1',
      chainId: 1337, // Hyperliquid uses chainId 1337 for L1 action signing (not 998 which is HyperEVM)
      verifyingContract: '0x0000000000000000000000000000000000000000' as Address,
    } as const;

    // Hyperliquid's L1 action type definition
    const types = {
      'HyperliquidTransaction:Approve': [
        { name: 'hyperliquidChain', type: 'string' },
        { name: 'signatureChainId', type: 'uint64' },
        { name: 'nonce', type: 'uint64' },
      ],
      Agent: [
        { name: 'source', type: 'string' },
        { name: 'connectionId', type: 'bytes32' },
      ],
    } as const;

    // Create the message to sign
    const message = {
      hyperliquidChain: 'Mainnet',
      signatureChainId: BigInt(1337),
      nonce: BigInt(timestamp),
    };

    // Sign using EIP-712 typed data
    const signature = await this.walletClient.signTypedData({
      account: this.account,
      domain,
      types,
      primaryType: 'HyperliquidTransaction:Approve',
      message,
    });

    // Parse the signature into r, s, v components
    // Signature format: 0x + r (64 chars) + s (64 chars) + v (2 chars)
    const r = signature.slice(0, 66);
    const s = `0x${signature.slice(66, 130)}`;
    const v = parseInt(signature.slice(130, 132), 16);

    return { r, s, v };
  }
}

// ============ Factory ============

export function createHyperliquidClient(config?: HyperliquidClientConfig): HyperliquidClient {
  return new HyperliquidClient(config);
}

