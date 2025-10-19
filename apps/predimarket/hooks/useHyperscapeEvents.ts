import { useState, useEffect } from 'react';
import { request, gql } from 'graphql-request';

const HYPERSCAPE_EVENTS_QUERY = gql`
  query GetHyperscapeEvents($player: String) {
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
`;

export interface PlayerSkillEvent {
  id: string;
  player: string;
  skillName: string;
  newLevel: number;
  totalXp: bigint;
  timestamp: string;
  blockNumber: bigint;
  transactionHash: string;
}

export interface PlayerDeathEvent {
  id: string;
  player: string;
  killer: string | null;
  location: string;
  timestamp: string;
  blockNumber: bigint;
  transactionHash: string;
}

export interface PlayerKillEvent {
  id: string;
  killer: string;
  victim: string;
  method: string;
  timestamp: string;
  blockNumber: bigint;
  transactionHash: string;
}

export interface PlayerAchievementEvent {
  id: string;
  player: string;
  achievementId: string;
  achievementType: string;
  value: bigint;
  timestamp: string;
  blockNumber: bigint;
  transactionHash: string;
}

export interface PlayerStats {
  id: string;
  player: string;
  totalSkillEvents: number;
  totalDeaths: number;
  totalKills: number;
  totalAchievements: number;
  highestSkillLevel: number;
  highestSkillName: string | null;
  lastActive: string;
}

export function useHyperscapeEvents(playerAddress?: string) {
  const [skillEvents, setSkillEvents] = useState<PlayerSkillEvent[]>([]);
  const [deathEvents, setDeathEvents] = useState<PlayerDeathEvent[]>([]);
  const [killEvents, setKillEvents] = useState<PlayerKillEvent[]>([]);
  const [achievements, setAchievements] = useState<PlayerAchievementEvent[]>([]);
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!playerAddress) {
      setLoading(false);
      return;
    }

    async function fetchEvents() {
      const endpoint = process.env.NEXT_PUBLIC_GRAPHQL_URL || 
                       process.env.PREDIMARKET_GRAPHQL_URL || 
                       `http://localhost:${process.env.INDEXER_GRAPHQL_PORT || '4350'}/graphql`;
      
      setLoading(true);
      const data = await request(endpoint, HYPERSCAPE_EVENTS_QUERY, {
        player: playerAddress
      }) as {
        playerSkillEvents: PlayerSkillEvent[];
        playerDeathEvents: PlayerDeathEvent[];
        playerKillEvents: PlayerKillEvent[];
        playerAchievements: PlayerAchievementEvent[];
        playerStats: PlayerStats[];
      };

      setSkillEvents(data.playerSkillEvents || []);
      setDeathEvents(data.playerDeathEvents || []);
      setKillEvents(data.playerKillEvents || []);
      setAchievements(data.playerAchievements || []);
      setPlayerStats(data.playerStats?.[0] || null);
      setLoading(false);
    }

    fetchEvents().catch(err => {
      setError(err);
      setLoading(false);
    });

    // Poll every 10 seconds for updates
    const interval = setInterval(() => {
      fetchEvents().catch(err => setError(err));
    }, 10000);

    return () => clearInterval(interval);
  }, [playerAddress]);

  return { skillEvents, deathEvents, killEvents, achievements, playerStats, loading, error };
}

