/**
 * Cache billing via x402 payment protocol
 */

import { getCQL } from '@jejunetwork/db'
import type { Address, Hex } from 'viem'
import { isAddress, keccak256, toBytes } from 'viem'
import type { CacheInstance, CacheRentalPlan } from './types'

export const BillingMode = {
  HOURLY: 'hourly',
  MONTHLY: 'monthly',
  METERED: 'metered',
} as const
export type BillingMode = (typeof BillingMode)[keyof typeof BillingMode]

const BILLING_MODES = new Set(Object.values(BillingMode))

export function parseBillingMode(value: string): BillingMode {
  if (!BILLING_MODES.has(value as BillingMode)) {
    throw new Error(
      `Invalid billing mode: ${value}. Must be one of: ${Array.from(BILLING_MODES).join(', ')}`,
    )
  }
  return value as BillingMode
}

export const PaymentStatus = {
  PENDING: 'pending',
  VERIFIED: 'verified',
  FAILED: 'failed',
  EXPIRED: 'expired',
  REFUNDED: 'refunded',
} as const
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus]

export const SubscriptionStatus = {
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
} as const
export type SubscriptionStatus =
  (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus]

export interface CachePayment {
  id: string
  instanceId: string
  owner: Address
  amount: bigint
  asset: Address
  txHash: Hex
  status: PaymentStatus
  billingMode: BillingMode
  periodStart: number
  periodEnd: number
  createdAt: number
  verifiedAt?: number
}

export interface CacheSubscription {
  id: string
  instanceId: string
  owner: Address
  planId: string
  billingMode: BillingMode
  status: SubscriptionStatus
  currentPeriodStart: number
  currentPeriodEnd: number
  nextBillingDate: number
  lastPaymentId?: string
  totalPaid: bigint
  createdAt: number
  cancelledAt?: number
}

export interface UsageMetrics {
  instanceId: string
  periodStart: number
  periodEnd: number
  operations: {
    gets: number
    sets: number
    deletes: number
    total: number
  }
  peakMemoryMb: number
  avgMemoryMb: number
  networkInBytes: number
  networkOutBytes: number
}

export interface BillingInvoice {
  id: string
  instanceId: string
  owner: Address
  periodStart: number
  periodEnd: number
  lineItems: InvoiceLineItem[]
  subtotal: bigint
  platformFee: bigint
  total: bigint
  status: 'draft' | 'issued' | 'paid' | 'void'
  createdAt: number
  paidAt?: number
  paymentId?: string
}

export interface InvoiceLineItem {
  description: string
  quantity: number
  unitPrice: bigint
  total: bigint
}

export interface CachePaymentConfig {
  paymentRecipient: Address
  networkId: number
  assetAddress: Address
  baseUrl: string
  platformFeeBps: number
  /** Trust proofs without on-chain verification (dev only) */
  trustPaymentProofs: boolean
  rpcUrl?: string
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address

const DEFAULT_PAYMENT_CONFIG: CachePaymentConfig = {
  paymentRecipient: ZERO_ADDRESS,
  networkId: 420690,
  assetAddress: ZERO_ADDRESS,
  platformFeeBps: 500,
  baseUrl: 'https://cache.dws.jeju.network',
  trustPaymentProofs: false, // Production default: require on-chain verification
}

export interface PaymentRequirement {
  x402Version: number
  error: string
  accepts: Array<{
    scheme: 'exact' | 'streaming'
    network: string
    maxAmountRequired: string
    asset: Address
    payTo: Address
    resource: string
    description: string
    metadata?: {
      instanceId?: string
      planId?: string
      billingMode?: string
      periodHours?: number
    }
  }>
}

export interface PaymentProof {
  txHash: Hex
  amount: bigint
  asset: Address
  payer: Address
  timestamp: number
}

export class CacheBillingManager {
  private config: CachePaymentConfig
  private subscriptions: Map<string, CacheSubscription> = new Map()
  private payments: Map<string, CachePayment> = new Map()
  private usageMetrics: Map<string, UsageMetrics[]> = new Map()
  private invoices: Map<string, BillingInvoice> = new Map()
  private cqlClient: ReturnType<typeof getCQL> | null = null
  private initialized = false

