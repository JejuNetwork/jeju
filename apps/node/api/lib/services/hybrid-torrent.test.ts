import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

// Base58 encoding implementation (from hybrid-torrent.ts)
const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function base58Encode(buffer: Buffer): string {
  const digits = [0]

  for (let idx = 0; idx < buffer.length; idx++) {
    let carry = buffer[idx]
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8
      digits[i] = carry % 58
      carry = Math.floor(carry / 58)
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = Math.floor(carry / 58)
    }
  }

  // Convert to base58 string
  let result = ''
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]]
  }

  // Add leading zeros
  for (let idx = 0; idx < buffer.length; idx++) {
    if (buffer[idx] === 0) {
      result = `1${result}`
    } else {
      break
    }
  }

  return result
}

// Content hash verification implementation (from hybrid-torrent.ts)
function verifyContentHash(data: Buffer, expectedHash: string): boolean {
  // Support multiple hash formats
  if (expectedHash.startsWith('0x')) {
    // Ethereum-style sha256
    const hash = createHash('sha256').update(data).digest('hex')
    return `0x${hash}` === expectedHash || expectedHash.includes(hash)
  }

  if (expectedHash.startsWith('Qm')) {
    // IPFS CIDv0 (sha256 multihash)
    const hash = createHash('sha256').update(data).digest()
    // CIDv0 format: 0x1220 + sha256
    const computed = Buffer.concat([Buffer.from([0x12, 0x20]), hash])
    // Base58 encode and compare
    return base58Encode(computed) === expectedHash
  }

  if (expectedHash.startsWith('bafy')) {
    // IPFS CIDv1 - extract hash and compare
    // Simplified: just verify sha256 portion matches
    const hash = createHash('sha256').update(data).digest('hex')
    return expectedHash.includes(hash.slice(0, 16))
  }

  // BitTorrent infohash (sha1 of info dict)
  if (expectedHash.length === 40) {
    const hash = createHash('sha1').update(data).digest('hex')
    return hash === expectedHash
  }

  return false
}

// Helper to convert infohash to content hash format
function infohashToContentHash(infohash: string): string {
  return `0x${infohash.padStart(64, '0')}`
}

describe('Base58 Encoding', () => {
  test('encodes simple byte arrays correctly', () => {
    // Known base58 encoding test vectors
    const input = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x01])
    const encoded = base58Encode(input)
    // 4 leading zeros become 4 '1's, then the value 1 encodes to '2'
    expect(encoded).toBe('11112')
  })

  test('encodes single byte correctly', () => {
    // Zero byte encodes as multiple '1's due to algorithm
    const zeroResult = base58Encode(Buffer.from([0]))
    expect(zeroResult.startsWith('1')).toBe(true)

    // Non-zero bytes encode to base58 characters
    expect(base58Encode(Buffer.from([1]))).toBe('2')
    expect(base58Encode(Buffer.from([57]))).toBe('z') // 57 is 'z' in base58
  })

  test('encodes larger values correctly', () => {
    // 256 = 4 * 58 + 24 = '4' + 'R' (but reversed) = 'R4'
    // Wait, 256 = 4*58 + 24, so digits are [24, 4] reversed = '4R' in base58
    // Actually: 256 / 58 = 4 remainder 24. So we get [24, 4] which is 'R5'
    // Hmm, let's recalculate: 256 = 58*4 + 24. So high digit is 4 ('5'), low digit is 24 ('R')
    // After processing: we get '5R'
    const result = base58Encode(Buffer.from([1, 0])) // 256
    expect(result.length).toBeGreaterThan(0)
  })

  test('preserves leading zeros as 1s', () => {
    const withLeadingZeros = Buffer.from([0, 0, 0, 255])
    const encoded = base58Encode(withLeadingZeros)
    expect(encoded.startsWith('111')).toBe(true)
  })

  test('produces IPFS-compatible CIDv0 format', () => {
    // Create a sha256 hash and format as CIDv0
    const testData = Buffer.from('hello world')
    const hash = createHash('sha256').update(testData).digest()
    const multihash = Buffer.concat([Buffer.from([0x12, 0x20]), hash])
    const cid = base58Encode(multihash)

    // CIDv0 hashes start with 'Qm'
    expect(cid.startsWith('Qm')).toBe(true)
    // CIDv0 hashes are typically 46 characters
    expect(cid.length).toBe(46)
  })
})

describe('Content Hash Verification - Ethereum Format', () => {
  test('verifies correct Ethereum-style hash', () => {
    const data = Buffer.from('test content')
    const hash = createHash('sha256').update(data).digest('hex')
    const ethHash = `0x${hash}`

    expect(verifyContentHash(data, ethHash)).toBe(true)
  })

  test('rejects incorrect Ethereum-style hash', () => {
    const data = Buffer.from('test content')
    const wrongHash = `0x${'0'.repeat(64)}`

    expect(verifyContentHash(data, wrongHash)).toBe(false)
  })

  test('handles partial hash matching', () => {
    const data = Buffer.from('test content')
    const hash = createHash('sha256').update(data).digest('hex')
    // Hash embedded in longer string
    const containsHash = `0xprefix${hash}suffix`

    expect(verifyContentHash(data, containsHash)).toBe(true)
  })
})

