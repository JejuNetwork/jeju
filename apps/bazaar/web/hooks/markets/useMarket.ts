import { expect, NonEmptyStringSchema } from '@jejunetwork/types'
import { gql, request } from 'graphql-request'
import { useEffect, useState } from 'react'
import type { Market } from '@/schemas/markets'
import { INDEXER_URL } from '../../config'
import {
  calculateNoPrice,
  calculateYesPrice,
} from '../../lib/markets/lmsrPricing'

const MARKET_QUERY = gql`
  query GetMarket($id: String!) {
    predictionMarkets(where: { sessionId_eq: $id }) {
      id
      sessionId
      question
      liquidityB
      yesShares
      noShares
      totalVolume
      createdAt
      resolved
      outcome
    }
  }
`

/** Raw market data from GraphQL response */
interface MarketQueryData {
  id: string
  sessionId: string
  question: string
  liquidityB: string
  yesShares: string
  noShares: string
  totalVolume: string
  createdAt: string
  resolved: boolean
  outcome: boolean | null
}

/** GraphQL response for market query */
interface MarketQueryResponse {
  predictionMarkets: MarketQueryData[]
}

export function useMarket(sessionId: string) {
  const validatedSessionId = NonEmptyStringSchema.parse(sessionId)

  const [market, setMarket] = useState<Market | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    async function fetchMarket() {
      try {
        const endpoint = expect(INDEXER_URL, 'INDEXER_URL not configured')

        const data = (await request(endpoint, MARKET_QUERY, {
          id: validatedSessionId,
        })) as MarketQueryResponse

        expect(
          data.predictionMarkets.length > 0,
          `Market not found: ${validatedSessionId}`,
        )

        const m = expect(data.predictionMarkets[0], 'Market data is missing')
        const yesShares = BigInt(m.yesShares)
        const noShares = BigInt(m.noShares)
        const liquidityB = BigInt(m.liquidityB)

        const yesPrice = calculateYesPrice(yesShares, noShares, liquidityB)
        const noPrice = calculateNoPrice(yesShares, noShares, liquidityB)

        setMarket({
          id: m.id,
          sessionId: m.sessionId,
          question: m.question,
          yesPrice,
          noPrice,
          yesShares,
          noShares,
          totalVolume: BigInt(m.totalVolume),
          createdAt: new Date(m.createdAt),
          resolved: m.resolved,
          outcome: m.outcome ?? null,
        })
        setLoading(false)
        setError(null)
      } catch (err) {
        setError(
          err instanceof Error ? err : new Error('Failed to fetch market'),
        )
        setLoading(false)
      }
    }

    fetchMarket()
    const interval = setInterval(fetchMarket, 5000)
    return () => clearInterval(interval)
  }, [validatedSessionId])

  return { market, loading, error }
}