  constructor(config: Partial<CachePaymentConfig> = {}) {
    this.config = { ...DEFAULT_PAYMENT_CONFIG, ...config }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    // Validate production config
    if (!this.config.trustPaymentProofs) {
      if (this.config.paymentRecipient === ZERO_ADDRESS) {
        throw new Error(
          '[Cache Billing] FATAL: paymentRecipient is zero address but trustPaymentProofs=false. ' +
            'Configure a valid payment recipient or set trustPaymentProofs=true for development.',
        )
      }
      if (!this.config.rpcUrl) {
        throw new Error(
          '[Cache Billing] FATAL: rpcUrl required when trustPaymentProofs=false. ' +
            'Configure rpcUrl for on-chain verification or set trustPaymentProofs=true for development.',
        )
      }
    } else if (this.config.paymentRecipient === ZERO_ADDRESS) {
      console.warn(
        '[Cache Billing] WARNING: Using zero address as payment recipient with trustPaymentProofs=true. ' +
          'This is only safe for development/testing.',
      )
    }

    try {
      this.cqlClient = getCQL()
      await this.ensureTables()
      await this.loadFromCQL()
    } catch (_err) {
      this.cqlClient = null
    }

    this.initialized = true
  }

  private async ensureTables(): Promise<void> {
    if (!this.cqlClient) return

    await this.cqlClient.exec(`
      CREATE TABLE IF NOT EXISTS cache_subscriptions (
        id TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL,
        owner TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        billing_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        current_period_start INTEGER NOT NULL,
        current_period_end INTEGER NOT NULL,
        next_billing_date INTEGER NOT NULL,
        last_payment_id TEXT,
        total_paid TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        cancelled_at INTEGER
      )
    `)

    await this.cqlClient.exec(`
      CREATE TABLE IF NOT EXISTS cache_payments (
        id TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL,
        owner TEXT NOT NULL,
        amount TEXT NOT NULL,
        asset TEXT NOT NULL,
        tx_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        billing_mode TEXT NOT NULL,
        period_start INTEGER NOT NULL,
        period_end INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        verified_at INTEGER
      )
    `)

    await this.cqlClient.exec(`
      CREATE TABLE IF NOT EXISTS cache_usage_metrics (
        id TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL,
        period_start INTEGER NOT NULL,
        period_end INTEGER NOT NULL,
        gets INTEGER NOT NULL,
        sets INTEGER NOT NULL,
        deletes INTEGER NOT NULL,
        total_ops INTEGER NOT NULL,
        peak_memory_mb REAL NOT NULL,
        avg_memory_mb REAL NOT NULL,
        network_in_bytes INTEGER NOT NULL,
        network_out_bytes INTEGER NOT NULL
      )
    `)

    await this.cqlClient.exec(`
      CREATE TABLE IF NOT EXISTS cache_invoices (
        id TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL,
        owner TEXT NOT NULL,
        period_start INTEGER NOT NULL,
        period_end INTEGER NOT NULL,
        line_items TEXT NOT NULL,
        subtotal TEXT NOT NULL,
        platform_fee TEXT NOT NULL,
        total TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        paid_at INTEGER,
        payment_id TEXT
      )
    `)
  }

  private async loadFromCQL(): Promise<void> {
    if (!this.cqlClient) return

    // Load subscriptions
    const subs = await this.cqlClient.query<{
      id: string
      instance_id: string
      owner: string
      plan_id: string
      billing_mode: string
      status: string
      current_period_start: number
      current_period_end: number
      next_billing_date: number
      last_payment_id: string | null
      total_paid: string
      created_at: number
      cancelled_at: number | null
    }>('SELECT * FROM cache_subscriptions WHERE status = ?', ['active'])

    for (const row of subs.rows) {
      this.subscriptions.set(row.id, {
        id: row.id,
        instanceId: row.instance_id,
        owner: row.owner as Address,
        planId: row.plan_id,
        billingMode: row.billing_mode as BillingMode,
        status: row.status as SubscriptionStatus,
        currentPeriodStart: row.current_period_start,
        currentPeriodEnd: row.current_period_end,
        nextBillingDate: row.next_billing_date,
        lastPaymentId: row.last_payment_id ?? undefined,
        totalPaid: BigInt(row.total_paid),
        createdAt: row.created_at,
        cancelledAt: row.cancelled_at ?? undefined,
      })
    }
  }

