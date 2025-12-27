/**
 * Cache Hook - Frontend integration for DWS decentralized cache
 *
 * Provides React Query hooks for interacting with the cache service.
 * Uses the DWS cache API at /cache/*
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { fetchApi, postApi } from '../lib/eden'
import type { Address } from 'viem'

// Types for cache responses
interface CacheStats {
  totalKeys: number
  usedMemoryBytes: number
  maxMemoryBytes: number
  hits: number
  misses: number
  hitRate: number
  namespaceCount: number
  uptime: number
}

interface CacheGlobalStats {
  totalInstances: number
  totalNodes: number
  totalKeys: number
  totalMemoryBytes: number
  tierBreakdown: Record<string, number>
}

interface CacheStatsResponse {
  global: CacheGlobalStats
  shared: CacheStats
}

interface CacheHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy'
  uptime: number
  timestamp: number
}

interface CachePlan {
  id: string
  name: string
  tier: string
  memorySizeMb: number
  maxKeys: number
  maxConnections: number
  replicationFactor: number
  ttlLimitSeconds: number
  rateLimitRps: number
  pricePerHour: string
  pricePerMonth: string
  description: string
}

interface CacheInstance {
  id: string
  namespace: string
  owner: Address
  planId: string
  tier: string
  status: string
  nodeIds: string[]
  createdAt: number
  expiresAt: number
}

interface CacheNode {
  id: string
  endpoint: string
  region: string
  status: string
  memorySizeMb: number
  usedMemoryMb: number
  keyCount: number
  teeCapable: boolean
  lastHeartbeat: number
}

interface GetResponse {
  value: string | null
  found: boolean
}

interface SetResponse {
  success: boolean
}

interface DelResponse {
  deleted: number
}

interface MGetResponse {
  entries: Record<string, string | null>
}

interface IncrResponse {
  value: number
}

interface TTLResponse {
  ttl: number
}

interface KeysResponse {
  keys: string[]
}

// Cache health hook
export function useCacheHealth() {
  return useQuery({
    queryKey: ['cache-health'],
    queryFn: () => fetchApi<CacheHealthResponse>('/cache/health'),
    refetchInterval: 30000,
  })
}

// Cache stats hook
export function useCacheStats() {
  return useQuery({
    queryKey: ['cache-stats'],
    queryFn: () => fetchApi<CacheStatsResponse>('/cache/stats'),
    refetchInterval: 10000,
  })
}

// Cache plans hook
export function useCachePlans() {
  return useQuery({
    queryKey: ['cache-plans'],
    queryFn: () =>
      fetchApi<{ plans: CachePlan[] }>('/cache/plans'),
  })
}

// Cache instances hook
export function useCacheInstances() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['cache-instances', address],
    queryFn: () =>
      fetchApi<{ instances: CacheInstance[] }>('/cache/instances', {
        headers: address ? { 'x-owner-address': address } : {},
      }),
    enabled: !!address,
  })
}

// Cache nodes hook
export function useCacheNodes() {
  return useQuery({
    queryKey: ['cache-nodes'],
    queryFn: () => fetchApi<{ nodes: CacheNode[] }>('/cache/nodes'),
    refetchInterval: 30000,
  })
}

// Create cache instance mutation
export function useCreateCacheInstance() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: {
      planId: string
      namespace?: string
      durationHours?: number
    }) =>
      postApi<{ instance: CacheInstance }>('/cache/instances', params, {
        headers: address ? { 'x-owner-address': address } : {},
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cache-instances'] })
      queryClient.invalidateQueries({ queryKey: ['cache-stats'] })
    },
  })
}

// Delete cache instance mutation
export function useDeleteCacheInstance() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (instanceId: string) =>
      fetch(`/cache/instances/${instanceId}`, {
        method: 'DELETE',
        headers: address ? { 'x-owner-address': address } : {},
      }).then((r) => r.json()) as Promise<{ success: boolean }>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cache-instances'] })
      queryClient.invalidateQueries({ queryKey: ['cache-stats'] })
    },
  })
}

// Cache GET mutation
export function useCacheGet() {
  return useMutation({
    mutationFn: (params: { key: string; namespace?: string }) => {
      const searchParams = new URLSearchParams({ key: params.key })
      if (params.namespace) searchParams.set('namespace', params.namespace)
      return fetchApi<GetResponse>(`/cache/get?${searchParams}`)
    },
  })
}

// Cache SET mutation
export function useCacheSet() {
  return useMutation({
    mutationFn: (params: {
      key: string
      value: string
      ttl?: number
      namespace?: string
      nx?: boolean
      xx?: boolean
    }) => postApi<SetResponse>('/cache/set', params),
  })
}

// Cache DEL mutation
export function useCacheDel() {
  return useMutation({
    mutationFn: (params: { keys: string[]; namespace?: string }) =>
      postApi<DelResponse>('/cache/del', params),
  })
}

// Cache MGET mutation
export function useCacheMGet() {
  return useMutation({
    mutationFn: (params: { keys: string[]; namespace?: string }) =>
      postApi<MGetResponse>('/cache/mget', params),
  })
}

// Cache MSET mutation
export function useCacheMSet() {
  return useMutation({
    mutationFn: (params: {
      entries: Array<{ key: string; value: string; ttl?: number }>
      namespace?: string
    }) => postApi<{ success: boolean }>('/cache/mset', params),
  })
}

// Cache INCR mutation
export function useCacheIncr() {
  return useMutation({
    mutationFn: (params: { key: string; by?: number; namespace?: string }) =>
      postApi<IncrResponse>('/cache/incr', params),
  })
}

// Cache DECR mutation
export function useCacheDecr() {
  return useMutation({
    mutationFn: (params: { key: string; by?: number; namespace?: string }) =>
      postApi<IncrResponse>('/cache/decr', params),
  })
}

// Cache TTL query
export function useCacheTTL(key: string, namespace?: string) {
  return useQuery({
    queryKey: ['cache-ttl', key, namespace],
    queryFn: () => {
      const params = new URLSearchParams({ key })
      if (namespace) params.set('namespace', namespace)
      return fetchApi<TTLResponse>(`/cache/ttl?${params}`)
    },
    enabled: !!key,
  })
}

// Cache KEYS query
export function useCacheKeys(pattern?: string, namespace?: string) {
  return useQuery({
    queryKey: ['cache-keys', pattern, namespace],
    queryFn: () => {
      const params = new URLSearchParams()
      if (pattern) params.set('pattern', pattern)
      if (namespace) params.set('namespace', namespace)
      return fetchApi<KeysResponse>(`/cache/keys?${params}`)
    },
  })
}

// Cache CLEAR mutation
export function useCacheClear() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (namespace?: string) => {
      const params = namespace ? `?namespace=${namespace}` : ''
      return fetch(`/cache/clear${params}`, { method: 'DELETE' }).then((r) =>
        r.json()
      ) as Promise<{ success: boolean }>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cache-stats'] })
      queryClient.invalidateQueries({ queryKey: ['cache-keys'] })
    },
  })
}

// Hash operations
export function useCacheHSet() {
  return useMutation({
    mutationFn: (params: {
      key: string
      field: string
      value: string
      namespace?: string
    }) => postApi<{ added: number }>('/cache/hset', params),
  })
}

export function useCacheHGet() {
  return useMutation({
    mutationFn: (params: { key: string; field: string; namespace?: string }) => {
      const searchParams = new URLSearchParams({
        key: params.key,
        field: params.field,
      })
      if (params.namespace) searchParams.set('namespace', params.namespace)
      return fetchApi<GetResponse>(`/cache/hget?${searchParams}`)
    },
  })
}

export function useCacheHGetAll() {
  return useMutation({
    mutationFn: (params: { key: string; namespace?: string }) => {
      const searchParams = new URLSearchParams({ key: params.key })
      if (params.namespace) searchParams.set('namespace', params.namespace)
      return fetchApi<{ hash: Record<string, string> }>(
        `/cache/hgetall?${searchParams}`
      )
    },
  })
}

// List operations
export function useCacheLPush() {
  return useMutation({
    mutationFn: (params: {
      key: string
      values: string[]
      namespace?: string
    }) => postApi<{ length: number }>('/cache/lpush', params),
  })
}

export function useCacheRPush() {
  return useMutation({
    mutationFn: (params: {
      key: string
      values: string[]
      namespace?: string
    }) => postApi<{ length: number }>('/cache/rpush', params),
  })
}

export function useCacheLRange() {
  return useMutation({
    mutationFn: (params: {
      key: string
      start: number
      stop: number
      namespace?: string
    }) => postApi<{ values: string[] }>('/cache/lrange', params),
  })
}

// Set operations
export function useCacheSAdd() {
  return useMutation({
    mutationFn: (params: {
      key: string
      members: string[]
      namespace?: string
    }) => postApi<{ added: number }>('/cache/sadd', params),
  })
}

export function useCacheSMembers() {
  return useMutation({
    mutationFn: (params: { key: string; namespace?: string }) => {
      const searchParams = new URLSearchParams({ key: params.key })
      if (params.namespace) searchParams.set('namespace', params.namespace)
      return fetchApi<{ members: string[] }>(`/cache/smembers?${searchParams}`)
    },
  })
}

// Sorted set operations
export function useCacheZAdd() {
  return useMutation({
    mutationFn: (params: {
      key: string
      members: Array<{ member: string; score: number }>
      namespace?: string
    }) => postApi<{ added: number }>('/cache/zadd', params),
  })
}

export function useCacheZRange() {
  return useMutation({
    mutationFn: (params: {
      key: string
      start: number
      stop: number
      namespace?: string
    }) => {
      const searchParams = new URLSearchParams({
        key: params.key,
        start: String(params.start),
        stop: String(params.stop),
      })
      if (params.namespace) searchParams.set('namespace', params.namespace)
      return fetchApi<{ members: string[] }>(`/cache/zrange?${searchParams}`)
    },
  })
}


