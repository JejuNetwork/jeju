import { describe, expect, test } from 'bun:test'
import { z } from 'zod'

// VPN Exit Config Schema
const VPNExitConfigSchema = z.object({
  listenPort: z.number().int().min(1024).max(65535),
  publicKey: z.string().length(44), // Base64 encoded WireGuard public key
  ipPool: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/),
  blockedCountries: z.array(z.string().length(2)),
  maxClients: z.number().int().positive(),
  bandwidthLimitMbps: z.number().positive(),
})

type VPNExitConfig = z.infer<typeof VPNExitConfigSchema>

// VPN Exit State Schema
const VPNExitStateSchema = z.object({
  isRegistered: z.boolean(),
  nodeId: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/)
    .optional(),
  status: z.enum(['active', 'inactive', 'suspended']),
  activeClients: z.number().int().nonnegative(),
  bytesTransferred: z.bigint(),
  uptime: z.number().int().nonnegative(),
})

type VPNExitState = z.infer<typeof VPNExitStateSchema>

function validateVPNExitConfig(data: unknown): VPNExitConfig {
  return VPNExitConfigSchema.parse(data)
}

function validateVPNExitState(data: unknown): VPNExitState {
  return VPNExitStateSchema.parse(data)
}

describe('VPN Exit Configuration Validation', () => {
  describe('validateVPNExitConfig', () => {
    test('validates valid config', () => {
      const config: VPNExitConfig = {
        listenPort: 51820,
        publicKey: 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=', // 44 char base64
        ipPool: '10.0.0.0/24',
        blockedCountries: ['CN', 'RU'],
        maxClients: 100,
        bandwidthLimitMbps: 1000,
      }

      const result = validateVPNExitConfig(config)
      expect(result.listenPort).toBe(51820)
      expect(result.maxClients).toBe(100)
    })

    test('rejects port below 1024', () => {
      const config = {
        listenPort: 80,
        publicKey: 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=',
        ipPool: '10.0.0.0/24',
        blockedCountries: [],
        maxClients: 100,
        bandwidthLimitMbps: 1000,
      }

      expect(() => validateVPNExitConfig(config)).toThrow()
    })

    test('rejects port above 65535', () => {
      const config = {
        listenPort: 70000,
        publicKey: 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=',
        ipPool: '10.0.0.0/24',
        blockedCountries: [],
        maxClients: 100,
        bandwidthLimitMbps: 1000,
      }

      expect(() => validateVPNExitConfig(config)).toThrow()
    })

    test('rejects invalid public key length', () => {
      const config = {
        listenPort: 51820,
        publicKey: 'too-short',
        ipPool: '10.0.0.0/24',
        blockedCountries: [],
        maxClients: 100,
        bandwidthLimitMbps: 1000,
      }

      expect(() => validateVPNExitConfig(config)).toThrow()
    })

    test('rejects invalid IP pool format', () => {
      const config = {
        listenPort: 51820,
        publicKey: 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=',
        ipPool: 'invalid-ip-pool',
        blockedCountries: [],
        maxClients: 100,
        bandwidthLimitMbps: 1000,
      }

      expect(() => validateVPNExitConfig(config)).toThrow()
    })

    test('validates various IP pool CIDRs', () => {
      const validPools = [
        '10.0.0.0/8',
        '172.16.0.0/16',
        '192.168.1.0/24',
        '10.8.0.0/30',
      ]

      for (const ipPool of validPools) {
        const config = {
          listenPort: 51820,
          publicKey: 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=',
          ipPool,
          blockedCountries: [],
          maxClients: 100,
          bandwidthLimitMbps: 1000,
        }

        const result = validateVPNExitConfig(config)
        expect(result.ipPool).toBe(ipPool)
      }
    })

    test('rejects invalid country codes', () => {
      const config = {
        listenPort: 51820,
        publicKey: 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=',
        ipPool: '10.0.0.0/24',
        blockedCountries: ['USA'], // Should be 2 letters
        maxClients: 100,
        bandwidthLimitMbps: 1000,
      }

      expect(() => validateVPNExitConfig(config)).toThrow()
    })
  })

  describe('validateVPNExitState', () => {
    test('validates active state', () => {
      const state: VPNExitState = {
        isRegistered: true,
        nodeId: '0x1234567890abcdef',
        status: 'active',
        activeClients: 50,
        bytesTransferred: 1099511627776n, // 1 TB
        uptime: 86400000, // 1 day in ms
      }

      const result = validateVPNExitState(state)
      expect(result.status).toBe('active')
      expect(result.activeClients).toBe(50)
    })

    test('validates inactive state', () => {
      const state: VPNExitState = {
        isRegistered: false,
        status: 'inactive',
        activeClients: 0,
        bytesTransferred: 0n,
        uptime: 0,
      }

      const result = validateVPNExitState(state)
      expect(result.status).toBe('inactive')
      expect(result.nodeId).toBeUndefined()
    })

    test('validates suspended state', () => {
      const state: VPNExitState = {
        isRegistered: true,
        nodeId: '0xabcdef',
        status: 'suspended',
        activeClients: 0,
        bytesTransferred: 500000000000n,
        uptime: 3600000,
      }

      const result = validateVPNExitState(state)
      expect(result.status).toBe('suspended')
    })

    test('rejects negative active clients', () => {
      const state = {
        isRegistered: true,
        status: 'active',
        activeClients: -1,
        bytesTransferred: 0n,
        uptime: 0,
      }

      expect(() => validateVPNExitState(state)).toThrow()
    })

    test('rejects invalid status', () => {
      const state = {
        isRegistered: true,
        status: 'unknown',
        activeClients: 0,
        bytesTransferred: 0n,
        uptime: 0,
      }

      expect(() => validateVPNExitState(state)).toThrow()
    })
  })
})

