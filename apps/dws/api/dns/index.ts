/**
 * Decentralized DNS Gateway
 *
 * Provides decentralized DNS resolution for JNS (Jeju Name Service) names.
 * Compatible with:
 * - eth.link gateway pattern (name.jeju.link)
 * - Direct HTTP resolution
 * - DNS-over-HTTPS (DoH)
 * - IPFS/IPNS resolution
 *
 * This enables browser-native access to decentralized apps without extensions.
 */

export { type CertConfig, CertificateManager } from './certificate-manager'
export { ContentRouter, type ContentSource } from './content-router'
export { DNSGateway, type DNSGatewayConfig } from './gateway'
export { type JNSRecord, JNSResolver } from './resolver'
export { createDNSRouter } from './router'
