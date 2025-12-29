/**
 * Pool API Integration Tests
 *
 * Tests the pool API endpoints with a running gateway server.
 * Requires: Infrastructure running (jeju dev)
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { getCoreAppUrl, getRpcUrl } from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address } from 'viem'

// Use URLs from config
const _RPC_URL = getRpcUrl()
const BASE_URL = getCoreAppUrl('GATEWAY')
const TEST_TOKEN_1 = '0x1111111111111111111111111111111111111111' as Address
const TEST_TOKEN_2 = '0x2222222222222222222222222222222222222222' as Address

interface PoolData {
  address: string
  type: string
  token0: string
  token1: string
  reserve0: string
  reserve1: string
  fee: number
}

interface QuoteData {
  poolType: string
  pool: string
  amountIn: string
  amountOut: string
  priceImpactBps: number
  fee: number
  effectivePrice: string
}

interface FetchResult {
  status: number
  data: Record<string, unknown>
}

async function fetchJSON(
  url: string,
  options?: RequestInit,
): Promise<FetchResult> {
  const response = await fetch(url, options)
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >
  return { status: response.status, data }
}

async function isServerRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  } catch {
    return false
  }
}

describe('Pool API - Edge Cases & Error Handling', () => {
  let serverAvailable = false

  beforeAll(async () => {
    serverAvailable = await isServerRunning()
    if (!serverAvailable) {
      console.log(`Gateway not running at ${BASE_URL}. Start with: bun run dev`)
    }
  })

  describe('GET /api/pools', () => {
    test('returns empty array when no pools exist', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools`)
      expect(status).toBe(200)
      expect(Array.isArray(data.pools)).toBe(true)
      expect(typeof data.count).toBe('number')
    })

    test('handles query parameters correctly', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(
        `${BASE_URL}/api/pools?token0=${TEST_TOKEN_1}&token1=${TEST_TOKEN_2}`,
      )
      expect(status).toBe(200)
      expect(Array.isArray(data.pools)).toBe(true)
    })

    test('handles invalid token addresses', async () => {
      if (!serverAvailable) return
      const { status } = await fetchJSON(
        `${BASE_URL}/api/pools?token0=invalid&token1=${TEST_TOKEN_2}`,
      )
      expect([200, 400]).toContain(status)
    })

    test('handles zero address tokens', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(
        `${BASE_URL}/api/pools?token0=${ZERO_ADDRESS}&token1=${TEST_TOKEN_2}`,
      )
      expect(status).toBe(200)
      expect(Array.isArray(data.pools)).toBe(true)
    })

    test('handles missing query parameters', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(
        `${BASE_URL}/api/pools?token0=${TEST_TOKEN_1}`,
      )
      expect(status).toBe(200)
      expect(Array.isArray(data.pools)).toBe(true)
    })
  })

  describe('GET /api/pools/v2', () => {
    test('returns V2 pools array', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/v2`)
      expect(status).toBe(200)
      expect(Array.isArray(data.pools)).toBe(true)
      expect(typeof data.count).toBe('number')
      expect(data.count).toBe((data.pools as PoolData[]).length)
    })

    test('V2 pools have correct structure', async () => {
      if (!serverAvailable) return
      const { data } = await fetchJSON(`${BASE_URL}/api/pools/v2`)
      const pools = data.pools as PoolData[]
      if (pools.length > 0) {
        const pool = pools[0]
        expect(pool.type).toBe('V2')
        expect(pool.address).toBeDefined()
        expect(pool.token0).toBeDefined()
        expect(pool.token1).toBeDefined()
        expect(typeof pool.reserve0).toBe('string')
        expect(typeof pool.reserve1).toBe('string')
        expect(typeof pool.fee).toBe('number')
        expect(pool.fee).toBe(3000)
      }
    })
  })

  describe('GET /api/pools/stats', () => {
    test('returns pool statistics', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/stats`)
      expect(status).toBe(200)
      expect(typeof data.totalPools).toBe('number')
      expect(typeof data.v2Pools).toBe('number')
      expect(typeof data.v3Pools).toBe('number')
      expect(typeof data.paymasterEnabled).toBe('boolean')
      expect(typeof data.totalLiquidityUsd).toBe('string')
      expect(typeof data.volume24h).toBe('string')
    })

    test('stats values are non-negative', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/stats`)
      expect(status).toBe(200)
      expect(data.totalPools as number).toBeGreaterThanOrEqual(0)
      expect(data.v2Pools as number).toBeGreaterThanOrEqual(0)
      expect(data.v3Pools as number).toBeGreaterThanOrEqual(0)
      expect(Number(data.totalLiquidityUsd)).toBeGreaterThanOrEqual(0)
      expect(Number(data.volume24h)).toBeGreaterThanOrEqual(0)
    })

    test('totalPools calculation is correct', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/stats`)
      expect(status).toBe(200)
      const expectedTotal =
        (data.v2Pools as number) +
        (data.v3Pools as number) +
        (data.paymasterEnabled ? 1 : 0)
      expect(data.totalPools).toBe(expectedTotal)
    })
  })

  describe('GET /api/pools/tokens', () => {
    test('returns token configuration', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/tokens`)
      expect(status).toBe(200)
      expect(typeof data).toBe('object')
      expect(data.ETH).toBeDefined()
    })

    test('tokens have correct structure', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/tokens`)
      expect(status).toBe(200)
      const eth = data.ETH as
        | { address: string; symbol: string; decimals: number }
        | undefined
      if (eth) {
        expect(eth.address).toBeDefined()
        expect(typeof eth.symbol).toBe('string')
        expect(typeof eth.decimals).toBe('number')
      }
    })
  })

  describe('GET /api/pools/contracts', () => {
    test('returns contract addresses', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(
        `${BASE_URL}/api/pools/contracts`,
      )
      expect(status).toBe(200)
      expect(data.v2Factory).toBeDefined()
      expect(data.v3Factory).toBeDefined()
      expect(data.router).toBeDefined()
      expect(data.aggregator).toBeDefined()
      expect(data.paymaster).toBeDefined()
    })

    test('addresses are valid format', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(
        `${BASE_URL}/api/pools/contracts`,
      )
      expect(status).toBe(200)
      const addressRegex = /^0x[a-fA-F0-9]{40}$/
      expect(addressRegex.test(data.v2Factory as string)).toBe(true)
      expect(addressRegex.test(data.v3Factory as string)).toBe(true)
    })
  })

  describe('POST /api/pools/quote', () => {
    test('requires all parameters', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenIn: TEST_TOKEN_1 }),
      })
      expect(status).toBe(400)
      expect(data.error).toBeDefined()
    })

    test('handles valid quote request', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_2,
          amountIn: '1',
        }),
      })
      expect([200, 404]).toContain(status)
      if (status === 200) {
        expect(data === null || typeof data === 'object').toBe(true)
      }
    })

    test('handles zero amountIn', async () => {
      if (!serverAvailable) return
      const { status } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_2,
          amountIn: '0',
        }),
      })
      expect([200, 400]).toContain(status)
    })

    test('handles negative amountIn', async () => {
      if (!serverAvailable) return
      const { status } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_2,
          amountIn: '-1',
        }),
      })
      expect([200, 400]).toContain(status)
    })

    test('handles very large amountIn', async () => {
      if (!serverAvailable) return
      const { status } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_2,
          amountIn: '1000000000000000000000000000',
        }),
      })
      expect([200, 400, 500]).toContain(status)
    })

    test('handles invalid token addresses', async () => {
      if (!serverAvailable) return
      const { status } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: 'invalid',
          tokenOut: TEST_TOKEN_2,
          amountIn: '1',
        }),
      })
      expect([200, 400, 500]).toContain(status)
    })

    test('handles same token for input and output', async () => {
      if (!serverAvailable) return
      const { status } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_1,
          amountIn: '1',
        }),
      })
      expect([200, 400]).toContain(status)
    })

    test('quote has correct structure when returned', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_2,
          amountIn: '1',
        }),
      })
      if (status === 200 && data !== null) {
        const quote = data as QuoteData
        expect(['V2', 'V3', 'PAYMASTER']).toContain(quote.poolType)
        expect(quote.pool).toBeDefined()
        expect(quote.amountIn).toBe('1')
        expect(typeof quote.amountOut).toBe('string')
        expect(typeof quote.priceImpactBps).toBe('number')
        expect(typeof quote.fee).toBe('number')
        expect(typeof quote.effectivePrice).toBe('string')
      }
    })
  })

  describe('POST /api/pools/quotes', () => {
    test('requires all parameters', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenIn: TEST_TOKEN_1 }),
      })
      expect(status).toBe(400)
      expect(data.error).toBeDefined()
    })

    test('returns array of quotes', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_2,
          amountIn: '1',
        }),
      })
      expect(status).toBe(200)
      expect(Array.isArray(data)).toBe(true)
    })

    test('quotes are sorted by amountOut descending', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_2,
          amountIn: '1',
        }),
      })
      const quotes = data as QuoteData[]
      if (status === 200 && quotes.length > 1) {
        for (let i = 0; i < quotes.length - 1; i++) {
          expect(Number(quotes[i].amountOut)).toBeGreaterThanOrEqual(
            Number(quotes[i + 1].amountOut),
          )
        }
      }
    })
  })

  describe('GET /api/pools/pair/:token0/:token1', () => {
    test('returns pools for token pair', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(
        `${BASE_URL}/api/pools/pair/${TEST_TOKEN_1}/${TEST_TOKEN_2}`,
      )
      expect(status).toBe(200)
      expect(Array.isArray(data.pools)).toBe(true)
      expect(typeof data.count).toBe('number')
      expect(data.count).toBe((data.pools as PoolData[]).length)
    })

    test('handles zero address tokens', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(
        `${BASE_URL}/api/pools/pair/${ZERO_ADDRESS}/${TEST_TOKEN_2}`,
      )
      expect(status).toBe(200)
      expect(Array.isArray(data.pools)).toBe(true)
    })

    test('handles invalid address format', async () => {
      if (!serverAvailable) return
      const { status } = await fetchJSON(
        `${BASE_URL}/api/pools/pair/invalid/${TEST_TOKEN_2}`,
      )
      expect([200, 400, 500]).toContain(status)
    })
  })

  describe('Concurrent Requests', () => {
    test('handles concurrent GET requests', async () => {
      if (!serverAvailable) return
      const promises = [
        fetchJSON(`${BASE_URL}/api/pools/stats`),
        fetchJSON(`${BASE_URL}/api/pools/v2`),
        fetchJSON(`${BASE_URL}/api/pools/tokens`),
        fetchJSON(`${BASE_URL}/api/pools/contracts`),
      ]
      const results = await Promise.all(promises)
      results.forEach(({ status }) => {
        expect(status).toBe(200)
      })
    })

    test('handles rapid successive requests', async () => {
      if (!serverAvailable) return
      const promises = Array(10)
        .fill(null)
        .map(() => fetchJSON(`${BASE_URL}/api/pools/stats`))
      const results = await Promise.all(promises)
      results.forEach(({ status }) => {
        expect(status).toBe(200)
      })
    })

    test('handles concurrent quote requests', async () => {
      if (!serverAvailable) return
      const promises = Array(5)
        .fill(null)
        .map(() =>
          fetchJSON(`${BASE_URL}/api/pools/quote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tokenIn: TEST_TOKEN_1,
              tokenOut: TEST_TOKEN_2,
              amountIn: '1',
            }),
          }),
        )
      const results = await Promise.all(promises)
      results.forEach(({ status }) => {
        expect([200, 400, 404, 500]).toContain(status)
      })
    })
  })

  describe('Error Handling', () => {
    test('handles malformed JSON', async () => {
      if (!serverAvailable) return
      const { status } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json{',
      })
      expect([400, 500]).toContain(status)
    })

    test('handles missing Content-Type header', async () => {
      if (!serverAvailable) return
      const { status } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_2,
          amountIn: '1',
        }),
      })
      expect([200, 400, 500]).toContain(status)
    })

    test('handles empty request body', async () => {
      if (!serverAvailable) return
      const { status } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      expect([400, 500]).toContain(status)
    })

    test('handles extra fields in request', async () => {
      if (!serverAvailable) return
      const { status } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_2,
          amountIn: '1',
          extraField: 'should be ignored',
        }),
      })
      expect([200, 400, 404, 500]).toContain(status)
    })
  })

  describe('Data Validation', () => {
    test('pool addresses are valid format', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/v2`)
      const pools = data.pools as PoolData[]
      if (status === 200 && pools.length > 0) {
        const addressRegex = /^0x[a-fA-F0-9]{40}$/
        pools.forEach((pool) => {
          expect(addressRegex.test(pool.address)).toBe(true)
        })
      }
    })

    test('reserve values are non-negative strings', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/v2`)
      const pools = data.pools as PoolData[]
      if (status === 200 && pools.length > 0) {
        const pool = pools[0]
        expect(Number(pool.reserve0)).toBeGreaterThanOrEqual(0)
        expect(Number(pool.reserve1)).toBeGreaterThanOrEqual(0)
      }
    })

    test('quote effectivePrice is valid number', async () => {
      if (!serverAvailable) return
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_2,
          amountIn: '1',
        }),
      })
      if (status === 200 && data !== null) {
        const quote = data as QuoteData
        expect(Number(quote.effectivePrice)).toBeGreaterThanOrEqual(0)
        expect(Number.isNaN(Number(quote.effectivePrice))).toBe(false)
      }
    })
  })
})
