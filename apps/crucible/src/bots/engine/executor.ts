import {
  type Account,
  type Chain,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type PublicClient,
  parseEther,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, base, bsc, mainnet, optimism } from 'viem/chains'
import { createLogger } from '../../sdk/logger'
import type {
  ArbitrageOpportunity,
  ChainConfig,
  ChainId,
  LiquidationOpportunity,
  Opportunity,
  OpportunityExecutionResult,
  SandwichOpportunity,
} from '../autocrat-types'
import {
  ERC20_ABI,
  PERPETUAL_MARKET_ABI,
  XLP_ROUTER_ABI,
  ZERO_ADDRESS,
} from '../lib/contracts'
import { type BundleTransaction, MevBundler } from './bundler'

const log = createLogger('Executor')

export interface ContractAddresses {
  xlpRouter?: string
  perpetualMarket?: string
  priceOracle?: string
}

export interface ExecutorConfig {
  privateKey: string
  maxGasGwei: number
  gasPriceMultiplier: number
  simulationTimeout: number
  maxConcurrentExecutions: number
  contractAddresses?: Record<number, ContractAddresses>
  useFlashbots?: boolean
}

interface ExecutionContext {
  opportunity: Opportunity
  startTime: number
  gasPrice: bigint
  nonce: number
}

const CHAIN_DEFS: Record<number, Chain> = {
  1: mainnet,
  42161: arbitrum,
  10: optimism,
  8453: base,
  56: bsc,
}

const localnet: Chain = {
  id: 1337,
  name: 'Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://localhost:9545'] } },
}

export class TransactionExecutor {
  private walletClients: Map<ChainId, WalletClient> = new Map()
  private publicClients: Map<ChainId, PublicClient> = new Map()
  private bundlers: Map<ChainId, MevBundler> = new Map()
  private account: Account
  private pendingExecutions: Map<string, ExecutionContext> = new Map()
  private nonces: Map<ChainId, number> = new Map()
  private contractAddresses: Map<ChainId, ContractAddresses> = new Map()
  private config: ExecutorConfig
  private useFlashbots: boolean

  constructor(
    private chainConfigs: ChainConfig[],
    config: ExecutorConfig,
  ) {
    this.config = config
    this.account = privateKeyToAccount(config.privateKey as `0x${string}`)
    this.useFlashbots = config.useFlashbots ?? true
    if (config.contractAddresses) {
      for (const [chainId, addresses] of Object.entries(
        config.contractAddresses,
      )) {
        this.contractAddresses.set(Number(chainId) as ChainId, addresses)
      }
    }
  }

  setContractAddresses(chainId: ChainId, addresses: ContractAddresses): void {
    this.contractAddresses.set(chainId, addresses)
  }

  private getContractAddress(
    chainId: ChainId,
    contract: keyof ContractAddresses,
  ): string | null {
    const addr = this.contractAddresses.get(chainId)?.[contract]
    return addr && addr !== ZERO_ADDRESS ? addr : null
  }

  async initialize(): Promise<void> {
    log.info('Initializing executor', {
      address: this.account.address,
      flashbots: this.useFlashbots,
    })

    for (const chainConfig of this.chainConfigs) {
      const chain = this.getChainDef(chainConfig.chainId)
      const publicClient = createPublicClient({
        chain,
        transport: http(chainConfig.rpcUrl),
      })
      const walletClient = createWalletClient({
        account: this.account,
        chain,
        transport: http(chainConfig.rpcUrl),
      })

      this.publicClients.set(chainConfig.chainId, publicClient)
      this.walletClients.set(chainConfig.chainId, walletClient)

      if (this.useFlashbots) {
        const bundler = new MevBundler(
          this.config.privateKey,
          chainConfig.chainId,
        )
        if (bundler.hasFlashbotsSupport) {
          this.bundlers.set(chainConfig.chainId, bundler)
          log.info('Flashbots configured', {
            chain: chainConfig.name,
            isL2: bundler.isL2,
          })
        }
      }

      const nonce = await publicClient.getTransactionCount({
        address: this.account.address,
      })
      this.nonces.set(chainConfig.chainId, nonce)

      const balance = await publicClient.getBalance({
        address: this.account.address,
      })
      log.info('Chain initialized', {
        chain: chainConfig.name,
        balance: (Number(balance) / 1e18).toFixed(4),
        nonce,
      })
    }
  }

