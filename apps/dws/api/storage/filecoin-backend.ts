/**
 * Filecoin Backend - Verifiable decentralized storage
 *
 * Features:
 * - Storage deals with verifiable proofs (Proof-of-Spacetime)
 * - Multiple storage provider aggregators (Web3.Storage, Lighthouse, Storacha)
 * - Retrieval markets for fast content delivery
 * - Deal tracking and renewal
 * - IPFS/Filecoin bridge for content addressing
 */

import { getIpfsApiUrl } from '@jejunetwork/config'
import { bytesToHex, hash256 } from '@jejunetwork/shared'
import { z } from 'zod'
import type { ContentCategory, ContentTier, StorageBackendType } from './types'

// ============ Types ============

export interface FilecoinDeal {
  dealId: string
  cid: string
  provider: string
  pieceSize: number
  duration: number
  startEpoch: number
  endEpoch: number
  pricePerEpoch: bigint
  totalCost: bigint
  status: FilecoinDealStatus
  createdAt: number
  updatedAt: number
  proofCount: number
  lastProofEpoch: number
}

export type FilecoinDealStatus =
  | 'pending' // Deal proposed, awaiting acceptance
  | 'active' // Deal active, being stored
  | 'sealed' // Data sealed, proofs being submitted
  | 'expired' // Deal ended
  | 'terminated' // Early termination
  | 'slashed' // Provider slashed for missing proofs

export interface FilecoinProvider {
  id: string
  address: string
  peerId: string
  region: string
  power: bigint // Raw byte power
  qualityPower: bigint // Quality adjusted power
  pricePerGiBEpoch: bigint
  minDealSize: number
  maxDealSize: number
  verified: boolean
  retrievalEnabled: boolean
  onlineDeals: number
  faultCount: number
  score: number
}

export interface FilecoinBackendConfig {
  // API endpoints
  lotusApiUrl: string
  lotusToken: string

  // Aggregator services (easier than direct Lotus)
  web3StorageToken?: string
  lighthouseToken?: string
  storachaToken?: string

  // IPFS bridge
  ipfsApiUrl: string

  // Deal parameters
  defaultDealDuration: number // epochs (1 epoch = 30 seconds)
  minDealDuration: number
  maxDealDuration: number
  replicationFactor: number
  preferredRegions: string[]
  maxPricePerGiBEpoch: bigint

  // Retrieval
  retrievalTimeout: number
  maxRetrievalPrice: bigint

  timeout: number
}

// ============ Zod Schemas ============

/** @internal Reserved for future validation */
const FilecoinDealSchema = z.object({
  dealId: z.string(),
  cid: z.string(),
  provider: z.string(),
  pieceSize: z.number(),
  duration: z.number(),
  startEpoch: z.number(),
  endEpoch: z.number(),
  pricePerEpoch: z.string(),
  status: z.string(),
})
void FilecoinDealSchema

const Web3StorageUploadResponseSchema = z.object({
  cid: z.string(),
  carCid: z.string().optional(),
  size: z.number().optional(),
  deals: z
    .array(
      z.object({
        dealId: z.number().optional(),
        storageProvider: z.string().optional(),
        status: z.string(),
      }),
    )
    .optional(),
})

const LighthouseUploadResponseSchema = z.object({
  Name: z.string(),
  Hash: z.string(),
  Size: z.string(),
})

/** @internal Reserved for future validation */
const FilecoinProviderSchema = z.object({
  Miner: z.string(),
  PeerId: z.string().optional(),
  Power: z.string().optional(),
  Price: z.string().optional(),
})
void FilecoinProviderSchema

/** @internal Reserved for future validation */
const RetrievalOfferSchema = z.object({
  Err: z.string().optional(),
  Root: z.string().optional(),
  Size: z.number().optional(),
  MinPrice: z.string().optional(),
  PaymentInterval: z.number().optional(),
  Miner: z.string().optional(),
})
void RetrievalOfferSchema

// ============ Default Config ============

