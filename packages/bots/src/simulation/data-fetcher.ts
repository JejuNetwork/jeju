/**
 * Historical Data Fetcher
 * 
 * Fetches historical price data for backtesting from:
 * - CoinGecko (free tier)
 * - DeFi Llama
 * - Subgraphs
 */

import type { Token } from '../types';
import type { PriceDataPoint } from './backtester';

export interface PriceCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CoinGeckoMarketChart {
  prices: [number, number][];
  market_caps: [number, number][];
  total_volumes: [number, number][];
}

const COINGECKO_IDS: Record<string, string> = {
  ETH: 'ethereum',
  WETH: 'ethereum',
  BTC: 'bitcoin',
  WBTC: 'wrapped-bitcoin',
  USDC: 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
  ARB: 'arbitrum',
  OP: 'optimism',
  SOL: 'solana',
  BNB: 'binancecoin',
  MATIC: 'matic-network',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
};

export class HistoricalDataFetcher {
  private baseUrl = 'https://api.coingecko.com/api/v3';
  private cache: Map<string, PriceDataPoint[]> = new Map();

  /**
   * Fetch historical prices for multiple tokens
   */
  async fetchPrices(
    tokens: Token[],
    startDate: Date,
    endDate: Date,
    intervalMs: number = 86400000 // Daily by default
  ): Promise<PriceDataPoint[]> {
    const cacheKey = `${tokens.map(t => t.symbol).join('-')}-${startDate.getTime()}-${endDate.getTime()}`;
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Fetch data for each token
    const tokenPrices = new Map<string, Map<number, number>>();

    for (const token of tokens) {
      const geckoId = COINGECKO_IDS[token.symbol];
      if (!geckoId) {
        console.warn(`No CoinGecko ID for ${token.symbol}, skipping`);
        continue;
      }

      const prices = await this.fetchTokenPrices(geckoId, startDate, endDate);
      tokenPrices.set(token.symbol, prices);
    }

    // Merge into data points
    const dataPoints = this.mergeTokenPrices(tokenPrices, tokens, startDate, endDate, intervalMs);
    
    this.cache.set(cacheKey, dataPoints);
    return dataPoints;
  }

  /**
   * Fetch prices for a single token from CoinGecko
   */
  private async fetchTokenPrices(
    geckoId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Map<number, number>> {
    const fromTimestamp = Math.floor(startDate.getTime() / 1000);
    const toTimestamp = Math.floor(endDate.getTime() / 1000);

    const url = `${this.baseUrl}/coins/${geckoId}/market_chart/range?vs_currency=usd&from=${fromTimestamp}&to=${toTimestamp}`;

    console.log(`Fetching ${geckoId} prices...`);

    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data: CoinGeckoMarketChart = await response.json();
    
    const priceMap = new Map<number, number>();
    for (const [timestamp, price] of data.prices) {
      priceMap.set(timestamp, price);
    }

    return priceMap;
  }

  /**
   * Merge prices from multiple tokens into unified data points
   */
  private mergeTokenPrices(
    tokenPrices: Map<string, Map<number, number>>,
    tokens: Token[],
    startDate: Date,
    endDate: Date,
    intervalMs: number
  ): PriceDataPoint[] {
    const dataPoints: PriceDataPoint[] = [];

    for (let ts = startDate.getTime(); ts <= endDate.getTime(); ts += intervalMs) {
      const prices: Record<string, number> = {};
      let hasAllPrices = true;

      for (const token of tokens) {
        const tokenPriceMap = tokenPrices.get(token.symbol);
        if (!tokenPriceMap) {
          hasAllPrices = false;
          break;
        }

        // Find closest price within 24h
        let closestPrice = 0;
        let closestDiff = Infinity;

        for (const [priceTs, price] of tokenPriceMap) {
          const diff = Math.abs(priceTs - ts);
          if (diff < closestDiff && diff < 86400000) {
            closestDiff = diff;
            closestPrice = price;
          }
        }

        if (closestPrice === 0) {
          hasAllPrices = false;
          break;
        }

        prices[token.symbol] = closestPrice;
      }

      if (hasAllPrices) {
        dataPoints.push({
          date: new Date(ts),
          timestamp: ts,
          prices,
        });
      }
    }

    return dataPoints;
  }

  /**
   * Fetch OHLCV candles from DeFi Llama
   */
  async fetchCandles(
    _protocol: string,
    _pool: string,
    _startDate: Date,
    _endDate: Date
  ): Promise<PriceCandle[]> {
    // DeFi Llama integration would go here
    // For now, return empty
    return [];
  }

  /**
   * Generate synthetic price data for testing
   */
  generateSyntheticData(
    tokens: Token[],
    startDate: Date,
    endDate: Date,
    intervalMs: number,
    params: {
      initialPrices: Record<string, number>;
      volatilities: Record<string, number>;
      correlations?: number[][];
    }
  ): PriceDataPoint[] {
    const dataPoints: PriceDataPoint[] = [];
    const numPeriods = Math.ceil((endDate.getTime() - startDate.getTime()) / intervalMs);

    // Initialize prices
    const currentPrices = { ...params.initialPrices };

    for (let i = 0; i < numPeriods; i++) {
      const timestamp = startDate.getTime() + i * intervalMs;
      const prices: Record<string, number> = {};

      // Generate correlated random returns
      const returns = this.generateCorrelatedReturns(
        tokens.map(t => params.volatilities[t.symbol] ?? 0.5),
        params.correlations
      );

      for (let j = 0; j < tokens.length; j++) {
        const token = tokens[j];
        const dailyVol = (params.volatilities[token.symbol] ?? 0.5) / Math.sqrt(365);
        const drift = 0; // No drift for simplicity
        
        // Geometric Brownian motion
        currentPrices[token.symbol] *= Math.exp(
          (drift - dailyVol ** 2 / 2) * (intervalMs / 86400000) +
          dailyVol * Math.sqrt(intervalMs / 86400000) * returns[j]
        );

        prices[token.symbol] = currentPrices[token.symbol];
      }

      dataPoints.push({
        date: new Date(timestamp),
        timestamp,
        prices,
      });
    }

    return dataPoints;
  }

  /**
   * Generate correlated random returns using Cholesky decomposition
   */
  private generateCorrelatedReturns(
    volatilities: number[],
    correlations?: number[][]
  ): number[] {
    const n = volatilities.length;

    // Generate independent standard normal returns
    const z: number[] = [];
    for (let i = 0; i < n; i++) {
      z.push(this.randomNormal());
    }

    if (!correlations) {
      return z;
    }

    // Cholesky decomposition
    const L = this.choleskyDecomposition(correlations);

    // Apply correlation
    const correlated: number[] = [];
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j <= i; j++) {
        sum += L[i][j] * z[j];
      }
      correlated.push(sum);
    }

    return correlated;
  }

  private randomNormal(): number {
    // Box-Muller transform
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  private choleskyDecomposition(matrix: number[][]): number[][] {
    const n = matrix.length;
    const L: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = 0;
        for (let k = 0; k < j; k++) {
          sum += L[i][k] * L[j][k];
        }

        if (i === j) {
          L[i][j] = Math.sqrt(matrix[i][i] - sum);
        } else {
          L[i][j] = (matrix[i][j] - sum) / L[j][j];
        }
      }
    }

    return L;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

