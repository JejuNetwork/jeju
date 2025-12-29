/**
 * Retrieval Market - Economic incentives for content delivery
 *
 * Features:
 * - Dynamic pricing based on demand and supply
 * - Payment channels for micro-payments
 * - Provider reputation and ranking
 * - Geographic routing for latency optimization
 * - Bandwidth tracking and accounting
 *
 * SECURITY: In production, all signing is delegated to KMS with FROST threshold
 * signing to protect against side-channel attacks. The full private key is never
 * reconstructed or held in memory.
 */

import { randomBytes } from 'node:crypto'
import { getCurrentNetwork, getRpcUrl } from '@jejunetwork/config'
import { createKMSSigner, type KMSSigner } from '@jejunetwork/kms'
import type { Address, Hex } from 'viem'
import { keccak256, parseEther } from 'viem'
import type { StorageBackendType } from './types'

// ============ Types ============

export type RetrievalStatus =
  | 'pending'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type PricingModel =
  | 'fixed' // Fixed price per byte
  | 'dynamic' // Dynamic based on demand
  | 'auction' // Lowest bid wins
  | 'free' // System content, no charge

export interface RetrievalProvider {
  providerId: string
  address: Address
  region: string
  bandwidth: BandwidthInfo
  pricing: ProviderPricing
  reputation: ProviderReputation
  supportedBackends: StorageBackendType[]
  isOnline: boolean
  lastSeen: number
  contentCids: string[] // CIDs this provider can serve
}

export interface BandwidthInfo {
  maxMbps: number
  currentMbps: number
  availableMbps: number
  bytesServed24h: number
  bytesServed7d: number
  peakHourUtilization: number
}

export interface ProviderPricing {
  model: PricingModel
  basePricePerGb: bigint // Wei per GB
  premiumMultiplier: number // Multiplier for high-demand content
  minimumCharge: bigint
  freeQuotaMb: number // Free MB per day per client
}

export interface ProviderReputation {
  score: number // 0-100
  totalRetrievals: number
  successfulRetrievals: number
  failedRetrievals: number
  averageLatencyMs: number
  uptime: number // Percentage
  disputesLost: number
  lastUpdated: number
}

export interface RetrievalRequest {
  requestId: string
  cid: string
  requesterAddress: Address
  preferredProviders: string[]
  preferredRegions: string[]
  maxPricePerGb: bigint
  deadline: number
  status: RetrievalStatus
  contentSize: number
  createdAt: number
}

export interface RetrievalOffer {
  offerId: string
  requestId: string
  providerId: string
  pricePerGb: bigint
  totalPrice: bigint
  estimatedLatencyMs: number
  estimatedDurationMs: number
  expiresAt: number
  accepted: boolean
}

export interface RetrievalDeal {
  dealId: string
  requestId: string
  offerId: string
  providerId: string
  requesterAddress: Address
  cid: string
  contentSize: number
  agreedPrice: bigint
  startedAt: number
  completedAt: number
  bytesTransferred: number
  status: RetrievalStatus
  paymentChannelId: string
}

export interface PaymentChannel {
  channelId: string
  sender: Address
  receiver: Address
  depositAmount: bigint
  spentAmount: bigint
  nonce: number
  expiresAt: number
  isOpen: boolean
}

export interface RetrievalReceipt {
  receiptId: string
  dealId: string
  providerId: string
  requesterAddress: Address
  cid: string
  bytesTransferred: number
  amountPaid: bigint
  latencyMs: number
  timestamp: number
  providerSignature: Hex
  requesterSignature: Hex
}

export interface MarketStats {
  totalProviders: number
  activeProviders: number
  totalBandwidthMbps: number
  availableBandwidthMbps: number
  totalRetrievals24h: number
  totalBytesServed24h: number
  averagePricePerGb: bigint
  averageLatencyMs: number
}

