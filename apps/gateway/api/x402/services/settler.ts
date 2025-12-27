/**
 * X402 Payment Settler
 *
 * SECURITY: This module uses KMS for all signing operations.
 * Private keys are NEVER loaded into memory. All cryptographic
 * operations are delegated to the KMS service (MPC or TEE).
 */

import { readContract } from '@jejunetwork/contracts'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import {
  type Address,
  type Chain,
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  type Hex,
  http,
  type PublicClient,
  parseEventLogs,
  type TransactionReceipt,
} from 'viem'
import { getKMSSigner, type KMSSigner } from '../../../lib/kms-signer'
import { config } from '../config'
import { getChainConfig, getTokenConfig } from '../lib/chains'
import { ERC20_ABI, X402_FACILITATOR_ABI } from '../lib/contracts'
import type { DecodedPayment, SettlementResult } from '../lib/schemas'

let nonceManagerModule: {
  markNonceUsed: (payer: Address, nonce: string) => Promise<void>
  markNonceFailed: (payer: Address, nonce: string) => Promise<void>
  reserveNonce: (
    publicClient: PublicClient,
    payer: Address,
    nonce: string,
  ) => Promise<{ reserved: boolean; error?: string }>
} | null = null

async function getNonceManager() {
  if (nonceManagerModule) return nonceManagerModule

  if (process.env.CACHE_SERVICE_URL) {
    nonceManagerModule = await import('./nonce-manager-distributed')
    console.log('[Settler] Using distributed nonce manager')
  } else {
    nonceManagerModule = await import('./nonce-manager')
    console.log('[Settler] Using local nonce manager')
  }

  return nonceManagerModule
}

const RETRY_CONFIG = {
  maxRetries: parseInt(process.env.SETTLEMENT_MAX_RETRIES ?? '3', 10),
  baseDelayMs: parseInt(process.env.SETTLEMENT_RETRY_DELAY_MS ?? '1000', 10),
  maxDelayMs: parseInt(
    process.env.SETTLEMENT_MAX_RETRY_DELAY_MS ?? '30000',
    10,
  ),
  gasMultiplier: parseFloat(process.env.SETTLEMENT_GAS_MULTIPLIER ?? '1.2'),
}

const pendingSettlements = new Map<
  string,
  { timestamp: number; payment: DecodedPayment }
>()

// SECURITY: Client cache without wallet client - we use KMS for signing
const clientCache = new Map<
  string,
  {
    publicClient: PublicClient
    chain: Chain
    rpcUrl: string
  }
>()

// SECURITY: Lazy-initialized KMS signer - no private key in memory
let facilitatorSigner: KMSSigner | null = null
let facilitatorAddress: Address | null = null

async function getFacilitatorSigner(): Promise<KMSSigner> {
  if (!facilitatorSigner) {
    const serviceId =
      process.env.X402_FACILITATOR_SERVICE_ID ?? 'x402-facilitator'
    facilitatorSigner = getKMSSigner(serviceId)
    await facilitatorSigner.initialize()
    facilitatorAddress = await facilitatorSigner.getAddress()
    console.log(`[Settler] Facilitator signer initialized: ${facilitatorAddress}`)
    console.log(`[Settler] Signing mode: ${facilitatorSigner.getMode()}`)
  }
  return facilitatorSigner
}

async function getFacilitatorAddress(): Promise<Address> {
  if (!facilitatorAddress) {
    await getFacilitatorSigner()
  }
  if (!facilitatorAddress) {
    throw new Error('Facilitator address not initialized')
  }
  return facilitatorAddress
}

