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
  serializeTransaction,
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
import { MevBundler, type BundleTransaction } from './bundler';

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
  useFlashbots?: boolean;
}

interface ExecutionContext {
  opportunity: Opportunity;
  startTime: number;
  gasPrice: bigint;
  nonce: number;
}

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

export class TransactionExecutor {
  private walletClients: Map<ChainId, WalletClient> = new Map();
  private publicClients: Map<ChainId, PublicClient> = new Map();
  private bundlers: Map<ChainId, MevBundler> = new Map();
  private account: Account;
  private pendingExecutions: Map<string, ExecutionContext> = new Map();
  private nonces: Map<ChainId, number> = new Map();
  private contractAddresses: Map<ChainId, ContractAddresses> = new Map();
  private config: ExecutorConfig;
  private useFlashbots: boolean;

  constructor(private chainConfigs: ChainConfig[], config: ExecutorConfig) {
    this.config = config;
    this.account = privateKeyToAccount(config.privateKey as `0x${string}`);
    this.useFlashbots = config.useFlashbots ?? true;
    if (config.contractAddresses) {
      for (const [chainId, addresses] of Object.entries(config.contractAddresses)) {
        this.contractAddresses.set(Number(chainId) as ChainId, addresses);
      }
    }
  }

  setContractAddresses(chainId: ChainId, addresses: ContractAddresses): void {
    this.contractAddresses.set(chainId, addresses);
  }

  private getContractAddress(chainId: ChainId, contract: keyof ContractAddresses): string | null {
    const addr = this.contractAddresses.get(chainId)?.[contract];
    return addr && addr !== ZERO_ADDRESS ? addr : null;
  }

  async initialize(): Promise<void> {
    console.log('🔑 Initializing executor...');
    console.log(`   Wallet: ${this.account.address}`);
    console.log(`   Flashbots: ${this.useFlashbots ? 'enabled' : 'disabled'}`);

    for (const chainConfig of this.chainConfigs) {
      const chain = this.getChainDef(chainConfig.chainId);
      const publicClient = createPublicClient({ chain, transport: http(chainConfig.rpcUrl) });
      const walletClient = createWalletClient({ account: this.account, chain, transport: http(chainConfig.rpcUrl) });

      this.publicClients.set(chainConfig.chainId, publicClient);
      this.walletClients.set(chainConfig.chainId, walletClient);

      if (this.useFlashbots) {
        const bundler = new MevBundler(this.config.privateKey, chainConfig.chainId);
        if (bundler.hasFlashbotsSupport) {
          this.bundlers.set(chainConfig.chainId, bundler);
          console.log(`   ${chainConfig.name}: Flashbots ${bundler.isL2 ? '(L2 builder)' : '(mainnet relay)'}`);
        }
      }

      const nonce = await publicClient.getTransactionCount({ address: this.account.address });
      this.nonces.set(chainConfig.chainId, nonce);

      const balance = await publicClient.getBalance({ address: this.account.address });
      console.log(`   ${chainConfig.name}: ${(Number(balance) / 1e18).toFixed(4)} ETH, nonce: ${nonce}`);
    }
  }

  async execute(opportunity: Opportunity): Promise<ExecutionResult> {
    const startTime = Date.now();

    if (this.pendingExecutions.size >= this.config.maxConcurrentExecutions) {
      return this.failResult(opportunity, 'Max concurrent executions', startTime);
    }

    const chainId = this.getOpportunityChainId(opportunity);
    const walletClient = this.walletClients.get(chainId);
    const publicClient = this.publicClients.get(chainId);

    if (!walletClient || !publicClient) {
      return this.failResult(opportunity, `Chain ${chainId} not configured`, startTime);
    }

    const gasPrice = await this.getOptimalGasPrice(publicClient);
    const maxGas = parseEther(this.config.maxGasGwei.toString()) / 1_000_000_000n;
    if (gasPrice > maxGas) {
      return this.failResult(opportunity, `Gas too high: ${gasPrice} > ${maxGas}`, startTime);
    }

    const context: ExecutionContext = {
      opportunity,
      startTime,
      gasPrice,
      nonce: this.getAndIncrementNonce(chainId),
    };
    this.pendingExecutions.set(opportunity.id, context);

    try {
      switch (opportunity.type) {
        case 'DEX_ARBITRAGE':
          return await this.executeArbitrage(opportunity, walletClient, publicClient, context);
        case 'SANDWICH':
          return await this.executeSandwich(opportunity, walletClient, publicClient, context);
        case 'LIQUIDATION':
          return await this.executeLiquidation(opportunity, walletClient, publicClient, context);
        default:
          return this.failResult(opportunity, 'Unknown opportunity type', startTime);
      }
    } finally {
      this.pendingExecutions.delete(opportunity.id);
    }
  }

