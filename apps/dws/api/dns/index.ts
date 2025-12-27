/**
 * Decentralized DNS Module for DWS
 *
 * Provides DNS independence while maintaining ICANN DNS mirroring:
 *
 * 1. DoH (DNS over HTTPS) server - RFC 8484 compliant
 * 2. JNS (Jeju Name Service) resolver - on-chain resolution
 * 3. ENS bridge - mirror from Ethereum Name Service
 * 4. Traditional DNS fallback - for ICANN domains
 * 5. DNS mirroring - push JNS records to traditional DNS
 *
 * Architecture:
 * - DWS nodes run DoH servers
 * - Browser extension or system config points to DoH
 * - .jeju TLD resolved via JNS on-chain
 * - .eth TLD resolved via ENS bridge
 * - All other TLDs fallback to ICANN DNS
 *
 * Note: Individual DNS modules (DoH, JNS, ENS) are implemented
 * separately and will be imported directly when ready.
 */

export * from './types'
