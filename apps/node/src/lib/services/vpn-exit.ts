import { type ChildProcess, spawn } from 'node:child_process'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import * as dgram from 'node:dgram'
import { EventEmitter } from 'node:events'
import * as net from 'node:net'
import { Counter, Gauge, Histogram, Registry } from 'prom-client'
import type { Address } from 'viem'
import { z } from 'zod'
import { getChain, type NodeClient } from '../contracts'

// WireGuard Protocol Constants

const WG_CONSTRUCTION = 'Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s'
const WG_IDENTIFIER = 'WireGuard v1 zx2c4 Jason@zx2c4.com'
const WG_LABEL_MAC1 = 'mac1----'
const WG_LABEL_COOKIE = 'cookie--'

// Message types
const MSG_HANDSHAKE_INITIATION = 1
const MSG_HANDSHAKE_RESPONSE = 2
const MSG_COOKIE_REPLY = 3
const MSG_TRANSPORT_DATA = 4

// Sizes
const TAG_SIZE = 16
const COOKIE_SIZE = 16

// DoS protection thresholds
const DOS_THRESHOLD_PACKETS_PER_SECOND = 100
const DOS_THRESHOLD_HANDSHAKES_PER_SECOND = 10
const COOKIE_REFRESH_INTERVAL = 120000 // 2 minutes

// IP/TCP/UDP Checksum Functions

/**
 * Calculate IP header checksum (RFC 1071)
 */
function calculateIPChecksum(header: Uint8Array): number {
  let sum = 0
  const len = header.length

  // Sum all 16-bit words, skipping the checksum field (bytes 10-11)
  for (let i = 0; i < len; i += 2) {
    if (i === 10) continue // Skip existing checksum field

    const high = header[i]
    const low = i + 1 < len ? header[i + 1] : 0
    sum += (high << 8) | low
  }

  // Fold 32-bit sum to 16 bits
  while (sum >> 16) {
    sum = (sum & 0xffff) + (sum >> 16)
  }

  return ~sum & 0xffff
}

/**
 * Calculate TCP/UDP checksum with pseudo-header
 */
function calculateTransportChecksum(
  srcIP: Uint8Array,
  dstIP: Uint8Array,
  protocol: number,
  transportData: Uint8Array,
): number {
  let sum = 0

  // Pseudo-header
  sum += (srcIP[0] << 8) | srcIP[1]
  sum += (srcIP[2] << 8) | srcIP[3]
  sum += (dstIP[0] << 8) | dstIP[1]
  sum += (dstIP[2] << 8) | dstIP[3]
  sum += protocol
  sum += transportData.length

  // Transport header + data
  for (let i = 0; i < transportData.length; i += 2) {
    if (i + 1 < transportData.length) {
      sum += (transportData[i] << 8) | transportData[i + 1]
    } else {
      sum += transportData[i] << 8 // Odd byte
    }
  }

  // Fold and complement
  while (sum >> 16) {
    sum = (sum & 0xffff) + (sum >> 16)
  }

  return ~sum & 0xffff
}

/**
 * Modify packet for NAT and recalculate checksums
 */
function natModifyPacket(
  packet: Uint8Array,
  newSrcIP: string,
  newSrcPort: number,
): Uint8Array {
  const modified = new Uint8Array(packet)
  const headerLength = (modified[0] & 0x0f) * 4
  const protocol = modified[9]

  // Parse new source IP
  const newIP = newSrcIP.split('.').map(Number)

  // Modify source IP in IP header
  modified[12] = newIP[0]
  modified[13] = newIP[1]
  modified[14] = newIP[2]
  modified[15] = newIP[3]

  // Recalculate IP checksum
  const ipChecksum = calculateIPChecksum(modified.subarray(0, headerLength))
  modified[10] = (ipChecksum >> 8) & 0xff
  modified[11] = ipChecksum & 0xff

  // Modify source port and recalculate transport checksum
  if (protocol === 6 || protocol === 17) {
    // TCP or UDP
    // Modify source port
    modified[headerLength] = (newSrcPort >> 8) & 0xff
    modified[headerLength + 1] = newSrcPort & 0xff

    // Clear existing checksum
    const checksumOffset = protocol === 6 ? headerLength + 16 : headerLength + 6
    modified[checksumOffset] = 0
    modified[checksumOffset + 1] = 0

    // Calculate new checksum
    const srcIPBytes = modified.subarray(12, 16)
    const dstIPBytes = modified.subarray(16, 20)
    const transportData = modified.subarray(headerLength)

    const newChecksum = calculateTransportChecksum(
      srcIPBytes,
      dstIPBytes,
      protocol,
      transportData,
    )
    modified[checksumOffset] = (newChecksum >> 8) & 0xff
    modified[checksumOffset + 1] = newChecksum & 0xff
  }

  return modified
}

/**
 * Reverse NAT modification for incoming packets
 */
function natReverseModifyPacket(
  packet: Uint8Array,
  newDstIP: string,
  newDstPort: number,
): Uint8Array {
  const modified = new Uint8Array(packet)
  const headerLength = (modified[0] & 0x0f) * 4
  const protocol = modified[9]

  // Parse new destination IP
  const newIP = newDstIP.split('.').map(Number)

  // Modify destination IP in IP header
  modified[16] = newIP[0]
  modified[17] = newIP[1]
  modified[18] = newIP[2]
  modified[19] = newIP[3]

  // Recalculate IP checksum
  const ipChecksum = calculateIPChecksum(modified.subarray(0, headerLength))
  modified[10] = (ipChecksum >> 8) & 0xff
  modified[11] = ipChecksum & 0xff

  // Modify destination port and recalculate transport checksum
  if (protocol === 6 || protocol === 17) {
    // TCP or UDP
    // Modify destination port
    modified[headerLength + 2] = (newDstPort >> 8) & 0xff
    modified[headerLength + 3] = newDstPort & 0xff

    // Clear existing checksum
    const checksumOffset = protocol === 6 ? headerLength + 16 : headerLength + 6
    modified[checksumOffset] = 0
    modified[checksumOffset + 1] = 0

    // Calculate new checksum
    const srcIPBytes = modified.subarray(12, 16)
    const dstIPBytes = modified.subarray(16, 20)
    const transportData = modified.subarray(headerLength)

    const newChecksum = calculateTransportChecksum(
      srcIPBytes,
      dstIPBytes,
      protocol,
      transportData,
    )
    modified[checksumOffset] = (newChecksum >> 8) & 0xff
    modified[checksumOffset + 1] = newChecksum & 0xff
  }

  return modified
}

// Configuration Schema

const VPNExitConfigSchema = z.object({
  listenPort: z.number().min(1024).max(65535).default(51820),
  privateKey: z.string().min(32).optional(),
  endpoint: z.string(),
  countryCode: z.string().length(2),
  regionCode: z.string().optional(),
  maxClients: z.number().min(1).max(1000).default(100),
  bandwidthLimitMbps: z.number().min(1).default(100),
  stakeAmount: z.bigint(),
  coordinatorUrl: z.string().url().optional(),
  enableCDN: z.boolean().default(true),
  metricsPort: z.number().optional(),
  tunnelSubnet: z.string().default('10.8.0.0/24'),
  tunnelInterface: z.string().default('wg0'),
  mtu: z.number().default(1420),
  persistentKeepalive: z.number().default(25),
  // Rate limiting
  rateLimitBytesPerSecond: z.number().default(10 * 1024 * 1024), // 10 MB/s default
  rateLimitBurst: z.number().default(50 * 1024 * 1024), // 50 MB burst
  // NAT
  natEnabled: z.boolean().default(true),
  natTimeout: z.number().default(300000), // 5 minutes
  // DoS protection
  dosProtectionEnabled: z.boolean().default(true),
})

export type VPNExitConfig = z.infer<typeof VPNExitConfigSchema>

// Types

export interface VPNExitState {
  isRegistered: boolean
  nodeId: `0x${string}`
  countryCode: string
  status: 'online' | 'busy' | 'offline' | 'suspended'
  activeClients: number
  totalSessions: number
  totalBytesServed: bigint
  earnings: bigint
}

export interface VPNClient {
  clientId: string
  publicKey: Uint8Array
  assignedIP: string
  connectedAt: number
  bytesUp: bigint
  bytesDown: bigint
  lastSeen: number
  endpoint: { address: string; port: number } | null
  rateLimiter: TokenBucketRateLimiter
}

export interface VPNSession {
  sessionId: string
  clientId: string
  nodeId: string
  startTime: number
  endTime?: number
  bytesUp: bigint
  bytesDown: bigint
  successful: boolean
}

interface WireGuardPeer {
  publicKey: Uint8Array
  presharedKey: Uint8Array
  allowedIPs: string[]
  endpoint: { address: string; port: number } | null
  lastHandshake: number
  txBytes: bigint
  rxBytes: bigint
  sendCounter: bigint
  receiveCounter: bigint
  sendKey: Uint8Array | null
  receiveKey: Uint8Array | null
  senderIndex: number
  receiverIndex: number
  rateLimiter: TokenBucketRateLimiter
  lastCookieTime: number
  cookie: Uint8Array | null
}

