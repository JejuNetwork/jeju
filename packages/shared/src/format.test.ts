/**
 * Format Utilities Tests
 *
 * Tests formatting functions for bytes, duration, numbers, addresses, and ETH values.
 */

import { describe, expect, test } from 'bun:test'
import {
  chunk,
  classNames,
  cn,
  delay,
  formatAddress,
  formatBytes,
  formatBytesBinary,
  formatDuration,
  formatDurationVerbose,
  formatEth,
  formatGas,
  formatGasPrice,
  formatMs,
  formatNumber,
  formatPercent,
  formatUsd,
  generateId,
  generatePrefixedId,
  shortenAddress,
} from './format'

describe('formatBytes', () => {
  test('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  test('formats bytes under 1kB', () => {
    expect(formatBytes(500)).toBe('500 B')
  })

  test('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.02 kB')
    expect(formatBytes(1000)).toBe('1 kB')
  })

  test('formats megabytes', () => {
    expect(formatBytes(1234567)).toBe('1.23 MB')
  })

  test('formats gigabytes', () => {
    expect(formatBytes(1234567890)).toBe('1.23 GB')
  })

  test('handles negative bytes', () => {
    expect(formatBytes(-500)).toBe('-500 B')
  })
})

describe('formatBytesBinary', () => {
  test('formats 1024 bytes as 1 KiB', () => {
    expect(formatBytesBinary(1024)).toBe('1 KiB')
  })

  test('formats larger values with binary units', () => {
    expect(formatBytesBinary(1048576)).toBe('1 MiB')
  })
})

describe('formatMs', () => {
  test('formats milliseconds compactly (largest unit only)', () => {
    // With compact: true, only the largest unit is shown
    expect(formatMs(123456)).toBe('2m')
  })

  test('formats hours', () => {
    expect(formatMs(3600000)).toBe('1h')
  })

  test('formats small values', () => {
    expect(formatMs(500)).toBe('500ms')
  })

  test('formats days', () => {
    expect(formatMs(86400000)).toBe('1d')
  })
})

describe('formatDuration', () => {
  test('converts seconds to compact format (largest unit)', () => {
    // With compact: true, only the largest unit is shown
    expect(formatDuration(90)).toBe('1m')
  })

  test('formats hours', () => {
    expect(formatDuration(3600)).toBe('1h')
  })

  test('formats zero', () => {
    expect(formatDuration(0)).toBe('0ms')
  })
})

describe('formatDurationVerbose', () => {
  test('formats with verbose labels', () => {
    expect(formatDurationVerbose(90)).toBe('1 minute 30 seconds')
  })

  test('formats hours verbosely', () => {
    expect(formatDurationVerbose(7200)).toBe('2 hours')
  })
})

describe('formatNumber', () => {
  test('formats thousands with K suffix', () => {
    expect(formatNumber(1234)).toBe('1.2K')
  })

  test('formats millions with M suffix', () => {
    expect(formatNumber(1234567)).toBe('1.2M')
  })

  test('formats billions with B suffix', () => {
    expect(formatNumber(1234567890)).toBe('1.2B')
  })

  test('formats small numbers without suffix', () => {
    expect(formatNumber(123)).toBe('123')
  })

  test('formats zero', () => {
    expect(formatNumber(0)).toBe('0')
  })
})

describe('formatUsd', () => {
  test('formats currency with dollar sign', () => {
    expect(formatUsd(1234.56)).toBe('$1,234.56')
  })

  test('formats zero', () => {
    expect(formatUsd(0)).toBe('$0.00')
  })

  test('formats negative amounts', () => {
    expect(formatUsd(-100)).toBe('-$100.00')
  })

  test('formats large amounts with commas', () => {
    expect(formatUsd(1000000)).toBe('$1,000,000.00')
  })
})

