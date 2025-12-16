/**
 * KMS SDK - Token issuance and verification via MPC signing
 * 
 * Issues JWT-like tokens signed by MPC cluster for decentralized auth.
 * Tokens are base64url-encoded JSON with MPC signature.
 */

import type { Address, Hex } from 'viem';
import { keccak256, toBytes, verifyMessage } from 'viem';
import { getKMS } from '../kms.js';
import type { AuthSignature } from '../types.js';

export interface TokenClaims {
  /** Subject (user identifier, e.g. GitHub username or wallet address) */
  sub: string;
  /** Issuer (e.g. 'jeju:oauth3' or 'jeju:leaderboard') */
  iss: string;
  /** Audience (e.g. 'gateway' or specific app) */
  aud: string;
  /** Issued at (unix timestamp seconds) */
  iat: number;
  /** Expiration (unix timestamp seconds) */
  exp: number;
  /** Token ID (unique identifier) */
  jti: string;
  /** Optional: linked wallet address */
  wallet?: Address;
  /** Optional: linked chain ID (CAIP-2 format e.g. 'eip155:420691') */
  chainId?: string;
  /** Optional: provider (e.g. 'github', 'farcaster') */
  provider?: string;
  /** Optional: scopes/permissions */
  scopes?: string[];
  /** Optional: additional claims */
  [key: string]: string | number | string[] | undefined;
}

export interface SignedToken {
  /** Base64url-encoded header */
  header: string;
  /** Base64url-encoded payload */
  payload: string;
  /** MPC signature (hex) */
  signature: Hex;
  /** Full token string (header.payload.signature) */
  token: string;
}

export interface TokenVerifyResult {
  valid: boolean;
  claims?: TokenClaims;
  error?: string;
  signerAddress?: Address;
}

const TOKEN_HEADER = {
  alg: 'MPC-ECDSA-secp256k1',
  typ: 'JWT',
};