describe('IP Pool Management', () => {
  function parseIpPool(cidr: string): {
    baseIp: string
    prefixLength: number
    totalIps: number
  } {
    const [baseIp, prefix] = cidr.split('/')
    const prefixLength = parseInt(prefix, 10)
    const totalIps = 2 ** (32 - prefixLength) - 2 // Subtract network and broadcast

    return { baseIp, prefixLength, totalIps }
  }

  function ipToInt(ip: string): number {
    const parts = ip.split('.').map(Number)
    return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]
  }

  function intToIp(num: number): string {
    return [
      (num >>> 24) & 255,
      (num >>> 16) & 255,
      (num >>> 8) & 255,
      num & 255,
    ].join('.')
  }

  test('parses /24 pool correctly', () => {
    const pool = parseIpPool('10.0.0.0/24')
    expect(pool.baseIp).toBe('10.0.0.0')
    expect(pool.prefixLength).toBe(24)
    expect(pool.totalIps).toBe(254) // 256 - 2
  })

  test('parses /16 pool correctly', () => {
    const pool = parseIpPool('172.16.0.0/16')
    expect(pool.totalIps).toBe(65534) // 65536 - 2
  })

  test('parses /30 pool correctly', () => {
    const pool = parseIpPool('10.0.0.0/30')
    expect(pool.totalIps).toBe(2) // 4 - 2 (only 2 usable)
  })

  test('converts IP to integer and back', () => {
    const testIps = ['10.0.0.1', '192.168.1.100', '172.16.255.254']

    for (const ip of testIps) {
      const num = ipToInt(ip)
      const result = intToIp(num)
      expect(result).toBe(ip)
    }
  })
})

describe('DoS Protection', () => {
  interface DoSState {
    packetCounts: Map<string, number>
    lastReset: number
    windowMs: number
    threshold: number
  }

  function createDoSState(windowMs: number, threshold: number): DoSState {
    return {
      packetCounts: new Map(),
      lastReset: Date.now(),
      windowMs,
      threshold,
    }
  }

  function checkRateLimit(state: DoSState, clientIp: string): boolean {
    const now = Date.now()

    // Reset window if needed
    if (now - state.lastReset > state.windowMs) {
      state.packetCounts.clear()
      state.lastReset = now
    }

    const count = (state.packetCounts.get(clientIp) ?? 0) + 1
    state.packetCounts.set(clientIp, count)

    return count <= state.threshold
  }

  test('allows traffic within limit', () => {
    const state = createDoSState(1000, 100)

    for (let i = 0; i < 50; i++) {
      expect(checkRateLimit(state, '1.2.3.4')).toBe(true)
    }
  })

  test('blocks traffic over limit', () => {
    const state = createDoSState(1000, 10)

    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit(state, '1.2.3.4')).toBe(true)
    }

    // 11th request should be blocked
    expect(checkRateLimit(state, '1.2.3.4')).toBe(false)
  })

  test('tracks different IPs separately', () => {
    const state = createDoSState(1000, 5)

    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(state, '1.2.3.4')).toBe(true)
    }
    expect(checkRateLimit(state, '1.2.3.4')).toBe(false)

    // Different IP should still be allowed
    expect(checkRateLimit(state, '5.6.7.8')).toBe(true)
  })
})

describe('WireGuard Packet Types', () => {
  const MESSAGE_HANDSHAKE_INITIATION = 1
  const MESSAGE_HANDSHAKE_RESPONSE = 2
  const MESSAGE_COOKIE_REPLY = 3
  const MESSAGE_TRANSPORT_DATA = 4

  function getMessageType(data: Uint8Array): number {
    if (data.length < 4) return -1
    return data[0]
  }

  test('identifies handshake initiation', () => {
    const packet = new Uint8Array([MESSAGE_HANDSHAKE_INITIATION, 0, 0, 0])
    expect(getMessageType(packet)).toBe(MESSAGE_HANDSHAKE_INITIATION)
  })

  test('identifies handshake response', () => {
    const packet = new Uint8Array([MESSAGE_HANDSHAKE_RESPONSE, 0, 0, 0])
    expect(getMessageType(packet)).toBe(MESSAGE_HANDSHAKE_RESPONSE)
  })

  test('identifies cookie reply', () => {
    const packet = new Uint8Array([MESSAGE_COOKIE_REPLY, 0, 0, 0])
    expect(getMessageType(packet)).toBe(MESSAGE_COOKIE_REPLY)
  })

  test('identifies transport data', () => {
    const packet = new Uint8Array([MESSAGE_TRANSPORT_DATA, 0, 0, 0])
    expect(getMessageType(packet)).toBe(MESSAGE_TRANSPORT_DATA)
  })

  test('rejects short packets', () => {
    const packet = new Uint8Array([1, 2])
    expect(getMessageType(packet)).toBe(-1)
  })
})