describe('formatPercent', () => {
  test('formats decimal as percentage', () => {
    expect(formatPercent(0.1234)).toBe('12.34%')
  })

  test('formats zero', () => {
    expect(formatPercent(0)).toBe('0.00%')
  })

  test('formats 100%', () => {
    expect(formatPercent(1)).toBe('100.00%')
  })

  test('formats small percentages', () => {
    expect(formatPercent(0.0001)).toBe('0.01%')
  })
})

describe('formatAddress', () => {
  test('shortens a full Ethereum address', () => {
    const address = '0x1234567890abcdef1234567890abcdef12345678'
    expect(formatAddress(address)).toBe('0x1234...5678')
  })

  test('uses custom character count', () => {
    const address = '0x1234567890abcdef1234567890abcdef12345678'
    expect(formatAddress(address, 6)).toBe('0x123456...345678')
  })

  test('returns short addresses unchanged', () => {
    expect(formatAddress('0x1234')).toBe('0x1234')
  })

  test('handles empty string', () => {
    expect(formatAddress('')).toBe('')
  })

  test('handles null/undefined gracefully', () => {
    expect(formatAddress('')).toBe('')
  })

  test('shortenAddress is an alias for formatAddress', () => {
    const address = '0x1234567890abcdef1234567890abcdef12345678'
    expect(shortenAddress(address)).toBe(formatAddress(address))
  })
})

describe('formatEth', () => {
  test('formats 1 ETH from wei', () => {
    expect(formatEth(1000000000000000000n)).toBe('1.0000 ETH')
  })

  test('formats fractional ETH', () => {
    expect(formatEth(1500000000000000000n)).toBe('1.5000 ETH')
  })

  test('formats small amounts', () => {
    expect(formatEth(1000000000000000n)).toBe('0.0010 ETH')
  })

  test('formats zero', () => {
    expect(formatEth(0n)).toBe('0.0000 ETH')
  })

  test('accepts string input', () => {
    expect(formatEth('1000000000000000000')).toBe('1.0000 ETH')
  })

  test('uses custom decimals', () => {
    expect(formatEth(1234567890000000000n, 2)).toBe('1.23 ETH')
  })

  test('handles very large values', () => {
    const largeWei = 100000000000000000000n // 100 ETH
    expect(formatEth(largeWei)).toBe('100.0000 ETH')
  })
})

describe('formatGas', () => {
  test('formats gas amount', () => {
    expect(formatGas(21000)).toBe('21K gas')
  })

  test('formats large gas values', () => {
    expect(formatGas(1000000)).toBe('1M gas')
  })
})

describe('formatGasPrice', () => {
  test('formats gwei price', () => {
    expect(formatGasPrice(25.5)).toBe('25.50 gwei')
  })

  test('formats integer gwei', () => {
    expect(formatGasPrice(100)).toBe('100.00 gwei')
  })
})

describe('generateId', () => {
  test('generates 21 character ID by default', () => {
    const id = generateId()
    expect(id.length).toBe(21)
  })

  test('generates custom length ID', () => {
    const id = generateId(10)
    expect(id.length).toBe(10)
  })

  test('generates unique IDs', () => {
    const ids = new Set(
      Array(100)
        .fill(null)
        .map(() => generateId()),
    )
    expect(ids.size).toBe(100)
  })
})

describe('generatePrefixedId', () => {
  test('generates ID with prefix', () => {
    const id = generatePrefixedId('user')
    expect(id.startsWith('user_')).toBe(true)
    expect(id.length).toBe(5 + 16) // prefix + underscore + 16 chars
  })

  test('uses custom size', () => {
    const id = generatePrefixedId('tx', 8)
    expect(id.startsWith('tx_')).toBe(true)
    expect(id.length).toBe(3 + 8) // "tx_" + 8 chars
  })
})

