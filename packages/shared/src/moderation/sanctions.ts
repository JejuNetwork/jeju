/**
 * OFAC Sanctions Screening
 *
 * DESIGN AXIOM: Deterministic enforcement
 * All sanctions checks are rule-based, logged, and auditable.
 *
 * Checks wallet addresses against:
 * 1. OFAC SDN (Specially Designated Nationals) list
 * 2. Known DPRK/North Korea associated addresses
 * 3. Custom internal blocklist
 *
 * The SDN list is available from:
 * https://www.treasury.gov/ofac/downloads/sdn.xml
 * https://www.treasury.gov/ofac/downloads/sanctions/1.0/sdn_advanced.xml
 */

import { logger } from '../logger'
import type { Address } from 'viem'

// Known sanctioned crypto addresses from OFAC
// Source: https://sanctionslist.ofac.treas.gov/Home/SdnList
const OFAC_SANCTIONED_ADDRESSES: Set<string> = new Set([
  // Tornado Cash addresses (August 2022 sanctions)
  '0x8589427373d6d84e98730d7795d8f6f8731fda16',
  '0x722122df12d4e14e13ac3b6895a86e84145b6967',
  '0xdd4c48c0b24039969fc16d1cdf626eab821d3384',
  '0xd90e2f925da726b50c4ed8d0fb90ad053324f31b',
  '0xd96f2b1c14db8458374d9aca76e26c3d18364307',
  '0x4736dcf1b7a3d580672cce6e7c65cd5cc9cfba9d',
  '0xd4b88df4d29f5cedd6857912842cff3b20c8cfa3',
  '0x910cbd523d972eb0a6f4cae4618ad62622b39dbf',
  '0xa160cdab225685da1d56aa342ad8841c3b53f291',
  '0xfd8610d20aa15b7b2e3be39b396a1bc3516c7144',
  '0x07687e702b410fa43f4cb4af7fa097918ffd2730',
  '0x23773e65ed146a459791799d01336db287f25334',
  '0x22aaa7720ddd5388a3c0a3333430953c68f1849b',
  '0x03893a7c7463ae47d46bc7f091665f1893656003',
  '0x2717c5e28cf931547b621a5dddb772ab6a35b701',
  '0xd882cfc20f52f2599d84b8e8d58c7fb62cfe344b',
  '0x7f19720a857f834887fc9a7bc0a0fbe7fc7f8102',
  '0x7f367cc41522ce07553e823bf3be79a889debe1b',
  '0x9ad122c22b14202b4490edaf288fdb3c7cb3ff5e',
  '0x179f48c78f57a3a78f0608cc9197b8972921d1d2',
  '0xb1c8094b234dce6e03f10a5b673c1d8c69739a00',
  '0x527653ea119f3e6a1f5bd18fbf4714081d7b31ce',
  '0x58e8dcc13be9780fc42e8723d8ead4cf46943df2',
  '0xd691f27f38b395864ea86cfc7253969b409c362d',
  '0xaeaac358560e11f52454d997aaff2c5731b6f8a6',
  '0x1356c899d8c9467c7f71c195612f8a395abf2f0a',
  '0xa60c772958a3ed56c1f15dd055ba37ac8e523a0d',
  '0x169ad27a470d064dede56a2d3ff727986b15d52b',
  '0x0836222f2b2b24a3f36f98668ed8f0b38d1a872f',
  '0xf67721a2d8f736e75a49fdd7fad2e31d8676542a',
  '0x9ad122c22b14202b4490edaf288fdb3c7cb3ff5e',
  '0x905b63fff465b9ffbf41dea908ceb12478ec7601',
  '0x07e3383f853a9c8a6bab6c6ed5e91cad13e8f6e9',
  '0xba214c1c1928a32bffe790263e38b4af9bfcd659',
  '0x8576acc5c05d6ce88f4e49bf65bdf0c62f91353c',
  '0xca0840578f57fe71599d29375e16783424023357',
  '0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc',
  '0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936',
  '0x23773e65ed146a459791799d01336db287f25334',
  '0xd21be7248e0197ee08e0c20d4a96debdac3d20af',
  '0x610b717796ad172b316836ac95a2ffad065ceab4',
  '0x178169b423a011fff22b9e3f3abea13414ddd0f1',
  '0xbb93e510bbcd0b7beb5a853875f9ec60275cf498',
  '0x2f50508a8a3d323b91336fa3ea6ae50e55f32185',
  '0x242654336ca2205714071898f67e254eb49acdce',
  '0x1e34a77868e19a6647b1f2f47b51ed72dede95dd',
  '0x707940c8c80d36a0f05d3a4d72eed43e4698b2ae',
  
  // Lazarus Group / DPRK addresses
  '0x098b716b8aaf21512996dc57eb0615e2383e2f96',
  '0xa0e1c89ef1a489c9c7de96311ed5ce5d32c20e4b',
  '0x3cffd56b47b7b41c56258d9c7731abadc360e073',
  '0x53b6936513e738f44fb50d2b9476730c0ab3bfc1',
  '0x35fb6f6db4fb05e6a4ce86f2c93691425626d4b1',
  
  // Blender.io addresses (May 2022)
  '0x8f74f27a1e8c9ff0dbde7a8d2bf77dbdb5a3bfce',
  
  // Sinbad.io addresses (November 2023)
  '0x72a5843cc08275c8171e582972aa4fda8c397b2a',
  '0x723b78e67497e85279cb204544566f4dc5d2aca0',
  '0x82e57b26c32f7a4c5e1dd9f8ebb9db8ae1e9e76d',
])

