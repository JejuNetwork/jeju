/**
 * Path Optimization with Bellman-Ford
 *
 * Finds optimal multi-hop arbitrage paths across DEXes.
 * Uses negative log transformation to convert multiplicative
 * rates to additive weights for Bellman-Ford.
 */

import type { Address } from 'viem'

interface Pool {
  id: string
  dex: string
  token0: Address
  token1: Address
  reserve0: bigint
  reserve1: bigint
  fee: number // basis points
}

interface Edge {
  from: Address
  to: Address
  pool: Pool
  rate: number // exchange rate including fee
  weight: number // -log(rate) for Bellman-Ford
}

interface ArbitragePath {
  path: Address[]
  pools: Pool[]
  expectedReturn: number // multiplier (1.01 = 1% profit)
  profitBps: number
}

export class PathOptimizer {
  private edges: Map<string, Edge[]> = new Map()
  private tokens: Set<Address> = new Set()

  /**
   * Add pool to graph
   */
  addPool(pool: Pool): void {
    this.tokens.add(pool.token0)
    this.tokens.add(pool.token1)

    // Calculate rates both directions
    const rate01 = this.calculateRate(pool, true)
    const rate10 = this.calculateRate(pool, false)

    // Add edges both directions
    this.addEdge({
      from: pool.token0,
      to: pool.token1,
      pool,
      rate: rate01,
      weight: -Math.log(rate01),
    })

    this.addEdge({
      from: pool.token1,
      to: pool.token0,
      pool,
      rate: rate10,
      weight: -Math.log(rate10),
    })
  }

  /**
   * Find all arbitrage cycles from a source token
   */
  findArbitragePaths(sourceToken: Address, maxHops: number = 4): ArbitragePath[] {
    const paths: ArbitragePath[] = []

    // BFS to find all paths back to source
    const queue: Array<{
      current: Address
      path: Address[]
      pools: Pool[]
      totalReturn: number
    }> = [{ current: sourceToken, path: [sourceToken], pools: [], totalReturn: 1 }]

    while (queue.length > 0) {
      const state = queue.shift()
      if (!state) break

      const { current, path, pools, totalReturn } = state

      // Check if we found a cycle back to source
      if (path.length > 1 && current === sourceToken) {
        if (totalReturn > 1.0001) {
          // > 0.01% profit threshold
          paths.push({
            path,
            pools,
            expectedReturn: totalReturn,
            profitBps: (totalReturn - 1) * 10000,
          })
        }
        continue
      }

      // Max hops reached
      if (path.length > maxHops) continue

      // Explore neighbors
      const edges = this.edges.get(current) ?? []
      for (const edge of edges) {
        // Avoid revisiting tokens (except source for cycle)
        if (path.includes(edge.to) && edge.to !== sourceToken) continue

        // Skip if same pool used (no double-dipping)
        if (pools.some((p) => p.id === edge.pool.id)) continue

        queue.push({
          current: edge.to,
          path: [...path, edge.to],
          pools: [...pools, edge.pool],
          totalReturn: totalReturn * edge.rate,
        })
      }
    }

    // Sort by profit
    return paths.sort((a, b) => b.profitBps - a.profitBps)
  }

  /**
   * Find negative cycle using Bellman-Ford (most profitable arbitrage)
   */
  findBestArbitrage(sourceToken: Address): ArbitragePath | null {
    const tokens = Array.from(this.tokens)
    const dist: Map<Address, number> = new Map()
    const prev: Map<Address, { token: Address; pool: Pool } | null> = new Map()

    // Initialize
    for (const token of tokens) {
      dist.set(token, token === sourceToken ? 0 : Infinity)
      prev.set(token, null)
    }

    // Relax edges V-1 times
    for (let i = 0; i < tokens.length - 1; i++) {
      for (const [from, edges] of this.edges) {
        const fromDist = dist.get(from as Address) ?? Infinity
        if (fromDist === Infinity) continue

        for (const edge of edges) {
          const newDist = fromDist + edge.weight
          const toDist = dist.get(edge.to) ?? Infinity

          if (newDist < toDist) {
            dist.set(edge.to, newDist)
            prev.set(edge.to, { token: edge.from, pool: edge.pool })
          }
        }
      }
    }

    // Check for negative cycle (which means arbitrage opportunity)
    for (const [from, edges] of this.edges) {
      const fromDist = dist.get(from as Address) ?? Infinity
      if (fromDist === Infinity) continue

      for (const edge of edges) {
        const newDist = fromDist + edge.weight
        const toDist = dist.get(edge.to) ?? Infinity

        if (newDist < toDist) {
          // Found negative cycle - reconstruct path
          return this.reconstructCycle(edge.to, prev)
        }
      }
    }

    return null
  }

  /**
   * Update pool reserves (for real-time updates)
   */
  updatePool(poolId: string, reserve0: bigint, reserve1: bigint): void {
    for (const [, edges] of this.edges) {
      for (const edge of edges) {
        if (edge.pool.id === poolId) {
          edge.pool.reserve0 = reserve0
          edge.pool.reserve1 = reserve1

          const isForward = edge.from === edge.pool.token0
          edge.rate = this.calculateRate(edge.pool, isForward)
          edge.weight = -Math.log(edge.rate)
        }
      }
    }
  }

  /**
   * Get all tokens in the graph
   */
  getTokens(): Address[] {
    return Array.from(this.tokens)
  }

  /**
   * Get statistics about the graph
   */
  getStats(): { tokens: number; edges: number; pools: number } {
    let totalEdges = 0
    const poolIds = new Set<string>()

    for (const [, edges] of this.edges) {
      totalEdges += edges.length
      for (const edge of edges) {
        poolIds.add(edge.pool.id)
      }
    }

    return {
      tokens: this.tokens.size,
      edges: totalEdges,
      pools: poolIds.size,
    }
  }

  private addEdge(edge: Edge): void {
    const existing = this.edges.get(edge.from) ?? []
    existing.push(edge)
    this.edges.set(edge.from, existing)
  }

  private calculateRate(pool: Pool, isToken0ToToken1: boolean): number {
    const r0 = Number(pool.reserve0)
    const r1 = Number(pool.reserve1)

    // Constant product rate: dy/dx = y/(x+dx) ≈ y/x for small trades
    const baseRate = isToken0ToToken1 ? r1 / r0 : r0 / r1

    // Apply fee
    return baseRate * (1 - pool.fee / 10000)
  }

  private reconstructCycle(
    cycleNode: Address,
    prev: Map<Address, { token: Address; pool: Pool } | null>
  ): ArbitragePath {
    const path: Address[] = []
    const pools: Pool[] = []
    let current: Address | null = cycleNode
    const visited = new Set<Address>()

    // Find the cycle
    while (current && !visited.has(current)) {
      visited.add(current)
      path.unshift(current)
      const prevInfo = prev.get(current)
      if (prevInfo) {
        pools.unshift(prevInfo.pool)
        current = prevInfo.token
      } else {
        break
      }
    }

    // Complete the cycle
    if (current) {
      path.push(current)
    }

    // Calculate return
    let expectedReturn = 1
    for (let i = 0; i < pools.length; i++) {
      const pool = pools[i]
      const fromToken = path[i]
      const isForward = fromToken === pool.token0
      expectedReturn *= this.calculateRate(pool, isForward)
    }

    return {
      path,
      pools,
      expectedReturn,
      profitBps: (expectedReturn - 1) * 10000,
    }
  }
}

export function createPathOptimizer(): PathOptimizer {
  return new PathOptimizer()
}

export type { Pool, ArbitragePath }