  async execute(opportunity: Opportunity): Promise<OpportunityExecutionResult> {
    const startTime = Date.now()

    if (this.pendingExecutions.size >= this.config.maxConcurrentExecutions) {
      return this.failResult(
        opportunity,
        'Max concurrent executions',
        startTime,
      )
    }

    const chainId = this.getOpportunityChainId(opportunity)
    const walletClient = this.walletClients.get(chainId)
    const publicClient = this.publicClients.get(chainId)

    if (!walletClient || !publicClient) {
      return this.failResult(
        opportunity,
        `Chain ${chainId} not configured`,
        startTime,
      )
    }

    if ('inputToken' in opportunity && 'inputAmount' in opportunity) {
      const inputToken = opportunity.inputToken.address as `0x${string}`
      const inputAmount = BigInt(opportunity.inputAmount)
      const balance = await this.getTokenBalance(
        publicClient,
        inputToken,
        this.account.address,
      )
      if (balance < inputAmount) {
        return this.failResult(
          opportunity,
          `Insufficient balance: have ${balance}, need ${inputAmount}`,
          startTime,
        )
      }
    }

    const gasPrice = await this.getOptimalGasPrice(publicClient)
    const maxGas =
      parseEther(this.config.maxGasGwei.toString()) / 1_000_000_000n
    if (gasPrice > maxGas) {
      return this.failResult(
        opportunity,
        `Gas too high: ${gasPrice} > ${maxGas}`,
        startTime,
      )
    }

    if ('expectedProfit' in opportunity) {
      const estimatedGasCost = BigInt(500000) * gasPrice
      const expectedProfit = BigInt(opportunity.expectedProfit)
      if (estimatedGasCost >= expectedProfit) {
        return this.failResult(
          opportunity,
          `Estimated gas cost ${estimatedGasCost} exceeds expected profit ${expectedProfit}`,
          startTime,
        )
      }
    }

    const context: ExecutionContext = {
      opportunity,
      startTime,
      gasPrice,
      nonce: this.getAndIncrementNonce(chainId),
    }
    this.pendingExecutions.set(opportunity.id, context)

    try {
      switch (opportunity.type) {
        case 'DEX_ARBITRAGE':
          return await this.executeArbitrage(
            opportunity,
            walletClient,
            publicClient,
            context,
          )
        case 'SANDWICH':
          return await this.executeSandwich(
            opportunity,
            walletClient,
            publicClient,
            context,
          )
        case 'LIQUIDATION':
          return await this.executeLiquidation(
            opportunity,
            walletClient,
            publicClient,
            context,
          )
        default:
          return this.failResult(
            opportunity,
            'Unknown opportunity type',
            startTime,
          )
      }
    } finally {
      this.pendingExecutions.delete(opportunity.id)
    }
  }

  async simulate(
    chainId: ChainId,
    to: string,
    data: string,
    value: bigint = 0n,
  ): Promise<{ success: boolean; gasUsed?: bigint; error?: string }> {
    const publicClient = this.publicClients.get(chainId)
    if (!publicClient) return { success: false, error: 'Chain not configured' }

    await publicClient.call({
      account: this.account.address,
      to: to as `0x${string}`,
      data: data as `0x${string}`,
      value,
    })
    const gasUsed = await publicClient.estimateGas({
      account: this.account.address,
      to: to as `0x${string}`,
      data: data as `0x${string}`,
      value,
    })
    return { success: true, gasUsed }
  }

  getAddress(): string {
    return this.account.address
  }

  getBundler(chainId: ChainId): MevBundler | undefined {
    return this.bundlers.get(chainId)
  }

  async sendPrivateTransaction(
    chainId: ChainId,
    tx: BundleTransaction,
    hints?: {
      logs?: boolean
      calldata?: boolean
      contractAddress?: boolean
      functionSelector?: boolean
    },
  ): Promise<{ txHash: string; success: boolean; error?: string }> {
    const bundler = this.bundlers.get(chainId)
    if (!bundler) {
      return { txHash: '', success: false, error: 'No bundler for chain' }
    }
    return bundler.sendPrivateTransaction(tx, hints)
  }

