import { useState, useEffect } from 'react';
import { request, gql } from 'graphql-request';
import type { Market } from '@/types/markets';
import { calculateYesPrice, calculateNoPrice } from '@/lib/markets/lmsrPricing';
import { INDEXER_URL } from '@/config';

const MARKETS_QUERY = gql`
  query GetMarkets($limit: Int, $orderBy: [PredictionMarketOrderByInput!]) {
    predictionMarkets(limit: $limit, orderBy: $orderBy) {
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
`;

export function useMarkets() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchMarkets() {
      try {
        const endpoint = INDEXER_URL;
        
        const data = await request(endpoint, MARKETS_QUERY, {
          limit: 100,
          orderBy: ['createdAt_DESC']
        }) as { predictionMarkets: Array<{
          id: string;
          sessionId: string;
          question: string;
          liquidityB: string;
          yesShares: string;
          noShares: string;
          totalVolume: string;
          createdAt: string;
          resolved: boolean;
          outcome: boolean | null;
        }> };

        const transformedMarkets: Market[] = data.predictionMarkets.map((m) => {
          const yesShares = BigInt(m.yesShares);
          const noShares = BigInt(m.noShares);
          const liquidityB = BigInt(m.liquidityB);
          
          return {
            id: m.id,
            sessionId: m.sessionId,
            question: m.question,
            yesPrice: calculateYesPrice(yesShares, noShares, liquidityB),
            noPrice: calculateNoPrice(yesShares, noShares, liquidityB),
            yesShares,
            noShares,
            totalVolume: BigInt(m.totalVolume),
            createdAt: new Date(m.createdAt),
            resolved: m.resolved,
            outcome: m.outcome ?? undefined
          };
        });

        setMarkets(transformedMarkets);
        setLoading(false);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch markets'));
        setLoading(false);
      }
    }

    fetchMarkets();
    const interval = setInterval(fetchMarkets, 10000);
    return () => clearInterval(interval);
  }, []);

  return { markets, loading, error };
}

