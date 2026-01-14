import { describe, expect, test } from 'bun:test'
import { extractEntities, selectAction } from '../../api/eliza/runtime'

describe('selectAction', () => {
  describe('swap detection', () => {
    test('detects "swap" keyword', () => {
      const result = selectAction('swap 1 ETH to USDC')
      expect(result).not.toBeNull()
      expect(result?.name).toBe('SWAP')
    })

    test('detects "trade" keyword', () => {
      const result = selectAction('trade my ETH for USDC')
      expect(result).not.toBeNull()
      expect(result?.name).toBe('SWAP')
    })

    test('is case insensitive for swap', () => {
      expect(selectAction('SWAP 1 ETH')?.name).toBe('SWAP')
      expect(selectAction('Swap tokens')?.name).toBe('SWAP')
      expect(selectAction('sWaP please')?.name).toBe('SWAP')
    })
  })

  describe('bridge detection', () => {
    test('detects "bridge" keyword', () => {
      const result = selectAction('bridge 1 ETH from ethereum to base')
      expect(result).not.toBeNull()
      expect(result?.name).toBe('BRIDGE')
    })

    test('is case insensitive for bridge', () => {
      expect(selectAction('BRIDGE tokens')?.name).toBe('BRIDGE')
      expect(selectAction('Bridge ETH')?.name).toBe('BRIDGE')
    })
  })

  describe('balance detection', () => {
    test('detects "balance" keyword', () => {
      const result = selectAction('check my balance')
      expect(result).not.toBeNull()
      expect(result?.name).toBe('BALANCE')
    })

    test('detects balance in various phrases', () => {
      expect(selectAction('what is my balance')?.name).toBe('BALANCE')
      expect(selectAction('show balance')?.name).toBe('BALANCE')
      expect(selectAction('my token balance')?.name).toBe('BALANCE')
    })
  })

  describe('price detection', () => {
    test('detects "price" keyword', () => {
      const result = selectAction('what is the price of ETH')
      expect(result).not.toBeNull()
      expect(result?.name).toBe('PRICE')
    })

    test('detects price in various phrases', () => {
      expect(selectAction('ETH price')?.name).toBe('PRICE')
      expect(selectAction('price check')?.name).toBe('PRICE')
      expect(selectAction('show me the price')?.name).toBe('PRICE')
    })
  })

  describe('connect detection', () => {
    test('detects "connect" keyword', () => {
      const result = selectAction('connect my wallet')
      expect(result).not.toBeNull()
      expect(result?.name).toBe('CONNECT')
    })

    test('detects connect in various phrases', () => {
      expect(selectAction('I want to connect')?.name).toBe('CONNECT')
      expect(selectAction('connect wallet please')?.name).toBe('CONNECT')
    })
  })

  describe('help detection', () => {
    test('detects "help" keyword', () => {
      const result = selectAction('help me')
      expect(result).not.toBeNull()
      expect(result?.name).toBe('HELP')
    })

    test('detects standalone help', () => {
      expect(selectAction('help')?.name).toBe('HELP')
    })
  })

  describe('confirm/cancel detection', () => {
    test('detects "confirm" as exact match', () => {
      expect(selectAction('confirm')?.name).toBe('CONFIRM')
    })

    test('detects "yes" as exact match', () => {
      expect(selectAction('yes')?.name).toBe('CONFIRM')
    })

    test('detects "cancel" as exact match', () => {
      expect(selectAction('cancel')?.name).toBe('CANCEL')
    })

    test('detects "no" as exact match', () => {
      expect(selectAction('no')?.name).toBe('CANCEL')
    })
  })

  describe('no match', () => {
    test('returns null for unrecognized text', () => {
      expect(selectAction('hello there')).toBeNull()
      expect(selectAction('how are you')).toBeNull()
      expect(selectAction('weather today')).toBeNull()
    })

    test('returns null for empty string', () => {
      expect(selectAction('')).toBeNull()
    })
  })
})

describe('extractEntities', () => {
  describe('swap entity extraction', () => {
    test('extracts amount, fromToken, toToken from swap command', () => {
      const result = extractEntities('swap 1 ETH to USDC')
      expect(result.amount).toBe('1')
      expect(result.fromToken).toBe('ETH')
      expect(result.toToken).toBe('USDC')
    })

    test('extracts entities with "for" keyword', () => {
      const result = extractEntities('swap 100 USDC for ETH')
      expect(result.amount).toBe('100')
      expect(result.fromToken).toBe('USDC')
      expect(result.toToken).toBe('ETH')
    })

    test('extracts decimal amounts', () => {
      const result = extractEntities('swap 0.5 ETH to USDC')
      expect(result.amount).toBe('0.5')
    })

    test('normalizes tokens to uppercase', () => {
      const result = extractEntities('swap 1 eth to usdc')
      expect(result.fromToken).toBe('ETH')
      expect(result.toToken).toBe('USDC')
    })
  })

  describe('bridge entity extraction', () => {
    test('extracts amount, token, chains from bridge command', () => {
      const result = extractEntities('bridge 1 ETH from ethereum to base')
      expect(result.amount).toBe('1')
      expect(result.token).toBe('ETH')
      expect(result.fromChain).toBe('ethereum')
      expect(result.toChain).toBe('base')
    })

    test('extracts decimal amounts in bridge', () => {
      const result = extractEntities('bridge 0.25 ETH from base to optimism')
      expect(result.amount).toBe('0.25')
      expect(result.token).toBe('ETH')
    })

    test('normalizes chains to lowercase', () => {
      const result = extractEntities('bridge 1 ETH from Ethereum to Base')
      expect(result.fromChain).toBe('ethereum')
      expect(result.toChain).toBe('base')
    })
  })

  describe('edge cases', () => {
    test('returns empty object for text without entities', () => {
      const result = extractEntities('hello world')
      expect(Object.keys(result).length).toBe(0)
    })

    test('returns empty object for empty string', () => {
      const result = extractEntities('')
      expect(Object.keys(result).length).toBe(0)
    })

    test('handles multiple decimal points in amount', () => {
      const result = extractEntities('swap 1.5 ETH to USDC')
      expect(result.amount).toBe('1.5')
    })

    test('handles large amounts', () => {
      const result = extractEntities('swap 1000000 USDC to ETH')
      expect(result.amount).toBe('1000000')
    })
  })

  describe('combined patterns', () => {
    test('swap pattern takes precedence', () => {
      // If both patterns match (unlikely), swap is checked first
      const result = extractEntities('swap 1 ETH to USDC')
      expect(result.fromToken).toBe('ETH')
      expect(result.toToken).toBe('USDC')
    })

    test('bridge pattern captures from/to chains', () => {
      const result = extractEntities('bridge 5 USDC from arbitrum to jeju')
      expect(result.token).toBe('USDC')
      expect(result.fromChain).toBe('arbitrum')
      expect(result.toChain).toBe('jeju')
    })
  })
})
