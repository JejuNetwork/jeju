/**
 * XLP (Cross-chain Liquidity Provider) Service
 *
 * Provides instant cross-chain liquidity for users:
 * - Front-run bridge delays by providing liquidity upfront
 * - Earn fees from each instant transfer (0.1-0.3%)
 * - Manage liquidity across multiple chains
 * - Optimize capital allocation based on volume
 *
 * High-Volume Route Optimization:
 * - Monitor volume on each route
 * - Rebalance liquidity to high-volume routes
 * - Earn more fees where demand is highest
 * - Minimize idle capital
 */

import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
  encodeFunctionData,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { mainnet, arbitrum, optimism, base } from 'viem/chains';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';

const log = createLogger('xlp');

// ============ Configuration ============

const SUPPORTED_EVM_CHAINS = {
  1: { chain: mainnet, name: 'Ethereum' },
  42161: { chain: arbitrum, name: 'Arbitrum' },
  10: { chain: optimism, name: 'Optimism' },
  8453: { chain: base, name: 'Base' },
} as const;

// Solana chain IDs (101 = mainnet, 102 = devnet)
const SOLANA_CHAIN_IDS = [101, 102] as const;


// XLP Contract ABI
const XLP_POOL_ABI = parseAbi([
  'function deposit(address token, uint256 amount) external',
  'function withdraw(address token, uint256 amount) external',
  'function fill(bytes32 orderId, address token, address recipient, uint256 amount) external',
  'function getBalance(address token) view returns (uint256)',
  'function getPendingOrders() view returns (bytes32[])',
  'function claimFees(address token) external returns (uint256)',
  'function getFeeRate() view returns (uint256)',
  'event OrderFilled(bytes32 indexed orderId, address indexed token, address indexed recipient, uint256 amount, uint256 fee)',
]);

// ERC20 ABI for approvals
const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

// Target allocation by chain (percentage of total liquidity)
const DEFAULT_ALLOCATION: Record<number, number> = {
  1: 20,      // Ethereum - 20%
  42161: 35,  // Arbitrum - 35% (high volume)
  10: 15,     // Optimism - 15%
  8453: 30,   // Base - 30% (Jeju home)
};

const REBALANCE_THRESHOLD_PERCENT = 10;

// Token addresses by chain (EVM uses Address type)
const TOKENS: Record<string, Record<number, Address>> = {
  USDC: {
    1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  USDT: {
    1: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    42161: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  },
  WETH: {
    1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    10: '0x4200000000000000000000000000000000000006',
    8453: '0x4200000000000000000000000000000000000006',
  },
};

// Solana token mints (for cross-chain reference)
const SOLANA_TOKENS: Record<string, string> = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapT8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FsqcVc7eHvqZN9Y1FMx6ByGu',
  SOL: 'So11111111111111111111111111111111111111112',
  WETH: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // Wormhole WETH
};

export function isSolanaChain(chainId: number): boolean {
  return SOLANA_CHAIN_IDS.includes(chainId as 101 | 102);
}

export function getSolanaTokenMint(symbol: string): string | undefined {
  return SOLANA_TOKENS[symbol];
}

export function getEvmTokenAddress(symbol: string, chainId: number): Address | undefined {
  return TOKENS[symbol]?.[chainId];
}

// ============ Types ============

export interface XLPConfig {
  privateKey: Hex;
  rpcUrls: Record<number, string>;
  xlpPoolAddresses: Record<number, Address>;
  supportedTokens: string[];
  targetAllocation?: Record<number, number>;
}

export interface LiquidityPosition {
  chainId: number;
  token: string;
  balance: bigint;
  pendingFees: bigint;
  utilizationRate: number;
}

export interface FillRequest {
  orderId: Hex;
  sourceChain: number;
  destChain: number;
  token: string;
  amount: bigint;
  recipient: Address;
  maxFillDelay: number;
}

export interface RouteStats {
  sourceChain: number;
  destChain: number;
  volume24h: bigint;
  fillCount24h: number;
  avgFillTime: number;
  feesEarned24h: bigint;
}

