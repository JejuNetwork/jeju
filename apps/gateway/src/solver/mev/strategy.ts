/**
 * MEV Strategy Engine
 * 
 * Orchestrates MEV extraction and protection:
 * 1. Monitor mempool for opportunities
 * 2. Build profitable sandwich bundles
 * 3. Submit via MEV-Share for fair redistribution
 * 4. Protect Jeju transactions via Flashbots Protect
 * 
 * Principles:
 * - Never sandwich Jeju users
 * - Share MEV fairly with victims via MEV-Share
 * - Optimize gas costs via bundle batching
 */

import { type Address, type Hash, type Hex, createPublicClient, createWalletClient, http, parseEther, formatEther, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { EventEmitter } from 'events';

import { FlashbotsProvider, SandwichBuilder, type SandwichOpportunity, type FlashbotsBundle, type MevShareBundle } from './flashbots';
import { MempoolMonitor, type SwapIntent, type PendingTx } from './mempool';

// Uniswap V2 Router ABI (minimal)
const UNISWAP_V2_ROUTER_ABI = [
  {
    type: 'function',
    name: 'swapExactTokensForTokens',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'nonpayable',
  },
] as const;

// ERC20 ABI
const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const;

export interface MevStrategyConfig {
  privateKey: Hex;
  chains: number[];
  alchemyApiKey?: string;
  enableSandwich?: boolean;
  enableProtect?: boolean;
  enableMevShare?: boolean;
  mevShareRefundPercent?: number;
  minProfitWei?: bigint;
  maxBundleGas?: bigint;
  jejuContracts?: Address[];
}

export interface MevStats {
  bundlesSubmitted: number;
  bundlesIncluded: number;
  sandwichesExecuted: number;
  totalProfitWei: bigint;
  totalRefundedWei: bigint;
  protectedTxs: number;
  failedBundles: number;
  startedAt: number;
}

export class MevStrategyEngine extends EventEmitter {
  private config: Required<MevStrategyConfig>;
  private flashbots: FlashbotsProvider;
  private sandwichBuilder: SandwichBuilder;
  private mempoolMonitor: MempoolMonitor;
  private account: ReturnType<typeof privateKeyToAccount>;
  private publicClient: ReturnType<typeof createPublicClient>;
  private walletClient: ReturnType<typeof createWalletClient>;
  
  private stats: MevStats = {
    bundlesSubmitted: 0,
    bundlesIncluded: 0,
    sandwichesExecuted: 0,
    totalProfitWei: 0n,
    totalRefundedWei: 0n,
    protectedTxs: 0,
    failedBundles: 0,
    startedAt: Date.now(),
  };

  private running = false;
  private pendingBundles: Map<Hash, { blockNumber: bigint; opportunity: SandwichOpportunity }> = new Map();
  private liquidityPools: Map<Address, { token0: Address; token1: Address; reserve0: bigint; reserve1: bigint }> = new Map();

  constructor(config: MevStrategyConfig) {
    super();
    
    this.config = {
      alchemyApiKey: '',
      enableSandwich: true,
      enableProtect: true,
      enableMevShare: true,
      mevShareRefundPercent: 50,
      minProfitWei: parseEther('0.001'),
      maxBundleGas: 500000n,
      jejuContracts: [],
      ...config,
    };

    this.account = privateKeyToAccount(config.privateKey);

    this.publicClient = createPublicClient({
      chain: mainnet,
      transport: http('https://eth.llamarpc.com'),
    });

    this.walletClient = createWalletClient({
      chain: mainnet,
      transport: http('https://eth.llamarpc.com'),
      account: this.account,
    });

    this.flashbots = new FlashbotsProvider({
      privateKey: config.privateKey,
      enableMevShare: this.config.enableMevShare,
      mevShareRefundPercent: this.config.mevShareRefundPercent,
      enableProtect: this.config.enableProtect,
    });

    this.sandwichBuilder = new SandwichBuilder(
      this.flashbots,
      this.config.mevShareRefundPercent
    );

    this.mempoolMonitor = new MempoolMonitor({
      chains: config.chains,
      alchemyApiKey: this.config.alchemyApiKey,
      filterJejuTxs: true,
    });

    // Add Jeju contracts to filter
    if (this.config.jejuContracts.length > 0) {
      this.mempoolMonitor.addJejuContracts(this.config.jejuContracts);
    }
  }

  /**
   * Initialize and start the MEV engine
   */
  async start(): Promise<void> {
    if (this.running) return;

    console.log('\n' + '='.repeat(60));
    console.log('STARTING MEV STRATEGY ENGINE');
    console.log('='.repeat(60));
    
    console.log(`\nConfiguration:`);
    console.log(`   Sandwich attacks:  ${this.config.enableSandwich ? 'ENABLED' : 'DISABLED'}`);
    console.log(`   Flashbots Protect: ${this.config.enableProtect ? 'ENABLED' : 'DISABLED'}`);
    console.log(`   MEV-Share:         ${this.config.enableMevShare ? 'ENABLED' : 'DISABLED'}`);
    console.log(`   MEV-Share Refund:  ${this.config.mevShareRefundPercent}%`);
    console.log(`   Min Profit:        ${formatEther(this.config.minProfitWei)} ETH`);
    console.log(`   Executor:          ${this.account.address}`);

    // Initialize Flashbots
    await this.flashbots.init();

    // Start mempool monitoring
    await this.mempoolMonitor.start();

    // Listen for swap events
    this.mempoolMonitor.on('swap', (swap: SwapIntent) => {
      this.handleSwapIntent(swap).catch(console.error);
    });

    // Track bundle inclusion
    this.startBundleTracker();

    this.running = true;
    this.stats.startedAt = Date.now();

    console.log('\nMEV engine started successfully');
    console.log('='.repeat(60) + '\n');
  }

  /**
   * Stop the MEV engine
   */
  stop(): void {
    this.running = false;
    this.mempoolMonitor.stop();
    console.log('MEV engine stopped');
  }

  /**
   * Handle incoming swap intent from mempool
   */
  private async handleSwapIntent(swap: SwapIntent): Promise<void> {
    if (!this.config.enableSandwich) return;

    // Analyze for sandwich opportunity
    const opportunity = await this.sandwichBuilder.analyzeTx(
      {
        hash: swap.tx.hash,
        to: swap.tx.to,
        data: swap.tx.data,
        value: swap.tx.value,
        gasPrice: swap.tx.gasPrice,
        maxFeePerGas: swap.tx.maxFeePerGas,
      },
      this.liquidityPools
    );

    if (!opportunity) return;

    // Check minimum profit threshold
    if (opportunity.estimatedProfit < this.config.minProfitWei) {
      return;
    }

    console.log(`\n🎯 Sandwich opportunity detected:`);
    console.log(`   Target TX:    ${opportunity.targetHash}`);
    console.log(`   Pool:         ${opportunity.pool}`);
    console.log(`   Est. Profit:  ${formatEther(opportunity.estimatedProfit)} ETH`);
    console.log(`   Slippage:     ${opportunity.slippage / 100}%`);

    // Build and submit bundle
    await this.executeSandwich(opportunity);
  }

  /**
   * Execute a sandwich attack via MEV-Share
   */
  private async executeSandwich(opportunity: SandwichOpportunity): Promise<void> {
    const blockNumber = await this.publicClient.getBlockNumber();
    const targetBlock = blockNumber + 1n;

    // Build frontrun and backrun transactions
    const { frontrunTx, backrunTx } = await this.buildSandwichTxs(opportunity);

    if (this.config.enableMevShare) {
      // Submit via MEV-Share for fair redistribution
      const bundle = await this.sandwichBuilder.buildMevShareSandwich(
        opportunity,
        frontrunTx,
        backrunTx,
        targetBlock
      );

      try {
        const result = await this.flashbots.submitMevShareBundle(bundle);
        
        this.stats.bundlesSubmitted++;
        this.pendingBundles.set(result.bundleHash, {
          blockNumber: targetBlock,
          opportunity,
        });

        console.log(`   Bundle submitted: ${result.bundleHash}`);
        console.log(`   Target block:     ${targetBlock}`);
        console.log(`   MEV-Share refund: ${this.config.mevShareRefundPercent}%`);

        this.emit('bundle:submitted', {
          bundleHash: result.bundleHash,
          blockNumber: targetBlock,
          opportunity,
        });

      } catch (err) {
        this.stats.failedBundles++;
        console.error('   Bundle submission failed:', err);
      }

    } else {
      // Submit directly to Flashbots relay
      const bundle: FlashbotsBundle = {
        txs: [frontrunTx, backrunTx],
        blockNumber: targetBlock,
      };

      // Simulate first if configured
      if (true) {
        const simulation = await this.flashbots.simulateBundle(bundle);
        if (!simulation.success) {
          console.log(`   Simulation failed: ${simulation.error}`);
          return;
        }
        console.log(`   Simulation passed, gas used: ${simulation.results.reduce((a, b) => a + b.gasUsed, 0n)}`);
      }

      // Submit to multiple builders
      const results = await this.flashbots.submitToBuilders(bundle);
      
      let submitted = 0;
      for (const [builder, result] of results) {
        if (result.success) {
          submitted++;
          this.pendingBundles.set(result.bundleHash!, {
            blockNumber: targetBlock,
            opportunity,
          });
        }
      }

      this.stats.bundlesSubmitted += submitted;
      console.log(`   Submitted to ${submitted}/${results.size} builders`);
    }
  }

  /**
   * Build frontrun and backrun transactions for sandwich
   */
  private async buildSandwichTxs(opportunity: SandwichOpportunity): Promise<{
    frontrunTx: Hex;
    backrunTx: Hex;
  }> {
    // Calculate optimal frontrun amount (simplified)
    const frontrunAmount = opportunity.amountIn / 10n;

    // Build frontrun: Buy token before victim
    const frontrunData = encodeFunctionData({
      abi: UNISWAP_V2_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [
        frontrunAmount,
        0n, // No minimum, we're frontrunning
        [opportunity.tokenIn, opportunity.tokenOut],
        this.account.address,
        BigInt(Math.floor(Date.now() / 1000) + 300),
      ],
    });

    // Build backrun: Sell token after victim
    const backrunData = encodeFunctionData({
      abi: UNISWAP_V2_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [
        frontrunAmount, // Sell what we bought
        0n, // Will set proper minimum based on expected profit
        [opportunity.tokenOut, opportunity.tokenIn],
        this.account.address,
        BigInt(Math.floor(Date.now() / 1000) + 300),
      ],
    });

    // Get nonce and gas estimates
    const nonce = await this.publicClient.getTransactionCount({
      address: this.account.address,
    });

    const gasPrice = await this.publicClient.getGasPrice();

    // Sign frontrun transaction
    const frontrunTx = await this.walletClient.signTransaction({
      to: opportunity.pool, // Would be router address in reality
      data: frontrunData,
      value: 0n,
      nonce,
      gasPrice: gasPrice + (gasPrice / 10n), // 10% higher
      gas: 250000n,
    });

    // Sign backrun transaction
    const backrunTx = await this.walletClient.signTransaction({
      to: opportunity.pool,
      data: backrunData,
      value: 0n,
      nonce: nonce + 1,
      gasPrice: gasPrice + (gasPrice / 10n),
      gas: 250000n,
    });

    return { frontrunTx, backrunTx };
  }

  /**
   * Submit a Jeju transaction via Flashbots Protect
   */
  async submitProtected(signedTx: Hex): Promise<{ hash: Hash; protected: boolean }> {
    if (!this.config.enableProtect) {
      throw new Error('Flashbots Protect is disabled');
    }

    const result = await this.flashbots.submitProtected(signedTx);
    this.stats.protectedTxs++;
    
    console.log(`Protected TX submitted: ${result.hash}`);
    return { hash: result.hash, protected: true };
  }

  /**
   * Track bundle inclusion in blocks
   */
  private startBundleTracker(): void {
    // Check every block for bundle inclusion
    const unwatch = this.publicClient.watchBlockNumber({
      onBlockNumber: async (blockNumber) => {
        for (const [bundleHash, bundle] of this.pendingBundles) {
          if (blockNumber >= bundle.blockNumber) {
            // Bundle's target block has passed
            try {
              const stats = await this.flashbots.getBundleStats(bundleHash, bundle.blockNumber);
              
              if (stats.isSentToMiners) {
                this.stats.bundlesIncluded++;
                this.stats.sandwichesExecuted++;
                
                // Calculate actual profit (would need to trace transaction)
                const profit = bundle.opportunity.estimatedProfit;
                const refund = (profit * BigInt(this.config.mevShareRefundPercent)) / 100n;
                
                this.stats.totalProfitWei += profit;
                this.stats.totalRefundedWei += refund;

                console.log(`\n✅ Bundle included in block ${bundle.blockNumber}:`);
                console.log(`   Profit:  ${formatEther(profit)} ETH`);
                console.log(`   Refund:  ${formatEther(refund)} ETH (to victim)`);
                console.log(`   Net:     ${formatEther(profit - refund)} ETH`);

                this.emit('bundle:included', {
                  bundleHash,
                  blockNumber: bundle.blockNumber,
                  profit,
                  refund,
                });
              }

              this.pendingBundles.delete(bundleHash);
            } catch {
              // Stats not available yet, check again next block
              if (blockNumber > bundle.blockNumber + 5n) {
                // Too old, consider failed
                this.pendingBundles.delete(bundleHash);
              }
            }
          }
        }
      },
    });
  }

  /**
   * Update liquidity pool data for profit calculations
   */
  updateLiquidityPool(
    pool: Address,
    data: { token0: Address; token1: Address; reserve0: bigint; reserve1: bigint }
  ): void {
    this.liquidityPools.set(pool, data);
  }

  /**
   * Get current stats
   */
  getStats(): MevStats & { runtime: number; avgProfitPerSandwich: string } {
    const runtime = Math.floor((Date.now() - this.stats.startedAt) / 1000);
    const avgProfit = this.stats.sandwichesExecuted > 0
      ? formatEther(this.stats.totalProfitWei / BigInt(this.stats.sandwichesExecuted))
      : '0';

    return {
      ...this.stats,
      runtime,
      avgProfitPerSandwich: avgProfit,
    };
  }

  /**
   * Print stats report
   */
  printStats(): void {
    const stats = this.getStats();
    
    console.log('\n' + '='.repeat(60));
    console.log('MEV STRATEGY ENGINE STATS');
    console.log('='.repeat(60));
    
    console.log(`\nRUNTIME: ${Math.floor(stats.runtime / 60)}m ${stats.runtime % 60}s`);
    
    console.log(`\nBUNDLES`);
    console.log(`   Submitted:     ${stats.bundlesSubmitted}`);
    console.log(`   Included:      ${stats.bundlesIncluded}`);
    console.log(`   Failed:        ${stats.failedBundles}`);
    console.log(`   Inclusion %:   ${stats.bundlesSubmitted > 0 ? ((stats.bundlesIncluded / stats.bundlesSubmitted) * 100).toFixed(1) : 0}%`);
    
    console.log(`\nSANDWICHES`);
    console.log(`   Executed:      ${stats.sandwichesExecuted}`);
    console.log(`   Avg Profit:    ${stats.avgProfitPerSandwich} ETH`);
    
    console.log(`\nPROFIT`);
    console.log(`   Gross:         ${formatEther(stats.totalProfitWei)} ETH`);
    console.log(`   Refunded:      ${formatEther(stats.totalRefundedWei)} ETH (${this.config.mevShareRefundPercent}%)`);
    console.log(`   Net:           ${formatEther(stats.totalProfitWei - stats.totalRefundedWei)} ETH`);
    
    console.log(`\nPROTECTION`);
    console.log(`   Protected TXs: ${stats.protectedTxs}`);
    
    console.log('='.repeat(60) + '\n');
  }
}

