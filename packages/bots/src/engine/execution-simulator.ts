/**
 * Local Execution Simulation with eth_call
 *
 * Simulates trades before execution to:
 * - Verify profitability
 * - Detect reverts
 * - Calculate exact gas usage
 * - Find optimal parameters
 */

import {
  type Address,
  encodeFunctionData,
  type Hex,
  type PublicClient,
  parseAbi,
} from 'viem'

interface SimulationResult {
  success: boolean
  returnData: Hex
  gasUsed: bigint
  revertReason?: string
  outputAmount?: bigint
  profit?: bigint
}

interface SwapSimulationParams {
  router: Address
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  minAmountOut: bigint
  path: Address[]
  deadline: bigint
}

interface MultiCallSimulation {
  target: Address
  callData: Hex
  value?: bigint
}

const UNISWAP_V2_ROUTER_ABI = parseAbi([
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[])',
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])',
])

const _UNISWAP_V3_QUOTER_ABI = parseAbi([
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) returns (uint256 amountOut)',
])

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
])

export class ExecutionSimulator {
  constructor(private client: PublicClient) {}

  /**
   * Simulate a single swap
   */
  async simulateSwap(
    params: SwapSimulationParams,
    from: Address,
  ): Promise<SimulationResult> {
    const callData = encodeFunctionData({
      abi: UNISWAP_V2_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [
        params.amountIn,
        params.minAmountOut,
        params.path,
        from,
        params.deadline,
      ],
    })

    return this.simulate(
      {
        target: params.router,
        callData,
        value: 0n,
      },
      from,
    )
  }

  /**
   * Simulate arbitrary call
   */
  async simulate(
    call: MultiCallSimulation,
    from: Address,
  ): Promise<SimulationResult> {
    try {
      const result = await this.client.call({
        to: call.target,
        data: call.callData,
        value: call.value ?? 0n,
        account: from,
      })

      // Estimate gas for successful call
      const gasEstimate = await this.client.estimateGas({
        to: call.target,
        data: call.callData,
        value: call.value ?? 0n,
        account: from,
      })

      return {
        success: true,
        returnData: result.data ?? '0x',
        gasUsed: gasEstimate,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        returnData: '0x',
        gasUsed: 0n,
        revertReason: this.parseRevertReason(errorMsg),
      }
    }
  }

  /**
   * Simulate multicall bundle
   */
  async simulateBundle(
    calls: MultiCallSimulation[],
    from: Address,
  ): Promise<SimulationResult[]> {
    const results: SimulationResult[] = []

    for (const call of calls) {
      const result = await this.simulate(call, from)
      results.push(result)

      if (!result.success) {
        break
      }
    }

    return results
  }

  /**
   * Quote swap output without execution
   */
  async quoteSwap(
    router: Address,
    amountIn: bigint,
    path: Address[],
  ): Promise<bigint[]> {
    const result = await this.client.readContract({
      address: router,
      abi: UNISWAP_V2_ROUTER_ABI,
      functionName: 'getAmountsOut',
      args: [amountIn, path],
    })

    return [...result]
  }

