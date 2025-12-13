/**
 * Payment Settlement Service
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type TransactionReceipt,
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  parseEventLogs,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { DecodedPayment, SettlementResult } from '../lib/types';
import { X402_FACILITATOR_ABI, ERC20_ABI } from '../lib/contracts';
import { getChainConfig, getTokenConfig, ZERO_ADDRESS } from '../lib/chains';
import { config } from '../config';
import { markNonceUsed, markNonceFailed, reserveNonce } from './nonce-manager';

const pendingSettlements = new Map<string, { timestamp: number; payment: DecodedPayment }>();

export function createClients(network: string): { publicClient: PublicClient; walletClient: WalletClient | null } {
  const chainConfig = getChainConfig(network);
  if (!chainConfig) throw new Error(`Unsupported network: ${network}`);

  const cfg = config();
  const chain = {
    id: chainConfig.chainId,
    name: chainConfig.name,
    nativeCurrency: chainConfig.nativeCurrency,
    rpcUrls: { default: { http: [chainConfig.rpcUrl] } },
  };

  const isDevelopment = cfg.environment === 'development';
  const transportConfig = isDevelopment
    ? { retryCount: 1, retryDelay: 500, timeout: 2000 }
    : { retryCount: 3, retryDelay: 1000, timeout: 10000 };

  const publicClient = createPublicClient({
    chain,
    transport: http(chainConfig.rpcUrl, transportConfig),
  });
  let walletClient: WalletClient | null = null;
  
  if (cfg.privateKey) {
    walletClient = createWalletClient({
      account: privateKeyToAccount(cfg.privateKey),
      chain,
      transport: http(chainConfig.rpcUrl, transportConfig),
    });
  }

  return { publicClient, walletClient };
}

export async function getFacilitatorStats(publicClient: PublicClient): Promise<{
  totalSettlements: bigint;
  totalVolumeUSD: bigint;
  protocolFeeBps: bigint;
  feeRecipient: Address;
}> {
  const cfg = config();
  if (cfg.facilitatorAddress === ZERO_ADDRESS) {
    return {
      totalSettlements: 0n,
      totalVolumeUSD: 0n,
      protocolFeeBps: BigInt(cfg.protocolFeeBps),
      feeRecipient: cfg.feeRecipient,
    };
  }

  const stats = await publicClient.readContract({
    address: cfg.facilitatorAddress,
    abi: X402_FACILITATOR_ABI,
    functionName: 'getStats',
  });
  const [settlements, volumeUSD, feeBps, feeAddr] = stats as [bigint, bigint, bigint, Address];
  return {
    totalSettlements: settlements,
    totalVolumeUSD: volumeUSD,
    protocolFeeBps: feeBps,
    feeRecipient: feeAddr,
  };
}

export async function isTokenSupported(publicClient: PublicClient, token: Address): Promise<boolean> {
  const cfg = config();
  if (cfg.facilitatorAddress === ZERO_ADDRESS) return false;

  return (await publicClient.readContract({
    address: cfg.facilitatorAddress,
    abi: X402_FACILITATOR_ABI,
    functionName: 'supportedTokens',
    args: [token],
  })) as boolean;
}

export async function getTokenBalance(publicClient: PublicClient, token: Address, account: Address): Promise<bigint> {
  return (await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [account] })) as bigint;
}

export async function getTokenAllowance(publicClient: PublicClient, token: Address, owner: Address): Promise<bigint> {
  const cfg = config();
  if (cfg.facilitatorAddress === ZERO_ADDRESS) return 0n;
  return (await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [owner, cfg.facilitatorAddress],
  })) as bigint;
}


function extractPaymentEvent(receipt: TransactionReceipt): { paymentId?: Hex; protocolFee?: bigint } {
  const logs = parseEventLogs({ abi: X402_FACILITATOR_ABI, logs: receipt.logs, eventName: 'PaymentSettled' });
  if (logs.length === 0) return {};
  const event = logs[0];
  return {
    paymentId: event.args.paymentId as Hex,
    protocolFee: event.args.protocolFee as bigint,
  };
}

async function validateSettlementPrerequisites(
  publicClient: PublicClient,
  payment: DecodedPayment
): Promise<{ valid: boolean; error?: string }> {
  const cfg = config();
  if (cfg.facilitatorAddress === ZERO_ADDRESS) {
    return { valid: false, error: 'Facilitator contract not configured' };
  }
  if (!(await isTokenSupported(publicClient, payment.token))) {
    return { valid: false, error: `Token not supported: ${payment.token}` };
  }
  const balance = await getTokenBalance(publicClient, payment.token, payment.payer);
  if (balance < payment.amount) {
    return { valid: false, error: `Insufficient balance: ${balance} < ${payment.amount}` };
  }
  const allowance = await getTokenAllowance(publicClient, payment.token, payment.payer);
  if (allowance < payment.amount) {
    return { valid: false, error: `Insufficient allowance: ${allowance} < ${payment.amount}` };
  }
  return { valid: true };
}

export async function settlePayment(
  payment: DecodedPayment,
  _network: string,
  publicClient: PublicClient,
  walletClient: WalletClient
): Promise<SettlementResult> {
  const cfg = config();
  const settlementKey = `${payment.payer}:${payment.nonce}`;

  const nonceReservation = await reserveNonce(publicClient, payment.payer, payment.nonce);
  if (!nonceReservation.reserved) return { success: false, error: nonceReservation.error };

  pendingSettlements.set(settlementKey, { timestamp: Date.now(), payment });

  try {
    const prereq = await validateSettlementPrerequisites(publicClient, payment);
    if (!prereq.valid) {
      markNonceFailed(payment.payer, payment.nonce);
      return { success: false, error: prereq.error! };
    }

    const hash = await walletClient.writeContract({
      address: cfg.facilitatorAddress,
      abi: X402_FACILITATOR_ABI,
      functionName: 'settle',
      args: [payment.payer, payment.recipient, payment.token, payment.amount, payment.resource, payment.nonce, BigInt(payment.timestamp), payment.signature],
      chain: walletClient.chain,
      account: walletClient.account!,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      markNonceFailed(payment.payer, payment.nonce);
      return { success: false, error: 'Transaction reverted' };
    }

    const { paymentId, protocolFee } = extractPaymentEvent(receipt);
    markNonceUsed(payment.payer, payment.nonce);
    return { success: true, txHash: hash, paymentId, protocolFee };
  } catch (e) {
    markNonceFailed(payment.payer, payment.nonce);
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    pendingSettlements.delete(settlementKey);
  }
}

export async function settleGaslessPayment(
  payment: DecodedPayment,
  _network: string,
  publicClient: PublicClient,
  walletClient: WalletClient,
  authParams: {
    validAfter: number;
    validBefore: number;
    authNonce: Hex;
    authSignature: Hex;
  }
): Promise<SettlementResult> {
  const cfg = config();
  const settlementKey = `${payment.payer}:${payment.nonce}`;

  const nonceReservation = await reserveNonce(publicClient, payment.payer, payment.nonce);
  if (!nonceReservation.reserved) return { success: false, error: nonceReservation.error };

  pendingSettlements.set(settlementKey, { timestamp: Date.now(), payment });

  try {
    const prereq = await validateSettlementPrerequisites(publicClient, payment);
    if (!prereq.valid) {
      markNonceFailed(payment.payer, payment.nonce);
      return { success: false, error: prereq.error! };
    }

    const hash = await walletClient.writeContract({
      address: cfg.facilitatorAddress,
      abi: X402_FACILITATOR_ABI,
      functionName: 'settleWithAuthorization',
      args: [
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
      chain: walletClient.chain,
      account: walletClient.account!,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      markNonceFailed(payment.payer, payment.nonce);
      return { success: false, error: 'Transaction reverted' };
    }

    const { paymentId, protocolFee } = extractPaymentEvent(receipt);
    markNonceUsed(payment.payer, payment.nonce);
    return { success: true, txHash: hash, paymentId, protocolFee };
  } catch (e) {
    markNonceFailed(payment.payer, payment.nonce);
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    pendingSettlements.delete(settlementKey);
  }
}

export function calculateProtocolFee(amount: bigint, feeBps: number): bigint {
  return (amount * BigInt(feeBps)) / 10000n;
}

export function formatAmount(amount: bigint, network: string, tokenAddress: Address): { human: string; base: string; symbol: string; decimals: number } {
  const tokenConfig = getTokenConfig(network, tokenAddress);
  return {
    human: formatUnits(amount, tokenConfig.decimals),
    base: amount.toString(),
    symbol: tokenConfig.symbol,
    decimals: tokenConfig.decimals,
  };
}

export function getPendingSettlementsCount(): number {
  return pendingSettlements.size;
}

export function cleanupStalePendingSettlements(): number {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, { timestamp, payment }] of pendingSettlements.entries()) {
    if (now - timestamp > 5 * 60 * 1000) {
      pendingSettlements.delete(key);
      markNonceFailed(payment.payer, payment.nonce);
      cleaned++;
    }
  }
  return cleaned;
}
