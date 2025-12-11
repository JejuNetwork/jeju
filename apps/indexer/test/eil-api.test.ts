/**
 * EIL Indexer API Tests
 * 
 * Tests the GraphQL API for EIL data:
 * - XLP queries
 * - Voucher request queries
 * - Transfer queries
 * - Stats queries
 */

import { describe, it, expect, beforeAll } from 'bun:test'

const GRAPHQL_ENDPOINT = process.env.INDEXER_GRAPHQL_URL || 'http://localhost:4350/graphql'

interface GraphQLResponse<T> {
  data?: T
  errors?: Array<{ message: string }>
}

let endpointAvailable = false

async function checkEndpointAvailability(): Promise<boolean> {
  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' })
    })
    if (!response.ok) {
      return false
    }
    const text = await response.text()
    if (!text || text.trim() === '') {
      return false
    }
    try {
      const result = JSON.parse(text)
      // Check if it's a valid GraphQL response (has data or errors)
      return result && (result.data !== undefined || result.errors !== undefined)
    } catch {
      return false
    }
  } catch {
    return false
  }
}

async function query<T>(queryString: string, variables?: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: queryString, variables })
    })
  } catch (error) {
    throw new Error(`Failed to connect to GraphQL endpoint: ${error instanceof Error ? error.message : String(error)}`)
  }
  
  if (!response.ok) {
    throw new Error(`GraphQL request failed with status ${response.status}: ${response.statusText}`)
  }
  
  const text = await response.text()
  if (!text || text.trim() === '') {
    throw new Error(`Empty response from GraphQL endpoint (status: ${response.status})`)
  }
  
  let result: GraphQLResponse<T>
  try {
    result = JSON.parse(text) as GraphQLResponse<T>
  } catch (error) {
    throw new Error(`Failed to parse JSON response: ${error instanceof Error ? error.message : String(error)}. Response: ${text.substring(0, 200)}`)
  }
  
  if (result.errors) {
    throw new Error(result.errors[0].message)
  }
  
  if (!result.data) {
    throw new Error('No data in GraphQL response')
  }
  
  return result.data
}