function base64urlEncode(data: string): string {
  return Buffer.from(data)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64urlDecode(data: string): string {
  const padded = data + '='.repeat((4 - (data.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
}

/**
 * Issue a token signed by MPC cluster
 */
export async function issueToken(
  claims: Omit<TokenClaims, 'iat' | 'jti'>,
  options?: {
    keyId?: string;
    expiresInSeconds?: number;
  }
): Promise<SignedToken> {
  const kms = getKMS();
  await kms.initialize();

  const now = Math.floor(Date.now() / 1000);
  const jti = crypto.randomUUID();

  const expiration = typeof claims.exp === 'number' ? claims.exp : now + (options?.expiresInSeconds || 3600);
  const fullClaims = {
    ...claims,
    iat: now,
    jti,
    exp: expiration,
  } as TokenClaims;

  const headerB64 = base64urlEncode(JSON.stringify(TOKEN_HEADER));
  const payloadB64 = base64urlEncode(JSON.stringify(fullClaims));
  const signingInput = `${headerB64}.${payloadB64}`;

  const messageHash = keccak256(toBytes(signingInput));
  const signed = await kms.sign({ message: messageHash, keyId: options?.keyId || '' });

  const signatureB64 = base64urlEncode(signed.signature);

  return {
    header: headerB64,
    payload: payloadB64,
    signature: signed.signature,
    token: `${headerB64}.${payloadB64}.${signatureB64}`,
  };
}

/**
 * Issue a token using wallet signature (for client-side issuance)
 */
export async function issueTokenWithWallet(
  claims: Omit<TokenClaims, 'iat' | 'jti'>,
  authSig: AuthSignature,
  options?: { expiresInSeconds?: number }
): Promise<SignedToken> {
  const now = Math.floor(Date.now() / 1000);
  const jti = crypto.randomUUID();

  const expiration = typeof claims.exp === 'number' ? claims.exp : now + (options?.expiresInSeconds || 3600);
  const fullClaims = {
    ...claims,
    iat: now,
    jti,
    exp: expiration,
    wallet: authSig.address,
  } as TokenClaims;

  const headerB64 = base64urlEncode(JSON.stringify({ ...TOKEN_HEADER, alg: 'ES256K' }));
  const payloadB64 = base64urlEncode(JSON.stringify(fullClaims));
  // Wallet should have signed the full claims JSON - signature is in authSig
  const signatureB64 = base64urlEncode(authSig.sig);

  return {
    header: headerB64,
    payload: payloadB64,
    signature: authSig.sig,
    token: `${headerB64}.${payloadB64}.${signatureB64}`,
  };
}

/**
 * Verify a token and extract claims
 */
export async function verifyToken(
  token: string,
  options?: {
    /** Expected issuer */
    issuer?: string;
    /** Expected audience */
    audience?: string;
    /** Expected MPC key address (for MPC-signed tokens) */
    expectedSigner?: Address;
    /** Allow expired tokens (for debugging) */
    allowExpired?: boolean;
  }
): Promise<TokenVerifyResult> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Invalid token format: expected 3 parts' };
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Decode header and payload
  let header: { alg: string; typ: string };
  let claims: TokenClaims;

  try {
    header = JSON.parse(base64urlDecode(headerB64));
    claims = JSON.parse(base64urlDecode(payloadB64));
  } catch {
    return { valid: false, error: 'Invalid token encoding' };
  }

  if (header.typ !== 'JWT') {
    return { valid: false, error: 'Invalid token type' };
  }

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (!options?.allowExpired && claims.exp && claims.exp < now) {
    return { valid: false, error: 'Token expired', claims };
  }

  // Check issuer
  if (options?.issuer && claims.iss !== options.issuer) {
    return { valid: false, error: `Invalid issuer: expected ${options.issuer}`, claims };
  }

  // Check audience
  if (options?.audience && claims.aud !== options.audience) {
    return { valid: false, error: `Invalid audience: expected ${options.audience}`, claims };
  }

  // Verify signature
  const signingInput = `${headerB64}.${payloadB64}`;
  let signature: Hex;

  try {
    const decoded = base64urlDecode(signatureB64);
    signature = (decoded.startsWith('0x') ? decoded : `0x${Buffer.from(decoded, 'utf8').toString('hex')}`) as Hex;
  } catch {
    return { valid: false, error: 'Invalid signature encoding', claims };
  }

  if (header.alg === 'ES256K' && claims.wallet) {
    // Wallet-signed token - verify against wallet address
    const isValid = await verifyMessage({
      address: claims.wallet,
      message: signingInput,
      signature,
    });

    if (!isValid) {
      return { valid: false, error: 'Invalid wallet signature', claims };
    }

    return { valid: true, claims, signerAddress: claims.wallet };
  } else if (header.alg === 'MPC-ECDSA-secp256k1') {
    // MPC-signed token - verify against expected signer or MPC key
    if (options?.expectedSigner) {
      const messageHash = keccak256(toBytes(signingInput));
      const isValid = await verifyMessage({
        address: options.expectedSigner,
        message: { raw: toBytes(messageHash) },
        signature,
      });

      if (!isValid) {
        return { valid: false, error: 'Invalid MPC signature', claims };
      }

      return { valid: true, claims, signerAddress: options.expectedSigner };
    }

    // Without expected signer, we can't verify MPC tokens
    return { valid: false, error: 'MPC token requires expectedSigner for verification', claims };
  }

  return { valid: false, error: `Unsupported algorithm: ${header.alg}`, claims };
}

/**
 * Extract claims from token without verification (use with caution)
 */
export function decodeToken(token: string): TokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    return JSON.parse(base64urlDecode(parts[1]));
  } catch {
    return null;
  }
}

/**
 * Check if token is expired
 */
export function isTokenExpired(token: string): boolean {
  const claims = decodeToken(token);
  if (!claims?.exp) return false;
  return claims.exp < Math.floor(Date.now() / 1000);
}

/**
 * Refresh a token (issue new token with same claims, new expiry)
 */
export async function refreshToken(
  token: string,
  options?: {
    keyId?: string;
    expiresInSeconds?: number;
  }
): Promise<SignedToken | null> {
  const result = await verifyToken(token, { allowExpired: true });
  if (!result.valid || !result.claims) return null;

  const { iat, jti, exp, ...claims } = result.claims;
  return issueToken(claims as Omit<TokenClaims, 'iat' | 'jti'>, options);
}

