/**
 * SECURITY: Proxy URL validation to prevent SSRF attacks
 *
 * This module provides validation for proxy URLs to prevent:
 * - Access to private/internal IP ranges
 * - Access to localhost and loopback addresses
 * - Access to metadata service endpoints
 * - Non-HTTP(S) protocols
 * - DNS rebinding attacks
 */

import { lookup } from 'node:dns/promises'

/**
 * Check if an IPv4 address is private/internal
 */
function isPrivateIPv4(ip: string): boolean {
  const match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return false

  const octets = match.slice(1).map(Number)
  const [a, b, c, d] = octets

  // Validate octet ranges
  if (octets.some((o) => o > 255 || o < 0)) return true // Invalid = blocked

  // 10.0.0.0/8 - Private
  if (a === 10) return true
  // 172.16.0.0/12 - Private
  if (a === 172 && b >= 16 && b <= 31) return true
  // 192.168.0.0/16 - Private
  if (a === 192 && b === 168) return true
  // 169.254.0.0/16 - Link-local (including metadata service)
  if (a === 169 && b === 254) return true
  // 127.0.0.0/8 - Loopback
  if (a === 127) return true
  // 0.0.0.0/8 - Current network
  if (a === 0) return true
  // 100.64.0.0/10 - Carrier-grade NAT
  if (a === 100 && b >= 64 && b <= 127) return true
  // 192.0.0.0/24 - IETF Protocol Assignments
  if (a === 192 && b === 0 && c === 0) return true
  // 192.0.2.0/24 - TEST-NET-1
  if (a === 192 && b === 0 && c === 2) return true
  // 198.51.100.0/24 - TEST-NET-2
  if (a === 198 && b === 51 && c === 100) return true
  // 203.0.113.0/24 - TEST-NET-3
  if (a === 203 && b === 0 && c === 113) return true
  // 224.0.0.0/4 - Multicast
  if (a >= 224 && a <= 239) return true
  // 240.0.0.0/4 - Reserved for future use
  if (a >= 240) return true
  // 255.255.255.255 - Broadcast
  if (a === 255 && b === 255 && c === 255 && d === 255) return true

  return false
}

/**
 * Normalize IPv6 address for comparison
 */
function normalizeIPv6(ip: string): string {
  // Remove brackets if present
  let normalized = ip.startsWith('[') ? ip.slice(1, -1) : ip
  normalized = normalized.toLowerCase()

  // Expand :: notation
  if (normalized.includes('::')) {
    const parts = normalized.split('::')
    const left = parts[0] ? parts[0].split(':') : []
    const right = parts[1] ? parts[1].split(':') : []
    const missing = 8 - left.length - right.length
    const middle = Array(missing).fill('0')
    normalized = [...left, ...middle, ...right].join(':')
  }

  // Normalize each segment
  const segments = normalized.split(':')
  return segments.map((s) => s.padStart(4, '0')).join(':')
}

/**
 * Check if an IPv6 address is private/internal
 */
function isPrivateIPv6(ip: string): boolean {
  const normalized = normalizeIPv6(ip)
  const segments = normalized.split(':')

  // ::1 - Loopback
  if (normalized === '0000:0000:0000:0000:0000:0000:0000:0001') return true

  // :: (all zeros) - Unspecified
  if (segments.every((s) => s === '0000')) return true

  // fe80::/10 - Link-local
  const first = parseInt(segments[0], 16)
  if (first >= 0xfe80 && first <= 0xfebf) return true

  // fc00::/7 - Unique local (ULA)
  if (first >= 0xfc00 && first <= 0xfdff) return true

  // ::ffff:0:0/96 - IPv4-mapped IPv6 (check the embedded IPv4)
  if (
    segments[5] === 'ffff' &&
    segments.slice(0, 5).every((s) => s === '0000')
  ) {
    // Last 32 bits are IPv4
    const ipv4High = parseInt(segments[6], 16)
    const ipv4Low = parseInt(segments[7], 16)
    const ipv4 = `${(ipv4High >> 8) & 0xff}.${ipv4High & 0xff}.${(ipv4Low >> 8) & 0xff}.${ipv4Low & 0xff}`
    return isPrivateIPv4(ipv4)
  }

  // ::ffff:0.0.0.0/96 alternative notation (with IPv4 suffix)
  if (ip.includes('.')) {
    const ipv4Match = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
    if (ipv4Match) {
      return isPrivateIPv4(ipv4Match[1])
    }
  }

  // fd00:ec2::254 - AWS IPv6 metadata
  if (normalized.startsWith('fd00:0ec2:')) return true

  // ff00::/8 - Multicast
  if (first >= 0xff00) return true

  return false
}

