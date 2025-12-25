/**
 * Atomic Liquidation Bundles
 *
 * Executes liquidations atomically with flash loans:
 * 1. Query The Graph for liquidatable positions
 * 2. Flash loan the repay amount
 * 3. Liquidate and receive collateral
 * 4. Swap collateral to repay flash loan
 * 5. Keep profit
 *
 * Full implementation with subgraph integration.
 */

import { EventEmitter } from 'node:events'
import {
  type Address,
  encodeFunctionData,
  type Hash,
  type Hex,
  type PublicClient,
  parseAbi,
  type WalletClient,
} from 'viem'
import { z } from 'zod'

// Zod schemas for subgraph responses
const AaveUserReserveSchema = z.object({
  currentATokenBalance: z.string(),
  currentVariableDebt: z.string(),
  reserve: z.object({
    symbol: z.string(),
    underlyingAsset: z.string(),
    liquidationBonus: z.string(),
    price: z.object({ priceInEth: z.string() }),
  }),
})

const AaveUserSchema = z.object({
  id: z.string(),
  healthFactor: z.string(),
  totalBorrowsUSD: z.string(),
  totalCollateralUSD: z.string(),
  reserves: z.array(AaveUserReserveSchema),
})

const AaveSubgraphResponseSchema = z.object({
  data: z
    .object({
      users: z.array(AaveUserSchema),
    })
    .optional(),
})

export interface LiquidatorConfig {
  chainId: number
  minProfitUsd: number
  maxGasPrice: bigint
  protocols: LiquidationProtocol[]
  flashLoanProvider: 'aave' | 'balancer'
  liquidatorContract: Address
  subgraphUrls: Record<string, string>
  ethPriceUsd: number
  checkIntervalMs: number
}

interface LiquidationProtocol {
  name: string
  poolAddress: Address
  type: 'aave' | 'compound' | 'morpho'
  subgraphName: string
}

interface LiquidatablePosition {
  id: string
  protocol: string
  user: Address
  debtToken: Address
  collateralToken: Address
  debtAmount: bigint
  collateralAmount: bigint
  healthFactor: number
  liquidationBonus: number
  debtTokenPrice: number
  collateralTokenPrice: number
}

interface LiquidationBundle {
  position: LiquidatablePosition
  flashLoanAmount: bigint
  expectedProfit: bigint
  profitUsd: number
  gasEstimate: bigint
  callData: Hex
}

interface LiquidationResult {
  success: boolean
  txHash?: Hash
  profit?: bigint
  gasUsed?: bigint
  error?: string
}

// ABIs
const AAVE_POOL_ABI = parseAbi([
  'function getUserAccountData(address user) view returns (uint256 totalCollateralETH, uint256 totalDebtETH, uint256 availableBorrowsETH, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'function liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken) external',
  'function getReserveData(address asset) view returns ((uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))',
])

const AAVE_FLASHLOAN_ABI = parseAbi([
  'function flashLoan(address receiverAddress, address[] assets, uint256[] amounts, uint256[] modes, address onBehalfOf, bytes params, uint16 referralCode)',
])

const BALANCER_VAULT_ABI = parseAbi([
  'function flashLoan(address recipient, address[] tokens, uint256[] amounts, bytes userData)',
])

const _ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
])

// Protocol addresses
const AAVE_V3_POOL: Record<number, Address> = {
  1: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
  8453: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  42161: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
}

const BALANCER_VAULT: Record<number, Address> = {
  1: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  8453: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  42161: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
}

// Subgraph queries
const AAVE_POSITIONS_QUERY = `
  query GetLiquidatablePositions($minHealth: BigDecimal!) {
    users(
      first: 100
      where: { borrowedReservesCount_gt: 0 }
      orderBy: healthFactor
      orderDirection: asc
    ) {
      id
      healthFactor
      totalBorrowsUSD
      totalCollateralUSD
      reserves {
        currentATokenBalance
        currentVariableDebt
        reserve {
          symbol
          underlyingAsset
          liquidationBonus
          price {
            priceInEth
          }
        }
      }
    }
  }
`

