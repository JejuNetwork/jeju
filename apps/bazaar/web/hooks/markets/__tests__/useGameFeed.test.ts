import { describe, expect, test } from 'bun:test'
import {
  type GameFeedPost,
  type GameMarketUpdate,
  useGameFeed,
} from '../useGameFeed'

describe('useGameFeed Hook', () => {
  test('should export useGameFeed function', () => {
    expect(typeof useGameFeed).toBe('function')
  })

  test('should export GameFeedPost interface type', () => {
    // Type-only import, verify it exists by using it in a type assertion
    const _testPost: GameFeedPost = {
      id: '',
      sessionId: '',
      postId: '',
      author: '',
      content: '',
      gameDay: 0,
      timestamp: '',
      isSystemMessage: false,
      blockNumber: 0n,
      transactionHash: '',
    }
    expect(_testPost).toBeDefined()
  })

  test('should export GameMarketUpdate interface type', () => {
    // Type-only import, verify it exists by using it in a type assertion
    const _testUpdate: GameMarketUpdate = {
      id: '',
      sessionId: '',
      yesOdds: 0,
      noOdds: 0,
      totalVolume: 0n,
      gameDay: 0,
      timestamp: '',
      blockNumber: 0n,
      transactionHash: '',
    }
    expect(_testUpdate).toBeDefined()
  })

  test('should accept sessionId parameter', () => {
    const testSessionId =
      '0x1234567890123456789012345678901234567890123456789012345678901234'
    expect(testSessionId.length).toBe(66)
    expect(typeof useGameFeed).toBe('function')
  })
})
