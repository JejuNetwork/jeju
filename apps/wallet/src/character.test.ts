/**
 * Character Tests
 *
 * Verifies the wallet character is properly structured for ElizaOS.
 */

import { describe, expect, it } from 'bun:test'
import { jejuWalletCharacter } from './character'

describe('jejuWalletCharacter', () => {
  it('should have a name', () => {
    expect(jejuWalletCharacter.name).toBeDefined()
    expect(jejuWalletCharacter.name).toContain('Wallet')
  })

  it('should have a system prompt', () => {
    expect(jejuWalletCharacter.system).toBeDefined()
    expect(jejuWalletCharacter.system).toContain('Network Wallet')
    expect(jejuWalletCharacter.system).toContain('decentralized finance')
  })

  it('should have bio entries', () => {
    expect(jejuWalletCharacter.bio).toBeDefined()
    expect(Array.isArray(jejuWalletCharacter.bio)).toBe(true)
    expect(jejuWalletCharacter.bio?.length).toBeGreaterThan(0)
  })

  it('should have plugins reference', () => {
    expect(jejuWalletCharacter.plugins).toBeDefined()
    expect(Array.isArray(jejuWalletCharacter.plugins)).toBe(true)
  })

  it('should have message examples', () => {
    expect(jejuWalletCharacter.messageExamples).toBeDefined()
    expect(Array.isArray(jejuWalletCharacter.messageExamples)).toBe(true)
    expect(jejuWalletCharacter.messageExamples?.length).toBeGreaterThan(0)
  })

  it('should have post examples', () => {
    expect(jejuWalletCharacter.postExamples).toBeDefined()
    expect(Array.isArray(jejuWalletCharacter.postExamples)).toBe(true)
  })

  it('should have topics', () => {
    expect(jejuWalletCharacter.topics).toBeDefined()
    expect(Array.isArray(jejuWalletCharacter.topics)).toBe(true)
    expect(jejuWalletCharacter.topics).toContain('DeFi')
    expect(jejuWalletCharacter.topics).toContain('Cross-chain')
  })

  it('should have style definitions', () => {
    expect(jejuWalletCharacter.style).toBeDefined()
    expect(jejuWalletCharacter.style?.all).toBeDefined()
    expect(jejuWalletCharacter.style?.chat).toBeDefined()
    expect(Array.isArray(jejuWalletCharacter.style?.all)).toBe(true)
  })

  it('should have adjectives', () => {
    expect(jejuWalletCharacter.adjectives).toBeDefined()
    expect(Array.isArray(jejuWalletCharacter.adjectives)).toBe(true)
    expect(jejuWalletCharacter.adjectives).toContain('helpful')
    expect(jejuWalletCharacter.adjectives).toContain('secure')
  })

  it('should have settings', () => {
    expect(jejuWalletCharacter.settings).toBeDefined()
    expect(jejuWalletCharacter.settings?.model).toBeDefined()
  })

  it('message examples should have correct structure', () => {
    const example = jejuWalletCharacter.messageExamples?.[0]
    expect(example).toBeDefined()
    expect(Array.isArray(example)).toBe(true)

    if (example && example.length >= 2) {
      // User message
      expect(example[0]).toHaveProperty('name')
      expect(example[0]).toHaveProperty('content')
      expect(example[0].content).toHaveProperty('text')

      // Agent response
      expect(example[1]).toHaveProperty('name')
      expect(example[1]).toHaveProperty('content')
      expect(example[1].content).toHaveProperty('text')
      expect(example[1].content).toHaveProperty('action')
    }
  })
})