  private async executeArbitrage(
    opportunity: ArbitrageOpportunity,
    walletClient: WalletClient,
    publicClient: PublicClient,
    context: ExecutionContext,
  ): Promise<OpportunityExecutionResult> {
    const { path, inputAmount, expectedOutput: expectedOutputStr } = opportunity
    const expectedOutput = BigInt(expectedOutputStr)

    const routerAddress = this.getContractAddress(
      opportunity.chainId,
      'xlpRouter',
    )
    if (!routerAddress) {
      return this.failResult(
        opportunity,
        `No router configured for chain ${opportunity.chainId}`,
        context.startTime,
      )
    }

    const tokenPath: string[] = []
    for (let i = 0; i < path.length; i++) {
      const pool = path[i]
      if (i === 0) {
        tokenPath.push(pool.token0.address)
      }
      tokenPath.push(pool.token1.address)
    }

    const inputToken = opportunity.inputToken.address as `0x${string}`
    const outputToken = opportunity.outputToken.address as `0x${string}`

    const balanceBefore = await this.getTokenBalance(
      publicClient,
      inputToken,
      this.account.address,
    )
    const outputBalanceBefore = await this.getTokenBalance(
      publicClient,
      outputToken,
      this.account.address,
    )

    const minOutput = (BigInt(expectedOutput) * 995n) / 1000n

    if (balanceBefore < BigInt(inputAmount)) {
      return this.failResult(
        opportunity,
        `Insufficient balance: have ${balanceBefore}, need ${inputAmount}`,
        context.startTime,
      )
    }

    const data = encodeFunctionData({
      abi: XLP_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [
        BigInt(inputAmount),
        minOutput,
        tokenPath as `0x${string}`[],
        this.account.address,
        BigInt(Math.floor(Date.now() / 1000) + 300),
      ],
    })

    const simulation = await this.simulate(
      opportunity.chainId,
      routerAddress,
      data,
    )
    if (!simulation.success || !simulation.gasUsed) {
      return this.failResult(
        opportunity,
        `Simulation failed: ${simulation.error || 'Unknown error'}`,
        context.startTime,
      )
    }

    const gasUsed = simulation.gasUsed
    const estimatedGasCost = gasUsed * context.gasPrice
    const expectedProfitWei = BigInt(opportunity.expectedProfit)
    if (estimatedGasCost >= expectedProfitWei) {
      return this.failResult(
        opportunity,
        `Estimated gas cost ${estimatedGasCost} exceeds expected profit ${expectedProfitWei}`,
        context.startTime,
      )
    }

    const hash = await walletClient.sendTransaction({
      chain: walletClient.chain,
      account: this.account,
      to: routerAddress as `0x${string}`,
      data: data as `0x${string}`,
      gas: (gasUsed * 12n) / 10n,
      gasPrice: context.gasPrice,
      nonce: context.nonce,
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    if (receipt.status === 'reverted') {
      return this.failResult(
        opportunity,
        'Transaction reverted',
        context.startTime,
      )
    }

    const balanceAfter = await this.getTokenBalance(
      publicClient,
      inputToken,
      this.account.address,
    )
    const outputBalanceAfter = await this.getTokenBalance(
      publicClient,
      outputToken,
      this.account.address,
    )

    const inputSpent = balanceBefore - balanceAfter
    const outputReceived = outputBalanceAfter - outputBalanceBefore

    const expectedExchangeRate = BigInt(expectedOutput) / BigInt(inputAmount)
    const outputValueInInputTerms = outputReceived / expectedExchangeRate
    const gasCostWei = receipt.gasUsed * context.gasPrice

    const actualProfit =
      outputValueInInputTerms > inputSpent
        ? outputValueInInputTerms - inputSpent - gasCostWei
        : 0n - gasCostWei

    return {
      opportunityId: opportunity.id,
      success: true,
      txHash: hash,
      blockNumber: Number(receipt.blockNumber),
      gasUsed: receipt.gasUsed.toString(),
      actualProfit: actualProfit.toString(),
      executedAt: Date.now(),
      durationMs: Date.now() - context.startTime,
    }
  }

  private async getTokenBalance(
    publicClient: PublicClient,
    tokenAddress: `0x${string}`,
    accountAddress: `0x${string}`,
  ): Promise<bigint> {
    if (tokenAddress === ZERO_ADDRESS) {
      return await publicClient.getBalance({ address: accountAddress })
    }

    return await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [accountAddress],
    })
  }