export async function createClients(
  network: string,
): Promise<{
  publicClient: PublicClient
  chain: Chain
  rpcUrl: string
  signerAddress: Address
}> {
  // Ensure signer is initialized
  const signerAddress = await getFacilitatorAddress()

  const cached = clientCache.get(network)
  if (cached) {
    return { ...cached, signerAddress }
  }

  const chainConfig = getChainConfig(network)
  if (!chainConfig) throw new Error(`Unsupported network: ${network}`)

  const cfg = config()
  const chain: Chain = {
    id: chainConfig.chainId,
    name: chainConfig.name,
    nativeCurrency: chainConfig.nativeCurrency,
    rpcUrls: { default: { http: [chainConfig.rpcUrl] } },
  }

  const transportConfig =
    cfg.environment === 'development'
      ? { retryCount: 1, retryDelay: 500, timeout: 2000 }
      : { retryCount: 3, retryDelay: 1000, timeout: 10000 }

  const publicClient = createPublicClient({
    chain,
    transport: http(chainConfig.rpcUrl, transportConfig),
  }) as PublicClient

  const clientData = { publicClient, chain, rpcUrl: chainConfig.rpcUrl }
  clientCache.set(network, clientData)

  return { ...clientData, signerAddress }
}

export function clearClientCache(): void {
  clientCache.clear()
}

export async function getFacilitatorStats(publicClient: PublicClient): Promise<{
  totalSettlements: bigint
  totalVolumeUSD: bigint
  protocolFeeBps: bigint
  feeRecipient: Address
}> {
  const cfg = config()
  if (cfg.facilitatorAddress === ZERO_ADDRESS) {
    return {
      totalSettlements: 0n,
      totalVolumeUSD: 0n,
      protocolFeeBps: BigInt(cfg.protocolFeeBps),
      feeRecipient: cfg.feeRecipient,
    }
  }

  const stats = await readContract(publicClient, {
    address: cfg.facilitatorAddress,
    abi: X402_FACILITATOR_ABI,
    functionName: 'getStats',
  })
  const [settlements, volumeUSD, feeBps, feeAddr] = stats as [
    bigint,
    bigint,
    bigint,
    Address,
  ]
  return {
    totalSettlements: settlements,
    totalVolumeUSD: volumeUSD,
    protocolFeeBps: feeBps,
    feeRecipient: feeAddr,
  }
}

export async function isTokenSupported(
  publicClient: PublicClient,
  token: Address,
): Promise<boolean> {
  const cfg = config()
  if (cfg.facilitatorAddress === ZERO_ADDRESS) return false

  return (await readContract(publicClient, {
    address: cfg.facilitatorAddress,
    abi: X402_FACILITATOR_ABI,
    functionName: 'supportedTokens',
    args: [token],
  })) as boolean
}

export async function getTokenBalance(
  publicClient: PublicClient,
  token: Address,
  account: Address,
): Promise<bigint> {
  return (await readContract(publicClient, {
    address: token,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account],
  })) as bigint
}

export async function getTokenAllowance(
  publicClient: PublicClient,
  token: Address,
  owner: Address,
): Promise<bigint> {
  const cfg = config()
  if (cfg.facilitatorAddress === ZERO_ADDRESS) return 0n

  return (await readContract(publicClient, {
    address: token,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [owner, cfg.facilitatorAddress],
  })) as bigint
}

function extractPaymentEvent(receipt: TransactionReceipt): {
  paymentId?: Hex
  protocolFee?: bigint
} {
  const logs = parseEventLogs({
    abi: X402_FACILITATOR_ABI,
    logs: receipt.logs,
    eventName: 'PaymentSettled',
  })
  if (logs.length === 0) return {}
  return {
    paymentId: logs[0].args.paymentId,
    protocolFee: logs[0].args.protocolFee,
  }
}

async function validateSettlementPrerequisites(
  publicClient: PublicClient,
  payment: DecodedPayment,
  isGasless = false,
): Promise<{ valid: boolean; error?: string }> {
  const cfg = config()
  if (cfg.facilitatorAddress === ZERO_ADDRESS) {
    return { valid: false, error: 'Facilitator contract not configured' }
  }
  if (!(await isTokenSupported(publicClient, payment.token))) {
    return { valid: false, error: `Token not supported: ${payment.token}` }
  }
  const balance = await getTokenBalance(
    publicClient,
    payment.token,
    payment.payer,
  )
  if (balance < payment.amount) {
    return {
      valid: false,
      error: `Insufficient balance: ${balance} < ${payment.amount}`,
    }
  }
  // EIP-3009 gasless transfers don't require pre-approval
  if (!isGasless) {
    const allowance = await getTokenAllowance(
      publicClient,
      payment.token,
      payment.payer,
    )
    if (allowance < payment.amount) {
      return {
        valid: false,
        error: `Insufficient allowance: ${allowance} < ${payment.amount}`,
      }
    }
  }
  return { valid: true }
}

