/**
 * Jeju Network Infrastructure Service Tests
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { Address } from 'viem'

// Mock fetch for GraphQL and API calls
const mockFetch = mock(() =>
  Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        data: {
          transactions: [
            {
              hash: '0xtx1',
              from: { address: '0x1234567890123456789012345678901234567890' },
              to: { address: '0xabcdef0123456789abcdef0123456789abcdef01' },
              value: '1000000000000000000',
              blockNumber: 12345678,
              status: 'SUCCESS',
              gasUsed: '21000',
              input: '0x',
            },
          ],
        },
      }),
  }),
)

globalThis.fetch = mockFetch as typeof fetch

// Now import the functions
const jeju = await import('./index')

describe('Jeju Network Service', () => {
  beforeEach(() => {
    mockFetch.mockClear()
  })

  describe('getAccountHistory', () => {
    it('should fetch transaction history', async () => {
      const history = await jeju.getAccountHistory(
        '0x1234567890123456789012345678901234567890' as Address,
      )

      expect(history).toBeDefined()
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should map transaction data correctly', async () => {
      const history = await jeju.getAccountHistory(
        '0x1234567890123456789012345678901234567890' as Address,
      )

      expect(history[0].hash).toBe('0xtx1')
      expect(history[0].status).toBe('SUCCESS')
    })
  })

  describe('getTokenTransfers', () => {
    it('should fetch token transfers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              tokenTransfers: [
                {
                  token: '0xtoken',
                  tokenSymbol: 'TKN',
                  from: '0xfrom',
                  to: '0xto',
                  value: '1000000',
                  txHash: '0xtx1',
                  timestamp: '2024-01-01T00:00:00Z',
                },
              ],
            },
          }),
      })

      const transfers = await jeju.getTokenTransfers(
        '0x1234567890123456789012345678901234567890' as Address,
      )

      expect(transfers).toBeDefined()
      expect(transfers.length).toBeGreaterThan(0)
    })
  })

  describe('getTokenBalances', () => {
    it('should fetch token balances', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              tokenBalances: [
                {
                  token: '0xtoken',
                  symbol: 'TKN',
                  decimals: 18,
                  balance: '1000000000000000000',
                },
              ],
            },
          }),
      })

      const balances = await jeju.getTokenBalances(
        '0x1234567890123456789012345678901234567890' as Address,
      )

      expect(balances).toBeDefined()
      expect(balances[0].symbol).toBe('TKN')
    })
  })

  describe('getNFTs', () => {
    it('should fetch NFTs for owner', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              nftTokens: [
                {
                  contractAddress: '0xnft',
                  tokenId: '1',
                  chainId: 1,
                  owner: '0x1234',
                  tokenUri: 'ipfs://Qm123',
                  collectionName: 'Test Collection',
                  metadata: {
                    name: 'NFT #1',
                    description: 'Test NFT',
                    image: 'ipfs://Qmimage',
                  },
                },
              ],
            },
          }),
      })

      const nfts = await jeju.getNFTs(
        '0x1234567890123456789012345678901234567890' as Address,
      )

      expect(nfts).toBeDefined()
      expect(nfts[0].tokenId).toBe('1')
      expect(nfts[0].chainId).toBe(1)
    })
  })

  describe('getApprovals', () => {
    it('should fetch approval events', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              approvalEvents: [
                {
                  token: '0xtoken',
                  tokenSymbol: 'TKN',
                  spender: '0xspender',
                  value:
                    '115792089237316195423570985008687907853269984665640564039457584007913129639935',
                  txHash: '0xtx1',
                  timestamp: '2024-01-01T00:00:00Z',
                },
              ],
            },
          }),
      })

      const approvals = await jeju.getApprovals(
        '0x1234567890123456789012345678901234567890' as Address,
      )

      expect(approvals).toBeDefined()
      expect(approvals[0].tokenSymbol).toBe('TKN')
    })
  })

  describe('getOraclePrices', () => {
    it('should fetch oracle prices', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              oracleFeeds: [
                {
                  symbol: 'ETH',
                  latestPrice: '200000000000',
                  decimals: 8,
                  latestTimestamp: '2024-01-01T00:00:00Z',
                  latestConfidence: '99',
                },
              ],
            },
          }),
      })

      const prices = await jeju.getOraclePrices(['ETH'])

      expect(prices.has('ETH')).toBe(true)
      expect(prices.get('ETH')?.price).toBe('200000000000')
    })
  })

  describe('getGasPrice', () => {
    it('should fetch gas prices', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              oracleFeeds: [{ latestPrice: '20000000000' }],
            },
          }),
      })

      const gas = await jeju.getGasPrice()

      expect(gas.slow).toBeDefined()
      expect(gas.standard).toBeDefined()
      expect(gas.fast).toBeDefined()
    })

    it('should calculate gas tiers correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              oracleFeeds: [{ latestPrice: '100' }],
            },
          }),
      })

      const gas = await jeju.getGasPrice()

      expect(gas.slow).toBe(80n) // 80%
      expect(gas.standard).toBe(100n) // 100%
      expect(gas.fast).toBe(120n) // 120%
    })
  })

  describe('getIntents', () => {
    it('should fetch OIF intents', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              oifIntents: [
                {
                  id: 'intent-1',
                  user: '0x1234',
                  inputToken: '0xweth',
                  inputAmount: '1000000000000000000',
                  outputToken: '0xusdc',
                  minOutputAmount: '2000000000',
                  sourceChainId: 1,
                  destinationChainId: 42161,
                  status: 'FILLED',
                  solver: '0xsolver',
                  createdAt: '2024-01-01T00:00:00Z',
                },
              ],
            },
          }),
      })

      const intents = await jeju.getIntents(
        '0x1234567890123456789012345678901234567890' as Address,
      )

      expect(intents).toBeDefined()
      expect(intents[0].status).toBe('FILLED')
    })
  })

  describe('getSolvers', () => {
    it('should fetch active solvers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              oifSolvers: [
                {
                  address: '0xsolver1',
                  reputation: 95,
                  supportedChains: [1, 42161, 8453],
                  totalFills: 1000,
                },
              ],
            },
          }),
      })

      const solvers = await jeju.getSolvers()

      expect(solvers).toBeDefined()
      expect(solvers[0].reputation).toBe(95)
    })
  })

  describe('sendUserOperation', () => {
    it('should send user operation to bundler', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            jsonrpc: '2.0',
            id: 1,
            result: '0xuserophash',
          }),
      })

      const hash = await jeju.sendUserOperation(
        1,
        { sender: '0x1234', nonce: '0x0' },
        '0xentrypoint' as Address,
      )

      expect(hash).toBe('0xuserophash')
    })
  })

  describe('estimateUserOperationGas', () => {
    it('should estimate gas for user operation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            jsonrpc: '2.0',
            id: 1,
            result: {
              callGasLimit: '0x10000',
              verificationGasLimit: '0x20000',
              preVerificationGas: '0x5000',
            },
          }),
      })

      const gas = await jeju.estimateUserOperationGas(
        1,
        { sender: '0x1234' },
        '0xentrypoint' as Address,
      )

      expect(gas.callGasLimit).toBe(65536n)
      expect(gas.verificationGasLimit).toBe(131072n)
    })
  })

  describe('getIndexerHealth', () => {
    it('should check indexer health', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ status: 'healthy' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ blocks: [{ number: 12345678 }] }),
        })

      const health = await jeju.getIndexerHealth()

      expect(health.status).toBe('healthy')
      expect(health.latestBlock).toBe(12345678)
    })
  })
})
