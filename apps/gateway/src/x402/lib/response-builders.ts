import type { Address } from 'viem'
import { calculateProtocolFee, formatAmount } from '../services/settler'
import type {
  DecodedPayment,
  SettlementResult,
  SettleResponse,
  VerifyResponse,
} from './types'

export function buildVerifyErrorResponse(error: string): VerifyResponse {
  return {
    isValid: false,
    invalidReason: error,
    payer: null,
    amount: null,
    timestamp: Date.now(),
  }
}

export function buildVerifySuccessResponse(
  signer: `0x${string}`,
  amount: string,
): VerifyResponse {
  return {
    isValid: true,
    invalidReason: null,
    payer: signer,
    amount,
    timestamp: Date.now(),
  }
}

export function buildSettleErrorResponse(
  network: string,
  error: string,
  payer: Address | null = null,
  recipient: Address | null = null,
  amount: {
    human: string
    base: string
    symbol: string
    decimals: number
  } | null = null,
  txHash: `0x${string}` | null = null,
): SettleResponse {
  return {
    success: false,
    txHash,
    networkId: network,
    settlementId: null,
    payer,
    recipient,
    amount,
    fee: null,
    net: null,
    error,
    timestamp: Date.now(),
  }
}

export function buildSettleSuccessResponse(
  network: string,
  payment: DecodedPayment,
  settlementResult: SettlementResult,
  feeBps: number,
): SettleResponse {
  const amountInfo = formatAmount(payment.amount, network, payment.token)
  const feeAmount =
    settlementResult.protocolFee ?? calculateProtocolFee(payment.amount, feeBps)
  const netAmount = payment.amount - feeAmount
  const feeFormatted = formatAmount(feeAmount, network, payment.token)
  const netFormatted = formatAmount(netAmount, network, payment.token)

  if (!settlementResult.txHash) {
    throw new Error('Settlement succeeded but txHash is missing')
  }

  return {
    success: true,
    txHash: settlementResult.txHash,
    networkId: network,
    settlementId: settlementResult.paymentId ?? null,
    payer: payment.payer,
    recipient: payment.recipient,
    amount: amountInfo,
    fee: { human: feeFormatted.human, base: feeFormatted.base, bps: feeBps },
    net: { human: netFormatted.human, base: netFormatted.base },
    error: null,
    timestamp: Date.now(),
  }
}