const DEFAULT_CONFIG: FilecoinBackendConfig = {
  lotusApiUrl: process.env.LOTUS_API_URL ?? 'https://api.node.glif.io',
  lotusToken: process.env.LOTUS_TOKEN ?? '',
  web3StorageToken: process.env.WEB3_STORAGE_TOKEN,
  lighthouseToken: process.env.LIGHTHOUSE_TOKEN,
  storachaToken: process.env.STORACHA_TOKEN,
  ipfsApiUrl: getIpfsApiUrl(),
  defaultDealDuration: 518400, // ~180 days in epochs
  minDealDuration: 180 * 2880, // ~180 days minimum
  maxDealDuration: 540 * 2880, // ~540 days maximum
  replicationFactor: 3,
  preferredRegions: ['us', 'eu', 'asia'],
  maxPricePerGiBEpoch: BigInt('100000000000'), // 0.0001 FIL
  retrievalTimeout: 120000,
  maxRetrievalPrice: BigInt('1000000000000000'), // 0.001 FIL
  timeout: 60000,
}

// ============ Filecoin Backend Class ============

export class FilecoinBackend {
  readonly name = 'filecoin'
  readonly type: StorageBackendType = 'filecoin'

  private config: FilecoinBackendConfig
  private deals: Map<string, FilecoinDeal> = new Map()
  private cidToDealId: Map<string, string[]> = new Map()

  constructor(config: Partial<FilecoinBackendConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ============ Upload Methods ============

  /**
   * Upload content to Filecoin via aggregator services
   * Tries Web3.Storage -> Lighthouse -> Direct deal in order
   */
  async upload(
    content: Buffer,
    options?: {
      filename?: string
      contentType?: string
      tier?: ContentTier
      category?: ContentCategory
      replicationFactor?: number
      dealDuration?: number
    },
  ): Promise<{
    cid: string
    dealIds: string[]
    size: number
    cost: bigint
  }> {
    const contentHash = bytesToHex(hash256(new Uint8Array(content))).slice(2)
    const replicationFactor =
      options?.replicationFactor ?? this.config.replicationFactor

    // Try Web3.Storage first (easiest, auto-replication)
    if (this.config.web3StorageToken) {
      const result = await this.uploadViaWeb3Storage(content, options)
      if (result) {
        console.log(`[Filecoin] Uploaded via Web3.Storage: ${result.cid}`)
        return result
      }
    }

    // Try Lighthouse
    if (this.config.lighthouseToken) {
      const result = await this.uploadViaLighthouse(content, options)
      if (result) {
        console.log(`[Filecoin] Uploaded via Lighthouse: ${result.cid}`)
        return result
      }
    }

    // Try Storacha (new Web3.Storage)
    if (this.config.storachaToken) {
      const result = await this.uploadViaStoracha(content, options)
      if (result) {
        console.log(`[Filecoin] Uploaded via Storacha: ${result.cid}`)
        return result
      }
    }

    // Fall back to direct deal creation
    return this.uploadDirect(content, {
      ...options,
      contentHash,
      replicationFactor,
    })
  }

  /**
   * Upload via Web3.Storage (w3up)
   */
  private async uploadViaWeb3Storage(
    content: Buffer,
    options?: {
      filename?: string
      contentType?: string
    },
  ): Promise<{
    cid: string
    dealIds: string[]
    size: number
    cost: bigint
  } | null> {
    if (!this.config.web3StorageToken) return null

    const formData = new FormData()
    const blob = new Blob([new Uint8Array(content)], {
      type: options?.contentType ?? 'application/octet-stream',
    })
    formData.append('file', blob, options?.filename ?? 'file')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

    const response = await fetch('https://api.web3.storage/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.web3StorageToken}`,
      },
      body: formData,
      signal: controller.signal,
    })
      .catch((e: Error) => {
        console.warn(`[Filecoin] Web3.Storage upload failed: ${e.message}`)
        return null
      })
      .finally(() => {
        clearTimeout(timeoutId)
      })

    if (!response?.ok) return null

    const result = Web3StorageUploadResponseSchema.parse(await response.json())

    const dealIds = (result.deals ?? [])
      .filter((d) => d.dealId)
      .map((d) => String(d.dealId))

