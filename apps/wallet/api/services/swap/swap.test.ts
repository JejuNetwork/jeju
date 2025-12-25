/**
 * Swap Service Tests
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { Address } from 'viem'

// Mock fetch globally
const mockFetch = mock(() =>
  Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        quote: {
          inputAmount: '1000000000000000000',
          outputAmount: '990000000000000000',
          priceImpact: 0.01,
          route: [{ protocol: 'jeju-dex', poolFee: 3000 }],
        },
        tx: {
          to: '0xrouter0000000000000000000000000000000001',
          data: '0x123456',
          value: '1000000000000000000',
        },
      }),
  }),
)

globalThis.fetch = mockFetch as typeof fetch

// Now import the service after mocking
const { SwapService } = await import('./index')

describe('SwapService', () => {
  let swap: ReturnType<(typeof SwapService)['prototype']['constructor']>

  beforeEach(() => {
    swap = new SwapService()
    mockFetch.mockClear()
  })

  describe('getQuote', () => {
    it('should get quote from solver', async () => {
      const quote = await swap.getQuote({
        inputToken: '0xweth0000000000000000000000000000000000' as Address,
        outputToken: '0xusdc0000000000000000000000000000000000' as Address,
        inputAmount: 1000000000000000000n,
        slippageBps: 50,
      })

      expect(quote.inputAmount).toBe(1000000000000000000n)
      expect(quote.outputAmount).toBe(990000000000000000n)
      expect(quote.priceImpact).toBe(0.01)
    })

    it('should handle quote errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'No route found' }),
      })

      await expect(
        swap.getQuote({
          inputToken: '0x0000000000000000000000000000000000000001' as Address,
          outputToken: '0x0000000000000000000000000000000000000002' as Address,
          inputAmount: 1000000000000000000n,
          slippageBps: 50,
        }),
      ).rejects.toThrow()
    })
  })

  describe('buildSwapTx', () => {
    it('should build swap transaction', async () => {
      const tx = await swap.buildSwapTx({
        inputToken: '0xweth0000000000000000000000000000000000' as Address,
        outputToken: '0xusdc0000000000000000000000000000000000' as Address,
        inputAmount: 1000000000000000000n,
        minOutputAmount: 980000000000000000n,
        recipient: '0x1234567890123456789012345678901234567890' as Address,
      })

      expect(tx.to).toBe('0xrouter0000000000000000000000000000000001')
      expect(tx.data).toBe('0x123456')
      expect(tx.value).toBe(1000000000000000000n)
    })
  })

  describe('slippage settings', () => {
    it('should get and set default slippage', () => {
      expect(swap.getDefaultSlippage()).toBe(50) // 0.5%

      swap.setDefaultSlippage(100) // 1%
      expect(swap.getDefaultSlippage()).toBe(100)
    })
  })

  describe('recent tokens', () => {
    it('should track recent tokens', () => {
      const token = '0xtoken00000000000000000000000000000001' as Address

      swap.addRecentToken(token)
      expect(swap.getRecentTokens()).toContain(token)
    })

    it('should limit recent tokens', () => {
      for (let i = 0; i < 15; i++) {
        swap.addRecentToken(`0x${i.toString().padStart(40, '0')}` as Address)
      }

      expect(swap.getRecentTokens().length).toBeLessThanOrEqual(10)
    })
  })
})
