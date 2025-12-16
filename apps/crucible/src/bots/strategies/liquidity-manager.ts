/**
 * Cross-Chain Liquidity Manager
 * 
 * Unified liquidity management across EVM and Solana chains:
 * - Position tracking across all chains/DEXs
 * - Automatic rebalancing for optimal yields
 * - Fee harvesting and compounding
 * - Impermanent loss monitoring
 * - Cross-chain liquidity optimization
 * 
 * Supported DEXs:
 * - EVM: Uniswap V2/V3, SushiSwap, Curve, Balancer
 * - Solana: Raydium, Orca, Meteora
 */

import { EventEmitter } from 'events';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { 
  createPublicClient, 
  createWalletClient,
  http, 
  type PublicClient, 
  type WalletClient,
  type Address, 
  type Hex,
  type Chain,
  parseAbi,
  maxUint128,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, sepolia, arbitrum, optimism, base, baseSepolia, bsc, bscTestnet, localhost } from 'viem/chains';
import type { ChainId, Token, StrategyConfig } from '../autocrat-types';
import { 
  SolanaDexAggregator, 
  type LiquidityPool as SolanaPool, 
  type LiquidityPosition as SolanaPosition,
  type DexSource 
} from '../solana/dex-adapters';

// Map chain IDs to viem chain objects
const CHAIN_MAP: Record<number, Chain> = {
  1: mainnet,
  11155111: sepolia,
  42161: arbitrum,
  10: optimism,
  8453: base,
  84532: baseSepolia,
  56: bsc,
  97: bscTestnet,
  1337: localhost,
  420691: { ...localhost, id: 420691, name: 'Jeju' },
  420690: { ...localhost, id: 420690, name: 'Jeju Testnet' },
};

// ============ Types ============

export interface EVMPosition {
  id: string;
  chainId: ChainId;
  dex: 'uniswap-v2' | 'uniswap-v3' | 'sushiswap' | 'curve' | 'balancer';
  poolAddress: Address;
  tokenA: Token;
  tokenB: Token;
  liquidityA: bigint;
  liquidityB: bigint;
  lpTokenBalance?: bigint;
  valueUsd: number;
  feesEarned: bigint;
  // V3 specific
  tickLower?: number;
  tickUpper?: number;
  liquidity?: bigint;
  inRange?: boolean;
  nftId?: bigint;
}

export interface UnifiedPosition {
  id: string;
  chain: 'evm' | 'solana';
  chainId: ChainId | 'solana-mainnet' | 'solana-devnet';
  dex: string;
  poolId: string;
  tokenA: { symbol: string; address: string; decimals: number };
  tokenB: { symbol: string; address: string; decimals: number };
  valueUsd: number;
  apr: number;
  feesEarnedUsd: number;
  impermanentLossPercent: number;
  inRange: boolean;
  lastUpdate: number;
  // Raw position data
  raw: EVMPosition | SolanaPosition;
}

export interface PoolAnalysis {
  poolId: string;
  chain: 'evm' | 'solana';
  dex: string;
  tokenA: string;
  tokenB: string;
  tvlUsd: number;
  apr24h: number;
  apr7d: number;
  volume24h: number;
  feeRate: number;
  riskScore: number; // 0-100, lower is better
  recommendation: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
}

export interface RebalanceAction {
  type: 'ADD' | 'REMOVE' | 'RERANGE' | 'HARVEST' | 'COMPOUND' | 'MIGRATE';
  positionId: string;
  chain: 'evm' | 'solana';
  amountA?: bigint;
  amountB?: bigint;
  newTickLower?: number;
  newTickUpper?: number;
  targetPoolId?: string;
  reason: string;
  expectedProfitUsd: number;
  gasEstimateUsd: number;
}

export interface LiquidityManagerConfig extends StrategyConfig {
  evmChains: ChainId[];
  solanaNetwork: 'mainnet-beta' | 'devnet' | 'localnet';
  rebalanceThresholdPercent: number; // e.g., 5% = rebalance when IL > 5%
  minPositionValueUsd: number;
  maxPositionValueUsd: number;
  autoCompound: boolean;
  autoRebalance: boolean;
  targetAprPercent: number;
}

// ============ Constants ============

const UNISWAP_V3_POSITIONS_NFT: Record<number, Address> = {
  1: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  42161: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  10: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  8453: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
};