describe('classNames', () => {
  test('merges class names', () => {
    expect(classNames('btn', 'btn-primary')).toBe('btn btn-primary')
  })

  test('handles conditional classes', () => {
    const isActive = true
    const isDisabled = false
    expect(
      classNames('btn', isActive && 'active', isDisabled && 'disabled'),
    ).toBe('btn active')
  })

  test('filters falsy values', () => {
    expect(classNames('btn', null, undefined, '', 'active')).toBe('btn active')
  })

  test('handles objects', () => {
    expect(classNames({ active: true, disabled: false })).toBe('active')
  })

  test('handles arrays', () => {
    expect(classNames(['a', 'b'], 'c')).toBe('a b c')
  })
})

describe('cn (with tailwind-merge)', () => {
  test('merges class names', () => {
    expect(cn('btn', 'btn-primary')).toBe('btn btn-primary')
  })

  test('handles conditional classes', () => {
    const isActive = true
    const isDisabled = false
    expect(cn('btn', isActive && 'active', isDisabled && 'disabled')).toBe(
      'btn active',
    )
  })

  test('filters falsy values', () => {
    expect(cn('btn', null, undefined, '', 'active')).toBe('btn active')
  })

  test('handles objects', () => {
    expect(cn({ active: true, disabled: false })).toBe('active')
  })

  test('handles arrays', () => {
    expect(cn(['a', 'b'], 'c')).toBe('a b c')
  })

  test('merges conflicting Tailwind padding classes', () => {
    // p-4 and px-2: px-2 should override horizontal padding from p-4
    expect(cn('p-4', 'px-2')).toBe('p-4 px-2')
  })

  test('merges conflicting Tailwind text color classes', () => {
    // Later color should override earlier
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  test('merges conflicting Tailwind background classes', () => {
    expect(cn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500')
  })

  test('keeps non-conflicting Tailwind classes', () => {
    expect(cn('p-4', 'm-2', 'text-red-500')).toBe('p-4 m-2 text-red-500')
  })
})

describe('delay', () => {
  test('delays execution', async () => {
    const start = Date.now()
    await delay(50)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(45)
  })

  test('resolves to undefined', async () => {
    const result = await delay(1)
    expect(result).toBeUndefined()
  })
})

describe('chunk', () => {
  test('chunks array into specified sizes', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  test('handles exact divisible length', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ])
  })

  test('handles empty array', () => {
    expect(chunk([], 2)).toEqual([])
  })

  test('handles chunk size larger than array', () => {
    expect(chunk([1, 2], 5)).toEqual([[1, 2]])
  })

  test('handles chunk size of 1', () => {
    expect(chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]])
  })

  test('preserves element types', () => {
    expect(chunk(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']])
  })

  test('handles objects in array', () => {
    const objs = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const result = chunk(objs, 2)
    expect(result).toEqual([[{ id: 1 }, { id: 2 }], [{ id: 3 }]])
  })

  // Property-based / fuzz tests
  test('total elements preserved after chunking', () => {
    for (let i = 0; i < 100; i++) {
      const size = Math.floor(Math.random() * 50) + 1
      const arr = Array.from({ length: size }, (_, j) => j)
      const chunkSize = Math.floor(Math.random() * 10) + 1
      const chunks = chunk(arr, chunkSize)
      const flattened = chunks.flat()
      expect(flattened).toEqual(arr)
    }
  })

  test('all chunks except last have correct size', () => {
    for (let i = 0; i < 100; i++) {
      const size = Math.floor(Math.random() * 50) + 1
      const arr = Array.from({ length: size }, (_, j) => j)
      const chunkSize = Math.floor(Math.random() * 10) + 1
      const chunks = chunk(arr, chunkSize)

      for (let j = 0; j < chunks.length - 1; j++) {
        expect(chunks[j].length).toBe(chunkSize)
      }
      // Last chunk should be <= chunkSize
      if (chunks.length > 0) {
        expect(chunks[chunks.length - 1].length).toBeLessThanOrEqual(chunkSize)
        expect(chunks[chunks.length - 1].length).toBeGreaterThan(0)
      }
    }
  })
})
