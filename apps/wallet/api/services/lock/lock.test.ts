/**
 * Lock Service Tests
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { LockService } from './index'

// Mock secure storage module
mock.module('../../../web/platform/secure-storage', () => ({
  secureStorage: {
    get: mock(() => Promise.resolve(null)),
    set: mock(() => Promise.resolve(undefined)),
    remove: mock(() => Promise.resolve(undefined)),
  },
}))

describe('LockService', () => {
  let lockService: LockService

  beforeEach(() => {
    lockService = new LockService()
  })

  describe('hasPassword', () => {
    it('should return false when no password is set', async () => {
      const hasPassword = await lockService.hasPassword()
      expect(hasPassword).toBe(false)
    })
  })

  describe('setPassword', () => {
    it('should require minimum 8 characters', async () => {
      await expect(lockService.setPassword('short')).rejects.toThrow(
        'at least 8 characters',
      )
    })

    it('should accept valid password', async () => {
      await expect(
        lockService.setPassword('validpassword123'),
      ).resolves.toBeUndefined()
    })
  })

  describe('setPin', () => {
    it('should require 4-6 digits', async () => {
      await expect(lockService.setPin('123')).rejects.toThrow('4-6 digits')
      await expect(lockService.setPin('1234567')).rejects.toThrow('4-6 digits')
      await expect(lockService.setPin('abcd')).rejects.toThrow('4-6 digits')
    })

    it('should accept valid PIN', async () => {
      await expect(lockService.setPin('1234')).resolves.toBeUndefined()
      await expect(lockService.setPin('123456')).resolves.toBeUndefined()
    })
  })

  describe('isLocked', () => {
    it('should return true initially', () => {
      expect(lockService.isLocked()).toBe(true)
    })
  })

  describe('lock', () => {
    it('should set isLocked to true', async () => {
      await lockService.lock()
      expect(lockService.isLocked()).toBe(true)
    })
  })

  describe('getAutoLockTimeout', () => {
    it('should return default timeout', () => {
      const timeout = lockService.getAutoLockTimeout()
      expect(timeout).toBe(5)
    })
  })

  describe('setAutoLockTimeout', () => {
    it('should update timeout', async () => {
      await lockService.setAutoLockTimeout(10)
      expect(lockService.getAutoLockTimeout()).toBe(10)
    })
  })

  describe('onLockChange', () => {
    it('should register callback', () => {
      const callback = mock(() => {})
      const unsubscribe = lockService.onLockChange(callback)
      expect(typeof unsubscribe).toBe('function')
    })

    it('should unsubscribe callback', () => {
      const callback = mock(() => {})
      const unsubscribe = lockService.onLockChange(callback)
      unsubscribe()
      // Should not throw
    })
  })

  describe('destroy', () => {
    it('should clean up resources', () => {
      lockService.destroy()
      // Should not throw
    })
  })
})
