import { describe, expect, it } from 'bun:test'
import {
  ContributionQuotaSchema,
  ContributionSettingsSchema,
  CountryCodeSchema,
  CountryLegalStatusSchema,
  DEFAULT_CONTRIBUTION_SETTINGS,
  DEFAULT_VPN_CONNECT_OPTIONS,
  DEFAULT_VPN_PRICING,
  VPN_LEGAL_COUNTRIES,
  VPNCapabilitySchema,
  VPNClientConfigSchema,
  VPNConnectionStatusSchema,
  VPNConnectOptionsSchema,
  VPNNodeInfoSchema,
  VPNNodeQuerySchema,
  VPNNodeRegisteredEventSchema,
  VPNNodeSchema,
  VPNNodeStatusSchema,
  VPNNodeTypeSchema,
  VPNPaymentEventSchema,
  VPNPricingSchema,
  VPNProtocolSchema,
  VPNProviderEarningsSchema,
  VPNSessionEndedEventSchema,
  VPNSessionStartedEventSchema,
  WireGuardConfigSchema,
  WireGuardPeerSchema,
} from '../vpn'

describe('VPN Types', () => {
  describe('CountryCodeSchema', () => {
    it('validates common country codes', () => {
      const codes = ['US', 'CA', 'GB', 'DE', 'FR', 'JP', 'SG', 'AU', 'NL', 'CH']
      for (const code of codes) {
        expect(CountryCodeSchema.parse(code)).toEqual(code)
      }
    })

    it('validates blocked country codes', () => {
      const blocked = ['CN', 'RU', 'IR', 'AE', 'BY', 'OM', 'TM', 'KP']
      for (const code of blocked) {
        expect(CountryCodeSchema.parse(code)).toEqual(code)
      }
    })
  })

  describe('CountryLegalStatusSchema', () => {
    it('validates country legal status', () => {
      const status = {
        countryCode: 'NL',
        vpnLegal: true,
        canBeExitNode: true,
        canBeClient: true,
        requiresExtraConsent: false,
        notes: 'Strong privacy laws',
      }
      expect(() => CountryLegalStatusSchema.parse(status)).not.toThrow()
    })
  })

  describe('VPN_LEGAL_COUNTRIES', () => {
    it('contains expected legal countries', () => {
      const legalCodes = VPN_LEGAL_COUNTRIES.filter((c) => c.vpnLegal).map(
        (c) => c.countryCode,
      )
      expect(legalCodes).toContain('NL')
      expect(legalCodes).toContain('CH')
      expect(legalCodes).toContain('US')
      expect(legalCodes).toContain('JP')
    })

    it('contains expected blocked countries', () => {
      const blockedCodes = VPN_LEGAL_COUNTRIES.filter((c) => !c.vpnLegal).map(
        (c) => c.countryCode,
      )
      expect(blockedCodes).toContain('CN')
      expect(blockedCodes).toContain('RU')
      expect(blockedCodes).toContain('IR')
    })
  })

  describe('VPNNodeTypeSchema', () => {
    it('validates all node types', () => {
      const types = ['residential', 'datacenter', 'mobile']
      for (const type of types) {
        expect(VPNNodeTypeSchema.parse(type)).toEqual(type)
      }
    })
  })

  describe('VPNCapabilitySchema', () => {
    it('validates all capabilities', () => {
      const caps = ['wireguard', 'socks5', 'http_connect', 'cdn']
      for (const cap of caps) {
        expect(VPNCapabilitySchema.parse(cap)).toEqual(cap)
      }
    })
  })

  describe('VPNNodeStatusSchema', () => {
    it('validates all statuses', () => {
      const statuses = ['online', 'busy', 'offline', 'suspended']
      for (const status of statuses) {
        expect(VPNNodeStatusSchema.parse(status)).toEqual(status)
      }
    })
  })

  describe('VPNNodeSchema', () => {
    it('validates VPN node', () => {
      const node = {
        nodeId:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        operator: '0x1234567890123456789012345678901234567890',
        agentId: 12345n,
        countryCode: 'NL',
        regionCode: 'eu-west-1',
        endpoint: 'vpn1.example.com',
        wireguardPubKey: 'ABC123publickey=',
        port: 51820,
        nodeType: 'datacenter',
        capabilities: ['wireguard', 'socks5'],
        maxBandwidthMbps: 1000,
        maxConnections: 100,
        stake: 10000000000000000000000n,
        registeredAt: Date.now() - 86400000 * 30,
        status: 'online',
        lastSeen: Date.now(),
        totalBytesServed: 1000000000000n,
        totalSessions: 50000n,
        successRate: 99.5,
        avgLatencyMs: 25,
      }
      expect(() => VPNNodeSchema.parse(node)).not.toThrow()
    })
  })

  describe('VPNNodeInfoSchema', () => {
    it('validates VPN node info', () => {
      const info = {
        node: {
          nodeId:
            '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          operator: '0x1234567890123456789012345678901234567890',
          countryCode: 'US',
          regionCode: 'us-east-1',
          endpoint: 'vpn.example.com',
          port: 51820,
          nodeType: 'datacenter',
          capabilities: ['wireguard'],
          maxBandwidthMbps: 500,
          maxConnections: 50,
          stake: 5000000000000000000000n,
          registeredAt: Date.now(),
          status: 'online',
          lastSeen: Date.now(),
          totalBytesServed: 0n,
          totalSessions: 0n,
          successRate: 100,
          avgLatencyMs: 0,
        },
        latencyMs: 50,
        load: 25,
        recommended: true,
        reputationScore: 95,
      }
      expect(() => VPNNodeInfoSchema.parse(info)).not.toThrow()
    })
  })

  describe('ContributionQuotaSchema', () => {
    it('validates contribution quota', () => {
      const quota = {
        vpnBytesUsed: 1000000000n,
        contributionCap: 3000000000n,
        bytesContributed: 500000000n,
        cdnBytesServed: 400000000n,
        relayBytesServed: 100000000n,
        quotaRemaining: 2500000000n,
        isContributing: true,
        contributionPaused: false,
        periodStart: Date.now() - 86400000 * 15,
        periodEnd: Date.now() + 86400000 * 15,
      }
      expect(() => ContributionQuotaSchema.parse(quota)).not.toThrow()
    })
  })

  describe('ContributionSettingsSchema', () => {
    it('validates contribution settings', () => {
      const settings = {
        enableAutoContribution: true,
        maxBandwidthPercent: 10,
        maxBandwidthMbps: 50,
        shareCDN: true,
        shareVPNRelay: true,
        enableSchedule: false,
        scheduleStart: '22:00',
        scheduleEnd: '06:00',
        earningModeEnabled: false,
        earningBandwidthPercent: 50,
      }
      expect(() => ContributionSettingsSchema.parse(settings)).not.toThrow()
    })
  })

  describe('DEFAULT_CONTRIBUTION_SETTINGS', () => {
    it('is a valid ContributionSettings', () => {
      expect(() =>
        ContributionSettingsSchema.parse(DEFAULT_CONTRIBUTION_SETTINGS),
      ).not.toThrow()
    })

    it('has sensible defaults', () => {
      expect(DEFAULT_CONTRIBUTION_SETTINGS.enableAutoContribution).toBe(true)
      expect(DEFAULT_CONTRIBUTION_SETTINGS.maxBandwidthPercent).toBe(10)
      expect(DEFAULT_CONTRIBUTION_SETTINGS.shareCDN).toBe(true)
    })
  })

  describe('VPNProtocolSchema', () => {
    it('validates all protocols', () => {
      const protocols = ['wireguard', 'socks5', 'http']
      for (const protocol of protocols) {
        expect(VPNProtocolSchema.parse(protocol)).toEqual(protocol)
      }
    })
  })

  describe('VPNConnectionStatusSchema', () => {
    it('validates all connection statuses', () => {
      const statuses = [
        'disconnected',
        'connecting',
        'connected',
        'reconnecting',
        'error',
      ]
      for (const status of statuses) {
        expect(VPNConnectionStatusSchema.parse(status)).toEqual(status)
      }
    })
  })

  describe('VPNConnectOptionsSchema', () => {
    it('validates connect options', () => {
      const options = {
        nodeId:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        countryCode: 'NL',
        regionCode: 'eu-west-1',
        protocol: 'wireguard',
        killSwitch: true,
        splitTunnel: ['spotify.com', 'netflix.com'],
        dns: ['1.1.1.1', '8.8.8.8'],
        autoReconnect: true,
        reconnectAttempts: 5,
      }
      expect(() => VPNConnectOptionsSchema.parse(options)).not.toThrow()
    })
  })

  describe('DEFAULT_VPN_CONNECT_OPTIONS', () => {
    it('is valid VPNConnectOptions', () => {
      expect(() =>
        VPNConnectOptionsSchema.parse(DEFAULT_VPN_CONNECT_OPTIONS),
      ).not.toThrow()
    })

    it('has sensible defaults', () => {
      expect(DEFAULT_VPN_CONNECT_OPTIONS.protocol).toBe('wireguard')
      expect(DEFAULT_VPN_CONNECT_OPTIONS.killSwitch).toBe(true)
      expect(DEFAULT_VPN_CONNECT_OPTIONS.autoReconnect).toBe(true)
    })
  })

  describe('WireGuardPeerSchema', () => {
    it('validates WireGuard peer', () => {
      const peer = {
        publicKey: 'ABC123publickey=',
        endpoint: 'vpn.example.com:51820',
        allowedIPs: ['0.0.0.0/0', '::/0'],
        persistentKeepalive: 25,
      }
      expect(() => WireGuardPeerSchema.parse(peer)).not.toThrow()
    })
  })

  describe('WireGuardConfigSchema', () => {
    it('validates WireGuard config', () => {
      const config = {
        privateKey: 'privatekey123=',
        address: ['10.0.0.2/24'],
        dns: ['1.1.1.1'],
        mtu: 1420,
        peers: [
          {
            publicKey: 'peerpubkey=',
            endpoint: 'vpn.example.com:51820',
            allowedIPs: ['0.0.0.0/0'],
          },
        ],
      }
      expect(() => WireGuardConfigSchema.parse(config)).not.toThrow()
    })
  })

  describe('VPNClientConfigSchema', () => {
    it('validates VPN client config', () => {
      const config = {
        rpcUrl: 'https://rpc.example.com',
        chainId: 1,
        contracts: {
          vpnRegistry: '0x1234567890123456789012345678901234567890',
          vpnBilling: '0x2345678901234567890123456789012345678901',
        },
        coordinatorUrl: 'wss://coordinator.example.com',
        bootstrapNodes: ['node1.example.com', 'node2.example.com'],
        defaultCountry: 'NL',
        defaultProtocol: 'wireguard',
      }
      expect(() => VPNClientConfigSchema.parse(config)).not.toThrow()
    })
  })

  describe('VPNNodeQuerySchema', () => {
    it('validates node query', () => {
      const query = {
        countryCode: 'US',
        regionCode: 'us-west-1',
        capabilities: ['wireguard', 'socks5'],
        minBandwidthMbps: 100,
        maxLatencyMs: 50,
        limit: 10,
      }
      expect(() => VPNNodeQuerySchema.parse(query)).not.toThrow()
    })

    it('validates empty query', () => {
      const query = {}
      expect(() => VPNNodeQuerySchema.parse(query)).not.toThrow()
    })
  })

  describe('VPNPricingSchema', () => {
    it('validates VPN pricing', () => {
      const pricing = {
        pricePerGBClient: 100000000000000n,
        pricePerHourClient: 10000000000000n,
        providerSharePercent: 85,
        protocolFeePercent: 10,
        treasuryFeePercent: 5,
        cdnBonusMultiplier: 1.2,
      }
      expect(() => VPNPricingSchema.parse(pricing)).not.toThrow()
    })
  })

  describe('DEFAULT_VPN_PRICING', () => {
    it('is valid VPNPricing', () => {
      expect(() => VPNPricingSchema.parse(DEFAULT_VPN_PRICING)).not.toThrow()
    })

    it('has percentages that sum to 100', () => {
      const total =
        DEFAULT_VPN_PRICING.providerSharePercent +
        DEFAULT_VPN_PRICING.protocolFeePercent +
        DEFAULT_VPN_PRICING.treasuryFeePercent
      expect(total).toBe(100)
    })
  })

  describe('VPNProviderEarningsSchema', () => {
    it('validates provider earnings', () => {
      const earnings = {
        periodStart: Date.now() - 86400000 * 30,
        periodEnd: Date.now(),
        vpnRelayEarnings: 500000000000000000n,
        cdnServingEarnings: 200000000000000000n,
        totalEarnings: 700000000000000000n,
        totalBytesServed: 1000000000000n,
        totalSessions: 5000,
        uniqueClients: 2500,
        pendingWithdrawal: 100000000000000000n,
        lastWithdrawal: Date.now() - 86400000 * 7,
      }
      expect(() => VPNProviderEarningsSchema.parse(earnings)).not.toThrow()
    })
  })

  describe('VPNNodeRegisteredEventSchema', () => {
    it('validates node registered event', () => {
      const event = {
        nodeId:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        operator: '0x1234567890123456789012345678901234567890',
        countryCode: 'NL',
        stake: 10000000000000000000000n,
        timestamp: Date.now(),
      }
      expect(() => VPNNodeRegisteredEventSchema.parse(event)).not.toThrow()
    })
  })

  describe('VPNSessionStartedEventSchema', () => {
    it('validates session started event', () => {
      const event = {
        sessionId: 'session-123',
        clientId: '0x1234567890123456789012345678901234567890',
        nodeId: '0x2345678901234567890123456789012345678901',
        protocol: 'wireguard',
        timestamp: Date.now(),
      }
      expect(() => VPNSessionStartedEventSchema.parse(event)).not.toThrow()
    })
  })

  describe('VPNSessionEndedEventSchema', () => {
    it('validates session ended event', () => {
      const event = {
        sessionId: 'session-123',
        bytesUp: 500000000n,
        bytesDown: 2000000000n,
        durationSeconds: 3600,
        successful: true,
        timestamp: Date.now(),
      }
      expect(() => VPNSessionEndedEventSchema.parse(event)).not.toThrow()
    })
  })

  describe('VPNPaymentEventSchema', () => {
    it('validates payment event', () => {
      const event = {
        sessionId: 'session-123',
        payer: '0x1234567890123456789012345678901234567890',
        provider: '0x2345678901234567890123456789012345678901',
        amount: 100000000000000000n,
        timestamp: Date.now(),
      }
      expect(() => VPNPaymentEventSchema.parse(event)).not.toThrow()
    })
  })
})