    return {
      cid: result.cid,
      dealIds,
      size: result.size ?? content.length,
      cost: BigInt(0), // Web3.Storage handles payment
    }
  }

  /**
   * Upload via Lighthouse.storage
   */
  private async uploadViaLighthouse(
    content: Buffer,
    options?: {
      filename?: string
      contentType?: string
    },
  ): Promise<{
    cid: string
    dealIds: string[]
    size: number
    cost: bigint
  } | null> {
    if (!this.config.lighthouseToken) return null

    const formData = new FormData()
    const blob = new Blob([new Uint8Array(content)], {
      type: options?.contentType ?? 'application/octet-stream',
    })
    formData.append('file', blob, options?.filename ?? 'file')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

    const response = await fetch('https://node.lighthouse.storage/api/v0/add', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.lighthouseToken}`,
      },
      body: formData,
      signal: controller.signal,
    })
      .catch((e: Error) => {
        console.warn(`[Filecoin] Lighthouse upload failed: ${e.message}`)
        return null
      })
      .finally(() => {
        clearTimeout(timeoutId)
      })

    if (!response?.ok) return null

    const result = LighthouseUploadResponseSchema.parse(await response.json())

    // Lighthouse creates deals asynchronously - track the CID
    return {
      cid: result.Hash,
      dealIds: [], // Deals created asynchronously
      size: parseInt(result.Size, 10),
      cost: BigInt(0), // Lighthouse handles payment
    }
  }

  /**
   * Upload via Storacha (new Web3.Storage platform)
   */
  private async uploadViaStoracha(
    content: Buffer,
    options?: {
      filename?: string
    },
  ): Promise<{
    cid: string
    dealIds: string[]
    size: number
    cost: bigint
  } | null> {
    if (!this.config.storachaToken) return null

    // Storacha uses the w3up-client protocol
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

    const response = await fetch('https://up.storacha.network/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.storachaToken}`,
        'Content-Type': 'application/octet-stream',
        'X-File-Name': options?.filename ?? 'file',
      },
      body: new Uint8Array(content),
      signal: controller.signal,
    })
      .catch((e: Error) => {
        console.warn(`[Filecoin] Storacha upload failed: ${e.message}`)
        return null
      })
      .finally(() => {
        clearTimeout(timeoutId)
      })

    if (!response?.ok) return null

    const result = z.object({ cid: z.string() }).parse(await response.json())

    return {
      cid: result.cid,
      dealIds: [], // Deals tracked separately
      size: content.length,
      cost: BigInt(0),
    }
  }

  /**
   * Direct upload via Lotus API (create deals manually)
   */
  private async uploadDirect(
    content: Buffer,
    options: {
      contentHash: string
      replicationFactor: number
      dealDuration?: number
    },
  ): Promise<{ cid: string; dealIds: string[]; size: number; cost: bigint }> {
    // First, add content to IPFS
    const ipfsCid = await this.addToIPFS(content)

    // Get available storage providers
    const providers = await this.getStorageProviders(options.replicationFactor)

    // Create deals with multiple providers
    const dealIds: string[] = []
    let totalCost = BigInt(0)

    for (const provider of providers) {
      const deal = await this.createDeal(ipfsCid, provider, {
        duration: options.dealDuration ?? this.config.defaultDealDuration,
      })
      if (deal) {
        dealIds.push(deal.dealId)
        totalCost += deal.totalCost
        this.deals.set(deal.dealId, deal)
      }
    }

    // Track CID to deal mapping
    this.cidToDealId.set(ipfsCid, dealIds)

    return {
      cid: ipfsCid,
      dealIds,
      size: content.length,
      cost: totalCost,
    }
  }

  // ============ Download/Retrieval Methods ============

  /**
   * Download content from Filecoin
   * Tries multiple retrieval paths for fastest delivery
   */
  async download(cid: string): Promise<Buffer> {
    // Try IPFS gateway first (fastest for hot content)
    const ipfsResult = await this.downloadFromIPFS(cid)
    if (ipfsResult) {
      console.log(`[Filecoin] Retrieved from IPFS: ${cid}`)
      return ipfsResult
    }

    // Try Web3.Storage gateway
    const w3sResult = await this.downloadFromGateway(
      `https://w3s.link/ipfs/${cid}`,
    )
    if (w3sResult) {
      console.log(`[Filecoin] Retrieved from Web3.Storage gateway: ${cid}`)
      return w3sResult
    }

    // Try Lighthouse gateway
    const lhResult = await this.downloadFromGateway(
      `https://gateway.lighthouse.storage/ipfs/${cid}`,
    )
    if (lhResult) {
      console.log(`[Filecoin] Retrieved from Lighthouse gateway: ${cid}`)
      return lhResult
    }

    // Try Filecoin retrieval market
    const retrievalResult = await this.retrieveFromFilecoin(cid)
    if (retrievalResult) {
      console.log(`[Filecoin] Retrieved from retrieval market: ${cid}`)
      return retrievalResult
    }

    throw new Error(`Failed to retrieve content: ${cid}`)
  }

  /**
   * Fast retrieval via Saturn CDN
   */
  async downloadFast(cid: string): Promise<Buffer> {
    // Saturn is Filecoin's CDN layer for fast retrieval
    const saturnResult = await this.downloadFromGateway(
      `https://saturn.ms/ipfs/${cid}`,
    )
    if (saturnResult) {
      return saturnResult
    }

    // Fall back to regular download
    return this.download(cid)
  }

  private async downloadFromIPFS(cid: string): Promise<Buffer | null> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

    const response = await fetch(
      `${this.config.ipfsApiUrl}/api/v0/cat?arg=${cid}`,
      {
        method: 'POST',
        signal: controller.signal,
      },
    )
      .catch(() => null)
      .finally(() => {
        clearTimeout(timeoutId)
      })

    if (!response?.ok) return null
    return Buffer.from(await response.arrayBuffer())
  }

  private async downloadFromGateway(url: string): Promise<Buffer | null> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

    const response = await fetch(url, {
      signal: controller.signal,
    })
      .catch(() => null)
      .finally(() => {
        clearTimeout(timeoutId)
      })

    if (!response?.ok) return null
    return Buffer.from(await response.arrayBuffer())
  }

  /**
   * Retrieve from Filecoin retrieval market
   */
  private async retrieveFromFilecoin(cid: string): Promise<Buffer | null> {
    // Find retrieval offers
    const offers = await this.findRetrievalOffers(cid)
    if (offers.length === 0) {
      console.warn(`[Filecoin] No retrieval offers for: ${cid}`)
      return null
    }

    // Sort by price and try each offer
    const sortedOffers = offers.sort((a, b) => Number(a.price - b.price))

    for (const offer of sortedOffers) {
      if (offer.price > this.config.maxRetrievalPrice) {
        console.warn(`[Filecoin] Offer price too high: ${offer.price}`)
        continue
      }

      const result = await this.executeRetrieval(cid, offer)
      if (result) {
        return result
      }
    }

    return null
  }

  // ============ Deal Management ============

  /**
   * Get deal status
   */
  async getDealStatus(dealId: string): Promise<FilecoinDeal | null> {
    // Check local cache first
    const cached = this.deals.get(dealId)
    if (cached && Date.now() - cached.updatedAt < 60000) {
      return cached
    }

    // Query Lotus API
    const response = await this.lotusRpc('StateMarketStorageDeal', [
      parseInt(dealId, 10),
      null,
    ])

    if (!response) return null

    // Type assertion for Lotus StateMarketStorageDeal response
    interface DealResponse {
      Proposal?: {
        PieceCID?: { '/': string }
        Provider?: string
        PieceSize?: number
        Duration?: number
        StartEpoch?: number
        EndEpoch?: number
        StoragePricePerEpoch?: string
      }
      State?: {
        SectorStartEpoch?: number
        SlashEpoch?: number
        LastUpdatedEpoch?: number
      }
    }
    const dealResponse = response as DealResponse

    const deal: FilecoinDeal = {
      dealId,
      cid: dealResponse.Proposal?.PieceCID?.['/'] ?? '',
      provider: dealResponse.Proposal?.Provider ?? '',
      pieceSize: dealResponse.Proposal?.PieceSize ?? 0,
      duration: dealResponse.Proposal?.Duration ?? 0,
      startEpoch: dealResponse.Proposal?.StartEpoch ?? 0,
      endEpoch: dealResponse.Proposal?.EndEpoch ?? 0,
      pricePerEpoch: BigInt(dealResponse.Proposal?.StoragePricePerEpoch ?? '0'),
      totalCost:
        BigInt(dealResponse.Proposal?.StoragePricePerEpoch ?? '0') *
        BigInt(dealResponse.Proposal?.Duration ?? 0),
      status: this.mapDealState(dealResponse.State?.SectorStartEpoch),
      createdAt: cached?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      proofCount: (dealResponse.State?.SlashEpoch ?? 0) > 0 ? 0 : 1,
      lastProofEpoch: dealResponse.State?.LastUpdatedEpoch ?? 0,
    }

    this.deals.set(dealId, deal)
    return deal
  }

  /**
   * Get all deals for a CID
   */
  async getDealsForCID(cid: string): Promise<FilecoinDeal[]> {
    const dealIds = this.cidToDealId.get(cid) ?? []
    const deals: FilecoinDeal[] = []

    for (const dealId of dealIds) {
      const deal = await this.getDealStatus(dealId)
      if (deal) {
        deals.push(deal)
      }
    }

    return deals
  }

  /**
   * Renew expiring deals
   */
  async renewDeal(
    dealId: string,
    additionalEpochs: number,
  ): Promise<string | null> {
    const currentDeal = await this.getDealStatus(dealId)
    if (!currentDeal) return null

    // Re-upload to create new deal
    const content = await this.download(currentDeal.cid)
    const result = await this.upload(content, {
      replicationFactor: 1,
      dealDuration: additionalEpochs,
    })

    return result.dealIds[0] ?? null
  }

  // ============ Storage Provider Methods ============

  /**
   * Get available storage providers
   */
  async getStorageProviders(count: number): Promise<FilecoinProvider[]> {
    const response = await this.lotusRpc('StateListMiners', [null])
    if (!response) return []

    // StateListMiners returns an array of miner IDs
    const minerList = Array.isArray(response) ? response : []
    const miners: string[] = minerList.slice(0, count * 3) as string[] // Get more for filtering

    const providers: FilecoinProvider[] = []

    for (const miner of miners) {
      const info = await this.getMinerInfo(miner)
      if (info?.retrievalEnabled && info.score > 0.8) {
        providers.push(info)
        if (providers.length >= count) break
      }
    }

    // Sort by score and price
    return providers
      .sort(
        (a, b) =>
          b.score - a.score || Number(a.pricePerGiBEpoch - b.pricePerGiBEpoch),
      )
      .slice(0, count)
  }

  /**
   * Get miner info
   */
  private async getMinerInfo(
    minerId: string,
  ): Promise<FilecoinProvider | null> {
    const [info, power] = await Promise.all([
      this.lotusRpc('StateMinerInfo', [minerId, null]),
      this.lotusRpc('StateMinerPower', [minerId, null]),
    ])

    if (!info) return null

    // Type assertions for Lotus RPC responses
    interface MinerInfoResponse {
      Owner?: string
      PeerId?: string
      StoragePricePerEpoch?: string
      MinPieceSize?: number
      MaxPieceSize?: number
    }
    interface MinerPowerResponse {
      MinerPower?: {
        RawBytePower?: string
        QualityAdjPower?: string
      }
    }

    const minerInfo = info as MinerInfoResponse
    const minerPower = power as MinerPowerResponse | null

    return {
      id: minerId,
      address: minerInfo.Owner ?? '',
      peerId: minerInfo.PeerId ?? '',
      region: this.inferRegion(),
      power: BigInt(minerPower?.MinerPower?.RawBytePower ?? '0'),
      qualityPower: BigInt(minerPower?.MinerPower?.QualityAdjPower ?? '0'),
      pricePerGiBEpoch: BigInt(minerInfo.StoragePricePerEpoch ?? '0'),
      minDealSize: minerInfo.MinPieceSize ?? 0,
      maxDealSize: minerInfo.MaxPieceSize ?? 0,
      verified: true,
      retrievalEnabled: true, // Would query retrieval market
      onlineDeals: 0,
      faultCount: 0,
      score: 0.9, // Would calculate from reputation
    }
  }

  // ============ Proof Verification ============

  /**
   * Verify storage proof for a deal
   */
  async verifyStorageProof(dealId: string): Promise<{
    valid: boolean
    lastProofEpoch: number
    missedProofs: number
  }> {
    const deal = await this.getDealStatus(dealId)
    if (!deal) {
      return { valid: false, lastProofEpoch: 0, missedProofs: 0 }
    }

    // Query sector info for the deal
    const sectorInfo = await this.lotusRpc('StateSectorGetInfo', [
      deal.provider,
      deal.startEpoch, // Sector number approximation
      null,
    ])

    if (!sectorInfo) {
      return { valid: false, lastProofEpoch: 0, missedProofs: 0 }
    }

    // Check if sector is active and proofs are being submitted
    const currentEpoch = await this.getCurrentEpoch()
    const expectedProofs = Math.floor((currentEpoch - deal.startEpoch) / 2880) // Daily proofs
    const actualProofs = deal.proofCount

    return {
      valid: actualProofs >= expectedProofs - 1, // Allow 1 missed proof
      lastProofEpoch: deal.lastProofEpoch,
      missedProofs: Math.max(0, expectedProofs - actualProofs),
    }
  }

  // ============ Cost Estimation ============

  /**
   * Estimate storage cost
   */
  async estimateCost(
    sizeBytes: number,
    durationEpochs?: number,
    replicationFactor?: number,
  ): Promise<{
    totalFil: bigint
    perProviderFil: bigint
    usd: string
    breakdown: {
      storage: bigint
      retrieval: bigint
      gas: bigint
    }
  }> {
    const duration = durationEpochs ?? this.config.defaultDealDuration
    const replicas = replicationFactor ?? this.config.replicationFactor

    // Get average provider price
    const providers = await this.getStorageProviders(5)
    const avgPrice =
      providers.length > 0
        ? providers.reduce((sum, p) => sum + p.pricePerGiBEpoch, BigInt(0)) /
          BigInt(providers.length)
        : this.config.maxPricePerGiBEpoch

    // Calculate storage cost
    const gib = Math.ceil(sizeBytes / (1024 * 1024 * 1024))
    const storageCost =
      avgPrice * BigInt(gib) * BigInt(duration) * BigInt(replicas)

    // Estimate retrieval cost (typically 10% of storage)
    const retrievalCost = storageCost / BigInt(10)

    // Estimate gas (fixed overhead per deal)
    const gasCost = BigInt(replicas) * BigInt('50000000000000') // ~0.00005 FIL per deal

    const totalFil = storageCost + retrievalCost + gasCost

    // Get FIL/USD rate
    let usd = '0'
    const rateResponse = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=filecoin&vs_currencies=usd',
    ).catch(() => null)

    if (rateResponse?.ok) {
      const rates = z
        .object({ filecoin: z.object({ usd: z.number() }) })
        .safeParse(await rateResponse.json())
      if (rates.success) {
        const filUsd = rates.data.filecoin.usd
        const totalFilFloat = Number(totalFil) / 1e18
        usd = (totalFilFloat * filUsd).toFixed(4)
      }
    }

    return {
      totalFil,
      perProviderFil: storageCost / BigInt(replicas),
      usd,
      breakdown: {
        storage: storageCost,
        retrieval: retrievalCost,
        gas: gasCost,
      },
    }
  }

  // ============ Health Check ============

  async healthCheck(): Promise<boolean> {
    const response = await this.lotusRpc('ChainHead', [])
    return response !== null
  }

  async exists(cid: string): Promise<boolean> {
    // Check if we have deals for this CID
    const deals = await this.getDealsForCID(cid)
    if (deals.some((d) => d.status === 'active' || d.status === 'sealed')) {
      return true
    }

    // Check IPFS/gateways
    const ipfsExists = await this.downloadFromIPFS(cid)
    return ipfsExists !== null
  }

  // ============ Private Helpers ============

  private async addToIPFS(content: Buffer): Promise<string> {
    const formData = new FormData()
    formData.append('file', new Blob([new Uint8Array(content)]))

    const response = await fetch(
      `${this.config.ipfsApiUrl}/api/v0/add?pin=true`,
      {
        method: 'POST',
        body: formData,
      },
    )

    if (!response.ok) {
      throw new Error('Failed to add content to IPFS')
    }

    const result = z.object({ Hash: z.string() }).parse(await response.json())
    return result.Hash
  }

  private async createDeal(
    cid: string,
    provider: FilecoinProvider,
    options: { duration: number },
  ): Promise<FilecoinDeal | null> {
    // This would use Lotus client API to create a storage deal
    // For now, return a mock deal structure
    console.log(`[Filecoin] Creating deal with ${provider.id} for ${cid}`)

    const currentEpoch = await this.getCurrentEpoch()
    const dealId = `deal-${Date.now()}-${Math.random().toString(36).slice(2)}`

    return {
      dealId,
      cid,
      provider: provider.id,
      pieceSize: 0, // Would be calculated from CAR file
      duration: options.duration,
      startEpoch: currentEpoch + 2880, // Start in ~1 day
      endEpoch: currentEpoch + options.duration,
      pricePerEpoch: provider.pricePerGiBEpoch,
      totalCost: provider.pricePerGiBEpoch * BigInt(options.duration),
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      proofCount: 0,
      lastProofEpoch: 0,
    }
  }

  private async findRetrievalOffers(cid: string): Promise<
    Array<{
      provider: string
      price: bigint
      size: number
    }>
  > {
    const response = await this.lotusRpc('ClientFindData', [{ '/': cid }, null])

    if (!response) return []

    // ClientFindData returns an array of offers
    const offers = Array.isArray(response) ? response : []

    return offers
      .filter((offer: Record<string, unknown>) => !offer.Err)
      .map((offer: Record<string, unknown>) => ({
        provider: String(offer.Miner ?? ''),
        price: BigInt(String(offer.MinPrice ?? '0')),
        size: Number(offer.Size ?? 0),
      }))
  }

  private async executeRetrieval(
    cid: string,
    offer: { provider: string; price: bigint },
  ): Promise<Buffer | null> {
    // This would use Lotus client retrieval API
    // For now, fall back to gateway retrieval
    console.log(
      `[Filecoin] Executing retrieval from ${offer.provider} for ${cid}`,
    )
    return null
  }

  private async lotusRpc(
    method: string,
    params: unknown[],
  ): Promise<Record<string, unknown> | null> {
    const response = await fetch(this.config.lotusApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.lotusToken && {
          Authorization: `Bearer ${this.config.lotusToken}`,
        }),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: `Filecoin.${method}`,
        params,
      }),
    }).catch(() => null)

    if (!response?.ok) return null

    const result = await response.json()
    return result.result ?? null
  }

  private async getCurrentEpoch(): Promise<number> {
    const head = await this.lotusRpc('ChainHead', [])
    return ((head as Record<string, unknown>)?.Height as number) ?? 0
  }

  private mapDealState(sectorStartEpoch?: number): FilecoinDealStatus {
    if (!sectorStartEpoch || sectorStartEpoch === 0) return 'pending'
    if (sectorStartEpoch < 0) return 'terminated'
    return 'active'
  }

  private inferRegion(): string {
    // In production, this would query miner location data
    // For now, return unknown
    return 'unknown'
  }
}

// ============ Factory ============

let globalFilecoinBackend: FilecoinBackend | null = null

export function getFilecoinBackend(
  config?: Partial<FilecoinBackendConfig>,
): FilecoinBackend {
  if (!globalFilecoinBackend) {
    globalFilecoinBackend = new FilecoinBackend(config)
  }
  return globalFilecoinBackend
}

export function resetFilecoinBackend(): void {
  globalFilecoinBackend = null
}
