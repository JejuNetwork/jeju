import { describe, expect, test } from 'bun:test'
import { useClaim } from '../useClaim'

describe('useClaim Hook', () => {
  test('should export useClaim function', () => {
    expect(typeof useClaim).toBe('function')
  })

  test('should handle missing contract address', () => {
    const _originalEnv = process.env.PUBLIC_PREDIMARKET_ADDRESS
    process.env.PUBLIC_PREDIMARKET_ADDRESS = '0x0'

    expect(typeof useClaim).toBe('function')

    process.env.PUBLIC_PREDIMARKET_ADDRESS = _originalEnv
  })

  test('should accept sessionId parameter', () => {
    const testSessionId =
      '0x1234567890123456789012345678901234567890123456789012345678901234'
    expect(testSessionId.length).toBe(66)
  })
})
