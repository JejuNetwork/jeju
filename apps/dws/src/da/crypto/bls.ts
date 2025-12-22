/**
 * BLS12-381 Signature Implementation
 * 
 * Production-ready BLS signatures using @noble/curves:
 * - Full pairing-based verification: e(G1, σ) = e(pk, H(m))
 * - Proper hash-to-curve (RFC 9380)
 * - Signature aggregation with efficient batch verification
 * - Compatible with Ethereum consensus layer
 */

import { bls12_381 as bls } from '@noble/curves/bls12-381';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { Hex } from 'viem';
import { keccak256, toBytes } from 'viem';

// ============================================================================
// Types
// ============================================================================

/** BLS public key (48 bytes compressed G1 point) */
export type BLSPublicKey = Hex;

/** BLS signature (96 bytes G2 point) */
export type BLSSignature = Hex;

/** BLS secret key (32 bytes scalar) */
export type BLSSecretKey = Hex;

/** Key pair */
export interface BLSKeyPair {
  secretKey: BLSSecretKey;
  publicKey: BLSPublicKey;
}

/** Aggregated signature with public keys */
export interface AggregatedSignature {
  signature: BLSSignature;
  publicKeys: BLSPublicKey[];
  signerIndices: number[];
  message: Hex;
}

// ============================================================================
// Domain Separation Tags (DST) - RFC 9380 compliant
// ============================================================================

const DST_SIGN = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_';
const DST_POP = 'BLS_POP_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_';

// ============================================================================
// Key Generation
// ============================================================================

/**
 * Generate a new BLS key pair
 */
export function generateKeyPair(): BLSKeyPair {
  const secretKey = bls.utils.randomPrivateKey();
  const publicKey = bls.getPublicKey(secretKey);
  
  return {
    secretKey: `0x${bytesToHex(secretKey)}` as BLSSecretKey,
    publicKey: `0x${bytesToHex(publicKey)}` as BLSPublicKey,
  };
}

/**
 * Derive public key from secret key
 */
export function derivePublicKey(secretKey: BLSSecretKey): BLSPublicKey {
  const sk = hexToBytes(secretKey.slice(2));
  const pk = bls.getPublicKey(sk);
  return `0x${bytesToHex(pk)}` as BLSPublicKey;
}

/**
 * Validate a secret key
 */
export function validateSecretKey(secretKey: BLSSecretKey): boolean {
  try {
    const sk = hexToBytes(secretKey.slice(2));
    // Verify it's a valid scalar (non-zero and less than curve order)
    const scalar = BigInt(`0x${bytesToHex(sk)}`);
    return scalar > 0n && scalar < bls.CURVE.r;
  } catch {
    return false;
  }
}

/**
 * Validate a public key
 */
