/**
 * x402 Payment Integration for OAuth3
 *
 * Enables micropayments for:
 * - IPFS storage (pinning fees)
 * - TEE compute time
 * - API calls
 *
 * Uses HTTP 402 Payment Required with x402 protocol.
 */

import { type Address, type Hex, keccak256, toBytes } from 'viem'
import { validateResponse, X402PaymentHeaderSchema } from '../validation.js'

export interface PaymentConfig {
  /** Wallet address for payments */
  payerAddress: Address
  /** Signing function for payment authorization */
  signPayment: (message: Hex) => Promise<Hex>
  /** Payment token address (USDC, ETH, etc.) */
  tokenAddress?: Address
  /** Maximum payment per request (in token units) */
  maxPaymentPerRequest?: bigint
}

export interface PaymentRequest {
  /** Recipient address */
  recipient: Address
  /** Amount in token units */
  amount: bigint
  /** Token address */
  token: Address
  /** Resource being paid for */
  resource: string
  /** Expiry timestamp */
  expiry: number
  /** Unique nonce */
  nonce: Hex
}

export interface PaymentAuthorization {
  /** Payment request details */
  request: PaymentRequest
  /** Signature authorizing payment */
  signature: Hex
  /** Payer address */
  payer: Address
}

export interface PaymentReceipt {
  /** Transaction hash on-chain */
  txHash?: Hex
  /** Payment ID */
  paymentId: Hex
  /** Amount paid */
  amount: bigint
  /** Resource accessed */
  resource: string
  /** Timestamp */
  timestamp: number
}

/**
 * x402 Payment Client
 *
 * Handles HTTP 402 responses and authorizes micropayments.
 */
export class X402PaymentClient {
  private config: PaymentConfig
  private pendingPayments: Map<Hex, PaymentAuthorization> = new Map()

  constructor(config: PaymentConfig) {
    this.config = config
  }

  /**
   * Make an HTTP request with x402 payment support
   *
   * If the server returns 402, this will:
   * 1. Parse the payment request from headers
   * 2. Authorize the payment if within limits
   * 3. Retry the request with payment authorization
   */
  async fetchWithPayment(
    url: string,
    options: RequestInit = {},
  ): Promise<Response> {
    // First attempt without payment
    const response = await fetch(url, options)

    if (response.status !== 402) {
      return response
    }

    // Parse payment request from headers
    const paymentRequest = this.parsePaymentRequest(response)

    if (!paymentRequest) {
      throw new Error('Invalid 402 response: missing payment request')
    }

    // Check if payment is within limits
    if (
      this.config.maxPaymentPerRequest &&
      paymentRequest.amount > this.config.maxPaymentPerRequest
    ) {
      throw new Error(
        `Payment amount ${paymentRequest.amount} exceeds limit ${this.config.maxPaymentPerRequest}`,
      )
    }

    // Authorize payment
    const authorization = await this.authorizePayment(paymentRequest)

    // Retry with payment
    const retryOptions: RequestInit = {
      ...options,
      headers: {
        ...options.headers,
        'X-402-Payment': JSON.stringify(authorization),
      },
    }

    return fetch(url, retryOptions)
  }

  /**
   * Parse payment request from 402 response
   */
  private parsePaymentRequest(response: Response): PaymentRequest | null {
    const paymentHeader = response.headers.get('X-402-Payment-Required')

    if (!paymentHeader) {
      return null
    }

    const parsed = validateResponse(
      X402PaymentHeaderSchema,
      JSON.parse(paymentHeader),
      'x402 payment header',
    )

    return {
      recipient: parsed.recipient as Address,
      amount: BigInt(parsed.amount),
      token: parsed.token as Address,
      resource: parsed.resource,
      expiry: parsed.expiry,
      nonce: parsed.nonce as Hex,
    }
  }

