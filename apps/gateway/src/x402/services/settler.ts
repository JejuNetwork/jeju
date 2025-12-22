/**
 * Payment Settlement Service
 */

import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  formatUnits,
  type Hex,
  http,
  type PublicClient,
  parseEventLogs,
  type TransactionReceipt,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { config, getPrivateKeyFromKMS } from '../config'
import { getChainConfig, getTokenConfig, ZERO_ADDRESS } from '../lib/chains'
import { ERC20_ABI, X402_FACILITATOR_ABI } from '../lib/contracts'
import type { DecodedPayment, SettlementResult } from '../lib/types'

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
    nonceManagerModule = await import('./nonce-manager-distributed.js')
    console.log('[Settler] Using distributed nonce manager')
  } else {
    nonceManagerModule = await import('./nonce-manager.js')
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
const clientCache = new Map<
  string,
  {
    publicClient: PublicClient
    walletClient: WalletClient | null
    chain: Chain
  }
>()

export async function createClients(
  network: string,
): Promise<{ publicClient: PublicClient; walletClient: WalletClient | null }> {
  const cached = clientCache.get(network)
  if (cached)
    return {
      publicClient: cached.publicClient,
      walletClient: cached.walletClient,
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
  })

  let walletClient: WalletClient | null = null
  const privateKey = (await getPrivateKeyFromKMS()) ?? cfg.privateKey

  if (privateKey) {
    walletClient = createWalletClient({
      account: privateKeyToAccount(privateKey),
      chain,
      transport: http(chainConfig.rpcUrl, transportConfig),
    })
  }

  clientCache.set(network, { publicClient, walletClient, chain })
  return { publicClient, walletClient }
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

  const stats = await publicClient.readContract({
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

  return (await publicClient.readContract({
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
  return (await publicClient.readContract({
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

  return (await publicClient.readContract({
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
    paymentId: logs[0].args.paymentId as Hex,
    protocolFee: logs[0].args.protocolFee as bigint,
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

async function executeSettlement(
  payment: DecodedPayment,
  publicClient: PublicClient,
  walletClient: WalletClient,
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
    return { success: false, error: nonceReservation.error }
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
    return { success: false, error: prereq.error }
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
      if (!walletClient.account) throw new Error('Wallet client has no account')
      const { request } = await publicClient.simulateContract({
        address: cfg.facilitatorAddress,
        abi: X402_FACILITATOR_ABI,
        functionName,
        args: args as never,
        account: walletClient.account,
      })

      const gasEstimate = await publicClient.estimateContractGas({
        address: cfg.facilitatorAddress,
        abi: X402_FACILITATOR_ABI,
        functionName,
        args: args as never,
        account: walletClient.account,
      })

      const gasLimit = BigInt(
        Math.ceil(Number(gasEstimate) * RETRY_CONFIG.gasMultiplier),
      )

      const hash = await walletClient.writeContract({
        ...request,
        gas: gasLimit,
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })

      if (receipt.status !== 'success') {
        throw new Error('Transaction reverted')
      }

      const { paymentId, protocolFee } = extractPaymentEvent(receipt)
      await markUsed(payment.payer, payment.nonce)
      pendingSettlements.delete(settlementKey)

      return { success: true, txHash: hash, paymentId, protocolFee }
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
  return { success: false, error: lastError?.message ?? 'Settlement failed' }
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
  _network: string,
  publicClient: PublicClient,
  walletClient: WalletClient,
): Promise<SettlementResult> {
  return executeSettlement(payment, publicClient, walletClient, 'settle', [
    payment.payer,
    payment.recipient,
    payment.token,
    payment.amount,
    payment.resource,
    payment.nonce,
    BigInt(payment.timestamp),
    payment.signature,
  ])
}

export async function settleGaslessPayment(
  payment: DecodedPayment,
  _network: string,
  publicClient: PublicClient,
  walletClient: WalletClient,
  authParams: {
    validAfter: number
    validBefore: number
    authNonce: Hex
    authSignature: Hex
  },
): Promise<SettlementResult> {
  return executeSettlement(
    payment,
    publicClient,
    walletClient,
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
