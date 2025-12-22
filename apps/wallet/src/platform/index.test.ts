/**
 * Platform Detection Unit Tests
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import {
  getPlatformInfo,
  isDesktop,
  isExtension,
  isMobile,
  isWeb,
  resetPlatformCache,
} from './detection'

describe('Platform Detection', () => {
  beforeEach(() => {
    resetPlatformCache()
  })

  describe('getPlatformInfo', () => {
    it('should return platform info object', () => {
      const info = getPlatformInfo()

      expect(info).toHaveProperty('type')
      expect(info).toHaveProperty('category')
      expect(info).toHaveProperty('version')
      expect(info).toHaveProperty('capabilities')
    })

    it('should detect web platform in jsdom', () => {
      const info = getPlatformInfo()

      // jsdom should be detected as web
      expect(info.type).toBe('web')
      expect(info.category).toBe('web')
    })

    it('should have capabilities object', () => {
      const info = getPlatformInfo()

      expect(info.capabilities).toHaveProperty('hasSecureStorage')
      expect(info.capabilities).toHaveProperty('hasBiometrics')
      expect(info.capabilities).toHaveProperty('hasDeepLinks')
      expect(info.capabilities).toHaveProperty('hasIAP')
    })
  })

  describe('Platform type checks', () => {
    it('isWeb should return true in jsdom', () => {
      expect(isWeb()).toBe(true)
    })

    it('isDesktop should return false in jsdom', () => {
      expect(isDesktop()).toBe(false)
    })

    it('isMobile should return false in jsdom', () => {
      expect(isMobile()).toBe(false)
    })

    it('isExtension should return false in jsdom', () => {
      expect(isExtension()).toBe(false)
    })
  })
})
