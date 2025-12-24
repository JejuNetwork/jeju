// Maximum safe value for Number conversion (2^53 - 1)
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)

export function calculateYesPrice(
  yesShares: bigint,
  noShares: bigint,
  liquidityB: bigint = BigInt(100e18),
): bigint {
  // Security: Check for potential precision loss with very large values
  if (
    yesShares > MAX_SAFE_BIGINT ||
    noShares > MAX_SAFE_BIGINT ||
    liquidityB > MAX_SAFE_BIGINT
  ) {
    // For extremely large values, use scaled-down approximation
    const scale = 10n ** 9n // Scale down by 1e9
    const scaledYes = Number(yesShares / scale) / 1e9
    const scaledNo = Number(noShares / scale) / 1e9
    const scaledB = Number(liquidityB / scale) / 1e9

    const expYes = Math.exp(scaledYes / scaledB)
    const expNo = Math.exp(scaledNo / scaledB)
    const price = expYes / (expYes + expNo)

    return BigInt(Math.floor(price * 100 * 1e16))
  }

  // Convert to numbers for calculation (safe for shares < 2^53)
  const yes = Number(yesShares) / 1e18
  const no = Number(noShares) / 1e18
  const b = Number(liquidityB) / 1e18

  // LMSR price calculation
  const expYes = Math.exp(yes / b)
  const expNo = Math.exp(no / b)
  const price = expYes / (expYes + expNo)

  // Convert to percentage with 16 decimals (0.5 = 50%)
  return BigInt(Math.floor(price * 100 * 1e16))
}

export function calculateNoPrice(
  yesShares: bigint,
  noShares: bigint,
  liquidityB: bigint = BigInt(100e18),
): bigint {
  const yesPrice = calculateYesPrice(yesShares, noShares, liquidityB)
  // NO price is complement of YES price
  return BigInt(100 * 1e16) - yesPrice
}

export function calculateExpectedShares(
  amount: bigint,
  currentPrice: bigint,
): bigint {
  // Simple approximation: shares ≈ amount / price
  // More accurate calculation would use LMSR cost function
  if (currentPrice === 0n) return 0n
  return (amount * BigInt(100 * 1e16)) / currentPrice
}

export function calculateCost(
  sharesToBuy: bigint,
  yesShares: bigint,
  noShares: bigint,
  buyingYes: boolean,
  liquidityB: bigint = BigInt(100e18),
): bigint {
  // Security: Check for potential precision loss with very large values
  const allValues = [sharesToBuy, yesShares, noShares, liquidityB]
  const hasLargeValues = allValues.some((v) => v > MAX_SAFE_BIGINT)

  let b: number, yes: number, no: number, shares: number

  if (hasLargeValues) {
    // Use scaled-down approximation for large values
    const scale = 10n ** 9n
    b = Number(liquidityB / scale) / 1e9
    yes = Number(yesShares / scale) / 1e9
    no = Number(noShares / scale) / 1e9
    shares = Number(sharesToBuy / scale) / 1e9
  } else {
    b = Number(liquidityB) / 1e18
    yes = Number(yesShares) / 1e18
    no = Number(noShares) / 1e18
    shares = Number(sharesToBuy) / 1e18
  }

  // LMSR cost function: C(q) = b * ln(exp(q_yes/b) + exp(q_no/b))
  const costBefore = b * Math.log(Math.exp(yes / b) + Math.exp(no / b))

  let costAfter: number
  if (buyingYes) {
    costAfter = b * Math.log(Math.exp((yes + shares) / b) + Math.exp(no / b))
  } else {
    costAfter = b * Math.log(Math.exp(yes / b) + Math.exp((no + shares) / b))
  }

  const cost = costAfter - costBefore
  return BigInt(Math.floor(cost * 1e18))
}

export function formatPrice(price: bigint, decimals: number = 1): string {
  const percent = Number(price) / 1e16
  return `${percent.toFixed(decimals)}%`
}