// DPRK-associated wallet patterns (for taint analysis)
const DPRK_ASSOCIATION_PATTERNS: RegExp[] = [
  // No specific patterns, relies on direct address matching and external APIs
]

export interface SanctionsCheckResult {
  isSanctioned: boolean
  source: 'ofac_sdn' | 'dprk' | 'internal' | 'chainalysis' | 'elliptic'
  matchedAddress?: string
  matchedList?: string
  confidence: number
  checkTimestamp: number
  details?: string
}

export interface SanctionsScreenerConfig {
  chainalysisApiKey?: string
  ellipticApiKey?: string
  internalBlocklist?: string[]
  checkTaint?: boolean
}

// In-memory cache for sanctions results (TTL: 1 hour)
const sanctionsCache = new Map<string, { result: SanctionsCheckResult; expiresAt: number }>()
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

/**
 * Sanctions Screener
 *
 * Provides wallet address screening against sanctions lists.
 */
export class SanctionsScreener {
  private internalBlocklist: Set<string>
  private config: SanctionsScreenerConfig

  constructor(config: SanctionsScreenerConfig = {}) {
    this.config = config
    this.internalBlocklist = new Set(
      (config.internalBlocklist ?? []).map(addr => addr.toLowerCase())
    )
  }

  async initialize(): Promise<void> {
    logger.info('[SanctionsScreener] Initialized', {
      ofacAddresses: OFAC_SANCTIONED_ADDRESSES.size,
      internalBlocklist: this.internalBlocklist.size,
      hasChainanalysis: !!this.config.chainalysisApiKey,
      hasElliptic: !!this.config.ellipticApiKey,
    })
  }

