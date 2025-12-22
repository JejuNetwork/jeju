import { gql, request } from 'graphql-request'
import { useEffect, useState } from 'react'
import { INDEXER_URL } from '../../config'
import { expect } from '../../lib/validation'
import { NonEmptyStringSchema } from '../../schemas/common'

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
`

export interface GameFeedPost {
  id: string
  sessionId: string
  postId: string
  author: string
  content: string
  gameDay: number
  timestamp: string
  isSystemMessage: boolean
  blockNumber: bigint
  transactionHash: string
}

export interface GameMarketUpdate {
  id: string
  sessionId: string
  yesOdds: number
  noOdds: number
  totalVolume: bigint
  gameDay: number
  timestamp: string
  blockNumber: bigint
  transactionHash: string
}

export function useGameFeed(sessionId: string) {
  const validatedSessionId = NonEmptyStringSchema.parse(sessionId)
  const [posts, setPosts] = useState<GameFeedPost[]>([])
  const [marketUpdates, setMarketUpdates] = useState<GameMarketUpdate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    async function fetchGameFeed() {
      const endpoint = expect(INDEXER_URL, 'INDEXER_URL not configured')

      setLoading(true)
      const data = (await request(endpoint, GAME_FEED_QUERY, {
        sessionId: validatedSessionId,
      })) as {
        gameFeedPosts: GameFeedPost[]
        gameMarketUpdates: GameMarketUpdate[]
      }

      if (!data.gameFeedPosts) {
        throw new Error('Invalid response: gameFeedPosts not found')
      }
      if (!data.gameMarketUpdates) {
        throw new Error('Invalid response: gameMarketUpdates not found')
      }
      setPosts(data.gameFeedPosts)
      setMarketUpdates(data.gameMarketUpdates)
      setLoading(false)
    }

    fetchGameFeed().catch((err) => {
      setError(err)
      setLoading(false)
    })

    const interval = setInterval(() => {
      fetchGameFeed().catch((err) => setError(err))
    }, 5000)

    return () => clearInterval(interval)
  }, [validatedSessionId])

  return { posts, marketUpdates, loading, error }
}