export interface RegionalStats {
  region: string
  providerCount: number
  availableBandwidthMbps: number
  averageLatencyMs: number
  averagePricePerGb: bigint
  popularContent: string[]
}

export interface RetrievalMarketConfig {
  defaultPricePerGb: bigint
  maxPricePerGb: bigint
  minProviderStake: bigint
  offerExpirySeconds: number
  maxRetrievalDurationSeconds: number
  disputeWindowSeconds: number
  paymentChannelContractAddress: Address
  marketContractAddress: Address
  rpcUrl: string
  /** KMS key ID for FROST threshold signing (required) */
  kmsKeyId: string
  ownerAddress?: Address
}

// ============ Default Configuration ============

const DEFAULT_MARKET_CONFIG: Omit<RetrievalMarketConfig, 'kmsKeyId'> & {
  kmsKeyId?: string
} = {
  defaultPricePerGb: parseEther('0.0001'), // 0.0001 ETH per GB
  maxPricePerGb: parseEther('0.01'), // 0.01 ETH per GB max
  minProviderStake: parseEther('0.1'), // 0.1 ETH minimum stake
  offerExpirySeconds: 60, // 1 minute
  maxRetrievalDurationSeconds: 3600, // 1 hour max
  disputeWindowSeconds: 86400, // 24 hours for disputes
  paymentChannelContractAddress: '0x0000000000000000000000000000000000000000',
  marketContractAddress: '0x0000000000000000000000000000000000000000',
  rpcUrl:
    (typeof process !== 'undefined' ? process.env.RPC_URL : undefined) ??
    getRpcUrl(getCurrentNetwork()),
  kmsKeyId:
    typeof process !== 'undefined'
      ? process.env.RETRIEVAL_MARKET_KMS_KEY_ID
      : undefined,
  ownerAddress: (typeof process !== 'undefined'
    ? process.env.RETRIEVAL_MARKET_OWNER_ADDRESS
    : undefined) as Address | undefined,
}

// ============ Retrieval Market Manager ============

export class RetrievalMarketManager {
  private config: RetrievalMarketConfig
  private providers: Map<string, RetrievalProvider> = new Map()
  private requests: Map<string, RetrievalRequest> = new Map()
  private offers: Map<string, RetrievalOffer> = new Map()
  private deals: Map<string, RetrievalDeal> = new Map()
  private paymentChannels: Map<string, PaymentChannel> = new Map()
  private receipts: Map<string, RetrievalReceipt> = new Map()
  private kmsSigner: KMSSigner
  private initialized = false

  constructor(
    providerId: string,
    config: Partial<RetrievalMarketConfig> & { kmsKeyId: string },
  ) {
    this.config = {
      ...DEFAULT_MARKET_CONFIG,
      ...config,
    } as RetrievalMarketConfig

    // Create KMS-backed signer (initialized lazily)
    const serviceId = `retrieval-market-${providerId}-${config.kmsKeyId}`
    this.kmsSigner = createKMSSigner({ serviceId })
    console.log(
      '[RetrievalMarketManager] Using KMS-based secure signing (FROST)',
    )
  }

