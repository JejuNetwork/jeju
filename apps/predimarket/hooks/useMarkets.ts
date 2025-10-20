import { useState, useEffect } from 'react';
import { request, gql } from 'graphql-request';
import type { Market } from '@/types';

const MARKETS_QUERY = gql`
  query GetMarkets($limit: Int, $orderBy: [PredictionMarketOrderByInput!]) {
    predictionMarkets(limit: $limit, orderBy: $orderBy) {
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

export function useMarkets() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchMarkets() {
      const endpoint = process.env.NEXT_PUBLIC_GRAPHQL_URL || 
                       process.env.PREDIMARKET_GRAPHQL_URL || 
                       `http://localhost:${process.env.INDEXER_GRAPHQL_PORT || '4350'}/graphql`;
      
      const data = await request(endpoint, MARKETS_QUERY, {
        limit: 100,
        orderBy: ['createdAt_DESC']
      }) as { predictionMarkets: Array<{
        id: string;
        sessionId: string;
        question: string;
        yesShares: string;
        noShares: string;
        totalVolume: string;
        createdAt: string;
        resolved: boolean;
        outcome: boolean | null;
      }> };

      const transformedMarkets: Market[] = data.predictionMarkets.map((m) => ({
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
      }));

      setMarkets(transformedMarkets);
      setLoading(false);
    }

    fetchMarkets();
    const interval = setInterval(fetchMarkets, 10000);
    return () => clearInterval(interval);
  }, []);

  return { markets, loading, error };
}

