/** Proxy URL validation to prevent SSRF attacks
 *
 * Workerd-compatible: Uses fetch for DNS resolution instead of node:dns
 */

function isPrivateIPv4(ip: string): boolean {
  const match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return false

  const octets = match.slice(1).map(Number)
  const [a, b, c, d] = octets

  // Validate octet ranges
  if (octets.some((o) => o > 255 || o < 0)) return true // Invalid = blocked

  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 127) return true
  if (a === 0) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 192 && b === 0 && c === 0) return true
  if (a === 192 && b === 0 && c === 2) return true
  if (a === 198 && b === 51 && c === 100) return true
  if (a === 203 && b === 0 && c === 113) return true
  if (a >= 224 && a <= 239) return true
  if (a >= 240) return true
  if (a === 255 && b === 255 && c === 255 && d === 255) return true

  return false
}

function normalizeIPv6(ip: string): string {
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

function isPrivateIPv6(ip: string): boolean {
  const normalized = normalizeIPv6(ip)
  const segments = normalized.split(':')

  if (normalized === '0000:0000:0000:0000:0000:0000:0000:0001') return true
  if (segments.every((s) => s === '0000')) return true

  const first = parseInt(segments[0], 16)
  if (first >= 0xfe80 && first <= 0xfebf) return true
  if (first >= 0xfc00 && first <= 0xfdff) return true

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

  if (ip.includes('.')) {
    const ipv4Match = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
    if (ipv4Match) {
      return isPrivateIPv4(ipv4Match[1])
    }
  }

  if (normalized.startsWith('fd00:0ec2:')) return true
  if (first >= 0xff00) return true

  return false
}

export function validateProxyUrl(urlString: string): void {
  const url = new URL(urlString)

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `Invalid protocol: ${url.protocol}. Only HTTP and HTTPS are allowed.`,
    )
  }

  const hostname = url.hostname.toLowerCase()

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

  const ipv4Match = hostname.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  )
  if (ipv4Match) {
    if (isPrivateIPv4(hostname)) {
      throw new Error('Access to private/internal IP addresses is not allowed')
    }
    return
  }

  if (hostname.startsWith('[') || hostname.includes(':')) {
    if (isPrivateIPv6(hostname)) {
      throw new Error(
        'Access to private/internal IPv6 addresses is not allowed',
      )
    }
    return
  }

  const metadataEndpoints = [
    '169.254.169.254',
    'metadata.google.internal',
    'metadata.azure.com',
    '169.254.170.2',
    'fd00:ec2::254',
    'instance-data',
    'metadata',
  ]
  if (metadataEndpoints.includes(hostname)) {
    throw new Error('Access to cloud metadata service is not allowed')
  }
}

export async function validateProxyUrlWithDNS(
  urlString: string,
): Promise<{ url: URL; resolvedIP: string }> {
  validateProxyUrl(urlString)

  const url = new URL(urlString)
  const hostname = url.hostname.toLowerCase()

  if (hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)) {
    return { url, resolvedIP: hostname }
  }
  if (hostname.startsWith('[') || hostname.includes(':')) {
    const ipv6 = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname
    return { url, resolvedIP: ipv6 }
  }

  // Workerd-compatible DNS resolution using fetch
  // Try to resolve via DNS-over-HTTPS or use DWS exec API
  let addresses: string[]
  try {
    // Use DNS-over-HTTPS for workerd compatibility
    const dohUrl = `https://cloudflare-dns.com/dns-query?name=${hostname}&type=A&type=AAAA`
    const response = await fetch(dohUrl, {
      headers: { Accept: 'application/dns-json' },
    })
    if (!response.ok) {
      throw new Error(`DNS resolution failed: ${response.statusText}`)
    }
    const data = (await response.json()) as {
      Answer?: Array<{ data: string; type: number }>
    }
    addresses =
      data.Answer?.filter((r) => r.type === 1 || r.type === 28).map(
        (r) => r.data,
      ) ?? []
  } catch {
    throw new Error(`DNS resolution failed for ${hostname}`)
  }

  if (addresses.length === 0) {
    throw new Error(`No DNS records found for ${hostname}`)
  }

  for (const addr of addresses) {
    if (addr.includes(':')) {
      if (isPrivateIPv6(addr)) {
        throw new Error(
          `DNS rebinding detected: ${hostname} resolves to private IPv6 ${addr}`,
        )
      }
    } else {
      if (isPrivateIPv4(addr)) {
        throw new Error(
          `DNS rebinding detected: ${hostname} resolves to private IP ${addr}`,
        )
      }
    }
  }

  return { url, resolvedIP: addresses[0] }
}