  private async executeSandwich(
    opportunity: SandwichOpportunity,
    walletClient: WalletClient,
    publicClient: PublicClient,
    context: ExecutionContext,
  ): Promise<OpportunityExecutionResult> {
    const { frontrunTx, backrunTx } = opportunity

    const routerAddress = this.getContractAddress(
      opportunity.chainId,
      'xlpRouter',
    )
    if (!routerAddress) {
      return this.failResult(
        opportunity,
        `No router for chain ${opportunity.chainId}`,
        context.startTime,
      )
    }

    const inputToken = frontrunTx.path[0] as `0x${string}`

    const balanceBefore = await this.getTokenBalance(
      publicClient,
      inputToken,
      this.account.address,
    )

    if (balanceBefore < BigInt(frontrunTx.amountIn)) {
      return this.failResult(
        opportunity,
        `Insufficient balance for frontrun: have ${balanceBefore}, need ${frontrunTx.amountIn}`,
        context.startTime,
      )
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
    })

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
    })

    const bundler = this.bundlers.get(opportunity.chainId)

    if (bundler?.hasFlashbotsSupport) {
      return this.executeSandwichWithBundle(
        opportunity,
        bundler,
        publicClient,
        routerAddress,
        frontrunData,
        backrunData,
        context,
      )
    }

    return this.executeSandwichSequential(
      opportunity,
      walletClient,
      publicClient,
      routerAddress,
      frontrunData,
      backrunData,
      context,
    )
  }

  private async executeSandwichWithBundle(
    opportunity: SandwichOpportunity,
    bundler: MevBundler,
    publicClient: PublicClient,
    routerAddress: string,
    frontrunData: `0x${string}`,
    backrunData: `0x${string}`,
    context: ExecutionContext,
  ): Promise<OpportunityExecutionResult> {
    const inputToken = opportunity.frontrunTx.path[0] as `0x${string}`
    const outputToken = opportunity.frontrunTx.path[
      opportunity.frontrunTx.path.length - 1
    ] as `0x${string}`

    const balanceBefore = await this.getTokenBalance(
      publicClient,
      inputToken,
      this.account.address,
    )
    const outputBalanceBefore = await this.getTokenBalance(
      publicClient,
      outputToken,
      this.account.address,
    )

    const targetBlock = (await publicClient.getBlockNumber()) + 1n
    const frontrunGasPrice = (context.gasPrice * 15n) / 10n

    const bundleTransactions: BundleTransaction[] = [
      {
        to: routerAddress as `0x${string}`,
        data: frontrunData,
        gas: 300000n,
        maxFeePerGas: frontrunGasPrice,
        maxPriorityFeePerGas: frontrunGasPrice / 10n,
        nonce: context.nonce,
      },
      {
        to: routerAddress as `0x${string}`,
        data: backrunData,
        gas: 300000n,
        maxFeePerGas: context.gasPrice,
        maxPriorityFeePerGas: context.gasPrice / 10n,
        nonce: context.nonce + 1,
      },
    ]

    const simulation = await bundler.simulateBundle({
      transactions: bundleTransactions,
      targetBlock,
    })

    if (!simulation.success) {
      return this.failResult(
        opportunity,
        `Bundle simulation failed: ${simulation.error}`,
        context.startTime,
      )
    }

    const revertedTx = simulation.results?.find((r) => r.revert)
    if (revertedTx) {
      return this.failResult(
        opportunity,
        `Bundle tx would revert: ${revertedTx.revert}`,
        context.startTime,
      )
    }

    const result = await bundler.sendBundle({
      transactions: bundleTransactions,
      targetBlock,
      maxTimestamp: Math.floor(Date.now() / 1000) + 60,
    })

    if (!result.success) {
      return this.failResult(
        opportunity,
        `Bundle submission failed: ${result.error}`,
        context.startTime,
      )
    }

    console.log(
      `📦 Sandwich bundle submitted: ${result.bundleHash} (block ${targetBlock}, gas ${simulation.totalGasUsed})`,
    )

    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      const stats = await bundler.getBundleStats(result.bundleHash)
      if (stats.isIncluded && stats.blockNumber) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        const balanceAfter = await this.getTokenBalance(
          publicClient,
          inputToken,
          this.account.address,
        )
        const outputBalanceAfter = await this.getTokenBalance(
          publicClient,
          outputToken,
          this.account.address,
        )

        const inputSpent = balanceBefore - balanceAfter
        const outputReceived = outputBalanceAfter - outputBalanceBefore

        const totalGasUsed = simulation.totalGasUsed ?? 300000n
        const gasCostWei = totalGasUsed * context.gasPrice
        const actualProfit =
          outputReceived > inputSpent
            ? outputReceived - inputSpent - gasCostWei
            : 0n - gasCostWei

        return {
          opportunityId: opportunity.id,
          success: true,
          txHash: result.bundleHash as `0x${string}`,
          blockNumber: Number(stats.blockNumber),
          gasUsed: totalGasUsed.toString(),
          actualProfit: actualProfit.toString(),
          executedAt: Date.now(),
          durationMs: Date.now() - context.startTime,
        }
      }
    }

    return this.failResult(
      opportunity,
      'Bundle not included within timeout',
      context.startTime,
    )
  }

  private async executeSandwichSequential(
    opportunity: SandwichOpportunity,
    walletClient: WalletClient,
    publicClient: PublicClient,
    routerAddress: string,
    frontrunData: `0x${string}`,
    backrunData: `0x${string}`,
    context: ExecutionContext,
  ): Promise<OpportunityExecutionResult> {
    log.warn('Executing sandwich without Flashbots')

    const inputToken = opportunity.frontrunTx.path[0] as `0x${string}`
    const outputToken = opportunity.frontrunTx.path[
      opportunity.frontrunTx.path.length - 1
    ] as `0x${string}`
    const balanceBefore = await this.getTokenBalance(
      publicClient,
      inputToken,
      this.account.address,
    )
    const outputBalanceBefore = await this.getTokenBalance(
      publicClient,
      outputToken,
      this.account.address,
    )

    const frontrunGasPrice = (context.gasPrice * 15n) / 10n

    const frontrunHash = await walletClient.sendTransaction({
      chain: walletClient.chain,
      account: this.account,
      to: routerAddress as `0x${string}`,
      data: frontrunData,
      gas: 300000n,
      gasPrice: frontrunGasPrice,
      nonce: context.nonce,
    })

    const frontrunReceipt = await publicClient.waitForTransactionReceipt({
      hash: frontrunHash,
      timeout: 15000,
    })
    if (frontrunReceipt.status === 'reverted') {
      return this.failResult(
        opportunity,
        'Frontrun reverted',
        context.startTime,
      )
    }

    const backrunHash = await walletClient.sendTransaction({
      chain: walletClient.chain,
      account: this.account,
      to: routerAddress as `0x${string}`,
      data: backrunData,
      gas: 300000n,
      gasPrice: context.gasPrice,
      nonce: context.nonce + 1,
    })

    const backrunReceipt = await publicClient.waitForTransactionReceipt({
      hash: backrunHash,
      timeout: 15000,
    })

    if (backrunReceipt.status !== 'success') {
      return this.failResult(
        opportunity,
        'Backrun transaction failed',
        context.startTime,
      )
    }

    const balanceAfter = await this.getTokenBalance(
      publicClient,
      inputToken,
      this.account.address,
    )
    const outputBalanceAfter = await this.getTokenBalance(
      publicClient,
      outputToken,
      this.account.address,
    )

    const inputSpent = balanceBefore - balanceAfter
    const outputReceived = outputBalanceAfter - outputBalanceBefore

    const totalGasCost =
      (frontrunReceipt.gasUsed + backrunReceipt.gasUsed) * context.gasPrice
    const actualProfit =
      outputReceived > inputSpent
        ? outputReceived - inputSpent - totalGasCost
        : 0n - totalGasCost

    return {
      opportunityId: opportunity.id,
      success: true,
      txHash: backrunHash,
      blockNumber: Number(backrunReceipt.blockNumber),
      gasUsed: (frontrunReceipt.gasUsed + backrunReceipt.gasUsed).toString(),
      actualProfit: actualProfit.toString(),
      executedAt: Date.now(),
      durationMs: Date.now() - context.startTime,
    }
  }

  private async executeLiquidation(
    opportunity: LiquidationOpportunity,
    walletClient: WalletClient,
    publicClient: PublicClient,
    context: ExecutionContext,
  ): Promise<OpportunityExecutionResult> {
    const perpMarketAddress = this.getContractAddress(
      opportunity.chainId,
      'perpetualMarket',
    )
    if (!perpMarketAddress) {
      return this.failResult(
        opportunity,
        `No perp market for chain ${opportunity.chainId}`,
        context.startTime,
      )
    }

    const balanceBefore = await publicClient.getBalance({
      address: this.account.address,
    })

    const data = encodeFunctionData({
      abi: PERPETUAL_MARKET_ABI,
      functionName: 'liquidate',
      args: [opportunity.positionId as `0x${string}`],
    })

    const simulation = await this.simulate(
      opportunity.chainId,
      perpMarketAddress,
      data,
    )
    if (!simulation.success || !simulation.gasUsed) {
      return this.failResult(
        opportunity,
        `Simulation failed: ${simulation.error}`,
        context.startTime,
      )
    }

    const estimatedGasCost = simulation.gasUsed * context.gasPrice
    const expectedProfitWei = BigInt(opportunity.expectedProfit)
    if (estimatedGasCost >= expectedProfitWei) {
      return this.failResult(
        opportunity,
        `Estimated gas cost ${estimatedGasCost} exceeds expected profit ${expectedProfitWei}`,
        context.startTime,
      )
    }

    const hash = await walletClient.sendTransaction({
      chain: walletClient.chain,
      account: this.account,
      to: perpMarketAddress as `0x${string}`,
      data: data as `0x${string}`,
      gas: (simulation.gasUsed * 12n) / 10n,
      gasPrice: context.gasPrice,
      nonce: context.nonce,
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    if (receipt.status !== 'success') {
      return this.failResult(
        opportunity,
        'Liquidation transaction failed',
        context.startTime,
      )
    }

    const balanceAfter = await publicClient.getBalance({
      address: this.account.address,
    })
    const rewardReceived = balanceAfter - balanceBefore
    const gasCostWei = receipt.gasUsed * context.gasPrice
    const actualProfit = rewardReceived - gasCostWei

    return {
      opportunityId: opportunity.id,
      success: true,
      txHash: hash,
      blockNumber: Number(receipt.blockNumber),
      gasUsed: receipt.gasUsed.toString(),
      actualProfit: actualProfit.toString(),
      executedAt: Date.now(),
      durationMs: Date.now() - context.startTime,
    }
  }

  private getChainDef(chainId: ChainId): Chain {
    if (chainId === 1337) return localnet
    const chain = CHAIN_DEFS[chainId]
    if (!chain) throw new Error(`Unknown chain ID: ${chainId}`)
    return chain
  }

  private getOpportunityChainId(opportunity: Opportunity): ChainId {
    const opportunityId = opportunity.id
    if ('chainId' in opportunity) {
      return opportunity.chainId
    }
    if ('sourceChainId' in opportunity) {
      return opportunity.sourceChainId
    }
    throw new Error(
      `Opportunity ${opportunityId} has no chainId or sourceChainId`,
    )
  }

  private async getOptimalGasPrice(
    publicClient: PublicClient,
  ): Promise<bigint> {
    return (
      ((await publicClient.getGasPrice()) *
        BigInt(Math.floor(this.config.gasPriceMultiplier * 100))) /
      100n
    )
  }

  private getAndIncrementNonce(chainId: ChainId): number {
    const nonce = this.nonces.get(chainId) ?? 0
    this.nonces.set(chainId, nonce + 1)
    return nonce
  }

  private failResult(
    opportunity: Opportunity,
    error: string,
    startTime: number,
  ): OpportunityExecutionResult {
    return {
      opportunityId: opportunity.id,
      success: false,
      error,
      executedAt: Date.now(),
      durationMs: Date.now() - startTime,
    }
  }
}