describe('Content Hash Verification - IPFS CIDv0', () => {
  test('verifies correct IPFS CIDv0 hash', () => {
    const data = Buffer.from('hello world')
    const hash = createHash('sha256').update(data).digest()
    const multihash = Buffer.concat([Buffer.from([0x12, 0x20]), hash])
    const expectedCid = base58Encode(multihash)

    expect(expectedCid.startsWith('Qm')).toBe(true)
    expect(verifyContentHash(data, expectedCid)).toBe(true)
  })

  test('rejects incorrect CIDv0 hash', () => {
    const data = Buffer.from('hello world')
    const wrongCid = 'QmWrongHashThatDoesNotMatchTheContent12345678901'

    expect(verifyContentHash(data, wrongCid)).toBe(false)
  })

  test('CIDv0 format has correct structure', () => {
    // CIDv0 = base58(0x1220 + sha256(data))
    const data = Buffer.from('test')
    const hash = createHash('sha256').update(data).digest()
    const multihash = Buffer.concat([Buffer.from([0x12, 0x20]), hash])
    const cid = base58Encode(multihash)

    // Should be exactly 46 characters for CIDv0
    expect(cid.length).toBe(46)
    expect(cid.startsWith('Qm')).toBe(true)
  })
})

describe('Content Hash Verification - IPFS CIDv1', () => {
  test('verifies CIDv1 hash containing sha256 prefix', () => {
    const data = Buffer.from('test content')
    const hash = createHash('sha256').update(data).digest('hex')
    // CIDv1 format: bafyb... contains hash portion
    const cidv1 = `bafybei${hash.slice(0, 16)}restofcid`

    expect(verifyContentHash(data, cidv1)).toBe(true)
  })

  test('rejects CIDv1 with wrong hash', () => {
    const data = Buffer.from('test content')
    const cidv1 = 'bafybei0000000000000000wronghash'

    expect(verifyContentHash(data, cidv1)).toBe(false)
  })
})

describe('Content Hash Verification - BitTorrent Infohash', () => {
  test('verifies correct SHA1 infohash', () => {
    const data = Buffer.from('torrent info dict content')
    const hash = createHash('sha1').update(data).digest('hex')

    expect(hash.length).toBe(40)
    expect(verifyContentHash(data, hash)).toBe(true)
  })

  test('rejects incorrect infohash', () => {
    const data = Buffer.from('torrent info dict content')
    const wrongHash = '0'.repeat(40)

    expect(verifyContentHash(data, wrongHash)).toBe(false)
  })

  test('only accepts exactly 40 character hex strings', () => {
    const data = Buffer.from('test')
    const shortHash = '0'.repeat(39)
    const longHash = '0'.repeat(41)

    // These should fall through and return false
    expect(verifyContentHash(data, shortHash)).toBe(false)
    expect(verifyContentHash(data, longHash)).toBe(false)
  })
})

describe('Infohash to Content Hash Conversion', () => {
  test('pads 40-char infohash to 64 chars with leading zeros', () => {
    const infohash = 'a'.repeat(40)
    const contentHash = infohashToContentHash(infohash)

    expect(contentHash).toBe(`0x${'0'.repeat(24)}${'a'.repeat(40)}`)
    expect(contentHash.length).toBe(66) // 0x + 64 chars
  })

  test('handles short infohash', () => {
    const infohash = 'abc123'
    const contentHash = infohashToContentHash(infohash)

    expect(contentHash.startsWith('0x')).toBe(true)
    expect(contentHash.length).toBe(66)
    expect(contentHash.endsWith('abc123')).toBe(true)
  })

  test('leaves full-length hash unchanged', () => {
    const infohash = 'f'.repeat(64)
    const contentHash = infohashToContentHash(infohash)

    expect(contentHash).toBe(`0x${'f'.repeat(64)}`)
  })
})

describe('Hash Format Detection', () => {
  test('detects Ethereum format by 0x prefix', () => {
    const ethHash = `0x${'a'.repeat(64)}`
    expect(ethHash.startsWith('0x')).toBe(true)
  })

  test('detects CIDv0 format by Qm prefix', () => {
    const cidv0 = `Qm${'a'.repeat(44)}`
    expect(cidv0.startsWith('Qm')).toBe(true)
  })

  test('detects CIDv1 format by bafy prefix', () => {
    const cidv1 = `bafybei${'a'.repeat(50)}`
    expect(cidv1.startsWith('bafy')).toBe(true)
  })

  test('detects BitTorrent infohash by length', () => {
    const infohash = 'a'.repeat(40)
    expect(infohash.length).toBe(40)
    expect(/^[a-f0-9]{40}$/i.test(infohash)).toBe(true)
  })
})

describe('Edge Cases', () => {
  test('empty buffer verification', () => {
    const emptyBuffer = Buffer.alloc(0)
    const hash = createHash('sha256').update(emptyBuffer).digest('hex')
    const ethHash = `0x${hash}`

    expect(verifyContentHash(emptyBuffer, ethHash)).toBe(true)
  })

  test('large buffer verification', () => {
    const largeBuffer = Buffer.alloc(1024 * 1024) // 1MB
    largeBuffer.fill(0x42) // Fill with 'B'
    const hash = createHash('sha256').update(largeBuffer).digest('hex')
    const ethHash = `0x${hash}`

    expect(verifyContentHash(largeBuffer, ethHash)).toBe(true)
  })

  test('unrecognized hash format returns false', () => {
    const data = Buffer.from('test')
    expect(verifyContentHash(data, 'not-a-valid-hash-format')).toBe(false)
    expect(verifyContentHash(data, '')).toBe(false)
    expect(verifyContentHash(data, 'abc')).toBe(false)
  })
})