/**
 * Validate a proxy URL to prevent SSRF attacks
 * Throws an error if the URL is not safe to proxy
 */
export function validateProxyUrl(urlString: string): void {
  const url = new URL(urlString)

  // Only allow HTTP and HTTPS
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `Invalid protocol: ${url.protocol}. Only HTTP and HTTPS are allowed.`,
    )
  }

  const hostname = url.hostname.toLowerCase()

  // Block localhost variations
  const localhostPatterns = [
    'localhost',
    '127.0.0.1',
    '::1',
    '0.0.0.0',
    '[::1]',
    '[::ffff:127.0.0.1]',
  ]
  if (localhostPatterns.some((p) => hostname === p)) {
    throw new Error('Access to localhost is not allowed')
  }

  // Block internal network hostnames
  const internalPatterns = [
    '.local',
    '.internal',
    '.corp',
    '.lan',
    '.intranet',
    '.localhost',
    '.home',
    '.private',
  ]
  if (internalPatterns.some((p) => hostname.endsWith(p))) {
    throw new Error('Access to internal network is not allowed')
  }

  // Check if hostname is already an IP and validate it
  const ipv4Match = hostname.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  )
  if (ipv4Match) {
    if (isPrivateIPv4(hostname)) {
      throw new Error('Access to private/internal IP addresses is not allowed')
    }
    return // IP is validated, we're done
  }

  // Check if it's an IPv6 address
  if (hostname.startsWith('[') || hostname.includes(':')) {
    if (isPrivateIPv6(hostname)) {
      throw new Error(
        'Access to private/internal IPv6 addresses is not allowed',
      )
    }
    return // IP is validated, we're done
  }

  // Block cloud metadata service endpoints
  const metadataEndpoints = [
    '169.254.169.254', // AWS/GCP metadata
    'metadata.google.internal', // GCP metadata
    'metadata.azure.com', // Azure metadata
    '169.254.170.2', // AWS ECS task metadata
    'fd00:ec2::254', // AWS IPv6 metadata
    'instance-data', // Generic metadata
    'metadata', // Generic metadata
  ]
  if (metadataEndpoints.includes(hostname)) {
    throw new Error('Access to cloud metadata service is not allowed')
  }
}

/**
 * SECURITY: Validate URL and perform DNS resolution to prevent DNS rebinding attacks
 * This should be called immediately before making the actual request
 * Returns the validated IP address to use for the connection
 */
export async function validateProxyUrlWithDNS(
  urlString: string,
): Promise<{ url: URL; resolvedIP: string }> {
  // First do basic validation
  validateProxyUrl(urlString)

  const url = new URL(urlString)
  const hostname = url.hostname.toLowerCase()

  // If already an IP, no DNS needed
  if (hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)) {
    return { url, resolvedIP: hostname }
  }
  if (hostname.startsWith('[') || hostname.includes(':')) {
    const ipv6 = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname
    return { url, resolvedIP: ipv6 }
  }

  // Resolve DNS and validate the resolved IP
  let addresses: string[]
  try {
    const result = await lookup(hostname, { all: true })
    addresses = result.map((r) => r.address)
  } catch {
    throw new Error(`DNS resolution failed for ${hostname}`)
  }

  if (addresses.length === 0) {
    throw new Error(`No DNS records found for ${hostname}`)
  }

  // SECURITY: Validate ALL resolved IPs to prevent DNS rebinding
  for (const addr of addresses) {
    if (addr.includes(':')) {
      // IPv6
      if (isPrivateIPv6(addr)) {
        throw new Error(
          `DNS rebinding detected: ${hostname} resolves to private IPv6 ${addr}`,
        )
      }
    } else {
      // IPv4
      if (isPrivateIPv4(addr)) {
        throw new Error(
          `DNS rebinding detected: ${hostname} resolves to private IP ${addr}`,
        )
      }
    }
  }

  // Return the first validated IP
  return { url, resolvedIP: addresses[0] }
}
