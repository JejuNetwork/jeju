/**
 * Gateway Session KMS Integration
 * 
 * Uses @jejunetwork/kms for encrypted session management.
 * Sessions are encrypted with user's derived key and stored client-side.
 */

import type { Address, Hex } from 'viem';
import { keccak256, toBytes, toHex } from 'viem';
import { getKMS } from '@jejunetwork/kms';
import type { AuthSignature, EncryptedPayload, KMSService } from '@jejunetwork/kms';

export interface GatewaySession {
  sessionId: string;
  userAddress: Address;
  createdAt: number;
  expiresAt: number;
  permissions: SessionPermission[];
}

export type SessionPermission = 'bridge' | 'stake' | 'provide_liquidity' | 'deploy_paymaster' | 'admin';

export interface EncryptedSession {
  encryptedData: EncryptedPayload;
  sessionId: string;
  expiresAt: number;
}

// Default session duration: 24 hours
const DEFAULT_SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

export class SessionManager {
  private initialized = false;
  private kms: KMSService | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    this.kms = getKMS();
    await this.kms.initialize();
    this.initialized = true;
  }

  /**
   * Create an encrypted session for a user
   */
  async createSession(
    userAddress: Address,
    permissions: SessionPermission[] = ['bridge', 'stake'],
    durationMs: number = DEFAULT_SESSION_DURATION_MS
  ): Promise<EncryptedSession> {
    await this.ensureInitialized();
    
    const now = Date.now();
    const sessionId = keccak256(toBytes(`${userAddress}:${now}:${crypto.randomUUID()}`));
    const expiresAt = now + durationMs;
    
    const session: GatewaySession = {
      sessionId,
      userAddress,
      createdAt: now,
      expiresAt,
      permissions,
    };
    
    // Encrypt session data
    const sessionBytes = toBytes(JSON.stringify(session));
    const encryptedData = await this.kms!.encrypt({
      data: toHex(sessionBytes),
      accessControlConditions: [{
        conditionType: 'evmBasic',
        chain: 'ethereum',
        method: 'eth_getBalance',
        parameters: [':userAddress'],
        returnValueTest: { comparator: '>=', value: '0' },
      }],
    });
    
    return {
      encryptedData,
      sessionId,
      expiresAt,
    };
  }

  /**
   * Validate and decrypt a session
   */
  async validateSession(
    encryptedSession: EncryptedSession,
    authSig?: AuthSignature
  ): Promise<{ valid: boolean; session?: GatewaySession; error?: string }> {
    await this.ensureInitialized();
    
    // Check expiration before decryption
    if (Date.now() > encryptedSession.expiresAt) {
      return { valid: false, error: 'Session expired' };
    }
    
    try {
      const decrypted = await this.kms!.decrypt({
        encryptedData: encryptedSession.encryptedData,
        authSig,
      });
      
      const session: GatewaySession = JSON.parse(
        Buffer.from(decrypted.data.slice(2), 'hex').toString()
      );
      
      // Verify session ID matches
      if (session.sessionId !== encryptedSession.sessionId) {
        return { valid: false, error: 'Session ID mismatch' };
      }
      
      // Verify not expired (double-check)
      if (Date.now() > session.expiresAt) {
        return { valid: false, error: 'Session expired' };
      }
      
      return { valid: true, session };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Decryption failed';
      return { valid: false, error: errorMessage };
    }
  }

  /**
   * Check if session has a specific permission
   */
  async hasPermission(
    encryptedSession: EncryptedSession,
    permission: SessionPermission,
    authSig?: AuthSignature
  ): Promise<boolean> {
    const result = await this.validateSession(encryptedSession, authSig);
    if (!result.valid || !result.session) return false;
    return result.session.permissions.includes(permission);
  }

  /**
   * Extend session expiration
   */
  async extendSession(
    encryptedSession: EncryptedSession,
    extensionMs: number = DEFAULT_SESSION_DURATION_MS,
    authSig?: AuthSignature
  ): Promise<EncryptedSession> {
    await this.ensureInitialized();
    
    const result = await this.validateSession(encryptedSession, authSig);
    if (!result.valid || !result.session) {
      throw new Error(result.error ?? 'Invalid session');
    }
    
    // Create new session with extended expiration
    const newExpiresAt = Date.now() + extensionMs;
    const extendedSession: GatewaySession = {
      ...result.session,
      expiresAt: newExpiresAt,
    };
    
    // Re-encrypt with new expiration
    const sessionBytes = toBytes(JSON.stringify(extendedSession));
    const encryptedData = await this.kms!.encrypt({
      data: toHex(sessionBytes),
      accessControlConditions: [{
        conditionType: 'evmBasic',
        chain: 'ethereum',
        method: 'eth_getBalance',
        parameters: [':userAddress'],
        returnValueTest: { comparator: '>=', value: '0' },
      }],
    });
    
    return {
      encryptedData,
      sessionId: result.session.sessionId,
      expiresAt: newExpiresAt,
    };
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) await this.initialize();
  }
}

// Singleton instance
let instance: SessionManager | null = null;

export function getSessionManager(): SessionManager {
  return instance ?? (instance = new SessionManager());
}

export function resetSessionManager(): void {
  instance = null;
}
