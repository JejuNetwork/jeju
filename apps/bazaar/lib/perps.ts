/**
 * Perpetual trading business logic
 * Pure functions for perp calculations, formatting, and validation
 */

import type { Hash } from 'viem'

// ============ Constants ============

/**
 * Standard market IDs for perpetual markets
 */
export const MARKET_IDS = {
  BTC_PERP:
    '0xa3fa5377b11d5955c4ed83f7ace1c7822b5361de56c000486ef1e91146897315' as Hash,
  ETH_PERP:
    '0x4554482d504552500000000000000000000000000000000000000000000000000' as Hash,
} as const

/**
 * Price decimals (8 decimals for prices)
 */
export const PRICE_DECIMALS = 8
export const PRICE_SCALE = 10n ** BigInt(PRICE_DECIMALS)

/**
 * Size decimals (8 decimals for position sizes)
 */
export const SIZE_DECIMALS = 8
export const SIZE_SCALE = 10n ** BigInt(SIZE_DECIMALS)

/**
 * PnL decimals (18 decimals for PnL)
 */
export const PNL_DECIMALS = 18
export const PNL_SCALE = 10n ** BigInt(PNL_DECIMALS)

/**
 * Funding rate decimals (16 decimals)
 */
export const FUNDING_RATE_DECIMALS = 16
export const FUNDING_RATE_SCALE = 10n ** BigInt(FUNDING_RATE_DECIMALS)

/**
 * Leverage decimals (18 decimals)
 */
export const LEVERAGE_DECIMALS = 18
export const LEVERAGE_SCALE = 10n ** BigInt(LEVERAGE_DECIMALS)

/**
 * Max allowed leverage
 */
export const MAX_LEVERAGE = 100

/**
 * Default taker fee in basis points (0.05%)
 */
export const DEFAULT_TAKER_FEE_BPS = 5n

/**
 * Default maintenance margin factor (0.95 for liquidation calculations)
 */
export const MAINTENANCE_MARGIN_FACTOR = 0.95

// ============ Position Side Const ============

export const PositionSide = {
  Long: 0,
  Short: 1,
} as const
export type PositionSide = (typeof PositionSide)[keyof typeof PositionSide]

// ============ Formatting Functions ============

/**
 * Format a price value from bigint to display string
 * @param price Price in 8 decimal format
 * @param decimals Number of decimal places to show
 */
