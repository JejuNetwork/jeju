/**
 * @fileoverview Transaction Executor
 *
 * Handles execution of MEV opportunities:
 * - Transaction simulation
 * - Gas estimation and optimization
 * - Bundle submission
 * - Execution monitoring
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  type WalletClient,
  type PublicClient,
  type Chain,
  type Account,
  encodeFunctionData,
  parseEther,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, arbitrum, optimism, base, bsc } from 'viem/chains';
import type {
  ChainConfig,
  ChainId,
  Opportunity,
  ExecutionResult,
  ArbitrageOpportunity,
  SandwichOpportunity,
  LiquidationOpportunity,
} from '../types';
import { XLP_ROUTER_ABI, PERPETUAL_MARKET_ABI, ZERO_ADDRESS } from '../lib/contracts';

// ============ Types ============

export interface ContractAddresses {
  xlpRouter?: string;
  perpetualMarket?: string;
  priceOracle?: string;
}

export interface ExecutorConfig {
  privateKey: string;
  maxGasGwei: number;
  gasPriceMultiplier: number;
  simulationTimeout: number;
  maxConcurrentExecutions: number;
  contractAddresses?: Record<number, ContractAddresses>;
}

interface ExecutionContext {
  opportunity: Opportunity;
  startTime: number;
  gasPrice: bigint;
  nonce: number;
}

// ============ Chain Definitions ============

const CHAIN_DEFS: Record<number, Chain> = {
  1: mainnet,
  42161: arbitrum,
  10: optimism,
  8453: base,
  56: bsc,
};

const localnet: Chain = {
  id: 1337,
  name: 'Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://localhost:8545'] } },
};

// ============ Executor Class ============

export class TransactionExecutor {
  private walletClients: Map<ChainId, WalletClient> = new Map();
  private publicClients: Map<ChainId, PublicClient> = new Map();
  private account: Account;
  private pendingExecutions: Map<string, ExecutionContext> = new Map();
  private nonces: Map<ChainId, number> = new Map();
  private contractAddresses: Map<ChainId, ContractAddresses> = new Map();
  private config: ExecutorConfig;

  constructor(
    private chainConfigs: ChainConfig[],
    config: ExecutorConfig
  ) {
    this.config = config;
    this.account = privateKeyToAccount(config.privateKey as `0x${string}`);
    
    // Store contract addresses per chain
    if (config.contractAddresses) {
      for (const [chainId, addresses] of Object.entries(config.contractAddresses)) {
        this.contractAddresses.set(Number(chainId) as ChainId, addresses);
      }
    }
  }

  /**
   * Set contract addresses for a chain
   */
  setContractAddresses(chainId: ChainId, addresses: ContractAddresses): void {
    this.contractAddresses.set(chainId, addresses);
  }

  /**
   * Get contract address for a chain
   */
  private getContractAddress(chainId: ChainId, contract: keyof ContractAddresses): string | null {
    const addresses = this.contractAddresses.get(chainId);
    if (!addresses) return null;
    const addr = addresses[contract];
    if (!addr || addr === ZERO_ADDRESS) return null;
    return addr;
  }

  /**
   * Initialize wallet clients for all chains
   */
  async initialize(): Promise<void> {
    console.log('🔑 Initializing transaction executor...');
    console.log(`   Wallet: ${this.account.address}`);

    for (const chainConfig of this.chainConfigs) {
      const chain = this.getChainDef(chainConfig.chainId);

      const publicClient = createPublicClient({
        chain,
        transport: http(chainConfig.rpcUrl),
      });

      const walletClient = createWalletClient({
        account: this.account,
        chain,
        transport: http(chainConfig.rpcUrl),
      });

      this.publicClients.set(chainConfig.chainId, publicClient);
      this.walletClients.set(chainConfig.chainId, walletClient);

      // Initialize nonce
      const nonce = await publicClient.getTransactionCount({
        address: this.account.address,
      });
      this.nonces.set(chainConfig.chainId, nonce);

      // Check balance
      const balance = await publicClient.getBalance({
        address: this.account.address,
      });
      console.log(
        `   ${chainConfig.name}: ${(Number(balance) / 1e18).toFixed(4)} ETH, nonce: ${nonce}`
      );
    }
  }

  /**
   * Execute an opportunity
   */
  async execute(opportunity: Opportunity): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Check concurrent executions limit
    if (this.pendingExecutions.size >= this.config.maxConcurrentExecutions) {
      return this.failResult(opportunity, 'Max concurrent executions reached', startTime);
    }

    // Get chain-specific clients
    const chainId = this.getOpportunityChainId(opportunity);
    const walletClient = this.walletClients.get(chainId);
    const publicClient = this.publicClients.get(chainId);

    if (!walletClient || !publicClient) {
      return this.failResult(opportunity, `Chain ${chainId} not configured`, startTime);
    }

    // Get current gas price
    const gasPrice = await this.getOptimalGasPrice(publicClient);
    const maxGas = parseEther(this.config.maxGasGwei.toString()) / 1_000_000_000n;

    if (gasPrice > maxGas) {
      return this.failResult(opportunity, `Gas too high: ${gasPrice} > ${maxGas}`, startTime);
    }

    // Get nonce
    const nonce = this.getAndIncrementNonce(chainId);

    // Create execution context
    const context: ExecutionContext = {
      opportunity,
      startTime,
      gasPrice,
      nonce,
    };
    this.pendingExecutions.set(opportunity.id, context);

    try {
      let result: ExecutionResult;

      switch (opportunity.type) {
        case 'DEX_ARBITRAGE':
          result = await this.executeArbitrage(opportunity, walletClient, publicClient, context);
          break;
        case 'SANDWICH':
          result = await this.executeSandwich(opportunity, walletClient, publicClient, context);
          break;
        case 'LIQUIDATION':
          result = await this.executeLiquidation(opportunity, walletClient, publicClient, context);
          break;
        default:
          result = this.failResult(opportunity, 'Unknown opportunity type', startTime);
      }

      return result;
    } finally {
      this.pendingExecutions.delete(opportunity.id);
    }
  }

  /**
   * Simulate a transaction without executing
   */
  async simulate(
    chainId: ChainId,
    to: string,
    data: string,
    value: bigint = 0n
  ): Promise<{ success: boolean; gasUsed?: bigint; error?: string }> {
    const publicClient = this.publicClients.get(chainId);
    if (!publicClient) {
      return { success: false, error: 'Chain not configured' };
    }

    try {
      const result = await publicClient.call({
        account: this.account.address,
        to: to as `0x${string}`,
        data: data as `0x${string}`,
        value,
      });

      const gasUsed = await publicClient.estimateGas({
        account: this.account.address,
        to: to as `0x${string}`,
        data: data as `0x${string}`,
        value,
      });

      return { success: true, gasUsed };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get wallet address
   */
  getAddress(): string {
    return this.account.address;
  }

  // ============ Private Execution Methods ============

  private async executeArbitrage(
    opportunity: ArbitrageOpportunity,
    walletClient: WalletClient,
    publicClient: PublicClient,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const { path, inputAmount, expectedOutput } = opportunity;
    
    // Get router address from config
    const routerAddress = this.getContractAddress(opportunity.chainId, 'xlpRouter');
    if (!routerAddress) {
      return this.failResult(opportunity, `No router configured for chain ${opportunity.chainId}`, context.startTime);
    }

    // Build swap path from pools
    const tokenPath: string[] = [];
    for (let i = 0; i < path.length; i++) {
      const pool = path[i];
      if (i === 0) {
        tokenPath.push(pool.token0.address);
      }
      tokenPath.push(pool.token1.address);
    }

    // Calculate minimum output with slippage
    const minOutput = (BigInt(expectedOutput) * 995n) / 1000n; // 0.5% slippage

    // Encode swap call
    const data = encodeFunctionData({
      abi: XLP_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [
        BigInt(inputAmount),
        minOutput,
        tokenPath as `0x${string}`[],
        this.account.address,
        BigInt(Math.floor(Date.now() / 1000) + 300), // 5 min deadline
      ],
    });

    // Simulate first
    const simulation = await this.simulate(
      opportunity.chainId,
      routerAddress,
      data
    );

    if (!simulation.success) {
      return this.failResult(opportunity, `Simulation failed: ${simulation.error}`, context.startTime);
    }

    // Execute
    try {
      const hash = await walletClient.sendTransaction({
        to: routerAddress as `0x${string}`,
        data: data as `0x${string}`,
        gas: simulation.gasUsed ? simulation.gasUsed * 12n / 10n : 500000n, // +20% buffer
        gasPrice: context.gasPrice,
        nonce: context.nonce,
      });

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'reverted') {
        return this.failResult(opportunity, 'Transaction reverted', context.startTime);
      }

      return {
        opportunityId: opportunity.id,
        success: true,
        txHash: hash,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: receipt.gasUsed.toString(),
        actualProfit: opportunity.expectedProfit, // Would need to calculate actual
        executedAt: Date.now(),
        durationMs: Date.now() - context.startTime,
      };
    } catch (error) {
      return this.failResult(opportunity, String(error), context.startTime);
    }
  }

  private async executeSandwich(
    opportunity: SandwichOpportunity,
    walletClient: WalletClient,
    publicClient: PublicClient,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const { frontrunTx, backrunTx, pool } = opportunity;

    // Get router address from config
    const routerAddress = this.getContractAddress(opportunity.chainId, 'xlpRouter');
    if (!routerAddress) {
      return this.failResult(opportunity, `No router configured for chain ${opportunity.chainId}`, context.startTime);
    }

    // For sandwiches, we need to submit a bundle with:
    // 1. Frontrun TX (our buy)
    // 2. Victim TX (already in mempool)
    // 3. Backrun TX (our sell)

    // In production, this would use Flashbots/MEV-Boost for atomic execution
    // For now, we execute frontrun and backrun with high gas to attempt ordering

    // Frontrun
    const frontrunData = encodeFunctionData({
      abi: XLP_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [
        BigInt(frontrunTx.amountIn),
        BigInt(frontrunTx.amountOutMin),
        frontrunTx.path as `0x${string}`[],
        this.account.address,
        BigInt(Math.floor(Date.now() / 1000) + 60),
      ],
    });

    // Higher gas price to front-run
    const frontrunGasPrice = context.gasPrice * 15n / 10n; // +50%

    try {
      const frontrunHash = await walletClient.sendTransaction({
        to: routerAddress as `0x${string}`,
        data: frontrunData as `0x${string}`,
        gas: 300000n,
        gasPrice: frontrunGasPrice,
        nonce: context.nonce,
      });

      // Wait for frontrun to confirm
      const frontrunReceipt = await publicClient.waitForTransactionReceipt({
        hash: frontrunHash,
        timeout: 15000,
      });

      if (frontrunReceipt.status === 'reverted') {
        return this.failResult(opportunity, 'Frontrun reverted', context.startTime);
      }

      // Backrun
      const backrunData = encodeFunctionData({
        abi: XLP_ROUTER_ABI,
        functionName: 'swapExactTokensForTokens',
        args: [
          BigInt(backrunTx.amountIn),
          BigInt(backrunTx.amountOutMin),
          backrunTx.path as `0x${string}`[],
          this.account.address,
          BigInt(Math.floor(Date.now() / 1000) + 60),
        ],
      });

      const backrunHash = await walletClient.sendTransaction({
        to: routerAddress as `0x${string}`,
        data: backrunData as `0x${string}`,
        gas: 300000n,
        gasPrice: context.gasPrice,
        nonce: context.nonce + 1,
      });

      const backrunReceipt = await publicClient.waitForTransactionReceipt({
        hash: backrunHash,
        timeout: 15000,
      });

      return {
        opportunityId: opportunity.id,
        success: backrunReceipt.status === 'success',
        txHash: backrunHash,
        blockNumber: Number(backrunReceipt.blockNumber),
        gasUsed: (frontrunReceipt.gasUsed + backrunReceipt.gasUsed).toString(),
        actualProfit: opportunity.expectedProfit,
        executedAt: Date.now(),
        durationMs: Date.now() - context.startTime,
      };
    } catch (error) {
      return this.failResult(opportunity, String(error), context.startTime);
    }
  }

  private async executeLiquidation(
    opportunity: LiquidationOpportunity,
    walletClient: WalletClient,
    publicClient: PublicClient,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const { positionId } = opportunity;

    // Get perpetual market address from config
    const perpMarketAddress = this.getContractAddress(opportunity.chainId, 'perpetualMarket');
    if (!perpMarketAddress) {
      return this.failResult(opportunity, `No perpetual market configured for chain ${opportunity.chainId}`, context.startTime);
    }

    // Encode liquidation call
    const data = encodeFunctionData({
      abi: PERPETUAL_MARKET_ABI,
      functionName: 'liquidate',
      args: [positionId as `0x${string}`],
    });

    // Simulate
    const simulation = await this.simulate(opportunity.chainId, perpMarketAddress, data);

    if (!simulation.success) {
      return this.failResult(opportunity, `Simulation failed: ${simulation.error}`, context.startTime);
    }

    try {
      const hash = await walletClient.sendTransaction({
        to: perpMarketAddress as `0x${string}`,
        data: data as `0x${string}`,
        gas: simulation.gasUsed ? simulation.gasUsed * 12n / 10n : 500000n,
        gasPrice: context.gasPrice,
        nonce: context.nonce,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      return {
        opportunityId: opportunity.id,
        success: receipt.status === 'success',
        txHash: hash,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: receipt.gasUsed.toString(),
        actualProfit: opportunity.expectedProfit,
        executedAt: Date.now(),
        durationMs: Date.now() - context.startTime,
      };
    } catch (error) {
      return this.failResult(opportunity, String(error), context.startTime);
    }
  }

  // ============ Helper Methods ============

  private getChainDef(chainId: ChainId): Chain {
    if (chainId === 1337) return localnet;
    return CHAIN_DEFS[chainId] || mainnet;
  }

  private getOpportunityChainId(opportunity: Opportunity): ChainId {
    if ('chainId' in opportunity) {
      return opportunity.chainId;
    }
    if ('sourceChainId' in opportunity) {
      return opportunity.sourceChainId;
    }
    return 1337 as ChainId;
  }

  private async getOptimalGasPrice(publicClient: PublicClient): Promise<bigint> {
    const gasPrice = await publicClient.getGasPrice();
    return (gasPrice * BigInt(Math.floor(this.config.gasPriceMultiplier * 100))) / 100n;
  }

  private getAndIncrementNonce(chainId: ChainId): number {
    const nonce = this.nonces.get(chainId) || 0;
    this.nonces.set(chainId, nonce + 1);
    return nonce;
  }

  private failResult(
    opportunity: Opportunity,
    error: string,
    startTime: number
  ): ExecutionResult {
    return {
      opportunityId: opportunity.id,
      success: false,
      error,
      executedAt: Date.now(),
      durationMs: Date.now() - startTime,
    };
  }
}
