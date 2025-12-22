/**
 * Mathematical utilities for MEV/arbitrage calculations
 *
 * Includes closed-form solutions for optimal arbitrage sizing
 * and various bigint math helpers.
 */

// ============ BigInt Math Helpers ============

/**
 * Calculate integer square root using Newton's method
 */
export function bigintSqrt(n: bigint): bigint {
  if (n < 0n) return 0n
  if (n < 2n) return n

  let x = n
  let y = (x + 1n) / 2n
  while (y < x) {
    x = y
    y = (x + n / x) / 2n
  }
  return x
}

/**
 * Calculate nth root approximation
 */
export function bigintNthRoot(value: bigint, n: bigint): bigint {
  if (n === 1n) return value
  if (n === 2n) return bigintSqrt(value)

  let x = value
  let x1 = (value + 1n) / 2n

  while (x1 < x) {
    x = x1
    const xPowN1 = bigintPow(x, n - 1n)
    if (xPowN1 === 0n) break
    x1 = ((n - 1n) * x + value / xPowN1) / n
  }

  return x
}

/**
 * Calculate power (x^n)
 */
export function bigintPow(base: bigint, exp: bigint): bigint {
  if (exp === 0n) return 1n
  if (exp === 1n) return base

  let result = 1n
  let b = base
  let e = exp

  while (e > 0n) {
    if (e % 2n === 1n) {
      result *= b
    }
    b *= b
    e /= 2n
  }

  return result
}

/**
 * Calculate absolute difference
 */
export function bigintAbsDiff(a: bigint, b: bigint): bigint {
  return a > b ? a - b : b - a
}

/**
 * Get minimum of multiple bigints
 */
export function bigintMin(...values: bigint[]): bigint {
  return values.reduce((min, val) => (val < min ? val : min))
}

/**
 * Get maximum of multiple bigints
 */
export function bigintMax(...values: bigint[]): bigint {
  return values.reduce((max, val) => (val > max ? val : max))
}

// ============ AMM Math ============

/**
 * Fee constant for Uniswap V2 (0.3% fee = 997/1000)
 */
const FEE_NUMERATOR = 997n
const FEE_DENOMINATOR = 1000n

/**
 * Calculate output amount for constant product AMM (Uniswap V2)
 *
 * Formula: amountOut = (amountIn * fee * reserveOut) / (reserveIn * 1000 + amountIn * fee)
 */
export function getAmountOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeNum: bigint = FEE_NUMERATOR,
  feeDenom: bigint = FEE_DENOMINATOR,
): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n

  const amountInWithFee = amountIn * feeNum
  const numerator = amountInWithFee * reserveOut
  const denominator = reserveIn * feeDenom + amountInWithFee

  return numerator / denominator
}

/**
 * Calculate input amount for desired output (Uniswap V2)
 *
 * Formula: amountIn = (reserveIn * amountOut * 1000) / ((reserveOut - amountOut) * fee) + 1
 */
