/**
 * Real-time Price Streaming Hook
 *
 * Connects to DWS price streaming service for real-time token prices.
 * Uses WebSocket for live updates with REST fallback.
 *
 * Usage:
 * ```tsx
 * const { prices, isConnected, error, subscribe, unsubscribe } = usePriceStream();
 *
 * // Subscribe to tokens
 * useEffect(() => {
 *   subscribe({ tokens: [{ chainId: 1, address: '0x...' }] });
 *   return () => unsubscribe({ tokens: [{ chainId: 1, address: '0x...' }] });
 * }, []);
 *
 * // Or subscribe to entire chains
 * subscribe({ chains: [1, 42161] });
 * ```
 */

import { useCallback, useEffect, useRef, useState } from 'react'
export interface TokenPrice {
  address: string
  chainId: number
  symbol: string
  priceUSD: number
  priceETH: number
  confidence: number
  liquidityUSD: number
  timestamp: number
}

export interface PriceUpdate {
  type: 'price_update'
  chainId: number
  token: string
  priceUSD: number
  priceChange24h: number
  volume24h: string
  timestamp: number
}

export interface SubscriptionMessage {
  type: 'subscribe' | 'unsubscribe'
  tokens?: Array<{ chainId: number; address: string }>
  chains?: number[]
}

export interface UsePriceStreamOptions {
  /** DWS endpoint - defaults to env or localhost */
  endpoint?: string
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean
  /** Reconnect delay in ms */
  reconnectDelay?: number
  /** Maximum reconnection attempts */
  maxReconnectAttempts?: number
}

export interface UsePriceStreamReturn {
  /** Current prices keyed by chainId:address */
  prices: Map<string, PriceUpdate>
  /** WebSocket connection status */
  isConnected: boolean
  /** Last error if any */
  error: Error | null
  /** Subscribe to price updates */
  subscribe: (msg: Omit<SubscriptionMessage, 'type'>) => void
  /** Unsubscribe from price updates */
  unsubscribe: (msg: Omit<SubscriptionMessage, 'type'>) => void
  /** Get price for a specific token (from cache) */
  getPrice: (chainId: number, address: string) => PriceUpdate | undefined
  /** Manually fetch a price via REST */
  fetchPrice: (chainId: number, address: string) => Promise<TokenPrice | null>
}
const DEFAULT_ENDPOINT =
  typeof window !== 'undefined'
    ? (process.env.PUBLIC_DWS_URL ?? 'http://localhost:4030')
    : 'http://localhost:4030'

const DEFAULT_OPTIONS: Required<UsePriceStreamOptions> = {
  endpoint: DEFAULT_ENDPOINT,
  autoReconnect: true,
  reconnectDelay: 3000,
  maxReconnectAttempts: 10,
}

