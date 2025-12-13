import type { VerifyResponse, SettleResponse, DecodedPayment, SettlementResult } from './types';
import { formatAmount, calculateProtocolFee } from '../services/settler';

export function getNetworkFromRequest(requirementsNetwork: string | undefined, defaultNetwork: string): string {
  return requirementsNetwork ?? defaultNetwork;
}

export function buildVerifyErrorResponse(error: string, status: number = 200): VerifyResponse {
  return {
    isValid: false,
    invalidReason: error,
    payer: null,
    amount: null,
    timestamp: Date.now(),
  };
}

export function buildVerifySuccessResponse(signer: string, amount: string): VerifyResponse {
  return {
    isValid: true,
    invalidReason: null,
    payer: signer,
    amount,
    timestamp: Date.now(),
  };
}

export function buildSettleErrorResponse(
  network: string,
  error: string,
  payer: string | null = null,
  recipient: string | null = null,
  amount: { human: string; base: string; symbol: string; decimals: number } | null = null,
  txHash: string | null = null
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
  };
}

export function buildSettleSuccessResponse(
  network: string,
  payment: DecodedPayment,
  settlementResult: SettlementResult,
  feeBps: number
): SettleResponse {
  const amountInfo = formatAmount(payment.amount, network, payment.token);
  const feeAmount = settlementResult.protocolFee ?? calculateProtocolFee(payment.amount, feeBps);
  const netAmount = payment.amount - feeAmount;
  const feeFormatted = formatAmount(feeAmount, network, payment.token);
  const netFormatted = formatAmount(netAmount, network, payment.token);

  return {
    success: true,
    txHash: settlementResult.txHash!,
    networkId: network,
    settlementId: settlementResult.paymentId ?? null,
    payer: payment.payer,
    recipient: payment.recipient,
    amount: amountInfo,
    fee: { human: feeFormatted.human, base: feeFormatted.base, bps: feeBps },
    net: { human: netFormatted.human, base: netFormatted.base },
    error: null,
    timestamp: Date.now(),
  };
}

export function getNetworkFromRequest(requirementsNetwork: string | undefined, defaultNetwork: string): string {
  return requirementsNetwork ?? defaultNetwork;
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
