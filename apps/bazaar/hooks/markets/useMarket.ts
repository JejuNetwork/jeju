import { useState, useEffect } from 'react';
import { request, gql } from 'graphql-request';
import type { Market } from '@/types/markets';
import { calculateYesPrice, calculateNoPrice } from '@/lib/markets/lmsrPricing';
import { INDEXER_URL } from '@/config';

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
`;

export function useMarket(sessionId: string) {
  const [market, setMarket] = useState<Market | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchMarket() {
      try {
        const endpoint = INDEXER_URL;
        
        const data = await request(endpoint, MARKET_QUERY, { id: sessionId }) as {
          predictionMarkets: Array<{
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
          }>
        };

        if (data.predictionMarkets.length === 0) {
          setError(new Error('Market not found'));
          setLoading(false);
          return;
        }

        const m = data.predictionMarkets[0];
        const yesShares = BigInt(m.yesShares);
        const noShares = BigInt(m.noShares);
        const liquidityB = BigInt(m.liquidityB);
        
        const yesPrice = calculateYesPrice(yesShares, noShares, liquidityB);
        const noPrice = calculateNoPrice(yesShares, noShares, liquidityB);

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
          outcome: m.outcome ?? undefined
        });
        setLoading(false);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch market'));
        setLoading(false);
      }
    }

    fetchMarket();
    const interval = setInterval(fetchMarket, 5000);
    return () => clearInterval(interval);
  }, [sessionId]);

  return { market, loading, error };
}