export function validatePublicKey(publicKey: BLSPublicKey): boolean {
  try {
    const pk = hexToBytes(publicKey.slice(2));
    // This will throw if point is not on curve
    bls.G1.ProjectivePoint.fromHex(pk);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Signing
// ============================================================================

/**
 * Sign a message with BLS
 * Uses hash-to-curve per RFC 9380 (SSWU method)
 */
export function sign(secretKey: BLSSecretKey, message: Uint8Array): BLSSignature {
  const sk = hexToBytes(secretKey.slice(2));
  const signature = bls.sign(message, sk);
  return `0x${bytesToHex(signature)}` as BLSSignature;
}

/**
 * Sign a message with domain separation
 */
export function signWithDomain(
  secretKey: BLSSecretKey, 
  message: Uint8Array,
  domain: Uint8Array
): BLSSignature {
  // Combine domain and message
  const combined = new Uint8Array(domain.length + message.length);
  combined.set(domain);
  combined.set(message, domain.length);
  
  return sign(secretKey, combined);
}

// ============================================================================
// Verification
// ============================================================================

/**
 * Verify a BLS signature using proper pairing check:
 * e(G1, σ) = e(pk, H(m))
 */
export function verify(
  publicKey: BLSPublicKey,
  message: Uint8Array,
  signature: BLSSignature
): boolean {
  try {
    const pk = hexToBytes(publicKey.slice(2));
    const sig = hexToBytes(signature.slice(2));
    
    // This performs the full pairing verification
    return bls.verify(sig, message, pk);
  } catch {
    return false;
  }
}

/**
 * Verify signature with domain separation
 */
export function verifyWithDomain(
  publicKey: BLSPublicKey,
  message: Uint8Array,
  signature: BLSSignature,
  domain: Uint8Array
): boolean {
  const combined = new Uint8Array(domain.length + message.length);
  combined.set(domain);
  combined.set(message, domain.length);
  
  return verify(publicKey, combined, signature);
}

// ============================================================================
// Aggregation
// ============================================================================

/**
 * Aggregate multiple BLS signatures into one
 * Resulting signature is verifiable against aggregated public key
 */
export function aggregateSignatures(signatures: BLSSignature[]): BLSSignature {
  if (signatures.length === 0) {
    throw new Error('No signatures to aggregate');
  }
  
  if (signatures.length === 1) {
    return signatures[0];
  }
  
  const sigs = signatures.map(s => hexToBytes(s.slice(2)));
  const aggregated = bls.aggregateSignatures(sigs);
  
  return `0x${bytesToHex(aggregated)}` as BLSSignature;
}

/**
 * Aggregate multiple public keys into one
 */
export function aggregatePublicKeys(publicKeys: BLSPublicKey[]): BLSPublicKey {
  if (publicKeys.length === 0) {
    throw new Error('No public keys to aggregate');
  }
  
  if (publicKeys.length === 1) {
    return publicKeys[0];
  }
  
  const pks = publicKeys.map(pk => hexToBytes(pk.slice(2)));
  const aggregated = bls.aggregatePublicKeys(pks);
  
  return `0x${bytesToHex(aggregated)}` as BLSPublicKey;
}

/**
 * Verify an aggregated signature against aggregated public key
 */
export function verifyAggregate(
  publicKeys: BLSPublicKey[],
  message: Uint8Array,
  signature: BLSSignature
): boolean {
  try {
    const aggregatedPk = aggregatePublicKeys(publicKeys);
    return verify(aggregatedPk, message, signature);
  } catch {
    return false;
  }
}

/**
 * Batch verify multiple signatures efficiently
 * More efficient than verifying each individually
 */
export function verifyBatch(
  publicKeys: BLSPublicKey[],
  messages: Uint8Array[],
  signatures: BLSSignature[]
): boolean {
  if (publicKeys.length !== messages.length || messages.length !== signatures.length) {
    throw new Error('Arrays must have equal length');
  }
  
  try {
    const pks = publicKeys.map(pk => hexToBytes(pk.slice(2)));
    const sigs = signatures.map(s => hexToBytes(s.slice(2)));
    
    // Use batch verification for efficiency
    return bls.verifyBatch(sigs, messages, pks);
  } catch {
    return false;
  }
}

// ============================================================================
// Hash-to-Curve (RFC 9380)
// ============================================================================

/**
 * Hash arbitrary data to a G2 curve point (for signing)
 * Uses the standardized SSWU method per RFC 9380
 */
export function hashToG2(message: Uint8Array, dst: string = DST_SIGN): Uint8Array {
  // @noble/curves handles this internally with proper hash-to-curve
  // This is exposed for advanced use cases
  const point = bls.G2.hashToCurve(message, { DST: dst });
  return point.toRawBytes(true);
}

/**
 * Hash arbitrary data to a G1 curve point
 */
export function hashToG1(message: Uint8Array, dst: string = DST_SIGN): Uint8Array {
  const point = bls.G1.hashToCurve(message, { DST: dst });
  return point.toRawBytes(true);
}

// ============================================================================
// DA Attestation Helpers
// ============================================================================

/**
 * Create attestation message for DA signing
 */
export function createAttestationMessage(
  blobId: Hex,
  commitment: Hex,
  chunkIndices: number[],
  timestamp: number
): Uint8Array {
  const message = `DA_ATTEST:${blobId}:${commitment}:${chunkIndices.join(',')}:${timestamp}`;
  return sha256(new TextEncoder().encode(message));
}

/**
 * Sign DA attestation
 */
export function signAttestation(
  secretKey: BLSSecretKey,
  blobId: Hex,
  commitment: Hex,
  chunkIndices: number[],
  timestamp: number
): BLSSignature {
  const message = createAttestationMessage(blobId, commitment, chunkIndices, timestamp);
  return sign(secretKey, message);
}

/**
 * Verify DA attestation
 */
export function verifyAttestation(
  publicKey: BLSPublicKey,
  signature: BLSSignature,
  blobId: Hex,
  commitment: Hex,
  chunkIndices: number[],
  timestamp: number
): boolean {
  const message = createAttestationMessage(blobId, commitment, chunkIndices, timestamp);
  return verify(publicKey, message, signature);
}

/**
 * Create aggregated attestation from multiple operators
 */
export function createAggregatedAttestation(
  blobId: Hex,
  commitment: Hex,
  signatures: Array<{ publicKey: BLSPublicKey; signature: BLSSignature; signerIndex: number }>
): AggregatedSignature {
  const sigs = signatures.map(s => s.signature);
  const pks = signatures.map(s => s.publicKey);
  const indices = signatures.map(s => s.signerIndex);
  
  return {
    signature: aggregateSignatures(sigs),
    publicKeys: pks,
    signerIndices: indices,
    message: keccak256(toBytes(`${blobId}:${commitment}`)),
  };
}

/**
 * Verify aggregated attestation
 */
export function verifyAggregatedAttestation(
  attestation: AggregatedSignature,
  registeredPublicKeys: BLSPublicKey[],
  blobId: Hex,
  commitment: Hex,
  timestamp: number
): boolean {
  // Verify all signers are registered
  for (let i = 0; i < attestation.signerIndices.length; i++) {
    const signerIndex = attestation.signerIndices[i];
    if (signerIndex >= registeredPublicKeys.length) {
      return false;
    }
    if (attestation.publicKeys[i] !== registeredPublicKeys[signerIndex]) {
      return false;
    }
  }
  
  // Create the message that was signed
  // Note: All signers must have signed the same message with same timestamp
  const message = createAttestationMessage(blobId, commitment, [], timestamp);
  
  // Verify aggregated signature
  return verifyAggregate(attestation.publicKeys, message, attestation.signature);
}

// ============================================================================
// Proof of Possession (PoP)
// ============================================================================

/**
 * Create proof of possession for a public key
 * Used to prevent rogue key attacks
 */
export function createProofOfPossession(secretKey: BLSSecretKey): BLSSignature {
  const pk = derivePublicKey(secretKey);
  const pkBytes = hexToBytes(pk.slice(2));
  
  // Sign the public key itself with a different domain
  const sk = hexToBytes(secretKey.slice(2));
  const point = bls.G2.hashToCurve(pkBytes, { DST: DST_POP });
  const signature = point.multiply(BigInt(`0x${bytesToHex(sk)}`));
  
  return `0x${bytesToHex(signature.toRawBytes(true))}` as BLSSignature;
}

/**
 * Verify proof of possession
 */
export function verifyProofOfPossession(
  publicKey: BLSPublicKey,
  proof: BLSSignature
): boolean {
  try {
    const pk = hexToBytes(publicKey.slice(2));
    const sig = hexToBytes(proof.slice(2));
    
    // Verify the PoP with the special domain
    const G1Point = bls.G1.ProjectivePoint.fromHex(pk);
    const G2Point = bls.G2.ProjectivePoint.fromHex(sig);
    const messagePoint = bls.G2.hashToCurve(pk, { DST: DST_POP });
    
    // Pairing check: e(pk, H(pk)) = e(G1, sig)
    const pairing1 = bls.pairing(G1Point, messagePoint);
    const pairing2 = bls.pairing(bls.G1.ProjectivePoint.BASE, G2Point);
    
    return bls.fields.Fp12.eql(pairing1, pairing2);
  } catch {
    return false;
  }
}

// ============================================================================
// Exports
// ============================================================================

export const BLS = {
  // Key management
  generateKeyPair,
  derivePublicKey,
  validateSecretKey,
  validatePublicKey,
  
  // Signing
  sign,
  signWithDomain,
  
  // Verification
  verify,
  verifyWithDomain,
  
  // Aggregation
  aggregateSignatures,
  aggregatePublicKeys,
  verifyAggregate,
  verifyBatch,
  
  // Hash-to-curve
  hashToG2,
  hashToG1,
  
  // DA attestations
  createAttestationMessage,
  signAttestation,
  verifyAttestation,
  createAggregatedAttestation,
  verifyAggregatedAttestation,
  
  // Proof of possession
  createProofOfPossession,
  verifyProofOfPossession,
};

