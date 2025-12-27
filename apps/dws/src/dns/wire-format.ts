/**
 * DNS Wire Format Encoder/Decoder
 *
 * Implements DNS message encoding and decoding per RFC 1035.
 * Used for DoH (RFC 8484) and DoT (RFC 7858) protocols.
 */

import type { DNSMessage, DNSQuestion, DNSResourceRecord } from './types'
import { DNSRecordType, DNSResponseCode } from './types'

// Re-export for use by other modules
export type { DNSMessage, DNSResourceRecord }

// DNS Header flags bit positions
const QR_BIT = 15 // Query/Response
const OPCODE_SHIFT = 11
const OPCODE_MASK = 0xf
const AA_BIT = 10 // Authoritative Answer
const TC_BIT = 9 // Truncation
const RD_BIT = 8 // Recursion Desired
const RA_BIT = 7 // Recursion Available
const RCODE_MASK = 0xf

/**
 * Decode a DNS wire format message into structured format
 */
export function decodeDNSMessage(buffer: Buffer): DNSMessage {
  let offset = 0

  // Header (12 bytes)
  const id = buffer.readUInt16BE(offset)
  offset += 2

  const flags = buffer.readUInt16BE(offset)
  offset += 2

  const qdcount = buffer.readUInt16BE(offset)
  offset += 2

  const ancount = buffer.readUInt16BE(offset)
  offset += 2

  const nscount = buffer.readUInt16BE(offset)
  offset += 2

  const arcount = buffer.readUInt16BE(offset)
  offset += 2

  // Parse flags
  const qr = Boolean((flags >> QR_BIT) & 1)
  const opcode = (flags >> OPCODE_SHIFT) & OPCODE_MASK
  const aa = Boolean((flags >> AA_BIT) & 1)
  const tc = Boolean((flags >> TC_BIT) & 1)
  const rd = Boolean((flags >> RD_BIT) & 1)
  const ra = Boolean((flags >> RA_BIT) & 1)
  const rcode = (flags & RCODE_MASK) as typeof DNSResponseCode.NOERROR

  // Parse questions
  const questions: DNSQuestion[] = []
  for (let i = 0; i < qdcount; i++) {
    const { name, newOffset } = decodeDomainName(buffer, offset)
    offset = newOffset

    const type = buffer.readUInt16BE(offset)
    offset += 2

    const qclass = buffer.readUInt16BE(offset)
    offset += 2

    questions.push({ name, type, class: qclass })
  }

  // Parse answer records
  const answers: DNSResourceRecord[] = []
  for (let i = 0; i < ancount; i++) {
    const { record, newOffset } = decodeResourceRecord(buffer, offset)
    offset = newOffset
    answers.push(record)
  }

  // Parse authority records
  const authorities: DNSResourceRecord[] = []
  for (let i = 0; i < nscount; i++) {
    const { record, newOffset } = decodeResourceRecord(buffer, offset)
    offset = newOffset
    authorities.push(record)
  }

  // Parse additional records
  const additionals: DNSResourceRecord[] = []
  for (let i = 0; i < arcount; i++) {
    const { record, newOffset } = decodeResourceRecord(buffer, offset)
    offset = newOffset
    additionals.push(record)
  }

  return {
    id,
    flags: { qr, opcode, aa, tc, rd, ra, rcode },
    questions,
    answers,
    authorities,
    additionals,
  }
}

/**
 * Encode a DNS message into wire format
 */
export function encodeDNSMessage(message: DNSMessage): Buffer {
  const parts: Buffer[] = []

  // Header
  const header = Buffer.alloc(12)

  // ID
  header.writeUInt16BE(message.id, 0)

  // Flags
  let flags = 0
  if (message.flags.qr) flags |= 1 << QR_BIT
  flags |= (message.flags.opcode & OPCODE_MASK) << OPCODE_SHIFT
  if (message.flags.aa) flags |= 1 << AA_BIT
  if (message.flags.tc) flags |= 1 << TC_BIT
  if (message.flags.rd) flags |= 1 << RD_BIT
  if (message.flags.ra) flags |= 1 << RA_BIT
  flags |= message.flags.rcode & RCODE_MASK
  header.writeUInt16BE(flags, 2)

  // Counts
  header.writeUInt16BE(message.questions.length, 4)
  header.writeUInt16BE(message.answers.length, 6)
  header.writeUInt16BE(message.authorities.length, 8)
  header.writeUInt16BE(message.additionals.length, 10)

  parts.push(header)

  // Questions
  for (const question of message.questions) {
    parts.push(encodeDomainName(question.name))
    const qFooter = Buffer.alloc(4)
    qFooter.writeUInt16BE(question.type, 0)
    qFooter.writeUInt16BE(question.class, 2)
    parts.push(qFooter)
  }

  // Answers
  for (const answer of message.answers) {
    parts.push(encodeResourceRecord(answer))
  }

  // Authorities
  for (const auth of message.authorities) {
    parts.push(encodeResourceRecord(auth))
  }

  // Additionals
  for (const add of message.additionals) {
    parts.push(encodeResourceRecord(add))
  }

  return Buffer.concat(parts)
}

