import { useState, useEffect } from 'react';
import { request, gql } from 'graphql-request';

const GAME_FEED_QUERY = gql`
  query GetGameFeed($sessionId: String!) {
    gameFeedPosts(where: { sessionId_eq: $sessionId }, orderBy: timestamp_DESC, limit: 100) {
      id
      sessionId
      postId
      author
      content
      gameDay
      timestamp
      isSystemMessage
      blockNumber
      transactionHash
    }
    
    gameMarketUpdates(where: { sessionId_eq: $sessionId }, orderBy: timestamp_DESC, limit: 20) {
      id
      sessionId
      yesOdds
      noOdds
      totalVolume
      gameDay
      timestamp
      blockNumber
      transactionHash
    }
  }
`;

export interface GameFeedPost {
  id: string;
  sessionId: string;
  postId: string;
  author: string;
  content: string;
  gameDay: number;
  timestamp: string;
  isSystemMessage: boolean;
  blockNumber: bigint;
  transactionHash: string;
}

export interface GameMarketUpdate {
  id: string;
  sessionId: string;
  yesOdds: number;
  noOdds: number;
  totalVolume: bigint;
  gameDay: number;
  timestamp: string;
  blockNumber: bigint;
  transactionHash: string;
}

export function useGameFeed(sessionId: string) {
  const [posts, setPosts] = useState<GameFeedPost[]>([]);
  const [marketUpdates, setMarketUpdates] = useState<GameMarketUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchGameFeed() {
      const endpoint = process.env.NEXT_PUBLIC_GRAPHQL_URL || 
                       process.env.PREDIMARKET_GRAPHQL_URL || 
                       `http://localhost:${process.env.INDEXER_GRAPHQL_PORT || '4350'}/graphql`;
      
      setLoading(true);
      const data = await request(endpoint, GAME_FEED_QUERY, {
        sessionId
      }) as {
        gameFeedPosts: GameFeedPost[];
        gameMarketUpdates: GameMarketUpdate[];
      };

      setPosts(data.gameFeedPosts || []);
      setMarketUpdates(data.gameMarketUpdates || []);
      setLoading(false);
    }

    fetchGameFeed().catch(err => {
      setError(err);
      setLoading(false);
    });

    // Poll every 5 seconds for updates
    const interval = setInterval(() => {
      fetchGameFeed().catch(err => setError(err));
    }, 5000);

    return () => clearInterval(interval);
  }, [sessionId]);

  return { posts, marketUpdates, loading, error };
}

