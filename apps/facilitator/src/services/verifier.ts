import { type Address, type Hex, type PublicClient, recoverTypedDataAddress } from 'viem';
import type { PaymentPayload, VerificationResult, PaymentRequirements } from '../lib/types';
import { EIP712_DOMAIN, EIP712_TYPES } from '../lib/contracts';
import { getChainConfig, ZERO_ADDRESS } from '../lib/chains';
import { config } from '../config';
import { isNonceUsed } from './nonce-manager';

export function decodePaymentHeader(paymentHeader: string): PaymentPayload | null {
  let decoded: string;
  try {
    decoded = Buffer.from(paymentHeader, 'base64').toString('utf-8');
  } catch {
    decoded = paymentHeader;
  }

  let parsed: PaymentPayload;
  try {
    parsed = JSON.parse(decoded) as PaymentPayload;
  } catch {
    return null;
  }

  if (!parsed.scheme || !parsed.network || !parsed.asset || !parsed.payTo || 
      !parsed.amount || !parsed.resource || !parsed.nonce || !parsed.timestamp || !parsed.signature) {
    return null;
  }

  return parsed;
}


async function verifySignature(
  payload: PaymentPayload,
  chainId: number
): Promise<Address> {
  const domain = { ...EIP712_DOMAIN, chainId, verifyingContract: ZERO_ADDRESS };
  const message = {
    scheme: payload.scheme,
    network: payload.network,
    asset: payload.asset,
    payTo: payload.payTo,
    amount: BigInt(payload.amount),
    resource: payload.resource,
    nonce: payload.nonce,
    timestamp: BigInt(payload.timestamp),
  };

  return recoverTypedDataAddress({
    domain,
    types: EIP712_TYPES,
    primaryType: 'Payment',
    message,
    signature: payload.signature,
  });
}

function validateAgainstRequirements(
  payload: PaymentPayload,
  requirements: PaymentRequirements
): { valid: boolean; error?: string } {
  if (payload.network !== requirements.network) {
    return { valid: false, error: `Network mismatch: ${payload.network} !== ${requirements.network}` };
  }
  if (payload.payTo.toLowerCase() !== requirements.payTo.toLowerCase()) {
    return { valid: false, error: `Recipient mismatch: ${payload.payTo} !== ${requirements.payTo}` };
  }
  if (payload.asset.toLowerCase() !== requirements.asset.toLowerCase()) {
    return { valid: false, error: `Asset mismatch: ${payload.asset} !== ${requirements.asset}` };
  }
  if (payload.resource !== requirements.resource) {
    return { valid: false, error: `Resource mismatch: ${payload.resource} !== ${requirements.resource}` };
  }
  
  const paymentAmount = BigInt(payload.amount);
  const maxAmount = BigInt(requirements.maxAmountRequired);
  
  if (requirements.scheme === 'exact') {
    if (paymentAmount !== maxAmount) {
      return { valid: false, error: `Exact scheme requires amount ${maxAmount}, got ${paymentAmount}` };
    }
  } else if (requirements.scheme === 'upto') {
    if (paymentAmount > maxAmount) {
      return { valid: false, error: `Upto scheme: amount ${paymentAmount} exceeds max ${maxAmount}` };
    }
    if (paymentAmount === 0n) {
      return { valid: false, error: 'Upto scheme: amount must be greater than 0' };
    }
  } else {
    return { valid: false, error: `Unsupported scheme: ${requirements.scheme}` };
  }
  
  return { valid: true };
}

function validateTimestamp(timestamp: number): { valid: boolean; error?: string } {
  const now = Math.floor(Date.now() / 1000);
  const age = now - timestamp;
  if (age < -60) return { valid: false, error: 'Payment timestamp is in the future' };
  if (age > config().maxPaymentAge) return { valid: false, error: `Payment expired (${age}s > ${config().maxPaymentAge}s)` };
  return { valid: true };
}

export async function verifyPayment(
  paymentHeader: string,
  requirements: PaymentRequirements,
  publicClient: PublicClient
): Promise<VerificationResult> {
  const payload = decodePaymentHeader(paymentHeader);
  if (!payload) return { valid: false, error: 'Invalid payment header encoding' };

  const timestampResult = validateTimestamp(payload.timestamp);
  if (!timestampResult.valid) return { valid: false, error: timestampResult.error };

  const chainConfig = getChainConfig(payload.network);
  if (!chainConfig) return { valid: false, error: `Unsupported network: ${payload.network}` };

  const cfg = config();
  if (cfg.facilitatorAddress === ZERO_ADDRESS && cfg.environment === 'production') {
    return { valid: false, error: 'Facilitator contract not deployed - verification unavailable' };
  }

  let signer: Address;
  try {
    signer = await verifySignature(payload, chainConfig.chainId);
  } catch (e) {
    return { valid: false, error: `Invalid signature: ${e instanceof Error ? e.message : String(e)}` };
  }

  const reqResult = validateAgainstRequirements(payload, requirements);
  if (!reqResult.valid) return { valid: false, error: reqResult.error };

  const nonceUsed = await isNonceUsed(publicClient, signer, payload.nonce);
  if (nonceUsed) return { valid: false, error: 'Nonce has already been used' };

  return {
    valid: true,
    signer,
    decodedPayment: {
      payer: signer,
      recipient: payload.payTo,
      token: payload.asset,
      amount: BigInt(payload.amount),
      resource: payload.resource,
      nonce: payload.nonce,
      timestamp: payload.timestamp,
      signature: payload.signature,
    },
  };
}

export async function verifySignatureOnly(
  paymentHeader: string,
  network: string
): Promise<{ valid: boolean; signer?: Address; error?: string }> {
  const payload = decodePaymentHeader(paymentHeader);
  if (!payload) return { valid: false, error: 'Invalid payment header encoding' };

  const chainConfig = getChainConfig(network);
  if (!chainConfig) return { valid: false, error: `Unsupported network: ${network}` };

  try {
    const signer = await verifySignature(payload, chainConfig.chainId);
    return { valid: true, signer };
  } catch (e) {
    return { valid: false, error: `Invalid signature: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export function encodePaymentHeader(payload: Omit<PaymentPayload, 'signature'> & { signature: Hex }): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}