// Security constants
const MAX_WS_MESSAGE_SIZE = 1024 * 100 // 100KB max message size
const MAX_SUBSCRIPTIONS = 1000 // Maximum tracked subscriptions to prevent memory issues
export function usePriceStream(
  options?: UsePriceStreamOptions,
): UsePriceStreamReturn {
  const config = { ...DEFAULT_OPTIONS, ...options }

  const [prices, setPrices] = useState<Map<string, PriceUpdate>>(new Map())
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttempts = useRef(0)
  const subscriptionsRef = useRef<Set<string>>(new Set())
  const pendingSubscriptions = useRef<SubscriptionMessage[]>([])

  // Build WebSocket URL
  const wsEndpoint = `${config.endpoint.replace(/^http/, 'ws')}/prices/ws`

  /**
   * Connect to WebSocket
   */
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(wsEndpoint)
    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
      setError(null)
      reconnectAttempts.current = 0
      console.log('[PriceStream] Connected')

      // Resubscribe to existing subscriptions
      for (const sub of pendingSubscriptions.current) {
        ws.send(JSON.stringify(sub))
      }
      pendingSubscriptions.current = []
    }

    ws.onmessage = (event) => {
      // Security: Validate message size to prevent DoS
      const messageData = typeof event.data === 'string' ? event.data : ''
      if (messageData.length > MAX_WS_MESSAGE_SIZE) {
        console.warn(
          '[PriceStream] Message too large, ignoring:',
          messageData.length,
        )
        return
      }

      // Security: Safe JSON parsing with validation
      let data: { type?: string; chainId?: number; token?: string }
      try {
        data = JSON.parse(messageData)
      } catch {
        console.warn('[PriceStream] Invalid JSON message')
        return
      }

      // Validate message structure before processing
      if (
        data.type === 'price_update' &&
        typeof data.chainId === 'number' &&
        typeof data.token === 'string' &&
        data.token.length <= 66 // Max address length
      ) {
        const update = data as PriceUpdate
        const key = `${update.chainId}:${update.token.toLowerCase()}`

        setPrices((prev) => {
          const next = new Map(prev)
          // Prevent unbounded growth
          if (next.size >= 10000) {
            const firstKey = next.keys().next().value
            if (firstKey) next.delete(firstKey)
          }
          next.set(key, update)
          return next
        })
      }
    }

    ws.onerror = (e) => {
      console.error('[PriceStream] WebSocket error:', e)
      setError(new Error('WebSocket connection error'))
    }

    ws.onclose = () => {
      setIsConnected(false)
      wsRef.current = null
      console.log('[PriceStream] Disconnected')

      // Auto-reconnect
      if (
        config.autoReconnect &&
        reconnectAttempts.current < config.maxReconnectAttempts
      ) {
        reconnectAttempts.current++
        console.log(
          `[PriceStream] Reconnecting in ${config.reconnectDelay}ms (attempt ${reconnectAttempts.current})`,
        )
        setTimeout(connect, config.reconnectDelay)
      }
    }
  }, [
    wsEndpoint,
    config.autoReconnect,
    config.reconnectDelay,
    config.maxReconnectAttempts,
  ])

  /**
   * Subscribe to price updates
   */
  const subscribe = useCallback((msg: Omit<SubscriptionMessage, 'type'>) => {
    const fullMsg: SubscriptionMessage = { ...msg, type: 'subscribe' }

    // Track subscriptions for reconnection with size limit
    if (msg.tokens) {
      for (const t of msg.tokens) {
        if (subscriptionsRef.current.size >= MAX_SUBSCRIPTIONS) {
          console.warn('[PriceStream] Maximum subscriptions reached')
          break
        }
        subscriptionsRef.current.add(`${t.chainId}:${t.address.toLowerCase()}`)
      }
    }
    if (msg.chains) {
      for (const c of msg.chains) {
        if (subscriptionsRef.current.size >= MAX_SUBSCRIPTIONS) {
          console.warn('[PriceStream] Maximum subscriptions reached')
          break
        }
        subscriptionsRef.current.add(`chain:${c}`)
      }
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(fullMsg))
    } else {
      pendingSubscriptions.current.push(fullMsg)
    }
  }, [])

  /**
   * Unsubscribe from price updates
   */
  const unsubscribe = useCallback((msg: Omit<SubscriptionMessage, 'type'>) => {
    const fullMsg: SubscriptionMessage = { ...msg, type: 'unsubscribe' }

    // Remove from tracked subscriptions
    if (msg.tokens) {
      for (const t of msg.tokens) {
        subscriptionsRef.current.delete(
          `${t.chainId}:${t.address.toLowerCase()}`,
        )
      }
    }
    if (msg.chains) {
      for (const c of msg.chains) {
        subscriptionsRef.current.delete(`chain:${c}`)
      }
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(fullMsg))
    }
  }, [])

  /**
   * Get price from local cache
   */
  const getPrice = useCallback(
    (chainId: number, address: string): PriceUpdate | undefined => {
      return prices.get(`${chainId}:${address.toLowerCase()}`)
    },
    [prices],
  )

  /**
   * Fetch price via REST API
   */
  const fetchPrice = useCallback(
    async (chainId: number, address: string): Promise<TokenPrice | null> => {
      const url = `${config.endpoint}/prices/${chainId}/${address}`
      const response = await fetch(url)

      if (!response.ok) {
        if (response.status === 404) return null
        throw new Error(`Failed to fetch price: ${response.statusText}`)
      }

      return response.json()
    },
    [config.endpoint],
  )

  // Connect on mount
  useEffect(() => {
    connect()

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [connect])

  return {
    prices,
    isConnected,
    error,
    subscribe,
    unsubscribe,
    getPrice,
    fetchPrice,
  }
}
/**
 * Hook to get real-time price for a single token
 */