  /**
   * Check token balances and allowances
   */
  async checkPrerequisites(
    token: Address,
    owner: Address,
    spender: Address,
    requiredAmount: bigint,
  ): Promise<{
    hasBalance: boolean
    hasAllowance: boolean
    balance: bigint
    allowance: bigint
  }> {
    const [balance, allowance] = await Promise.all([
      this.client.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [owner],
      }),
      this.client.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [owner, spender],
      }),
    ])

    return {
      hasBalance: balance >= requiredAmount,
      hasAllowance: allowance >= requiredAmount,
      balance,
      allowance,
    }
  }

  /**
   * Simulate arbitrage profitability
   */
  async simulateArbitrage(
    buyRouter: Address,
    sellRouter: Address,
    tokenIn: Address,
    tokenMid: Address,
    amountIn: bigint,
    from: Address,
  ): Promise<{
    profit: bigint
    buyOutput: bigint
    sellOutput: bigint
    gasCost: bigint
  }> {
    // Quote buy
    const buyAmounts = await this.quoteSwap(buyRouter, amountIn, [
      tokenIn,
      tokenMid,
    ])
    const buyOutput = buyAmounts[buyAmounts.length - 1]

    // Quote sell
    const sellAmounts = await this.quoteSwap(sellRouter, buyOutput, [
      tokenMid,
      tokenIn,
    ])
    const sellOutput = sellAmounts[sellAmounts.length - 1]

    // Estimate gas for both swaps
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300)

    const [buyGas, sellGas] = await Promise.all([
      this.simulate(
        {
          target: buyRouter,
          callData: encodeFunctionData({
            abi: UNISWAP_V2_ROUTER_ABI,
            functionName: 'swapExactTokensForTokens',
            args: [amountIn, 0n, [tokenIn, tokenMid], from, deadline],
          }),
        },
        from,
      ),
      this.simulate(
        {
          target: sellRouter,
          callData: encodeFunctionData({
            abi: UNISWAP_V2_ROUTER_ABI,
            functionName: 'swapExactTokensForTokens',
            args: [buyOutput, 0n, [tokenMid, tokenIn], from, deadline],
          }),
        },
        from,
      ),
    ])

    const gasCost = buyGas.gasUsed + sellGas.gasUsed

    return {
      profit: sellOutput - amountIn,
      buyOutput,
      sellOutput,
      gasCost,
    }
  }

  /**
   * Find optimal input amount for arbitrage
   */
  async findOptimalAmount(
    buyRouter: Address,
    sellRouter: Address,
    tokenIn: Address,
    tokenMid: Address,
    minAmount: bigint,
    maxAmount: bigint,
    from: Address,
    iterations: number = 10,
  ): Promise<{ optimalAmount: bigint; maxProfit: bigint }> {
    let left = minAmount
    let right = maxAmount
    let optimalAmount = minAmount
    let maxProfit = 0n

    for (let i = 0; i < iterations; i++) {
      const mid1 = left + (right - left) / 3n
      const mid2 = right - (right - left) / 3n

      const [result1, result2] = await Promise.all([
        this.simulateArbitrage(
          buyRouter,
          sellRouter,
          tokenIn,
          tokenMid,
          mid1,
          from,
        ),
        this.simulateArbitrage(
          buyRouter,
          sellRouter,
          tokenIn,
          tokenMid,
          mid2,
          from,
        ),
      ])

      if (result1.profit > result2.profit) {
        right = mid2
        if (result1.profit > maxProfit) {
          maxProfit = result1.profit
          optimalAmount = mid1
        }
      } else {
        left = mid1
        if (result2.profit > maxProfit) {
          maxProfit = result2.profit
          optimalAmount = mid2
        }
      }
    }

    return { optimalAmount, maxProfit }
  }

  private parseRevertReason(error: string): string {
    const match = error.match(/reverted with reason string '(.+?)'/)
    if (match) return match[1]

    const panicMatch = error.match(/Panic\((0x[0-9a-f]+)\)/)
    if (panicMatch) {
      const code = parseInt(panicMatch[1], 16)
      const reasons: Record<number, string> = {
        1: 'Assertion failed',
        17: 'Arithmetic overflow',
        18: 'Division by zero',
        33: 'Invalid enum value',
        34: 'Storage access error',
        49: 'Pop empty array',
        50: 'Array out of bounds',
        65: 'Out of memory',
        81: 'Uninitialized function',
      }
      return reasons[code] ?? `Panic(${panicMatch[1]})`
    }

    return error.slice(0, 100)
  }
}

export function createExecutionSimulator(
  client: PublicClient,
): ExecutionSimulator {
  return new ExecutionSimulator(client)
}
