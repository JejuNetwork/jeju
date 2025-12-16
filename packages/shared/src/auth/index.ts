/**
 * Jeju Auth - Unified Authentication
 * 
 * Supports multiple authentication methods:
 * - SIWE (Sign In With Ethereum) - wallet-based auth
 * - SIWF (Sign In With Farcaster) - Farcaster social auth
 * - Passkeys (WebAuthn) - passwordless authentication
 * - OAuth3 - TEE-backed decentralized auth
 * 
 * All methods integrate with OAuth3 for session management and MPC signing.
 */

export * from './types';
export * from './siwe';
export * from './siwf';
export * from './passkeys';
export * from './provider';
export * from './hooks';