export function useTokenPrice(
  chainId: number,
  address: string,
): {
  price: PriceUpdate | null
  isLoading: boolean
  error: Error | null
} {
  const { prices, subscribe, unsubscribe, isConnected, error } =
    usePriceStream()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (isConnected) {
      subscribe({ tokens: [{ chainId, address }] })
      setIsLoading(false)
    }

    return () => {
      unsubscribe({ tokens: [{ chainId, address }] })
    }
  }, [chainId, address, isConnected, subscribe, unsubscribe])

  const price = prices.get(`${chainId}:${address.toLowerCase()}`) ?? null

  return { price, isLoading, error }
}

/**
 * Hook to get real-time prices for multiple tokens
 */
export function useTokenPrices(
  tokens: Array<{ chainId: number; address: string }>,
): {
  prices: Map<string, PriceUpdate>
  isLoading: boolean
  error: Error | null
} {
  const {
    prices: allPrices,
    subscribe,
    unsubscribe,
    isConnected,
    error,
  } = usePriceStream()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (isConnected && tokens.length > 0) {
      subscribe({ tokens })
      setIsLoading(false)
    }

    return () => {
      if (tokens.length > 0) {
        unsubscribe({ tokens })
      }
    }
  }, [tokens, isConnected, subscribe, unsubscribe])

  // Filter to only requested tokens
  const filteredPrices = new Map<string, PriceUpdate>()
  for (const t of tokens) {
    const key = `${t.chainId}:${t.address.toLowerCase()}`
    const price = allPrices.get(key)
    if (price) {
      filteredPrices.set(key, price)
    }
  }

  return { prices: filteredPrices, isLoading, error }
}

/**
 * Hook to get ETH price for a chain
 */
export function useETHPrice(chainId: number = 1): {
  priceUSD: number | null
  isLoading: boolean
  error: Error | null
} {
  const [priceUSD, setPriceUSD] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const endpoint = process.env.PUBLIC_DWS_URL ?? 'http://localhost:4030'

  useEffect(() => {
    let mounted = true

    async function fetchETHPrice() {
      const response = await fetch(`${endpoint}/prices/eth/${chainId}`)
      if (!response.ok) throw new Error('Failed to fetch ETH price')
      const data = await response.json()
      if (mounted) {
        setPriceUSD(data.priceUSD)
        setIsLoading(false)
      }
    }

    fetchETHPrice().catch((e) => {
      if (mounted) {
        setError(e)
        setIsLoading(false)
      }
    })

    // Refresh every 60 seconds
    const interval = setInterval(fetchETHPrice, 60_000)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [chainId, endpoint])

  return { priceUSD, isLoading, error }
}
/**
 * Fetch token prices in batch (for initial load / SSR)
 */
export async function fetchTokenPrices(
  tokens: Array<{ chainId: number; address: string }>,
  endpoint?: string,
): Promise<Record<string, TokenPrice>> {
  const url = endpoint ?? process.env.PUBLIC_DWS_URL ?? 'http://localhost:4030'

  const response = await fetch(`${url}/prices/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokens }),
  })

  if (!response.ok) {
    throw new Error('Failed to fetch prices')
  }

  const data = await response.json()
  return data.prices
}

/**
 * Track a token for price updates
 */
export async function trackToken(
  chainId: number,
  address: string,
  endpoint?: string,
): Promise<void> {
  const url = endpoint ?? process.env.PUBLIC_DWS_URL ?? 'http://localhost:4030'

  await fetch(`${url}/prices/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chainId, address }),
  })
}