  createPaymentRequirement(
    plan: CacheRentalPlan,
    billingMode: BillingMode,
    instanceId?: string,
  ): PaymentRequirement {
    const amount =
      billingMode === BillingMode.MONTHLY
        ? plan.pricePerMonth
        : plan.pricePerHour

    const periodHours = billingMode === BillingMode.MONTHLY ? 720 : 1 // 30 days or 1 hour

    return {
      x402Version: 1,
      error: 'Payment required',
      accepts: [
        {
          scheme: 'exact',
          network: `eip155:${this.config.networkId}`,
          maxAmountRequired: amount.toString(),
          asset: this.config.assetAddress,
          payTo: this.config.paymentRecipient,
          resource: `${this.config.baseUrl}/cache/instances`,
          description: `${plan.name} - ${billingMode === BillingMode.MONTHLY ? 'Monthly' : 'Hourly'} subscription`,
          metadata: {
            instanceId,
            planId: plan.id,
            billingMode,
            periodHours,
          },
        },
      ],
    }
  }

  parsePaymentProof(headers: Record<string, string>): PaymentProof | null {
    const proofHeader = headers['x-payment-proof'] || headers['X-Payment-Proof']
    if (!proofHeader) return null

    // Format: txHash:amount:asset:payer:timestamp
    const parts = proofHeader.split(':')
    if (parts.length < 5) return null

    const [txHash, amountStr, asset, payer, timestampStr] = parts

    // Validate required fields
    if (!txHash || !txHash.startsWith('0x') || txHash.length !== 66) return null
    if (!amountStr) return null
    if (!asset || !isAddress(asset)) return null
    if (!payer || !isAddress(payer)) return null
    if (!timestampStr) return null

    return {
      txHash: txHash as Hex,
      amount: BigInt(amountStr),
      asset: asset as Address,
      payer: payer as Address,
      timestamp: parseInt(timestampStr, 10),
    }
  }

  /** When trustPaymentProofs=true, proofs are trusted without chain verification */
  async verifyPayment(
    proof: PaymentProof,
    expectedAmount: bigint,
  ): Promise<{ valid: boolean; error?: string }> {
    // Validate transaction hash format
    if (!proof.txHash || proof.txHash.length !== 66) {
      return { valid: false, error: 'Invalid transaction hash' }
    }

    // Validate amount
    if (proof.amount < expectedAmount) {
      return {
        valid: false,
        error: `Insufficient payment: expected ${expectedAmount}, got ${proof.amount}`,
      }
    }

    // Check timestamp (must be within 5 minutes)
    const fiveMinutesAgo = Date.now() - 300000
    if (proof.timestamp < fiveMinutesAgo) {
      return { valid: false, error: 'Payment proof expired' }
    }

    // Check for replay (same txHash already used)
    for (const payment of this.payments.values()) {
      if (payment.txHash === proof.txHash) {
        return { valid: false, error: 'Transaction already used' }
      }
    }

    if (this.config.trustPaymentProofs) {
      return { valid: true }
    }

    if (!this.config.rpcUrl) {
      return {
        valid: false,
        error: 'On-chain verification required but no RPC URL configured',
      }
    }

    return this.verifyOnChain(proof)
  }

