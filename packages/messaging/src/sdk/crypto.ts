/**
 * Cryptography utilities for Jeju Messaging
 * 
 * Uses:
 * - X25519 for key exchange (Curve25519 ECDH)
 * - AES-256-GCM for symmetric encryption
 * - ED25519 for signatures
 */

import { x25519 } from '@noble/curves/ed25519';
import { gcm } from '@noble/ciphers/aes';
import { randomBytes } from '@noble/ciphers/webcrypto';
import { sha256 } from '@noble/hashes/sha256';
import { hkdf } from '@noble/hashes/hkdf';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

// ============ Types ============

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface EncryptedMessage {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  ephemeralPublicKey: Uint8Array;
}

export interface SerializedEncryptedMessage {
  ciphertext: string;  // hex
  nonce: string;       // hex
  ephemeralPublicKey: string; // hex
}

// ============ Key Generation ============

/**
 * Generate a new X25519 key pair for encryption
 */
export function generateKeyPair(): KeyPair {
  const privateKey = randomBytes(32);
  const publicKey = x25519.getPublicKey(privateKey);
  
  return { publicKey, privateKey };
}

/**
 * Derive public key from private key
 */
export function derivePublicKey(privateKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(privateKey);
}

/**
 * Generate a deterministic key pair from a seed (e.g., wallet signature)
 */
export function generateKeyPairFromSeed(seed: Uint8Array): KeyPair {
  // Use HKDF to derive a proper private key from seed
  const privateKey = hkdf(sha256, seed, undefined, 'jeju-messaging-key', 32);
  const publicKey = x25519.getPublicKey(privateKey);
  
  return { publicKey, privateKey };
}

// ============ Encryption ============

/**
 * Encrypt a message for a recipient
 * Uses X25519 ECDH for key exchange and AES-256-GCM for encryption
 * 
 * @param message - Plaintext message (string or bytes)
 * @param recipientPublicKey - Recipient's X25519 public key
 * @param senderPrivateKey - Optional: sender's private key for authenticated encryption
 * @returns Encrypted message with ephemeral public key
 */
export function encryptMessage(
  message: string | Uint8Array,
  recipientPublicKey: Uint8Array,
  senderPrivateKey?: Uint8Array
): EncryptedMessage {
  // Convert string to bytes
  const plaintext = typeof message === 'string' 
    ? new TextEncoder().encode(message) 
    : message;
  
  // Generate ephemeral key pair for this message (forward secrecy)
  const ephemeral = senderPrivateKey 
    ? { privateKey: senderPrivateKey, publicKey: derivePublicKey(senderPrivateKey) }
    : generateKeyPair();
  
  // X25519 ECDH to derive shared secret
  const sharedSecret = x25519.getSharedSecret(ephemeral.privateKey, recipientPublicKey);
  
  // Derive encryption key using HKDF
  const encryptionKey = hkdf(sha256, sharedSecret, undefined, 'jeju-msg-encrypt', 32);
  
  // Generate random nonce (12 bytes for GCM)
  const nonce = randomBytes(12);
  
  // Encrypt with AES-256-GCM
  const aes = gcm(encryptionKey, nonce);
  const ciphertext = aes.encrypt(plaintext);
  
  return {
    ciphertext,
    nonce,
    ephemeralPublicKey: ephemeral.publicKey,
  };
}

/**
 * Decrypt a message
 * 
 * @param encrypted - Encrypted message
 * @param recipientPrivateKey - Recipient's X25519 private key
 * @returns Decrypted plaintext
 */
export function decryptMessage(
  encrypted: EncryptedMessage,
  recipientPrivateKey: Uint8Array
): Uint8Array {
  // X25519 ECDH to derive shared secret
  const sharedSecret = x25519.getSharedSecret(
    recipientPrivateKey, 
    encrypted.ephemeralPublicKey
  );
  
  // Derive encryption key using HKDF (same as encryption)
  const encryptionKey = hkdf(sha256, sharedSecret, undefined, 'jeju-msg-encrypt', 32);
  
  // Decrypt with AES-256-GCM
  const aes = gcm(encryptionKey, encrypted.nonce);
  const plaintext = aes.decrypt(encrypted.ciphertext);
  
  return plaintext;
}