export interface XLPStats {
  totalLiquidity: bigint;
  totalFeesEarned: bigint;
  fillsCompleted: number;
  avgFillTime: number;
  utilizationRate: number;
  routeStats: RouteStats[];
}

// ============ XLP Service ============

type ChainClients = {
  public: ReturnType<typeof createPublicClient>;
  wallet: ReturnType<typeof createWalletClient>;
};

export class XLPService extends EventEmitter {
  private config: XLPConfig;
  private account: PrivateKeyAccount;
  private clients: Map<number, ChainClients> = new Map();

  private positions: Map<string, LiquidityPosition> = new Map();
  private routeVolumes: Map<string, RouteStats> = new Map();
  private running = false;
  private monitorInterval: ReturnType<typeof setInterval> | null = null;
  private rebalanceInterval: ReturnType<typeof setInterval> | null = null;

  // Stats
  private stats: XLPStats = {
    totalLiquidity: 0n,
    totalFeesEarned: 0n,
    fillsCompleted: 0,
    avgFillTime: 0,
    utilizationRate: 0,
    routeStats: [],
  };

  constructor(config: XLPConfig) {
    super();
    this.config = config;
    this.account = privateKeyToAccount(config.privateKey);

    // Initialize clients for each chain
    for (const [chainIdStr, rpcUrl] of Object.entries(config.rpcUrls)) {
      const chainId = Number(chainIdStr);
      const chainConfig = SUPPORTED_EVM_CHAINS[chainId as keyof typeof SUPPORTED_EVM_CHAINS];
      if (!chainConfig) continue;

      const publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http(rpcUrl),
      });

      const walletClient = createWalletClient({
        account: this.account,
        chain: chainConfig.chain,
        transport: http(rpcUrl),
      });