// NAT connection tracking entry
interface NATEntry {
  internalIP: string
  internalPort: number
  externalIP: string
  externalPort: number
  protocol: 'tcp' | 'udp' | 'icmp'
  peerIndex: number
  createdAt: number
  lastActivity: number
  state: 'new' | 'established' | 'closing' | 'closed'
}

// DoS protection state
interface DoSState {
  packetsPerSecond: number
  handshakesPerSecond: number
  lastReset: number
  underAttack: boolean
  cookieSecret: Uint8Array
  lastCookieRotation: number
}

// Token Bucket Rate Limiter

class TokenBucketRateLimiter {
  private tokens: number
  private lastRefill: number
  private readonly capacity: number
  private readonly refillRate: number // tokens per millisecond

  constructor(bytesPerSecond: number, burstBytes: number) {
    this.capacity = burstBytes
    this.tokens = burstBytes
    this.refillRate = bytesPerSecond / 1000
    this.lastRefill = Date.now()
  }

  /**
   * Try to consume tokens for a packet
   * @returns true if allowed, false if rate limited
   */
  consume(bytes: number): boolean {
    this.refill()
    if (this.tokens >= bytes) {
      this.tokens -= bytes
      return true
    }
    return false
  }

  /**
   * Check if a packet would be allowed without consuming
   */
  canConsume(bytes: number): boolean {
    this.refill()
    return this.tokens >= bytes
  }

  /**
   * Get current token count
   */
  getTokens(): number {
    this.refill()
    return this.tokens
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    const newTokens = elapsed * this.refillRate
    this.tokens = Math.min(this.capacity, this.tokens + newTokens)
    this.lastRefill = now
  }
}

// NAT Table

class NATTable {
  private entries = new Map<string, NATEntry>()
  private portCounter = 32768 // Start of ephemeral port range
  private readonly timeout: number
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(timeoutMs: number = 300000) {
    this.timeout = timeoutMs
  }

  start(): void {
    // Cleanup stale entries every 30 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 30000)
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.entries.clear()
  }

  /**
   * Create or find NAT mapping for outbound packet
   */
  translate(
    internalIP: string,
    internalPort: number,
    protocol: 'tcp' | 'udp' | 'icmp',
    peerIndex: number,
  ): { externalIP: string; externalPort: number } {
    const key = this.makeKey(internalIP, internalPort, protocol)

    let entry = this.entries.get(key)
    if (entry) {
      entry.lastActivity = Date.now()
      return { externalIP: entry.externalIP, externalPort: entry.externalPort }
    }

    // Create new mapping
    const externalPort = this.allocatePort()
    entry = {
      internalIP,
      internalPort,
      externalIP: '0.0.0.0', // Will be set to actual external IP
      externalPort,
      protocol,
      peerIndex,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      state: 'new',
    }

    this.entries.set(key, entry)

    // Also create reverse mapping for incoming packets
    const reverseKey = this.makeReverseKey(externalPort, protocol)
    this.entries.set(reverseKey, entry)

    return { externalIP: entry.externalIP, externalPort }
  }

  /**
   * Find NAT mapping for inbound packet
   */
  reverseTranslate(
    externalPort: number,
    protocol: 'tcp' | 'udp' | 'icmp',
  ): NATEntry | null {
    const key = this.makeReverseKey(externalPort, protocol)
    const entry = this.entries.get(key)
    if (entry) {
      entry.lastActivity = Date.now()
      return entry
    }
    return null
  }

  /**
   * Update connection state (for TCP)
   */
  updateState(
    internalIP: string,
    internalPort: number,
    protocol: 'tcp' | 'udp' | 'icmp',
    state: NATEntry['state'],
  ): void {
    const key = this.makeKey(internalIP, internalPort, protocol)
    const entry = this.entries.get(key)
    if (entry) {
      entry.state = state
    }
  }

  /**
   * Get all entries for a peer
   */
  getEntriesForPeer(peerIndex: number): NATEntry[] {
    return Array.from(this.entries.values()).filter(
      (e) => e.peerIndex === peerIndex,
    )
  }

  /**
   * Remove all entries for a peer
   */
  removeEntriesForPeer(peerIndex: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.peerIndex === peerIndex) {
        this.entries.delete(key)
      }
    }
  }

  getStats(): { total: number; tcp: number; udp: number; icmp: number } {
    let tcp = 0,
      udp = 0,
      icmp = 0
    for (const entry of this.entries.values()) {
      switch (entry.protocol) {
        case 'tcp':
          tcp++
          break
        case 'udp':
          udp++
          break
        case 'icmp':
          icmp++
          break
      }
    }
    return {
      total: this.entries.size / 2,
      tcp: tcp / 2,
      udp: udp / 2,
      icmp: icmp / 2,
    }
  }

  private makeKey(ip: string, port: number, protocol: string): string {
    return `out:${protocol}:${ip}:${port}`
  }

  private makeReverseKey(port: number, protocol: string): string {
    return `in:${protocol}:${port}`
  }

  private allocatePort(): number {
    const maxAttempts = 28232 // 60999 - 32768 + 1 = full ephemeral range
    let attempts = 0

    while (attempts < maxAttempts) {
      const port = this.portCounter++
      if (this.portCounter > 60999) {
        this.portCounter = 32768
      }

      // Check if port is already in use (check both TCP and UDP reverse mappings)
      const tcpKey = this.makeReverseKey(port, 'tcp')
      const udpKey = this.makeReverseKey(port, 'udp')

      if (!this.entries.has(tcpKey) && !this.entries.has(udpKey)) {
        return port
      }

      attempts++
    }

    throw new Error(
      'NAT port exhaustion: no available ports in ephemeral range',
    )
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.entries) {
      if (now - entry.lastActivity > this.timeout) {
        this.entries.delete(key)
      }
    }
  }
}

// TUN Device Manager

class TUNDevice extends EventEmitter {
  private readProcess: ChildProcess | null = null
  private readonly interfaceName: string
  private readonly subnet: string
  private readonly mtu: number
  private running = false
  private serverIP: string = ''

  constructor(interfaceName: string, subnet: string, mtu: number) {
    super()
    this.interfaceName = interfaceName
    this.subnet = subnet
    this.mtu = mtu
  }

  async start(): Promise<void> {
    if (this.running) return

    const [baseIP, mask] = this.subnet.split('/')
    this.serverIP = baseIP.replace(/\.0$/, '.1')

    // Create TUN interface using ip command (requires root)
    try {
      // First try to delete any existing interface
      await this.execCommand('ip', [
        'link',
        'delete',
        this.interfaceName,
      ]).catch(() => {})

      // Create the TUN interface
      await this.execCommand('ip', [
        'tuntap',
        'add',
        'dev',
        this.interfaceName,
        'mode',
        'tun',
      ])
      await this.execCommand('ip', [
        'addr',
        'add',
        `${this.serverIP}/${mask}`,
        'dev',
        this.interfaceName,
      ])
      await this.execCommand('ip', [
        'link',
        'set',
        'dev',
        this.interfaceName,
        'mtu',
        this.mtu.toString(),
      ])
      await this.execCommand('ip', [
        'link',
        'set',
        'dev',
        this.interfaceName,
        'up',
      ])

      // Enable IP forwarding
      await this.execCommand('sysctl', ['-w', 'net.ipv4.ip_forward=1'])

      // Setup NAT with iptables
      await this.execCommand('iptables', [
        '-t',
        'nat',
        '-A',
        'POSTROUTING',
        '-s',
        this.subnet,
        '-o',
        'eth0',
        '-j',
        'MASQUERADE',
      ]).catch(() => {
        // Try without specifying output interface
        return this.execCommand('iptables', [
          '-t',
          'nat',
          '-A',
          'POSTROUTING',
          '-s',
          this.subnet,
          '-j',
          'MASQUERADE',
        ])
      })
      await this.execCommand('iptables', [
        '-A',
        'FORWARD',
        '-i',
        this.interfaceName,
        '-j',
        'ACCEPT',
      ])
      await this.execCommand('iptables', [
        '-A',
        'FORWARD',
        '-o',
        this.interfaceName,
        '-m',
        'state',
        '--state',
        'RELATED,ESTABLISHED',
        '-j',
        'ACCEPT',
      ])

      this.running = true
      console.log(
        `[TUN] Interface ${this.interfaceName} created with IP ${this.serverIP}/${mask}`,
      )

      // Open TUN device for reading/writing
      await this.openTunDevice()
    }
  }

