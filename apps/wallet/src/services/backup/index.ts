/**
 * Seed Phrase Backup & Verification Service
 * Ensures users properly backup their recovery phrase
 */

import { generateMnemonic, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { expectJson } from '../../lib/validation'
import { secureStorage } from '../../platform/secure-storage'
import { BackupStateSchema } from '../../plugin/schemas'

interface BackupState {
  hasBackedUp: boolean
  backupVerifiedAt: number | null
  lastReminded: number | null
  reminderDismissed: boolean
}

const STORAGE_KEY = 'jeju_backup_state'

class BackupService {
  private state: BackupState = {
    hasBackedUp: false,
    backupVerifiedAt: null,
    lastReminded: null,
    reminderDismissed: false,
  }

  async initialize(): Promise<void> {
    const saved = await secureStorage.get(STORAGE_KEY)
    if (saved) {
      this.state = expectJson(saved, BackupStateSchema, 'backup state')
    }
  }

  /**
   * Generate a new mnemonic phrase
   */
  generateMnemonic(strength: 128 | 256 = 128): string {
    // 128 bits = 12 words, 256 bits = 24 words
    return generateMnemonic(wordlist, strength)
  }

  /**
   * Validate a mnemonic phrase
   */
  validateMnemonic(mnemonic: string): boolean {
    return validateMnemonic(mnemonic, wordlist)
  }

  /**
   * Generate verification challenge
   * Returns indices of words to verify
   */
  generateVerificationChallenge(wordCount: number = 12): number[] {
    const positions = [0, 3, 6, 9] // Verify 4 words

    // For 24-word phrases, add more positions
    if (wordCount === 24) {
      positions.push(12, 15, 18, 21)
    }

    // Randomly select which positions to verify
    const shuffled = positions.sort(() => Math.random() - 0.5)
    return shuffled.slice(0, 4).sort((a, b) => a - b)
  }

  /**
   * Verify user's backup responses
   */
  verifyBackup(
    mnemonic: string,
    responses: { index: number; word: string }[],
  ): boolean {
    const words = mnemonic.split(' ')

    for (const response of responses) {
      if (
        words[response.index]?.toLowerCase() !== response.word.toLowerCase()
      ) {
        return false
      }
    }

    return true
  }

  /**
   * Mark backup as verified
   */
  async markBackupVerified(): Promise<void> {
    this.state.hasBackedUp = true
    this.state.backupVerifiedAt = Date.now()
    this.state.reminderDismissed = false
    await this.saveState()
  }

  /**
   * Check if backup has been verified
   */
  isBackupVerified(): boolean {
    return this.state.hasBackedUp
  }

  /**
   * Get backup verification timestamp
   */
  getBackupVerifiedAt(): number | null {
    return this.state.backupVerifiedAt
  }

  /**
   * Check if should show backup reminder
   */
  shouldShowReminder(): boolean {
    if (this.state.hasBackedUp) return false
    if (this.state.reminderDismissed) {
      // Show again after 24 hours
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000
      if (this.state.lastReminded && this.state.lastReminded > dayAgo) {
        return false
      }
    }
    return true
  }

  /**
   * Dismiss reminder temporarily
   */
  async dismissReminder(): Promise<void> {
    this.state.lastReminded = Date.now()
    this.state.reminderDismissed = true
    await this.saveState()
  }

  /**
   * Reset backup state (for testing or re-verification)
   */
  async resetBackupState(): Promise<void> {
    this.state = {
      hasBackedUp: false,
      backupVerifiedAt: null,
      lastReminded: null,
      reminderDismissed: false,
    }
    await this.saveState()
  }

  /**
   * Get word suggestions for autocomplete
   */
  getWordSuggestions(prefix: string, limit: number = 5): string[] {
    if (!prefix || prefix.length < 2) return []

    const lowercasePrefix = prefix.toLowerCase()
    return wordlist
      .filter((word) => word.startsWith(lowercasePrefix))
      .slice(0, limit)
  }

  /**
   * Check if a word is valid BIP39
   */
  isValidWord(word: string): boolean {
    return wordlist.includes(word.toLowerCase())
  }

  private async saveState(): Promise<void> {
    await secureStorage.set(STORAGE_KEY, JSON.stringify(this.state))
  }
}

export const backupService = new BackupService()
export { BackupService }
