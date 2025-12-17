/**
 * MEV Strategy Engine - External Chain Focus
 * 
 * Non-controversial MEV extraction strategy:
 * 
 * ON JEJU CHAIN:
 *   - Route all Jeju user transactions via Flashbots Protect RPC
 *   - No sandwiching, no MEV extraction from our own users
 *   - Maximum user protection and experience
 * 
 * ON EXTERNAL CHAINS (Ethereum, Arbitrum, Base, etc.):
 *   - Aggressive MEV extraction via MEV-Boost + BuilderNet
 *   - Multi-builder submission for maximum inclusion
 *   - No refunds - pure value extraction
 * 
 * CROSS-CHAIN:
 *   - Bridge arbitrage via Rollup-Boost
 *   - Price discrepancy exploitation
 */

import { 
  type Address, 
  type Hash, 
  type Hex,
  type Chain,
  createPublicClient, 
  http, 
  parseEther, 
  formatEther,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, arbitrum, base, optimism } from 'viem/chains';
import { EventEmitter } from 'events';

import { 
  MevBoostProvider, 
  FlashbotsStrategyEngine,
  type FlashbotsBundle 
} from './flashbots';
import { MempoolMonitor, type SwapIntent } from './mempool';

// Chain IDs
const JEJU_CHAIN_ID = 8453; // Update with actual Jeju chain ID
const EXTERNAL_CHAINS = [1, 42161, 10, 8453]; // Mainnet, Arbitrum, Optimism, Base

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface ExternalMevConfig {
  privateKey: Hex;
  jejuChainId?: number;
  externalChains?: number[];
  jejuContracts?: Address[];
  
  // MEV Strategy
  enableArbitrage?: boolean;
  enableSandwich?: boolean;
  enableBackrun?: boolean;
  enableLiquidations?: boolean;
  
  // Thresholds
  minProfitWei?: bigint;
  maxGasPrice?: bigint;
  maxSlippageBps?: number;
  
  // Flashbots
  enableMevBoost?: boolean;
  enableBuilderNet?: boolean;
  enableProtect?: boolean;
  
  // RPC endpoints
  alchemyApiKey?: string;
  jejuRpc?: string;
}

export interface MevStats {
  // Bundle stats
  bundlesSubmitted: number;
  bundlesIncluded: number;
  bundlesFailed: number;
  
  // MEV extraction stats
  arbitragesExecuted: number;
  sandwichesExecuted: number;
  backrunsExecuted: number;
  liquidationsExecuted: number;
  
  // Profit
  totalProfitWei: bigint;
  arbitrageProfitWei: bigint;
  sandwichProfitWei: bigint;
  backrunProfitWei: bigint;
  liquidationProfitWei: bigint;
  
  // Protection
  jejuTxsProtected: number;
  
  // Timing
  startedAt: number;
}

// ============================================================================
// EXTERNAL CHAIN MEV ENGINE
// ============================================================================

export class ExternalChainMevEngine extends EventEmitter {
  private config: Required<ExternalMevConfig>;
  private flashbots: MevBoostProvider;
  private strategyEngine: FlashbotsStrategyEngine;
  private mempoolMonitor: MempoolMonitor;
  private account: ReturnType<typeof privateKeyToAccount>;
  private running = false;
  
  private stats: MevStats = {
    bundlesSubmitted: 0,
    bundlesIncluded: 0,
    bundlesFailed: 0,
    arbitragesExecuted: 0,
    sandwichesExecuted: 0,
    backrunsExecuted: 0,
    liquidationsExecuted: 0,
    totalProfitWei: 0n,
    arbitrageProfitWei: 0n,
    sandwichProfitWei: 0n,
    backrunProfitWei: 0n,
    liquidationProfitWei: 0n,
    jejuTxsProtected: 0,
    startedAt: Date.now(),
  };
  
