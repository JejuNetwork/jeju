import { useState, useEffect } from 'react';
import { request, gql } from 'graphql-request';
import type { Position } from '@/types/markets';
import { INDEXER_URL } from '@/config';

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
`;

export function useUserPositions(address?: `0x${string}`) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [totalValue, setTotalValue] = useState<bigint>(0n);
  const [totalPnL, setTotalPnL] = useState<bigint>(0n);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) {
      setPositions([]);
      setLoading(false);
      return;
    }

    async function fetchPositions() {
      if (!address) return;
      
      const endpoint = INDEXER_URL;
      
      const data = await request(endpoint, POSITIONS_QUERY, {
        user: address.toLowerCase()
      }) as {
        marketPositions: Array<{
          id: string;
          yesShares: string;
          noShares: string;
          totalSpent: string;
          totalReceived: string;
          hasClaimed: boolean;
          market: {
            sessionId: string;
            question: string;
            resolved: boolean;
            outcome: boolean | null;
          };
        }>
      };

      const transformedPositions: Position[] = data.marketPositions.map((p) => ({
        id: p.id,
        market: {
          sessionId: p.market.sessionId,
          question: p.market.question,
          resolved: p.market.resolved,
          outcome: p.market.outcome ?? undefined
        },
        yesShares: BigInt(p.yesShares),
        noShares: BigInt(p.noShares),
        totalSpent: BigInt(p.totalSpent),
        totalReceived: BigInt(p.totalReceived),
        hasClaimed: p.hasClaimed
      }));

      let value = 0n;
      let pnl = 0n;

      for (const pos of transformedPositions) {
        const posValue = pos.yesShares + pos.noShares;
        value += posValue;
        pnl += posValue + pos.totalReceived - pos.totalSpent;
      }

      setPositions(transformedPositions);
      setTotalValue(value);
      setTotalPnL(pnl);
      setLoading(false);
    }

    fetchPositions();
    const interval = setInterval(fetchPositions, 10000);
    return () => clearInterval(interval);
  }, [address]);

  return { positions, totalValue, totalPnL, loading };
}



