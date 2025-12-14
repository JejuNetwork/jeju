/**
 * Backup Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BackupService } from './index';

// Mock secure storage
vi.mock('../../platform/secure-storage', () => ({
  secureStorage: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('BackupService', () => {
  let backupService: BackupService;

  beforeEach(async () => {
    vi.clearAllMocks();
    backupService = new BackupService();
    await backupService.initialize();
  });

  describe('generateMnemonic', () => {
    it('should generate 12-word mnemonic by default', () => {
      const mnemonic = backupService.generateMnemonic();
      const words = mnemonic.split(' ');
      expect(words).toHaveLength(12);
    });

    it('should generate 24-word mnemonic with 256 bits', () => {
      const mnemonic = backupService.generateMnemonic(256);
      const words = mnemonic.split(' ');
      expect(words).toHaveLength(24);
    });
  });

  describe('validateMnemonic', () => {
    it('should validate correct mnemonic', () => {
      const mnemonic = backupService.generateMnemonic();
      expect(backupService.validateMnemonic(mnemonic)).toBe(true);
    });

    it('should reject invalid mnemonic', () => {
      expect(backupService.validateMnemonic('invalid words here')).toBe(false);
    });

    it('should reject wrong word count', () => {
      expect(backupService.validateMnemonic('abandon abandon abandon')).toBe(false);
    });
  });

  describe('generateVerificationChallenge', () => {
    it('should return 4 indices for 12-word phrase', () => {
      const indices = backupService.generateVerificationChallenge(12);
      expect(indices).toHaveLength(4);
      indices.forEach(idx => {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(12);
      });
    });

    it('should return sorted indices', () => {
      const indices = backupService.generateVerificationChallenge(12);
      for (let i = 1; i < indices.length; i++) {
        expect(indices[i]).toBeGreaterThan(indices[i - 1]);
      }
    });
  });

  describe('verifyBackup', () => {
    it('should verify correct responses', () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const responses = [
        { index: 0, word: 'abandon' },
        { index: 3, word: 'abandon' },
        { index: 6, word: 'abandon' },
        { index: 11, word: 'about' },
      ];

      expect(backupService.verifyBackup(mnemonic, responses)).toBe(true);
    });

    it('should reject incorrect responses', () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const responses = [
        { index: 0, word: 'wrong' },
        { index: 3, word: 'abandon' },
      ];

      expect(backupService.verifyBackup(mnemonic, responses)).toBe(false);
    });

    it('should be case insensitive', () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const responses = [
        { index: 0, word: 'ABANDON' },
        { index: 11, word: 'About' },
      ];

      expect(backupService.verifyBackup(mnemonic, responses)).toBe(true);
    });
  });

  describe('markBackupVerified', () => {
    it('should mark backup as verified', async () => {
      expect(backupService.isBackupVerified()).toBe(false);
      
      await backupService.markBackupVerified();
      
      expect(backupService.isBackupVerified()).toBe(true);
      expect(backupService.getBackupVerifiedAt()).not.toBeNull();
    });
  });

  describe('shouldShowReminder', () => {
    it('should show reminder when not backed up', () => {
      expect(backupService.shouldShowReminder()).toBe(true);
    });

    it('should not show reminder after backup', async () => {
      await backupService.markBackupVerified();
      expect(backupService.shouldShowReminder()).toBe(false);
    });
  });

  describe('dismissReminder', () => {
    it('should dismiss reminder temporarily', async () => {
      expect(backupService.shouldShowReminder()).toBe(true);
      
      await backupService.dismissReminder();
      
      expect(backupService.shouldShowReminder()).toBe(false);
    });
  });

  describe('getWordSuggestions', () => {
    it('should return word suggestions', () => {
      const suggestions = backupService.getWordSuggestions('aban');
      expect(suggestions).toContain('abandon');
    });

    it('should return empty for short prefix', () => {
      const suggestions = backupService.getWordSuggestions('a');
      expect(suggestions).toHaveLength(0);
    });

    it('should limit results', () => {
      const suggestions = backupService.getWordSuggestions('ab', 3);
      expect(suggestions.length).toBeLessThanOrEqual(3);
    });
  });

  describe('isValidWord', () => {
    it('should validate BIP39 words', () => {
      expect(backupService.isValidWord('abandon')).toBe(true);
      expect(backupService.isValidWord('zoo')).toBe(true);
    });

    it('should reject invalid words', () => {
      expect(backupService.isValidWord('notaword')).toBe(false);
      expect(backupService.isValidWord('bitcoin')).toBe(false);
    });
  });
});