/**
 * Decode a domain name from DNS wire format
 * Handles compression pointers (RFC 1035 Section 4.1.4)
 */
function decodeDomainName(
  buffer: Buffer,
  offset: number,
): { name: string; newOffset: number } {
  const labels: string[] = []
  let currentOffset = offset
  let jumped = false
  let jumpOffset = offset

  while (true) {
    const len = buffer.readUInt8(currentOffset)

    // Check for compression pointer (top 2 bits = 11)
    if ((len & 0xc0) === 0xc0) {
      if (!jumped) {
        jumpOffset = currentOffset + 2
      }
      // Read pointer offset
      const pointer = buffer.readUInt16BE(currentOffset) & 0x3fff
      currentOffset = pointer
      jumped = true
      continue
    }

    // End of name
    if (len === 0) {
      currentOffset += 1
      break
    }

    // Regular label
    currentOffset += 1
    const label = buffer.subarray(currentOffset, currentOffset + len).toString()
    labels.push(label)
    currentOffset += len
  }

  return {
    name: labels.join('.'),
    newOffset: jumped ? jumpOffset : currentOffset,
  }
}

/**
 * Encode a domain name into DNS wire format
 */
function encodeDomainName(name: string): Buffer {
  if (!name || name === '.') {
    return Buffer.from([0])
  }

  const labels = name.split('.')
  const parts: Buffer[] = []

  for (const label of labels) {
    if (label.length === 0) continue
    if (label.length > 63) {
      throw new Error(`DNS label too long: ${label.length} > 63`)
    }
    parts.push(Buffer.from([label.length]))
    parts.push(Buffer.from(label))
  }

  // Null terminator
  parts.push(Buffer.from([0]))

  return Buffer.concat(parts)
}

/**
 * Decode a resource record from DNS wire format
 */
function decodeResourceRecord(
  buffer: Buffer,
  offset: number,
): { record: DNSResourceRecord; newOffset: number } {
  const { name, newOffset: nameOffset } = decodeDomainName(buffer, offset)
  let currentOffset = nameOffset

  const type = buffer.readUInt16BE(currentOffset)
  currentOffset += 2

  const rclass = buffer.readUInt16BE(currentOffset)
  currentOffset += 2

  const ttl = buffer.readUInt32BE(currentOffset)
  currentOffset += 4

  const rdlength = buffer.readUInt16BE(currentOffset)
  currentOffset += 2

  const rdata = buffer.subarray(currentOffset, currentOffset + rdlength)
  currentOffset += rdlength

  // Decode rdata based on type
  let data: string | Buffer
  switch (type) {
    case DNSRecordType.A:
      data = `${rdata[0]}.${rdata[1]}.${rdata[2]}.${rdata[3]}`
      break

    case DNSRecordType.AAAA:
      data = formatIPv6(rdata)
      break

    case DNSRecordType.CNAME:
    case DNSRecordType.NS:
    case DNSRecordType.PTR: {
      const { name: target } = decodeDomainName(
        Buffer.concat([buffer.subarray(0, offset), rdata]),
        offset,
      )
      data = target
      break
    }

    case DNSRecordType.TXT: {
      // TXT records are length-prefixed strings
      const texts: string[] = []
      let pos = 0
      while (pos < rdata.length) {
        const txtLen = rdata[pos]
        if (txtLen === undefined) break
        pos += 1
        texts.push(rdata.subarray(pos, pos + txtLen).toString())
        pos += txtLen
      }
      data = texts.join('')
      break
    }

    case DNSRecordType.MX: {
      const preference = rdata.readUInt16BE(0)
      const { name: exchange } = decodeDomainName(
        Buffer.concat([buffer.subarray(0, offset), rdata]),
        offset + 2,
      )
      data = `${preference} ${exchange}`
      break
    }

    default:
      data = rdata
  }

  return {
    record: { name, type, class: rclass, ttl, data },
    newOffset: currentOffset,
  }
}

/**
 * Encode a resource record into DNS wire format
 */
function encodeResourceRecord(record: DNSResourceRecord): Buffer {
  const parts: Buffer[] = []

  // Name
  parts.push(encodeDomainName(record.name))

  // Type, class, TTL
  const header = Buffer.alloc(8)
  header.writeUInt16BE(record.type, 0)
  header.writeUInt16BE(record.class, 2)
  header.writeUInt32BE(record.ttl, 4)
  parts.push(header)

  // RDATA
  const rdata = encodeRData(record.type, record.data)
  const rdlength = Buffer.alloc(2)
  rdlength.writeUInt16BE(rdata.length, 0)
  parts.push(rdlength)
  parts.push(rdata)

  return Buffer.concat(parts)
}

/**
 * Encode RDATA based on record type
 */
