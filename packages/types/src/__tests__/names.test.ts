import { describe, expect, it } from 'bun:test'
import {
  JNSLabelSchema,
  JNSNameSchema,
  JNSRegistrationSchema,
  JNSRegistrationParamsSchema,
  JNSRenewalParamsSchema,
  JNSAppConfigSchema,
  JNSResolverDataSchema,
  JNS_TEXT_KEYS,
  JNSReverseRecordSchema,
  JNSPricingSchema,
  JNSPriceQuoteSchema,
  JEJU_APP_NAMES,
  JNSAppRegistryEntrySchema,
  JNSNameRegisteredEventSchema,
  JNSNameRenewedEventSchema,
  JNSNameTransferredEventSchema,
  JNSResolverChangedEventSchema,
  JNSLookupResultSchema,
  JNSSearchParamsSchema,
  JNSSearchResultSchema,
  JNSContractAddressesSchema,
  validateJNSName,
  formatJNSName,
  parseJNSName,
} from '../names'

describe('Names Types', () => {
  describe('JNSLabelSchema', () => {
    it('validates valid labels', () => {
      expect(JNSLabelSchema.parse('myapp')).toBe('myapp')
      expect(JNSLabelSchema.parse('my-app')).toBe('my-app')
      expect(JNSLabelSchema.parse('app123')).toBe('app123')
      expect(JNSLabelSchema.parse('123app')).toBe('123app')
    })

    it('rejects labels shorter than 3 characters', () => {
      expect(() => JNSLabelSchema.parse('ab')).toThrow()
      expect(() => JNSLabelSchema.parse('a')).toThrow()
    })

    it('rejects labels with uppercase', () => {
      expect(() => JNSLabelSchema.parse('MyApp')).toThrow()
      expect(() => JNSLabelSchema.parse('MYAPP')).toThrow()
    })

    it('rejects labels with consecutive hyphens', () => {
      expect(() => JNSLabelSchema.parse('my--app')).toThrow()
    })

    it('rejects labels starting or ending with hyphen', () => {
      expect(() => JNSLabelSchema.parse('-myapp')).toThrow()
      expect(() => JNSLabelSchema.parse('myapp-')).toThrow()
    })

    it('rejects labels with special characters', () => {
      expect(() => JNSLabelSchema.parse('my_app')).toThrow()
      expect(() => JNSLabelSchema.parse('my.app')).toThrow()
      expect(() => JNSLabelSchema.parse('my@app')).toThrow()
    })
  })

  describe('JNSNameSchema', () => {
    it('validates names ending with .jeju', () => {
      const result = JNSNameSchema.parse('myapp.jeju')
      expect(result).toBe('myapp.jeju')
    })

    it('rejects names without .jeju suffix', () => {
      expect(() => JNSNameSchema.parse('myapp')).toThrow()
      expect(() => JNSNameSchema.parse('myapp.eth')).toThrow()
    })
  })

  describe('JNSRegistrationSchema', () => {
    it('validates registration', () => {
      const registration = {
        name: 'myapp',
        fullName: 'myapp.jeju',
        node: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        labelhash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        owner: '0x1234567890123456789012345678901234567890',
        resolver: '0x2345678901234567890123456789012345678901',
        registeredAt: Date.now() - 86400000,
        expiresAt: Date.now() + 86400000 * 365,
        inGracePeriod: false,
      }
      expect(() => JNSRegistrationSchema.parse(registration)).not.toThrow()
    })
  })

  describe('JNSRegistrationParamsSchema', () => {
    it('validates registration params', () => {
      const params = {
        name: 'myapp',
        owner: '0x1234567890123456789012345678901234567890',
        duration: 31536000, // 1 year in seconds
        resolver: '0x2345678901234567890123456789012345678901',
        resolverData: {
          addr: '0x1234567890123456789012345678901234567890',
          text: { url: 'https://myapp.com' },
        },
      }
      expect(() => JNSRegistrationParamsSchema.parse(params)).not.toThrow()
    })

    it('validates minimal params', () => {
      const params = {
        name: 'myapp',
        owner: '0x1234567890123456789012345678901234567890',
        duration: 31536000,
      }
      expect(() => JNSRegistrationParamsSchema.parse(params)).not.toThrow()
    })
  })

  describe('JNSRenewalParamsSchema', () => {
    it('validates renewal params', () => {
      const params = {
        name: 'myapp',
        duration: 31536000,
      }
      expect(() => JNSRenewalParamsSchema.parse(params)).not.toThrow()
    })
  })

  describe('JNSAppConfigSchema', () => {
    it('validates app config', () => {
      const config = {
        appContract: '0x1234567890123456789012345678901234567890',
        appId: 'com.example.myapp',
        agentId: 12345n,
        endpoint: 'https://api.myapp.com',
        a2aEndpoint: 'https://a2a.myapp.com',
        mcpEndpoint: 'https://mcp.myapp.com',
      }
      expect(() => JNSAppConfigSchema.parse(config)).not.toThrow()
    })

    it('validates empty config', () => {
      const config = {}
      expect(() => JNSAppConfigSchema.parse(config)).not.toThrow()
    })
  })

  describe('JNSResolverDataSchema', () => {
    it('validates resolver data', () => {
      const data = {
        addr: '0x1234567890123456789012345678901234567890',
        contenthash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        text: {
          url: 'https://myapp.com',
          description: 'My awesome app',
        },
        app: {
          endpoint: 'https://api.myapp.com',
        },
      }
      expect(() => JNSResolverDataSchema.parse(data)).not.toThrow()
    })
  })

  describe('JNS_TEXT_KEYS', () => {
    it('contains expected keys', () => {
      expect(JNS_TEXT_KEYS.URL).toBe('url')
      expect(JNS_TEXT_KEYS.DESCRIPTION).toBe('description')
      expect(JNS_TEXT_KEYS.AVATAR).toBe('avatar')
      expect(JNS_TEXT_KEYS.GITHUB).toBe('com.github')
      expect(JNS_TEXT_KEYS.TWITTER).toBe('com.twitter')
      expect(JNS_TEXT_KEYS.TELEGRAM).toBe('com.telegram')
      expect(JNS_TEXT_KEYS.DISCORD).toBe('com.discord')
      expect(JNS_TEXT_KEYS.EMAIL).toBe('email')
      expect(JNS_TEXT_KEYS.APP_ENDPOINT).toBe('app.endpoint')
      expect(JNS_TEXT_KEYS.APP_A2A).toBe('app.a2a')
      expect(JNS_TEXT_KEYS.APP_MCP).toBe('app.mcp')
    })
  })

  describe('JNSReverseRecordSchema', () => {
    it('validates reverse record', () => {
      const record = {
        address: '0x1234567890123456789012345678901234567890',
        node: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
        name: 'myapp.jeju',
      }
      expect(() => JNSReverseRecordSchema.parse(record)).not.toThrow()
    })
  })

  describe('JNSPricingSchema', () => {
    it('validates pricing', () => {
      const pricing = {
        basePrice: 10000000000000000n,
        premium3Char: 10,
        premium4Char: 3,
        agentDiscountBps: 1000,
      }
      expect(() => JNSPricingSchema.parse(pricing)).not.toThrow()
    })
  })

  describe('JNSPriceQuoteSchema', () => {
    it('validates price quote', () => {
      const quote = {
        name: 'myapp',
        duration: 31536000,
        basePrice: 10000000000000000n,
        discount: 1000000000000000n,
        finalPrice: 9000000000000000n,
        hasAgentDiscount: true,
      }
      expect(() => JNSPriceQuoteSchema.parse(quote)).not.toThrow()
    })
  })

  describe('JEJU_APP_NAMES', () => {
    it('contains expected app names', () => {
      expect(JEJU_APP_NAMES.GATEWAY).toBe('gateway.jeju')
      expect(JEJU_APP_NAMES.BAZAAR).toBe('bazaar.jeju')
      expect(JEJU_APP_NAMES.COMPUTE).toBe('compute.jeju')
      expect(JEJU_APP_NAMES.STORAGE).toBe('storage.jeju')
      expect(JEJU_APP_NAMES.INDEXER).toBe('indexer.jeju')
      expect(JEJU_APP_NAMES.CLOUD).toBe('cloud.jeju')
      expect(JEJU_APP_NAMES.INTENTS).toBe('intents.jeju')
      expect(JEJU_APP_NAMES.DOCUMENTATION).toBe('docs.jeju')
      expect(JEJU_APP_NAMES.MONITORING).toBe('monitoring.jeju')
    })
  })

  describe('JNSAppRegistryEntrySchema', () => {
    it('validates app registry entry', () => {
      const entry = {
        jnsName: 'gateway.jeju',
        node: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        agentId: 1n,
        endpoint: 'https://gateway.jeju.network',
        a2aEndpoint: 'https://a2a.gateway.jeju.network',
      }
      expect(() => JNSAppRegistryEntrySchema.parse(entry)).not.toThrow()
    })
  })

  describe('JNSNameRegisteredEventSchema', () => {
    it('validates name registered event', () => {
      const event = {
        node: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        name: 'myapp',
        owner: '0x1234567890123456789012345678901234567890',
        expires: BigInt(Date.now() + 86400000 * 365),
        cost: 10000000000000000n,
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
        blockNumber: 12345678n,
      }
      expect(() => JNSNameRegisteredEventSchema.parse(event)).not.toThrow()
    })
  })

  describe('JNSNameRenewedEventSchema', () => {
    it('validates name renewed event', () => {
      const event = {
        node: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        name: 'myapp',
        expires: BigInt(Date.now() + 86400000 * 730),
        cost: 10000000000000000n,
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
        blockNumber: 12345679n,
      }
      expect(() => JNSNameRenewedEventSchema.parse(event)).not.toThrow()
    })
  })

  describe('JNSNameTransferredEventSchema', () => {
    it('validates name transferred event', () => {
      const event = {
        node: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        from: '0x1234567890123456789012345678901234567890',
        to: '0x2345678901234567890123456789012345678901',
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
        blockNumber: 12345680n,
      }
      expect(() => JNSNameTransferredEventSchema.parse(event)).not.toThrow()
    })
  })

  describe('JNSResolverChangedEventSchema', () => {
    it('validates resolver changed event', () => {
      const event = {
        node: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        resolver: '0x3456789012345678901234567890123456789012',
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
        blockNumber: 12345681n,
      }
      expect(() => JNSResolverChangedEventSchema.parse(event)).not.toThrow()
    })
  })

  describe('JNSLookupResultSchema', () => {
    it('validates lookup result for existing name', () => {
      const result = {
        exists: true,
        registration: {
          name: 'myapp',
          fullName: 'myapp.jeju',
          node: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          labelhash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
          owner: '0x1234567890123456789012345678901234567890',
          resolver: '0x2345678901234567890123456789012345678901',
          registeredAt: Date.now() - 86400000,
          expiresAt: Date.now() + 86400000 * 365,
          inGracePeriod: false,
        },
        resolverData: {
          addr: '0x1234567890123456789012345678901234567890',
        },
      }
      expect(() => JNSLookupResultSchema.parse(result)).not.toThrow()
    })

    it('validates lookup result for non-existing name', () => {
      const result = {
        exists: false,
      }
      expect(() => JNSLookupResultSchema.parse(result)).not.toThrow()
    })
  })

  describe('JNSSearchParamsSchema', () => {
    it('validates search params', () => {
      const params = {
        query: 'app',
        owner: '0x1234567890123456789012345678901234567890',
        category: 'defi',
        tag: 'trading',
        includeExpired: false,
        offset: 0,
        limit: 20,
      }
      expect(() => JNSSearchParamsSchema.parse(params)).not.toThrow()
    })

    it('validates empty params', () => {
      const params = {}
      expect(() => JNSSearchParamsSchema.parse(params)).not.toThrow()
    })
  })

  describe('JNSSearchResultSchema', () => {
    it('validates search result', () => {
      const result = {
        names: [
          {
            name: 'myapp',
            fullName: 'myapp.jeju',
            node: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
            labelhash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
            owner: '0x1234567890123456789012345678901234567890',
            resolver: '0x2345678901234567890123456789012345678901',
            registeredAt: Date.now() - 86400000,
            expiresAt: Date.now() + 86400000 * 365,
            inGracePeriod: false,
          },
        ],
        total: 1,
        hasMore: false,
      }
      expect(() => JNSSearchResultSchema.parse(result)).not.toThrow()
    })
  })

  describe('JNSContractAddressesSchema', () => {
    it('validates contract addresses', () => {
      const addresses = {
        registry: '0x1234567890123456789012345678901234567890',
        resolver: '0x2345678901234567890123456789012345678901',
        registrar: '0x3456789012345678901234567890123456789012',
        reverseRegistrar: '0x4567890123456789012345678901234567890123',
      }
      expect(() => JNSContractAddressesSchema.parse(addresses)).not.toThrow()
    })
  })

  describe('Utility Functions', () => {
    describe('validateJNSName', () => {
      it('returns valid for good names', () => {
        expect(validateJNSName('myapp')).toEqual({ valid: true })
        expect(validateJNSName('my-app')).toEqual({ valid: true })
        expect(validateJNSName('app123')).toEqual({ valid: true })
      })

      it('returns invalid for bad names', () => {
        const result = validateJNSName('ab')
        expect(result.valid).toBe(false)
        expect(result.error).toBeDefined()
      })

      it('returns error message for invalid names', () => {
        const result = validateJNSName('My-App')
        expect(result.valid).toBe(false)
        expect(typeof result.error).toBe('string')
      })
    })

    describe('formatJNSName', () => {
      it('adds .jeju suffix', () => {
        expect(formatJNSName('myapp')).toBe('myapp.jeju')
        expect(formatJNSName('my-app')).toBe('my-app.jeju')
      })
    })

    describe('parseJNSName', () => {
      it('removes .jeju suffix', () => {
        expect(parseJNSName('myapp.jeju')).toBe('myapp')
        expect(parseJNSName('my-app.jeju')).toBe('my-app')
      })
    })
  })
})

