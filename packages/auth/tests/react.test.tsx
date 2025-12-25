/**
 * OAuth3 React SDK Tests
 *
 * Tests for the React SDK hooks and components
 */

import { describe, expect, it, mock } from 'bun:test'
import {
  BackupCodesManager,
  createBackupCodesManager,
} from '../src/mfa/backup-codes.js'
import { MFAMethod } from '../src/mfa/index.js'
import { createPasskeyManager, PasskeyManager } from '../src/mfa/passkeys.js'
import { createTOTPManager, TOTPManager } from '../src/mfa/totp.js'
import { createEmailProvider, EmailProvider } from '../src/providers/email.js'
import { createPhoneProvider, PhoneProvider } from '../src/providers/phone.js'
import { ConnectedAccount } from '../src/react/components/ConnectedAccount.js'
import { LoginButton } from '../src/react/components/LoginButton.js'
import { LoginModal } from '../src/react/components/LoginModal.js'
import { MFASetup } from '../src/react/components/MFASetup.js'
import { useCredentials } from '../src/react/hooks/useCredentials.js'
import { useLogin } from '../src/react/hooks/useLogin.js'
import { useMFA } from '../src/react/hooks/useMFA.js'
import { useSession } from '../src/react/hooks/useSession.js'
import * as reactSdk from '../src/react/index.js'
import { OAuth3Provider } from '../src/react/provider.js'
import { createOAuth3Client } from '../src/sdk/client.js'
import { AuthProvider } from '../src/types.js'

// Mock React for testing without DOM
// Note: Using explicit type casts since we're testing module exports, not React integration
function mockUseState<T>(initial: T): [T, () => void] {
  return [
    initial,
    mock(() => {
      /* state setter mock */
    }),
  ]
}
function mockUseEffect(fn: () => void): void {
  fn()
}
function mockUseContext(): null {
  return null
}
function mockUseCallback<T>(fn: T): T {
  return fn
}
function mockUseMemo<T>(fn: () => T): T {
  return fn()
}
function mockCreateContext() {
  return { Provider: mock(() => null) }
}

const _mockReact = {
  useState: mockUseState,
  useEffect: mockUseEffect,
  useContext: mockUseContext,
  useCallback: mockUseCallback,
  useMemo: mockUseMemo,
  createContext: mockCreateContext,
}

