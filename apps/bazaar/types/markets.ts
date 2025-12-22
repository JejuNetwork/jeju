/**
 * Re-export market types from Zod schemas
 * Single source of truth for all market-related types
 */
export type {
  Market,
  MarketStats,
  Position,
  PricePoint,
  Trade,
  UserStats,
} from '@/schemas/markets'
