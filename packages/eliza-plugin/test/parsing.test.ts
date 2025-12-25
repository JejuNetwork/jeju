/**
 * Unit tests for action parsing functions
 *
 * Tests the text parsing logic used by DeFi, cross-chain, and launchpad actions
 * Includes inline implementations of parsing functions to avoid SDK dependency.
 */

import { describe, expect, test } from 'bun:test'
import { formatEther, parseEther } from 'viem'

/** Test helper for passing invalid inputs to parseSwapParams */
function parseSwapParamsRaw(value: unknown) {
  return parseSwapParams(value as string)
}

/** Test helper for passing invalid inputs to parseTransferParams */
function parseTransferParamsRaw(value: unknown) {
  return parseTransferParams(value as string)
}

// =============================================================================
// Inline Parsing Functions (copied from source to avoid SDK dependency)
// These should be kept in sync with the actual implementations
// =============================================================================

type SupportedChain = 'jeju' | 'base' | 'optimism' | 'arbitrum' | 'ethereum'

/**
 * Parse swap parameters from natural language text
 * Copied from src/actions/defi.ts
 */
function parseSwapParams(text: string): {
  amountIn?: bigint
  tokenIn?: string
  tokenOut?: string
} {
  const params: { amountIn?: bigint; tokenIn?: string; tokenOut?: string } = {}

  // Extract amount
  const amountMatch = text.match(/(\d+(?:\.\d+)?)\s*(eth|jeju|usdc|usdt)?/i)
  if (amountMatch) {
    params.amountIn = parseEther(amountMatch[1])
    if (amountMatch[2]) params.tokenIn = amountMatch[2].toUpperCase()
  }

  // Extract token pair
  const pairMatch = text.match(/(\w+)\s+(?:for|to|into)\s+(\w+)/i)
  if (pairMatch) {
    if (!params.tokenIn) params.tokenIn = pairMatch[1].toUpperCase()
    params.tokenOut = pairMatch[2].toUpperCase()
  }

  return params
}

/**
 * Parse cross-chain transfer parameters from natural language text
 * Copied from src/actions/crosschain.ts
 */
function parseTransferParams(text: string): {
  amount?: bigint
  from?: SupportedChain
  to?: SupportedChain
  token?: string
} {
  const params: {
    amount?: bigint
    from?: SupportedChain
    to?: SupportedChain
    token?: string
  } = {}

  // Extract amount
  const amountMatch = text.match(/(\d+(?:\.\d+)?)\s*(eth|usdc|jeju)?/i)
  if (amountMatch) {
    params.amount = parseEther(amountMatch[1])
    if (amountMatch[2]) params.token = amountMatch[2].toUpperCase()
  }

  // Extract chains
  const chains: SupportedChain[] = [
    'jeju',
    'base',
    'optimism',
    'arbitrum',
    'ethereum',
  ]
  for (const chain of chains) {
    if (text.toLowerCase().includes(`from ${chain}`)) params.from = chain
    if (text.toLowerCase().includes(`to ${chain}`)) params.to = chain
  }

  // Default from chain to jeju
  if (!params.from && params.to) params.from = 'jeju'

  return params
}

// =============================================================================
// parseSwapParams Tests
// =============================================================================