  /** Initialize the signer - call before any signing operations */
  async initialize(): Promise<void> {
    if (this.initialized) return
    await this.kmsSigner.initialize()
    this.initialized = true
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'RetrievalMarketManager not initialized. Call initialize() first.',
      )
    }
  }

  // ============ Provider Management ============

  registerProvider(
    provider: Omit<RetrievalProvider, 'isOnline' | 'lastSeen'>,
  ): RetrievalProvider {
    const fullProvider: RetrievalProvider = {
      ...provider,
      isOnline: true,
      lastSeen: Date.now(),
    }

    this.providers.set(provider.providerId, fullProvider)
    return fullProvider
  }

  updateProviderStatus(providerId: string, isOnline: boolean): void {
    const provider = this.providers.get(providerId)
    if (provider) {
      provider.isOnline = isOnline
      provider.lastSeen = Date.now()
    }
  }

  updateProviderBandwidth(
    providerId: string,
    bandwidth: Partial<BandwidthInfo>,
  ): void {
    const provider = this.providers.get(providerId)
    if (provider) {
      provider.bandwidth = { ...provider.bandwidth, ...bandwidth }
    }
  }

  updateProviderReputation(
    providerId: string,
    retrieval: {
      successful: boolean
      latencyMs: number
    },
  ): void {
    const provider = this.providers.get(providerId)
    if (!provider) return

    const rep = provider.reputation
    rep.totalRetrievals++

    if (retrieval.successful) {
      rep.successfulRetrievals++
    } else {
      rep.failedRetrievals++
    }

    // Update average latency with exponential moving average
    rep.averageLatencyMs =
      rep.averageLatencyMs * 0.9 + retrieval.latencyMs * 0.1

    // Recalculate score
    rep.score = this.calculateReputationScore(rep)
    rep.lastUpdated = Date.now()
  }

  private calculateReputationScore(rep: ProviderReputation): number {
    if (rep.totalRetrievals === 0) return 50 // Default score for new providers

    const successRate = rep.successfulRetrievals / rep.totalRetrievals
    const latencyScore = Math.max(0, 100 - rep.averageLatencyMs / 10)
    const uptimeScore = rep.uptime
    const disputePenalty = rep.disputesLost * 5

    const score =
      successRate * 40 + latencyScore * 30 + uptimeScore * 30 - disputePenalty
    return Math.max(0, Math.min(100, score))
  }

  getProvider(providerId: string): RetrievalProvider | undefined {
    return this.providers.get(providerId)
  }

  getOnlineProviders(): RetrievalProvider[] {
    return Array.from(this.providers.values()).filter((p) => p.isOnline)
  }

  getProvidersForContent(cid: string): RetrievalProvider[] {
    return this.getOnlineProviders().filter((p) => p.contentCids.includes(cid))
  }

  getProvidersByRegion(region: string): RetrievalProvider[] {
    return this.getOnlineProviders().filter((p) => p.region === region)
  }

  // ============ Retrieval Requests ============

  async createRetrievalRequest(
    cid: string,
    contentSize: number,
    options?: {
      preferredProviders?: string[]
      preferredRegions?: string[]
      maxPricePerGb?: bigint
      deadlineSeconds?: number
    },
  ): Promise<RetrievalRequest> {
    const requestId = `req_${Date.now()}_${randomBytes(8).toString('hex')}`
    const now = Date.now()

    const request: RetrievalRequest = {
      requestId,
      cid,
      requesterAddress: await this.getAddress(),
      preferredProviders: options?.preferredProviders ?? [],
      preferredRegions: options?.preferredRegions ?? [],
      maxPricePerGb: options?.maxPricePerGb ?? this.config.maxPricePerGb,
      deadline: now + (options?.deadlineSeconds ?? 300) * 1000,
      status: 'pending',
      contentSize,
      createdAt: now,
    }

    this.requests.set(requestId, request)

    // Broadcast request to providers
    await this.broadcastRequest(request)

    return request
  }

  private async broadcastRequest(request: RetrievalRequest): Promise<void> {
    const providers = this.getProvidersForContent(request.cid)

    // Filter by preferences
    let eligibleProviders = providers
    if (request.preferredProviders.length > 0) {
      eligibleProviders = providers.filter((p) =>
        request.preferredProviders.includes(p.providerId),
      )
    }
    if (request.preferredRegions.length > 0) {
      eligibleProviders = eligibleProviders.filter((p) =>
        request.preferredRegions.includes(p.region),
      )
    }

    // If no preferred matches, use all providers
    if (eligibleProviders.length === 0) {
      eligibleProviders = providers
    }

    // Request offers from providers
    for (const provider of eligibleProviders) {
      await this.requestOffer(request, provider)
    }
  }

  private async requestOffer(
    request: RetrievalRequest,
    provider: RetrievalProvider,
  ): Promise<RetrievalOffer> {
    // Calculate price based on provider pricing model
    const sizeGb = request.contentSize / (1024 * 1024 * 1024)
    const pricePerGb = this.calculatePrice(provider, request.cid)
    const totalPrice = BigInt(Math.ceil(sizeGb * Number(pricePerGb)))

    // Estimate latency based on region and current load
    const estimatedLatencyMs = this.estimateLatency(provider)
    const estimatedDurationMs =
      (request.contentSize / (provider.bandwidth.availableMbps * 125000)) * 1000

    const offerId = `offer_${Date.now()}_${randomBytes(8).toString('hex')}`

    const offer: RetrievalOffer = {
      offerId,
      requestId: request.requestId,
      providerId: provider.providerId,
      pricePerGb,
      totalPrice,
      estimatedLatencyMs,
      estimatedDurationMs,
      expiresAt: Date.now() + this.config.offerExpirySeconds * 1000,
      accepted: false,
    }

    this.offers.set(offerId, offer)
    return offer
  }

  private calculatePrice(provider: RetrievalProvider, cid: string): bigint {
    const pricing = provider.pricing

    switch (pricing.model) {
      case 'free':
        return 0n

      case 'fixed':
        return pricing.basePricePerGb

      case 'dynamic': {
        // Price increases with demand and decreases with supply
        const demandMultiplier = this.getDemandMultiplier(cid)
        const supplyMultiplier = this.getSupplyMultiplier(provider)
        const multiplier = demandMultiplier / supplyMultiplier
        return BigInt(Math.ceil(Number(pricing.basePricePerGb) * multiplier))
      }

      case 'auction':
        // Start at base price, will be adjusted during auction
        return pricing.basePricePerGb
    }
  }

  private getDemandMultiplier(cid: string): number {
    // Calculate demand based on recent requests
    const recentRequests = Array.from(this.requests.values()).filter(
      (r) => r.cid === cid && r.createdAt > Date.now() - 3600000,
    )
    return Math.max(1, Math.log2(recentRequests.length + 1))
  }

  private getSupplyMultiplier(provider: RetrievalProvider): number {
    // More available bandwidth = lower prices
    const utilizationRatio =
      provider.bandwidth.currentMbps / provider.bandwidth.maxMbps
    return Math.max(0.5, 2 - utilizationRatio)
  }

  private estimateLatency(provider: RetrievalProvider): number {
    return provider.reputation.averageLatencyMs * (1 + Math.random() * 0.2)
  }

  // ============ Offer Management ============

  getOffersForRequest(requestId: string): RetrievalOffer[] {
    return Array.from(this.offers.values()).filter(
      (o) => o.requestId === requestId && o.expiresAt > Date.now(),
    )
  }

  getBestOffer(requestId: string): RetrievalOffer | undefined {
    const offers = this.getOffersForRequest(requestId)
    if (offers.length === 0) return undefined

    // Rank by price/latency ratio
    return offers.sort((a, b) => {
      const scoreA = Number(a.totalPrice) + a.estimatedLatencyMs * 100
      const scoreB = Number(b.totalPrice) + b.estimatedLatencyMs * 100
      return scoreA - scoreB
    })[0]
  }

  async acceptOffer(offerId: string): Promise<RetrievalDeal> {
    const offer = this.offers.get(offerId)
    if (!offer) {
      throw new Error('Offer not found')
    }
    if (offer.expiresAt <= Date.now()) {
      throw new Error('Offer expired')
    }

    const request = this.requests.get(offer.requestId)
    if (!request) {
      throw new Error('Request not found')
    }

    offer.accepted = true
    request.status = 'accepted'

    // Create payment channel
    const channel = await this.createPaymentChannel(
      await this.getAddress(),
      this.providers.get(offer.providerId)?.address ?? ('0x0' as Address),
      offer.totalPrice,
    )

    const dealId = `deal_${Date.now()}_${randomBytes(8).toString('hex')}`

    const deal: RetrievalDeal = {
      dealId,
      requestId: request.requestId,
      offerId: offer.offerId,
      providerId: offer.providerId,
      requesterAddress: request.requesterAddress,
      cid: request.cid,
      contentSize: request.contentSize,
      agreedPrice: offer.totalPrice,
      startedAt: Date.now(),
      completedAt: 0,
      bytesTransferred: 0,
      status: 'in_progress',
      paymentChannelId: channel.channelId,
    }

    this.deals.set(dealId, deal)
    return deal
  }

  // ============ Deal Execution ============

  async updateDealProgress(
    dealId: string,
    bytesTransferred: number,
  ): Promise<void> {
    const deal = this.deals.get(dealId)
    if (!deal) {
      throw new Error('Deal not found')
    }

    deal.bytesTransferred = bytesTransferred

    // Make incremental payment
    const channel = this.paymentChannels.get(deal.paymentChannelId)
    if (channel) {
      const fractionComplete = bytesTransferred / deal.contentSize
      const amountToSpend = BigInt(
        Math.floor(Number(deal.agreedPrice) * fractionComplete),
      )
      await this.updatePaymentChannel(channel.channelId, amountToSpend)
    }
  }

  async completeDeal(
    dealId: string,
    latencyMs: number,
  ): Promise<RetrievalReceipt> {
    const deal = this.deals.get(dealId)
    if (!deal) {
      throw new Error('Deal not found')
    }

    deal.status = 'completed'
    deal.completedAt = Date.now()
    deal.bytesTransferred = deal.contentSize

    // Close payment channel
    const channel = this.paymentChannels.get(deal.paymentChannelId)
    if (channel) {
      await this.closePaymentChannel(channel.channelId)
    }

    // Update provider reputation
    this.updateProviderReputation(deal.providerId, {
      successful: true,
      latencyMs,
    })

    // Create receipt
    const receipt = await this.createReceipt(deal, latencyMs)
    return receipt
  }

  async failDeal(dealId: string, _reason: string): Promise<void> {
    const deal = this.deals.get(dealId)
    if (!deal) {
      throw new Error('Deal not found')
    }

    deal.status = 'failed'

    // Refund remaining amount in payment channel
    const channel = this.paymentChannels.get(deal.paymentChannelId)
    if (channel) {
      await this.closePaymentChannel(channel.channelId)
    }

    // Update provider reputation
    this.updateProviderReputation(deal.providerId, {
      successful: false,
      latencyMs: 0,
    })

    // Update request status
    const request = this.requests.get(deal.requestId)
    if (request) {
      request.status = 'failed'
    }
  }

  // ============ Payment Channels ============

  private async createPaymentChannel(
    sender: Address,
    receiver: Address,
    amount: bigint,
  ): Promise<PaymentChannel> {
    const channelId = `channel_${Date.now()}_${randomBytes(8).toString('hex')}`

    const channel: PaymentChannel = {
      channelId,
      sender,
      receiver,
      depositAmount: amount,
      spentAmount: 0n,
      nonce: 0,
      expiresAt: Date.now() + this.config.maxRetrievalDurationSeconds * 1000,
      isOpen: true,
    }

    this.paymentChannels.set(channelId, channel)

    // In production, this would create an on-chain payment channel
    return channel
  }

  private async updatePaymentChannel(
    channelId: string,
    newSpentAmount: bigint,
  ): Promise<void> {
    const channel = this.paymentChannels.get(channelId)
    if (!channel) {
      throw new Error('Channel not found')
    }
    if (!channel.isOpen) {
      throw new Error('Channel is closed')
    }

    if (newSpentAmount > channel.depositAmount) {
      throw new Error('Insufficient channel balance')
    }

    channel.spentAmount = newSpentAmount
    channel.nonce++
  }

  private async closePaymentChannel(channelId: string): Promise<void> {
    const channel = this.paymentChannels.get(channelId)
    if (!channel) {
      throw new Error('Channel not found')
    }

    channel.isOpen = false

    // In production, this would close the on-chain payment channel
  }

  // ============ Receipts ============

  private async createReceipt(
    deal: RetrievalDeal,
    latencyMs: number,
  ): Promise<RetrievalReceipt> {
    const receiptId = `receipt_${Date.now()}_${randomBytes(8).toString('hex')}`

    const receiptData = {
      dealId: deal.dealId,
      providerId: deal.providerId,
      cid: deal.cid,
      bytesTransferred: deal.bytesTransferred,
      amountPaid: deal.agreedPrice,
      timestamp: Date.now(),
    }

    const messageHash = keccak256(Buffer.from(JSON.stringify(receiptData)))
    const signature = await this.signMessage(messageHash)

    const receipt: RetrievalReceipt = {
      receiptId,
      dealId: deal.dealId,
      providerId: deal.providerId,
      requesterAddress: deal.requesterAddress,
      cid: deal.cid,
      bytesTransferred: deal.bytesTransferred,
      amountPaid: deal.agreedPrice,
      latencyMs,
      timestamp: Date.now(),
      providerSignature: signature, // In production, provider would sign separately
      requesterSignature: signature,
    }

    this.receipts.set(receiptId, receipt)
    return receipt
  }

  // ============ Market Statistics ============

  getMarketStats(): MarketStats {
    const providers = Array.from(this.providers.values())
    const onlineProviders = providers.filter((p) => p.isOnline)

    const totalBandwidth = onlineProviders.reduce(
      (sum, p) => sum + p.bandwidth.maxMbps,
      0,
    )
    const availableBandwidth = onlineProviders.reduce(
      (sum, p) => sum + p.bandwidth.availableMbps,
      0,
    )

    const deals24h = Array.from(this.deals.values()).filter(
      (d) => d.startedAt > Date.now() - 86400000,
    )

    const totalBytes = deals24h.reduce((sum, d) => sum + d.bytesTransferred, 0)
    const avgPrice =
      deals24h.length > 0
        ? deals24h.reduce((sum, d) => sum + d.agreedPrice, 0n) /
          BigInt(deals24h.length)
        : this.config.defaultPricePerGb

    const avgLatency =
      onlineProviders.length > 0
        ? onlineProviders.reduce(
            (sum, p) => sum + p.reputation.averageLatencyMs,
            0,
          ) / onlineProviders.length
        : 0

    return {
      totalProviders: providers.length,
      activeProviders: onlineProviders.length,
      totalBandwidthMbps: totalBandwidth,
      availableBandwidthMbps: availableBandwidth,
      totalRetrievals24h: deals24h.length,
      totalBytesServed24h: totalBytes,
      averagePricePerGb: avgPrice,
      averageLatencyMs: avgLatency,
    }
  }

  getRegionalStats(): RegionalStats[] {
    const regions = new Map<string, RetrievalProvider[]>()

    for (const provider of this.getOnlineProviders()) {
      const list = regions.get(provider.region) ?? []
      list.push(provider)
      regions.set(provider.region, list)
    }

    return Array.from(regions.entries()).map(([region, providers]) => ({
      region,
      providerCount: providers.length,
      availableBandwidthMbps: providers.reduce(
        (sum, p) => sum + p.bandwidth.availableMbps,
        0,
      ),
      averageLatencyMs:
        providers.reduce((sum, p) => sum + p.reputation.averageLatencyMs, 0) /
        providers.length,
      averagePricePerGb:
        providers.reduce((sum, p) => sum + p.pricing.basePricePerGb, 0n) /
        BigInt(providers.length),
      popularContent: this.getPopularContentForRegion(region),
    }))
  }

  private getPopularContentForRegion(region: string): string[] {
    const providers = this.getProvidersByRegion(region)
    const cidCounts = new Map<string, number>()

    for (const provider of providers) {
      for (const cid of provider.contentCids) {
        cidCounts.set(cid, (cidCounts.get(cid) ?? 0) + 1)
      }
    }

    return Array.from(cidCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([cid]) => cid)
  }

  // ============ Query Methods ============

  getRequest(requestId: string): RetrievalRequest | undefined {
    return this.requests.get(requestId)
  }

  getDeal(dealId: string): RetrievalDeal | undefined {
    return this.deals.get(dealId)
  }

  getReceipt(receiptId: string): RetrievalReceipt | undefined {
    return this.receipts.get(receiptId)
  }

  getActiveDeals(): RetrievalDeal[] {
    return Array.from(this.deals.values()).filter(
      (d) => d.status === 'in_progress',
    )
  }

  getDealsForProvider(providerId: string): RetrievalDeal[] {
    return Array.from(this.deals.values()).filter(
      (d) => d.providerId === providerId,
    )
  }

  // ============ Helper Methods ============

  private async getAddress(): Promise<Address> {
    this.ensureInitialized()
    return this.kmsSigner.getAddress()
  }

  private async signMessage(message: Hex): Promise<Hex> {
    this.ensureInitialized()
    const result = await this.kmsSigner.signMessage(message)
    return result.signature
  }
}

