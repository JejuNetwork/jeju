/**
 * Email Encryption Utilities
 *
 * E2E encryption for email content using:
 * - secp256k1 ECDH for key exchange
 * - AES-256-GCM for content encryption
 * - Compatible with MPC key management
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import type { Hex } from "viem";

export interface EncryptedEmail {
  ciphertext: Hex;
  nonce: Hex;
  ephemeralPublicKey: Hex;
  tag: Hex;
}

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/**
 * Generate ephemeral key pair for encryption using secp256k1
 */
export function generateKeyPair(): KeyPair {
  const privateKey = randomBytes(32);

  // Derive public key from private key using secp256k1
  const publicKey = secp256k1.getPublicKey(privateKey, false); // uncompressed

  return {
    publicKey: new Uint8Array(publicKey),
    privateKey: new Uint8Array(privateKey),
  };
}

/**
 * Derive shared secret from ECDH using secp256k1
 */
export function deriveSharedSecret(
  privateKey: Uint8Array,
  publicKey: Uint8Array,
): Uint8Array {
  // Perform proper ECDH using secp256k1
  const sharedPoint = secp256k1.getSharedSecret(privateKey, publicKey);

  // Hash the shared point to derive the symmetric key
  // Take the x-coordinate (first 32 bytes after the 0x04 prefix for uncompressed keys)
  const xCoord = sharedPoint.slice(1, 33);

  // HKDF-like derivation: hash to get the final key
  return new Uint8Array(createHash("sha256").update(xCoord).digest());
}

/**
 * Encrypt email content for a recipient
 */
export function encryptEmail(
  content: string,
  recipientPublicKey: Uint8Array,
): EncryptedEmail {
  // Generate ephemeral key pair
  const ephemeral = generateKeyPair();

  // Derive shared secret
  const sharedSecret = deriveSharedSecret(
    ephemeral.privateKey,
    recipientPublicKey,
  );

  // Encrypt with AES-256-GCM
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sharedSecret, nonce);

  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(content, "utf8")),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return {
    ciphertext: `0x${encrypted.toString("hex")}` as Hex,
    nonce: `0x${nonce.toString("hex")}` as Hex,
    ephemeralPublicKey:
      `0x${Buffer.from(ephemeral.publicKey).toString("hex")}` as Hex,
    tag: `0x${tag.toString("hex")}` as Hex,
  };
}

/**
 * Decrypt email content
 */
export function decryptEmail(
  encrypted: EncryptedEmail,
  privateKey: Uint8Array,
): string {
  // Parse hex values
  const ciphertext = Buffer.from(encrypted.ciphertext.slice(2), "hex");
  const nonce = Buffer.from(encrypted.nonce.slice(2), "hex");
  const ephemeralPublicKey = Buffer.from(
    encrypted.ephemeralPublicKey.slice(2),
    "hex",
  );
  const tag = Buffer.from(encrypted.tag.slice(2), "hex");

  // Derive shared secret
  const sharedSecret = deriveSharedSecret(
    privateKey,
    new Uint8Array(ephemeralPublicKey),
  );

  // Decrypt with AES-256-GCM
  const decipher = createDecipheriv("aes-256-gcm", sharedSecret, nonce);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Encrypt email for multiple recipients
 */
export function encryptForMultipleRecipients(
  content: string,
  recipientPublicKeys: Map<string, Uint8Array>,
): {
  encryptedContent: EncryptedEmail;
  recipientKeys: Map<string, Hex>;
} {
  // Generate random symmetric key
  const symmetricKey = randomBytes(32);

  // Encrypt content with symmetric key
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", symmetricKey, nonce);

  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(content, "utf8")),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  // Encrypt symmetric key for each recipient
  const recipientKeys = new Map<string, Hex>();

  for (const [address, publicKey] of recipientPublicKeys) {
    const ephemeral = generateKeyPair();
    const sharedSecret = deriveSharedSecret(ephemeral.privateKey, publicKey);

    // Encrypt symmetric key
    const keyNonce = randomBytes(12);
    const keyCipher = createCipheriv("aes-256-gcm", sharedSecret, keyNonce);

    const encryptedKey = Buffer.concat([
      keyNonce,
      keyCipher.update(symmetricKey),
      keyCipher.final(),
      keyCipher.getAuthTag(),
      ephemeral.publicKey,
    ]);

    recipientKeys.set(address, `0x${encryptedKey.toString("hex")}` as Hex);
  }

  return {
    encryptedContent: {
      ciphertext: `0x${encrypted.toString("hex")}` as Hex,
      nonce: `0x${nonce.toString("hex")}` as Hex,
      ephemeralPublicKey: "0x" as Hex, // Stored per-recipient
      tag: `0x${tag.toString("hex")}` as Hex,
    },
    recipientKeys,
  };
}

/**
 * Decrypt email encrypted for multiple recipients
 */
export function decryptFromMultipleRecipients(
  encryptedContent: EncryptedEmail,
  recipientKey: Hex,
  privateKey: Uint8Array,
): string {
  // Parse recipient key package
  const keyPackage = Buffer.from(recipientKey.slice(2), "hex");

  const keyNonce = keyPackage.subarray(0, 12);
  const encryptedSymKey = keyPackage.subarray(12, 12 + 32 + 16); // key + auth tag
  const ephemeralPublicKey = keyPackage.subarray(12 + 32 + 16);

  // Derive shared secret
  const sharedSecret = deriveSharedSecret(
    privateKey,
    new Uint8Array(ephemeralPublicKey),
  );

  // Decrypt symmetric key
  const keyDecipher = createDecipheriv("aes-256-gcm", sharedSecret, keyNonce);
  keyDecipher.setAuthTag(encryptedSymKey.subarray(32));

  const symmetricKey = Buffer.concat([
    keyDecipher.update(encryptedSymKey.subarray(0, 32)),
    keyDecipher.final(),
  ]);

  // Decrypt content
  const ciphertext = Buffer.from(encryptedContent.ciphertext.slice(2), "hex");
  const nonce = Buffer.from(encryptedContent.nonce.slice(2), "hex");
  const tag = Buffer.from(encryptedContent.tag.slice(2), "hex");

  const decipher = createDecipheriv("aes-256-gcm", symmetricKey, nonce);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