  private async openTunDevice(): Promise<void> {
    // Start packet capture using tcpdump with raw packet output
    // -dd outputs packet data in a format we can parse
    const tcpdump = spawn(
      'tcpdump',
      [
        '-i',
        this.interfaceName,
        '-l', // Line-buffered output
        '-n', // Don't resolve hostnames
        '-s',
        '0', // Capture full packets
        '-X', // Print packet data in hex and ASCII
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    // Buffer for accumulating partial packets
    let packetBuffer = Buffer.alloc(0)

    tcpdump.stdout?.on('data', (data: Buffer) => {
      // tcpdump -X outputs hex dumps - parse them
      const lines = data.toString().split('\n')
      for (const line of lines) {
        // Look for hex data lines (start with offset like "0x0000:")
        const hexMatch = line.match(/^\s*0x[\da-f]+:\s+([\da-f\s]+)/i)
        if (hexMatch) {
          const hexStr = hexMatch[1].replace(/\s+/g, '')
          const bytes = Buffer.from(hexStr, 'hex')
          packetBuffer = Buffer.concat([packetBuffer, bytes])
        } else if (packetBuffer.length > 0 && line.trim() === '') {
          // Empty line signals end of packet
          if (packetBuffer.length >= 20) {
            this.emit('inbound', new Uint8Array(packetBuffer))
          }
          packetBuffer = Buffer.alloc(0)
        }
      }
    })

    tcpdump.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString()
      if (!msg.includes('listening on') && !msg.includes('packets captured')) {
        console.warn('[TUN] tcpdump:', msg.trim())
      }
    })

    tcpdump.on('error', (err) => {
      console.warn('[TUN] tcpdump error:', err.message)
    })

    tcpdump.on('close', (code) => {
      if (this.running && code !== 0) {
        console.warn(`[TUN] tcpdump exited with code ${code}`)
      }
    })

    this.readProcess = tcpdump
    console.log('[TUN] Packet capture started')
  }

  async stop(): Promise<void> {
    if (!this.running) return

    this.running = false

    if (this.readProcess) {
      this.readProcess.kill('SIGTERM')
      this.readProcess = null
    }

    // Remove iptables rules
    try {
      await this.execCommand('iptables', [
        '-t',
        'nat',
        '-D',
        'POSTROUTING',
        '-s',
        this.subnet,
        '-j',
        'MASQUERADE',
      ])
      await this.execCommand('iptables', [
        '-D',
        'FORWARD',
        '-i',
        this.interfaceName,
        '-j',
        'ACCEPT',
      ])
      await this.execCommand('iptables', [
        '-D',
        'FORWARD',
        '-o',
        this.interfaceName,
        '-m',
        'state',
        '--state',
        'RELATED,ESTABLISHED',
        '-j',
        'ACCEPT',
      ])
    } catch {
      // Ignore errors when removing rules
    }

    // Delete TUN interface
    try {
      await this.execCommand('ip', ['link', 'delete', this.interfaceName])
    } catch {
      // Ignore errors
    }

    console.log(`[TUN] Interface ${this.interfaceName} destroyed`)
  }

  /**
   * Write a packet to the TUN device (to be sent to the internet)
   * Uses the kernel's routing table via socket forwarding
   */
  write(packet: Uint8Array): void {
    if (!this.running || packet.length < 20) return

    const protocol = packet[9]

    // Forward packet based on protocol
    // The kernel will route it through the correct interface
    if (protocol === 17) {
      // UDP
      this.forwardUDP(packet)
    } else if (protocol === 6) {
      // TCP
      this.forwardTCP(packet)
    } else if (protocol === 1) {
      // ICMP
      this.forwardICMP(packet)
    }

    this.emit('outbound', packet)
  }

  private forwardUDP(packet: Uint8Array): void {
    const headerLength = (packet[0] & 0x0f) * 4
    if (packet.length < headerLength + 8) return

    const dstIP = `${packet[16]}.${packet[17]}.${packet[18]}.${packet[19]}`
    const dstPort = (packet[headerLength + 2] << 8) | packet[headerLength + 3]
    const payload = packet.slice(headerLength + 8)

    const socket = dgram.createSocket('udp4')
    socket.send(Buffer.from(payload), dstPort, dstIP, (err) => {
      socket.close()
      if (err) console.warn('[TUN] UDP forward error:', err.message)
    })
  }

  private forwardTCP(packet: Uint8Array): void {
    const headerLength = (packet[0] & 0x0f) * 4
    if (packet.length < headerLength + 20) return

    const dstIP = `${packet[16]}.${packet[17]}.${packet[18]}.${packet[19]}`
    const dstPort = (packet[headerLength + 2] << 8) | packet[headerLength + 3]
    const tcpHeaderLength = ((packet[headerLength + 12] >> 4) & 0x0f) * 4
    const payload = packet.slice(headerLength + tcpHeaderLength)

    // TCP requires connection state - use net.Socket
    const socket = new net.Socket()
    socket.setTimeout(5000)
    socket.connect(dstPort, dstIP, () => {
      if (payload.length > 0) {
        socket.write(Buffer.from(payload))
      }
    })
    socket.on('data', (data: Buffer) => {
      // Response data would need to be routed back through the tunnel
      this.emit('tcp_response', { dstIP, dstPort, data: new Uint8Array(data) })
    })
    socket.on('error', (err) => {
      console.warn('[TUN] TCP forward error:', err.message)
    })
    socket.on('timeout', () => {
      socket.destroy()
    })
  }

  private forwardICMP(packet: Uint8Array): void {
    // ICMP requires raw sockets which need CAP_NET_RAW
    // Use ping command for echo requests (requires CAP_NET_RAW)
    const dstIP = `${packet[16]}.${packet[17]}.${packet[18]}.${packet[19]}`
    const icmpType = packet[20]

    if (icmpType === 8) {
      // Echo request
      const ping = spawn('ping', ['-c', '1', '-W', '1', dstIP], {
        stdio: 'ignore',
      })
      ping.on('close', (code) => {
        // Emit response for successful ping
        if (code === 0) {
          this.emit('icmp_response', { dstIP, success: true })
        }
      })
    }
  }

