/**
 * Shared types for Predimarket application
 * Consolidated from hooks and components to avoid duplication
 */

export interface Market {
  id: string;
  sessionId: string;
  question: string;
  yesPrice: bigint;
  noPrice: bigint;
  yesShares: bigint;
  noShares: bigint;
  totalVolume: bigint;
  createdAt: Date;
  resolved: boolean;
  outcome?: boolean;
}

export interface Position {
  id: string;
  market: {
    sessionId: string;
    question: string;
    resolved: boolean;
    outcome?: boolean;
  };
  yesShares: bigint;
  noShares: bigint;
  totalSpent: bigint;
  totalReceived: bigint;
  hasClaimed: boolean;
}

export interface Trade {
  id: string;
  timestamp: string;
  trader: string;
  amount: string;
  outcome: boolean;
  yesPrice: string;
  noPrice: string;
  market?: {
    question: string;
  };
}

export interface PricePoint {
  timestamp: string;
  yesPrice: number;
  noPrice: number;
}

export interface MarketStats {
  totalVolume: bigint;
  activeMarketCount: number;
  totalMarketCount: number;
}

export interface UserStats {
  totalValue: bigint;
  totalPnL: bigint;
  activePositionCount: number;
}