export function getAmountIn(
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeNum: bigint = FEE_NUMERATOR,
  feeDenom: bigint = FEE_DENOMINATOR,
): bigint {
  if (amountOut <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n
  if (amountOut >= reserveOut) return 0n // Can't drain the pool

  const numerator = reserveIn * amountOut * feeDenom
  const denominator = (reserveOut - amountOut) * feeNum

  return numerator / denominator + 1n
}

/**
 * Calculate price as reserveOut/reserveIn scaled by 1e18
 */
export function getSpotPrice(reserveIn: bigint, reserveOut: bigint): bigint {
  if (reserveIn === 0n) return 0n
  return (reserveOut * BigInt(1e18)) / reserveIn
}

/**
 * Calculate effective price after swap (including slippage)
 */
export function getEffectivePrice(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
): bigint {
  const amountOut = getAmountOut(amountIn, reserveIn, reserveOut)
  if (amountOut === 0n) return 0n
  return (amountIn * BigInt(1e18)) / amountOut
}

/**
 * Calculate price impact in basis points
 */
export function getPriceImpactBps(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
): number {
  const spotPrice = getSpotPrice(reserveIn, reserveOut)
  const effectivePrice = getEffectivePrice(amountIn, reserveIn, reserveOut)

  if (spotPrice === 0n || effectivePrice === 0n) return 0

  const impact = (bigintAbsDiff(effectivePrice, spotPrice) * 10000n) / spotPrice
  return Number(impact)
}

// ============ Optimal Arbitrage Calculations ============

/**
 * Calculate optimal arbitrage amount between two pools trading the same pair
 *
 * For two pools with prices P1 < P2 (buy from pool 1, sell to pool 2):
 *
 * Optimal input Δx solves:
 *   P1_after(Δx) = P2_after(Δx)
 *
 * Closed-form for Uniswap V2:
 *   Δx = sqrt(R1_in * R2_out * γ²) / sqrt(R1_out * R2_in) * R1_in - R1_in
 *
 * where γ = (1 - fee) = 0.997
 *
 * @returns Optimal input amount, or 0 if no arbitrage opportunity
 */
export function calculateOptimalCrossPoolArbitrage(
  // Pool 1 (buy from): input token -> output token
  pool1ReserveIn: bigint,
  pool1ReserveOut: bigint,
  // Pool 2 (sell to): output token -> input token
  pool2ReserveIn: bigint, // This is output token reserve
  pool2ReserveOut: bigint, // This is input token reserve
  fee: bigint = 997n, // 0.997 * 1000
): { optimalInput: bigint; expectedProfit: bigint } {
  // Check if arbitrage exists: price in pool 1 < price in pool 2
  // Price = reserveOut / reserveIn
  // For arb: pool1_out/pool1_in < pool2_out/pool2_in
  // Cross multiply: pool1_out * pool2_in < pool2_out * pool1_in
  if (pool1ReserveOut * pool2ReserveIn >= pool2ReserveOut * pool1ReserveIn) {
    return { optimalInput: 0n, expectedProfit: 0n }
  }

  // Calculate optimal input using closed-form solution
  // Δx = sqrt(R1_in * R2_out * fee²) / sqrt(R1_out * R2_in * 1000000) * R1_in - R1_in
  const feeSq = fee * fee // 994009 for 0.3% fee

  const numeratorSqrt = bigintSqrt(pool1ReserveIn * pool2ReserveOut * feeSq)
  const denominatorSqrt = bigintSqrt(
    pool1ReserveOut * pool2ReserveIn * 1000000n,
  )

  if (denominatorSqrt === 0n) {
    return { optimalInput: 0n, expectedProfit: 0n }
  }

  const optimalInput =
    (numeratorSqrt * pool1ReserveIn) / denominatorSqrt - pool1ReserveIn

  if (optimalInput <= 0n) {
    return { optimalInput: 0n, expectedProfit: 0n }
  }

  // Calculate expected profit
  // Buy from pool 1
  const amountFromPool1 = getAmountOut(
    optimalInput,
    pool1ReserveIn,
    pool1ReserveOut,
  )
  // Sell to pool 2
  const amountFromPool2 = getAmountOut(
    amountFromPool1,
    pool2ReserveIn,
    pool2ReserveOut,
  )

  const expectedProfit = amountFromPool2 - optimalInput

  return {
    optimalInput: optimalInput > 0n ? optimalInput : 0n,
    expectedProfit: expectedProfit > 0n ? expectedProfit : 0n,
  }
}

/**
 * Calculate optimal triangular arbitrage amount
 *
 * For path: A -> B -> C -> A through 3 pools
 *
 * This uses numerical optimization (binary search) since closed-form
 * for 3+ pools is very complex.
 */
export function calculateOptimalTriangularArbitrage(
  // Pool 1: A -> B
  pool1ReserveA: bigint,
  pool1ReserveB: bigint,
  // Pool 2: B -> C
  pool2ReserveB: bigint,
  pool2ReserveC: bigint,
  // Pool 3: C -> A
  pool3ReserveC: bigint,
  pool3ReserveA: bigint,
  maxIterations: number = 50,
): { optimalInput: bigint; expectedProfit: bigint } {
  // Calculate profit for a given input
  const calculateProfit = (input: bigint): bigint => {
    if (input <= 0n) return 0n

    const amountB = getAmountOut(input, pool1ReserveA, pool1ReserveB)
    if (amountB <= 0n) return -input

    const amountC = getAmountOut(amountB, pool2ReserveB, pool2ReserveC)
    if (amountC <= 0n) return -input

    const amountA = getAmountOut(amountC, pool3ReserveC, pool3ReserveA)
    return amountA - input
  }

  // Check if any arbitrage exists with small amount
  const testProfit = calculateProfit(BigInt(1e15)) // 0.001 tokens
  if (testProfit <= 0n) {
    return { optimalInput: 0n, expectedProfit: 0n }
  }

  // Binary search for optimal input
  // Upper bound: 1% of smallest pool reserve
  const maxInput = bigintMin(
    pool1ReserveA / 100n,
    pool2ReserveB / 100n,
    pool3ReserveC / 100n,
  )

  let low = BigInt(1e15)
  let high = maxInput
  let bestInput = low
  let bestProfit = calculateProfit(low)

  for (let i = 0; i < maxIterations && low < high; i++) {
    const mid = (low + high) / 2n
    const midProfit = calculateProfit(mid)
    const midPlusProfit = calculateProfit(mid + BigInt(1e15))

    if (midPlusProfit > midProfit) {
      // Profit still increasing, search higher
      low = mid + 1n
      if (midProfit > bestProfit) {
        bestProfit = midProfit
        bestInput = mid
      }
    } else {
      // Profit decreasing, search lower
      high = mid
      if (midProfit > bestProfit) {
        bestProfit = midProfit
        bestInput = mid
      }
    }
  }

  // Final check around best input
  for (let delta = -5n; delta <= 5n; delta++) {
    const testInput = bestInput + delta * BigInt(1e15)
    if (testInput > 0n) {
      const profit = calculateProfit(testInput)
      if (profit > bestProfit) {
        bestProfit = profit
        bestInput = testInput
      }
    }
  }

  return {
    optimalInput: bestProfit > 0n ? bestInput : 0n,
    expectedProfit: bestProfit > 0n ? bestProfit : 0n,
  }
}

/**
 * Calculate optimal multi-hop arbitrage using dynamic programming
 *
 * For path through N pools, uses DP to find optimal input
 */
export function calculateOptimalMultiHopArbitrage(
  pools: Array<{
    reserveIn: bigint
    reserveOut: bigint
  }>,
  maxIterations: number = 30,
): { optimalInput: bigint; expectedProfit: bigint } {
  if (pools.length === 0) return { optimalInput: 0n, expectedProfit: 0n }
  if (pools.length === 2) {
    return calculateOptimalCrossPoolArbitrage(
      pools[0].reserveIn,
      pools[0].reserveOut,
      pools[1].reserveIn,
      pools[1].reserveOut,
    )
  }

  // Calculate output for given input through all pools
  const calculateOutput = (input: bigint): bigint => {
    let current = input
    for (const pool of pools) {
      current = getAmountOut(current, pool.reserveIn, pool.reserveOut)
      if (current === 0n) return 0n
    }
    return current
  }

  // Quick check if any profit exists
  const testOutput = calculateOutput(BigInt(1e15))
  if (testOutput <= BigInt(1e15)) {
    return { optimalInput: 0n, expectedProfit: 0n }
  }

  // Binary search for optimal
  const maxInput = bigintMin(...pools.map((p) => p.reserveIn / 100n))
  let low = BigInt(1e15)
  let high = maxInput
  let bestInput = low
  let bestProfit = testOutput - BigInt(1e15)

  for (let i = 0; i < maxIterations && low < high; i++) {
    const mid = (low + high) / 2n
    const midOutput = calculateOutput(mid)
    const midProfit = midOutput - mid

    const midPlus = mid + BigInt(1e16)
    const midPlusOutput = calculateOutput(midPlus)
    const midPlusProfit = midPlusOutput - midPlus

    if (midPlusProfit > midProfit) {
      low = mid + 1n
    } else {
      high = mid
    }

    if (midProfit > bestProfit) {
      bestProfit = midProfit
      bestInput = mid
    }
  }

  return {
    optimalInput: bestProfit > 0n ? bestInput : 0n,
    expectedProfit: bestProfit > 0n ? bestProfit : 0n,
  }
}

// ============ Sandwich Attack Math ============

/**
 * Calculate optimal frontrun amount for sandwich attack
 *
 * Goal: Maximize profit while keeping victim slippage within tolerance
 *
 * @param victimAmountIn - Victim's input amount
 * @param victimMinOut - Victim's minimum acceptable output
 * @param reserveIn - Pool reserve of input token
 * @param reserveOut - Pool reserve of output token
 * @returns Optimal frontrun amount and expected profit
 */
export function calculateOptimalSandwich(
  victimAmountIn: bigint,
  victimMinOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
): {
  frontrunAmount: bigint
  expectedProfit: bigint
  victimOutputAfter: bigint
} {
  // Calculate victim's clean output
  const victimCleanOutput = getAmountOut(victimAmountIn, reserveIn, reserveOut)

  // If victim would get less than min out even without us, skip
  if (victimCleanOutput < victimMinOut) {
    return { frontrunAmount: 0n, expectedProfit: 0n, victimOutputAfter: 0n }
  }

  // Max impact we can cause = victimCleanOutput - victimMinOut
  const maxVictimImpact = victimCleanOutput - victimMinOut

  // Binary search for optimal frontrun amount
  let low = BigInt(1e15)
  let high = victimAmountIn // Don't frontrun more than victim trades
  let bestFrontrun = 0n
  let bestProfit = 0n
  let bestVictimOutput = victimCleanOutput

  for (let i = 0; i < 50 && low < high; i++) {
    const mid = (low + high) / 2n

    // Simulate frontrun
    const frontrunOutput = getAmountOut(mid, reserveIn, reserveOut)
    const reserveInAfterFrontrun = reserveIn + mid
    const reserveOutAfterFrontrun = reserveOut - frontrunOutput

    // Simulate victim trade
    const victimOutput = getAmountOut(
      victimAmountIn,
      reserveInAfterFrontrun,
      reserveOutAfterFrontrun,
    )

    // Check if victim would still get enough
    if (victimOutput < victimMinOut) {
      // Too much impact, reduce frontrun
      high = mid - 1n
      continue
    }

    // Simulate backrun
    const reserveInAfterVictim = reserveInAfterFrontrun + victimAmountIn
    const reserveOutAfterVictim = reserveOutAfterFrontrun - victimOutput

    const backrunOutput = getAmountOut(
      frontrunOutput,
      reserveOutAfterVictim,
      reserveInAfterVictim,
    )

    const profit = backrunOutput - mid

    if (profit > bestProfit) {
      bestProfit = profit
      bestFrontrun = mid
      bestVictimOutput = victimOutput
    }

    // Try to find higher profit
    if (victimOutput > victimMinOut + maxVictimImpact / 10n) {
      // Still have room to cause more impact
      low = mid + 1n
    } else {
      high = mid - 1n
    }
  }

  return {
    frontrunAmount: bestFrontrun,
    expectedProfit: bestProfit,
    victimOutputAfter: bestVictimOutput,
  }
}

// ============ Gas Estimation ============

/**
 * Estimate gas cost in wei
 */
export function estimateGasCostWei(
  gasUnits: bigint,
  baseFee: bigint,
  priorityFee: bigint,
): bigint {
  return gasUnits * (baseFee + priorityFee)
}

/**
 * Calculate minimum profitable trade size given gas cost
 *
 * For a trade to be profitable: expectedProfit > gasCost
 * expectedProfit = tradeSize * profitBps / 10000
 * tradeSize > gasCost * 10000 / profitBps
 */
export function calculateMinProfitableTradeSize(
  gasCostWei: bigint,
  expectedProfitBps: number,
): bigint {
  if (expectedProfitBps <= 0) return BigInt(Number.MAX_SAFE_INTEGER)
  return (gasCostWei * 10000n) / BigInt(expectedProfitBps)
}

/**
 * Calculate net profit after gas
 */
export function calculateNetProfit(
  grossProfit: bigint,
  gasUnits: bigint,
  baseFee: bigint,
  priorityFee: bigint,
  builderTip: bigint = 0n,
): bigint {
  const gasCost = estimateGasCostWei(gasUnits, baseFee, priorityFee)
  return grossProfit - gasCost - builderTip
}