  async simulate(chainId: ChainId, to: string, data: string, value: bigint = 0n): Promise<{ success: boolean; gasUsed?: bigint; error?: string }> {
    const publicClient = this.publicClients.get(chainId);
    if (!publicClient) return { success: false, error: 'Chain not configured' };

    await publicClient.call({ account: this.account.address, to: to as `0x${string}`, data: data as `0x${string}`, value });
    const gasUsed = await publicClient.estimateGas({ account: this.account.address, to: to as `0x${string}`, data: data as `0x${string}`, value });
    return { success: true, gasUsed };
  }

  getAddress(): string {
    return this.account.address;
  }

  getBundler(chainId: ChainId): MevBundler | undefined {
    return this.bundlers.get(chainId);
  }

  async sendPrivateTransaction(
    chainId: ChainId,
    tx: BundleTransaction,
    hints?: { logs?: boolean; calldata?: boolean; functionSelector?: boolean }
  ): Promise<{ txHash: string; success: boolean; error?: string }> {
    const bundler = this.bundlers.get(chainId);
    if (!bundler) {
      return { txHash: '', success: false, error: 'No bundler for chain' };
    }
    return bundler.sendPrivateTransaction(tx, hints ? { txHash: '0x' as `0x${string}`, ...hints } : undefined);
  }

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

    const simulation = await this.simulate(opportunity.chainId, routerAddress, data);
    if (!simulation.success) {
      return this.failResult(opportunity, `Simulation failed: ${simulation.error}`, context.startTime);
    }