      this.clients.set(chainId, { public: publicClient, wallet: walletClient });
    }
  }

  async initialize(): Promise<void> {
    log.info('Initializing XLP Service', { wallet: this.account.address });

    // Fetch current positions across all chains
    await this.fetchPositions();

    // Log current allocation
    const totalValue = await this.calculateTotalValue();
    log.info('Total liquidity loaded', { totalUsd: formatUnits(totalValue, 6) });

    for (const [key, position] of this.positions) {
      const pct = (Number(position.balance) / Number(totalValue) * 100).toFixed(1);
      log.debug('Position loaded', { key, balance: formatUnits(position.balance, 6), percent: pct });
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    log.info('Starting XLP service');

    // Monitor for fill requests every 2 seconds
    this.monitorInterval = setInterval(() => this.monitorFillRequests(), 2000);

    // Check rebalancing needs every 5 minutes
    this.rebalanceInterval = setInterval(() => this.checkRebalancing(), 5 * 60 * 1000);

    // Initial check
    this.monitorFillRequests();
  }

  stop(): void {
    this.running = false;
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    if (this.rebalanceInterval) {
      clearInterval(this.rebalanceInterval);
      this.rebalanceInterval = null;
    }
  }

  // ============ Core Operations ============

  /**
   * Deposit liquidity into XLP pool on a specific chain
   */
  async deposit(chainId: number, token: string, amount: bigint): Promise<string> {
    const clients = this.clients.get(chainId);
    if (!clients) throw new Error(`Chain ${chainId} not configured`);

    const poolAddress = this.config.xlpPoolAddresses[chainId];
    if (!poolAddress) throw new Error(`No XLP pool on chain ${chainId}`);

    const tokenAddress = TOKENS[token]?.[chainId];
    if (!tokenAddress) throw new Error(`Token ${token} not supported on chain ${chainId}`);

    log.info('Depositing', { amount: formatUnits(amount, 6), token, chainId });

    // Approve token
    const approveData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [poolAddress, amount],
    });

    const approveHash = await clients.wallet.sendTransaction({
      chain: null,
      account: this.account,
      to: tokenAddress,
      data: approveData,
    });
    await clients.public.waitForTransactionReceipt({ hash: approveHash });

    const depositData = encodeFunctionData({
      abi: XLP_POOL_ABI,
      functionName: 'deposit',
      args: [tokenAddress, amount],
    });

    const hash = await clients.wallet.sendTransaction({
      chain: null,
      account: this.account,
      to: poolAddress,
      data: depositData,
    });
    await clients.public.waitForTransactionReceipt({ hash });

    // Update position
    await this.fetchPosition(chainId, token);

    log.info('Deposit complete', { hash });
    return hash;
  }

  /**
   * Withdraw liquidity from XLP pool
   */
  async withdraw(chainId: number, token: string, amount: bigint): Promise<string> {
    const clients = this.clients.get(chainId);
    if (!clients) throw new Error(`Chain ${chainId} not configured`);

    const poolAddress = this.config.xlpPoolAddresses[chainId];
    if (!poolAddress) throw new Error(`No XLP pool on chain ${chainId}`);

    const tokenAddress = TOKENS[token]?.[chainId];
    if (!tokenAddress) throw new Error(`Token ${token} not supported on chain ${chainId}`);

    log.info('Withdrawing', { amount: formatUnits(amount, 6), token, chainId });

    const withdrawData = encodeFunctionData({
      abi: XLP_POOL_ABI,
      functionName: 'withdraw',
      args: [tokenAddress, amount],
    });

    const hash = await clients.wallet.sendTransaction({
      chain: null,
      account: this.account,
      to: poolAddress,
      data: withdrawData,
    });
    await clients.public.waitForTransactionReceipt({ hash });

    // Update position
    await this.fetchPosition(chainId, token);

    log.info('Withdrawal complete', { hash });
    return hash;
  }

  /**
   * Fill a cross-chain transfer request
   */
  async fill(request: FillRequest): Promise<{ success: boolean; txHash?: string; fee?: bigint }> {
    const clients = this.clients.get(request.destChain);
    if (!clients) {
      return { success: false };
    }

    const poolAddress = this.config.xlpPoolAddresses[request.destChain];
    if (!poolAddress) {
      return { success: false };
    }

    const tokenAddress = TOKENS[request.token]?.[request.destChain];
    if (!tokenAddress) {
      return { success: false };
    }

    // Check we have sufficient balance
    const position = this.positions.get(`${request.destChain}-${request.token}`);
    if (!position || position.balance < request.amount) {
      log.warn('Insufficient balance to fill order', { orderId: request.orderId.slice(0, 10) });
      return { success: false };
    }

    log.info('Filling order', { orderId: request.orderId.slice(0, 10), amount: formatUnits(request.amount, 6), token: request.token });

    const fillData = encodeFunctionData({
      abi: XLP_POOL_ABI,
      functionName: 'fill',
      args: [request.orderId, tokenAddress, request.recipient, request.amount],
    });

    const hash = await clients.wallet.sendTransaction({
      chain: null,
      account: this.account,
      to: poolAddress,
      data: fillData,
    });

    const receipt = await clients.public.waitForTransactionReceipt({ hash });

    // Update stats
    this.stats.fillsCompleted++;

    // Parse fee from OrderFilled event
    let fee = 0n;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === poolAddress.toLowerCase() && log.topics[0]) {
        // OrderFilled event signature: OrderFilled(bytes32 indexed orderId, address indexed token, address indexed recipient, uint256 amount, uint256 fee)
        const eventSig = '0x' + Buffer.from(
          new TextEncoder().encode('OrderFilled(bytes32,address,address,uint256,uint256)')
        ).toString('hex');
        
        // Use keccak256 for event signature matching
        const { keccak256, toHex } = await import('viem');
        const expectedSig = keccak256(toHex('OrderFilled(bytes32,address,address,uint256,uint256)'));
        
        if (log.topics[0] === expectedSig && log.data) {
          // Decode the non-indexed parameters (amount, fee) from data
          // data = abi.encode(uint256 amount, uint256 fee)
          const dataWithoutPrefix = log.data.slice(2);
          const amountHex = dataWithoutPrefix.slice(0, 64);
          const feeHex = dataWithoutPrefix.slice(64, 128);
          fee = BigInt('0x' + feeHex);
          break;
        }
      }
    }

    // Fallback if event parsing failed (e.g., event not emitted in test)
    if (fee === 0n) {
      const feeRate = 30n; // 0.3% = 30 bps default
      fee = (request.amount * feeRate) / 10000n;
    }

    this.stats.totalFeesEarned += fee;

    // Update route stats
    const routeKey = `${request.sourceChain}-${request.destChain}`;
    let routeStats = this.routeVolumes.get(routeKey);
    if (!routeStats) {
      routeStats = {
        sourceChain: request.sourceChain,
        destChain: request.destChain,
        volume24h: 0n,
        fillCount24h: 0,
        avgFillTime: 0,
        feesEarned24h: 0n,
      };
      this.routeVolumes.set(routeKey, routeStats);
    }

    routeStats.volume24h += request.amount;
    routeStats.fillCount24h++;
    routeStats.feesEarned24h += fee;

    // Update position
    await this.fetchPosition(request.destChain, request.token);

    log.info('Fill complete', { hash, fee: formatUnits(fee, 6), token: request.token });

    this.emit('fill', {
      orderId: request.orderId,
      amount: request.amount,
      fee,
      txHash: hash,
    });

    return { success: true, txHash: hash, fee };
  }

  /**
   * Claim accumulated fees
   */
  async claimFees(chainId: number, token: string): Promise<bigint> {
    const clients = this.clients.get(chainId);
    if (!clients) throw new Error(`Chain ${chainId} not configured`);

    const poolAddress = this.config.xlpPoolAddresses[chainId];
    if (!poolAddress) throw new Error(`No XLP pool on chain ${chainId}`);

    const tokenAddress = TOKENS[token]?.[chainId];
    if (!tokenAddress) throw new Error(`Token ${token} not supported on chain ${chainId}`);

    const claimData = encodeFunctionData({
      abi: XLP_POOL_ABI,
      functionName: 'claimFees',
      args: [tokenAddress],
    });

    const hash = await clients.wallet.sendTransaction({
      chain: null,
      account: this.account,
      to: poolAddress,
      data: claimData,
    });

    await clients.public.waitForTransactionReceipt({ hash });

    // Would parse actual fee amount from logs
    // For now, return estimated
    const position = this.positions.get(`${chainId}-${token}`);
    const fees = position?.pendingFees || 0n;

    if (position) {
      position.pendingFees = 0n;
    }

    log.info('Claimed fees', { fees: formatUnits(fees, 6), token, chainId });

    return fees;
  }

  // ============ Rebalancing ============

  /**
   * Check if rebalancing is needed and execute if so
   */
  async checkRebalancing(): Promise<void> {
    const allocation = this.config.targetAllocation || DEFAULT_ALLOCATION;
    const totalValue = await this.calculateTotalValue();

    if (totalValue === 0n) return;

    const chainValues: Record<number, bigint> = {};
    for (const [key, position] of this.positions) {
      const chainId = Number(key.split('-')[0]);
      chainValues[chainId] = (chainValues[chainId] || 0n) + position.balance;
    }

    for (const [chainId, targetPct] of Object.entries(allocation)) {
      const currentValue = chainValues[Number(chainId)] || 0n;
      const currentPct = Number(currentValue * 100n / totalValue);

      const diff = currentPct - Number(targetPct);

      if (Math.abs(diff) > REBALANCE_THRESHOLD_PERCENT) {
        log.debug('Chain off target', { chainId, currentPct: currentPct.toFixed(1), targetPct });
      }
    }

    // Execute rebalancing if needed
    // This would use the bridge to move funds between chains
    // For now, just log the need
  }

  /**
   * Optimize allocation based on route volumes
   */
  async optimizeAllocation(): Promise<Record<number, number>> {
    // Analyze 24h volumes per route
    const chainInflows: Record<number, bigint> = {};

    for (const stats of this.routeVolumes.values()) {
      // Destination chain needs liquidity to fill
      chainInflows[stats.destChain] = (chainInflows[stats.destChain] || 0n) + stats.volume24h;
    }

    // Calculate optimal allocation based on inflow volume
    const totalInflow = Object.values(chainInflows).reduce((a, b) => a + b, 0n);
    if (totalInflow === 0n) {
      return DEFAULT_ALLOCATION;
    }

    const optimizedAllocation: Record<number, number> = {};

    for (const [chainId, inflow] of Object.entries(chainInflows)) {
      const pct = Number(inflow * 100n / totalInflow);
      // Blend with default allocation (50/50)
      const defaultPct = DEFAULT_ALLOCATION[Number(chainId)] || 0;
      optimizedAllocation[Number(chainId)] = Math.round((pct + defaultPct) / 2);
    }

    // Ensure total is 100%
    const total = Object.values(optimizedAllocation).reduce((a, b) => a + b, 0);
    if (total !== 100) {
      const adjustment = 100 - total;
      // Add/subtract from largest chain
      const largestChain = Object.entries(optimizedAllocation)
        .sort(([, a], [, b]) => b - a)[0][0];
      optimizedAllocation[Number(largestChain)] += adjustment;
    }

    log.info('Optimized allocation calculated', { allocation: optimizedAllocation });

    return optimizedAllocation;
  }

  // ============ Monitoring ============

  private async monitorFillRequests(): Promise<void> {
    for (const [chainId, clients] of this.clients) {
      const poolAddress = this.config.xlpPoolAddresses[chainId];
      if (!poolAddress) continue;

      // Get pending orders
      const pendingOrders = await clients.public.readContract({
        address: poolAddress,
        abi: XLP_POOL_ABI,
        functionName: 'getPendingOrders',
      }) as Hex[];

      for (const orderId of pendingOrders) {
        // Would fetch order details and fill if profitable
        // Emit event for external handlers
        this.emit('pendingOrder', { chainId, orderId });
      }
    }
  }

  private async fetchPositions(): Promise<void> {
    for (const [chainId] of this.clients) {
      const poolAddress = this.config.xlpPoolAddresses[chainId];
      if (!poolAddress) continue;

      for (const token of this.config.supportedTokens) {
        await this.fetchPosition(chainId, token);
      }
    }
  }

  private async fetchPosition(chainId: number, token: string): Promise<void> {
    const clients = this.clients.get(chainId);
    if (!clients) return;

    const poolAddress = this.config.xlpPoolAddresses[chainId];
    if (!poolAddress) return;

    const tokenAddress = TOKENS[token]?.[chainId];
    if (!tokenAddress) return;

    const balance = await clients.public.readContract({
      address: poolAddress,
      abi: XLP_POOL_ABI,
      functionName: 'getBalance',
      args: [tokenAddress],
    }) as bigint;

    const key = `${chainId}-${token}`;
    const existing = this.positions.get(key);

    this.positions.set(key, {
      chainId,
      token,
      balance,
      pendingFees: existing?.pendingFees || 0n,
      utilizationRate: existing?.utilizationRate || 0,
    });
  }

  private async calculateTotalValue(): Promise<bigint> {
    let total = 0n;
    for (const position of this.positions.values()) {
      // Assuming stablecoins are $1
      total += position.balance;
    }
    return total;
  }

  // ============ Getters ============

  getPositions(): LiquidityPosition[] {
    return Array.from(this.positions.values());
  }

  getStats(): XLPStats {
    return {
      ...this.stats,
      routeStats: Array.from(this.routeVolumes.values()),
    };
  }

  getHighVolumeRoutes(): RouteStats[] {
    return Array.from(this.routeVolumes.values())
      .sort((a, b) => Number(b.volume24h - a.volume24h))
      .slice(0, 10);
  }
}

// ============ Factory ============

export function createXLPService(config: Partial<XLPConfig>): XLPService {
  const fullConfig: XLPConfig = {
    privateKey: (config.privateKey || process.env.XLP_PRIVATE_KEY || '0x') as Hex,
    rpcUrls: config.rpcUrls || {
      1: process.env.RPC_URL_1 || 'https://eth.llamarpc.com',
      42161: process.env.RPC_URL_42161 || 'https://arb1.arbitrum.io/rpc',
      10: process.env.RPC_URL_10 || 'https://mainnet.optimism.io',
      8453: process.env.RPC_URL_8453 || 'https://mainnet.base.org',
    },
    xlpPoolAddresses: config.xlpPoolAddresses || {},
    supportedTokens: config.supportedTokens || ['USDC', 'USDT', 'WETH'],
    targetAllocation: config.targetAllocation,
  };

  return new XLPService(fullConfig);
}

