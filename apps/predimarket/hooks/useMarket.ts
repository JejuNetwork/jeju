import { useState, useEffect } from 'react';
import { request, gql } from 'graphql-request';
import type { Market } from '@/types';

const MARKET_QUERY = gql`
  query GetMarket($id: String!) {
    predictionMarkets(where: { sessionId_eq: $id }) {
      id
      sessionId
      question
      yesShares
      noShares
      totalVolume
      createdAt
      resolved
      outcome
    }
  }
`;

export function useMarket(sessionId: string) {
  const [market, setMarket] = useState<Market | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchMarket() {
      const endpoint = process.env.NEXT_PUBLIC_GRAPHQL_URL || 
                       process.env.PREDIMARKET_GRAPHQL_URL || 
                       `http://localhost:${process.env.INDEXER_GRAPHQL_PORT || '4350'}/graphql`;
      
      const data = await request(endpoint, MARKET_QUERY, { id: sessionId }) as {
        predictionMarkets: Array<{
          id: string;
          sessionId: string;
          question: string;
          yesShares: string;
          noShares: string;
          totalVolume: string;
          createdAt: string;
          resolved: boolean;
          outcome: boolean | null;
        }>
      };

      if (data.predictionMarkets.length === 0) {
        setError(new Error('Market not found'));
        setLoading(false);
        return;
      }

      const m = data.predictionMarkets[0];
      setMarket({
        id: m.id,
        sessionId: m.sessionId,
        question: m.question,
        yesPrice: BigInt(m.yesShares),
        noPrice: BigInt(m.noShares),
        yesShares: BigInt(m.yesShares),
        noShares: BigInt(m.noShares),
        totalVolume: BigInt(m.totalVolume),
        createdAt: new Date(m.createdAt),
        resolved: m.resolved,
        outcome: m.outcome ?? undefined
      });
      setLoading(false);
    }

    fetchMarket();
    const interval = setInterval(fetchMarket, 5000);
    return () => clearInterval(interval);
  }, [sessionId]);

  return { market, loading, error };
}

