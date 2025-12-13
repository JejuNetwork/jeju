/**
 * KMS SDK - Decryption utilities
 */

import type { Address, Hex } from 'viem';
import { getKMS } from '../kms.js';
import type { AuthSignature, EncryptedPayload } from '../types.js';

export function createAuthSig(signature: Hex, message: string, address: Address, derivedVia: AuthSignature['derivedVia'] = 'web3.eth.personal.sign'): AuthSignature {
  return { sig: signature, derivedVia, signedMessage: message, address };
}

export function createSIWEAuthSig(signature: Hex, siweMessage: string, address: Address): AuthSignature {
  return { sig: signature, derivedVia: 'siwe', signedMessage: siweMessage, address };
}

export async function decrypt(payload: EncryptedPayload, authSig: AuthSignature): Promise<string> {
  const kms = getKMS();
  await kms.initialize();
  return kms.decrypt({ payload, authSig });
}

export async function decryptPublic(payload: EncryptedPayload): Promise<string> {
  const kms = getKMS();
  await kms.initialize();
  return kms.decrypt({ payload });
}

export async function canDecrypt(payload: EncryptedPayload): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  for (const c of payload.policy.conditions) {
    if (c.type === 'timestamp') {
      if (c.comparator === '>=' && now >= c.value) return true;
      if (c.comparator === '<=' && now <= c.value) return true;
    }
  }
  return false;
}

export async function decryptJSON<T>(payload: EncryptedPayload, authSig?: AuthSignature): Promise<T> {
  const kms = getKMS();
  await kms.initialize();
  return JSON.parse(await kms.decrypt({ payload, authSig })) as T;
}

export async function decryptAndVerify(payload: EncryptedPayload, authSig: AuthSignature, expectedHash?: Hex): Promise<{ data: string; verified: boolean }> {
  const kms = getKMS();
  await kms.initialize();
  const decrypted = await kms.decrypt({ payload, authSig });
  
  if (expectedHash) {
    const { keccak256, toBytes } = await import('viem');
    return { data: decrypted, verified: keccak256(toBytes(decrypted)) === expectedHash };
  }
  return { data: decrypted, verified: true };
}
