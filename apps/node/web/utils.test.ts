import { describe, expect, test } from 'bun:test'
import { formatEther, parseWei, shortenAddress, sleep } from './utils'

describe('formatEther', () => {
  describe('standard formatting', () => {
    test('formats 1 ETH correctly', () => {
      const result = formatEther(1000000000000000000n)
      expect(result).toBe('1.00')
    })

    test('formats 0 ETH correctly', () => {
      const result = formatEther(0n)
      expect(result).toBe('0')
    })

    test('formats 0.5 ETH correctly', () => {
      const result = formatEther(500000000000000000n)
      expect(result).toBe('0.500')
    })

    test('formats 10 ETH correctly', () => {
      const result = formatEther(10000000000000000000n)
      expect(result).toBe('10.00')
    })

    test('formats 100 ETH correctly', () => {
      const result = formatEther(100000000000000000000n)
      expect(result).toBe('100.0')
    })

    test('formats 1000 ETH correctly', () => {
      const result = formatEther(1000000000000000000000n)
      expect(result).toBe('1000.0')
    })
  })

  describe('small amounts', () => {
    test('shows <0.0001 for very small amounts', () => {
      // 0.00001 ETH = 10000000000000 wei
      const result = formatEther(10000000000000n)
      expect(result).toBe('<0.0001')
    })

    test('shows 4 decimals for amounts between 0.0001 and 0.01', () => {
      // 0.001 ETH
      const result = formatEther(1000000000000000n)
      expect(result).toBe('0.0010')
    })

    test('shows 3 decimals for amounts between 0.01 and 1', () => {
      // 0.123 ETH
      const result = formatEther(123000000000000000n)
      expect(result).toBe('0.123')
    })
  })

  describe('string input', () => {
    test('accepts string wei values', () => {
      const result = formatEther('1000000000000000000')
      expect(result).toBe('1.00')
    })

    test('throws for empty string', () => {
      expect(() => formatEther('')).toThrow(
        'formatEther: empty string provided',
      )
    })

    test('throws for non-numeric strings', () => {
      expect(() => formatEther('abc')).toThrow(
        'formatEther: invalid wei string',
      )
    })

    test('throws for decimal strings', () => {
      expect(() => formatEther('1.5')).toThrow(
        'formatEther: invalid wei string',
      )
    })

    test('throws for negative strings', () => {
      expect(() => formatEther('-1')).toThrow('formatEther: invalid wei string')
    })
  })

  describe('precision edge cases', () => {
    test('handles exact threshold at 0.0001', () => {
      // 0.0001 ETH = 100000000000000 wei
      const result = formatEther(100000000000000n)
      expect(result).toBe('0.0001')
    })

    test('handles exact threshold at 0.01', () => {
      // 0.01 ETH = 10000000000000000 wei
      const result = formatEther(10000000000000000n)
      expect(result).toBe('0.010')
    })

    test('handles exact threshold at 1', () => {
      // 1 ETH
      const result = formatEther(1000000000000000000n)
      expect(result).toBe('1.00')
    })

    test('handles exact threshold at 100', () => {
      // 100 ETH
      const result = formatEther(100000000000000000000n)
      expect(result).toBe('100.0')
    })
  })

  describe('large amounts', () => {
    test('formats 1 million ETH', () => {
      const oneMillion = 1000000n * 1000000000000000000n
      const result = formatEther(oneMillion)
      expect(result).toBe('1000000.0')
    })

    test('handles max safe integer wei', () => {
      // This is a very large amount but should still work
      const large = 999999999999999999999999n
      const result = formatEther(large)
      expect(result.length).toBeGreaterThan(0)
    })
  })
})

describe('parseWei', () => {
  test('parses 1 ETH correctly', () => {
    const result = parseWei('1')
    expect(result).toBe('1000000000000000000')
  })

  test('parses 0.5 ETH correctly', () => {
    const result = parseWei('0.5')
    expect(result).toBe('500000000000000000')
  })

  test('parses 0 correctly', () => {
    const result = parseWei('0')
    expect(result).toBe('0')
  })

  test('parses decimal ETH correctly', () => {
    const result = parseWei('0.123456789')
    expect(result).toBe('123456789000000000')
  })

  test('parses large amounts', () => {
    const result = parseWei('1000')
    expect(result).toBe('1000000000000000000000')
  })
})

describe('shortenAddress', () => {
  test('shortens valid address', () => {
    const address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
    const result = shortenAddress(address)
    expect(result).toContain('0xf39F')
    expect(result).toContain('2266')
    expect(result.includes('...')).toBe(true)
  })

  test('handles lowercase address', () => {
    const address = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'
    const result = shortenAddress(address)
    expect(result.length).toBeLessThan(address.length)
  })

  test('handles uppercase address', () => {
    const address = '0xF39FD6E51AAD88F6F4CE6AB8827279CFFFB92266'
    const result = shortenAddress(address)
    expect(result.length).toBeLessThan(address.length)
  })
})

describe('sleep', () => {
  test('delays for specified duration', async () => {
    const start = Date.now()
    await sleep(50)
    const elapsed = Date.now() - start
    // Allow some tolerance for timing
    expect(elapsed).toBeGreaterThanOrEqual(40)
    expect(elapsed).toBeLessThan(150)
  })

  test('resolves immediately for 0ms', async () => {
    const start = Date.now()
    await sleep(0)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(50)
  })
})
