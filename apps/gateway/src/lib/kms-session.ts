/**
 * Gateway Session KMS Integration
 * STATUS: REFERENCE - Not wired in. Uses @jeju/kms when available.
 */

import type { Address, Hex } from 'viem';

interface EncryptedPayload { ciphertext: string; metadata?: Record<string, string> }
export interface GatewaySession { sessionId: string; userAddress: Address; createdAt: number; expiresAt: number; permissions: SessionPermission[] }
export type SessionPermission = 'bridge' | 'stake' | 'provide_liquidity' | 'deploy_paymaster' | 'admin';
export interface EncryptedSession { encryptedData: EncryptedPayload; sessionId: string; expiresAt: number }

function notImplemented(): never { throw new Error('@jeju/kms not yet implemented'); }

export class SessionManager {
  private initialized = false;

  async initialize(): Promise<void> { if (this.initialized) return; notImplemented(); }

  async createSession(_userAddress: Address, _permissions?: SessionPermission[]): Promise<EncryptedSession> {
    await this.ensureInitialized();
    notImplemented();
  }

  async validateSession(_encryptedSession: EncryptedSession, _authSig?: { sig: Hex; derivedVia: string; signedMessage: string; address: Address }): Promise<{ valid: boolean; session?: GatewaySession; error?: string }> {
    await this.ensureInitialized();
    notImplemented();
  }

  async hasPermission(_encryptedSession: EncryptedSession, _permission: SessionPermission, _authSig?: unknown): Promise<boolean> {
    notImplemented();
  }

  async extendSession(_encryptedSession: EncryptedSession, _extensionMs?: number, _authSig?: unknown): Promise<EncryptedSession> {
    notImplemented();
  }

  private async ensureInitialized(): Promise<void> { if (!this.initialized) await this.initialize(); }
}

let instance: SessionManager | null = null;
export function getSessionManager(): SessionManager { return instance ?? (instance = new SessionManager()); }
export function resetSessionManager(): void { instance = null; }