export class AtomicLiquidator extends EventEmitter {
  private config: LiquidatorConfig
  private client: PublicClient
  private wallet: WalletClient
  private running = false
  private watchedPositions: Map<string, LiquidatablePosition> = new Map()
  private stats = {
    checks: 0,
    found: 0,
    attempts: 0,
    successes: 0,
    totalProfit: 0n,
    totalGas: 0n,
  }
  private checkInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    config: LiquidatorConfig,
    client: PublicClient,
    wallet: WalletClient,
  ) {
    super()
    this.config = config
    this.client = client
    this.wallet = wallet
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    console.log(
      `⚡ Atomic Liquidator: monitoring ${this.config.protocols.length} protocols`,
    )

    // Start monitoring loop
    this.checkInterval = setInterval(
      () => this.checkPositions(),
      this.config.checkIntervalMs,
    )

    // Initial check
    await this.checkPositions()
  }

  stop(): void {
    this.running = false
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
  }

  private async checkPositions(): Promise<void> {
    this.stats.checks++

    for (const protocol of this.config.protocols) {
      try {
        const positions = await this.getAtRiskPositions(protocol)
        this.stats.found += positions.length

        for (const position of positions) {
          if (position.healthFactor < 1) {
            this.watchedPositions.set(position.id, position)

            const bundle = await this.createBundle(position)
            if (bundle && bundle.profitUsd >= this.config.minProfitUsd) {
              const result = await this.executeLiquidation(bundle)
              this.emit('liquidation-result', { position, bundle, result })
            }
          }
        }
      } catch (error) {
        console.error(`Error checking ${protocol.name}:`, error)
      }
    }
  }

  private async getAtRiskPositions(
    protocol: LiquidationProtocol,
  ): Promise<LiquidatablePosition[]> {
    const positions: LiquidatablePosition[] = []

    if (protocol.type === 'aave') {
      // Query subgraph for at-risk positions
      const subgraphUrl = this.config.subgraphUrls[protocol.subgraphName]
      if (subgraphUrl) {
        try {
          const response = await fetch(subgraphUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: AAVE_POSITIONS_QUERY,
              variables: { minHealth: '1.0' },
            }),
          })

          const parsed = AaveSubgraphResponseSchema.safeParse(
            await response.json(),
          )

          if (parsed.success && parsed.data.data?.users) {
            for (const user of parsed.data.data.users) {
              const healthFactor = parseFloat(user.healthFactor)

              if (healthFactor < 1.05) {
                // Check positions close to liquidation
                // Find the largest debt position
                const debtReserve = user.reserves
                  .filter((r) => parseFloat(r.currentVariableDebt) > 0)
                  .sort(
                    (a, b) =>
                      parseFloat(b.currentVariableDebt) -
                      parseFloat(a.currentVariableDebt),
                  )[0]

                // Find the largest collateral position
                const collateralReserve = user.reserves
                  .filter((r) => parseFloat(r.currentATokenBalance) > 0)
                  .sort(
                    (a, b) =>
                      parseFloat(b.currentATokenBalance) -
                      parseFloat(a.currentATokenBalance),
                  )[0]

                if (debtReserve && collateralReserve) {
                  positions.push({
                    id: `${protocol.name}-${user.id}`,
                    protocol: protocol.name,
                    user: user.id as Address,
                    debtToken: debtReserve.reserve.underlyingAsset as Address,
                    collateralToken: collateralReserve.reserve
                      .underlyingAsset as Address,
                    debtAmount: BigInt(
                      Math.floor(
                        parseFloat(debtReserve.currentVariableDebt) * 1e18,
                      ),
                    ),
                    collateralAmount: BigInt(
                      Math.floor(
                        parseFloat(collateralReserve.currentATokenBalance) *
                          1e18,
                      ),
                    ),
                    healthFactor,
                    liquidationBonus:
                      parseFloat(collateralReserve.reserve.liquidationBonus) /
                      10000,
                    debtTokenPrice: parseFloat(
                      debtReserve.reserve.price.priceInEth,
                    ),
                    collateralTokenPrice: parseFloat(
                      collateralReserve.reserve.price.priceInEth,
                    ),
                  })
                }
              }
            }
          }
        } catch (error) {
          console.warn(`Subgraph query failed for ${protocol.name}:`, error)
        }
      }

      // Also check on-chain for any positions we're watching
      for (const [id, position] of this.watchedPositions) {
        if (position.protocol === protocol.name) {
          try {
            const accountData = await this.client.readContract({
              address: protocol.poolAddress,
              abi: AAVE_POOL_ABI,
              functionName: 'getUserAccountData',
              args: [position.user],
            })

            const healthFactor = Number(accountData[5]) / 1e18

            if (healthFactor < 1) {
              position.healthFactor = healthFactor
              positions.push(position)
            } else if (healthFactor > 1.1) {
              // Position is safe, stop watching
              this.watchedPositions.delete(id)
            }
          } catch {
            // User might not have positions anymore
            this.watchedPositions.delete(id)
          }
        }
      }
    }

    return positions
  }

  private async createBundle(
    position: LiquidatablePosition,
  ): Promise<LiquidationBundle | null> {
    // Calculate liquidation amount (max 50% of debt)
    const maxLiquidation = position.debtAmount / 2n

    // Calculate expected collateral received
    const collateralValue =
      (Number(maxLiquidation) * position.debtTokenPrice) /
      position.collateralTokenPrice
    const expectedCollateral = BigInt(
      Math.floor(collateralValue * (1 + position.liquidationBonus)),
    )

    // Calculate profit
    const collateralValueUsd =
      (Number(expectedCollateral) / 1e18) *
      position.collateralTokenPrice *
      this.config.ethPriceUsd
    const debtValueUsd =
      (Number(maxLiquidation) / 1e18) *
      position.debtTokenPrice *
      this.config.ethPriceUsd

    const profitUsd = collateralValueUsd - debtValueUsd

    // Estimate gas (flash loan + liquidation + swap = ~600k)
    const gasEstimate = 600000n
    const gasCostUsd =
      ((Number(gasEstimate) * Number(await this.client.getGasPrice())) / 1e18) *
      this.config.ethPriceUsd

    const netProfitUsd = profitUsd - gasCostUsd

    if (netProfitUsd < this.config.minProfitUsd) {
      return null
    }

    // Build flash loan calldata
    const callData = this.buildLiquidationCallData(position, maxLiquidation)

    return {
      position,
      flashLoanAmount: maxLiquidation,
      expectedProfit: expectedCollateral - maxLiquidation,
      profitUsd: netProfitUsd,
      gasEstimate,
      callData,
    }
  }

  private buildLiquidationCallData(
    position: LiquidatablePosition,
    amount: bigint,
  ): Hex {
    // Encode the liquidation call that our contract will execute
    // The contract needs to:
    // 1. Receive flash loan
    // 2. Approve and call liquidationCall
    // 3. Swap collateral for debt token
    // 4. Repay flash loan
    // 5. Transfer profit

    const liquidationParams = encodeFunctionData({
      abi: AAVE_POOL_ABI,
      functionName: 'liquidationCall',
      args: [
        position.collateralToken,
        position.debtToken,
        position.user,
        amount,
        false, // Don't receive aToken
      ],
    })

    return liquidationParams
  }

  private async executeLiquidation(
    bundle: LiquidationBundle,
  ): Promise<LiquidationResult> {
    this.stats.attempts++

    const [account] = await this.wallet.getAddresses()

    // Check gas price
    const gasPrice = await this.client.getGasPrice()
    if (gasPrice > this.config.maxGasPrice) {
      return { success: false, error: 'Gas price too high' }
    }

    const protocol = this.config.protocols.find(
      (p) => p.name === bundle.position.protocol,
    )
    if (!protocol) {
      return { success: false, error: 'Protocol not found' }
    }

    try {
      console.log(`⚡ Executing liquidation: ${bundle.position.user}`)
      console.log(`   Protocol: ${bundle.position.protocol}`)
      console.log(`   Expected profit: $${bundle.profitUsd.toFixed(2)}`)

      // For Aave, we can use their flash loan directly
      if (this.config.flashLoanProvider === 'aave') {
        const aavePool = AAVE_V3_POOL[this.config.chainId]

        // Simulate first
        await this.client.simulateContract({
          address: aavePool,
          abi: AAVE_FLASHLOAN_ABI,
          functionName: 'flashLoan',
          args: [
            this.config.liquidatorContract,
            [bundle.position.debtToken],
            [bundle.flashLoanAmount],
            [0n], // No debt mode (repay in same tx)
            account,
            bundle.callData,
            0,
          ],
          account,
        })

        // Execute
        const txHash = await this.wallet.writeContract({
          address: aavePool,
          abi: AAVE_FLASHLOAN_ABI,
          functionName: 'flashLoan',
          args: [
            this.config.liquidatorContract,
            [bundle.position.debtToken],
            [bundle.flashLoanAmount],
            [0n],
            account,
            bundle.callData,
            0,
          ],
          account,
          chain: null,
          gas: bundle.gasEstimate,
        })

        const receipt = await this.client.waitForTransactionReceipt({
          hash: txHash,
        })

        if (receipt.status === 'success') {
          this.stats.successes++
          this.stats.totalProfit += bundle.expectedProfit
          this.stats.totalGas += receipt.gasUsed

          console.log(`✅ Liquidation executed: ${txHash}`)

          // Remove from watched positions
          this.watchedPositions.delete(bundle.position.id)

          return {
            success: true,
            txHash,
            profit: bundle.expectedProfit,
            gasUsed: receipt.gasUsed,
          }
        } else {
          return { success: false, txHash, error: 'Transaction reverted' }
        }
      } else {
        // Balancer flash loan
        const balancerVault = BALANCER_VAULT[this.config.chainId]

        const txHash = await this.wallet.writeContract({
          address: balancerVault,
          abi: BALANCER_VAULT_ABI,
          functionName: 'flashLoan',
          args: [
            this.config.liquidatorContract,
            [bundle.position.debtToken],
            [bundle.flashLoanAmount],
            bundle.callData,
          ],
          account,
          chain: null,
          gas: bundle.gasEstimate,
        })

        const receipt = await this.client.waitForTransactionReceipt({
          hash: txHash,
        })

        if (receipt.status === 'success') {
          this.stats.successes++
          this.stats.totalProfit += bundle.expectedProfit
          this.stats.totalGas += receipt.gasUsed

          return {
            success: true,
            txHash,
            profit: bundle.expectedProfit,
            gasUsed: receipt.gasUsed,
          }
        } else {
          return { success: false, txHash, error: 'Transaction reverted' }
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error(`Liquidation failed: ${errorMsg}`)
      return { success: false, error: errorMsg }
    }
  }

  getStats(): {
    watchedPositions: number
    checks: number
    found: number
    attempts: number
    successes: number
    successRate: number
    totalProfit: bigint
    totalGas: bigint
  } {
    return {
      watchedPositions: this.watchedPositions.size,
      ...this.stats,
      successRate:
        this.stats.attempts > 0
          ? this.stats.successes / this.stats.attempts
          : 0,
    }
  }
}
