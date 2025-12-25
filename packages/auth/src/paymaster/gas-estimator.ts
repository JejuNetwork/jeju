/**
 * Gas Estimator
 *
 * Provides gas estimation for transactions.
 */

import { type Address, createPublicClient, type Hex, http } from 'viem'
import type { GasEstimate, GasEstimatorConfig } from './types.js'

/**
 * Recommended gas limits for common operations
 */
const RECOMMENDED_GAS: Record<string, bigint> = {
  transfer: 21_000n,
  swap: 200_000n,
  mint: 150_000n,
  approve: 50_000n,
}

/**
 * Gas Estimator
 *
 * Provides gas estimates for transactions on EVM chains.
 */
export class GasEstimator {
  private readonly rpcUrl: string
  private readonly chainId: number

  constructor(config: GasEstimatorConfig) {
    this.rpcUrl = config.rpcUrl
    this.chainId = config.chainId
  }

  /**
   * Estimate gas for a transaction
   */
  async estimateTransaction(
    from: Address,
    to: Address,
    data: Hex,
    value = 0n,
  ): Promise<GasEstimate> {
    const client = createPublicClient({
      transport: http(this.rpcUrl),
    })

    const gasLimit = await client.estimateGas({
      account: from,
      to,
      data,
      value,
    })

    const feeData = await client.estimateFeesPerGas()
    const maxFeePerGas = feeData.maxFeePerGas ?? 0n
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n
    const totalCost = gasLimit * maxFeePerGas

    return {
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
      totalCost,
    }
  }

  /**
   * Estimate gas for a simple ETH transfer
   */
  async estimateTransfer(
    _from: Address,
    _to: Address,
    _value: bigint,
  ): Promise<GasEstimate> {
    const client = createPublicClient({
      transport: http(this.rpcUrl),
    })

    // Simple transfers use 21000 gas
    const gasLimit = 21000n

    const feeData = await client.estimateFeesPerGas()
    const maxFeePerGas = feeData.maxFeePerGas ?? 0n
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n
    const totalCost = gasLimit * maxFeePerGas

    return {
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
      totalCost,
    }
  }

  /**
   * Estimate gas for a contract deployment
   */
  async estimateDeployment(from: Address, bytecode: Hex): Promise<GasEstimate> {
    const client = createPublicClient({
      transport: http(this.rpcUrl),
    })

    const gasLimit = await client.estimateGas({
      account: from,
      data: bytecode,
    })

    const feeData = await client.estimateFeesPerGas()
    const maxFeePerGas = feeData.maxFeePerGas ?? 0n
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n
    const totalCost = gasLimit * maxFeePerGas

    return {
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
      totalCost,
    }
  }

  /**
   * Get current gas prices with tiers
   */
  async getGasPrices(): Promise<{
    slow: bigint
    standard: bigint
    fast: bigint
    instant: bigint
  }> {
    const client = createPublicClient({
      transport: http(this.rpcUrl),
    })

    const gasPrice = await client.getGasPrice()

    return {
      slow: (gasPrice * 80n) / 100n,
      standard: gasPrice,
      fast: (gasPrice * 120n) / 100n,
      instant: (gasPrice * 150n) / 100n,
    }
  }

  /**
   * Check if an address has sufficient gas
   */
  async hasSufficientGas(
    address: Address,
    requiredGas: bigint,
  ): Promise<boolean> {
    const client = createPublicClient({
      transport: http(this.rpcUrl),
    })

    const balance = await client.getBalance({ address })
    return balance >= requiredGas
  }

  /**
   * Get recommended gas for common operations
   */
  getRecommendedGas(
    operation: 'transfer' | 'swap' | 'mint' | 'approve',
  ): bigint {
    return RECOMMENDED_GAS[operation] ?? 100_000n
  }

  /**
   * Get the configured RPC URL
   */
  getRpcUrl(): string {
    return this.rpcUrl
  }

  /**
   * Get the configured chain ID
   */
  getChainId(): number {
    return this.chainId
  }
}

/**
 * Create a gas estimator instance
 */
export function createGasEstimator(config: GasEstimatorConfig): GasEstimator {
  return new GasEstimator(config)
}