describe('parseSwapParams', () => {
  describe('amount extraction', () => {
    test('parses integer amount', () => {
      const result = parseSwapParams('swap 100 ETH for USDC')
      expect(result.amountIn).toBe(parseEther('100'))
    })

    test('parses decimal amount', () => {
      const result = parseSwapParams('swap 1.5 ETH for USDC')
      expect(result.amountIn).toBe(parseEther('1.5'))
    })

    test('parses small decimal amount', () => {
      const result = parseSwapParams('swap 0.001 ETH for USDC')
      expect(result.amountIn).toBe(parseEther('0.001'))
    })

    test('parses amount without token symbol', () => {
      const result = parseSwapParams('swap 50 for something')
      expect(result.amountIn).toBe(parseEther('50'))
    })

    test('returns undefined for no amount', () => {
      const result = parseSwapParams('swap ETH for USDC')
      expect(result.amountIn).toBeUndefined()
    })
  })

  describe('token extraction', () => {
    test('extracts token from amount (lowercase)', () => {
      const result = parseSwapParams('swap 100 eth for usdc')
      expect(result.tokenIn).toBe('ETH')
    })

    test('extracts token from amount (uppercase)', () => {
      const result = parseSwapParams('swap 100 JEJU for USDC')
      expect(result.tokenIn).toBe('JEJU')
    })

    test("extracts token pair with 'for'", () => {
      const result = parseSwapParams('100 ETH for USDC')
      expect(result.tokenIn).toBe('ETH')
      expect(result.tokenOut).toBe('USDC')
    })

    test("extracts token pair with 'to'", () => {
      const result = parseSwapParams('100 ETH to USDC')
      expect(result.tokenIn).toBe('ETH')
      expect(result.tokenOut).toBe('USDC')
    })

    test("extracts token pair with 'into'", () => {
      const result = parseSwapParams('convert 100 ETH into USDC')
      expect(result.tokenIn).toBe('ETH')
      expect(result.tokenOut).toBe('USDC')
    })

    test('handles mixed case tokens', () => {
      const result = parseSwapParams('swap 10 Eth for Usdc')
      expect(result.tokenIn).toBe('ETH')
      expect(result.tokenOut).toBe('USDC')
    })
  })

  describe('complex inputs', () => {
    // Note: The pairMatch regex matches the first "word for/to/into word" pattern
    // which may capture unintended words like "want to swap" before the actual tokens.
    // The tokenIn from amountMatch takes precedence if found.

    test('parses natural language - tokenIn from amount takes precedence', () => {
      const result = parseSwapParams(
        'I want to swap 50 USDC for JEJU tokens please',
      )
      expect(result.amountIn).toBe(parseEther('50'))
      // tokenIn comes from the amount regex matching "50 USDC"
      expect(result.tokenIn).toBe('USDC')
      // tokenOut comes from pairMatch which matches "want to swap" (first "to" pattern)
      expect(result.tokenOut).toBe('SWAP')
    })

    test('parses simple swap without natural language', () => {
      const result = parseSwapParams('50 USDC for JEJU')
      expect(result.amountIn).toBe(parseEther('50'))
      expect(result.tokenIn).toBe('USDC')
      expect(result.tokenOut).toBe('JEJU')
    })

    test('parses direct token pair request', () => {
      // More reliable format without "to" in preamble
      const result = parseSwapParams('swap 50 USDC for JEJU')
      expect(result.amountIn).toBe(parseEther('50'))
      expect(result.tokenIn).toBe('USDC')
      expect(result.tokenOut).toBe('JEJU')
    })

    test('parses exchange request', () => {
      // "exchange 1 ETH to WETH" - pairMatch finds "exchange 1" then "ETH to WETH"
      // But it actually matches "ETH to WETH" because that's the last valid pattern
      const result = parseSwapParams('exchange 1 ETH to WETH')
      expect(result.amountIn).toBe(parseEther('1'))
      expect(result.tokenIn).toBe('ETH')
      expect(result.tokenOut).toBe('WETH')
    })

    test('handles extra whitespace', () => {
      const result = parseSwapParams('  swap   100   eth   for   usdc  ')
      expect(result.amountIn).toBe(parseEther('100'))
      expect(result.tokenIn).toBe('ETH')
      expect(result.tokenOut).toBe('USDC')
    })
  })

  describe('edge cases', () => {
    test('handles empty string', () => {
      const result = parseSwapParams('')
      expect(result.amountIn).toBeUndefined()
      expect(result.tokenIn).toBeUndefined()
      expect(result.tokenOut).toBeUndefined()
    })

    test('handles only numbers', () => {
      const result = parseSwapParams('100')
      expect(result.amountIn).toBe(parseEther('100'))
    })

    test('handles very large numbers', () => {
      const result = parseSwapParams('swap 1000000000 ETH for USDC')
      expect(result.amountIn).toBe(parseEther('1000000000'))
    })

    test('handles very small decimals', () => {
      const result = parseSwapParams('swap 0.000000001 ETH for USDC')
      expect(result.amountIn).toBe(parseEther('0.000000001'))
    })

    test('only tokenOut without tokenIn from amount', () => {
      const result = parseSwapParams('get USDC for JEJU')
      expect(result.tokenIn).toBe('USDC')
      expect(result.tokenOut).toBe('JEJU')
    })
  })

  describe('token symbols', () => {
    test('handles various token symbols', () => {
      const tokens = ['ETH', 'USDC', 'USDT', 'JEJU', 'WETH', 'DAI', 'WBTC']
      for (const token of tokens) {
        const result = parseSwapParams(`swap 1 ${token} for USDC`)
        expect(result.tokenIn).toBe(token)
      }
    })

    test('partial match - USDC from USDC2', () => {
      // The amount regex matches tokens without word boundary
      // So "100 USDC2" matches "100 USDC" (the "2" is ignored)
      const result = parseSwapParams('100 USDC2 for ETH')
      expect(result.amountIn).toBe(parseEther('100'))
      expect(result.tokenIn).toBe('USDC') // Partial match
      expect(result.tokenOut).toBe('ETH')
    })

    test('whitelisted token captured from amount', () => {
      // USDC is in the whitelist so it's captured
      const result = parseSwapParams('swap 100 USDC for ETH')
      expect(result.tokenIn).toBe('USDC')
    })

    test('completely unknown token uses pair match', () => {
      // WBTC is not in the whitelist, so pair match is used
      const result = parseSwapParams('100 WBTC for USDC')
      expect(result.amountIn).toBe(parseEther('100'))
      expect(result.tokenIn).toBe('WBTC') // From pair match
      expect(result.tokenOut).toBe('USDC')
    })
  })
})