  private execCommand(cmd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { stdio: 'ignore' })
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else
          reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`))
      })
      proc.on('error', reject)
    })
  }
}

// VPN Registry ABI

const VPN_REGISTRY_ABI = [
  'function register(bytes2 countryCode, bytes32 regionHash, string endpoint, string wireguardPubKey, tuple(bool supportsWireGuard, bool supportsSOCKS5, bool supportsHTTPConnect, bool servesCDN, bool isVPNExit) capabilities) external payable',
  'function getNode(address operator) external view returns (tuple(address operator, bytes2 countryCode, bytes32 regionHash, string endpoint, string wireguardPubKey, uint256 stake, uint256 registeredAt, uint256 lastSeen, tuple(bool supportsWireGuard, bool supportsSOCKS5, bool supportsHTTPConnect, bool servesCDN, bool isVPNExit) capabilities, bool active, uint256 totalBytesServed, uint256 totalSessions, uint256 successfulSessions))',
  'function heartbeat() external',
  'function recordSession(address nodeAddr, address client, uint256 bytesServed, bool successful) external',
  'function isActive(address operator) external view returns (bool)',
  'function allowedCountries(bytes2 countryCode) external view returns (bool)',
  'function blockedCountries(bytes2 countryCode) external view returns (bool)',
] as const

// Prometheus Metrics

const metricsRegistry = new Registry()

const vpnClientsTotal = new Gauge({
  name: 'vpn_exit_clients_total',
  help: 'Total active VPN clients',
  registers: [metricsRegistry],
})

const vpnSessionsTotal = new Counter({
  name: 'vpn_exit_sessions_total',
  help: 'Total VPN sessions',
  labelNames: ['status'],
  registers: [metricsRegistry],
})

const vpnBytesTotal = new Counter({
  name: 'vpn_exit_bytes_total',
  help: 'Total bytes transferred',
  labelNames: ['direction'],
  registers: [metricsRegistry],
})

const vpnSessionDuration = new Histogram({
  name: 'vpn_exit_session_duration_seconds',
  help: 'VPN session duration',
  buckets: [60, 300, 600, 1800, 3600, 7200, 14400],
  registers: [metricsRegistry],
})

const vpnHandshakesTotal = new Counter({
  name: 'vpn_exit_handshakes_total',
  help: 'Total WireGuard handshakes',
  labelNames: ['status'],
  registers: [metricsRegistry],
})

const vpnPacketsTotal = new Counter({
  name: 'vpn_exit_packets_total',
  help: 'Total packets processed',
  labelNames: ['type', 'direction'],
  registers: [metricsRegistry],
})

const vpnRateLimitedTotal = new Counter({
  name: 'vpn_exit_rate_limited_total',
  help: 'Total rate limited packets',
  registers: [metricsRegistry],
})

const vpnNatEntriesTotal = new Gauge({
  name: 'vpn_exit_nat_entries_total',
  help: 'Current NAT table entries',
  labelNames: ['protocol'],
  registers: [metricsRegistry],
})

const vpnDosEventsTotal = new Counter({
  name: 'vpn_exit_dos_events_total',
  help: 'DoS attack events detected',
  registers: [metricsRegistry],
})

const vpnCookieRepliesTotal = new Counter({
  name: 'vpn_exit_cookie_replies_total',
  help: 'Cookie reply messages sent',
  registers: [metricsRegistry],
})

// Cryptographic Primitives (X25519, ChaCha20-Poly1305, BLAKE2s)

// X25519 implementation - module-private constants and functions
const X25519_BASE_POINT = Buffer.from([
  9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
])

function x25519ScalarMult(scalar: Uint8Array, point: Uint8Array): Uint8Array {
  const P = 2n ** 255n - 19n

  const toBigInt = (bytes: Uint8Array): bigint => {
    let result = 0n
    for (let i = 0; i < bytes.length; i++) {
      result |= BigInt(bytes[i]) << BigInt(i * 8)
    }
    return result
  }

  const toBytes = (n: bigint): Uint8Array => {
    const result = new Uint8Array(32)
    let temp = n
    for (let i = 0; i < 32; i++) {
      result[i] = Number(temp & 0xffn)
      temp >>= 8n
    }
    return result
  }

  const mod = (a: bigint): bigint => ((a % P) + P) % P
  const add = (a: bigint, b: bigint): bigint => mod(a + b)
  const sub = (a: bigint, b: bigint): bigint => mod(a - b)
  const mul = (a: bigint, b: bigint): bigint => mod(a * b)

  const inv = (a: bigint): bigint => {
    let result = 1n
    let base = mod(a)
    let exp = P - 2n
    while (exp > 0n) {
      if (exp & 1n) result = mul(result, base)
      base = mul(base, base)
      exp >>= 1n
    }
    return result
  }

  const k = toBigInt(scalar)
  const u = toBigInt(point) & ((1n << 255n) - 1n)

  const x1 = u
  let x2 = 1n
  let z2 = 0n
  let x3 = u
  let z3 = 1n

  let swap = 0n
  for (let i = 254; i >= 0; i--) {
    const ki = (k >> BigInt(i)) & 1n
    swap ^= ki
    if (swap) {
      ;[x2, x3] = [x3, x2]
      ;[z2, z3] = [z3, z2]
    }
    swap = ki

    const A = add(x2, z2)
    const AA = mul(A, A)
    const B = sub(x2, z2)
    const BB = mul(B, B)
    const E = sub(AA, BB)
    const C = add(x3, z3)
    const D = sub(x3, z3)
    const DA = mul(D, A)
    const CB = mul(C, B)
    x3 = mul(add(DA, CB), add(DA, CB))
    z3 = mul(x1, mul(sub(DA, CB), sub(DA, CB)))
    x2 = mul(AA, BB)
    z2 = mul(E, add(AA, mul(121665n, E)))
  }

  if (swap) {
    ;[x2, x3] = [x3, x2]
    ;[z2, z3] = [z3, z2]
  }

  return toBytes(mul(x2, inv(z2)))
}

const X25519 = {
  generatePrivateKey(): Uint8Array {
    const key = randomBytes(32)
    key[0] &= 248
    key[31] &= 127
    key[31] |= 64
    return new Uint8Array(key)
  },

  getPublicKey(privateKey: Uint8Array): Uint8Array {
    return x25519ScalarMult(privateKey, new Uint8Array(X25519_BASE_POINT))
  },

  sharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
    return x25519ScalarMult(privateKey, publicKey)
  },
}

// BLAKE2s implementation - module-private constants and functions
const BLAKE2S_IV = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
])

const BLAKE2S_SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
]

function blake2sCompress(
  h: Uint32Array,
  block: Uint8Array,
  t: number[],
  f: number[],
): void {
  const v = new Uint32Array(16)
  const m = new Uint32Array(16)

  for (let i = 0; i < 8; i++) v[i] = h[i]
  for (let i = 0; i < 8; i++) v[i + 8] = BLAKE2S_IV[i]
  v[12] ^= t[0]
  v[13] ^= t[1]
  v[14] ^= f[0]
  v[15] ^= f[1]

  for (let i = 0; i < 16; i++) {
    m[i] =
      block[i * 4] |
      (block[i * 4 + 1] << 8) |
      (block[i * 4 + 2] << 16) |
      (block[i * 4 + 3] << 24)
  }

  const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0
  const G = (
    a: number,
    b: number,
    c: number,
    d: number,
    x: number,
    y: number,
  ) => {
    v[a] = (v[a] + v[b] + x) >>> 0
    v[d] = rotr(v[d] ^ v[a], 16)
    v[c] = (v[c] + v[d]) >>> 0
    v[b] = rotr(v[b] ^ v[c], 12)
    v[a] = (v[a] + v[b] + y) >>> 0
    v[d] = rotr(v[d] ^ v[a], 8)
    v[c] = (v[c] + v[d]) >>> 0
    v[b] = rotr(v[b] ^ v[c], 7)
  }

  for (let round = 0; round < 10; round++) {
    const s = BLAKE2S_SIGMA[round]
    G(0, 4, 8, 12, m[s[0]], m[s[1]])
    G(1, 5, 9, 13, m[s[2]], m[s[3]])
    G(2, 6, 10, 14, m[s[4]], m[s[5]])
    G(3, 7, 11, 15, m[s[6]], m[s[7]])
    G(0, 5, 10, 15, m[s[8]], m[s[9]])
    G(1, 6, 11, 12, m[s[10]], m[s[11]])
    G(2, 7, 8, 13, m[s[12]], m[s[13]])
    G(3, 4, 9, 14, m[s[14]], m[s[15]])
  }

  for (let i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i + 8]
}

const BLAKE2s = {
  hash(data: Uint8Array, outlen = 32, key?: Uint8Array): Uint8Array {
    const h = new Uint32Array(8)
    const t = [0, 0]
    const f = [0, 0]
    const buf = new Uint8Array(64)
    let buflen = 0

    for (let i = 0; i < 8; i++) h[i] = BLAKE2S_IV[i]
    h[0] ^= 0x01010000 ^ ((key?.length ?? 0) << 8) ^ outlen

    if (key && key.length > 0) {
      buf.set(key)
      buflen = 64
    }

    let offset = 0
    while (offset < data.length) {
      if (buflen === 64) {
        t[0] += 64
        if (t[0] < 64) t[1]++
        blake2sCompress(h, buf, t, f)
        buflen = 0
      }
      const take = Math.min(64 - buflen, data.length - offset)
      buf.set(data.subarray(offset, offset + take), buflen)
      buflen += take
      offset += take
    }

    t[0] += buflen
    if (t[0] < buflen) t[1]++
    f[0] = 0xffffffff
    buf.fill(0, buflen)
    blake2sCompress(h, buf, t, f)

    const out = new Uint8Array(outlen)
    for (let i = 0; i < outlen; i++) {
      out[i] = (h[i >> 2] >> (8 * (i & 3))) & 0xff
    }
    return out
  },

  mac(key: Uint8Array, data: Uint8Array): Uint8Array {
    return BLAKE2s.hash(data, 16, key)
  },
}

const ChaCha20Poly1305 = {
  encrypt(
    key: Uint8Array,
    nonce: Uint8Array,
    plaintext: Uint8Array,
    aad: Uint8Array = new Uint8Array(0),
  ): Uint8Array {
    const cipher = createCipheriv(
      'chacha20-poly1305',
      Buffer.from(key),
      Buffer.from(nonce),
      { authTagLength: 16 },
    )
    cipher.setAAD(Buffer.from(aad), { plaintextLength: plaintext.length })
    const encrypted = cipher.update(Buffer.from(plaintext))
    cipher.final()
    const tag = cipher.getAuthTag()
    const result = new Uint8Array(encrypted.length + tag.length)
    result.set(new Uint8Array(encrypted), 0)
    result.set(new Uint8Array(tag), encrypted.length)
    return result
  },

  decrypt(
    key: Uint8Array,
    nonce: Uint8Array,
    ciphertext: Uint8Array,
    aad: Uint8Array = new Uint8Array(0),
  ): Uint8Array | null {
    if (ciphertext.length < TAG_SIZE) return null
    const encrypted = ciphertext.subarray(0, ciphertext.length - TAG_SIZE)
    const tag = ciphertext.subarray(ciphertext.length - TAG_SIZE)
    const decipher = createDecipheriv(
      'chacha20-poly1305',
      Buffer.from(key),
      Buffer.from(nonce),
      { authTagLength: 16 },
    )
    decipher.setAAD(Buffer.from(aad), { plaintextLength: encrypted.length })
    decipher.setAuthTag(Buffer.from(tag))
    try {
      const decrypted = decipher.update(Buffer.from(encrypted))
      decipher.final()
      return new Uint8Array(decrypted)
    } catch {
      return null
    }
  },
}

// Noise Protocol Implementation (IKpsk2)

class NoiseIKpsk2 {
  private chainingKey: Uint8Array
  private hash: Uint8Array
  private key: Uint8Array | null = null
  private nonce = 0n

  constructor() {
    const protocolName = new TextEncoder().encode(WG_CONSTRUCTION)
    if (protocolName.length <= 32) {
      this.hash = new Uint8Array(32)
      this.hash.set(protocolName)
    } else {
      this.hash = BLAKE2s.hash(protocolName)
    }
    this.chainingKey = new Uint8Array(this.hash)
    this.mixHash(new TextEncoder().encode(WG_IDENTIFIER))
  }

  mixHash(data: Uint8Array): void {
    const combined = new Uint8Array(this.hash.length + data.length)
    combined.set(this.hash, 0)
    combined.set(data, this.hash.length)
    this.hash = BLAKE2s.hash(combined)
  }

  mixKey(inputKeyMaterial: Uint8Array): void {
    const output = this.hkdf(this.chainingKey, inputKeyMaterial, 2)
    this.chainingKey = output[0]
    this.key = output[1]
    this.nonce = 0n
  }

  mixKeyAndHash(inputKeyMaterial: Uint8Array): void {
    const output = this.hkdf(this.chainingKey, inputKeyMaterial, 3)
    this.chainingKey = output[0]
    const tempHash = output[1]
    this.key = output[2]
    this.mixHash(tempHash)
    this.nonce = 0n
  }

  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    if (!this.key) throw new Error('Key not initialized')
    const nonce = this.makeNonce()
    const ciphertext = ChaCha20Poly1305.encrypt(
      this.key,
      nonce,
      plaintext,
      this.hash,
    )
    this.mixHash(ciphertext)
    return ciphertext
  }

  decryptAndHash(ciphertext: Uint8Array): Uint8Array | null {
    if (!this.key) throw new Error('Key not initialized')
    const nonce = this.makeNonce()
    const plaintext = ChaCha20Poly1305.decrypt(
      this.key,
      nonce,
      ciphertext,
      this.hash,
    )
    if (plaintext) {
      this.mixHash(ciphertext)
    }
    return plaintext
  }

  split(): [Uint8Array, Uint8Array] {
    const output = this.hkdf(this.chainingKey, new Uint8Array(0), 2)
    return [output[0], output[1]]
  }

  private hkdf(
    key: Uint8Array,
    input: Uint8Array,
    outputs: number,
  ): Uint8Array[] {
    const prk = this.hmacBlake2s(key, input)
    const result: Uint8Array[] = []
    let prev: Uint8Array = new Uint8Array(0)
    for (let i = 0; i < outputs; i++) {
      const data = new Uint8Array(prev.length + 1)
      data.set(prev, 0)
      data[prev.length] = i + 1
      const hmacResult = this.hmacBlake2s(prk, data)
      prev = new Uint8Array(hmacResult)
      result.push(new Uint8Array(hmacResult))
    }
    return result
  }

  private hmacBlake2s(key: Uint8Array, data: Uint8Array): Uint8Array {
    const blockSize = 64
    const keyBlock = new Uint8Array(blockSize)
    if (key.length > blockSize) {
      keyBlock.set(BLAKE2s.hash(key, 32), 0)
    } else {
      keyBlock.set(key, 0)
    }

    const ipad = new Uint8Array(blockSize)
    const opad = new Uint8Array(blockSize)
    for (let i = 0; i < blockSize; i++) {
      ipad[i] = keyBlock[i] ^ 0x36
      opad[i] = keyBlock[i] ^ 0x5c
    }

    const inner = new Uint8Array(blockSize + data.length)
    inner.set(ipad, 0)
    inner.set(data, blockSize)
    const innerHash = BLAKE2s.hash(inner, 32)

    const outer = new Uint8Array(blockSize + 32)
    outer.set(opad, 0)
    outer.set(innerHash, blockSize)
    return BLAKE2s.hash(outer, 32)
  }

  private makeNonce(): Uint8Array {
    const nonce = new Uint8Array(12)
    const view = new DataView(nonce.buffer)
    view.setBigUint64(4, this.nonce++, true)
    return nonce
  }
}

// VPN Exit Service

export class VPNExitService {
  private client: NodeClient
  private config: VPNExitConfig
  private running = false
  private clients = new Map<string, VPNClient>()
  private sessions = new Map<string, VPNSession>()
  private peers = new Map<number, WireGuardPeer>()
  private peersByKey = new Map<string, WireGuardPeer>()
  private udpSocket: dgram.Socket | null = null
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private metricsInterval: ReturnType<typeof setInterval> | null = null

  // Server keys
  private privateKey: Uint8Array
  private publicKey: Uint8Array

  // IP allocation
  private ipPool: string[] = []
  private allocatedIPs = new Set<string>()

  // Index counter
  private indexCounter = 1

  // NAT table
  private natTable: NATTable

  // TUN device
  private tunDevice: TUNDevice | null = null

  // DoS protection state
  private dosState: DoSState
  private dosResetInterval: ReturnType<typeof setInterval> | null = null

  constructor(client: NodeClient, config: Partial<VPNExitConfig>) {
    this.client = client

    const parsedConfig = VPNExitConfigSchema.parse({
      listenPort: config.listenPort ?? 51820,
      endpoint: config.endpoint ?? `0.0.0.0:${config.listenPort ?? 51820}`,
      countryCode: config.countryCode ?? 'US',
      regionCode: config.regionCode,
      maxClients: config.maxClients ?? 100,
      bandwidthLimitMbps: config.bandwidthLimitMbps ?? 100,
      stakeAmount: config.stakeAmount ?? BigInt('100000000000000000'),
      coordinatorUrl: config.coordinatorUrl,
      enableCDN: config.enableCDN ?? true,
      metricsPort: config.metricsPort,
      tunnelSubnet: config.tunnelSubnet ?? '10.8.0.0/24',
      tunnelInterface: config.tunnelInterface ?? 'wg0',
      mtu: config.mtu ?? 1420,
      persistentKeepalive: config.persistentKeepalive ?? 25,
      rateLimitBytesPerSecond:
        config.rateLimitBytesPerSecond ?? 10 * 1024 * 1024,
      rateLimitBurst: config.rateLimitBurst ?? 50 * 1024 * 1024,
      natEnabled: config.natEnabled ?? true,
      natTimeout: config.natTimeout ?? 300000,
      dosProtectionEnabled: config.dosProtectionEnabled ?? true,
    })
    this.config = parsedConfig

    // Generate or decode keys
    if (config.privateKey) {
      this.privateKey = new Uint8Array(Buffer.from(config.privateKey, 'base64'))
    } else {
      this.privateKey = X25519.generatePrivateKey()
    }
    this.publicKey = X25519.getPublicKey(this.privateKey)

    // Initialize IP pool
    const [baseIP] = this.config.tunnelSubnet.split('/')
    const parts = baseIP.split('.').map(Number)
    for (let i = 2; i <= 254; i++) {
      this.ipPool.push(`${parts[0]}.${parts[1]}.${parts[2]}.${i}`)
    }

    // Initialize NAT table
    this.natTable = new NATTable(this.config.natTimeout)

    // Initialize DoS protection state
    this.dosState = {
      packetsPerSecond: 0,
      handshakesPerSecond: 0,
      lastReset: Date.now(),
      underAttack: false,
      cookieSecret: new Uint8Array(randomBytes(32)),
      lastCookieRotation: Date.now(),
    }

    console.log(
      `[VPNExit] Initialized with public key: ${Buffer.from(this.publicKey).toString('base64')}`,
    )
  }

  // ============================================================================
  // Public API
  // ============================================================================

  getPublicKeyBase64(): string {
    return Buffer.from(this.publicKey).toString('base64')
  }

  async getState(address: Address): Promise<VPNExitState | null> {
    if (
      !this.client.addresses.vpnRegistry ||
      this.client.addresses.vpnRegistry ===
        '0x0000000000000000000000000000000000000000'
    ) {
      return null
    }

    const node = await this.client.publicClient.readContract({
      address: this.client.addresses.vpnRegistry,
      abi: VPN_REGISTRY_ABI,
      functionName: 'getNode',
      args: [address],
    })

    if (
      !node ||
      (node as { registeredAt: bigint }).registeredAt === BigInt(0)
    ) {
      return null
    }

    const nodeData = node as {
      operator: Address
      countryCode: `0x${string}`
      stake: bigint
      active: boolean
      totalBytesServed: bigint
      totalSessions: bigint
    }

    let status: VPNExitState['status'] = 'offline'
    if (nodeData.active) {
      status = this.clients.size >= this.config.maxClients ? 'busy' : 'online'
    }

    return {
      isRegistered: true,
      nodeId: address as `0x${string}`,
      countryCode: Buffer.from(nodeData.countryCode.slice(2), 'hex').toString(),
      status,
      activeClients: this.clients.size,
      totalSessions: Number(nodeData.totalSessions),
      totalBytesServed: nodeData.totalBytesServed,
      earnings: nodeData.stake,
    }
  }

  async register(): Promise<string> {
    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    if (
      !this.client.addresses.vpnRegistry ||
      this.client.addresses.vpnRegistry ===
        '0x0000000000000000000000000000000000000000'
    ) {
      throw new Error('VPN Registry not deployed')
    }

    const countryBytes =
      `0x${Buffer.from(this.config.countryCode).toString('hex')}` as `0x${string}`

    const isBlocked = await this.client.publicClient.readContract({
      address: this.client.addresses.vpnRegistry,
      abi: VPN_REGISTRY_ABI,
      functionName: 'blockedCountries',
      args: [countryBytes],
    })

    if (isBlocked) {
      throw new Error(
        `VPN exit not allowed in country: ${this.config.countryCode}`,
      )
    }

    const regionHash = this.config.regionCode
      ? (`0x${createHash('sha256').update(this.config.regionCode).digest('hex')}` as `0x${string}`)
      : (`0x${'00'.repeat(32)}` as `0x${string}`)

    const capabilities = {
      supportsWireGuard: true,
      supportsSOCKS5: false,
      supportsHTTPConnect: false,
      servesCDN: this.config.enableCDN,
      isVPNExit: true,
    }

    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.vpnRegistry,
      abi: VPN_REGISTRY_ABI,
      functionName: 'register',
      args: [
        countryBytes,
        regionHash,
        this.config.endpoint,
        this.getPublicKeyBase64(),
        capabilities,
      ],
      value: this.config.stakeAmount,
    })

    console.log(
      `[VPNExit] Registered as VPN exit node in ${this.config.countryCode}`,
    )
    return hash
  }

  async start(): Promise<void> {
    if (this.running) {
      console.warn('[VPNExit] Already running')
      return
    }

    this.running = true

    // Start NAT table
    if (this.config.natEnabled) {
      this.natTable.start()
    }

    // Start TUN device (requires root)
    try {
      this.tunDevice = new TUNDevice(
        this.config.tunnelInterface,
        this.config.tunnelSubnet,
        this.config.mtu,
      )
      await this.tunDevice.start()

      // Handle inbound packets from TUN (internet -> VPN)
      this.tunDevice.on('inbound', (packet: Uint8Array) => {
        this.handleInboundPacket(packet)
      })
    } catch (error) {
      console.warn('[VPNExit] TUN device not available (requires root):', error)
      // Continue without TUN - will work in userspace mode
    }

    // Start UDP listener for WireGuard
    await this.startWireGuardListener()

    // Start DoS protection reset interval
    if (this.config.dosProtectionEnabled) {
      this.dosResetInterval = setInterval(() => this.resetDoSCounters(), 1000)
    }

    // Start heartbeat
    this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), 60000)

    // Start metrics reporting
    this.metricsInterval = setInterval(() => this.updateMetrics(), 10000)

    console.log(
      `[VPNExit] Started on port ${this.config.listenPort} (${this.config.countryCode})`,
    )
  }

  async stop(): Promise<void> {
    if (!this.running) return

    console.log('[VPNExit] Stopping...')
    this.running = false

    // Close all client sessions
    for (const [clientId] of this.clients) {
      await this.endSession(clientId, true)
    }

    // Stop NAT table
    this.natTable.stop()

    // Stop TUN device
    if (this.tunDevice) {
      await this.tunDevice.stop()
    }

    // Cleanup intervals
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval)
    if (this.metricsInterval) clearInterval(this.metricsInterval)
    if (this.dosResetInterval) clearInterval(this.dosResetInterval)
    if (this.udpSocket) this.udpSocket.close()

    console.log('[VPNExit] Stopped')
  }

  isRunning(): boolean {
    return this.running
  }

  getClients(): VPNClient[] {
    return Array.from(this.clients.values())
  }

  getMetrics(): Promise<string> {
    return metricsRegistry.metrics()
  }

  getNATStats(): { total: number; tcp: number; udp: number; icmp: number } {
    return this.natTable.getStats()
  }

  // ============================================================================
  // DoS Protection
  // ============================================================================

  private resetDoSCounters(): void {
    const wasUnderAttack = this.dosState.underAttack

    this.dosState.underAttack =
      this.dosState.packetsPerSecond > DOS_THRESHOLD_PACKETS_PER_SECOND ||
      this.dosState.handshakesPerSecond > DOS_THRESHOLD_HANDSHAKES_PER_SECOND

    if (this.dosState.underAttack && !wasUnderAttack) {
      console.warn('[VPNExit] DoS attack detected - enabling cookie protection')
      vpnDosEventsTotal.inc()
    } else if (!this.dosState.underAttack && wasUnderAttack) {
      console.log('[VPNExit] DoS attack ended - disabling cookie protection')
    }

    this.dosState.packetsPerSecond = 0
    this.dosState.handshakesPerSecond = 0
    this.dosState.lastReset = Date.now()

    // Rotate cookie secret periodically
    if (
      Date.now() - this.dosState.lastCookieRotation >
      COOKIE_REFRESH_INTERVAL
    ) {
      this.dosState.cookieSecret = new Uint8Array(randomBytes(32))
      this.dosState.lastCookieRotation = Date.now()
    }
  }

  private generateCookie(sourceAddr: string, sourcePort: number): Uint8Array {
    const data = new TextEncoder().encode(`${sourceAddr}:${sourcePort}`)
    const combined = new Uint8Array(
      this.dosState.cookieSecret.length + data.length,
    )
    combined.set(this.dosState.cookieSecret, 0)
    combined.set(data, this.dosState.cookieSecret.length)
    return BLAKE2s.hash(combined, COOKIE_SIZE)
  }

  private sendCookieReply(
    senderIndex: number,
    mac1: Uint8Array,
    rinfo: dgram.RemoteInfo,
  ): void {
    // Cookie Reply format:
    // Type (1) + Reserved (3) + Receiver Index (4) + Nonce (24) + Encrypted Cookie (32)
    const cookie = this.generateCookie(rinfo.address, rinfo.port)

    // Encrypt cookie with mac1 as the key
    const nonce = randomBytes(24)
    const cookieKey = BLAKE2s.hash(
      new Uint8Array([
        ...new TextEncoder().encode(WG_LABEL_COOKIE),
        ...this.publicKey,
      ]),
    )

    // XChaCha20-Poly1305 encryption (simplified - using regular ChaCha20-Poly1305)
    const encryptedCookie = ChaCha20Poly1305.encrypt(
      cookieKey.subarray(0, 32),
      nonce.subarray(0, 12),
      cookie,
      mac1,
    )

    const reply = new Uint8Array(64)
    const view = new DataView(reply.buffer)
    view.setUint8(0, MSG_COOKIE_REPLY)
    view.setUint32(4, senderIndex, true)
    reply.set(nonce.subarray(0, 24), 8)
    reply.set(encryptedCookie, 32)

    this.udpSocket?.send(reply, rinfo.port, rinfo.address)
    vpnCookieRepliesTotal.inc()
  }

  // ============================================================================
  // WireGuard Protocol Implementation
  // ============================================================================

  private async startWireGuardListener(): Promise<void> {
    this.udpSocket = dgram.createSocket('udp4')

    this.udpSocket.on('message', async (msg, rinfo) => {
      await this.handleWireGuardPacket(msg, rinfo)
    })

    this.udpSocket.on('error', (err) => {
      console.error('[VPNExit] UDP socket error:', err.message)
    })

    await new Promise<void>((resolve) => {
      this.udpSocket?.bind(this.config.listenPort, '0.0.0.0', () => {
        console.log(
          `[VPNExit] WireGuard listening on UDP port ${this.config.listenPort}`,
        )
        resolve()
      })
    })
  }

  private async handleWireGuardPacket(
    data: Buffer,
    rinfo: dgram.RemoteInfo,
  ): Promise<void> {
    if (data.length < 4) return

    // Update DoS counters
    this.dosState.packetsPerSecond++

    const messageType = data[0]
    vpnPacketsTotal.inc({ type: messageType.toString(), direction: 'in' })
    vpnBytesTotal.inc({ direction: 'in' }, data.length)

    switch (messageType) {
      case MSG_HANDSHAKE_INITIATION:
        this.dosState.handshakesPerSecond++
        await this.handleHandshakeInitiation(data, rinfo)
        break
      case MSG_HANDSHAKE_RESPONSE:
        break
      case MSG_COOKIE_REPLY:
        break
      case MSG_TRANSPORT_DATA:
        await this.handleTransportData(data, rinfo)
        break
      default:
        console.warn(
          `[VPNExit] Unknown message type ${messageType} from ${rinfo.address}`,
        )
    }
  }

  private async handleHandshakeInitiation(
    data: Buffer,
    rinfo: dgram.RemoteInfo,
  ): Promise<void> {
    if (data.length !== 148) {
      console.warn(
        `[VPNExit] Invalid handshake initiation size: ${data.length}`,
      )
      vpnHandshakesTotal.inc({ status: 'invalid' })
      return
    }

    const view = new DataView(data.buffer, data.byteOffset)
    const senderIndex = view.getUint32(4, true)
    const encryptedEphemeral = new Uint8Array(data.slice(8, 40))
    const encryptedStatic = new Uint8Array(data.slice(40, 88))
    const encryptedTimestamp = new Uint8Array(data.slice(88, 116))
    const mac1 = new Uint8Array(data.slice(116, 132))
    const mac2 = new Uint8Array(data.slice(132, 148))

    // Verify MAC1
    const mac1Key = BLAKE2s.hash(
      new Uint8Array([
        ...new TextEncoder().encode(WG_LABEL_MAC1),
        ...this.publicKey,
      ]),
    )
    const expectedMac1 = BLAKE2s.mac(
      mac1Key,
      new Uint8Array(data.slice(0, 116)),
    )
    if (!this.constantTimeEqual(mac1, expectedMac1)) {
      console.warn('[VPNExit] Invalid MAC1')
      vpnHandshakesTotal.inc({ status: 'invalid_mac' })
      return
    }

    // Check if under DoS attack - require valid MAC2 (cookie)
    if (this.config.dosProtectionEnabled && this.dosState.underAttack) {
      const isZeroMac2 = mac2.every((b) => b === 0)
      if (isZeroMac2) {
        // Send cookie reply
        this.sendCookieReply(senderIndex, mac1, rinfo)
        vpnHandshakesTotal.inc({ status: 'cookie_required' })
        return
      }

      // Verify MAC2 (cookie)
      const expectedCookie = this.generateCookie(rinfo.address, rinfo.port)
      const cookieKey = BLAKE2s.hash(
        new Uint8Array([
          ...new TextEncoder().encode(WG_LABEL_COOKIE),
          ...this.publicKey,
        ]),
      )
      const expectedMac2 = BLAKE2s.mac(
        cookieKey,
        new Uint8Array([...data.slice(0, 132), ...expectedCookie]),
      )

      if (!this.constantTimeEqual(mac2, expectedMac2.subarray(0, 16))) {
        console.warn('[VPNExit] Invalid MAC2 during DoS protection')
        vpnHandshakesTotal.inc({ status: 'invalid_cookie' })
        return
      }
    }

    // Initialize Noise handshake
    const noise = new NoiseIKpsk2()
    noise.mixHash(this.publicKey)

    const clientEphemeral = encryptedEphemeral
    noise.mixHash(clientEphemeral)

    const sharedSecret1 = X25519.sharedSecret(this.privateKey, clientEphemeral)
    noise.mixKey(sharedSecret1)

    const clientStatic = noise.decryptAndHash(encryptedStatic)
    if (!clientStatic) {
      console.warn('[VPNExit] Failed to decrypt client static key')
      vpnHandshakesTotal.inc({ status: 'decrypt_failed' })
      return
    }

    const sharedSecret2 = X25519.sharedSecret(this.privateKey, clientStatic)
    noise.mixKey(sharedSecret2)

    const timestamp = noise.decryptAndHash(encryptedTimestamp)
    if (!timestamp) {
      console.warn('[VPNExit] Failed to decrypt timestamp')
      vpnHandshakesTotal.inc({ status: 'decrypt_failed' })
      return
    }

    // Check for replay
    const clientKeyHex = Buffer.from(clientStatic).toString('hex')
    const existingPeer = this.peersByKey.get(clientKeyHex)
    if (existingPeer) {
      // Parse TAI64N timestamp (first 8 bytes are seconds in big-endian)
      // Copy to aligned buffer for DataView
      const alignedBuf = new ArrayBuffer(8)
      const alignedArr = new Uint8Array(alignedBuf)
      alignedArr.set(timestamp.subarray(0, 8))
      const timestampView = new DataView(alignedBuf)
      const tai64Seconds = timestampView.getBigUint64(0, false)
      // TAI64 epoch offset: 2^62 = 4611686018427387904
      const unixSeconds = Number(tai64Seconds - 4611686018427387904n)
      if (unixSeconds * 1000 <= existingPeer.lastHandshake) {
        console.warn('[VPNExit] Replay attack detected')
        vpnHandshakesTotal.inc({ status: 'replay' })
        return
      }
    }

    // Create peer with rate limiter
    const receiverIndex = this.indexCounter++
    const peer: WireGuardPeer = {
      publicKey: clientStatic,
      presharedKey: new Uint8Array(32),
      allowedIPs: [],
      endpoint: { address: rinfo.address, port: rinfo.port },
      lastHandshake: Date.now(),
      txBytes: 0n,
      rxBytes: 0n,
      sendCounter: 0n,
      receiveCounter: 0n,
      sendKey: null,
      receiveKey: null,
      senderIndex,
      receiverIndex,
      rateLimiter: new TokenBucketRateLimiter(
        this.config.rateLimitBytesPerSecond,
        this.config.rateLimitBurst,
      ),
      lastCookieTime: 0,
      cookie: null,
    }

    // Generate server ephemeral key
    const serverEphemeralPrivate = X25519.generatePrivateKey()
    const serverEphemeralPublic = X25519.getPublicKey(serverEphemeralPrivate)

    // Build response
    const response = new Uint8Array(92)
    const respView = new DataView(response.buffer)
    respView.setUint8(0, MSG_HANDSHAKE_RESPONSE)
    respView.setUint32(4, receiverIndex, true)
    respView.setUint32(8, senderIndex, true)

    noise.mixHash(serverEphemeralPublic)
    response.set(serverEphemeralPublic, 12)

    const sharedSecret3 = X25519.sharedSecret(
      serverEphemeralPrivate,
      clientEphemeral,
    )
    noise.mixKey(sharedSecret3)

    const sharedSecret4 = X25519.sharedSecret(
      serverEphemeralPrivate,
      clientStatic,
    )
    noise.mixKey(sharedSecret4)

    noise.mixKeyAndHash(peer.presharedKey)

    const encryptedNothing = noise.encryptAndHash(new Uint8Array(0))
    response.set(encryptedNothing, 44)

    const [sendKey, receiveKey] = noise.split()
    peer.sendKey = sendKey
    peer.receiveKey = receiveKey

    const respMac1 = BLAKE2s.mac(mac1Key, response.subarray(0, 60))
    response.set(respMac1, 60)
    response.set(new Uint8Array(16), 76)

    this.peers.set(receiverIndex, peer)
    this.peersByKey.set(clientKeyHex, peer)

    this.udpSocket?.send(response, rinfo.port, rinfo.address)

    vpnHandshakesTotal.inc({ status: 'success' })
    vpnPacketsTotal.inc({ type: 'handshake_response', direction: 'out' })

    const clientId = clientKeyHex.slice(0, 16)
    await this.addClientFromPeer(clientId, peer)

    console.log(
      `[VPNExit] Handshake completed with ${rinfo.address}:${rinfo.port}`,
    )
  }

  private async handleTransportData(
    data: Buffer,
    rinfo: dgram.RemoteInfo,
  ): Promise<void> {
    if (data.length < 32) return

    const view = new DataView(data.buffer, data.byteOffset)
    const receiverIndex = view.getUint32(4, true)
    const counter = view.getBigUint64(8, true)
    const encryptedPacket = new Uint8Array(data.slice(16))

    const peer = this.peers.get(receiverIndex)
    if (!peer || !peer.receiveKey) return

    // Rate limiting check
    if (!peer.rateLimiter.consume(data.length)) {
      vpnRateLimitedTotal.inc()
      return
    }

    // Replay protection
    if (counter <= peer.receiveCounter) {
      console.warn('[VPNExit] Replay detected in transport data')
      return
    }
    peer.receiveCounter = counter

    // Decrypt packet
    const nonce = new Uint8Array(12)
    const nonceView = new DataView(nonce.buffer)
    nonceView.setBigUint64(4, counter, true)

    const plaintext = ChaCha20Poly1305.decrypt(
      peer.receiveKey,
      nonce,
      encryptedPacket,
    )
    if (!plaintext) {
      console.warn('[VPNExit] Failed to decrypt transport data')
      return
    }

    // Update stats
    peer.rxBytes += BigInt(plaintext.length)
    peer.lastHandshake = Date.now()
    peer.endpoint = { address: rinfo.address, port: rinfo.port }

    const clientKeyHex = Buffer.from(peer.publicKey).toString('hex')
    const clientId = clientKeyHex.slice(0, 16)
    const client = this.clients.get(clientId)
    if (client) {
      client.bytesDown += BigInt(plaintext.length)
      client.lastSeen = Date.now()
    }

    vpnBytesTotal.inc({ direction: 'tunnel_in' }, plaintext.length)

    // Process the decrypted IP packet
    if (plaintext.length > 0) {
      await this.processDecryptedPacket(plaintext, peer)
    }
  }

  private async processDecryptedPacket(
    packet: Uint8Array,
    peer: WireGuardPeer,
  ): Promise<void> {
    if (packet.length < 20) return

    const version = (packet[0] >> 4) & 0x0f
    if (version !== 4) return // Only IPv4

    const headerLength = (packet[0] & 0x0f) * 4
    const totalLength = (packet[2] << 8) | packet[3]
    const protocol = packet[9]
    const srcIP = `${packet[12]}.${packet[13]}.${packet[14]}.${packet[15]}`
    const dstIP = `${packet[16]}.${packet[17]}.${packet[18]}.${packet[19]}`

    // Extract ports for TCP/UDP
    let srcPort = 0
    let dstPort = 0
    if (
      (protocol === 6 || protocol === 17) &&
      packet.length >= headerLength + 4
    ) {
      srcPort = (packet[headerLength] << 8) | packet[headerLength + 1]
      dstPort = (packet[headerLength + 2] << 8) | packet[headerLength + 3]
    }

    // NAT translation with checksum recalculation
    let forwardPacket = packet
    if (this.config.natEnabled) {
      const protoStr = protocol === 6 ? 'tcp' : protocol === 17 ? 'udp' : 'icmp'
      const natEntry = this.natTable.translate(
        srcIP,
        srcPort,
        protoStr as 'tcp' | 'udp' | 'icmp',
        peer.receiverIndex,
      )

      // Get external IP (use first non-localhost interface IP)
      const externalIP = this.getExternalIP()
      natEntry.externalIP = externalIP

      // Modify packet with NAT'd source and recalculate checksums
      forwardPacket = natModifyPacket(packet, externalIP, natEntry.externalPort)

      console.log(
        `[VPNExit] NAT: ${srcIP}:${srcPort} -> ${externalIP}:${natEntry.externalPort} -> ${dstIP}:${dstPort}`,
      )
    }

    // Forward to TUN device
    if (this.tunDevice) {
      this.tunDevice.write(forwardPacket)
    }

    vpnBytesTotal.inc({ direction: 'forward' }, totalLength)
  }

  /**
   * Handle inbound packets from TUN (internet -> VPN client)
   */
  private handleInboundPacket(packet: Uint8Array): void {
    if (packet.length < 20) return

    const protocol = packet[9]
    const headerLength = (packet[0] & 0x0f) * 4

    // Extract destination port (which is the NAT'd external port)
    let dstPort = 0
    if (
      (protocol === 6 || protocol === 17) &&
      packet.length >= headerLength + 4
    ) {
      dstPort = (packet[headerLength + 2] << 8) | packet[headerLength + 3]
    }

    // Find NAT entry by the external port
    const protoStr = protocol === 6 ? 'tcp' : protocol === 17 ? 'udp' : 'icmp'
    const natEntry = this.natTable.reverseTranslate(
      dstPort,
      protoStr as 'tcp' | 'udp' | 'icmp',
    )

    if (!natEntry) return

    // Find peer
    const peer = this.peers.get(natEntry.peerIndex)
    if (!peer || !peer.sendKey || !peer.endpoint) return

    // Rate limit check
    if (!peer.rateLimiter.consume(packet.length)) {
      vpnRateLimitedTotal.inc()
      return
    }

    // Reverse NAT: modify destination back to internal client IP/port
    const modifiedPacket = natReverseModifyPacket(
      packet,
      natEntry.internalIP,
      natEntry.internalPort,
    )

    // Update NAT entry activity
    natEntry.lastActivity = Date.now()
    if (protocol === 6) {
      // Check TCP flags for connection state
      const tcpFlags = packet[headerLength + 13]
      if (tcpFlags & 0x01) {
        // FIN
        natEntry.state = 'closing'
      } else if (tcpFlags & 0x04) {
        // RST
        natEntry.state = 'closed'
      } else if (natEntry.state === 'new') {
        natEntry.state = 'established'
      }
    }

    vpnBytesTotal.inc({ direction: 'tunnel_out' }, modifiedPacket.length)

    // Send encrypted packet back to peer
    this.sendTransportData(peer, modifiedPacket)
  }

  /**
   * Get external IP address for NAT
   */
  private getExternalIP(): string {
    // Try to get external IP from environment or detect it
    if (process.env.EXTERNAL_IP) {
      return process.env.EXTERNAL_IP
    }

    // Use the tunnel subnet gateway as default
    const [baseIP] = this.config.tunnelSubnet.split('/')
    return baseIP.replace(/\.0$/, '.1')
  }

  public sendTransportData(peer: WireGuardPeer, plaintext: Uint8Array): void {
    if (!peer.sendKey || !peer.endpoint) return

    const counter = peer.sendCounter++
    const nonce = new Uint8Array(12)
    const nonceView = new DataView(nonce.buffer)
    nonceView.setBigUint64(4, counter, true)

    const encrypted = ChaCha20Poly1305.encrypt(peer.sendKey, nonce, plaintext)

    const packet = new Uint8Array(16 + encrypted.length)
    const pktView = new DataView(packet.buffer)
    pktView.setUint8(0, MSG_TRANSPORT_DATA)
    pktView.setUint32(4, peer.senderIndex, true)
    pktView.setBigUint64(8, counter, true)
    packet.set(encrypted, 16)

    this.udpSocket?.send(packet, peer.endpoint.port, peer.endpoint.address)

    peer.txBytes += BigInt(plaintext.length)
    vpnBytesTotal.inc({ direction: 'out' }, packet.length)
    vpnPacketsTotal.inc({ type: 'transport', direction: 'out' })
  }

  public getPeer(receiverIndex: number): WireGuardPeer | undefined {
    return this.peers.get(receiverIndex)
  }

  public getPeerByPublicKey(
    publicKeyBase64: string,
  ): WireGuardPeer | undefined {
    const publicKey = Buffer.from(publicKeyBase64, 'base64')
    return this.peersByKey.get(publicKey.toString('hex'))
  }

  private constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false
    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i]
    }
    return result === 0
  }

  // ============================================================================
  // Client Management
  // ============================================================================

  private async addClientFromPeer(
    clientId: string,
    peer: WireGuardPeer,
  ): Promise<VPNClient> {
    const existingClient = this.clients.get(clientId)
    if (existingClient) {
      return existingClient
    }

    if (this.clients.size >= this.config.maxClients) {
      throw new Error('Max clients reached')
    }

    const assignedIP = this.allocateIP()

    const client: VPNClient = {
      clientId,
      publicKey: peer.publicKey,
      assignedIP,
      connectedAt: Date.now(),
      bytesUp: 0n,
      bytesDown: 0n,
      lastSeen: Date.now(),
      endpoint: peer.endpoint,
      rateLimiter: peer.rateLimiter,
    }

    this.clients.set(clientId, client)
    vpnClientsTotal.set(this.clients.size)

    const session: VPNSession = {
      sessionId: randomBytes(16).toString('hex'),
      clientId,
      nodeId: this.client.walletClient?.account?.address ?? 'unknown',
      startTime: Date.now(),
      bytesUp: 0n,
      bytesDown: 0n,
      successful: true,
    }
    this.sessions.set(clientId, session)

    console.log(
      `[VPNExit] Client ${clientId} connected, assigned IP ${assignedIP}`,
    )
    return client
  }

  async addClient(publicKeyBase64: string): Promise<VPNClient> {
    const publicKey = new Uint8Array(Buffer.from(publicKeyBase64, 'base64'))
    const clientId = createHash('sha256')
      .update(publicKey)
      .digest('hex')
      .slice(0, 16)

    const existingClient = this.clients.get(clientId)
    if (existingClient) {
      return existingClient
    }

    if (this.clients.size >= this.config.maxClients) {
      throw new Error('Max clients reached')
    }

    const assignedIP = this.allocateIP()
    const rateLimiter = new TokenBucketRateLimiter(
      this.config.rateLimitBytesPerSecond,
      this.config.rateLimitBurst,
    )

    const client: VPNClient = {
      clientId,
      publicKey,
      assignedIP,
      connectedAt: Date.now(),
      bytesUp: 0n,
      bytesDown: 0n,
      lastSeen: Date.now(),
      endpoint: null,
      rateLimiter,
    }

    this.clients.set(clientId, client)
    vpnClientsTotal.set(this.clients.size)

    const session: VPNSession = {
      sessionId: randomBytes(16).toString('hex'),
      clientId,
      nodeId: this.client.walletClient?.account?.address ?? 'unknown',
      startTime: Date.now(),
      bytesUp: 0n,
      bytesDown: 0n,
      successful: true,
    }
    this.sessions.set(clientId, session)

    console.log(
      `[VPNExit] Client ${clientId} pre-authorized, assigned IP ${assignedIP}`,
    )
    return client
  }

  async removeClient(clientId: string): Promise<void> {
    const client = this.clients.get(clientId)
    if (!client) return

    await this.endSession(clientId, true)
    this.releaseIP(client.assignedIP)
    this.clients.delete(clientId)

    const keyHex = Buffer.from(client.publicKey).toString('hex')
    const peer = this.peersByKey.get(keyHex)
    if (peer) {
      // Clean up NAT entries for this peer
      this.natTable.removeEntriesForPeer(peer.receiverIndex)
      this.peers.delete(peer.receiverIndex)
      this.peersByKey.delete(keyHex)
    }

    vpnClientsTotal.set(this.clients.size)
    console.log(`[VPNExit] Client ${clientId} disconnected`)
  }

  private async endSession(
    clientId: string,
    successful: boolean,
  ): Promise<void> {
    const session = this.sessions.get(clientId)
    if (!session) return

    const client = this.clients.get(clientId)
    if (client) {
      session.bytesUp = client.bytesUp
      session.bytesDown = client.bytesDown
    }

    session.endTime = Date.now()
    session.successful = successful

    const durationSeconds = (session.endTime - session.startTime) / 1000
    vpnSessionDuration.observe(durationSeconds)
    vpnSessionsTotal.inc({ status: successful ? 'success' : 'failed' })

    const totalBytes = session.bytesUp + session.bytesDown
    console.log(`[VPNExit] Session ended: ${totalBytes} bytes transferred`)

    this.sessions.delete(clientId)
  }

  // ============================================================================
  // IP Allocation
  // ============================================================================

  private allocateIP(): string {
    for (const ip of this.ipPool) {
      if (!this.allocatedIPs.has(ip)) {
        this.allocatedIPs.add(ip)
        return ip
      }
    }
    throw new Error('No available IPs')
  }

  private releaseIP(ip: string): void {
    this.allocatedIPs.delete(ip)
  }

  // ============================================================================
  // Heartbeat and Metrics
  // ============================================================================

  private async sendHeartbeat(): Promise<void> {
    if (!this.running || !this.client.walletClient?.account) return
    if (
      !this.client.addresses.vpnRegistry ||
      this.client.addresses.vpnRegistry ===
        '0x0000000000000000000000000000000000000000'
    )
      return

    await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.vpnRegistry,
      abi: VPN_REGISTRY_ABI,
      functionName: 'heartbeat',
      args: [],
    })
  }

  private updateMetrics(): void {
    vpnClientsTotal.set(this.clients.size)
    const natStats = this.natTable.getStats()
    vpnNatEntriesTotal.set({ protocol: 'tcp' }, natStats.tcp)
    vpnNatEntriesTotal.set({ protocol: 'udp' }, natStats.udp)
    vpnNatEntriesTotal.set({ protocol: 'icmp' }, natStats.icmp)
  }
}

// Factory

export function createVPNExitService(
  client: NodeClient,
  config?: Partial<VPNExitConfig>,
): VPNExitService {
  return new VPNExitService(client, config ?? {})
}
