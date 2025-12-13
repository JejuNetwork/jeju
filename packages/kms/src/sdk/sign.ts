/**
 * KMS SDK - Signing utilities
 */

import type { Address, Hex } from 'viem';
import { getKMS } from '../kms.js';
import type { AccessControlPolicy, GeneratedKey, KeyCurve, SignedMessage, ThresholdSignature } from '../types.js';

export async function generateSigningKey(owner: Address, policy: AccessControlPolicy, curve: KeyCurve = 'secp256k1'): Promise<GeneratedKey> {
  const kms = getKMS();
  await kms.initialize();
  return kms.generateKey(owner, { type: 'signing', curve, policy });
}

export async function generateEncryptionKey(owner: Address, policy: AccessControlPolicy): Promise<GeneratedKey> {
  const kms = getKMS();
  await kms.initialize();
  return kms.generateKey(owner, { type: 'encryption', curve: 'secp256k1', policy });
}

export async function sign(message: string | Uint8Array, keyId: string, hashAlgorithm: 'keccak256' | 'sha256' | 'none' = 'keccak256'): Promise<SignedMessage> {
  const kms = getKMS();
  await kms.initialize();
  return kms.sign({ message, keyId, hashAlgorithm });
}

export async function personalSign(message: string, keyId: string): Promise<SignedMessage> {
  const kms = getKMS();
  await kms.initialize();
  return kms.sign({ message: `\x19Ethereum Signed Message:\n${message.length}${message}`, keyId, hashAlgorithm: 'keccak256' });
}

export async function signTypedData(domainSeparator: Hex, structHash: Hex, keyId: string): Promise<SignedMessage> {
  const { concat, toBytes } = await import('viem');
  const message = concat([toBytes('0x1901'), toBytes(domainSeparator), toBytes(structHash)]);
  const kms = getKMS();
  await kms.initialize();
  return kms.sign({ message, keyId, hashAlgorithm: 'keccak256' });
}

export async function thresholdSign(message: string | Uint8Array, keyId: string, threshold: number, totalParties: number): Promise<ThresholdSignature> {
  const kms = getKMS();
  await kms.initialize();
  return kms.thresholdSign({ message, keyId, threshold, totalParties, hashAlgorithm: 'keccak256' });
}

export async function thresholdSignTransaction(txHash: Hex, keyId: string, threshold: number, totalParties: number): Promise<ThresholdSignature> {
  const { toBytes } = await import('viem');
  const kms = getKMS();
  await kms.initialize();
  return kms.thresholdSign({ message: toBytes(txHash), keyId, threshold, totalParties, hashAlgorithm: 'keccak256' });
}

export function getKey(keyId: string) { return getKMS().getKey(keyId); }

export async function revokeKey(keyId: string): Promise<void> {
  const kms = getKMS();
  await kms.initialize();
  return kms.revokeKey(keyId);
}
