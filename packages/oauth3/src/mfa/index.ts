/**
 * Multi-Factor Authentication (MFA) Module
 * 
 * Provides:
 * - WebAuthn/Passkeys
 * - TOTP (Authenticator Apps)
 * - SMS verification (via phone provider)
 * - Backup codes
 */

export { PasskeyManager, type PasskeyCredential, type PasskeyChallenge, type PasskeyAuthResult } from './passkeys.js';
export { TOTPManager, type TOTPSecret, type TOTPVerifyResult } from './totp.js';
export { BackupCodesManager, type BackupCode } from './backup-codes.js';

export enum MFAMethod {
  PASSKEY = 'passkey',
  TOTP = 'totp',
  SMS = 'sms',
  BACKUP_CODE = 'backup_code',
}

export interface MFAStatus {
  enabled: boolean;
  methods: MFAMethod[];
  preferredMethod: MFAMethod | null;
  passkeyCount: number;
  totpEnabled: boolean;
  backupCodesRemaining: number;
}

export interface MFAChallenge {
  challengeId: string;
  method: MFAMethod;
  expiresAt: number;
  metadata?: Record<string, unknown>;
}
