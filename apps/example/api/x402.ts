import { getCurrentNetwork, tryGetContract } from '@jejunetwork/config'
import { expectAddress, isValidAddress } from '@jejunetwork/types'
import { type Context, Elysia } from 'elysia'
import type { Address, Hex } from 'viem'
import { createPublicClient, http, parseAbi, verifyMessage } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import type {
  X402Config,
  X402PaymentHeader,
  X402VerifyInput,
} from '../lib/schemas'
import { x402PaymentHeaderSchema, x402VerifySchema } from '../lib/schemas'
import type { X402PaymentResult, X402Token } from '../lib/types'
import {
  expectValid,
  sanitizeErrorMessage,
  ValidationError,
} from './utils/validation'

// Validated token addresses
const NATIVE_TOKEN_ADDRESS = expectAddress(
  '0x0000000000000000000000000000000000000000',
  'Native token address',
)
const BASE_USDC_ADDRESS = expectAddress(
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'Base USDC address',
)

// Default token configurations
const TOKENS: Record<string, X402Token> = {
  JEJU: {
    symbol: 'JEJU',
    address: NATIVE_TOKEN_ADDRESS,
    decimals: 18,
    minAmount: BigInt(1e15), // 0.001 JEJU
  },
  USDC: {
    symbol: 'USDC',
    address: BASE_USDC_ADDRESS,
    decimals: 6,
    minAmount: BigInt(1e4), // 0.01 USDC
  },
}

// Environment configuration
const NETWORK = getCurrentNetwork()
const IS_LOCALNET = NETWORK === 'localnet'

// Default dev address (Anvil account #0) - ONLY for localnet
const DEV_PAYMENT_ADDRESS = expectAddress(
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  'DEV_PAYMENT_ADDRESS',
)

// In production, X402_PAYMENT_ADDRESS is required
const getPaymentAddress = (): Address => {
  const network = getCurrentNetwork()
  const configuredAddress =
    typeof process !== 'undefined'
      ? process.env.X402_PAYMENT_ADDRESS
      : undefined
  if (configuredAddress) {
    if (isValidAddress(configuredAddress)) {
      return configuredAddress
    }
    console.warn('[x402] Invalid X402_PAYMENT_ADDRESS format')
  }
  // Try config fallback
  const configAddress = tryGetContract('x402', 'payment', network)
  if (configAddress) {
    return configAddress as Address
  }
  if (IS_LOCALNET) {
    return DEV_PAYMENT_ADDRESS
  }
  // In production without configured address, disable x402 payments
  console.warn(
    '[x402] X402_PAYMENT_ADDRESS not configured - payments will fail',
  )
  return NATIVE_TOKEN_ADDRESS
}

const PAYMENT_ADDRESS = getPaymentAddress()
const X402_ENABLED =
  process.env.X402_ENABLED !== 'false' &&
  PAYMENT_ADDRESS !== '0x0000000000000000000000000000000000000000'

// Price per request in USDC micro-units (1 = $0.000001)
const PRICES = {
  free: BigInt(0),
  basic: BigInt(1000), // $0.001
  premium: BigInt(10000), // $0.01
  ai: BigInt(100000), // $0.1
}

export interface X402Middleware {
  config: X402Config
  requirePayment: (
    price?: keyof typeof PRICES,
  ) => (
    ctx: Context,
  ) => Promise<{ error: string; details?: string } | undefined>
  verifyPayment: (header: string) => Promise<X402PaymentResult>
  getPaymentInfo: () => {
    address: Address
    tokens: X402Token[]
    prices: typeof PRICES
  }
}

class X402MiddlewareImpl implements X402Middleware {
  config: X402Config
  private client

  constructor() {
    const chain = !IS_LOCALNET && NETWORK === 'mainnet' ? base : baseSepolia

    this.config = {
      enabled: X402_ENABLED,
      acceptedTokens: [TOKENS.JEJU, TOKENS.USDC],
      paymentAddress: PAYMENT_ADDRESS,
      pricePerRequest: PRICES.basic,
      network: NETWORK === 'mainnet' ? 'base' : 'base-sepolia',
    }

    this.client = createPublicClient({
      chain,
      transport: http(),
    })
  }

  requirePayment(price: keyof typeof PRICES = 'basic') {
    return async (
      ctx: Context,
    ): Promise<{ error: string; details?: string } | undefined> => {
      // Skip payment check if disabled
      if (!this.config.enabled) {
        return undefined
      }

      // Free tier doesn't require payment
      if (price === 'free') {
        return undefined
      }

      const paymentHeader = ctx.request.headers.get('X-Payment')

      if (!paymentHeader) {
        return this.sendPaymentRequired(ctx.set, price)
      }

      const result = await this.verifyPayment(paymentHeader)

      if (!result.valid) {
        ctx.set.status = 402
        return { error: 'Payment verification failed', details: result.error }
      }

      // Payment verified, store txHash in context
      ctx.store = { ...ctx.store, x402TxHash: result.txHash }
      return undefined
    }
  }