  /**
   * Check if an address is sanctioned
   */
  async checkAddress(address: Address): Promise<SanctionsCheckResult> {
    const normalizedAddress = address.toLowerCase()
    const now = Date.now()

    // Check cache
    const cached = sanctionsCache.get(normalizedAddress)
    if (cached && cached.expiresAt > now) {
      return cached.result
    }

    // Check OFAC SDN list
    if (OFAC_SANCTIONED_ADDRESSES.has(normalizedAddress)) {
      const result: SanctionsCheckResult = {
        isSanctioned: true,
        source: 'ofac_sdn',
        matchedAddress: normalizedAddress,
        matchedList: 'OFAC SDN',
        confidence: 1.0,
        checkTimestamp: now,
        details: 'Direct match on OFAC Specially Designated Nationals list',
      }
      this.cacheResult(normalizedAddress, result)
      logger.warn('[SanctionsScreener] OFAC match found', { address: normalizedAddress })
      return result
    }

    // Check internal blocklist
    if (this.internalBlocklist.has(normalizedAddress)) {
      const result: SanctionsCheckResult = {
        isSanctioned: true,
        source: 'internal',
        matchedAddress: normalizedAddress,
        matchedList: 'Internal Blocklist',
        confidence: 1.0,
        checkTimestamp: now,
        details: 'Direct match on internal blocklist',
      }
      this.cacheResult(normalizedAddress, result)
      logger.warn('[SanctionsScreener] Internal blocklist match found', { address: normalizedAddress })
      return result
    }

    // Check external services if configured
    if (this.config.chainalysisApiKey) {
      const chainResult = await this.checkChainalysis(normalizedAddress)
      if (chainResult.isSanctioned) {
        this.cacheResult(normalizedAddress, chainResult)
        return chainResult
      }
    }

    if (this.config.ellipticApiKey) {
      const ellipticResult = await this.checkElliptic(normalizedAddress)
      if (ellipticResult.isSanctioned) {
        this.cacheResult(normalizedAddress, ellipticResult)
        return ellipticResult
      }
    }

    // Clean
    const result: SanctionsCheckResult = {
      isSanctioned: false,
      source: 'ofac_sdn',
      confidence: 1.0,
      checkTimestamp: now,
    }
    this.cacheResult(normalizedAddress, result)
    return result
  }

  /**
   * Batch check multiple addresses
   */
  async checkAddresses(addresses: Address[]): Promise<Map<Address, SanctionsCheckResult>> {
    const results = new Map<Address, SanctionsCheckResult>()

    await Promise.all(
      addresses.map(async (address) => {
        const result = await this.checkAddress(address)
        results.set(address, result)
      })
    )

    return results
  }

  /**
   * Add address to internal blocklist
   */
  addToBlocklist(address: Address, reason?: string): void {
    const normalizedAddress = address.toLowerCase()
    this.internalBlocklist.add(normalizedAddress)

    // Clear from cache to force re-check
    sanctionsCache.delete(normalizedAddress)

    logger.info('[SanctionsScreener] Address added to internal blocklist', {
      address: normalizedAddress,
      reason,
    })
  }

  /**
   * Remove address from internal blocklist
   */
  removeFromBlocklist(address: Address): boolean {
    const normalizedAddress = address.toLowerCase()
    const removed = this.internalBlocklist.delete(normalizedAddress)

    if (removed) {
      // Clear from cache to force re-check
      sanctionsCache.delete(normalizedAddress)
      logger.info('[SanctionsScreener] Address removed from internal blocklist', {
        address: normalizedAddress,
      })
    }

    return removed
  }

  /**
   * Get statistics
   */
  getStats(): {
    ofacAddresses: number
    internalBlocklist: number
    cacheSize: number
    cachedSanctioned: number
  } {
    let cachedSanctioned = 0
    const now = Date.now()

    for (const [, entry] of sanctionsCache) {
      if (entry.expiresAt > now && entry.result.isSanctioned) {
        cachedSanctioned++
      }
    }

    return {
      ofacAddresses: OFAC_SANCTIONED_ADDRESSES.size,
      internalBlocklist: this.internalBlocklist.size,
      cacheSize: sanctionsCache.size,
      cachedSanctioned,
    }
  }