    const hash = await walletClient.sendTransaction({
      to: routerAddress as `0x${string}`,
      data: data as `0x${string}`,
      gas: simulation.gasUsed * 12n / 10n,
      gasPrice: context.gasPrice,
      nonce: context.nonce,
    });

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
      actualProfit: opportunity.expectedProfit,
      executedAt: Date.now(),
      durationMs: Date.now() - context.startTime,
    };
  }

  private async executeSandwich(
    opportunity: SandwichOpportunity,
    walletClient: WalletClient,
    publicClient: PublicClient,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const { frontrunTx, backrunTx } = opportunity;

    const routerAddress = this.getContractAddress(opportunity.chainId, 'xlpRouter');
    if (!routerAddress) {
      return this.failResult(opportunity, `No router for chain ${opportunity.chainId}`, context.startTime);
    }

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

    const bundler = this.bundlers.get(opportunity.chainId);
    
    // Use Flashbots bundle for atomic execution if available
    if (bundler && bundler.hasFlashbotsSupport) {
      return this.executeSandwichWithBundle(opportunity, bundler, publicClient, routerAddress, frontrunData, backrunData, context);
    }

    // Fallback: sequential execution (less reliable, may get frontrun)
    return this.executeSandwichSequential(opportunity, walletClient, publicClient, routerAddress, frontrunData, backrunData, context);
  }

  private async executeSandwichWithBundle(
    opportunity: SandwichOpportunity,
    bundler: MevBundler,
    publicClient: PublicClient,
    routerAddress: string,
    frontrunData: `0x${string}`,
    backrunData: `0x${string}`,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const targetBlock = (await publicClient.getBlockNumber()) + 1n;
    const frontrunGasPrice = context.gasPrice * 15n / 10n;

    const bundleTransactions: BundleTransaction[] = [
      {
        to: routerAddress as `0x${string}`,
        data: frontrunData,
        gas: 300000n,
        maxFeePerGas: frontrunGasPrice,
        maxPriorityFeePerGas: frontrunGasPrice / 10n,
        nonce: context.nonce,
      },
      // Victim TX is already in mempool - it will be included by block builder
      {
        to: routerAddress as `0x${string}`,
        data: backrunData,
        gas: 300000n,
        maxFeePerGas: context.gasPrice,
        maxPriorityFeePerGas: context.gasPrice / 10n,
        nonce: context.nonce + 1,
      },
    ];

    // Simulate bundle first
    const simulation = await bundler.simulateBundle({
      transactions: bundleTransactions,
      targetBlock,
    });

    if (!simulation.success) {
      return this.failResult(opportunity, `Bundle simulation failed: ${simulation.error}`, context.startTime);
    }

    // Check if any tx would revert
    const revertedTx = simulation.results?.find(r => r.revert);
    if (revertedTx) {
      return this.failResult(opportunity, `Bundle tx would revert: ${revertedTx.revert}`, context.startTime);
    }

    // Submit bundle
    const result = await bundler.sendBundle({
      transactions: bundleTransactions,
      targetBlock,
      maxTimestamp: Math.floor(Date.now() / 1000) + 60,
    });

    if (!result.success) {
      return this.failResult(opportunity, `Bundle submission failed: ${result.error}`, context.startTime);
    }

    console.log(`   📦 Sandwich bundle submitted: ${result.bundleHash}`);
    console.log(`      Target block: ${targetBlock}`);
    console.log(`      Simulated gas: ${simulation.totalGasUsed}`);

    // Wait for inclusion (poll for a few blocks)
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const stats = await bundler.getBundleStats(result.bundleHash);
      if (stats.isIncluded) {
        return {
          opportunityId: opportunity.id,
          success: true,
          txHash: result.bundleHash as `0x${string}`,
          blockNumber: stats.blockNumber ? Number(stats.blockNumber) : undefined,
          gasUsed: simulation.totalGasUsed!.toString(),
          actualProfit: opportunity.expectedProfit,
          executedAt: Date.now(),
          durationMs: Date.now() - context.startTime,
        };
      }
    }

    return this.failResult(opportunity, 'Bundle not included within timeout', context.startTime);
  }

  private async executeSandwichSequential(
    opportunity: SandwichOpportunity,
    walletClient: WalletClient,
    publicClient: PublicClient,
    routerAddress: string,
    frontrunData: `0x${string}`,
    backrunData: `0x${string}`,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    console.log('   ⚠️  Executing sandwich without Flashbots (sequential mode)');

    const frontrunGasPrice = context.gasPrice * 15n / 10n;

    const frontrunHash = await walletClient.sendTransaction({
      to: routerAddress as `0x${string}`,
      data: frontrunData,
      gas: 300000n,
      gasPrice: frontrunGasPrice,
      nonce: context.nonce,
    });

    const frontrunReceipt = await publicClient.waitForTransactionReceipt({ hash: frontrunHash, timeout: 15000 });
    if (frontrunReceipt.status === 'reverted') {
      return this.failResult(opportunity, 'Frontrun reverted', context.startTime);
    }

    const backrunHash = await walletClient.sendTransaction({
      to: routerAddress as `0x${string}`,
      data: backrunData,
      gas: 300000n,
      gasPrice: context.gasPrice,
      nonce: context.nonce + 1,
    });

    const backrunReceipt = await publicClient.waitForTransactionReceipt({ hash: backrunHash, timeout: 15000 });

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
  }

  private async executeLiquidation(
    opportunity: LiquidationOpportunity,
    walletClient: WalletClient,
    publicClient: PublicClient,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const perpMarketAddress = this.getContractAddress(opportunity.chainId, 'perpetualMarket');
    if (!perpMarketAddress) {
      return this.failResult(opportunity, `No perp market for chain ${opportunity.chainId}`, context.startTime);
    }

    const data = encodeFunctionData({
      abi: PERPETUAL_MARKET_ABI,
      functionName: 'liquidate',
      args: [opportunity.positionId as `0x${string}`],
    });

    const simulation = await this.simulate(opportunity.chainId, perpMarketAddress, data);
    if (!simulation.success) {
      return this.failResult(opportunity, `Simulation failed: ${simulation.error}`, context.startTime);
    }

    const hash = await walletClient.sendTransaction({
      to: perpMarketAddress as `0x${string}`,
      data: data as `0x${string}`,
      gas: simulation.gasUsed * 12n / 10n,
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
  }

  private getChainDef(chainId: ChainId): Chain {
    if (chainId === 1337) return localnet;
    const chain = CHAIN_DEFS[chainId];
    if (!chain) throw new Error(`Unknown chain ID: ${chainId}`);
    return chain;
  }

  private getOpportunityChainId(opportunity: Opportunity): ChainId {
    return ('chainId' in opportunity) ? opportunity.chainId : 
           ('sourceChainId' in opportunity) ? opportunity.sourceChainId : 1337 as ChainId;
  }

  private async getOptimalGasPrice(publicClient: PublicClient): Promise<bigint> {
    return (await publicClient.getGasPrice()) * BigInt(Math.floor(this.config.gasPriceMultiplier * 100)) / 100n;
  }

  private getAndIncrementNonce(chainId: ChainId): number {
    const nonce = this.nonces.get(chainId)!;
    this.nonces.set(chainId, nonce + 1);
    return nonce;
  }

  private failResult(opportunity: Opportunity, error: string, startTime: number): ExecutionResult {
    return { opportunityId: opportunity.id, success: false, error, executedAt: Date.now(), durationMs: Date.now() - startTime };
  }
}