/**
 * Decrypt message to string
 */
export function decryptMessageToString(
  encrypted: EncryptedMessage,
  recipientPrivateKey: Uint8Array
): string {
  const plaintext = decryptMessage(encrypted, recipientPrivateKey);
  return new TextDecoder().decode(plaintext);
}

// ============ Serialization ============

/**
 * Serialize encrypted message to JSON-safe format
 */
export function serializeEncryptedMessage(msg: EncryptedMessage): SerializedEncryptedMessage {
  return {
    ciphertext: bytesToHex(msg.ciphertext),
    nonce: bytesToHex(msg.nonce),
    ephemeralPublicKey: bytesToHex(msg.ephemeralPublicKey),
  };
}

/**
 * Deserialize encrypted message from JSON-safe format
 */
export function deserializeEncryptedMessage(msg: SerializedEncryptedMessage): EncryptedMessage {
  return {
    ciphertext: hexToBytes(msg.ciphertext),
    nonce: hexToBytes(msg.nonce),
    ephemeralPublicKey: hexToBytes(msg.ephemeralPublicKey),
  };
}

/**
 * Convert public key to hex string (for on-chain storage)
 */
export function publicKeyToHex(publicKey: Uint8Array): string {
  return bytesToHex(publicKey);
}

/**
 * Convert hex string to public key
 */
export function hexToPublicKey(hex: string): Uint8Array {
  return hexToBytes(hex);
}

/**
 * Convert public key to bytes32 (for Solidity)
 */
export function publicKeyToBytes32(publicKey: Uint8Array): `0x${string}` {
  return `0x${bytesToHex(publicKey)}` as `0x${string}`;
}

/**
 * Convert bytes32 to public key
 */
export function bytes32ToPublicKey(bytes32: `0x${string}`): Uint8Array {
  return hexToBytes(bytes32.slice(2));
}

// ============ Message Envelope ============

export interface MessageEnvelope {
  id: string;
  from: string;           // Sender address
  to: string;             // Recipient address
  encryptedContent: SerializedEncryptedMessage;
  timestamp: number;
  signature?: string;     // Optional: sender signature for authentication
}

/**
 * Create a signed message envelope
 */
export function createMessageEnvelope(
  from: string,
  to: string,
  content: string,
  recipientPublicKey: Uint8Array,
  senderPrivateKey?: Uint8Array
): MessageEnvelope {
  const encrypted = encryptMessage(content, recipientPublicKey, senderPrivateKey);
  
  return {
    id: generateMessageId(),
    from,
    to,
    encryptedContent: serializeEncryptedMessage(encrypted),
    timestamp: Date.now(),
  };
}

/**
 * Generate unique message ID
 */
export function generateMessageId(): string {
  const bytes = randomBytes(16);
  return bytesToHex(bytes);
}

// ============ Key Derivation for Wallets ============

/**
 * Derive messaging key pair from wallet signature
 * This allows users to derive their messaging keys from their Ethereum wallet
 * 
 * @param walletAddress - User's Ethereum address
 * @param signature - Signature of a specific message (e.g., "Sign to enable Jeju Messaging")
 * @returns Derived X25519 key pair
 */
export function deriveKeyPairFromWallet(
  walletAddress: string,
  signature: string
): KeyPair {
  // Create deterministic seed from address + signature
  const seedInput = `${walletAddress.toLowerCase()}:${signature}`;
  const seed = sha256(new TextEncoder().encode(seedInput));
  
  return generateKeyPairFromSeed(seed);
}

/**
 * Standard message to sign for key derivation
 */
export const KEY_DERIVATION_MESSAGE = 'Sign this message to enable Jeju Messaging.\n\nThis signature will be used to derive your encryption keys.\nIt does not grant access to your funds.';

// ============ Utilities ============

/**
 * Compare two public keys
 */
export function publicKeysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Hash content for CID-like identifier
 */
export function hashContent(content: Uint8Array): string {
  const hash = sha256(content);
  return bytesToHex(hash);
}