  async verifyPayment(header: string): Promise<X402PaymentResult> {
    const payment = this.parsePaymentHeader(header)
    if (!payment) {
      throw new ValidationError('Invalid payment header format')
    }

    // Validate payment structure with zod
    const validatedPayment = expectValid(
      x402PaymentHeaderSchema,
      payment,
      'Payment header',
    )

    // Check deadline
    const now = Date.now()
    const deadlineMs = validatedPayment.deadline * 1000
    if (now > deadlineMs) {
      throw new ValidationError(
        `Payment deadline expired: ${deadlineMs} is in the past (now: ${now})`,
      )
    }

    // Check payee matches
    if (
      validatedPayment.payee.toLowerCase() !==
      this.config.paymentAddress.toLowerCase()
    ) {
      throw new ValidationError(
        `Invalid payment recipient: ${validatedPayment.payee} != ${this.config.paymentAddress}`,
      )
    }

    // Verify signature
    const message = this.constructPaymentMessage(validatedPayment)
    const isValid = await this.verifySignature(
      message,
      validatedPayment.signature,
      validatedPayment.payer,
    )

    if (!isValid) {
      throw new ValidationError('Invalid signature')
    }

    // Verify on-chain payment (for production)
    if (!IS_LOCALNET) {
      const onChainValid = await this.verifyOnChainPayment(validatedPayment)
      if (!onChainValid.valid) {
        return onChainValid
      }
    }

    return { valid: true, txHash: validatedPayment.signature } // Use signature as receipt in dev
  }

  getPaymentInfo() {
    return {
      address: this.config.paymentAddress,
      tokens: this.config.acceptedTokens,
      prices: PRICES,
    }
  }

  private parsePaymentHeader(
    header: string,
  ): Record<string, string | number> | null {
    // Format: token:amount:payer:payee:nonce:deadline:signature
    const parts = header.split(':')
    if (parts.length !== 7) {
      return null
    }

    const deadline = parseInt(parts[5], 10)
    if (Number.isNaN(deadline) || deadline <= 0) {
      return null
    }

    return {
      token: parts[0],
      amount: parts[1],
      payer: parts[2],
      payee: parts[3],
      nonce: parts[4],
      deadline,
      signature: parts[6],
    }
  }

  private constructPaymentMessage(payment: X402PaymentHeader): string {
    return `x402-payment:${payment.token}:${payment.amount}:${payment.payer}:${payment.payee}:${payment.nonce}:${payment.deadline}`
  }

  private async verifySignature(
    message: string,
    signature: Hex,
    expectedSigner: Address,
  ): Promise<boolean> {
    const recovered = await verifyMessage({
      address: expectedSigner,
      message,
      signature,
    })
    return recovered
  }

  private async verifyOnChainPayment(
    payment: X402PaymentHeader,
  ): Promise<X402PaymentResult> {
    // Check if token is native or ERC20
    const isNative =
      payment.token === '0x0000000000000000000000000000000000000000'

    if (isNative) {
      // For native token, we'd check a payment escrow contract
      // For now, signature-based verification is sufficient
      return { valid: true }
    }

    // Check ERC20 allowance/balance
    const erc20Abi = parseAbi([
      'function allowance(address owner, address spender) view returns (uint256)',
      'function balanceOf(address account) view returns (uint256)',
    ])

    const [allowance, balance] = await Promise.all([
      this.client.readContract({
        address: payment.token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [payment.payer, this.config.paymentAddress],
      }),
      this.client.readContract({
        address: payment.token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [payment.payer],
      }),
    ])

    const amount = BigInt(payment.amount)
    if (balance < amount) {
      return { valid: false, error: 'Insufficient token balance' }
    }
    if (allowance < amount) {
      return { valid: false, error: 'Insufficient token allowance' }
    }

    return { valid: true }
  }

  private sendPaymentRequired(
    set: Context['set'],
    tier: keyof typeof PRICES,
  ): { error: string; code: string; payment: Record<string, unknown> } {
    const price = PRICES[tier]
    const acceptedTokens = this.config.acceptedTokens
      .map((t) => t.symbol)
      .join(', ')

    set.status = 402
    return {
      error: 'Payment Required',
      code: 'PAYMENT_REQUIRED',
      payment: {
        recipient: this.config.paymentAddress,
        amount: price.toString(),
        currency: 'USDC',
        acceptedTokens,
        network: this.config.network,
        message: `x402 payment required. Send ${price} to ${this.config.paymentAddress} and include X-Payment header.`,
        headerFormat: 'token:amount:payer:payee:nonce:deadline:signature',
      },
    }
  }
}

let x402Middleware: X402Middleware | null = null

export function getX402Middleware(): X402Middleware {
  if (!x402Middleware) {
    x402Middleware = new X402MiddlewareImpl()
  }
  return x402Middleware
}

// Helper to create x402 routes
export function createX402Routes() {
  const x402 = getX402Middleware()

  return new Elysia({ prefix: '/x402' })
    .onError(({ error, set }) => {
      console.error('[x402 Error]', error)

      if (error instanceof ValidationError) {
        set.status = 400
        return { valid: false, error: error.message }
      }

      const errorObj = error instanceof Error ? error : new Error(String(error))
      const safeMessage = sanitizeErrorMessage(errorObj, IS_LOCALNET)
      set.status = 500
      return { valid: false, error: safeMessage }
    })
    .get('/info', () => {
      const info = x402.getPaymentInfo()
      return {
        enabled: x402.config.enabled,
        paymentAddress: info.address,
        acceptedTokens: info.tokens.map((t) => ({
          symbol: t.symbol,
          address: t.address,
          decimals: t.decimals,
        })),
        prices: Object.fromEntries(
          Object.entries(info.prices).map(([k, v]) => [k, v.toString()]),
        ),
        network: x402.config.network,
      }
    })
    .post('/verify', async ({ body, set }) => {
      const validatedInput: X402VerifyInput = expectValid(
        x402VerifySchema,
        body,
        'Verify payment input',
      )

      const result = await x402.verifyPayment(validatedInput.header)
      if (!result.valid) {
        set.status = 400
      }
      return result
    })
}
