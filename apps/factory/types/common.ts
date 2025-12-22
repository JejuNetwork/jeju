/**
 * Common Types
 * Shared types used across the Factory app
 */

import type { Address } from 'viem';

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
}

export type Status = 'open' | 'closed' | 'in_progress' | 'pending' | 'completed' | 'failed' | 'cancelled';

export interface User {
  address: Address;
  name?: string;
  avatar?: string;
  bio?: string;
}

export interface Timestamps {
  createdAt: number;
  updatedAt: number;
}