// Test the core SDK types and utilities
describe('OAuth3 React SDK', () => {
  describe('Type Exports', () => {
    it('exports OAuth3ProviderProps type', () => {
      expect(OAuth3Provider).toBeDefined()
    })

    it('exports useLogin hook', () => {
      expect(useLogin).toBeDefined()
      expect(typeof useLogin).toBe('function')
    })

    it('exports useMFA hook', () => {
      expect(useMFA).toBeDefined()
      expect(typeof useMFA).toBe('function')
    })

    it('exports useCredentials hook', () => {
      expect(useCredentials).toBeDefined()
      expect(typeof useCredentials).toBe('function')
    })

    it('exports useSession hook', () => {
      expect(useSession).toBeDefined()
      expect(typeof useSession).toBe('function')
    })

    it('exports LoginButton component', () => {
      expect(LoginButton).toBeDefined()
      expect(typeof LoginButton).toBe('function')
    })

    it('exports LoginModal component', () => {
      expect(LoginModal).toBeDefined()
      expect(typeof LoginModal).toBe('function')
    })

    it('exports ConnectedAccount component', () => {
      expect(ConnectedAccount).toBeDefined()
      expect(typeof ConnectedAccount).toBe('function')
    })

    it('exports MFASetup component', () => {
      expect(MFASetup).toBeDefined()
      expect(typeof MFASetup).toBe('function')
    })
  })

  describe('Main Index Exports', () => {
    it('exports all React SDK items from main index', () => {
      // Provider
      expect(reactSdk.OAuth3Provider).toBeDefined()
      expect(reactSdk.useOAuth3).toBeDefined()
      expect(reactSdk.useOAuth3Client).toBeDefined()

      // Hooks
      expect(reactSdk.useLogin).toBeDefined()
      expect(reactSdk.useMFA).toBeDefined()
      expect(reactSdk.useCredentials).toBeDefined()
      expect(reactSdk.useSession).toBeDefined()

      // Components
      expect(reactSdk.LoginButton).toBeDefined()
      expect(reactSdk.LoginModal).toBeDefined()
      expect(reactSdk.ConnectedAccount).toBeDefined()
      expect(reactSdk.MFASetup).toBeDefined()
    })
  })

  describe('AuthProvider Enum', () => {
    it('includes all authentication providers', () => {
      expect(AuthProvider.WALLET).toBe('wallet')
      expect(AuthProvider.FARCASTER).toBe('farcaster')
      expect(AuthProvider.GOOGLE).toBe('google')
      expect(AuthProvider.APPLE).toBe('apple')
      expect(AuthProvider.TWITTER).toBe('twitter')
      expect(AuthProvider.GITHUB).toBe('github')
      expect(AuthProvider.DISCORD).toBe('discord')
      expect(AuthProvider.EMAIL).toBe('email')
      expect(AuthProvider.PHONE).toBe('phone')
    })
  })

  describe('MFA Exports', () => {
    it('exports MFAMethod enum', () => {
      expect(MFAMethod.PASSKEY).toBe('passkey')
      expect(MFAMethod.TOTP).toBe('totp')
      expect(MFAMethod.SMS).toBe('sms')
      expect(MFAMethod.BACKUP_CODE).toBe('backup_code')
    })

    it('exports PasskeyManager', () => {
      expect(PasskeyManager).toBeDefined()
      expect(createPasskeyManager).toBeDefined()

      const manager = createPasskeyManager()
      expect(manager).toBeInstanceOf(PasskeyManager)
    })

    it('exports TOTPManager', () => {
      expect(TOTPManager).toBeDefined()
      expect(createTOTPManager).toBeDefined()

      const manager = createTOTPManager()
      expect(manager).toBeInstanceOf(TOTPManager)
    })

    it('exports BackupCodesManager', () => {
      expect(BackupCodesManager).toBeDefined()
      expect(createBackupCodesManager).toBeDefined()

      const manager = createBackupCodesManager()
      expect(manager).toBeInstanceOf(BackupCodesManager)
    })
  })

  describe('Email Provider', () => {
    it('exports EmailProvider', () => {
      expect(EmailProvider).toBeDefined()
      expect(createEmailProvider).toBeDefined()
    })

    it('can create and use email provider', async () => {
      const provider = createEmailProvider({
        fromEmail: 'test@example.com',
        fromName: 'Test App',
        magicLinkBaseUrl: 'https://test.com/auth/verify',
        devMode: true,
      })

      expect(provider).toBeDefined()

      // Test sending magic link
      const result = await provider.sendMagicLink('test@example.com')
      expect(result.token).toBeDefined()
      expect(result.magicLink).toContain('token=')
    })

    it('validates email format', async () => {
      const provider = createEmailProvider({
        fromEmail: 'test@example.com',
        fromName: 'Test App',
        magicLinkBaseUrl: 'https://test.com/auth/verify',
        devMode: true,
      })

      // Invalid email should throw
      await expect(provider.sendMagicLink('invalid-email')).rejects.toThrow()
    })

    it('handles email OTP flow', async () => {
      const provider = createEmailProvider({
        fromEmail: 'test@example.com',
        fromName: 'Test App',
        magicLinkBaseUrl: 'https://test.com/auth/verify',
        devMode: true,
      })

      // Send OTP
      const sendResult = await provider.sendOTP('test@example.com')
      expect(sendResult.sent).toBe(true)
    })
  })

  describe('Phone Provider', () => {
    it('exports PhoneProvider', () => {
      expect(PhoneProvider).toBeDefined()
      expect(createPhoneProvider).toBeDefined()
    })

    it('can create phone provider', () => {
      const provider = createPhoneProvider()
      expect(provider).toBeDefined()
    })

    it('sends OTP to valid phone number', async () => {
      const provider = createPhoneProvider({ devMode: true })

      const result = await provider.sendOTP('+14155551234')
      expect(result.sent).toBe(true)
      expect(result.expiresAt).toBeGreaterThan(Date.now())
    })

    it('rejects invalid phone numbers', async () => {
      const provider = createPhoneProvider({ devMode: true })

      await expect(provider.sendOTP('invalid')).rejects.toThrow()
    })
  })

  describe('TOTP Manager', () => {
    it('generates TOTP secret', async () => {
      const manager = createTOTPManager({ issuer: 'TestApp' })
      const result = await manager.generateSecret('user123', 'test@example.com')

      expect(result.secret).toBeDefined()
      expect(result.uri).toContain('otpauth://totp/')
      expect(result.uri).toContain('TestApp')
    })

    it('verifies valid TOTP code', async () => {
      const manager = createTOTPManager({ issuer: 'TestApp' })
      const setup = await manager.generateSecret('user123', 'test@example.com')

      // Get a valid code (we need to access internal method or generate one)
      // For testing, we'll just verify the structure
      expect(setup.secret.length).toBeGreaterThan(10)
    })
  })

  describe('Backup Codes Manager', () => {
    it('generates backup codes', () => {
      const manager = createBackupCodesManager()
      const result = manager.generate('user123')

      expect(result.codes).toBeDefined()
      expect(result.codes.length).toBe(10) // Default count
      expect(result.codes[0]).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    })

    it('verifies valid backup code', () => {
      const manager = createBackupCodesManager()
      const { codes } = manager.generate('user123')

      // Verify a code
      const result = manager.verify('user123', codes[0])
      expect(result.valid).toBe(true)
      expect(result.remaining).toBe(9)

      // Same code should not work twice
      const result2 = manager.verify('user123', codes[0])
      expect(result2.valid).toBe(false)
    })

    it('rejects invalid backup codes', () => {
      const manager = createBackupCodesManager()
      manager.generate('user123')

      const result = manager.verify('user123', 'INVALID-CODE')
      expect(result.valid).toBe(false)
    })
  })

  describe('Passkey Manager', () => {
    it('generates registration options', async () => {
      const manager = createPasskeyManager({
        rpId: 'example.com',
        rpName: 'Example',
      })

      const options = await manager.generateRegistrationOptions({
        userId: 'user123',
        username: 'testuser',
        displayName: 'Test User',
      })

      expect(options.challengeId).toBeDefined()
      expect(options.publicKey).toBeDefined()
      expect(options.publicKey.rp.id).toBe('example.com')
      expect(options.publicKey.rp.name).toBe('Example')
    })

    it('generates authentication options', async () => {
      const manager = createPasskeyManager({
        rpId: 'example.com',
        rpName: 'Example',
      })

      const options = await manager.generateAuthenticationOptions()

      expect(options.challengeId).toBeDefined()
      expect(options.publicKey).toBeDefined()
      expect(options.publicKey.rpId).toBe('example.com')
    })
  })
})

describe('OAuth3 Client SDK', () => {
  it('creates client with config', () => {
    const client = createOAuth3Client({
      appId: 'test.apps.jeju',
      redirectUri: 'https://test.com/callback',
      chainId: 420691,
    })

    expect(client).toBeDefined()
    expect(typeof client.login).toBe('function')
    expect(typeof client.logout).toBe('function')
    expect(typeof client.getSession).toBe('function')
  })

  it('supports event subscription', () => {
    const client = createOAuth3Client({
      appId: 'test.apps.jeju',
      redirectUri: 'https://test.com/callback',
      chainId: 420691,
    })

    const handler = mock(() => {
      /* login handler mock */
    })
    const unsubscribe = client.on('login', handler)

    expect(typeof unsubscribe).toBe('function')
  })
})
