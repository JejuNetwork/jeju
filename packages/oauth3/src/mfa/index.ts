/**
 * Multi-Factor Authentication (MFA) Module
 *
 * Provides:
 * - WebAuthn/Passkeys
 * - TOTP (Authenticator Apps)
 * - SMS verification (via phone provider)
 * - Backup codes
 */

export { type BackupCode, BackupCodesManager } from './backup-codes.js'
export {
  type PasskeyAuthResult,
  type PasskeyChallenge,
  type PasskeyCredential,
  PasskeyManager,
} from './passkeys.js'
export { TOTPManager, type TOTPSecret, type TOTPVerifyResult } from './totp.js'

export enum MFAMethod {
  PASSKEY = 'passkey',
  TOTP = 'totp',
  SMS = 'sms',
  BACKUP_CODE = 'backup_code',
}

export interface MFAStatus {
  enabled: boolean
  methods: MFAMethod[]
  preferredMethod: MFAMethod | null
  passkeyCount: number
  totpEnabled: boolean
  backupCodesRemaining: number
}

export interface MFAChallengeMetadata {
  /** Phone number for SMS challenges */
  phone?: string
  /** Email address for email challenges */
  email?: string
  /** Device name for passkey challenges */
  deviceName?: string
  /** Credential ID for passkey challenges */
  credentialId?: string
  /** Whether backup codes were used */
  backupCodeUsed?: boolean
}

export interface MFAChallenge {
  challengeId: string
  method: MFAMethod
  expiresAt: number
  metadata?: MFAChallengeMetadata
}