function encodeRData(type: number, data: string | Buffer | object): Buffer {
  if (Buffer.isBuffer(data)) {
    return data
  }

  switch (type) {
    case DNSRecordType.A: {
      const str = String(data)
      const parts = str.split('.').map((p) => parseInt(p, 10))
      return Buffer.from(parts)
    }

    case DNSRecordType.AAAA: {
      return parseIPv6(String(data))
    }

    case DNSRecordType.CNAME:
    case DNSRecordType.NS:
    case DNSRecordType.PTR: {
      return encodeDomainName(String(data))
    }

    case DNSRecordType.TXT: {
      const str = String(data)
      // Split into 255-byte chunks
      const chunks: Buffer[] = []
      for (let i = 0; i < str.length; i += 255) {
        const chunk = str.slice(i, i + 255)
        chunks.push(Buffer.from([chunk.length]))
        chunks.push(Buffer.from(chunk))
      }
      return Buffer.concat(chunks)
    }

    case DNSRecordType.MX: {
      const str = String(data)
      const match = str.match(/^(\d+)\s+(.+)$/)
      if (!match || !match[1] || !match[2]) {
        throw new Error(`Invalid MX record format: ${str}`)
      }
      const preference = parseInt(match[1], 10)
      const exchange = match[2]
      const prefBuf = Buffer.alloc(2)
      prefBuf.writeUInt16BE(preference, 0)
      return Buffer.concat([prefBuf, encodeDomainName(exchange)])
    }

    case DNSRecordType.SOA: {
      if (typeof data === 'object' && 'mname' in data) {
        const soa = data as {
          mname: string
          rname: string
          serial: number
          refresh: number
          retry: number
          expire: number
          minimum: number
        }
        const timers = Buffer.alloc(20)
        timers.writeUInt32BE(soa.serial, 0)
        timers.writeUInt32BE(soa.refresh, 4)
        timers.writeUInt32BE(soa.retry, 8)
        timers.writeUInt32BE(soa.expire, 12)
        timers.writeUInt32BE(soa.minimum, 16)
        return Buffer.concat([
          encodeDomainName(soa.mname),
          encodeDomainName(soa.rname),
          timers,
        ])
      }
      throw new Error('SOA record requires object data')
    }

    default:
      // Unknown type - return as-is if Buffer, otherwise encode string
      return Buffer.from(String(data))
  }
}

/**
 * Format IPv6 address from 16-byte buffer
 */
function formatIPv6(buffer: Buffer): string {
  const groups: string[] = []
  for (let i = 0; i < 16; i += 2) {
    groups.push(buffer.readUInt16BE(i).toString(16))
  }
  return groups.join(':')
}

/**
 * Parse IPv6 address string to 16-byte buffer
 */
function parseIPv6(address: string): Buffer {
  const buffer = Buffer.alloc(16)

  // Handle :: expansion
  let fullAddress = address
  if (address.includes('::')) {
    const parts = address.split('::')
    const left = parts[0] ? parts[0].split(':') : []
    const right = parts[1] ? parts[1].split(':') : []
    const missing = 8 - left.length - right.length
    const middle = Array(missing).fill('0')
    fullAddress = [...left, ...middle, ...right].join(':')
  }

  const groups = fullAddress.split(':')
  for (let i = 0; i < 8; i++) {
    const value = parseInt(groups[i] ?? '0', 16)
    buffer.writeUInt16BE(value, i * 2)
  }

  return buffer
}

/**
 * Create a simple DNS response for a query
 */
export function createDNSResponse(
  query: DNSMessage,
  answers: DNSResourceRecord[],
  rcode: number = DNSResponseCode.NOERROR,
): DNSMessage {
  // Cast rcode to the expected union type
  const responseCode = rcode as 0 | 1 | 2 | 3 | 4 | 5

  return {
    id: query.id,
    flags: {
      qr: true, // This is a response
      opcode: query.flags.opcode,
      aa: true, // Authoritative answer
      tc: false, // Not truncated
      rd: query.flags.rd,
      ra: true, // Recursion available
      rcode: responseCode,
    },
    questions: query.questions,
    answers,
    authorities: [],
    additionals: [],
  }
}

/**
 * Create an NXDOMAIN response
 */
export function createNXDOMAINResponse(query: DNSMessage): DNSMessage {
  return createDNSResponse(query, [], DNSResponseCode.NXDOMAIN)
}

/**
 * Create a SERVFAIL response
 */
export function createSERVFAILResponse(query: DNSMessage): DNSMessage {
  return createDNSResponse(query, [], DNSResponseCode.SERVFAIL)
}

/**
 * Validate a DNS message
 */
export function validateDNSMessage(message: DNSMessage): {
  valid: boolean
  error?: string
} {
  if (message.questions.length === 0) {
    return { valid: false, error: 'No questions in query' }
  }

  for (const question of message.questions) {
    if (!question.name || question.name.length > 253) {
      return { valid: false, error: 'Invalid domain name length' }
    }
    if (question.type < 1 || question.type > 65535) {
      return { valid: false, error: 'Invalid query type' }
    }
  }

  return { valid: true }
}