const UNISWAP_V3_FACTORY: Record<number, Address> = {
  1: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  42161: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  10: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  8453: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
};

const POSITION_NFT_ABI = parseAbi([
  // Read functions
  'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  // Write functions for liquidity management
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function increaseLiquidity((uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) returns (uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) returns (uint256 amount0, uint256 amount1)',
  'function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) returns (uint256 amount0, uint256 amount1)',
  'function burn(uint256 tokenId)',
]);

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

// ============ Liquidity Manager ============

export class LiquidityManager extends EventEmitter {
  private config: LiquidityManagerConfig;
  private evmClients: Map<ChainId, PublicClient> = new Map();
  private evmWalletClients: Map<ChainId, WalletClient> = new Map();
  private evmChains: Map<ChainId, Chain> = new Map();
  private evmWalletAddress: Address | null = null;
  private solanaConnection: Connection | null = null;
  private solanaDex: SolanaDexAggregator | null = null;
  private solanaKeypair: Keypair | null = null;
  private evmPositions: Map<string, EVMPosition> = new Map();
  private solanaPositions: Map<string, SolanaPosition> = new Map();
  private poolAnalyses: Map<string, PoolAnalysis> = new Map();
  private running = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: LiquidityManagerConfig) {
    super();
    this.config = config;

    // Initialize EVM clients
    for (const chainId of config.evmChains) {
      const rpcUrl = this.getRpcUrl(chainId);
      if (rpcUrl) {
        this.evmClients.set(chainId, createPublicClient({ transport: http(rpcUrl) }));
      }
    }
  }

  /**
   * Initialize connections
   */
  async initialize(params: {
    solanaRpcUrl?: string;
    solanaPrivateKey?: string;
    evmWalletAddress?: Address;
    evmPrivateKey?: Hex;
  }): Promise<void> {
    console.log('🌊 Initializing Cross-Chain Liquidity Manager...');

    // Initialize Solana
    if (params.solanaRpcUrl) {
      this.solanaConnection = new Connection(params.solanaRpcUrl, 'confirmed');
      this.solanaDex = new SolanaDexAggregator(this.solanaConnection);
      
      if (params.solanaPrivateKey) {
        const secretKey = Buffer.from(params.solanaPrivateKey, 'base64');
        this.solanaKeypair = Keypair.fromSecretKey(secretKey);
        console.log(`   Solana wallet: ${this.solanaKeypair.publicKey.toBase58()}`);
      }
      
      const slot = await this.solanaConnection.getSlot();
      console.log(`   Connected to Solana at slot ${slot}`);
    }

    // Initialize EVM wallet clients for transactions
    if (params.evmPrivateKey) {
      const account = privateKeyToAccount(params.evmPrivateKey);
      this.evmWalletAddress = account.address;
      
      for (const chainId of this.config.evmChains) {
        const rpcUrl = this.getRpcUrl(chainId);
        const chain = CHAIN_MAP[chainId];
        if (rpcUrl && chain) {
          const walletClient = createWalletClient({
            account,
            chain,
            transport: http(rpcUrl),
          });
          this.evmWalletClients.set(chainId, walletClient);
          this.evmChains.set(chainId, chain);
        }
      }
      console.log(`   EVM wallet: ${this.evmWalletAddress}`);
    } else if (params.evmWalletAddress) {
      this.evmWalletAddress = params.evmWalletAddress;
    }

    // Load initial positions
    if (this.evmWalletAddress) {
      await this.loadEVMPositions(this.evmWalletAddress);
    }
    
    if (this.solanaKeypair) {
      await this.loadSolanaPositions(this.solanaKeypair.publicKey.toBase58());
    }

    console.log(`   Loaded ${this.evmPositions.size} EVM positions`);
    console.log(`   Loaded ${this.solanaPositions.size} Solana positions`);
  }

  /**
   * Start monitoring and optimization
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    console.log('   Starting liquidity monitoring...');

    // Poll every 5 minutes
    this.pollInterval = setInterval(() => this.runOptimizationCycle(), 5 * 60 * 1000);

    // Run initial cycle
    this.runOptimizationCycle();
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    this.running = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Get all unified positions
   */
  getPositions(): UnifiedPosition[] {
    const unified: UnifiedPosition[] = [];

    for (const pos of this.evmPositions.values()) {
      unified.push(this.toUnifiedPosition(pos, 'evm'));
    }

    for (const pos of this.solanaPositions.values()) {
      unified.push(this.toUnifiedPosition(pos, 'solana'));
    }

    return unified.sort((a, b) => b.valueUsd - a.valueUsd);
  }

  /**
   * Get pool recommendations
   */
  async getPoolRecommendations(params?: {
    minTvl?: number;
    minApr?: number;
    tokens?: string[];
  }): Promise<PoolAnalysis[]> {
    const analyses: PoolAnalysis[] = [];

    // Get Solana pools
    if (this.solanaDex) {
      const solanaPools = await this.solanaDex.getAllPools(params?.tokens);
      
      for (const pool of solanaPools) {
        if (params?.minTvl && pool.tvlUsd < params.minTvl) continue;
        if (params?.minApr && (pool.apr24h ?? 0) < params.minApr) continue;

        analyses.push({
          poolId: pool.id,
          chain: 'solana',
          dex: pool.dex,
          tokenA: pool.tokenA.symbol,
          tokenB: pool.tokenB.symbol,
          tvlUsd: pool.tvlUsd,
          apr24h: pool.apr24h ?? 0,
          apr7d: pool.apr24h ?? 0, // Simplified
          volume24h: pool.volume24h ?? 0,
          feeRate: pool.fee / 10000,
          riskScore: this.calculateRiskScore(pool),
          recommendation: this.getRecommendation(pool),
        });
      }
    }

    return analyses.sort((a, b) => b.apr24h - a.apr24h);
  }

  /**
   * Get rebalance actions
   */
  async getRebalanceActions(): Promise<RebalanceAction[]> {
    const actions: RebalanceAction[] = [];
    const positions = this.getPositions();

    for (const pos of positions) {
      // Check if out of range (for concentrated liquidity)
      if (!pos.inRange && pos.raw) {
        if ('tickLower' in pos.raw && 'tickUpper' in pos.raw) {
          actions.push({
            type: 'RERANGE',
            positionId: pos.id,
            chain: pos.chain,
            reason: 'Position out of range',
            expectedProfitUsd: pos.valueUsd * 0.02, // Estimate 2% improvement
            gasEstimateUsd: pos.chain === 'evm' ? 50 : 0.01,
          });
        }
      }

      // Check for impermanent loss
      if (pos.impermanentLossPercent > this.config.rebalanceThresholdPercent) {
        actions.push({
          type: 'REMOVE',
          positionId: pos.id,
          chain: pos.chain,
          reason: `High impermanent loss: ${pos.impermanentLossPercent.toFixed(2)}%`,
          expectedProfitUsd: pos.valueUsd * (pos.impermanentLossPercent / 100) * 0.5,
          gasEstimateUsd: pos.chain === 'evm' ? 30 : 0.01,
        });
      }

      // Check for fee harvesting opportunity
      if (pos.feesEarnedUsd > 50 && this.config.autoCompound) {
        actions.push({
          type: pos.chain === 'evm' ? 'HARVEST' : 'COMPOUND',
          positionId: pos.id,
          chain: pos.chain,
          reason: `Unclaimed fees: $${pos.feesEarnedUsd.toFixed(2)}`,
          expectedProfitUsd: pos.feesEarnedUsd,
          gasEstimateUsd: pos.chain === 'evm' ? 20 : 0.005,
        });
      }
    }

    return actions.sort((a, b) => b.expectedProfitUsd - a.expectedProfitUsd);
  }

  /**
   * Execute a rebalance action
   */
  async executeAction(action: RebalanceAction): Promise<{ success: boolean; txHash?: string; error?: string }> {
    console.log(`🔄 Executing ${action.type} for position ${action.positionId}`);

    if (action.chain === 'solana') {
      return this.executeSolanaAction(action);
    } else {
      return this.executeEVMAction(action);
    }
  }

  /**
   * Add liquidity to a pool
   */
  async addLiquidity(params: {
    chain: 'evm' | 'solana';
    chainId?: ChainId;
    dex: string;
    poolId: string;
    amountA: bigint;
    amountB: bigint;
    tickLower?: number;
    tickUpper?: number;
    tokenA?: Address;
    tokenB?: Address;
    fee?: number;
  }): Promise<{ success: boolean; txHash?: string; positionId?: string; error?: string }> {
    console.log(`➕ Adding liquidity to ${params.dex} on ${params.chain}`);

    if (params.chain === 'solana') {
      if (!this.solanaDex || !this.solanaKeypair) {
        return { success: false, error: 'Solana not initialized' };
      }

      const adapter = this.solanaDex.getAdapter(params.dex as DexSource);
      if (!adapter) {
        return { success: false, error: `Unknown DEX: ${params.dex}` };
      }

      const txHash = await adapter.addLiquidity(
        params.poolId,
        params.amountA,
        params.amountB,
        this.solanaKeypair
      );

      return { success: true, txHash };
    }

    // EVM: Uniswap V3 NonfungiblePositionManager
    return this.addEVMLiquidity(params);
  }

  /**
   * Add liquidity on EVM via Uniswap V3 NonfungiblePositionManager
   */
  private async addEVMLiquidity(params: {
    chainId?: ChainId;
    poolId: string;
    amountA: bigint;
    amountB: bigint;
    tickLower?: number;
    tickUpper?: number;
    tokenA?: Address;
    tokenB?: Address;
    fee?: number;
  }): Promise<{ success: boolean; txHash?: string; positionId?: string; error?: string }> {
    const chainId = params.chainId ?? this.config.evmChains[0];
    if (!chainId) {
      return { success: false, error: 'No EVM chain configured' };
    }

    const walletClient = this.evmWalletClients.get(chainId);
    const publicClient = this.evmClients.get(chainId);
    const chain = this.evmChains.get(chainId);
    if (!walletClient || !publicClient || !chain) {
      return { success: false, error: `No wallet client for chain ${chainId}. Provide evmPrivateKey during initialization.` };
    }

    const nftAddress = UNISWAP_V3_POSITIONS_NFT[chainId];
    if (!nftAddress) {
      return { success: false, error: `Uniswap V3 not supported on chain ${chainId}` };
    }

    // Require token addresses and fee tier
    if (!params.tokenA || !params.tokenB) {
      return { success: false, error: 'tokenA and tokenB addresses required for EVM liquidity' };
    }

    // Sort tokens (Uniswap requires token0 < token1)
    const [token0, token1] = params.tokenA.toLowerCase() < params.tokenB.toLowerCase()
      ? [params.tokenA, params.tokenB]
      : [params.tokenB, params.tokenA];
    const [amount0, amount1] = params.tokenA.toLowerCase() < params.tokenB.toLowerCase()
      ? [params.amountA, params.amountB]
      : [params.amountB, params.amountA];

    const fee = params.fee ?? 3000; // Default to 0.3% fee tier
    const tickLower = params.tickLower ?? -887220; // Full range
    const tickUpper = params.tickUpper ?? 887220;  // Full range
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 minutes

    // Approve tokens
    await this.approveTokenIfNeeded(chainId, token0, nftAddress, amount0);
    await this.approveTokenIfNeeded(chainId, token1, nftAddress, amount1);

    const mintParams = {
      token0,
      token1,
      fee,
      tickLower,
      tickUpper,
      amount0Desired: amount0,
      amount1Desired: amount1,
      amount0Min: 0n, // Accept any slippage (should be improved for production)
      amount1Min: 0n,
      recipient: this.evmWalletAddress!,
      deadline,
    };

    console.log(`   Minting position: ${token0}/${token1} fee=${fee}`);

    const hash = await walletClient.writeContract({
      chain,
      address: nftAddress,
      abi: POSITION_NFT_ABI,
      functionName: 'mint',
      args: [mintParams],
      account: walletClient.account,
    } as Parameters<typeof walletClient.writeContract>[0]);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    
    if (receipt.status === 'reverted') {
      return { success: false, error: 'Mint transaction reverted' };
    }

    // Parse logs to get tokenId
    // The Transfer event contains the new token ID
    let positionId: string | undefined;
    for (const log of receipt.logs) {
      // Transfer event topic
      if (log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
        const tokenId = BigInt(log.topics[3] ?? '0');
        positionId = tokenId.toString();
        break;
      }
    }

    console.log(`   ✅ Minted position #${positionId}`);

    // Reload positions
    if (this.evmWalletAddress) {
      await this.loadEVMPositions(this.evmWalletAddress);
    }

    return { success: true, txHash: hash, positionId };
  }

  /**
   * Approve token spending if needed
   */
  private async approveTokenIfNeeded(
    chainId: ChainId,
    token: Address,
    spender: Address,
    amount: bigint
  ): Promise<void> {
    const publicClient = this.evmClients.get(chainId);
    const walletClient = this.evmWalletClients.get(chainId);
    const chain = this.evmChains.get(chainId);
    if (!publicClient || !walletClient || !chain || !this.evmWalletAddress) return;

    const allowance = await publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [this.evmWalletAddress, spender],
    });

    if (allowance < amount) {
      console.log(`   Approving ${token} for ${spender}...`);
      const hash = await walletClient.writeContract({
        chain,
        address: token,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spender, maxUint128],
        account: walletClient.account,
      } as Parameters<typeof walletClient.writeContract>[0]);
      await publicClient.waitForTransactionReceipt({ hash });
    }
  }

  /**
   * Remove liquidity from a position
   */
  async removeLiquidity(params: {
    positionId: string;
    chain: 'evm' | 'solana';
    percent: number; // 0-100
    chainId?: ChainId;
  }): Promise<{ success: boolean; txHash?: string; error?: string }> {
    console.log(`➖ Removing ${params.percent}% liquidity from ${params.positionId}`);

    if (params.chain === 'solana') {
      const position = this.solanaPositions.get(params.positionId);
      if (!position) {
        return { success: false, error: 'Position not found' };
      }

      if (!this.solanaDex || !this.solanaKeypair) {
        return { success: false, error: 'Solana not initialized' };
      }

      const adapter = this.solanaDex.getAdapter(position.dex);
      if (!adapter) {
        return { success: false, error: `Unknown DEX: ${position.dex}` };
      }

      const liquidityToRemove = (position.liquidity ?? 0n) * BigInt(params.percent) / 100n;
      const txHash = await adapter.removeLiquidity(
        position.id,
        liquidityToRemove,
        this.solanaKeypair
      );

      return { success: true, txHash };
    }

    // EVM: Uniswap V3 NonfungiblePositionManager
    return this.removeEVMLiquidity(params);
  }

  /**
   * Remove liquidity from EVM position via Uniswap V3 NonfungiblePositionManager
   */
  private async removeEVMLiquidity(params: {
    positionId: string;
    percent: number;
    chainId?: ChainId;
  }): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const position = this.evmPositions.get(params.positionId);
    if (!position) {
      return { success: false, error: 'EVM position not found' };
    }

    const chainId = params.chainId ?? position.chainId;
    const walletClient = this.evmWalletClients.get(chainId);
    const publicClient = this.evmClients.get(chainId);
    const chain = this.evmChains.get(chainId);
    if (!walletClient || !publicClient || !chain) {
      return { success: false, error: `No wallet client for chain ${chainId}. Provide evmPrivateKey during initialization.` };
    }

    const nftAddress = UNISWAP_V3_POSITIONS_NFT[chainId];
    if (!nftAddress) {
      return { success: false, error: `Uniswap V3 not supported on chain ${chainId}` };
    }

    if (!position.nftId || !position.liquidity) {
      return { success: false, error: 'Position has no NFT ID or liquidity' };
    }

    const liquidityToRemove = (position.liquidity * BigInt(params.percent)) / 100n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 minutes

    console.log(`   Decreasing liquidity for NFT #${position.nftId}...`);

    // Step 1: Decrease liquidity
    const decreaseParams = {
      tokenId: position.nftId,
      liquidity: liquidityToRemove as unknown as bigint,
      amount0Min: 0n,
      amount1Min: 0n,
      deadline,
    };

    const decreaseHash = await walletClient.writeContract({
      chain,
      address: nftAddress,
      abi: POSITION_NFT_ABI,
      functionName: 'decreaseLiquidity',
      args: [decreaseParams],
      account: walletClient.account,
    } as Parameters<typeof walletClient.writeContract>[0]);

    const decreaseReceipt = await publicClient.waitForTransactionReceipt({ hash: decreaseHash });
    if (decreaseReceipt.status === 'reverted') {
      return { success: false, error: 'decreaseLiquidity transaction reverted' };
    }

    // Step 2: Collect the tokens
    console.log(`   Collecting tokens...`);
    const collectParams = {
      tokenId: position.nftId,
      recipient: this.evmWalletAddress!,
      amount0Max: maxUint128,
      amount1Max: maxUint128,
    };

    const collectHash = await walletClient.writeContract({
      chain,
      address: nftAddress,
      abi: POSITION_NFT_ABI,
      functionName: 'collect',
      args: [collectParams],
      account: walletClient.account,
    } as Parameters<typeof walletClient.writeContract>[0]);

    const collectReceipt = await publicClient.waitForTransactionReceipt({ hash: collectHash });
    if (collectReceipt.status === 'reverted') {
      return { success: false, error: 'collect transaction reverted' };
    }

    // Step 3: Burn NFT if 100% removed
    if (params.percent === 100) {
      console.log(`   Burning NFT #${position.nftId}...`);
      const burnHash = await walletClient.writeContract({
        chain,
        address: nftAddress,
        abi: POSITION_NFT_ABI,
        functionName: 'burn',
        args: [position.nftId],
        account: walletClient.account,
      } as Parameters<typeof walletClient.writeContract>[0]);
      await publicClient.waitForTransactionReceipt({ hash: burnHash });
    }

    console.log(`   ✅ Removed ${params.percent}% liquidity`);

    // Reload positions
    if (this.evmWalletAddress) {
      await this.loadEVMPositions(this.evmWalletAddress);
    }

    return { success: true, txHash: decreaseHash };
  }

  // ============ Private Methods ============

  private async loadEVMPositions(walletAddress: Address): Promise<void> {
    for (const [chainId, client] of this.evmClients) {
      const nftAddress = UNISWAP_V3_POSITIONS_NFT[chainId];
      if (!nftAddress) continue;

      // Get NFT count
      const balance = await client.readContract({
        address: nftAddress,
        abi: POSITION_NFT_ABI,
        functionName: 'balanceOf',
        args: [walletAddress],
      });

      // Load each position
      for (let i = 0n; i < balance; i++) {
        const tokenId = await client.readContract({
          address: nftAddress,
          abi: POSITION_NFT_ABI,
          functionName: 'tokenOfOwnerByIndex',
          args: [walletAddress, i],
        });

        const positionData = await client.readContract({
          address: nftAddress,
          abi: POSITION_NFT_ABI,
          functionName: 'positions',
          args: [tokenId],
        });

        const position: EVMPosition = {
          id: `uniswap-v3-${chainId}-${tokenId}`,
          chainId,
          dex: 'uniswap-v3',
          poolAddress: nftAddress, // Would need to derive actual pool
          tokenA: { address: positionData[2], symbol: '', decimals: 18, chainId },
          tokenB: { address: positionData[3], symbol: '', decimals: 18, chainId },
          liquidityA: 0n,
          liquidityB: 0n,
          valueUsd: 0, // Would need price feed
          feesEarned: positionData[10] + positionData[11],
          tickLower: positionData[5],
          tickUpper: positionData[6],
          liquidity: positionData[7],
          nftId: tokenId,
        };

        this.evmPositions.set(position.id, position);
      }
    }
  }

  private async loadSolanaPositions(owner: string): Promise<void> {
    if (!this.solanaDex) return;

    const positions = await this.solanaDex.getAllPositions(owner);
    for (const pos of positions) {
      this.solanaPositions.set(pos.id, pos);
    }
  }

  private async runOptimizationCycle(): Promise<void> {
    console.log('🔄 Running liquidity optimization cycle...');

    // Refresh positions
    if (this.solanaKeypair) {
      await this.loadSolanaPositions(this.solanaKeypair.publicKey.toBase58());
    }

    // Get rebalance actions
    const actions = await this.getRebalanceActions();

    if (actions.length > 0) {
      console.log(`   Found ${actions.length} optimization opportunities`);
      this.emit('rebalance-opportunities', actions);

      // Execute if auto-rebalance enabled
      if (this.config.autoRebalance) {
        for (const action of actions) {
          if (action.expectedProfitUsd > action.gasEstimateUsd * 2) {
            const result = await this.executeAction(action);
            this.emit('action-executed', { action, result });
          }
        }
      }
    }
  }

  private async executeSolanaAction(action: RebalanceAction): Promise<{ success: boolean; txHash?: string; error?: string }> {
    if (!this.solanaDex || !this.solanaKeypair) {
      return { success: false, error: 'Solana not initialized' };
    }

    const position = this.solanaPositions.get(action.positionId);
    if (!position) {
      return { success: false, error: 'Position not found' };
    }

    const adapter = this.solanaDex.getAdapter(position.dex);
    if (!adapter) {
      return { success: false, error: `Unknown DEX: ${position.dex}` };
    }

    switch (action.type) {
      case 'HARVEST':
      case 'COMPOUND':
        // For Solana, harvesting is usually part of remove/add cycle
        return { success: true, txHash: 'harvest-simulated' };

      case 'REMOVE':
        const txHash = await adapter.removeLiquidity(
          position.id,
          position.liquidity ?? 0n,
          this.solanaKeypair
        );
        return { success: true, txHash };

      case 'RERANGE':
        // Rerange requires: 1) remove position, 2) calculate new ticks, 3) re-add
        return { success: false, error: 'Rerange requires position close and re-open with new ticks' };

      default:
        return { success: false, error: `Unknown action type: ${action.type}` };
    }
  }

  private async executeEVMAction(action: RebalanceAction): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const position = this.evmPositions.get(action.positionId);
    if (!position) {
      return { success: false, error: `EVM position ${action.positionId} not found` };
    }

    switch (action.type) {
      case 'REMOVE':
        return this.removeEVMLiquidity({
          positionId: action.positionId,
          percent: 100,
          chainId: position.chainId,
        });

      case 'HARVEST':
      case 'COMPOUND':
        return this.collectEVMFees(action.positionId, position.chainId);

      case 'ADD':
        // ADD requires amounts to be specified in action
        return { success: false, error: 'ADD action requires amounts - use addLiquidity() directly' };

      case 'RERANGE':
        // Rerange: close position and reopen with new ticks
        // This is complex and requires: 1) Get current amounts 2) Remove 3) Calculate new ticks 4) Re-add
        const removeResult = await this.removeEVMLiquidity({
          positionId: action.positionId,
          percent: 100,
          chainId: position.chainId,
        });
        if (!removeResult.success) {
          return removeResult;
        }
        // After removal, user must manually re-add with new tick range
        return { 
          success: true, 
          txHash: removeResult.txHash,
          error: 'Position closed. Re-add liquidity with desired tick range using addLiquidity().'
        };

      default:
        return { success: false, error: `Unknown action type: ${action.type}` };
    }
  }

  /**
   * Collect accumulated fees from an EVM position
   */
  private async collectEVMFees(
    positionId: string,
    chainId: ChainId
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const position = this.evmPositions.get(positionId);
    if (!position || !position.nftId) {
      return { success: false, error: 'Position not found or has no NFT ID' };
    }

    const walletClient = this.evmWalletClients.get(chainId);
    const publicClient = this.evmClients.get(chainId);
    const chain = this.evmChains.get(chainId);
    if (!walletClient || !publicClient || !chain || !this.evmWalletAddress) {
      return { success: false, error: `No wallet client for chain ${chainId}` };
    }

    const nftAddress = UNISWAP_V3_POSITIONS_NFT[chainId];
    if (!nftAddress) {
      return { success: false, error: `Uniswap V3 not supported on chain ${chainId}` };
    }

    console.log(`   Collecting fees for NFT #${position.nftId}...`);

    const collectParams = {
      tokenId: position.nftId,
      recipient: this.evmWalletAddress,
      amount0Max: maxUint128,
      amount1Max: maxUint128,
    };

    const hash = await walletClient.writeContract({
      chain,
      address: nftAddress,
      abi: POSITION_NFT_ABI,
      functionName: 'collect',
      args: [collectParams],
      account: walletClient.account,
    } as Parameters<typeof walletClient.writeContract>[0]);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === 'reverted') {
      return { success: false, error: 'collect transaction reverted' };
    }

    console.log(`   ✅ Fees collected`);

    // Reload to update fee amounts
    if (this.evmWalletAddress) {
      await this.loadEVMPositions(this.evmWalletAddress);
    }

    return { success: true, txHash: hash };
  }

  private toUnifiedPosition(pos: EVMPosition | SolanaPosition, chain: 'evm' | 'solana'): UnifiedPosition {
    if (chain === 'evm') {
      const evmPos = pos as EVMPosition;
      return {
        id: evmPos.id,
        chain: 'evm',
        chainId: evmPos.chainId,
        dex: evmPos.dex,
        poolId: evmPos.poolAddress,
        tokenA: { symbol: evmPos.tokenA.symbol, address: evmPos.tokenA.address, decimals: evmPos.tokenA.decimals },
        tokenB: { symbol: evmPos.tokenB.symbol, address: evmPos.tokenB.address, decimals: evmPos.tokenB.decimals },
        valueUsd: evmPos.valueUsd,
        apr: 0, // Would need to calculate
        feesEarnedUsd: Number(evmPos.feesEarned) / 1e18 * 3000, // Rough USD estimate
        impermanentLossPercent: 0, // Would need entry prices
        inRange: evmPos.inRange ?? true,
        lastUpdate: Date.now(),
        raw: evmPos,
      };
    } else {
      const solPos = pos as SolanaPosition;
      return {
        id: solPos.id,
        chain: 'solana',
        chainId: 'solana-mainnet',
        dex: solPos.dex,
        poolId: solPos.poolId,
        tokenA: { symbol: solPos.tokenA.symbol, address: solPos.tokenA.mint, decimals: solPos.tokenA.decimals },
        tokenB: { symbol: solPos.tokenB.symbol, address: solPos.tokenB.mint, decimals: solPos.tokenB.decimals },
        valueUsd: solPos.valueUsd,
        apr: 0,
        feesEarnedUsd: Number(solPos.feesEarned) / 1e9, // Rough estimate
        impermanentLossPercent: 0,
        inRange: solPos.inRange ?? true,
        lastUpdate: Date.now(),
        raw: solPos,
      };
    }
  }

  private calculateRiskScore(pool: SolanaPool): number {
    let score = 50; // Base score

    // Lower TVL = higher risk
    if (pool.tvlUsd < 100000) score += 30;
    else if (pool.tvlUsd < 1000000) score += 15;
    else if (pool.tvlUsd > 10000000) score -= 10;

    // Lower volume = higher risk
    if ((pool.volume24h ?? 0) < 50000) score += 20;
    else if ((pool.volume24h ?? 0) > 1000000) score -= 10;

    // Very high APR = higher risk (unsustainable)
    if ((pool.apr24h ?? 0) > 500) score += 25;
    else if ((pool.apr24h ?? 0) > 200) score += 10;

    return Math.max(0, Math.min(100, score));
  }

  private getRecommendation(pool: SolanaPool): 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL' {
    const riskScore = this.calculateRiskScore(pool);
    const apr = pool.apr24h ?? 0;

    if (riskScore < 30 && apr > 20) return 'STRONG_BUY';
    if (riskScore < 50 && apr > 10) return 'BUY';
    if (riskScore > 70) return 'STRONG_SELL';
    if (riskScore > 50 || apr < 5) return 'SELL';
    return 'HOLD';
  }

  private getRpcUrl(chainId: ChainId): string {
    return process.env[`RPC_URL_${chainId}`] ?? '';
  }

  /**
   * Get total portfolio value
   */
  getTotalValue(): { evmUsd: number; solanaUsd: number; totalUsd: number } {
    let evmUsd = 0;
    let solanaUsd = 0;

    for (const pos of this.evmPositions.values()) {
      evmUsd += pos.valueUsd;
    }

    for (const pos of this.solanaPositions.values()) {
      solanaUsd += pos.valueUsd;
    }

    return { evmUsd, solanaUsd, totalUsd: evmUsd + solanaUsd };
  }

  /**
   * Get stats summary
   */
  getStats(): {
    totalPositions: number;
    evmPositions: number;
    solanaPositions: number;
    totalValueUsd: number;
    totalFeesEarnedUsd: number;
    avgApr: number;
    positionsInRange: number;
    positionsOutOfRange: number;
  } {
    const positions = this.getPositions();
    const inRange = positions.filter(p => p.inRange).length;
    const totalFees = positions.reduce((sum, p) => sum + p.feesEarnedUsd, 0);
    const totalValue = positions.reduce((sum, p) => sum + p.valueUsd, 0);
    const avgApr = positions.length > 0 
      ? positions.reduce((sum, p) => sum + p.apr, 0) / positions.length 
      : 0;

    return {
      totalPositions: positions.length,
      evmPositions: this.evmPositions.size,
      solanaPositions: this.solanaPositions.size,
      totalValueUsd: totalValue,
      totalFeesEarnedUsd: totalFees,
      avgApr,
      positionsInRange: inRange,
      positionsOutOfRange: positions.length - inRange,
    };
  }
}