function getRetryDelay(attempt: number): number {
  const delay = Math.min(
    RETRY_CONFIG.baseDelayMs * 2 ** attempt,
    RETRY_CONFIG.maxDelayMs,
  )
  return Math.round(delay + delay * 0.25 * (Math.random() * 2 - 1)) // ±25% jitter
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type SettlementArgs =
  | readonly [
      `0x${string}`,
      `0x${string}`,
      `0x${string}`,
      bigint,
      string,
      string,
      bigint,
      `0x${string}`,
    ]
  | readonly [
      `0x${string}`,
      `0x${string}`,
      `0x${string}`,
      bigint,
      string,
      string,
      bigint,
      `0x${string}`,
      bigint,
      bigint,
      `0x${string}`,
      `0x${string}`,
    ]

/**
 * Execute a settlement using KMS for signing.
 *
 * SECURITY: Private key never in memory. Transaction is built,
 * sent to KMS for signing, and broadcast.
 */
async function executeSettlement(
  payment: DecodedPayment,
  publicClient: PublicClient,
  chain: Chain,
  rpcUrl: string,
  functionName: 'settle' | 'settleWithAuthorization',
  args: SettlementArgs,
): Promise<SettlementResult> {
  const cfg = config()
  const settlementKey = `${payment.payer}:${payment.nonce}`
  const {
    reserveNonce,
    markNonceFailed: markFailed,
    markNonceUsed: markUsed,
  } = await getNonceManager()
  const isGasless = functionName === 'settleWithAuthorization'

  const nonceReservation = await reserveNonce(
    publicClient,
    payment.payer,
    payment.nonce,
  )
  if (!nonceReservation.reserved) {
    return {
      success: false,
      txHash: null,
      paymentId: null,
      protocolFee: null,
      error: nonceReservation.error ?? null,
    }
  }

  pendingSettlements.set(settlementKey, { timestamp: Date.now(), payment })

  const prereq = await validateSettlementPrerequisites(
    publicClient,
    payment,
    isGasless,
  )
  if (!prereq.valid) {
    await markFailed(payment.payer, payment.nonce)
    pendingSettlements.delete(settlementKey)
    return {
      success: false,
      txHash: null,
      paymentId: null,
      protocolFee: null,
      error: prereq.error ?? null,
    }
  }

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = getRetryDelay(attempt - 1)
      console.log(
        `[Settler] Retry ${attempt}/${RETRY_CONFIG.maxRetries} after ${delay}ms`,
      )
      await sleep(delay)
    }

    try {
      // Get signer and address
      const signer = await getFacilitatorSigner()
      const signerAddress = await getFacilitatorAddress()

      // Build transaction data
      const data = encodeFunctionData({
        abi: X402_FACILITATOR_ABI,
        functionName,
        args: args as never,
      })

      // Get nonce and gas parameters
      const [nonce, gasPrice] = await Promise.all([
        publicClient.getTransactionCount({ address: signerAddress }),
        publicClient.getGasPrice(),
      ])

      // Estimate gas with buffer
      const gasEstimate = await publicClient.estimateGas({
        account: signerAddress,
        to: cfg.facilitatorAddress,
        data,
      })
      const gasLimit = BigInt(
        Math.ceil(Number(gasEstimate) * RETRY_CONFIG.gasMultiplier),
      )

      // SECURITY: Sign and send via KMS - private key never in memory
      const hash = await signer.sendTransaction(
        {
          transaction: {
            to: cfg.facilitatorAddress,
            data,
            nonce,
            gas: gasLimit,
            gasPrice,
            chainId: chain.id,
          },
          chain,
        },
        rpcUrl,
      )

      const receipt = await publicClient.waitForTransactionReceipt({ hash })

      if (receipt.status !== 'success') {
        throw new Error('Transaction reverted')
      }

      const { paymentId, protocolFee } = extractPaymentEvent(receipt)
      await markUsed(payment.payer, payment.nonce)
      pendingSettlements.delete(settlementKey)

      return {
        success: true,
        txHash: hash,
        paymentId: paymentId ?? null,
        protocolFee: protocolFee ?? null,
        error: null,
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      console.error(
        `[Settler] Attempt ${attempt + 1} failed:`,
        lastError.message,
      )

      if (!isRetryableError(lastError)) break
    }
  }

  await markFailed(payment.payer, payment.nonce)
  pendingSettlements.delete(settlementKey)
  return {
    success: false,
    txHash: null,
    paymentId: null,
    protocolFee: null,
    error: lastError?.message ?? 'Settlement failed',
  }
}

