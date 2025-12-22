/**
 * @fileoverview Tests for chainlink configuration
 * Tests feed accessors, VRF config, and automation config
 */

import { describe, expect, it } from 'bun:test'
import {
  automation,
  feeds,
  getAutomationConfig,
  getChainlinkFeed,
  getChainlinkFeeds,
  getLinkTokenAddress,
  getSupportedChainIds,
  getVRFConfig,
  hasChainlinkSupport,
  vrf,
} from './index'

describe('Chainlink Feeds', () => {
  describe('feeds JSON structure', () => {
    it('should have linkToken addresses', () => {
      expect(feeds.linkToken).toBeDefined()
      expect(typeof feeds.linkToken).toBe('object')
    })

    it('should have chains configuration', () => {
      expect(feeds.chains).toBeDefined()
      expect(typeof feeds.chains).toBe('object')
    })

    it('should have relay config', () => {
      expect(feeds.relayConfig).toBeDefined()
      expect(feeds.relayConfig.updateThresholdBps).toBeGreaterThan(0)
      expect(feeds.relayConfig.minSourcesForConsensus).toBeGreaterThan(0)
      expect(feeds.relayConfig.maxStalenessSeconds).toBeGreaterThan(0)
      expect(Array.isArray(feeds.relayConfig.priorityChains)).toBe(true)
    })
  })

  describe('getChainlinkFeeds', () => {
    it('should get feeds for Ethereum mainnet', () => {
      const ethFeeds = getChainlinkFeeds(1)
      expect(ethFeeds.length).toBeGreaterThan(0)

      ethFeeds.forEach((feed) => {
        expect(feed.pair).toBeTruthy()
        expect(feed.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
        expect(feed.decimals).toBeGreaterThan(0)
        expect(feed.heartbeatSeconds).toBeGreaterThan(0)
      })
    })

    it('should include ETH/USD feed on Ethereum', () => {
      const ethFeeds = getChainlinkFeeds(1)
      const ethUsd = ethFeeds.find((f) => f.pair === 'ETH/USD')
      expect(ethUsd).toBeDefined()
      expect(ethUsd?.decimals).toBe(8)
    })

    it('should throw for unsupported chain', () => {
      expect(() => getChainlinkFeeds(999999)).toThrow('not configured')
    })
  })

  describe('getChainlinkFeed', () => {
    it('should get specific feed by pair', () => {
      const feed = getChainlinkFeed(1, 'ETH/USD')
      expect(feed.pair).toBe('ETH/USD')
      expect(feed.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(feed.decimals).toBe(8)
    })

    it('should throw for unknown pair', () => {
      expect(() => getChainlinkFeed(1, 'UNKNOWN/PAIR')).toThrow(
        'not configured',
      )
    })

    it('should throw for unknown chain', () => {
      expect(() => getChainlinkFeed(999999, 'ETH/USD')).toThrow(
        'not configured',
      )
    })
  })

  describe('getLinkTokenAddress', () => {
    it('should get LINK token for Ethereum mainnet', () => {
      const linkAddress = getLinkTokenAddress(1)
      expect(linkAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
    })

    it('should throw for unsupported chain', () => {
      expect(() => getLinkTokenAddress(999999)).toThrow('not configured')
    })
  })

  describe('getSupportedChainIds', () => {
    it('should return array of chain IDs', () => {
      const chainIds = getSupportedChainIds()
      expect(Array.isArray(chainIds)).toBe(true)
      expect(chainIds.length).toBeGreaterThan(0)

      chainIds.forEach((id) => {
        expect(typeof id).toBe('number')
        expect(id).toBeGreaterThan(0)
      })
    })

    it('should include Ethereum mainnet', () => {
      const chainIds = getSupportedChainIds()
      expect(chainIds).toContain(1)
    })
  })

  describe('hasChainlinkSupport', () => {
    it('should return true for supported chains', () => {
      expect(hasChainlinkSupport(1)).toBe(true)
    })

    it('should return false for unsupported chains', () => {
      expect(hasChainlinkSupport(999999)).toBe(false)
    })
  })
})

describe('Chainlink VRF', () => {
  describe('vrf JSON structure', () => {
    it('should have chains configuration', () => {
      expect(vrf.chains).toBeDefined()
      expect(typeof vrf.chains).toBe('object')
    })

    it('should have Jeju VRF config', () => {
      expect(vrf.jejuVrfConfig).toBeDefined()
      expect(vrf.jejuVrfConfig.pricing).toBeDefined()
      expect(vrf.jejuVrfConfig.limits).toBeDefined()
      expect(vrf.jejuVrfConfig.governance).toBeDefined()
    })
  })

  describe('getVRFConfig', () => {
    it('should get VRF config for supported chain', () => {
      // Get chain IDs from vrf.chains
      const chainIds = Object.keys(vrf.chains).map(Number)

      if (chainIds.length > 0) {
        const config = getVRFConfig(chainIds[0])
        expect(config.coordinator).toMatch(/^0x[a-fA-F0-9]{40}$/)
        expect(config.wrapper).toMatch(/^0x[a-fA-F0-9]{40}$/)
        expect(config.linkToken).toMatch(/^0x[a-fA-F0-9]{40}$/)
        expect(config.keyHash).toMatch(/^0x[a-fA-F0-9]{64}$/)
        expect(config.callbackGasLimit).toBeGreaterThan(0)
        expect(config.requestConfirmations).toBeGreaterThan(0)
        expect(config.numWords).toBeGreaterThan(0)
        expect(['pending_deployment', 'reference', 'active']).toContain(
          config.status,
        )
      }
    })

    it('should throw for unsupported chain', () => {
      expect(() => getVRFConfig(999999)).toThrow('not configured')
    })
  })

  describe('Jeju VRF Config', () => {
    it('should have valid pricing config', () => {
      expect(typeof vrf.jejuVrfConfig.pricing.linkPremiumPpm).toBe('number')
      expect(typeof vrf.jejuVrfConfig.pricing.nativePremiumPpm).toBe('number')
      expect(typeof vrf.jejuVrfConfig.pricing.flatFeeLinkPpm).toBe('number')
      expect(typeof vrf.jejuVrfConfig.pricing.flatFeeNativePpm).toBe('number')
    })

    it('should have valid limits config', () => {
      expect(vrf.jejuVrfConfig.limits.maxGasLimit).toBeGreaterThan(0)
      expect(vrf.jejuVrfConfig.limits.maxNumWords).toBeGreaterThan(0)
      expect(
        vrf.jejuVrfConfig.limits.minRequestConfirmations,
      ).toBeGreaterThanOrEqual(1)
      expect(vrf.jejuVrfConfig.limits.maxRequestConfirmations).toBeGreaterThan(
        vrf.jejuVrfConfig.limits.minRequestConfirmations,
      )
    })

    it('should have valid governance config', () => {
      expect(vrf.jejuVrfConfig.governance.feeRecipient).toBeTruthy()
      expect(
        typeof vrf.jejuVrfConfig.governance.feeUpdateProposalRequired,
      ).toBe('boolean')
      expect(vrf.jejuVrfConfig.governance.maxFeeIncreaseBps).toBeGreaterThan(0)
    })
  })
})

describe('Chainlink Automation', () => {
  describe('automation JSON structure', () => {
    it('should have chains configuration', () => {
      expect(automation.chains).toBeDefined()
      expect(typeof automation.chains).toBe('object')
    })

    it('should have Jeju automation config', () => {
      expect(automation.jejuAutomationConfig).toBeDefined()
      expect(automation.jejuAutomationConfig.keeper).toBeDefined()
      expect(automation.jejuAutomationConfig.upkeep).toBeDefined()
      expect(automation.jejuAutomationConfig.fees).toBeDefined()
      expect(automation.jejuAutomationConfig.governance).toBeDefined()
    })
  })

  describe('getAutomationConfig', () => {
    it('should get automation config for supported chain', () => {
      const chainIds = Object.keys(automation.chains).map(Number)

      if (chainIds.length > 0) {
        const config = getAutomationConfig(chainIds[0])
        expect(config.registry).toMatch(/^0x[a-fA-F0-9]{40}$/)
        expect(config.registrar).toMatch(/^0x[a-fA-F0-9]{40}$/)
        expect(config.minBalance).toBeTruthy()
        expect(config.defaultGasLimit).toBeGreaterThan(0)
        expect(config.maxGasLimit).toBeGreaterThan(config.defaultGasLimit)
        expect(typeof config.keeperRewardBps).toBe('number')
        expect(typeof config.protocolFeeBps).toBe('number')
        expect(['pending_deployment', 'active']).toContain(config.status)
      }
    })

    it('should throw for unsupported chain', () => {
      expect(() => getAutomationConfig(999999)).toThrow('not configured')
    })
  })

  describe('Jeju Automation Config', () => {
    it('should have valid keeper config', () => {
      expect(automation.jejuAutomationConfig.keeper.minStakeEth).toBeTruthy()
      expect(automation.jejuAutomationConfig.keeper.maxKeepers).toBeGreaterThan(
        0,
      )
      expect(
        automation.jejuAutomationConfig.keeper.selectionAlgorithm,
      ).toBeTruthy()
      expect(
        automation.jejuAutomationConfig.keeper.performanceThreshold,
      ).toBeGreaterThan(0)
    })

    it('should have valid upkeep config', () => {
      expect(automation.jejuAutomationConfig.upkeep.minBalanceEth).toBeTruthy()
      expect(
        automation.jejuAutomationConfig.upkeep.maxUpkeepsPerAddress,
      ).toBeGreaterThan(0)
      expect(
        automation.jejuAutomationConfig.upkeep.defaultCheckGasLimit,
      ).toBeGreaterThan(0)
      expect(
        automation.jejuAutomationConfig.upkeep.defaultPerformGasLimit,
      ).toBeGreaterThan(0)
      expect(
        automation.jejuAutomationConfig.upkeep.minInterval,
      ).toBeGreaterThan(0)
      expect(
        automation.jejuAutomationConfig.upkeep.maxInterval,
      ).toBeGreaterThan(automation.jejuAutomationConfig.upkeep.minInterval)
    })

    it('should have valid fees config', () => {
      expect(
        automation.jejuAutomationConfig.fees.registrationFeeEth,
      ).toBeTruthy()
      expect(
        typeof automation.jejuAutomationConfig.fees.performPremiumBps,
      ).toBe('number')
      expect(
        typeof automation.jejuAutomationConfig.fees.cancellationFeeBps,
      ).toBe('number')
    })

    it('should have valid governance config', () => {
      expect(
        automation.jejuAutomationConfig.governance.feeRecipient,
      ).toBeTruthy()
      expect(
        typeof automation.jejuAutomationConfig.governance
          .keeperApprovalRequired,
      ).toBe('boolean')
      expect(
        automation.jejuAutomationConfig.governance.parameterUpdateDelay,
      ).toBeGreaterThan(0)
    })
  })
})

describe('Schema Validation', () => {
  describe('Feed entries', () => {
    it('all feed addresses should be valid', () => {
      Object.entries(feeds.chains).forEach(([_chainId, chainFeeds]) => {
        Object.entries(chainFeeds).forEach(([_pair, feed]) => {
          expect((feed as { address: string }).address).toMatch(
            /^0x[a-fA-F0-9]{40}$/,
          )
          expect((feed as { decimals: number }).decimals).toBeGreaterThan(0)
          expect(
            (feed as { heartbeatSeconds: number }).heartbeatSeconds,
          ).toBeGreaterThan(0)
        })
      })
    })
  })

  describe('VRF entries', () => {
    it('all VRF addresses should be valid', () => {
      Object.entries(vrf.chains).forEach(([_chainId, config]) => {
        const vrfConfig = config as {
          coordinator: string
          wrapper: string
          linkToken: string
          linkEthFeed: string
          keyHash: string
        }
        expect(vrfConfig.coordinator).toMatch(/^0x[a-fA-F0-9]{40}$/)
        expect(vrfConfig.wrapper).toMatch(/^0x[a-fA-F0-9]{40}$/)
        expect(vrfConfig.linkToken).toMatch(/^0x[a-fA-F0-9]{40}$/)
        expect(vrfConfig.linkEthFeed).toMatch(/^0x[a-fA-F0-9]{40}$/)
        expect(vrfConfig.keyHash).toMatch(/^0x[a-fA-F0-9]{64}$/)
      })
    })
  })

  describe('Automation entries', () => {
    it('all automation addresses should be valid', () => {
      Object.entries(automation.chains).forEach(([_chainId, config]) => {
        const autoConfig = config as {
          registry: string
          registrar: string
        }
        expect(autoConfig.registry).toMatch(/^0x[a-fA-F0-9]{40}$/)
        expect(autoConfig.registrar).toMatch(/^0x[a-fA-F0-9]{40}$/)
      })
    })
  })
})

describe('Basis Points Validation', () => {
  it('VRF fee increase should be reasonable', () => {
    const maxIncreaseBps = vrf.jejuVrfConfig.governance.maxFeeIncreaseBps
    expect(maxIncreaseBps).toBeGreaterThan(0)
    expect(maxIncreaseBps).toBeLessThanOrEqual(10000) // 100%
  })

  it('automation fees should be reasonable', () => {
    const performPremium =
      automation.jejuAutomationConfig.fees.performPremiumBps
    const cancellationFee =
      automation.jejuAutomationConfig.fees.cancellationFeeBps

    expect(performPremium).toBeGreaterThanOrEqual(0)
    expect(performPremium).toBeLessThanOrEqual(10000)
    expect(cancellationFee).toBeGreaterThanOrEqual(0)
    expect(cancellationFee).toBeLessThanOrEqual(10000)
  })
})
