import { AddressSchema } from '@jejunetwork/types'
import { type Address, encodePacked, keccak256 } from 'viem'
import { expectPositive, expectTrue } from '../validation'
import type { PoolKey } from './types'

export function computePoolId(key: PoolKey): `0x${string}` {
  const encoded = encodePacked(
    ['address', 'address', 'uint24', 'int24', 'address'],
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
  )
  return keccak256(encoded)
}

export function sortTokens(
  tokenA: Address,
  tokenB: Address,
): [Address, Address] {
  return tokenA.toLowerCase() < tokenB.toLowerCase()
    ? [tokenA, tokenB]
    : [tokenB, tokenA]
}

export function createPoolKey(
  tokenA: Address,
  tokenB: Address,
  fee: number,
  tickSpacing: number,
  hooks: Address = '0x0000000000000000000000000000000000000000',
): PoolKey {
  const [currency0, currency1] = sortTokens(tokenA, tokenB)
  return {
    currency0,
    currency1,
    fee,
    tickSpacing,
    hooks,
  }
}

export function formatFee(fee: number): string {
  return `${(fee / 10000).toFixed(2)}%`
}

export function getTickSpacing(fee: number): number {
  if (fee <= 500) return 10
  if (fee <= 3000) return 60
  return 200
}

export function calculateSqrtPriceX96(
  amount0: bigint,
  amount1: bigint,
): bigint {
  expectTrue(amount0 !== 0n, 'Amount0 cannot be zero')

  // Calculate price = amount1 / amount0
  const price = (amount1 * 2n ** 192n) / amount0

  // Take square root using Newton's method
  let z = (price + 1n) / 2n
  let y = price
  while (z < y) {
    y = z
    z = (price / z + z) / 2n
  }

  return y
}

export function sqrtPriceX96ToPrice(sqrtPriceX96: bigint): number {
  const Q96 = 2n ** 96n
  const price = (sqrtPriceX96 * sqrtPriceX96) / Q96
  return Number(price) / Number(Q96)
}

export function formatLiquidity(
  liquidity: bigint,
  decimals: number = 18,
): string {
  const value = Number(liquidity) / 10 ** decimals
  if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(2)}K`
  return value.toFixed(2)
}

export function getFeeTiers(): Array<{ value: number; label: string }> {
  return [
    { value: 100, label: '0.01%' },
    { value: 500, label: '0.05%' },
    { value: 3000, label: '0.3%' },
    { value: 10000, label: '1%' },
  ]
}

export function getZeroAddress(): Address {
  return '0x0000000000000000000000000000000000000000'
}

export function validatePoolKey(key: PoolKey): void {
  AddressSchema.parse(key.currency0)
  AddressSchema.parse(key.currency1)
  expectTrue(key.currency0 !== key.currency1, 'Tokens must be different')
  expectTrue(
    key.currency0.toLowerCase() < key.currency1.toLowerCase(),
    'currency0 must be less than currency1',
  )
  expectTrue(
    key.fee >= 0 && key.fee <= 1000000,
    'Fee must be between 0 and 1000000',
  )
  expectPositive(key.tickSpacing, 'Tick spacing must be positive')
}

export function priceToTick(price: number): number {
  return Math.floor(Math.log(price) / Math.log(1.0001))
}

export function tickToPrice(tick: number): number {
  return 1.0001 ** tick
}
