/**
 * Generic hook for fetching player events from any game using the network contracts
 *
 * Tracks player activity: skills, deaths, kills, achievements
 * Works with any game that uses GameIntegration.sol
 */

import { AddressSchema } from '@jejunetwork/types'
import { gql, request } from 'graphql-request'
import { useEffect, useState } from 'react'
import { INDEXER_URL } from '@/config'
import { expect } from '@/lib/validation'

const PLAYER_EVENTS_QUERY = gql`
  query GetPlayerEvents($player: String) {
    playerSkillEvents(
      where: { player_eq: $player }
      orderBy: timestamp_DESC
      limit: 50
    ) {
      id
      player
      skillName
      newLevel
      totalXp
      timestamp
      blockNumber
      transactionHash
    }
    
    playerDeathEvents(
      where: { player_eq: $player }
      orderBy: timestamp_DESC
      limit: 20
    ) {
      id
      player
      killer
      location
      timestamp
      blockNumber
      transactionHash
    }
    
    playerKillEvents(
      where: { killer_eq: $player }
      orderBy: timestamp_DESC
      limit: 20
    ) {
      id
      killer
      victim
      method
      timestamp
      blockNumber
      transactionHash
    }
    
    playerAchievements(
      where: { player_eq: $player }
      orderBy: timestamp_DESC
      limit: 50
    ) {
      id
      player
      achievementId
      achievementType
      value
      timestamp
      blockNumber
      transactionHash
    }
    
    playerStats(where: { player_eq: $player }) {
      id
      player
      totalSkillEvents
      totalDeaths
      totalKills
      totalAchievements
      highestSkillLevel
      highestSkillName
      lastActive
    }
  }
`

export interface PlayerSkillEvent {
  id: string
  player: string
  skillName: string
  newLevel: number
  totalXp: bigint
  timestamp: string
  blockNumber: bigint
  transactionHash: string
}

export interface PlayerDeathEvent {
  id: string
  player: string
  killer: string | null
  location: string
  timestamp: string
  blockNumber: bigint
  transactionHash: string
}

export interface PlayerKillEvent {
  id: string
  killer: string
  victim: string
  method: string
  timestamp: string
  blockNumber: bigint
  transactionHash: string
}

export interface PlayerAchievementEvent {
  id: string
  player: string
  achievementId: string
  achievementType: string
  value: bigint
  timestamp: string
  blockNumber: bigint
  transactionHash: string
}

export interface PlayerStats {
  id: string
  player: string
  totalSkillEvents: number
  totalDeaths: number
  totalKills: number
  totalAchievements: number
  highestSkillLevel: number
  highestSkillName: string | null
  lastActive: string
}

interface PlayerEventsResponse {
  playerSkillEvents: PlayerSkillEvent[]
  playerDeathEvents: PlayerDeathEvent[]
  playerKillEvents: PlayerKillEvent[]
  playerAchievements: PlayerAchievementEvent[]
  playerStats: PlayerStats[]
}

/**
 * Fetch player events from the indexer
 * Generic hook that works with any game using the network's GameIntegration
 *
 * @param playerAddress - The player's wallet address
 */
export function usePlayerEvents(playerAddress?: string) {
  const [skillEvents, setSkillEvents] = useState<PlayerSkillEvent[]>([])
  const [deathEvents, setDeathEvents] = useState<PlayerDeathEvent[]>([])
  const [killEvents, setKillEvents] = useState<PlayerKillEvent[]>([])
  const [achievements, setAchievements] = useState<PlayerAchievementEvent[]>([])
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!playerAddress) {
      setLoading(false)
      return
    }

    async function fetchEvents() {
      setLoading(true)

      const validatedAddress = AddressSchema.parse(playerAddress)
      const validatedIndexerUrl = expect(
        INDEXER_URL,
        'INDEXER_URL not configured',
      )

      const data = await request<PlayerEventsResponse>(
        validatedIndexerUrl,
        PLAYER_EVENTS_QUERY,
        {
          player: validatedAddress,
        },
      )

      if (!data.playerSkillEvents) {
        throw new Error('Invalid response: playerSkillEvents not found')
      }
      if (!data.playerDeathEvents) {
        throw new Error('Invalid response: playerDeathEvents not found')
      }
      if (!data.playerKillEvents) {
        throw new Error('Invalid response: playerKillEvents not found')
      }
      if (!data.playerAchievements) {
        throw new Error('Invalid response: playerAchievements not found')
      }
      setSkillEvents(data.playerSkillEvents)
      setDeathEvents(data.playerDeathEvents)
      setKillEvents(data.playerKillEvents)
      setAchievements(data.playerAchievements)
      setPlayerStats(data.playerStats[0] ?? null)
      setError(null)
      setLoading(false)
    }

    fetchEvents()

    const interval = setInterval(fetchEvents, 10000)
    return () => clearInterval(interval)
  }, [playerAddress])

  return {
    skillEvents,
    deathEvents,
    killEvents,
    achievements,
    playerStats,
    loading,
    error,
  }
}