// =============================================================================
// parseTransferParams Tests
// =============================================================================

describe('parseTransferParams', () => {
  describe('amount extraction', () => {
    test('parses integer amount', () => {
      const result = parseTransferParams('bridge 10 ETH from jeju to base')
      expect(result.amount).toBe(parseEther('10'))
    })

    test('parses decimal amount', () => {
      const result = parseTransferParams('bridge 0.5 ETH from jeju to base')
      expect(result.amount).toBe(parseEther('0.5'))
    })

    test('parses amount with token', () => {
      const result = parseTransferParams('transfer 100 USDC from jeju to base')
      expect(result.amount).toBe(parseEther('100'))
      expect(result.token).toBe('USDC')
    })
  })

  describe('chain extraction', () => {
    test('extracts from chain', () => {
      const result = parseTransferParams('bridge 1 ETH from jeju to base')
      expect(result.from).toBe('jeju')
    })

    test('extracts to chain', () => {
      const result = parseTransferParams('bridge 1 ETH from jeju to base')
      expect(result.to).toBe('base')
    })

    test('handles case insensitive chains', () => {
      const result = parseTransferParams('bridge 1 ETH from JEJU to BASE')
      expect(result.from).toBe('jeju')
      expect(result.to).toBe('base')
    })

    test('extracts all supported chains', () => {
      const chains = ['jeju', 'base', 'optimism', 'arbitrum', 'ethereum']
      for (const chain of chains) {
        const result = parseTransferParams(`bridge 1 ETH from ${chain} to jeju`)
        expect(result.from).toBe(chain)
      }
    })

    test('handles to chain without from', () => {
      const result = parseTransferParams('bridge 1 ETH to base')
      expect(result.from).toBe('jeju') // defaults to jeju
      expect(result.to).toBe('base')
    })
  })

  describe('token extraction', () => {
    test('extracts ETH token', () => {
      const result = parseTransferParams('bridge 1 eth from jeju to base')
      expect(result.token).toBe('ETH')
    })

    test('extracts USDC token', () => {
      const result = parseTransferParams('bridge 100 usdc from jeju to base')
      expect(result.token).toBe('USDC')
    })

    test('extracts JEJU token', () => {
      const result = parseTransferParams('bridge 50 jeju from base to ethereum')
      expect(result.token).toBe('JEJU')
      expect(result.from).toBe('base')
    })
  })

  describe('complex inputs', () => {
    test('parses natural language bridge request', () => {
      const result = parseTransferParams(
        'I want to bridge 5 ETH from jeju to optimism please',
      )
      expect(result.amount).toBe(parseEther('5'))
      expect(result.from).toBe('jeju')
      expect(result.to).toBe('optimism')
    })

    test('parses send request', () => {
      const result = parseTransferParams('send 1 ETH from jeju to arbitrum')
      expect(result.amount).toBe(parseEther('1'))
      expect(result.from).toBe('jeju')
      expect(result.to).toBe('arbitrum')
    })

    test('handles destination only', () => {
      const result = parseTransferParams('send 0.5 ETH to arbitrum')
      expect(result.amount).toBe(parseEther('0.5'))
      expect(result.from).toBe('jeju') // defaults
      expect(result.to).toBe('arbitrum')
    })
  })

  describe('edge cases', () => {
    test('handles empty string', () => {
      const result = parseTransferParams('')
      expect(result.amount).toBeUndefined()
      expect(result.from).toBeUndefined()
      expect(result.to).toBeUndefined()
    })

    test('handles no chains specified', () => {
      const result = parseTransferParams('bridge 1 ETH')
      expect(result.amount).toBe(parseEther('1'))
      expect(result.from).toBeUndefined()
      expect(result.to).toBeUndefined()
    })

    test('handles unsupported source chain - defaults to jeju', () => {
      // "polygon" is not a supported chain, so from is not set by the loop
      // But since to is set (base), from defaults to jeju
      const result = parseTransferParams('bridge 1 ETH from polygon to base')
      expect(result.from).toBe('jeju') // defaults when to is set
      expect(result.to).toBe('base')
    })

    test('unsupported chain without destination', () => {
      // Neither from nor to get set for unsupported chains
      const result = parseTransferParams('bridge 1 ETH from polygon')
      expect(result.from).toBeUndefined()
      expect(result.to).toBeUndefined()
    })

    test('handles very large amounts', () => {
      const result = parseTransferParams('bridge 1000000 ETH from jeju to base')
      expect(result.amount).toBe(parseEther('1000000'))
    })

    test('handles very small decimals', () => {
      const result = parseTransferParams(
        'bridge 0.000001 ETH from jeju to base',
      )
      expect(result.amount).toBe(parseEther('0.000001'))
    })
  })

  describe('chain priority', () => {
    test('correctly identifies from vs to when both present', () => {
      const result = parseTransferParams(
        'transfer from arbitrum to ethereum 1 ETH',
      )
      expect(result.from).toBe('arbitrum')
      expect(result.to).toBe('ethereum')
    })

    test('handles same chain mentioned twice', () => {
      const result = parseTransferParams('from base to base 1 ETH')
      expect(result.from).toBe('base')
      expect(result.to).toBe('base')
    })
  })
})

