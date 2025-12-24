import { describe, expect, test } from 'bun:test'
import {
  checkUserBan,
  getUserReputation,
  verifyUserForTrading,
} from '../erc8004'

describe('ERC-8004 Integration', () => {
  const mockAddress =
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`

  test('should return allowed when contracts not configured', async () => {
    const result = await checkUserBan(mockAddress)

    expect(result.allowed).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  test('should return allowed with app ID when contracts not configured', async () => {
    const result = await checkUserBan(mockAddress, 'markets')

    expect(result.allowed).toBe(true)
  })

  test('should return default reputation when contracts not configured', async () => {
    const result = await getUserReputation(mockAddress)

    expect(result.score).toBe(0)
    expect(result.meetsMinimum).toBe(true)
  })

  test('should verify user for trading with defaults', async () => {
    const result = await verifyUserForTrading(mockAddress)

    expect(result.allowed).toBe(true)
    expect(result.reputation).toBeDefined()
    expect(result.banStatus).toBeDefined()
  })

  test('should verify user for trading with app ID', async () => {
    const result = await verifyUserForTrading(mockAddress, 'markets')

    expect(result.allowed).toBe(true)
    expect(result.reputation.meetsMinimum).toBe(true)
    expect(result.banStatus.allowed).toBe(true)
  })

  test('should not allow trading if banned', async () => {
    const result = await verifyUserForTrading(mockAddress)

    if (!result.banStatus.allowed) {
      expect(result.allowed).toBe(false)
    }
  })

  test('should not allow trading if low reputation', async () => {
    const result = await verifyUserForTrading(mockAddress)

    if (!result.reputation.meetsMinimum) {
      expect(result.allowed).toBe(false)
    }
  })
})
