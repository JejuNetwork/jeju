/**
 * IAP Compliance Unit Tests
 */

import { describe, expect, it } from 'bun:test'
import {
  checkFeatureAvailability,
  getIAPComplianceMessage,
  getPurchaseUrl,
  requiresExternalPurchase,
} from './iap'

describe('IAP Compliance', () => {
  describe('checkFeatureAvailability', () => {
    it('should allow all features on web platform', () => {
      const cryptoPurchase = checkFeatureAvailability('crypto-purchase')
      expect(cryptoPurchase.available).toBe(true)
      expect(cryptoPurchase.requiresExternalBrowser).toBe(false)
    })

    it('should allow subscriptions', () => {
      const subscription = checkFeatureAvailability('subscription')
      expect(subscription.available).toBe(true)
    })

    it('should allow swaps', () => {
      const swap = checkFeatureAvailability('swap-with-fee')
      expect(swap.available).toBe(true)
    })
  })

  describe('getIAPComplianceMessage', () => {
    it('should return null on web for crypto-purchase', () => {
      const message = getIAPComplianceMessage('crypto-purchase')
      expect(message).toBeNull()
    })

    it('should return null on web for nft-purchase', () => {
      const message = getIAPComplianceMessage('nft-purchase')
      expect(message).toBeNull()
    })
  })

  describe('requiresExternalPurchase', () => {
    it('should return false on web', () => {
      expect(requiresExternalPurchase()).toBe(false)
    })
  })

  describe('getPurchaseUrl', () => {
    it('should generate valid purchase URL', () => {
      const url = getPurchaseUrl({
        type: 'crypto',
        asset: 'ETH',
        amount: '1.0',
      })

      expect(url).toContain('https://wallet.jejunetwork.org/purchase')
      expect(url).toContain('type=crypto')
      expect(url).toContain('asset=ETH')
      expect(url).toContain('amount=1.0')
    })

    it('should include recipient if provided', () => {
      const url = getPurchaseUrl({
        type: 'crypto',
        recipient: '0x1234',
      })

      expect(url).toContain('recipient=0x1234')
    })
  })
})
