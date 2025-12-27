/**
 * DNS Module - DNS-over-HTTPS (DoH) and DNS-over-TLS (DoT) Server
 *
 * Provides decentralized DNS resolution for:
 * - .jns domains via on-chain JNS (Jeju Name Service) resolution
 * - Standard domains via upstream DNS forwarding (Cloudflare, Google, etc.)
 *
 * RFC Compliance:
 * - RFC 8484: DNS over HTTPS (DoH)
 * - RFC 7858: DNS over TLS (DoT) [TODO]
 * - RFC 1035: DNS wire format
 * - EIP-1577: Content hash encoding for ENS/JNS
 *
 * Integration:
 * - JNSRegistry: On-chain name registry
 * - JNSResolver: Content hash resolution
 * - CDNRegistry: Edge node discovery
 * - ModerationRegistry: Banned domain checking
 */

// DoH Server
export {
  createDoHRouter,
  DoHServer,
  getDoHServer,
  initializeDoHServer,
  shutdownDoHServer,
} from './doh-server'
// JNS Resolver
export {
  getJNSResolver,
  initializeJNSResolver,
  JNSResolver,
} from './jns-resolver'
// Types
export {
  createDefaultDNSConfig,
  type DNSCacheEntry,
  type DNSConfig,
  type DNSMessage,
  type DNSQuestion,
  DNSRecordType,
  type DNSResourceRecord,
  DNSResponseCode,
  type DNSStats,
  type EdgeNodeSelection,
  type JNSDomainModeration,
  type JNSResolutionResult,
} from './types'

// Upstream DNS Forwarder
export {
  getUpstreamForwarder,
  shutdownUpstreamForwarder,
  UpstreamDNSForwarder,
} from './upstream'
// Wire format encoder/decoder
export {
  createDNSResponse,
  createNXDOMAINResponse,
  createSERVFAILResponse,
  decodeDNSMessage,
  encodeDNSMessage,
  validateDNSMessage,
} from './wire-format'
