import { useQuery } from '@tanstack/react-query';
import type { Intent, IntentRoute, Solver, OIFStats, IntentQuote, SolverLeaderboardEntry } from '@jejunetwork/types/oif';
import { OIF_AGGREGATOR_URL } from '../config';

const API_BASE = OIF_AGGREGATOR_URL;

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`Failed to fetch ${path}`);
  return res.json();
}

export function useIntents(filters?: { status?: string; sourceChain?: number; destinationChain?: number; limit?: number }) {
  return useQuery({
    queryKey: ['intents', filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters?.status) params.set('status', filters.status);
      if (filters?.sourceChain) params.set('sourceChain', filters.sourceChain.toString());
      if (filters?.destinationChain) params.set('destinationChain', filters.destinationChain.toString());
      if (filters?.limit) params.set('limit', filters.limit.toString());
      return fetchJSON<Intent[]>(`/intents?${params}`);
    },
  });
}

export function useIntent(intentId: string) {
  return useQuery({
    queryKey: ['intent', intentId],
    queryFn: () => fetchJSON<{ intent: Intent; status: string }>(`/intents/${intentId}`),
    enabled: !!intentId,
  });
}

export function useIntentQuote(params: { sourceChain: number; destinationChain: number; sourceToken: string; destinationToken: string; amount: string }) {
  return useQuery({
    queryKey: ['quote', params],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/intents/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      return res.json() as Promise<IntentQuote[]>;
    },
    enabled: !!params.sourceChain && !!params.destinationChain && !!params.amount,
  });
}

export function useRoutes(filters?: { sourceChain?: number; destinationChain?: number; active?: boolean }) {
  return useQuery({
    queryKey: ['routes', filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters?.sourceChain) params.set('sourceChain', filters.sourceChain.toString());
      if (filters?.destinationChain) params.set('destinationChain', filters.destinationChain.toString());
      if (filters?.active !== undefined) params.set('active', filters.active.toString());
      return fetchJSON<IntentRoute[]>(`/routes?${params}`);
    },
  });
}

export function useRoute(routeId: string) {
  return useQuery({
    queryKey: ['route', routeId],
    queryFn: () => fetchJSON<IntentRoute>(`/routes/${routeId}`),
    enabled: !!routeId,
  });
}

export function useSolvers(filters?: { chainId?: number; minReputation?: number; active?: boolean }) {
  return useQuery({
    queryKey: ['solvers', filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters?.chainId) params.set('chainId', filters.chainId.toString());
      if (filters?.minReputation) params.set('minReputation', filters.minReputation.toString());
      if (filters?.active !== undefined) params.set('active', filters.active.toString());
      return fetchJSON<Solver[]>(`/solvers?${params}`);
    },
  });
}

export function useSolver(address: string) {
  return useQuery({
    queryKey: ['solver', address],
    queryFn: () => fetchJSON<Solver>(`/solvers/${address}`),
    enabled: !!address,
  });
}

export function useSolverLeaderboard(sortBy: 'volume' | 'fills' | 'reputation' = 'volume') {
  return useQuery({
    queryKey: ['solver-leaderboard', sortBy],
    queryFn: () => fetchJSON<SolverLeaderboardEntry[]>(`/solvers/leaderboard?sortBy=${sortBy}`),
  });
}

export function useOIFStats() {
  return useQuery({
    queryKey: ['oif-stats'],
    queryFn: () => fetchJSON<OIFStats>('/stats'),
    refetchInterval: 30000,
  });
}

export function useChainStats(chainId: number) {
  return useQuery({
    queryKey: ['chain-stats', chainId],
    queryFn: () => fetchJSON<{ chainId: number; totalIntents: number; totalVolume: string; activeRoutes: number; activeSolvers: number }>(`/stats/chain/${chainId}`),
    enabled: !!chainId,
  });
}

export function useSupportedChains() {
  return useQuery({
    queryKey: ['supported-chains'],
    queryFn: () => fetchJSON<Array<{ chainId: number; name: string; isL2: boolean }>>('/config/chains'),
    staleTime: Infinity,
  });
}

export function useSupportedTokens(chainId?: number) {
  return useQuery({
    queryKey: ['supported-tokens', chainId],
    queryFn: () => fetchJSON<Array<{ address: string; symbol: string; decimals: number }>>(`/config/tokens${chainId ? `?chainId=${chainId}` : ''}`),
    staleTime: Infinity,
  });
}
