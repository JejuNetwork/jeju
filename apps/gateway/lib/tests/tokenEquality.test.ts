import {
  getAllTokens,
  getPaymasterTokens,
  getPreferredToken,
  getProtocolTokens,
  getTokenByAddress,
  getTokenBySymbol,
  hasBanEnforcement,
} from '../tokens'

describe('Token Equality and Completeness', () => {
  const protocolTokens = getProtocolTokens()
  const allTokens = getAllTokens()

  describe('JEJU Token (Native)', () => {
    it('should be included in protocol tokens', () => {
      const jeju = getTokenBySymbol('JEJU')
      expect(jeju).toBeDefined()
      expect(jeju?.symbol).toBe('JEJU')
    })

    it('should be marked as native (not bridged)', () => {
      const jeju = protocolTokens.find((t) => t.symbol === 'JEJU')
      expect(jeju?.bridged).toBe(false)
      expect(jeju?.originChain).toBe('jeju')
    })

    it('should be marked as preferred', () => {
      const jeju = protocolTokens.find((t) => t.symbol === 'JEJU')
      expect(jeju?.isPreferred).toBe(true)
    })

    it('should have ban enforcement enabled', () => {
      const jeju = protocolTokens.find((t) => t.symbol === 'JEJU')
      expect(jeju?.hasBanEnforcement).toBe(true)
      expect(hasBanEnforcement('JEJU')).toBe(true)
    })

    it('should be returned by getPreferredToken', () => {
      const preferred = getPreferredToken()
      expect(preferred).toBeDefined()
      expect(preferred?.symbol).toBe('JEJU')
    })

    it('should appear FIRST in paymaster tokens', () => {
      const paymasterTokens = getPaymasterTokens()
      expect(paymasterTokens[0].symbol).toBe('JEJU')
    })

    it('should appear FIRST in protocol tokens list', () => {
      expect(protocolTokens[0].symbol).toBe('JEJU')
    })

    it('should have paymaster deployed', () => {
      const jeju = protocolTokens.find((t) => t.symbol === 'JEJU')
      expect(jeju?.hasPaymaster).toBe(true)
    })

    it('should have complete configuration', () => {
      const jeju = protocolTokens.find((t) => t.symbol === 'JEJU')
      expect(jeju?.name).toBe('Network')
      expect(jeju?.decimals).toBe(18)
      expect(jeju?.priceUSD).toBe(0.05)
      expect(jeju?.logoUrl).toBeDefined()
    })

    it('should NOT appear in bridgeable tokens', () => {
      const bridgeable = protocolTokens.filter((t) => t.bridged)
      const hasJeju = bridgeable.some((t) => t.symbol === 'JEJU')
      expect(hasJeju).toBe(false)
    })
  })

  describe('Token Equality', () => {
    it('should have exactly 1 protocol token', () => {
      expect(protocolTokens.length).toBe(1)
    })

    it('should include JEJU token', () => {
      const symbols = protocolTokens.map((t) => t.symbol).sort()
      expect(symbols).toEqual(['JEJU'])
    })

    it('should treat all tokens with equal structure', () => {
      protocolTokens.forEach((token) => {
        expect(token.symbol).toBeDefined()
        expect(token.name).toBeDefined()
        expect(token.address).toBeDefined()
        expect(token.decimals).toBe(18)
        expect(token.priceUSD).toBeGreaterThan(0)
        expect(token.hasPaymaster).toBe(true)
        expect(token.logoUrl).toBeDefined()
      })
    })

    it('should have 1 native token (JEJU) and 0 bridged tokens', () => {
      const native = protocolTokens.filter((t) => !t.bridged)
      const bridged = protocolTokens.filter((t) => t.bridged)

      expect(native.length).toBe(1)
      expect(bridged.length).toBe(0)
      expect(native[0].symbol).toBe('JEJU')
    })

    it('should have exactly 1 preferred token (JEJU)', () => {
      const preferred = protocolTokens.filter((t) => t.isPreferred)
      expect(preferred.length).toBe(1)
      expect(preferred[0].symbol).toBe('JEJU')
    })

    it('should be retrievable by symbol (case-insensitive)', () => {
      expect(getTokenBySymbol('JEJU')).toBeDefined()
      expect(getTokenBySymbol('jeju')).toBeDefined()
    })

    it('should be retrievable by address (case-insensitive)', () => {
      protocolTokens.forEach((token) => {
        const found = getTokenByAddress(token.address)
        expect(found).toBeDefined()
        expect(found?.symbol).toBe(token.symbol)

        // Test uppercase
        const foundUpper = getTokenByAddress(token.address.toUpperCase())
        expect(foundUpper).toBeDefined()
      })
    })
  })

  describe('Complete Token Coverage', () => {
    const requiredTokens = ['JEJU']

    requiredTokens.forEach((symbol) => {
      it(`should have ${symbol} in all token lists`, () => {
        // In protocol tokens
        const inProtocol = protocolTokens.find((t) => t.symbol === symbol)
        expect(inProtocol).toBeDefined()

        // In all tokens
        const inAll = allTokens.find((t) => t.symbol === symbol)
        expect(inAll).toBeDefined()

        // Retrievable by symbol
        const bySymbol = getTokenBySymbol(symbol)
        expect(bySymbol).toBeDefined()

        // Retrievable by address
        if (inProtocol?.address) {
          const byAddress = getTokenByAddress(inProtocol.address)
          expect(byAddress).toBeDefined()
        }
      })
    })
  })
})