  /**
   * Check Chainalysis API
   */
  private async checkChainalysis(address: string): Promise<SanctionsCheckResult> {
    const now = Date.now()

    if (!this.config.chainalysisApiKey) {
      return { isSanctioned: false, source: 'chainalysis', confidence: 0, checkTimestamp: now }
    }

    try {
      const response = await fetch(
        `https://api.chainalysis.com/api/risk/v2/entities/${address}`,
        {
          headers: {
            'Token': this.config.chainalysisApiKey,
            'Accept': 'application/json',
          },
        }
      )

      if (!response.ok) {
        logger.error('[SanctionsScreener] Chainalysis API error', { status: response.status })
        return { isSanctioned: false, source: 'chainalysis', confidence: 0, checkTimestamp: now }
      }

      const data = await response.json() as {
        risk: string
        riskReason?: string
        cluster?: { name?: string }
      }

      // Chainalysis returns risk levels: Low, Medium, High, Severe
      if (data.risk === 'Severe' || data.risk === 'High') {
        return {
          isSanctioned: true,
          source: 'chainalysis',
          matchedAddress: address,
          confidence: data.risk === 'Severe' ? 1.0 : 0.9,
          checkTimestamp: now,
          details: `Chainalysis risk: ${data.risk}${data.riskReason ? ` - ${data.riskReason}` : ''}`,
        }
      }

      return { isSanctioned: false, source: 'chainalysis', confidence: 1.0, checkTimestamp: now }
    } catch (error) {
      logger.error('[SanctionsScreener] Chainalysis check failed', { error: String(error) })
      return { isSanctioned: false, source: 'chainalysis', confidence: 0, checkTimestamp: now }
    }
  }

  /**
   * Check Elliptic API
   */
  private async checkElliptic(address: string): Promise<SanctionsCheckResult> {
    const now = Date.now()

    if (!this.config.ellipticApiKey) {
      return { isSanctioned: false, source: 'elliptic', confidence: 0, checkTimestamp: now }
    }

    try {
      const response = await fetch(
        `https://api.elliptic.co/v2/wallet/synchronous`,
        {
          method: 'POST',
          headers: {
            'x-access-key': this.config.ellipticApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            subject: {
              asset: 'holistic',
              blockchain: 'holistic',
              type: 'address',
              hash: address,
            },
            type: 'wallet_exposure',
          }),
        }
      )

      if (!response.ok) {
        logger.error('[SanctionsScreener] Elliptic API error', { status: response.status })
        return { isSanctioned: false, source: 'elliptic', confidence: 0, checkTimestamp: now }
      }

      const data = await response.json() as {
        risk_score?: number
        risk_score_detail?: {
          source?: string
          category?: string
        }
      }

      // Elliptic risk scores are 0-10
      if (data.risk_score && data.risk_score >= 8) {
        return {
          isSanctioned: true,
          source: 'elliptic',
          matchedAddress: address,
          confidence: data.risk_score / 10,
          checkTimestamp: now,
          details: `Elliptic risk score: ${data.risk_score}${data.risk_score_detail?.category ? ` - ${data.risk_score_detail.category}` : ''}`,
        }
      }

      return { isSanctioned: false, source: 'elliptic', confidence: 1.0, checkTimestamp: now }
    } catch (error) {
      logger.error('[SanctionsScreener] Elliptic check failed', { error: String(error) })
      return { isSanctioned: false, source: 'elliptic', confidence: 0, checkTimestamp: now }
    }
  }

  private cacheResult(address: string, result: SanctionsCheckResult): void {
    sanctionsCache.set(address, {
      result,
      expiresAt: Date.now() + CACHE_TTL_MS,
    })
  }
}

// Singleton instance
let sanctionsScreener: SanctionsScreener | null = null

export function getSanctionsScreener(config?: SanctionsScreenerConfig): SanctionsScreener {
  if (!sanctionsScreener) {
    sanctionsScreener = new SanctionsScreener(config ?? {
      chainalysisApiKey: process.env.CHAINALYSIS_API_KEY,
      ellipticApiKey: process.env.ELLIPTIC_API_KEY,
    })
  }
  return sanctionsScreener
}

export function resetSanctionsScreener(): void {
  sanctionsScreener = null
  sanctionsCache.clear()
}

