import { AddressSchema } from '@jejunetwork/types'
import { gql, request } from 'graphql-request'
import { useEffect, useState } from 'react'
import { INDEXER_URL } from '../../config'
import { calculateTotalPnL, calculateTotalValue } from '../../lib/portfolio'
import { expect } from '../../lib/validation'
import {
  MarketPositionsResponseSchema,
  type RawMarketPosition,
} from '../../schemas/markets'
import type { Position } from '../../types/markets'

const POSITIONS_QUERY = gql`
  query GetUserPositions($user: String!) {
    marketPositions(where: { trader_eq: $user }) {
      id
      yesShares
      noShares
      totalSpent
      totalReceived
      hasClaimed
      market {
        sessionId
        question
        resolved
        outcome
      }
    }
  }
`

function transformPosition(raw: RawMarketPosition): Position {
  return {
    id: raw.id,
    market: {
      sessionId: raw.market.sessionId,
      question: raw.market.question,
      resolved: raw.market.resolved,
      outcome: raw.market.outcome ?? null,
    },
    yesShares: BigInt(raw.yesShares),
    noShares: BigInt(raw.noShares),
    totalSpent: BigInt(raw.totalSpent),
    totalReceived: BigInt(raw.totalReceived),
    hasClaimed: raw.hasClaimed,
  }
}

export function useUserPositions(address?: `0x${string}`) {
  const [positions, setPositions] = useState<Position[]>([])
  const [totalValue, setTotalValue] = useState<bigint>(0n)
  const [totalPnL, setTotalPnL] = useState<bigint>(0n)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!address) {
      setPositions([])
      setLoading(false)
      return
    }

    async function fetchPositions() {
      const validatedAddress = expect(address, 'Address is required')
      AddressSchema.parse(validatedAddress)
      const endpoint = expect(INDEXER_URL, 'INDEXER_URL is not configured')

      const rawData: unknown = await request(endpoint, POSITIONS_QUERY, {
        user: validatedAddress.toLowerCase(),
      })

      const parsed = MarketPositionsResponseSchema.safeParse(rawData)
      if (!parsed.success) {
        console.error('Invalid positions response:', parsed.error.message)
        setPositions([])
        setLoading(false)
        return
      }

      const transformedPositions =
        parsed.data.marketPositions.map(transformPosition)

      setPositions(transformedPositions)
      setTotalValue(calculateTotalValue(transformedPositions))
      setTotalPnL(calculateTotalPnL(transformedPositions))
      setLoading(false)
    }

    fetchPositions()
    const interval = setInterval(fetchPositions, 10000)
    return () => clearInterval(interval)
  }, [address])

  return { positions, totalValue, totalPnL, loading }
}
