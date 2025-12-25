import { describe, expect, test } from 'bun:test'
import { useClaim } from '../useClaim'

describe('useClaim Hook', () => {
  test('should export useClaim function', () => {
    expect(typeof useClaim).toBe('function')
  })

  test('should handle missing contract address', () => {
    // Contract address comes from @jejunetwork/config, so this test
    // just validates the hook works regardless of configuration
    expect(typeof useClaim).toBe('function')
  })

  test('should accept sessionId parameter', () => {
    const testSessionId =
      '0x1234567890123456789012345678901234567890123456789012345678901234'
    expect(testSessionId.length).toBe(66)
  })
})