describe('EIL GraphQL API', () => {
  beforeAll(async () => {
    endpointAvailable = await checkEndpointAvailability()
    if (!endpointAvailable) {
      console.warn(`⚠️  GraphQL endpoint not available at ${GRAPHQL_ENDPOINT}. Skipping integration tests.`)
    }
  })

  describe('XLP Queries', () => {
    it('should query all XLPs', async () => {
      if (!endpointAvailable) {
        console.log('⏭️  Skipping: GraphQL endpoint not available')
        return
      }
      const result = await query<{ xlps: Array<{ id: string }> }>(`
        query {
          xlps {
            id
            address
            stakedAmount
            isActive
            supportedChains
            totalVouchersIssued
            totalVouchersFulfilled
            totalFeesEarned
            reputation
          }
        }
      `)
      
      expect(result.xlps).toBeDefined()
      expect(Array.isArray(result.xlps)).toBe(true)
    })

    it('should query active XLPs only', async () => {
      if (!endpointAvailable) {
        console.log('⏭️  Skipping: GraphQL endpoint not available')
        return
      }
      const result = await query<{ xlps: Array<{ id: string; isActive: boolean }> }>(`
        query {
          xlps(where: { isActive_eq: true }) {
            id
            isActive
          }
        }
      `)
      
      expect(result.xlps).toBeDefined()
      result.xlps.forEach(xlp => {
        expect(xlp.isActive).toBe(true)
      })
    })

    it('should query XLP by address', async () => {
      if (!endpointAvailable) {
        console.log('⏭️  Skipping: GraphQL endpoint not available')
        return
      }
      // First get an existing XLP if any
      const xlps = await query<{ xlps: Array<{ id: string }> }>(`
        query {
          xlps(limit: 1) {
            id
          }
        }
      `)
      
      if (xlps.xlps.length > 0) {
        const result = await query<{ xlpById: { id: string, address: string, stakedAmount: string } | null }>(`
          query($id: String!) {
            xlpById(id: $id) {
              id
              address
              stakedAmount
            }
          }
        `, { id: xlps.xlps[0].id })
        
        expect(result.xlpById).toBeDefined()
      } else {
        // No XLPs exist yet, just verify the query works
        const result = await query<{ xlpById: { id: string } | null }>(`
          query($id: String!) {
            xlpById(id: $id) {
              id
            }
          }
        `, { id: '0x0000000000000000000000000000000000000000' })
        
        expect(result.xlpById).toBeNull()
      }
    })

    it('should query XLP liquidity deposits', async () => {
      if (!endpointAvailable) {
        console.log('⏭️  Skipping: GraphQL endpoint not available')
        return
      }
      const result = await query<{ xlpLiquidityDeposits: Array<{ id: string }> }>(`
        query {
          xlpLiquidityDeposits {
            id
            xlp {
              id
            }
            token
            chainId
            amount
            ethAmount
          }
        }
      `)
      
      expect(result.xlpLiquidityDeposits).toBeDefined()
      expect(Array.isArray(result.xlpLiquidityDeposits)).toBe(true)
    })
  })

  describe('Voucher Request Queries', () => {
    it('should query all voucher requests', async () => {
      if (!endpointAvailable) {
        console.log('⏭️  Skipping: GraphQL endpoint not available')
        return
      }
      const result = await query<{ crossChainVoucherRequests: Array<{ id: string }> }>(`
        query {
          crossChainVoucherRequests(orderBy: createdAt_DESC, limit: 10) {
            id
            requestId
            requester {
              id
            }
            sourceChain
            destinationChain
            amount
            status
            createdAt
          }
        }
      `)
      
      expect(result.crossChainVoucherRequests).toBeDefined()
      expect(Array.isArray(result.crossChainVoucherRequests)).toBe(true)
    })

    it('should filter requests by status', async () => {
      if (!endpointAvailable) {
        console.log('⏭️  Skipping: GraphQL endpoint not available')
        return
      }
      const result = await query<{ crossChainVoucherRequests: Array<{ status: string }> }>(`
        query {
          crossChainVoucherRequests(where: { status_eq: PENDING }) {
            id
            status
          }
        }
      `)
      
      expect(result.crossChainVoucherRequests).toBeDefined()
      result.crossChainVoucherRequests.forEach(req => {
        expect(req.status).toBe('PENDING')
      })
    })

    it('should filter requests by chain', async () => {
      if (!endpointAvailable) {
        console.log('⏭️  Skipping: GraphQL endpoint not available')
        return
      }
      const result = await query<{ crossChainVoucherRequests: Array<{ sourceChain: number }> }>(`
        query {
          crossChainVoucherRequests(where: { sourceChain_eq: 420691 }) {
            id
            sourceChain
          }
        }
      `)
      
      expect(result.crossChainVoucherRequests).toBeDefined()
      result.crossChainVoucherRequests.forEach(req => {
        expect(req.sourceChain).toBe(420691)
      })
    })
  })

  describe('Voucher Queries', () => {
    it('should query all vouchers', async () => {
      if (!endpointAvailable) {
        console.log('⏭️  Skipping: GraphQL endpoint not available')
        return
      }
      const result = await query<{ crossChainVouchers: Array<{ id: string }> }>(`
        query {
          crossChainVouchers(orderBy: issuedAt_DESC, limit: 10) {
            id
            voucherId
            xlp {
              id
              address
            }
            amount
            fee
            status
            fulfilled
            issuedAt
          }
        }
      `)
      
      expect(result.crossChainVouchers).toBeDefined()
      expect(Array.isArray(result.crossChainVouchers)).toBe(true)
    })

    it('should filter fulfilled vouchers', async () => {
      if (!endpointAvailable) {
        console.log('⏭️  Skipping: GraphQL endpoint not available')
        return
      }
      const result = await query<{ crossChainVouchers: Array<{ fulfilled: boolean }> }>(`
        query {
          crossChainVouchers(where: { fulfilled_eq: true }) {
            id
            fulfilled
          }
        }
      `)
      
      expect(result.crossChainVouchers).toBeDefined()
      result.crossChainVouchers.forEach(v => {
        expect(v.fulfilled).toBe(true)
      })
    })
  })

  describe('Transfer Queries', () => {
    it('should query all transfers', async () => {
      if (!endpointAvailable) {
        console.log('⏭️  Skipping: GraphQL endpoint not available')
        return
      }
      const result = await query<{ eilTransfers: Array<{ id: string }> }>(`
        query {
          eilTransfers(orderBy: initiatedAt_DESC, limit: 10) {
            id
            user {
              id
            }
            sourceChain
            destinationChain
            amount
            fee
            status
            initiatedAt
            completedAt
            sourceTxHash
            destinationTxHash
          }
        }
      `)
      
      expect(result.eilTransfers).toBeDefined()
      expect(Array.isArray(result.eilTransfers)).toBe(true)
    })

    it('should filter completed transfers', async () => {
      if (!endpointAvailable) {
        console.log('⏭️  Skipping: GraphQL endpoint not available')
        return
      }
      const result = await query<{ eilTransfers: Array<{ status: string }> }>(`
        query {
          eilTransfers(where: { status_eq: COMPLETED }) {
            id
            status
            completedAt
          }
        }
      `)
      
      expect(result.eilTransfers).toBeDefined()
      result.eilTransfers.forEach(t => {
        expect(t.status).toBe('COMPLETED')
      })
    })

    it('should filter by user address', async () => {
      if (!endpointAvailable) {
        console.log('⏭️  Skipping: GraphQL endpoint not available')
        return
      }
      const testUser = '0x0000000000000000000000000000000000000001'
      
      const result = await query<{ eilTransfers: Array<{ id: string }> }>(`
        query($userId: String!) {
          eilTransfers(where: { user: { id_eq: $userId } }) {
            id
            user {
              id
            }
          }
        }
      `, { userId: testUser })
      
      expect(result.eilTransfers).toBeDefined()
    })
  })

  describe('Stats Queries', () => {
    it('should query global EIL stats', async () => {
      if (!endpointAvailable) {
        console.log('⏭️  Skipping: GraphQL endpoint not available')
        return
      }
      const result = await query<{ eilStatsById: { id: string } | null }>(`
        query {
          eilStatsById(id: "global") {
            id
            totalVolumeUsd
            totalTransactions
            totalXLPs
            activeXLPs
            totalStakedEth
            averageFeePercent
            averageTimeSeconds
            successRate
            last24hVolume
            last24hTransactions
          }
        }
      `)
      
      // May or may not exist
      expect(result).toBeDefined()
    })

    it('should query chain stats', async () => {
      if (!endpointAvailable) {
        console.log('⏭️  Skipping: GraphQL endpoint not available')
        return
      }
      const result = await query<{ eilChainStats: Array<{ chainId: number }> }>(`
        query {
          eilChainStats {
            id
            chainId
            chainName
            paymasterAddress
            totalVolume
            totalTransfers
            activeXLPs
            totalLiquidity
          }
        }
      `)
      
      expect(result.eilChainStats).toBeDefined()
      expect(Array.isArray(result.eilChainStats)).toBe(true)
    })
  })

  describe('Slash Event Queries', () => {
    it('should query slash events', async () => {
      if (!endpointAvailable) {
        console.log('⏭️  Skipping: GraphQL endpoint not available')
        return
      }
      const result = await query<{ xlpSlashEvents: Array<{ id: string }> }>(`
        query {
          xlpSlashEvents(orderBy: timestamp_DESC, limit: 10) {
            id
            xlp {
              id
              address
            }
            voucherId
            chainId
            amount
            victim
            timestamp
            disputed
            txHash
          }
        }
      `)
      
      expect(result.xlpSlashEvents).toBeDefined()
      expect(Array.isArray(result.xlpSlashEvents)).toBe(true)
    })
  })

  describe('Aggregation Queries', () => {
    it('should get transfer count by status', async () => {
      if (!endpointAvailable) {
        console.log('⏭️  Skipping: GraphQL endpoint not available')
        return
      }
      const result = await query<{ 
        pending: { totalCount: number }
        completed: { totalCount: number }
        failed: { totalCount: number }
      }>(`
        query {
          pending: eilTransfersConnection(where: { status_eq: PENDING }, orderBy: initiatedAt_DESC) {
            totalCount
          }
          completed: eilTransfersConnection(where: { status_eq: COMPLETED }, orderBy: initiatedAt_DESC) {
            totalCount
          }
          failed: eilTransfersConnection(where: { status_eq: FAILED }, orderBy: initiatedAt_DESC) {
            totalCount
          }
        }
      `)
      
      expect(result.pending).toBeDefined()
      expect(typeof result.pending.totalCount).toBe('number')
    })

    it('should get XLP leaderboard by fees earned', async () => {
      if (!endpointAvailable) {
        console.log('⏭️  Skipping: GraphQL endpoint not available')
        return
      }
      const result = await query<{ xlps: Array<{ totalFeesEarned: string }> }>(`
        query {
          xlps(orderBy: totalFeesEarned_DESC, limit: 10) {
            id
            address
            totalFeesEarned
            totalVouchersFulfilled
            reputation
          }
        }
      `)
      
      expect(result.xlps).toBeDefined()
      // Verify sorted by fees
      for (let i = 1; i < result.xlps.length; i++) {
        const prev = BigInt(result.xlps[i-1].totalFeesEarned || '0')
        const curr = BigInt(result.xlps[i].totalFeesEarned || '0')
        expect(prev >= curr).toBe(true)
      }
    })
  })
})