// =============================================================================
// Launchpad Text Parsing Tests (using regex patterns from actions)
// =============================================================================

describe('Launchpad parsing patterns', () => {
  // Token creation patterns
  const namePattern = /name[:\s]+["']?([^"',]+)["']?/i
  const symbolPattern = /symbol[:\s]+["']?([A-Z0-9]+)["']?/i
  const supplyPattern = /supply[:\s]+(\d+(?:,\d+)*)/i

  describe('token name extraction', () => {
    test('extracts quoted name', () => {
      const text = 'name: "My Token"'
      const match = text.match(namePattern)
      expect(match?.[1].trim()).toBe('My Token')
    })

    test('extracts single quoted name', () => {
      const text = "name: 'Cool Token'"
      const match = text.match(namePattern)
      expect(match?.[1].trim()).toBe('Cool Token')
    })

    test('extracts unquoted name', () => {
      const text = 'name: TestToken'
      const match = text.match(namePattern)
      expect(match?.[1].trim()).toBe('TestToken')
    })

    test('handles colon without space', () => {
      const text = 'name:"My Token"'
      const match = text.match(namePattern)
      expect(match?.[1].trim()).toBe('My Token')
    })

    test('handles space without colon', () => {
      const text = 'name "My Token"'
      const match = text.match(namePattern)
      expect(match?.[1].trim()).toBe('My Token')
    })
  })

  describe('token symbol extraction', () => {
    test('extracts uppercase symbol', () => {
      const text = 'symbol: MTK'
      const match = text.match(symbolPattern)
      expect(match?.[1].trim()).toBe('MTK')
    })

    test('extracts symbol with numbers', () => {
      const text = 'symbol: USDC2'
      const match = text.match(symbolPattern)
      expect(match?.[1].trim()).toBe('USDC2')
    })

    test('handles quoted symbol', () => {
      const text = 'symbol: "XYZ"'
      const match = text.match(symbolPattern)
      expect(match?.[1]).toBe('XYZ')
    })

    test('case insensitive key', () => {
      const text = 'SYMBOL: MTK'
      const match = text.match(symbolPattern)
      expect(match?.[1]).toBe('MTK')
    })
  })

  describe('supply extraction', () => {
    test('extracts simple supply', () => {
      const text = 'supply: 1000000'
      const match = text.match(supplyPattern)
      expect(match?.[1]).toBe('1000000')
    })

    test('extracts supply with commas', () => {
      const text = 'supply: 1,000,000'
      const match = text.match(supplyPattern)
      expect(match?.[1]).toBe('1,000,000')
      expect(BigInt(match?.[1].replace(/,/g, ''))).toBe(1000000n)
    })

    test('extracts large supply', () => {
      const text = 'supply: 1,000,000,000,000'
      const match = text.match(supplyPattern)
      expect(match?.[1]).toBe('1,000,000,000,000')
      expect(BigInt(match?.[1].replace(/,/g, ''))).toBe(1000000000000n)
    })
  })

  describe('full token creation parsing', () => {
    test('parses complete token creation request', () => {
      const text =
        'Create token with name: "My Token", symbol: MTK, supply: 1,000,000'

      const nameMatch = text.match(namePattern)
      const symbolMatch = text.match(symbolPattern)
      const supplyMatch = text.match(supplyPattern)

      expect(nameMatch?.[1].trim()).toBe('My Token')
      expect(symbolMatch?.[1].trim()).toBe('MTK')
      expect(supplyMatch?.[1]).toBe('1,000,000')
    })
  })

  // Presale patterns
  const tokenMatch = /token[:\s]+(0x[a-fA-F0-9]{40})/i
  const rateMatch = /rate[:\s]+(\d+)/i
  const softCapMatch = /soft\s*cap[:\s]+(\d+(?:\.\d+)?)/i
  const hardCapMatch = /hard\s*cap[:\s]+(\d+(?:\.\d+)?)/i

  describe('presale parsing', () => {
    test('extracts token address', () => {
      const text = 'token: 0x1234567890abcdef1234567890abcdef12345678'
      const match = text.match(tokenMatch)
      expect(match?.[1]).toBe('0x1234567890abcdef1234567890abcdef12345678')
    })

    test('extracts rate', () => {
      const text = 'rate: 1000'
      const match = text.match(rateMatch)
      expect(match?.[1]).toBe('1000')
    })

    test('extracts soft cap', () => {
      const text = 'soft cap: 10'
      const match = text.match(softCapMatch)
      expect(match?.[1]).toBe('10')
    })

    test('extracts soft cap with decimal', () => {
      const text = 'softcap: 10.5'
      const match = text.match(softCapMatch)
      expect(match?.[1]).toBe('10.5')
    })

    test('extracts hard cap', () => {
      const text = 'hard cap: 100'
      const match = text.match(hardCapMatch)
      expect(match?.[1]).toBe('100')
    })

    test('parses complete presale request', () => {
      const text =
        'Create presale for token: 0x742d35cc6634c0532925a3b844bc9e7595916fab, rate: 1000, soft cap: 10 ETH, hard cap: 100 ETH'

      expect(text.match(tokenMatch)?.[1]).toBe(
        '0x742d35cc6634c0532925a3b844bc9e7595916fab',
      )
      expect(text.match(rateMatch)?.[1]).toBe('1000')
      expect(text.match(softCapMatch)?.[1]).toBe('10')
      expect(text.match(hardCapMatch)?.[1]).toBe('100')
    })
  })

  // Curve/LP patterns
  const curveMatch = /(0x[a-fA-F0-9]{64})/
  const amountMatch = /(\d+(?:\.\d+)?)\s*ETH/i
  const tokenAmountMatch = /(\d+(?:,\d+)*)\s*tokens?/i
  const daysMatch = /(\d+)\s*days?/i

  describe('bonding curve parsing', () => {
    test('extracts curve ID', () => {
      const text =
        'curve: 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const match = text.match(curveMatch)
      expect(match?.[1]).toBe(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      )
    })

    test('extracts ETH amount', () => {
      const text = 'buy for 0.1 ETH'
      const match = text.match(amountMatch)
      expect(match?.[1]).toBe('0.1')
    })

    test('extracts token amount', () => {
      const text = 'sell 1000 tokens'
      const match = text.match(tokenAmountMatch)
      expect(match?.[1]).toBe('1000')
    })

    test('extracts token amount with commas', () => {
      const text = 'sell 1,000,000 tokens'
      const match = text.match(tokenAmountMatch)
      expect(match?.[1]).toBe('1,000,000')
    })

    test('extracts days', () => {
      const text = 'lock for 365 days'
      const match = text.match(daysMatch)
      expect(match?.[1]).toBe('365')
    })

    test('extracts singular day', () => {
      const text = 'lock for 1 day'
      const match = text.match(daysMatch)
      expect(match?.[1]).toBe('1')
    })
  })
})

// =============================================================================
// Property-based style tests for amount parsing
// =============================================================================

describe('Amount parsing property tests', () => {
  const testAmounts = [
    '0',
    '1',
    '0.1',
    '0.01',
    '0.001',
    '0.0001',
    '0.00001',
    '0.000001',
    '10',
    '100',
    '1000',
    '10000',
    '100000',
    '1000000',
    '123.456',
    '999.999999',
  ]

  test('parseSwapParams preserves amount precision', () => {
    for (const amount of testAmounts) {
      const result = parseSwapParams(`swap ${amount} ETH for USDC`)
      expect(result.amountIn).toBe(parseEther(amount))
      // Verify round-trip (check for undefined, not falsy, since 0n is valid)
      if (result.amountIn === undefined)
        throw new Error('amountIn is undefined')
      expect(formatEther(result.amountIn)).toBe(amount)
    }
  })

  test('parseTransferParams preserves amount precision', () => {
    for (const amount of testAmounts) {
      const result = parseTransferParams(
        `bridge ${amount} ETH from jeju to base`,
      )
      expect(result.amount).toBeDefined()
      expect(result.amount).toBe(parseEther(amount))
      // Verify round-trip conversion works
      expect(formatEther(result.amount)).toBe(amount)
    }
  })
})

// =============================================================================
// Fuzzing-style tests with random inputs
// =============================================================================

describe('Parser robustness tests', () => {
  // Valid string inputs that should not throw
  const stringInputs = [
    '',
    '   ',
    '\n\n\n',
    '\t\t',
    '🚀🌙💎',
    "<script>alert('xss')</script>",
    "'; DROP TABLE users;--",
    '\\x00\\x01\\x02',
    String.fromCharCode(0),
    'a'.repeat(10000),
    `swap ${'9'.repeat(100)} ETH for USDC`,
    'swap -100 ETH for USDC',
    'swap 1e18 ETH for USDC',
    'swap 0x100 ETH for USDC',
    'swap NaN ETH for USDC',
    'swap Infinity ETH for USDC',
  ]

  test('parseSwapParams handles string inputs gracefully', () => {
    for (const input of stringInputs) {
      // Should not throw for string inputs
      const result = parseSwapParams(input)
      // Result should be an object (may have undefined values)
      expect(typeof result).toBe('object')
    }
  })

  test('parseTransferParams handles string inputs gracefully', () => {
    for (const input of stringInputs) {
      // Should not throw for string inputs
      const result = parseTransferParams(input)
      // Result should be an object
      expect(typeof result).toBe('object')
    }
  })

  // Note: null/undefined inputs will throw since these are internal functions
  // that expect string input. Callers (action handlers) should validate first.
  test('parseSwapParams throws on null input', () => {
    expect(() => parseSwapParamsRaw(null)).toThrow()
  })

  test('parseTransferParams throws on null input', () => {
    expect(() => parseTransferParamsRaw(null)).toThrow()
  })
})
