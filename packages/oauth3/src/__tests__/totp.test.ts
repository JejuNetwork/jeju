/**
 * Tests for TOTP (Time-based One-Time Password) Manager
 */

import { describe, expect, test } from 'bun:test'
import { createTOTPManager, TOTPManager } from '../mfa/totp'

describe('TOTPManager initialization', () => {
  test('should create with default issuer', () => {
    const manager = new TOTPManager()
    expect(manager).toBeInstanceOf(TOTPManager)
  })

  test('should create with custom issuer', () => {
    const manager = new TOTPManager({ issuer: 'TestApp' })
    expect(manager).toBeInstanceOf(TOTPManager)
  })
})

describe('createTOTPManager factory', () => {
  test('should create manager with defaults', () => {
    const manager = createTOTPManager()
    expect(manager).toBeInstanceOf(TOTPManager)
  })

  test('should create manager with config', () => {
    const manager = createTOTPManager({ issuer: 'CustomIssuer' })
    expect(manager).toBeInstanceOf(TOTPManager)
  })
})

describe('TOTPManager.generateSecret', () => {
  test('should generate secret with all required fields', async () => {
    const manager = new TOTPManager({ issuer: 'TestApp' })
    const result = await manager.generateSecret('user123', 'test@example.com')

    expect(result.secret).toBeDefined()
    expect(result.secret.length).toBeGreaterThan(0)
    expect(result.uri).toContain('otpauth://totp/')
    expect(result.uri).toContain('TestApp')
    expect(result.qrCodeData).toContain('data:')
  })

  test('should generate unique secrets for different users', async () => {
    const manager = new TOTPManager()
    const result1 = await manager.generateSecret('user1', 'user1@example.com')
    const result2 = await manager.generateSecret('user2', 'user2@example.com')

    expect(result1.secret).not.toBe(result2.secret)
  })

  test('should include issuer in URI', async () => {
    const manager = new TOTPManager({ issuer: 'MyApp' })
    const result = await manager.generateSecret('user', 'account')

    expect(result.uri).toContain('issuer=MyApp')
  })

  test('should include account name in URI', async () => {
    const manager = new TOTPManager({ issuer: 'App' })
    const result = await manager.generateSecret('user', 'myaccount')

    expect(result.uri).toContain('App%3Amyaccount')
  })
})

describe('TOTPManager.isEnabled', () => {
  test('should return false for unknown user', () => {
    const manager = new TOTPManager()
    expect(manager.isEnabled('unknown')).toBe(false)
  })

  test('should return false for unverified user', async () => {
    const manager = new TOTPManager()
    await manager.generateSecret('user', 'account')
    expect(manager.isEnabled('user')).toBe(false)
  })
})

describe('TOTPManager.getStatus', () => {
  test('should return disabled for unknown user', () => {
    const manager = new TOTPManager()
    const status = manager.getStatus('unknown')

    expect(status.enabled).toBe(false)
    expect(status.createdAt).toBeUndefined()
    expect(status.lastUsedAt).toBeUndefined()
  })

  test('should return status with createdAt for configured user', async () => {
    const manager = new TOTPManager()
    await manager.generateSecret('user', 'account')
    const status = manager.getStatus('user')

    expect(status.enabled).toBe(false)
    expect(status.createdAt).toBeDefined()
    expect(status.createdAt).toBeGreaterThan(0)
  })
})

describe('TOTPManager.remove', () => {
  test('should return false for unknown user', () => {
    const manager = new TOTPManager()
    expect(manager.remove('unknown')).toBe(false)
  })

  test('should remove configured user', async () => {
    const manager = new TOTPManager()
    await manager.generateSecret('user', 'account')

    expect(manager.remove('user')).toBe(true)
    expect(manager.isEnabled('user')).toBe(false)
    expect(manager.getStatus('user').createdAt).toBeUndefined()
  })
})

describe('TOTPManager.verify', () => {
  test('should fail for unknown user', async () => {
    const manager = new TOTPManager()
    const result = await manager.verify('unknown', '123456')

    expect(result.valid).toBe(false)
    expect(result.error).toBe('No TOTP configured for this user')
  })

  test('should fail for wrong length code', async () => {
    const manager = new TOTPManager()
    await manager.generateSecret('user', 'account')

    const result = await manager.verify('user', '12345')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('6 digits')
  })

  test('should fail for non-numeric code', async () => {
    const manager = new TOTPManager()
    await manager.generateSecret('user', 'account')

    const result = await manager.verify('user', 'abcdef')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Code must contain only digits')
  })

  test('should strip whitespace from code', async () => {
    const manager = new TOTPManager()
    await manager.generateSecret('user', 'account')

    // Get current code and add spaces
    const currentCode = await manager.getCurrentCode('user')
    if (currentCode) {
      const spacedCode = `${currentCode.slice(0, 3)} ${currentCode.slice(3)}`
      const result = await manager.verify('user', spacedCode)
      expect(result.valid).toBe(true)
    }
  })

  test('should verify valid code', async () => {
    const manager = new TOTPManager()
    await manager.generateSecret('user', 'account')

    const currentCode = await manager.getCurrentCode('user')
    expect(currentCode).not.toBeNull()

    if (currentCode) {
      const result = await manager.verify('user', currentCode)
      expect(result.valid).toBe(true)
      expect(result.drift).toBeDefined()
    }
  })

  test('should enable TOTP when enableIfValid is true', async () => {
    const manager = new TOTPManager()
    await manager.generateSecret('user', 'account')

    expect(manager.isEnabled('user')).toBe(false)

    const currentCode = await manager.getCurrentCode('user')
    if (currentCode) {
      await manager.verify('user', currentCode, true)
      expect(manager.isEnabled('user')).toBe(true)
    }
  })

  test('should update lastUsedAt on valid verification', async () => {
    const manager = new TOTPManager()
    await manager.generateSecret('user', 'account')

    const statusBefore = manager.getStatus('user')
    expect(statusBefore.lastUsedAt).toBeUndefined()

    const currentCode = await manager.getCurrentCode('user')
    if (currentCode) {
      await manager.verify('user', currentCode)
      const statusAfter = manager.getStatus('user')
      expect(statusAfter.lastUsedAt).toBeDefined()
    }
  })
})

describe('TOTPManager.getCurrentCode', () => {
  test('should return null for unknown user', async () => {
    const manager = new TOTPManager()
    const code = await manager.getCurrentCode('unknown')
    expect(code).toBeNull()
  })

  test('should return 6-digit code', async () => {
    const manager = new TOTPManager()
    await manager.generateSecret('user', 'account')

    const code = await manager.getCurrentCode('user')
    expect(code).not.toBeNull()
    expect(code).toHaveLength(6)
    expect(/^\d{6}$/.test(code!)).toBe(true)
  })
})

describe('TOTP code generation consistency', () => {
  test('should generate consistent codes for same time period', async () => {
    const manager = new TOTPManager()
    await manager.generateSecret('user', 'account')

    const code1 = await manager.getCurrentCode('user')
    const code2 = await manager.getCurrentCode('user')

    // Within same 30-second period, codes should be the same
    expect(code1).toBe(code2)
  })
})