  // Track pool states for sandwich calculations
  private poolStates: Map<Address, {
    token0: Address;
    token1: Address;
    reserve0: bigint;
    reserve1: bigint;
    fee: number;
  }> = new Map();

  constructor(config: ExternalMevConfig) {
    super();
    
    this.config = {
      jejuChainId: JEJU_CHAIN_ID,
      externalChains: EXTERNAL_CHAINS,
      jejuContracts: [],
      enableArbitrage: true,
      enableSandwich: true,
      enableBackrun: true,
      enableLiquidations: true,
      minProfitWei: parseEther('0.001'),
      maxGasPrice: parseEther('0.0001'), // 100 gwei
      maxSlippageBps: 300, // 3%
      enableMevBoost: true,
      enableBuilderNet: true,
      enableProtect: true,
      alchemyApiKey: '',
      jejuRpc: 'https://rpc.jejunetwork.org',
      ...config,
    };
    
    this.account = privateKeyToAccount(config.privateKey);
    
    // Initialize Flashbots provider with ALL features
    this.flashbots = new MevBoostProvider({
      privateKey: config.privateKey,
      enableMevBoost: this.config.enableMevBoost,
      enableBuilderNet: this.config.enableBuilderNet,
      enableProtect: this.config.enableProtect,
      enableRollupBoost: true,
      enableMevShare: false, // No MEV-Share refunds
      enableSuave: false, // Not production ready
      jejuContracts: this.config.jejuContracts,
    });
    
    this.strategyEngine = new FlashbotsStrategyEngine(this.flashbots);
    
    // Monitor only EXTERNAL chains - not Jeju
    this.mempoolMonitor = new MempoolMonitor({
      chains: this.config.externalChains.filter(c => c !== this.config.jejuChainId),
      alchemyApiKey: this.config.alchemyApiKey,
      filterJejuTxs: false, // We want ALL transactions on external chains
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    
    console.log('\n' + '═'.repeat(60));
    console.log('EXTERNAL CHAIN MEV ENGINE');
    console.log('═'.repeat(60));
    
    console.log(`\n🔧 Configuration:`);
    console.log(`   Jeju Chain ID:     ${this.config.jejuChainId}`);
    console.log(`   External Chains:   ${this.config.externalChains.filter(c => c !== this.config.jejuChainId).join(', ')}`);
    console.log(`   Arbitrage:         ${this.config.enableArbitrage ? '✅' : '❌'}`);
    console.log(`   Sandwich:          ${this.config.enableSandwich ? '✅' : '❌'}`);
    console.log(`   Backrun:           ${this.config.enableBackrun ? '✅' : '❌'}`);
    console.log(`   Liquidations:      ${this.config.enableLiquidations ? '✅' : '❌'}`);
    console.log(`   Min Profit:        ${formatEther(this.config.minProfitWei)} ETH`);
    console.log(`   Executor:          ${this.account.address}`);
    
    console.log(`\n🔌 Flashbots Integration:`);
    console.log(`   MEV-Boost:         ${this.config.enableMevBoost ? '✅' : '❌'}`);
    console.log(`   BuilderNet:        ${this.config.enableBuilderNet ? '✅' : '❌'}`);
    console.log(`   Protect RPC:       ${this.config.enableProtect ? '✅ (for Jeju users)' : '❌'}`);
    
    // Initialize providers
    await this.flashbots.initialize();
    await this.strategyEngine.start();
    
    // Start mempool monitoring
    await this.mempoolMonitor.start();
    
    // Subscribe to mempool events
    this.mempoolMonitor.on('swap', (swap: SwapIntent) => this.handleSwap(swap));
    this.mempoolMonitor.on('largeSwap', (swap: SwapIntent) => this.handleLargeSwap(swap));
    
    this.running = true;
    this.stats.startedAt = Date.now();
    
    console.log('\n✅ External chain MEV engine started');
    console.log('   Monitoring mempools for opportunities...');
    console.log('═'.repeat(60) + '\n');
  }

  async stop(): Promise<void> {
    this.running = false;
    this.mempoolMonitor.stop();
    await this.strategyEngine.stop();
    console.log('External chain MEV engine stopped');
  }

  // ==========================================================================
  // JEJU USER PROTECTION - Route via Flashbots Protect
  // ==========================================================================
  
  /**
   * Submit Jeju user transaction via Flashbots Protect
   * This ensures our users are NEVER sandwiched
   */
  async protectJejuTransaction(signedTx: Hex): Promise<{ hash: Hash; protected: boolean }> {
    if (!this.config.enableProtect) {
      throw new Error('Flashbots Protect is disabled');
    }
    
    const result = await this.flashbots.submitProtected(signedTx, { fast: true });
    this.stats.jejuTxsProtected++;
    
    console.log(`🛡️ Protected Jeju TX: ${result.hash}`);
    return { hash: result.hash, protected: true };
  }

  // ==========================================================================
  // EXTERNAL CHAIN MEV EXTRACTION
  // ==========================================================================
  
  /**
   * Handle swap detected on external chain
   */
  private async handleSwap(swap: SwapIntent): Promise<void> {
    // Skip if from our address
    if (swap.tx.from.toLowerCase() === this.account.address.toLowerCase()) {
      return;
    }
    
    // Check for profitable sandwich opportunity
    if (this.config.enableSandwich) {
      await this.evaluateSandwich(swap);
    }
    
    // Check for backrun opportunity
    if (this.config.enableBackrun) {
      await this.evaluateBackrun(swap);
    }
  }

  /**
   * Handle large swap (potential high-value MEV)
   */
  private async handleLargeSwap(swap: SwapIntent): Promise<void> {
    console.log(`\n💰 Large swap detected on chain ${swap.chainId}:`);
    console.log(`   From:   ${swap.tx.from}`);
    console.log(`   Router: ${swap.tx.to}`);
    console.log(`   Value:  ${formatEther(swap.tx.value || 0n)} ETH`);
    
    await this.handleSwap(swap);
  }

  /**
   * Evaluate swap for sandwich opportunity
   */
  private async evaluateSandwich(swap: SwapIntent): Promise<void> {
    const poolState = this.poolStates.get(swap.tokenIn as Address);
    if (!poolState) return;
    
    // Calculate victim's slippage tolerance
    const slippageBps = this.calculateSlippage(swap);
    if (slippageBps < 50) return; // Less than 0.5% slippage, not worth it
    
    // Calculate potential profit
    const profit = this.calculateSandwichProfit(swap, poolState);
    if (profit < this.config.minProfitWei) return;
    
    console.log(`\n🥪 Sandwich opportunity on chain ${swap.chainId}:`);
    console.log(`   Target:    ${swap.tx.hash}`);
    console.log(`   Slippage:  ${slippageBps / 100}%`);
    console.log(`   Est. Profit: ${formatEther(profit)} ETH`);
    
    // Build and submit bundle
    await this.executeSandwich(swap, profit);
  }

  /**
   * Evaluate swap for backrun opportunity
   */
  private async evaluateBackrun(swap: SwapIntent): Promise<void> {
    // Large swaps create price impact - check for arb after
    const impactBps = this.estimatePriceImpact(swap);
    if (impactBps < 20) return; // Less than 0.2% impact, not worth backrunning
    
    // Calculate backrun profit
    const profit = this.calculateBackrunProfit(swap, impactBps);
    if (profit < this.config.minProfitWei) return;
    
    console.log(`\n🏃 Backrun opportunity on chain ${swap.chainId}:`);
    console.log(`   After:   ${swap.tx.hash}`);
    console.log(`   Impact:  ${impactBps / 100}%`);
    console.log(`   Est. Profit: ${formatEther(profit)} ETH`);
    
    // Build and submit backrun bundle
    await this.executeBackrun(swap, profit);
  }

  /**
   * Execute sandwich attack on external chain
   * Submits to ALL builders for maximum inclusion probability
   */
  private async executeSandwich(swap: SwapIntent, _expectedProfit: bigint): Promise<void> {
    const chainId = swap.chainId;
    const client = this.getPublicClient(chainId);
    
    const blockNumber = await client.getBlockNumber();
    const targetBlock = blockNumber + 1n;
    
    // Build frontrun and backrun transactions
    const txs = await this.buildSandwichBundle(swap);
    
    const bundle: FlashbotsBundle = {
      txs,
      blockNumber: targetBlock,
    };
    
    // Simulate first
    const simulation = await this.flashbots.simulateBundle(bundle);
    if (!simulation.success) {
      console.log(`   ❌ Simulation failed`);
      this.stats.bundlesFailed++;
      return;
    }
    
    // Check simulated profit
    if (simulation.totalProfit < this.config.minProfitWei) {
      console.log(`   ❌ Simulated profit too low: ${formatEther(simulation.totalProfit)} ETH`);
      return;
    }
    
    // Submit to ALL builders
    const results = await this.flashbots.submitToAllBuilders(bundle);
    
    const successCount = [...results.values()].filter(r => r.success).length;
    if (successCount > 0) {
      this.stats.bundlesSubmitted++;
      this.stats.sandwichesExecuted++;
      this.stats.sandwichProfitWei += simulation.totalProfit;
      this.stats.totalProfitWei += simulation.totalProfit;
      
      console.log(`   ✅ Submitted to ${successCount}/${results.size} builders`);
      console.log(`   Expected profit: ${formatEther(simulation.totalProfit)} ETH`);
    } else {
      this.stats.bundlesFailed++;
      console.log(`   ❌ All builder submissions failed`);
    }
  }

  /**
   * Execute backrun on external chain
   */
  private async executeBackrun(swap: SwapIntent, expectedProfit: bigint): Promise<void> {
    const chainId = swap.chainId;
    const client = this.getPublicClient(chainId);
    
    const blockNumber = await client.getBlockNumber();
    const targetBlock = blockNumber + 1n;
    
    // Build backrun transaction
    const backrunTx = await this.buildBackrunTx(swap);
    
    const bundle: FlashbotsBundle = {
      txs: [backrunTx],
      blockNumber: targetBlock,
    };
    
    // Submit via strategy engine
    const result = await this.strategyEngine.submitArbitrageBundle(
      bundle.txs,
      targetBlock,
      expectedProfit
    );
    
    if (result.success) {
      this.stats.bundlesSubmitted++;
      this.stats.backrunsExecuted++;
      this.stats.backrunProfitWei += expectedProfit;
      this.stats.totalProfitWei += expectedProfit;
      
      console.log(`   ✅ Backrun submitted: ${result.bundleHash}`);
    } else {
      this.stats.bundlesFailed++;
    }
  }

  /**
   * Execute arbitrage across pools
   */
  async executeArbitrage(
    chainId: number,
    path: Address[],
    amountIn: bigint,
    minProfit: bigint
  ): Promise<{ success: boolean; txHash?: Hash; profit?: bigint }> {
    const client = this.getPublicClient(chainId);
    const blockNumber = await client.getBlockNumber();
    
    // Build arbitrage transaction
    const arbTx = await this.buildArbitrageTx(chainId, path, amountIn);
    
    const bundle: FlashbotsBundle = {
      txs: [arbTx],
      blockNumber: blockNumber + 1n,
    };
    
    // Simulate
    const simulation = await this.flashbots.simulateBundle(bundle);
    if (!simulation.success || simulation.totalProfit < minProfit) {
      return { success: false };
    }
    
    // Submit to all builders
    const results = await this.flashbots.submitToAllBuilders(bundle);
    const successfulSubmission = [...results.values()].find(r => r.success);
    
    if (successfulSubmission) {
      this.stats.arbitragesExecuted++;
      this.stats.arbitrageProfitWei += simulation.totalProfit;
      this.stats.totalProfitWei += simulation.totalProfit;
      
      return {
        success: true,
        txHash: successfulSubmission.bundleHash,
        profit: simulation.totalProfit,
      };
    }
    
    return { success: false };
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================
  
  private calculateSlippage(swap: SwapIntent): number {
    // Calculate slippage from amountIn vs amountOutMin using pool state
    if (!swap.pool || !swap.amountIn || swap.amountIn === 0n) {
      return 100; // Default 1% assumption
    }

    const poolState = this.poolStates.get(swap.pool);
    if (!poolState) {
      return 100; // Default without pool data
    }

    // Calculate expected output using constant product formula
    const amountIn = swap.amountIn;
    const [reserveIn, reserveOut] = swap.tokenIn === poolState.token0
      ? [poolState.reserve0, poolState.reserve1]
      : [poolState.reserve1, poolState.reserve0];

    // Expected output = (amountIn * reserveOut) / (reserveIn + amountIn)
    // With fee: (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
    const amountInWithFee = amountIn * BigInt(10000 - poolState.fee);
    const expectedOut = (amountInWithFee * reserveOut) / (reserveIn * 10000n + amountInWithFee);

    // Slippage = (expected - minOut) / expected * 10000 (bps)
    if (swap.amountOutMin && swap.amountOutMin > 0n && expectedOut > 0n) {
      const slippageBps = Number(((expectedOut - swap.amountOutMin) * 10000n) / expectedOut);
      return Math.max(slippageBps, 10); // Minimum 10 bps
    }

    return 100; // Default 1%
  }

  private calculateSandwichProfit(
    swap: SwapIntent,
    _poolState: { reserve0: bigint; reserve1: bigint; fee: number }
  ): bigint {
    // Simplified profit calculation
    // Real implementation would use constant product AMM math with pool state
    const victimAmount = swap.amountIn || 0n;
    const slippageBps = this.calculateSlippage(swap);
    
    // Rough estimate: profit = victim_amount * slippage * efficiency
    const rawProfit = (victimAmount * BigInt(slippageBps)) / 10000n;
    const efficiency = 30n; // 30% of theoretical max
    
    return (rawProfit * efficiency) / 100n;
  }

  private estimatePriceImpact(swap: SwapIntent): number {
    // Estimate price impact based on swap size
    // Larger swaps have more impact
    const amount = swap.amountIn || 0n;
    if (amount > parseEther('100')) return 100; // 1% for large swaps
    if (amount > parseEther('10')) return 50; // 0.5% for medium swaps
    return 20; // 0.2% for small swaps
  }

  private calculateBackrunProfit(swap: SwapIntent, impactBps: number): bigint {
    // Calculate arbitrage profit from price impact
    const amount = swap.amountIn || parseEther('1');
    return (amount * BigInt(impactBps)) / 20000n; // ~50% of impact recoverable
  }

  private async buildSandwichBundle(swap: SwapIntent): Promise<Hex[]> {
    const { encodeFunctionData } = await import('viem');
    
    if (!swap.pool || !swap.tokenIn || !swap.tokenOut) {
      throw new Error('Swap intent missing required fields for sandwich');
    }

    const poolState = this.poolStates.get(swap.pool);
    if (!poolState) {
      throw new Error(`No pool state for ${swap.pool}`);
    }

    // Calculate optimal frontrun amount (typically 10-30% of victim's trade)
    const victimAmount = swap.amountIn || 0n;
    const frontrunAmount = (victimAmount * 20n) / 100n; // 20% of victim's trade

    // UniswapV2 Router02 ABI for swaps
    const SWAP_ABI = [
      {
        name: 'swapExactTokensForTokens',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMin', type: 'uint256' },
          { name: 'path', type: 'address[]' },
          { name: 'to', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
        outputs: [{ name: 'amounts', type: 'uint256[]' }],
      },
    ] as const;

    // Get router address for the chain
    const router = this.getRouterAddress(swap.chainId);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 min deadline

    // Frontrun: Buy the token the victim wants to buy (drives price up)
    const frontrunData = encodeFunctionData({
      abi: SWAP_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [
        frontrunAmount,
        0n, // No slippage protection for MEV
        [swap.tokenIn, swap.tokenOut],
        this.account.address,
        deadline,
      ],
    });

    // Backrun: Sell after victim's swap (captures price difference)
    // The output from frontrun becomes input for backrun
    const expectedFrontrunOutput = this.calculateAmountOut(
      frontrunAmount,
      poolState.reserve0,
      poolState.reserve1,
      poolState.fee
    );

    const backrunData = encodeFunctionData({
      abi: SWAP_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [
        expectedFrontrunOutput,
        0n,
        [swap.tokenOut, swap.tokenIn], // Reverse path
        this.account.address,
        deadline,
      ],
    });

    return [
      this.buildTx(router, frontrunData),
      this.buildTx(router, backrunData),
    ];
  }

  private async buildBackrunTx(swap: SwapIntent): Promise<Hex> {
    const { encodeFunctionData } = await import('viem');
    
    if (!swap.pool || !swap.tokenIn || !swap.tokenOut) {
      throw new Error('Swap intent missing required fields for backrun');
    }

    const poolState = this.poolStates.get(swap.pool);
    if (!poolState) {
      throw new Error(`No pool state for ${swap.pool}`);
    }

    // Backrun arbitrage: capture price impact from victim's swap
    const impactBps = this.estimatePriceImpact(swap);
    const arbAmount = (swap.amountIn || 0n) * BigInt(impactBps) / 10000n;

    const SWAP_ABI = [
      {
        name: 'swapExactTokensForTokens',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMin', type: 'uint256' },
          { name: 'path', type: 'address[]' },
          { name: 'to', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
        outputs: [{ name: 'amounts', type: 'uint256[]' }],
      },
    ] as const;

    const router = this.getRouterAddress(swap.chainId);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

    // Reverse direction from victim to capture arbitrage
    const data = encodeFunctionData({
      abi: SWAP_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [
        arbAmount,
        0n,
        [swap.tokenOut, swap.tokenIn],
        this.account.address,
        deadline,
      ],
    });

    return this.buildTx(router, data);
  }

  private async buildArbitrageTx(
    chainId: number,
    path: Address[],
    amountIn: bigint
  ): Promise<Hex> {
    const { encodeFunctionData } = await import('viem');
    
    if (path.length < 2) {
      throw new Error('Path must have at least 2 tokens');
    }

    const SWAP_ABI = [
      {
        name: 'swapExactTokensForTokens',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMin', type: 'uint256' },
          { name: 'path', type: 'address[]' },
          { name: 'to', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
        outputs: [{ name: 'amounts', type: 'uint256[]' }],
      },
    ] as const;

    const router = this.getRouterAddress(chainId);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

    const data = encodeFunctionData({
      abi: SWAP_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [
        amountIn,
        0n, // No slippage for MEV - we simulate before submitting
        path,
        this.account.address,
        deadline,
      ],
    });

    return this.buildTx(router, data);
  }

  private buildTx(to: Address, data: Hex): Hex {
    // Encode transaction as RLP for bundle submission
    // This is a simplified version - real impl uses proper RLP encoding
    const { encodeAbiParameters } = require('viem');
    return encodeAbiParameters(
      [{ type: 'address' }, { type: 'bytes' }],
      [to, data]
    ) as Hex;
  }

  private getRouterAddress(chainId: number): Address {
    // UniswapV2 and compatible routers
    const routers: Record<number, Address> = {
      1: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',      // Ethereum Uniswap V2
      42161: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',  // Arbitrum SushiSwap
      10: '0x9c12939390052919aF3155f41Bf4160Fd3666A6f',     // Optimism Velodrome
      8453: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',   // Base Aerodrome
    };
    return routers[chainId] || routers[1];
  }

  private calculateAmountOut(
    amountIn: bigint,
    reserveIn: bigint,
    reserveOut: bigint,
    feeBps: number
  ): bigint {
    const feeMultiplier = 10000n - BigInt(feeBps);
    const amountInWithFee = amountIn * feeMultiplier;
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn * 10000n + amountInWithFee;
    return numerator / denominator;
  }

  private estimatePriceImpact(swap: SwapIntent): number {
    if (!swap.pool) return 0;
    const poolState = this.poolStates.get(swap.pool);
    if (!poolState) return 0;

    const amountIn = swap.amountIn || 0n;
    // Simplified price impact calculation
    const impactBps = Number((amountIn * 10000n) / poolState.reserve0);
    return Math.min(impactBps, 500); // Cap at 5%
  }

  private getPublicClient(chainId: number) {
    const chains: Record<number, Chain> = {
      1: mainnet,
      42161: arbitrum,
      10: optimism,
      8453: base,
    };
    
    return createPublicClient({
      chain: chains[chainId] ?? mainnet,
      transport: http(),
    });
  }

  /**
   * Update pool state for calculations
   */
  updatePoolState(
    pool: Address,
    state: { token0: Address; token1: Address; reserve0: bigint; reserve1: bigint; fee: number }
  ): void {
    this.poolStates.set(pool, state);
  }

  /**
   * Get current stats
   */
  getStats(): MevStats & { runtime: number } {
    return {
      ...this.stats,
      runtime: Math.floor((Date.now() - this.stats.startedAt) / 1000),
    };
  }

  /**
   * Print stats summary
   */
  printStats(): void {
    const stats = this.getStats();
    const runtime = stats.runtime;
    
    console.log('\n' + '═'.repeat(60));
    console.log('EXTERNAL CHAIN MEV ENGINE STATS');
    console.log('═'.repeat(60));
    
    console.log(`\n⏱️  RUNTIME: ${Math.floor(runtime / 3600)}h ${Math.floor((runtime % 3600) / 60)}m ${runtime % 60}s`);
    
    console.log(`\n📦 BUNDLES`);
    console.log(`   Submitted:   ${stats.bundlesSubmitted}`);
    console.log(`   Included:    ${stats.bundlesIncluded}`);
    console.log(`   Failed:      ${stats.bundlesFailed}`);
    const inclusionRate = stats.bundlesSubmitted > 0 
      ? ((stats.bundlesIncluded / stats.bundlesSubmitted) * 100).toFixed(1) 
      : '0.0';
    console.log(`   Inclusion:   ${inclusionRate}%`);
    
    console.log(`\n💰 MEV EXTRACTION`);
    console.log(`   Arbitrages:    ${stats.arbitragesExecuted} (${formatEther(stats.arbitrageProfitWei)} ETH)`);
    console.log(`   Sandwiches:    ${stats.sandwichesExecuted} (${formatEther(stats.sandwichProfitWei)} ETH)`);
    console.log(`   Backruns:      ${stats.backrunsExecuted} (${formatEther(stats.backrunProfitWei)} ETH)`);
    console.log(`   Liquidations:  ${stats.liquidationsExecuted} (${formatEther(stats.liquidationProfitWei)} ETH)`);
    console.log(`   ─────────────────────────────────────`);
    console.log(`   TOTAL PROFIT:  ${formatEther(stats.totalProfitWei)} ETH`);
    
    console.log(`\n🛡️ JEJU USER PROTECTION`);
    console.log(`   Protected Txs: ${stats.jejuTxsProtected}`);
    console.log(`   Strategy:      Flashbots Protect RPC`);
    
    console.log('═'.repeat(60) + '\n');
  }
}

// Export for backwards compatibility
export { ExternalChainMevEngine as MevStrategyEngine };
