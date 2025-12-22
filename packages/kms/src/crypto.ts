/**
 * KMS Crypto Utilities - Shared AES-256-GCM encryption primitives
 * 
 * Centralizes all AES-GCM operations to ensure consistent implementation
 * across providers and eliminate code duplication.
 */

import { keccak256, toBytes, toHex, type Hex } from 'viem';
import { ciphertextPayloadSchema } from './schemas.js';

/** Helper to ensure ArrayBuffer compatibility for Web Crypto API */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

/** AES-GCM encrypted payload with IV and auth tag */
export interface AESGCMPayload {
  ciphertext: Hex;
  iv: Hex;
  tag: Hex;
  version?: number;
  mpc?: boolean;
}

/** Encrypt data using AES-256-GCM */
export async function aesGcmEncrypt(
  data: Uint8Array,
  key: Uint8Array
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey('raw', toArrayBuffer(key), { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, toArrayBuffer(data));
  return { ciphertext: new Uint8Array(encrypted), iv };
}

/** Decrypt data using AES-256-GCM */
export async function aesGcmDecrypt(
  ciphertext: Uint8Array,
  iv: Uint8Array,
  key: Uint8Array
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', toArrayBuffer(key), { name: 'AES-GCM' }, false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, cryptoKey, toArrayBuffer(ciphertext));
  return new Uint8Array(decrypted);
}

/** Seal (encrypt) a key with a master key - prepends IV to output */
export async function sealWithMasterKey(data: Uint8Array, masterKey: Uint8Array): Promise<Uint8Array> {
  const { ciphertext, iv } = await aesGcmEncrypt(data, masterKey);
  const result = new Uint8Array(12 + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(ciphertext, 12);
  return result;
}

/** Unseal (decrypt) data sealed with sealWithMasterKey */
export async function unsealWithMasterKey(sealed: Uint8Array, masterKey: Uint8Array): Promise<Uint8Array> {
  const iv = sealed.slice(0, 12);
  const ciphertext = sealed.slice(12);
  return aesGcmDecrypt(ciphertext, iv, masterKey);
}

/** Derive an encryption key using HKDF */
export async function deriveEncryptionKey(
  masterKey: Uint8Array,
  salt: Uint8Array,
  info: string
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey('raw', toArrayBuffer(masterKey), { name: 'HKDF' }, false, ['deriveBits']);
  const infoBytes = toBytes(info);
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', salt: toArrayBuffer(salt), info: toArrayBuffer(infoBytes), hash: 'SHA-256' },
    baseKey,
    256
  );
  return new Uint8Array(derivedBits);
}

/** Encrypt data and return JSON-serializable payload */
export async function encryptToPayload(
  data: string,
  key: Uint8Array,
  options?: { version?: number; mpc?: boolean }
): Promise<string> {
  const { ciphertext, iv } = await aesGcmEncrypt(toBytes(data), key);
  const payload: AESGCMPayload = {
    ciphertext: toHex(ciphertext.slice(0, -16)),
    iv: toHex(iv),
    tag: toHex(ciphertext.slice(-16)),
  };
  if (options?.version !== undefined) payload.version = options.version;
  if (options?.mpc !== undefined) payload.mpc = options.mpc;
  return JSON.stringify(payload);
}

/** Decrypt payload created by encryptToPayload */
export async function decryptFromPayload(payloadJson: string, key: Uint8Array): Promise<string> {
  const parseResult = ciphertextPayloadSchema.safeParse(JSON.parse(payloadJson));
  if (!parseResult.success) {
    throw new Error(`Invalid ciphertext format: ${parseResult.error.message}`);
  }
  const payload = parseResult.data;
  const combined = new Uint8Array([
    ...toBytes(payload.ciphertext as Hex),
    ...toBytes(payload.tag as Hex),
  ]);
  const decrypted = await aesGcmDecrypt(combined, toBytes(payload.iv as Hex), key);
  return new TextDecoder().decode(decrypted);
}

/** Parse and validate ciphertext payload JSON */
export function parseCiphertextPayload(payloadJson: string): AESGCMPayload {
  const parseResult = ciphertextPayloadSchema.safeParse(JSON.parse(payloadJson));
  if (!parseResult.success) {
    throw new Error(`Invalid ciphertext format: ${parseResult.error.message}`);
  }
  return parseResult.data as AESGCMPayload;
}

/** Generate a unique key ID with given prefix */
export function generateKeyId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Derive a master key from a secret string */
export function deriveKeyFromSecret(secret: string): Uint8Array {
  return toBytes(keccak256(toBytes(secret)));
}

/** Derive a key for a specific keyId and policy */
export async function deriveKeyForEncryption(
  masterKey: Uint8Array,
  keyId: string,
  policyJson: string
): Promise<Uint8Array> {
  const salt = toBytes(keccak256(toBytes(`${keyId}:${policyJson}`)));
  return deriveEncryptionKey(masterKey, salt, 'encryption');
}
