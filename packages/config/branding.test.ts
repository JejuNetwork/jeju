/**
 * @fileoverview Tests for branding configuration
 * Tests template interpolation, fork branding generation, and ASCII banner
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  clearBrandingCache,
  DEFAULT_BRANDING,
  generateForkBranding,
  getApiUrl,
  getBranding,
  getChainBranding,
  getCliBranding,
  getExplorerUrl,
  getFeatures,
  getGatewayUrl,
  getGovernanceToken,
  getLegal,
  getNativeToken,
  getNetworkDescription,
  getNetworkDisplayName,
  getNetworkName,
  getNetworkTagline,
  getRpcUrl,
  getSupport,
  getUrls,
  getVisualBranding,
  getWebsiteUrl,
  interpolate,
} from './branding'
import type { BrandingConfig } from './schemas'

describe('Branding Configuration', () => {
  beforeEach(() => {
    clearBrandingCache()
  })

  afterEach(() => {
    clearBrandingCache()
  })

  describe('getBranding', () => {
    it('should load branding config', () => {
      const branding = getBranding()
      expect(branding.version).toBeTruthy()
      expect(branding.network).toBeDefined()
      expect(branding.chains).toBeDefined()
      expect(branding.urls).toBeDefined()
    })

    it('should cache branding config', () => {
      const first = getBranding()
      const second = getBranding()
      expect(first).toBe(second) // Same reference (cached)
    })
  })

  describe('Convenience Accessors', () => {
    it('getNetworkName should return network name', () => {
      const name = getNetworkName()
      expect(typeof name).toBe('string')
      expect(name.length).toBeGreaterThan(0)
    })

    it('getNetworkDisplayName should return display name', () => {
      const displayName = getNetworkDisplayName()
      expect(typeof displayName).toBe('string')
    })

    it('getNetworkTagline should return tagline', () => {
      const tagline = getNetworkTagline()
      expect(typeof tagline).toBe('string')
    })

    it('getNetworkDescription should return description', () => {
      const description = getNetworkDescription()
      expect(typeof description).toBe('string')
    })

    it('getChainBranding should return chain info', () => {
      const testnet = getChainBranding('testnet')
      expect(testnet.name).toBeTruthy()
      expect(testnet.chainId).toBeDefined()
      expect(testnet.symbol).toBeTruthy()

      const mainnet = getChainBranding('mainnet')
      expect(mainnet.name).toBeTruthy()
      expect(mainnet.chainId).toBeDefined()
    })

    it('getUrls should return URL config', () => {
      const urls = getUrls()
      expect(urls.website).toBeTruthy()
      expect(urls.docs).toBeTruthy()
      expect(urls.explorer).toBeDefined()
      expect(urls.rpc).toBeDefined()
    })

    it('getVisualBranding should return visual config', () => {
      const visual = getVisualBranding()
      expect(visual.primaryColor).toMatch(/^#[a-fA-F0-9]{6}$/)
      expect(visual.logo).toBeDefined()
    })

    it('getFeatures should return feature flags', () => {
      const features = getFeatures()
      expect(typeof features.flashblocks).toBe('boolean')
      expect(typeof features.erc4337).toBe('boolean')
    })

    it('getCliBranding should return CLI config', () => {
      const cli = getCliBranding()
      expect(cli.name).toBeTruthy()
      expect(cli.displayName).toBeTruthy()
      expect(Array.isArray(cli.banner)).toBe(true)
    })

    it('getLegal should return legal info', () => {
      const legal = getLegal()
      expect(legal.companyName).toBeTruthy()
      expect(legal.copyrightYear).toBeGreaterThanOrEqual(2024)
    })

    it('getSupport should return support info', () => {
      const support = getSupport()
      expect(support.email).toBeTruthy()
      expect(support.discordChannel).toBeTruthy()
    })

    it('getNativeToken should return token info', () => {
      const token = getNativeToken()
      expect(token.name).toBeTruthy()
      expect(token.symbol).toBeTruthy()
      expect(token.decimals).toBe(18)
    })

    it('getGovernanceToken should return token info', () => {
      const token = getGovernanceToken()
      expect(token.name).toBeTruthy()
      expect(token.symbol).toBeTruthy()
      expect(token.decimals).toBe(18)
    })

    it('getWebsiteUrl should return URL', () => {
      const url = getWebsiteUrl()
      expect(url).toContain('http')
    })

    it('getExplorerUrl should return network-specific URL', () => {
      const testnet = getExplorerUrl('testnet')
      const mainnet = getExplorerUrl('mainnet')
      expect(testnet).toContain('http')
      expect(mainnet).toContain('http')
    })

    it('getRpcUrl should return network-specific URL', () => {
      const testnet = getRpcUrl('testnet')
      const mainnet = getRpcUrl('mainnet')
      expect(testnet).toContain('http')
      expect(mainnet).toContain('http')
    })

    it('getApiUrl should return network-specific URL', () => {
      const testnet = getApiUrl('testnet')
      const mainnet = getApiUrl('mainnet')
      expect(testnet).toContain('http')
      expect(mainnet).toContain('http')
    })

    it('getGatewayUrl should return network-specific URL', () => {
      const testnet = getGatewayUrl('testnet')
      const mainnet = getGatewayUrl('mainnet')
      expect(testnet).toContain('http')
      expect(mainnet).toContain('http')
    })
  })
})

describe('Template Interpolation', () => {
  it('should replace {networkName}', () => {
    const branding = getBranding()
    const result = interpolate('Welcome to {networkName}!')
    expect(result).toBe(`Welcome to ${branding.network.name}!`)
  })

  it('should replace {networkDisplayName}', () => {
    const branding = getBranding()
    const result = interpolate('{networkDisplayName} rocks')
    expect(result).toBe(`${branding.network.displayName} rocks`)
  })

  it('should replace {tagline}', () => {
    const branding = getBranding()
    const result = interpolate('Tagline: {tagline}')
    expect(result).toBe(`Tagline: ${branding.network.tagline}`)
  })

  it('should replace {description}', () => {
    const branding = getBranding()
    const result = interpolate('Desc: {description}')
    expect(result).toBe(`Desc: ${branding.network.description}`)
  })

  it('should replace {website}', () => {
    const branding = getBranding()
    const result = interpolate('Visit {website}')
    expect(result).toBe(`Visit ${branding.urls.website}`)
  })

  it('should replace {docs}', () => {
    const branding = getBranding()
    const result = interpolate('Read {docs}')
    expect(result).toBe(`Read ${branding.urls.docs}`)
  })

  it('should replace {github}', () => {
    const branding = getBranding()
    const result = interpolate('Code: {github}')
    expect(result).toBe(`Code: ${branding.urls.github}`)
  })

  it('should replace {twitter}', () => {
    const branding = getBranding()
    const result = interpolate('Follow {twitter}')
    expect(result).toBe(`Follow ${branding.urls.twitter}`)
  })

  it('should replace {discord}', () => {
    const branding = getBranding()
    const result = interpolate('Join {discord}')
    expect(result).toBe(`Join ${branding.urls.discord}`)
  })

  it('should replace {testnetChainId}', () => {
    const branding = getBranding()
    const result = interpolate('Chain: {testnetChainId}')
    expect(result).toBe(`Chain: ${branding.chains.testnet.chainId}`)
  })

  it('should replace {mainnetChainId}', () => {
    const branding = getBranding()
    const result = interpolate('Chain: {mainnetChainId}')
    expect(result).toBe(`Chain: ${branding.chains.mainnet.chainId}`)
  })

  it('should replace {testnetName}', () => {
    const branding = getBranding()
    const result = interpolate('Net: {testnetName}')
    expect(result).toBe(`Net: ${branding.chains.testnet.name}`)
  })

  it('should replace {mainnetName}', () => {
    const branding = getBranding()
    const result = interpolate('Net: {mainnetName}')
    expect(result).toBe(`Net: ${branding.chains.mainnet.name}`)
  })

  it('should replace {nativeSymbol}', () => {
    const branding = getBranding()
    const result = interpolate('Token: {nativeSymbol}')
    expect(result).toBe(`Token: ${branding.tokens.native.symbol}`)
  })

  it('should replace {governanceSymbol}', () => {
    const branding = getBranding()
    const result = interpolate('Gov: {governanceSymbol}')
    expect(result).toBe(`Gov: ${branding.tokens.governance.symbol}`)
  })

  it('should replace {cliName}', () => {
    const branding = getBranding()
    const result = interpolate('CLI: {cliName}')
    expect(result).toBe(`CLI: ${branding.cli.name}`)
  })

  it('should replace {companyName}', () => {
    const branding = getBranding()
    const result = interpolate('By {companyName}')
    expect(result).toBe(`By ${branding.legal.companyName}`)
  })

  it('should replace {year}', () => {
    const branding = getBranding()
    const result = interpolate('© {year}')
    expect(result).toBe(`© ${branding.legal.copyrightYear}`)
  })

  it('should replace multiple placeholders', () => {
    const branding = getBranding()
    const result = interpolate('{networkName} ({testnetChainId}) - {tagline}')
    expect(result).toBe(
      `${branding.network.name} (${branding.chains.testnet.chainId}) - ${branding.network.tagline}`,
    )
  })

  it('should leave unknown placeholders as-is', () => {
    const result = interpolate('Hello {unknownPlaceholder}!')
    expect(result).toBe('Hello {unknownPlaceholder}!')
  })

  it('should handle empty string', () => {
    const result = interpolate('')
    expect(result).toBe('')
  })

  it('should handle string with no placeholders', () => {
    const result = interpolate('No placeholders here')
    expect(result).toBe('No placeholders here')
  })
})

describe('Fork Branding Generation', () => {
  it('should generate branding with minimal options', () => {
    const branding = generateForkBranding({
      name: 'TestNet',
      chainId: 12345,
    })

    expect(branding.network.name).toBe('TestNet')
    expect(branding.chains.testnet.chainId).toBe(12345)
    expect(branding.chains.mainnet.chainId).toBe(12346)
  })

  it('should use provided displayName', () => {
    const branding = generateForkBranding({
      name: 'MyChain',
      displayName: 'My Awesome Chain',
      chainId: 99999,
    })

    expect(branding.network.displayName).toBe('My Awesome Chain')
  })

  it('should generate default displayName if not provided', () => {
    const branding = generateForkBranding({
      name: 'Cool',
      chainId: 11111,
    })

    expect(branding.network.displayName).toBe('Cool Network')
  })

  it('should use provided tagline', () => {
    const branding = generateForkBranding({
      name: 'Fast',
      tagline: 'Lightning fast L2',
      chainId: 22222,
    })

    expect(branding.network.tagline).toBe('Lightning fast L2')
  })

  it('should generate default tagline if not provided', () => {
    const branding = generateForkBranding({
      name: 'Quick',
      chainId: 33333,
    })

    expect(branding.network.tagline).toContain('Quick')
  })

  it('should use provided domain', () => {
    const branding = generateForkBranding({
      name: 'Custom',
      domain: 'custom.io',
      chainId: 44444,
    })

    expect(branding.urls.website).toBe('https://custom.io')
    expect(branding.urls.docs).toBe('https://docs.custom.io')
    expect(branding.legal.termsUrl).toBe('https://custom.io/terms')
    expect(branding.support.email).toBe('support@custom.io')
  })

  it('should generate domain from name if not provided', () => {
    const branding = generateForkBranding({
      name: 'Super Chain',
      chainId: 55555,
    })

    expect(branding.urls.website).toBe('https://superchain.network')
  })

  it('should use provided tokenSymbol', () => {
    const branding = generateForkBranding({
      name: 'Token',
      tokenSymbol: 'TKN',
      chainId: 66666,
    })

    expect(branding.tokens.native.symbol).toBe('TKN')
    expect(branding.chains.testnet.symbol).toBe('TKN')
    expect(branding.chains.mainnet.symbol).toBe('TKN')
  })

  it('should default to ETH if tokenSymbol not provided', () => {
    const branding = generateForkBranding({
      name: 'Default',
      chainId: 77777,
    })

    expect(branding.tokens.native.symbol).toBe('ETH')
  })

  it('should use provided governance token info', () => {
    const branding = generateForkBranding({
      name: 'Gov',
      governanceTokenName: 'GovToken',
      governanceTokenSymbol: 'GOV',
      chainId: 88888,
    })

    expect(branding.tokens.governance.name).toBe('GovToken')
    expect(branding.tokens.governance.symbol).toBe('GOV')
  })

  it('should generate governance token from name if not provided', () => {
    const branding = generateForkBranding({
      name: 'Network',
      chainId: 99999,
    })

    expect(branding.tokens.governance.name).toBe('Network Token')
    expect(branding.tokens.governance.symbol).toBe('NETW')
  })

  it('should generate all required URL fields', () => {
    const branding = generateForkBranding({
      name: 'Complete',
      domain: 'complete.net',
      chainId: 10101,
    })

    expect(branding.urls.explorer.testnet).toBe(
      'https://testnet-explorer.complete.net',
    )
    expect(branding.urls.explorer.mainnet).toBe('https://explorer.complete.net')
    expect(branding.urls.rpc.testnet).toBe('https://testnet-rpc.complete.net')
    expect(branding.urls.rpc.mainnet).toBe('https://rpc.complete.net')
    expect(branding.urls.api.testnet).toBe('https://testnet-api.complete.net')
    expect(branding.urls.api.mainnet).toBe('https://api.complete.net')
    expect(branding.urls.gateway.testnet).toBe('https://testnet.complete.net')
    expect(branding.urls.gateway.mainnet).toBe('https://app.complete.net')
  })

  it('should generate correct social URLs', () => {
    const branding = generateForkBranding({
      name: 'Social',
      chainId: 20202,
    })

    expect(branding.urls.github).toContain('social')
    expect(branding.urls.twitter).toContain('social')
    expect(branding.urls.discord).toContain('social')
    expect(branding.urls.telegram).toContain('social')
  })

  it('should set correct feature flags', () => {
    const branding = generateForkBranding({
      name: 'Features',
      chainId: 30303,
    })

    expect(branding.features.flashblocks).toBe(true)
    expect(branding.features.flashblocksSubBlockTime).toBe(200)
    expect(branding.features.blockTime).toBe(2000)
    expect(branding.features.erc4337).toBe(true)
    expect(branding.features.crossChain).toBe(true)
    expect(branding.features.governance).toBe(true)
    expect(branding.features.staking).toBe(true)
    expect(branding.features.identityRegistry).toBe(true)
  })

  it('should generate CLI branding', () => {
    const branding = generateForkBranding({
      name: 'CLI Test',
      chainId: 40404,
    })

    expect(branding.cli.name).toBe('cli-test')
    expect(branding.cli.displayName).toBe('CLI Test CLI')
    expect(Array.isArray(branding.cli.banner)).toBe(true)
    expect(branding.cli.banner.length).toBeGreaterThan(0)
  })

  it('should set current year in legal', () => {
    const branding = generateForkBranding({
      name: 'Year',
      chainId: 50505,
    })

    expect(branding.legal.copyrightYear).toBe(new Date().getFullYear())
  })

  it('should validate generated config matches BrandingConfig shape', () => {
    const branding = generateForkBranding({
      name: 'Valid',
      chainId: 60606,
    })

    // Verify all required fields exist
    expect(branding.version).toBe('1.0.0')
    expect(branding.network.name).toBeTruthy()
    expect(branding.network.displayName).toBeTruthy()
    expect(branding.network.tagline).toBeTruthy()
    expect(branding.network.description).toBeTruthy()
    expect(branding.network.shortDescription).toBeTruthy()
    expect(Array.isArray(branding.network.keywords)).toBe(true)
    expect(branding.branding.primaryColor).toMatch(/^#[a-fA-F0-9]{6}$/)
    expect(branding.branding.logo.light).toBeTruthy()
    expect(branding.branding.logo.dark).toBeTruthy()
    expect(branding.branding.logo.icon).toBeTruthy()
  })
})

describe('ASCII Banner Generation', () => {
  it('should generate banner with correct structure', () => {
    const branding = generateForkBranding({
      name: 'Banner',
      chainId: 70707,
    })

    const banner = branding.cli.banner
    expect(banner.length).toBe(3)
    expect(banner[0]).toMatch(/^╔═+╗$/)
    expect(banner[1]).toMatch(/^║.+║$/)
    expect(banner[2]).toMatch(/^╚═+╝$/)
  })

  it('should contain network name in banner', () => {
    const branding = generateForkBranding({
      name: 'TestBanner',
      chainId: 80808,
    })

    const banner = branding.cli.banner
    expect(banner[1]).toContain('TESTBANNER')
  })

  it('should handle short names', () => {
    const branding = generateForkBranding({
      name: 'X',
      chainId: 90909,
    })

    const banner = branding.cli.banner
    expect(banner[1]).toContain('X')
  })

  it('should handle long names', () => {
    const branding = generateForkBranding({
      name: 'VeryLongNetworkNameThatExceedsNormalLength',
      chainId: 11111,
    })

    const banner = branding.cli.banner
    expect(banner[1]).toContain('VERYLONGNETWORKNAMETHATEXCEEDSNORMALLENGTH')
  })
})

describe('DEFAULT_BRANDING constant', () => {
  it('should have valid structure', () => {
    expect(DEFAULT_BRANDING.version).toBe('1.0.0')
    expect(DEFAULT_BRANDING.network.name).toBe('MyNetwork')
    expect(DEFAULT_BRANDING.chains.testnet.chainId).toBe(999999)
    expect(DEFAULT_BRANDING.chains.mainnet.chainId).toBe(999998)
  })

  it('should match BrandingConfig type', () => {
    const branding: BrandingConfig = DEFAULT_BRANDING
    expect(branding).toBeDefined()
  })
})
