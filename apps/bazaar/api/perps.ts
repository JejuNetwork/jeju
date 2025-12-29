import { isHexString } from '@jejunetwork/types'
import type { Hash } from 'viem'

function toHash(value: string): Hash {
  if (!isHexString(value)) {
    throw new Error(`Invalid hash: ${value}`)
  }
  return value
}

export const MARKET_IDS = {
  BTC_PERP: toHash(
    '0xa3fa5377b11d5955c4ed83f7ace1c7822b5361de56c000486ef1e91146897315',
  ),
  ETH_PERP: toHash(
    '0x4554482d504552500000000000000000000000000000000000000000000000000',
  ),
} as const

export const PRICE_DECIMALS = 8
export const PRICE_SCALE = 10n ** BigInt(PRICE_DECIMALS)

export const SIZE_DECIMALS = 8
export const SIZE_SCALE = 10n ** BigInt(SIZE_DECIMALS)

export const PNL_DECIMALS = 18
export const PNL_SCALE = 10n ** BigInt(PNL_DECIMALS)

export const FUNDING_RATE_DECIMALS = 16
export const FUNDING_RATE_SCALE = 10n ** BigInt(FUNDING_RATE_DECIMALS)

export const LEVERAGE_DECIMALS = 18
export const LEVERAGE_SCALE = 10n ** BigInt(LEVERAGE_DECIMALS)

export const MAX_LEVERAGE = 100
export const DEFAULT_TAKER_FEE_BPS = 5n
export const MAINTENANCE_MARGIN_FACTOR = 0.95

export const PositionSide = {
  Long: 0,
  Short: 1,
} as const
export type PositionSide = (typeof PositionSide)[keyof typeof PositionSide]

export function formatPrice(price: bigint, decimals = 2): string {
  const priceNumber = Number(price) / Number(PRICE_SCALE)
  return priceNumber.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function formatSize(size: bigint, decimals = 4): string {
  const sizeNumber = Number(size) / Number(SIZE_SCALE)
  return sizeNumber.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

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

export function formatFundingRate(rate: bigint): string {
  const rateNumber = Number(rate) / Number(FUNDING_RATE_SCALE)
  return `${rateNumber >= 0 ? '+' : ''}${rateNumber.toFixed(4)}%`
}

export function formatLeverage(leverage: bigint): string {
  const leverageNumber = Number(leverage) / Number(LEVERAGE_SCALE)
  return `${leverageNumber.toFixed(1)}x`
}

export function calculateRequiredMargin(
  size: number,
  price: number,
  leverage: number,
): number {
  if (leverage <= 0) return 0
  const notional = size * price
  return notional / leverage
}

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

export function calculateFee(
  size: number,
  price: number,
  feeBps: number = Number(DEFAULT_TAKER_FEE_BPS),
): number {
  const notional = size * price
  return (notional * feeBps) / 10000
}

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

export function calculateNotional(size: number, price: number): number {
  return size * price
}

export function calculateCurrentLeverage(
  notional: number,
  margin: number,
): number {
  if (margin <= 0) return 0
  return notional / margin
}

export function isAtLiquidationRisk(
  healthFactor: bigint,
  threshold: bigint = 10n ** 18n,
): boolean {
  return healthFactor < threshold
}

export function priceToBigInt(price: number): bigint {
  return BigInt(Math.floor(price * Number(PRICE_SCALE)))
}

export function priceToNumber(price: bigint): number {
  return Number(price) / Number(PRICE_SCALE)
}

export function sizeToBigInt(size: number): bigint {
  return BigInt(Math.floor(size * Number(SIZE_SCALE)))
}

export function sizeToNumber(size: bigint): number {
  return Number(size) / Number(SIZE_SCALE)
}

export function leverageToBigInt(leverage: number): bigint {
  return BigInt(Math.floor(leverage * Number(LEVERAGE_SCALE)))
}

export function leverageToNumber(leverage: bigint): number {
  return Number(leverage) / Number(LEVERAGE_SCALE)
}

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

export function isTradeButtonDisabled(
  isConnected: boolean,
  isLoading: boolean,
  hasValidSize: boolean,
): boolean {
  return !isConnected || isLoading || !hasValidSize
}

export function getBaseAsset(symbol: string): string {
  return symbol.split('-')[0] ?? symbol
}
