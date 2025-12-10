'use client';

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { request, gql } from 'graphql-request';
import { formatDistanceToNow } from 'date-fns';
import type { PricePoint } from '@/types/markets';
import { INDEXER_URL } from '@/config';

const PRICE_HISTORY_QUERY = gql`
  query GetPriceHistory($marketId: String!) {
    marketTrades(where: { market: { sessionId_eq: $marketId } }, orderBy: timestamp_ASC, limit: 100) {
      id
      timestamp
      yesPrice
      noPrice
      trader
      amount
    }
  }
`;

export function MarketChart({ marketId }: { marketId: string }) {
  const [priceData, setPriceData] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPriceHistory() {
      const endpoint = INDEXER_URL;
      const data = await request(endpoint, PRICE_HISTORY_QUERY, { marketId }) as {
        marketTrades: Array<{
          id: string;
          timestamp: string;
          yesPrice: string;
          noPrice: string;
          trader: string;
          amount: string;
        }>
      };
      
      if (data.marketTrades.length > 0) {
        const formattedData: PricePoint[] = data.marketTrades.map((trade) => ({
          timestamp: formatDistanceToNow(new Date(trade.timestamp), { addSuffix: false }),
          yesPrice: Number(trade.yesPrice) / 1e16,
          noPrice: Number(trade.noPrice) / 1e16,
        }));
        setPriceData(formattedData);
      } else {
        setPriceData([{ timestamp: 'Start', yesPrice: 50, noPrice: 50 }]);
      }
      setLoading(false);
    }

    fetchPriceHistory();
    const interval = setInterval(fetchPriceHistory, 10000);
    return () => clearInterval(interval);
  }, [marketId]);

  if (loading) {
    return (
      <div className="h-[300px] flex items-center justify-center text-slate-400">
        Loading chart...
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={priceData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis dataKey="timestamp" stroke="#9CA3AF" />
        <YAxis stroke="#9CA3AF" domain={[0, 100]} />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1F2937',
            border: '1px solid #374151',
            borderRadius: '0.5rem',
          }}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="yesPrice"
          stroke="#22C55E"
          strokeWidth={2}
          dot={false}
          name="YES %"
        />
        <Line
          type="monotone"
          dataKey="noPrice"
          stroke="#EF4444"
          strokeWidth={2}
          dot={false}
          name="NO %"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}