export function formatPrice(price: bigint, decimals = 2): string {
  const priceNumber = Number(price) / Number(PRICE_SCALE)
  return priceNumber.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * Format a position size from bigint to display string
 * @param size Size in 8 decimal format
 * @param decimals Number of decimal places to show
 */
export function formatSize(size: bigint, decimals = 4): string {
  const sizeNumber = Number(size) / Number(SIZE_SCALE)
  return sizeNumber.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * Format PnL value from bigint to display string with profit indicator
 * @param pnl PnL in 18 decimal format (signed)
 */
export function formatPnL(pnl: bigint): { value: string; isProfit: boolean } {
  const pnlNumber = Number(pnl) / Number(PNL_SCALE)
  const isProfit = pnl >= 0n
  return {
    value: `${isProfit ? '+' : ''}$${Math.abs(pnlNumber).toLocaleString(
      'en-US',
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      },
    )}`,
    isProfit,
  }
}

/**
 * Format funding rate from bigint to percentage string
 * @param rate Funding rate in 16 decimal format (signed)
 */
export function formatFundingRate(rate: bigint): string {
  const rateNumber = Number(rate) / Number(FUNDING_RATE_SCALE)
  return `${rateNumber >= 0 ? '+' : ''}${rateNumber.toFixed(4)}%`
}

/**
 * Format leverage from bigint to multiplier string
 * @param leverage Leverage in 18 decimal format
 */
export function formatLeverage(leverage: bigint): string {
  const leverageNumber = Number(leverage) / Number(LEVERAGE_SCALE)
  return `${leverageNumber.toFixed(1)}x`
}

// ============ Calculation Functions ============

/**
 * Calculate required margin for a position
 * @param size Position size in base units
 * @param price Entry price
 * @param leverage Leverage multiplier
 */
export function calculateRequiredMargin(
  size: number,
  price: number,
  leverage: number,
): number {
  if (leverage <= 0) return 0
  const notional = size * price
  return notional / leverage
}

/**
 * Calculate estimated liquidation price for a position
 * @param entryPrice Entry price
 * @param leverage Leverage multiplier
 * @param side Position side (long/short)
 * @param maintenanceMarginFactor Maintenance margin factor (default 0.95)
 */
export function calculateLiquidationPrice(
  entryPrice: number,
  leverage: number,
  side: PositionSide,
  maintenanceMarginFactor = MAINTENANCE_MARGIN_FACTOR,
): number {
  if (leverage <= 0) return 0
  const priceMovement = (1 / leverage) * maintenanceMarginFactor

  if (side === PositionSide.Long) {
    return entryPrice * (1 - priceMovement)
  } else {
    return entryPrice * (1 + priceMovement)
  }
}

/**
 * Calculate trading fee for a position
 * @param size Position size
 * @param price Entry price
 * @param feeBps Fee in basis points
 */
export function calculateFee(
  size: number,
  price: number,
  feeBps: number = Number(DEFAULT_TAKER_FEE_BPS),
): number {
  const notional = size * price
  return (notional * feeBps) / 10000
}

/**
 * Calculate unrealized PnL for a position
 * @param size Position size
 * @param entryPrice Entry price
 * @param currentPrice Current market price
 * @param side Position side (long/short)
 */
export function calculateUnrealizedPnL(
  size: number,
  entryPrice: number,
  currentPrice: number,
  side: PositionSide,
): number {
  const priceDiff = currentPrice - entryPrice
  const pnl = size * priceDiff
  return side === PositionSide.Long ? pnl : -pnl
}

/**
 * Calculate position notional value
 * @param size Position size
 * @param price Current price
 */
export function calculateNotional(size: number, price: number): number {
  return size * price
}

/**
 * Calculate current leverage based on position value and margin
 * @param notional Position notional value
 * @param margin Current margin
 */
export function calculateCurrentLeverage(
  notional: number,
  margin: number,
): number {
  if (margin <= 0) return 0
  return notional / margin
}

/**
 * Check if a position is at risk of liquidation
 * @param healthFactor Position health factor (1e18 scale typically)
 * @param threshold Liquidation threshold (default 1e18)
 */
export function isAtLiquidationRisk(
  healthFactor: bigint,
  threshold: bigint = 10n ** 18n,
): boolean {
  return healthFactor < threshold
}

// ============ Conversion Functions ============

/**
 * Convert a number price to bigint with 8 decimals
 * @param price Price as number
 */
export function priceToBigInt(price: number): bigint {
  return BigInt(Math.floor(price * Number(PRICE_SCALE)))
}

/**
 * Convert a bigint price to number
 * @param price Price as bigint (8 decimals)
 */
export function priceToNumber(price: bigint): number {
  return Number(price) / Number(PRICE_SCALE)
}

/**
 * Convert a number size to bigint with 8 decimals
 * @param size Size as number
 */
export function sizeToBigInt(size: number): bigint {
  return BigInt(Math.floor(size * Number(SIZE_SCALE)))
}

/**
 * Convert a bigint size to number
 * @param size Size as bigint (8 decimals)
 */
export function sizeToNumber(size: bigint): number {
  return Number(size) / Number(SIZE_SCALE)
}

/**
 * Convert leverage number to bigint with 18 decimals
 * @param leverage Leverage multiplier
 */
export function leverageToBigInt(leverage: number): bigint {
  return BigInt(Math.floor(leverage * Number(LEVERAGE_SCALE)))
}

/**
 * Convert bigint leverage to number
 * @param leverage Leverage as bigint (18 decimals)
 */
export function leverageToNumber(leverage: bigint): number {
  return Number(leverage) / Number(LEVERAGE_SCALE)
}

// ============ Validation Functions ============

/**
 * Validate position parameters
 * @param size Position size
 * @param leverage Leverage multiplier
 * @param maxLeverage Maximum allowed leverage
 */
export function validatePositionParams(
  size: number,
  leverage: number,
  maxLeverage: number = MAX_LEVERAGE,
): { valid: boolean; error?: string } {
  if (size <= 0) {
    return { valid: false, error: 'Position size must be positive' }
  }
  if (leverage <= 0) {
    return { valid: false, error: 'Leverage must be positive' }
  }
  if (leverage > maxLeverage) {
    return { valid: false, error: `Leverage cannot exceed ${maxLeverage}x` }
  }
  return { valid: true }
}

/**
 * Validate margin amount
 * @param margin Margin amount
 * @param minMargin Minimum required margin
 */
export function validateMargin(
  margin: bigint,
  minMargin: bigint = 0n,
): { valid: boolean; error?: string } {
  if (margin <= 0n) {
    return { valid: false, error: 'Margin must be positive' }
  }
  if (margin < minMargin) {
    return {
      valid: false,
      error: `Margin below minimum required: ${formatPrice(minMargin)}`,
    }
  }
  return { valid: true }
}

// ============ UI Helper Functions ============

/**
 * Get trade button text based on current state
 */
export function getTradeButtonText(
  isConnected: boolean,
  isLoading: boolean,
  hasValidSize: boolean,
  side: PositionSide,
  symbol: string,
): string {
  if (!isConnected) return 'Connect Wallet'
  if (isLoading) return 'Opening Position...'
  if (!hasValidSize) return 'Enter Size'
  return `${side === PositionSide.Long ? 'Long' : 'Short'} ${symbol}`
}

/**
 * Check if trade button should be disabled
 */
export function isTradeButtonDisabled(
  isConnected: boolean,
  isLoading: boolean,
  hasValidSize: boolean,
): boolean {
  return !isConnected || isLoading || !hasValidSize
}

/**
 * Parse market symbol to extract base asset
 * @param symbol Market symbol (e.g., "BTC-PERP")
 */
export function getBaseAsset(symbol: string): string {
  return symbol.split('-')[0] ?? symbol
}