  /**
   * Authorize a payment request
   */
  private async authorizePayment(
    request: PaymentRequest,
  ): Promise<PaymentAuthorization> {
    // Check if token matches configured token
    if (
      this.config.tokenAddress &&
      request.token !== this.config.tokenAddress
    ) {
      throw new Error(`Unsupported payment token: ${request.token}`)
    }

    // Create message to sign
    const message = this.createPaymentMessage(request)

    // Sign the payment authorization
    const signature = await this.config.signPayment(message)

    const authorization: PaymentAuthorization = {
      request,
      signature,
      payer: this.config.payerAddress,
    }

    // Store for receipt tracking
    this.pendingPayments.set(request.nonce, authorization)

    return authorization
  }

  /**
   * Create the message to sign for payment authorization
   */
  private createPaymentMessage(request: PaymentRequest): Hex {
    const encoded = toBytes(
      `x402-payment:${request.recipient}:${request.amount}:${request.token}:${request.resource}:${request.expiry}:${request.nonce}`,
    )
    return keccak256(encoded)
  }

  /**
   * Get pending payment authorizations
   */
  getPendingPayments(): PaymentAuthorization[] {
    return Array.from(this.pendingPayments.values())
  }

  /**
   * Clear a pending payment (after receipt)
   */
  clearPendingPayment(nonce: Hex): void {
    this.pendingPayments.delete(nonce)
  }

  /**
   * Create a pre-authorized payment for a resource
   */
  async preAuthorize(
    recipient: Address,
    amount: bigint,
    resource: string,
    validitySeconds: number = 3600,
  ): Promise<PaymentAuthorization> {
    const request: PaymentRequest = {
      recipient,
      amount,
      token:
        this.config.tokenAddress ||
        ('0x0000000000000000000000000000000000000000' as Address),
      resource,
      expiry: Math.floor(Date.now() / 1000) + validitySeconds,
      nonce: keccak256(toBytes(`${Date.now()}-${crypto.randomUUID()}`)),
    }

    return this.authorizePayment(request)
  }
}

/**
 * Storage payment calculator
 */
export function calculateStorageFee(
  sizeBytes: number,
  durationDays: number,
  tier: 'hot' | 'warm' | 'cold' | 'permanent',
): bigint {
  // Base rate: 0.00001 USDC per byte per day for hot storage
  const baseRate = BigInt(10) // In smallest units (wei-like)

  const tierMultiplier = {
    hot: BigInt(10),
    warm: BigInt(5),
    cold: BigInt(1),
    permanent: BigInt(1000), // Permanent is 100x cold for infinite duration
  }

  const bytes = BigInt(sizeBytes)
  const days = BigInt(durationDays)

  return (bytes * days * baseRate * tierMultiplier[tier]) / BigInt(1e6)
}

/**
 * Compute payment calculator
 */
export function calculateComputeFee(
  durationMinutes: number,
  cpuCores: number,
  memoryGb: number,
  teeType: 'dstack' | 'phala' | 'simulated',
): bigint {
  // Base rate: 0.001 USDC per minute per core
  const baseRate = BigInt(1000)

  const teeMultiplier = {
    dstack: BigInt(15), // 1.5x for TDX
    phala: BigInt(12), // 1.2x for SGX
    simulated: BigInt(10), // 1x for simulated
  }

  const minutes = BigInt(durationMinutes)
  const cores = BigInt(cpuCores)
  const memory = BigInt(memoryGb)

  // Price = minutes * (cores + memory/4) * baseRate * teeMultiplier
  return (
    (minutes *
      (cores + memory / BigInt(4)) *
      baseRate *
      teeMultiplier[teeType]) /
    BigInt(10)
  )
}

let instance: X402PaymentClient | null = null

export function createX402PaymentClient(
  config: PaymentConfig,
): X402PaymentClient {
  if (!instance) {
    instance = new X402PaymentClient(config)
  }
  return instance
}

export function resetX402PaymentClient(): void {
  instance = null
}
