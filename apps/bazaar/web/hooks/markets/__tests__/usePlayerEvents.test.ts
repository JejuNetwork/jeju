import { describe, expect, test } from 'bun:test'
import {
  type PlayerSkillEvent,
  type PlayerStats,
  usePlayerEvents,
} from '../usePlayerEvents'

describe('usePlayerEvents Hook', () => {
  test('should export usePlayerEvents function', () => {
    expect(typeof usePlayerEvents).toBe('function')
  })

  test('should export PlayerSkillEvent interface', () => {
    // Type-only import, verify it exists by using it in a type assertion
    const _testEvent: PlayerSkillEvent = {
      id: '',
      player: '',
      skillName: '',
      newLevel: 0,
      totalXp: 0n,
      timestamp: '',
      blockNumber: 0n,
      transactionHash: '',
    }
    expect(_testEvent).toBeDefined()
  })

  test('should export PlayerStats interface', () => {
    // Type-only import, verify it exists by using it in a type assertion
    const _testStats: PlayerStats = {
      id: '',
      player: '',
      totalSkillEvents: 0,
      totalDeaths: 0,
      totalKills: 0,
      totalAchievements: 0,
      highestSkillLevel: 0,
      highestSkillName: null,
      lastActive: '',
    }
    expect(_testStats).toBeDefined()
  })
})