  private async verifyOnChain(
    proof: PaymentProof,
  ): Promise<{ valid: boolean; error?: string }> {
    if (!this.config.rpcUrl) {
      return { valid: false, error: 'RPC URL not configured' }
    }

    // Fetch transaction receipt
    const response = await fetch(this.config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getTransactionReceipt',
        params: [proof.txHash],
        id: 1,
      }),
    })

    if (!response.ok) {
      return { valid: false, error: 'Failed to fetch transaction receipt' }
    }

    const result = (await response.json()) as {
      result: {
        status: string
        logs: Array<{ topics: string[]; data: string }>
      } | null
    }

    if (!result.result) {
      return { valid: false, error: 'Transaction not found or not confirmed' }
    }

    if (result.result.status !== '0x1') {
      return { valid: false, error: 'Transaction failed' }
    }

    // ERC-20 Transfer event topic
    const TRANSFER_TOPIC =
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

    const transferLogs = result.result.logs.filter(
      (log) => log.topics[0] === TRANSFER_TOPIC,
    )

    // No Transfer event = ETH transfer, accept if tx succeeded
    if (transferLogs.length === 0) {
      return { valid: true }
    }

    const expectedRecipient = this.config.paymentRecipient
      .toLowerCase()
      .slice(2)
      .padStart(64, '0')
    const hasCorrectRecipient = transferLogs.some(
      (log) => log.topics[2]?.slice(2).toLowerCase() === expectedRecipient,
    )

    if (!hasCorrectRecipient) {
      return { valid: false, error: 'Payment to wrong recipient' }
    }

    return { valid: true }
  }

  async createSubscription(
    instanceId: string,
    owner: Address,
    plan: CacheRentalPlan,
    billingMode: BillingMode,
    proof: PaymentProof,
  ): Promise<CacheSubscription> {
    const expectedAmount =
      billingMode === BillingMode.MONTHLY
        ? plan.pricePerMonth
        : plan.pricePerHour

    const verification = await this.verifyPayment(proof, expectedAmount)
    if (!verification.valid) {
      throw new Error(`Payment verification failed: ${verification.error}`)
    }

    const now = Date.now()
    const periodMs =
      billingMode === BillingMode.MONTHLY
        ? 30 * 24 * 60 * 60 * 1000
        : 60 * 60 * 1000

    const subscriptionId = keccak256(toBytes(`sub:${instanceId}:${now}`)).slice(
      0,
      18,
    )
    const paymentId = keccak256(toBytes(`pay:${proof.txHash}:${now}`)).slice(
      0,
      18,
    )

    const payment: CachePayment = {
      id: paymentId,
      instanceId,
      owner,
      amount: proof.amount,
      asset: proof.asset,
      txHash: proof.txHash,
      status: PaymentStatus.VERIFIED,
      billingMode,
      periodStart: now,
      periodEnd: now + periodMs,
      createdAt: now,
      verifiedAt: now,
    }

    this.payments.set(paymentId, payment)

    const subscription: CacheSubscription = {
      id: subscriptionId,
      instanceId,
      owner,
      planId: plan.id,
      billingMode,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: now,
      currentPeriodEnd: now + periodMs,
      nextBillingDate: now + periodMs,
      lastPaymentId: paymentId,
      totalPaid: proof.amount,
      createdAt: now,
    }

    this.subscriptions.set(subscriptionId, subscription)
    await this.persistSubscription(subscription)
    await this.persistPayment(payment)
    return subscription
  }

  async processRenewal(
    subscriptionId: string,
    proof: PaymentProof,
    plan: CacheRentalPlan,
  ): Promise<CacheSubscription> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error(`Subscription ${subscriptionId} not found`)
    }

    if (subscription.status === SubscriptionStatus.CANCELLED) {
      throw new Error('Cannot renew cancelled subscription')
    }

    const expectedAmount =
      subscription.billingMode === BillingMode.MONTHLY
        ? plan.pricePerMonth
        : plan.pricePerHour

    const verification = await this.verifyPayment(proof, expectedAmount)
    if (!verification.valid) {
      throw new Error(`Payment verification failed: ${verification.error}`)
    }

    const now = Date.now()
    const periodMs =
      subscription.billingMode === BillingMode.MONTHLY
        ? 30 * 24 * 60 * 60 * 1000
        : 60 * 60 * 1000

    const paymentId = keccak256(toBytes(`pay:${proof.txHash}:${now}`)).slice(
      0,
      18,
    )

    const payment: CachePayment = {
      id: paymentId,
      instanceId: subscription.instanceId,
      owner: subscription.owner,
      amount: proof.amount,
      asset: proof.asset,
      txHash: proof.txHash,
      status: PaymentStatus.VERIFIED,
      billingMode: subscription.billingMode,
      periodStart: subscription.currentPeriodEnd,
      periodEnd: subscription.currentPeriodEnd + periodMs,
      createdAt: now,
      verifiedAt: now,
    }

    this.payments.set(paymentId, payment)
    subscription.currentPeriodStart = subscription.currentPeriodEnd
    subscription.currentPeriodEnd = subscription.currentPeriodEnd + periodMs
    subscription.nextBillingDate = subscription.currentPeriodEnd
    subscription.lastPaymentId = paymentId
    subscription.totalPaid = subscription.totalPaid + proof.amount
    subscription.status = SubscriptionStatus.ACTIVE
    await this.persistSubscription(subscription)
    await this.persistPayment(payment)
    return subscription
  }

  async cancelSubscription(
    subscriptionId: string,
    owner: Address,
  ): Promise<CacheSubscription> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error(`Subscription ${subscriptionId} not found`)
    }

    if (subscription.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('Not subscription owner')
    }

    subscription.status = SubscriptionStatus.CANCELLED
    subscription.cancelledAt = Date.now()
    await this.persistSubscription(subscription)
    return subscription
  }

  getSubscription(instanceId: string): CacheSubscription | undefined {
    for (const sub of this.subscriptions.values()) {
      if (
        sub.instanceId === instanceId &&
        sub.status === SubscriptionStatus.ACTIVE
      ) {
        return sub
      }
    }
    return undefined
  }

  hasActiveBilling(instanceId: string): boolean {
    const sub = this.getSubscription(instanceId)
    if (!sub) return false

    return (
      sub.status === SubscriptionStatus.ACTIVE &&
      sub.currentPeriodEnd > Date.now()
    )
  }

  async recordUsage(
    instanceId: string,
    metrics: Omit<UsageMetrics, 'instanceId'>,
  ): Promise<void> {
    const fullMetrics: UsageMetrics = {
      instanceId,
      ...metrics,
    }

    const existing = this.usageMetrics.get(instanceId) || []
    existing.push(fullMetrics)
    this.usageMetrics.set(instanceId, existing)

    if (this.cqlClient) {
      const id = keccak256(
        toBytes(`usage:${instanceId}:${metrics.periodStart}`),
      ).slice(0, 18)

      await this.cqlClient.exec(
        `INSERT INTO cache_usage_metrics 
         (id, instance_id, period_start, period_end, gets, sets, deletes, total_ops,
          peak_memory_mb, avg_memory_mb, network_in_bytes, network_out_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          instanceId,
          metrics.periodStart,
          metrics.periodEnd,
          metrics.operations.gets,
          metrics.operations.sets,
          metrics.operations.deletes,
          metrics.operations.total,
          metrics.peakMemoryMb,
          metrics.avgMemoryMb,
          metrics.networkInBytes,
          metrics.networkOutBytes,
        ],
      )
    }
  }

  async generateInvoice(
    instance: CacheInstance,
    plan: CacheRentalPlan,
    periodStart: number,
    periodEnd: number,
  ): Promise<BillingInvoice> {
    const subscription = this.getSubscription(instance.id)
    const billingMode = subscription?.billingMode ?? BillingMode.HOURLY
    const lineItems: InvoiceLineItem[] = []

    if (billingMode === BillingMode.MONTHLY) {
      lineItems.push({
        description: `${plan.name} - Monthly subscription`,
        quantity: 1,
        unitPrice: plan.pricePerMonth,
        total: plan.pricePerMonth,
      })
    } else {
      const hours = Math.ceil((periodEnd - periodStart) / (60 * 60 * 1000))
      lineItems.push({
        description: `${plan.name} - Hourly usage`,
        quantity: hours,
        unitPrice: plan.pricePerHour,
        total: plan.pricePerHour * BigInt(hours),
      })
    }

    const metrics = this.usageMetrics.get(instance.id) || []
    const periodMetrics = metrics.filter(
      (m) => m.periodStart >= periodStart && m.periodEnd <= periodEnd,
    )

    if (periodMetrics.length > 0 && billingMode === BillingMode.METERED) {
      const totalOps = periodMetrics.reduce(
        (sum, m) => sum + m.operations.total,
        0,
      )
      const opCost = 1000000000n
      lineItems.push({
        description: 'Operations (metered)',
        quantity: totalOps,
        unitPrice: opCost,
        total: opCost * BigInt(totalOps),
      })
    }

    const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0n)
    const platformFee = (subtotal * BigInt(this.config.platformFeeBps)) / 10000n
    const total = subtotal + platformFee

    const invoiceId = keccak256(
      toBytes(`inv:${instance.id}:${periodStart}`),
    ).slice(0, 18)

    const invoice: BillingInvoice = {
      id: invoiceId,
      instanceId: instance.id,
      owner: instance.owner,
      periodStart,
      periodEnd,
      lineItems,
      subtotal,
      platformFee,
      total,
      status: 'issued',
      createdAt: Date.now(),
    }

    this.invoices.set(invoiceId, invoice)

    if (this.cqlClient) {
      await this.cqlClient.exec(
        `INSERT INTO cache_invoices
         (id, instance_id, owner, period_start, period_end, line_items, subtotal, platform_fee, total, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoice.id,
          invoice.instanceId,
          invoice.owner,
          invoice.periodStart,
          invoice.periodEnd,
          JSON.stringify(
            lineItems.map((li) => ({
              ...li,
              unitPrice: li.unitPrice.toString(),
              total: li.total.toString(),
            })),
          ),
          subtotal.toString(),
          platformFee.toString(),
          total.toString(),
          invoice.status,
          invoice.createdAt,
        ],
      )
    }

    return invoice
  }

  getPaymentHistory(owner: Address): CachePayment[] {
    const payments: CachePayment[] = []
    for (const payment of this.payments.values()) {
      if (payment.owner.toLowerCase() === owner.toLowerCase()) {
        payments.push(payment)
      }
    }
    return payments.sort((a, b) => b.createdAt - a.createdAt)
  }

  getInvoices(owner: Address): BillingInvoice[] {
    const invoices: BillingInvoice[] = []
    for (const invoice of this.invoices.values()) {
      if (invoice.owner.toLowerCase() === owner.toLowerCase()) {
        invoices.push(invoice)
      }
    }
    return invoices.sort((a, b) => b.createdAt - a.createdAt)
  }

  getBillingStats(): {
    totalSubscriptions: number
    activeSubscriptions: number
    totalPayments: number
    totalRevenue: bigint
    totalInvoices: number
  } {
    let activeSubscriptions = 0
    let totalRevenue = 0n

    for (const sub of this.subscriptions.values()) {
      if (sub.status === SubscriptionStatus.ACTIVE) {
        activeSubscriptions++
      }
      totalRevenue += sub.totalPaid
    }

    return {
      totalSubscriptions: this.subscriptions.size,
      activeSubscriptions,
      totalPayments: this.payments.size,
      totalRevenue,
      totalInvoices: this.invoices.size,
    }
  }

  async processExpiredSubscriptions(): Promise<number> {
    const now = Date.now()
    const gracePeriod = 24 * 60 * 60 * 1000
    let expired = 0

    for (const subscription of this.subscriptions.values()) {
      if (
        subscription.status === SubscriptionStatus.ACTIVE &&
        subscription.currentPeriodEnd + gracePeriod < now
      ) {
        subscription.status = SubscriptionStatus.PAST_DUE
        await this.persistSubscription(subscription)
        expired++
      }
    }
    return expired
  }

  private async persistSubscription(sub: CacheSubscription): Promise<void> {
    if (!this.cqlClient) return

    await this.cqlClient.exec(
      `INSERT OR REPLACE INTO cache_subscriptions
       (id, instance_id, owner, plan_id, billing_mode, status, current_period_start,
        current_period_end, next_billing_date, last_payment_id, total_paid, created_at, cancelled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sub.id,
        sub.instanceId,
        sub.owner,
        sub.planId,
        sub.billingMode,
        sub.status,
        sub.currentPeriodStart,
        sub.currentPeriodEnd,
        sub.nextBillingDate,
        sub.lastPaymentId ?? null,
        sub.totalPaid.toString(),
        sub.createdAt,
        sub.cancelledAt ?? null,
      ],
    )
  }

  private async persistPayment(payment: CachePayment): Promise<void> {
    if (!this.cqlClient) return

    await this.cqlClient.exec(
      `INSERT INTO cache_payments
       (id, instance_id, owner, amount, asset, tx_hash, status, billing_mode,
        period_start, period_end, created_at, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payment.id,
        payment.instanceId,
        payment.owner,
        payment.amount.toString(),
        payment.asset,
        payment.txHash,
        payment.status,
        payment.billingMode,
        payment.periodStart,
        payment.periodEnd,
        payment.createdAt,
        payment.verifiedAt ?? null,
      ],
    )
  }

  stop(): void {
    this.initialized = false
  }
}

let billingManager: CacheBillingManager | null = null

export async function initializeCacheBilling(
  config?: Partial<CachePaymentConfig>,
): Promise<CacheBillingManager> {
  if (!billingManager) {
    billingManager = new CacheBillingManager(config)
    await billingManager.initialize()
  }
  return billingManager
}

export function getCacheBillingManager(): CacheBillingManager {
  if (!billingManager) {
    throw new Error('Cache billing not initialized')
  }
  return billingManager
}

export function resetCacheBilling(): void {
  if (billingManager) {
    billingManager.stop()
    billingManager = null
  }
}