function isRetryableError(error: Error): boolean {
  const msg = error.message.toLowerCase()

  const nonRetryable = [
    'insufficient funds',
    'insufficient balance',
    'insufficient allowance',
    'nonce already used',
    'execution reverted',
    'invalid signature',
    'user rejected',
    'user denied',
  ]
  if (nonRetryable.some((p) => msg.includes(p))) return false

  const retryable = [
    'timeout',
    'rate limit',
    'network',
    'connection',
    'econnrefused',
    'econnreset',
    'socket hang up',
    'nonce too low',
    'replacement transaction underpriced',
    'already known',
  ]
  return retryable.some((p) => msg.includes(p))
}

export async function settlePayment(
  payment: DecodedPayment,
  network: string,
  publicClient: PublicClient,
): Promise<SettlementResult> {
  const { chain, rpcUrl } = await createClients(network)
  return executeSettlement(
    payment,
    publicClient,
    chain,
    rpcUrl,
    'settle',
    [
      payment.payer,
      payment.recipient,
      payment.token,
      payment.amount,
      payment.resource,
      payment.nonce,
      BigInt(payment.timestamp),
      payment.signature,
    ],
  )
}

export async function settleGaslessPayment(
  payment: DecodedPayment,
  network: string,
  publicClient: PublicClient,
  authParams: {
    validAfter: number
    validBefore: number
    authNonce: Hex
    authSignature: Hex
  },
): Promise<SettlementResult> {
  const { chain, rpcUrl } = await createClients(network)
  return executeSettlement(
    payment,
    publicClient,
    chain,
    rpcUrl,
    'settleWithAuthorization',
    [
      payment.payer,
      payment.recipient,
      payment.token,
      payment.amount,
      payment.resource,
      payment.nonce,
      BigInt(payment.timestamp),
      payment.signature,
      BigInt(authParams.validAfter),
      BigInt(authParams.validBefore),
      authParams.authNonce,
      authParams.authSignature,
    ],
  )
}

export function calculateProtocolFee(amount: bigint, feeBps: number): bigint {
  return (amount * BigInt(feeBps)) / 10000n
}

export function formatAmount(
  amount: bigint,
  network: string,
  tokenAddress: Address,
): { human: string; base: string; symbol: string; decimals: number } {
  const tokenConfig = getTokenConfig(network, tokenAddress)
  return {
    human: formatUnits(amount, tokenConfig.decimals),
    base: amount.toString(),
    symbol: tokenConfig.symbol,
    decimals: tokenConfig.decimals,
  }
}

export function getPendingSettlementsCount(): number {
  return pendingSettlements.size
}

export async function cleanupStalePendingSettlements(): Promise<number> {
  const { markNonceFailed } = await getNonceManager()
  const now = Date.now()
  let cleaned = 0
  for (const [key, { timestamp, payment }] of pendingSettlements.entries()) {
    if (now - timestamp > 5 * 60 * 1000) {
      pendingSettlements.delete(key)
      await markNonceFailed(payment.payer, payment.nonce)
      cleaned++
    }
  }
  return cleaned
}

export function getRetryConfig(): typeof RETRY_CONFIG {
  return { ...RETRY_CONFIG }
}
