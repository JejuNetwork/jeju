/**
 * DNS Types for DWS
 */

import type { Address, Hex } from 'viem'

/** DNS record types we support */
export const DNSRecordType = {
  A: 1,
  AAAA: 28,
  CNAME: 5,
  TXT: 16,
  MX: 15,
  NS: 2,
  SOA: 6,
  SRV: 33,
  CAA: 257,
  HTTPS: 65,
  SVCB: 64,
} as const
export type DNSRecordType = (typeof DNSRecordType)[keyof typeof DNSRecordType]

/** DNS record class */
export const DNSClass = {
  IN: 1,
  CH: 3,
  HS: 4,
} as const
export type DNSClass = (typeof DNSClass)[keyof typeof DNSClass]

/** DNS response codes */
export const DNSResponseCode = {
  NOERROR: 0,
  FORMERR: 1,
  SERVFAIL: 2,
  NXDOMAIN: 3,
  NOTIMP: 4,
  REFUSED: 5,
} as const
export type DNSResponseCode =
  (typeof DNSResponseCode)[keyof typeof DNSResponseCode]

/** Resolver types for resolution chain */
export const ResolverType = {
  JNS: 'jns',
  ENS: 'ens',
  HANDSHAKE: 'handshake',
  ICANN: 'icann',
  LOCAL: 'local',
} as const
export type ResolverType = (typeof ResolverType)[keyof typeof ResolverType]

/** DNS Question */
export interface DNSQuestion {
  name: string
  type: DNSRecordType
  class: DNSClass
}

/** DNS Resource Record */
export interface DNSResourceRecord {
  name: string
  type: DNSRecordType
  class: DNSClass
  ttl: number
  data: Uint8Array | string
}

/** DNS Message (both query and response) */
export interface DNSMessage {
  id: number
  flags: {
    qr: boolean // Query/Response
    opcode: number
    aa: boolean // Authoritative Answer
    tc: boolean // Truncated
    rd: boolean // Recursion Desired
    ra: boolean // Recursion Available
    rcode: DNSResponseCode
  }
  questions: DNSQuestion[]
  answers: DNSResourceRecord[]
  authority: DNSResourceRecord[]
  additional: DNSResourceRecord[]
}

/** JNS resolution result */
export interface JNSResolution {
  name: string
  node: Hex
  owner: Address
  resolver: Address
  records: {
    contenthash?: Hex
    ipfsHash?: string
    arweaveHash?: string
    workerEndpoint?: string
    addresses: {
      eth?: Address
      btc?: string
    }
    text: Record<string, string>
  }
  ttl: number
  resolvedAt: number
}

/** ENS resolution result */
export interface ENSResolution {
  name: string
  node: Hex
  owner: Address
  resolver: Address
  contenthash?: string
  address?: Address
  text: Record<string, string>
  ttl: number
}

/** Resolution source tracking */
export interface ResolutionSource {
  resolver: ResolverType
  latencyMs: number
  cached: boolean
  upstreamServer?: string
}

/** Full DNS resolution result */
export interface DNSResolutionResult {
  name: string
  records: DNSResourceRecord[]
  source: ResolutionSource
  authenticated: boolean
  dnssecValid?: boolean
}

/** DoH query format */
export interface DoHQuery {
  name: string
  type: DNSRecordType
  dnssecOk?: boolean
  checkingDisabled?: boolean
}

/** DoH response format (JSON) */
export interface DoHResponse {
  Status: DNSResponseCode
  TC: boolean
  RD: boolean
  RA: boolean
  AD: boolean
  CD: boolean
  Question: Array<{
    name: string
    type: DNSRecordType
  }>
  Answer?: Array<{
    name: string
    type: DNSRecordType
    TTL: number
    data: string
  }>
  Authority?: Array<{
    name: string
    type: DNSRecordType
    TTL: number
    data: string
  }>
}

/** DNS mirror target provider */
export interface MirrorTarget {
  provider: 'cloudflare' | 'route53' | 'gcp' | 'namecheap' | 'godaddy'
  apiKey?: string
  apiSecret?: string
  zoneId?: string
  domain: string
}

/** DNS zone configuration */
export interface DNSZone {
  name: string
  type: 'primary' | 'secondary'
  serial: number
  refresh: number
  retry: number
  expire: number
  minimum: number
  nameservers: string[]
  records: DNSResourceRecord[]
}

/** Node DNS capability announcement */
export interface DNSNodeCapability {
  nodeId: Hex
  endpoint: string
  supportedTLDs: string[]
  features: {
    doh: boolean
    dot: boolean
    dnssec: boolean
    jns: boolean
    ens: boolean
  }
  latencyMs: number
  lastSeen: number
}
