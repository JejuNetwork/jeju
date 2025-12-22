/**
 * Backup Codes for MFA Recovery
 * 
 * Generates and manages one-time backup codes for account recovery
 * when primary MFA methods are unavailable.
 */

import { keccak256, toBytes, type Hex } from 'viem';

export interface BackupCode {
  code: string;
  hashedCode: Hex;
  used: boolean;
  usedAt?: number;
}

export interface BackupCodesSet {
  userId: string;
  codes: BackupCode[];
  createdAt: number;
  regeneratedAt?: number;
}

const DEFAULT_CODE_COUNT = 10;
const CODE_LENGTH = 8; // 8 character codes

export class BackupCodesManager {
  private userCodes = new Map<string, BackupCodesSet>();

  /**
   * Generate a new set of backup codes for a user
   * This replaces any existing codes
   */
  generate(userId: string, count = DEFAULT_CODE_COUNT): { codes: string[] } {
    const codes: BackupCode[] = [];
    const plainCodes: string[] = [];

    for (let i = 0; i < count; i++) {
      const code = this.generateCode();
      plainCodes.push(code);
      codes.push({
        code: this.formatCode(code),
        hashedCode: this.hashCode(code),
        used: false,
      });
    }

    const existingSet = this.userCodes.get(userId);

    this.userCodes.set(userId, {
      userId,
      codes,
      createdAt: existingSet?.createdAt ?? Date.now(),
      regeneratedAt: existingSet ? Date.now() : undefined,
    });

    // Return formatted codes for display
    return { codes: plainCodes.map(c => this.formatCode(c)) };
  }

  /**
   * Verify a backup code
   */
  verify(userId: string, code: string): { valid: boolean; remaining: number; error?: string } {
    const codesSet = this.userCodes.get(userId);

    if (!codesSet) {
      return { valid: false, remaining: 0, error: 'No backup codes configured' };
    }

    // Normalize code (remove spaces/dashes)
    const normalizedCode = code.replace(/[\s-]/g, '').toUpperCase();
    const hashedInput = this.hashCode(normalizedCode);

    // Find matching unused code
    const matchingCode = codesSet.codes.find(c => 
      !c.used && c.hashedCode === hashedInput
    );

    if (!matchingCode) {
      const remaining = codesSet.codes.filter(c => !c.used).length;
      return { valid: false, remaining, error: 'Invalid backup code' };
    }

    // Mark as used
    matchingCode.used = true;
    matchingCode.usedAt = Date.now();

    const remaining = codesSet.codes.filter(c => !c.used).length;
    return { valid: true, remaining };
  }

  /**
   * Get remaining backup codes count
   */
  getRemainingCount(userId: string): number {
    const codesSet = this.userCodes.get(userId);
    if (!codesSet) return 0;
    return codesSet.codes.filter(c => !c.used).length;
  }

  /**
   * Check if user has backup codes
   */
  hasBackupCodes(userId: string): boolean {
    const codesSet = this.userCodes.get(userId);
    return !!codesSet && codesSet.codes.some(c => !c.used);
  }

  /**
   * Get backup codes status
   */
  getStatus(userId: string): {
    configured: boolean;
    total: number;
    remaining: number;
    createdAt?: number;
    regeneratedAt?: number;
  } {
    const codesSet = this.userCodes.get(userId);
    
    if (!codesSet) {
      return { configured: false, total: 0, remaining: 0 };
    }

    return {
      configured: true,
      total: codesSet.codes.length,
      remaining: codesSet.codes.filter(c => !c.used).length,
      createdAt: codesSet.createdAt,
      regeneratedAt: codesSet.regeneratedAt,
    };
  }

  /**
   * Remove all backup codes for a user
   */
  remove(userId: string): boolean {
    return this.userCodes.delete(userId);
  }

  /**
   * Export backup codes (for user download)
   * Only shows unused codes
   */
  exportCodes(userId: string): string[] | null {
    const codesSet = this.userCodes.get(userId);
    if (!codesSet) return null;

    return codesSet.codes
      .filter(c => !c.used)
      .map(c => c.code);
  }

  private generateCode(): string {
    // Generate alphanumeric code (without confusing characters)
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Omit 0, O, I, 1, L
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    let code = '';
    for (const byte of bytes) {
      code += alphabet[byte % alphabet.length];
    }
    return code;
  }

  private formatCode(code: string): string {
    // Format as XXXX-XXXX for readability
    return code.slice(0, 4) + '-' + code.slice(4);
  }

  private hashCode(code: string): Hex {
    const normalized = code.replace(/[\s-]/g, '').toUpperCase();
    return keccak256(toBytes(normalized));
  }
}

export function createBackupCodesManager(): BackupCodesManager {
  return new BackupCodesManager();
}