// ============ Singleton Factory ============

let marketManager: RetrievalMarketManager | null = null

export function getRetrievalMarketManager(
  providerId: string,
  config: Partial<RetrievalMarketConfig> & { kmsKeyId: string },
): RetrievalMarketManager {
  if (!marketManager) {
    marketManager = new RetrievalMarketManager(providerId, config)
  }
  return marketManager
}

// ============ Retrieval Market Contract ABI ============

export const RETRIEVAL_MARKET_ABI = [
  {
    name: 'registerProvider',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'region', type: 'string' },
      { name: 'bandwidthMbps', type: 'uint256' },
      { name: 'pricePerGb', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'createRequest',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'cid', type: 'string' },
      { name: 'maxPricePerGb', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'requestId', type: 'bytes32' }],
  },
  {
    name: 'submitOffer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'requestId', type: 'bytes32' },
      { name: 'pricePerGb', type: 'uint256' },
      { name: 'estimatedLatencyMs', type: 'uint256' },
    ],
    outputs: [{ name: 'offerId', type: 'bytes32' }],
  },
  {
    name: 'acceptOffer',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'offerId', type: 'bytes32' }],
    outputs: [{ name: 'dealId', type: 'bytes32' }],
  },
  {
    name: 'completeDeal',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dealId', type: 'bytes32' },
      { name: 'bytesTransferred', type: 'uint256' },
      { name: 'receiptHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'disputeDeal',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dealId', type: 'bytes32' },
      { name: 'reason', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'getProviderInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [
      { name: 'region', type: 'string' },
      { name: 'bandwidthMbps', type: 'uint256' },
      { name: 'pricePerGb', type: 'uint256' },
      { name: 'stake', type: 'uint256' },
      { name: 'reputation', type: 'uint256' },
    ],
  },
  {
    name: 'ProviderRegistered',
    type: 'event',
    inputs: [
      { name: 'provider', type: 'address', indexed: true },
      { name: 'region', type: 'string', indexed: false },
      { name: 'stake', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'RequestCreated',
    type: 'event',
    inputs: [
      { name: 'requestId', type: 'bytes32', indexed: true },
      { name: 'requester', type: 'address', indexed: true },
      { name: 'cid', type: 'string', indexed: false },
    ],
  },
  {
    name: 'DealCompleted',
    type: 'event',
    inputs: [
      { name: 'dealId', type: 'bytes32', indexed: true },
      { name: 'provider', type: 'address', indexed: true },
      { name: 'requester', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const
