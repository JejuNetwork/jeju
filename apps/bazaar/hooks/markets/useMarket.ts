import { gql, request } from 'graphql-request'
import { useEffect, useState } from 'react'
import { INDEXER_URL } from '../../config'
import {
  calculateNoPrice,
  calculateYesPrice,
} from '../../lib/markets/lmsrPricing'
import { expect } from '../../lib/validation'
import { NonEmptyStringSchema } from '../../schemas/common'
import type { Market } from '../../types/markets'

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
        })) as {
          predictionMarkets: Array<{
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
          }>
        }

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
          outcome: m.outcome ?? undefined,
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
