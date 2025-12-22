/**
 * TOTP (Time-based One-Time Password) Authentication
 * 
 * Implements RFC 6238 TOTP for authenticator apps like:
 * - Google Authenticator
 * - Authy
 * - 1Password
 * - Microsoft Authenticator
 */


export interface TOTPSecret {
  userId: string;
  secret: Uint8Array;
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';
  digits: number;
  period: number;
  verified: boolean;
  createdAt: number;
  lastUsedAt?: number;
}

export interface TOTPVerifyResult {
  valid: boolean;
  error?: string;
  drift?: number; // Time drift in periods
}

export interface TOTPSetupResult {
  secret: string;
  uri: string;
  qrCodeData: string;
}

const DEFAULT_DIGITS = 6;
const DEFAULT_PERIOD = 30; // seconds
const DEFAULT_ALGORITHM = 'SHA1';
const ALLOWED_DRIFT = 1; // Allow +/- 1 period for clock drift

export class TOTPManager {
  private secrets = new Map<string, TOTPSecret>();
  private issuer: string;

  constructor(config?: { issuer?: string }) {
    this.issuer = config?.issuer ?? 'OAuth3';
  }

  /**
   * Generate a new TOTP secret for setup
   */
  async generateSecret(userId: string, accountName: string): Promise<TOTPSetupResult> {
    // Generate 160-bit secret (20 bytes)
    const secretBytes = crypto.getRandomValues(new Uint8Array(20));
    const secret = this.base32Encode(secretBytes);

    const totpSecret: TOTPSecret = {
      userId,
      secret: secretBytes,
      algorithm: DEFAULT_ALGORITHM,
      digits: DEFAULT_DIGITS,
      period: DEFAULT_PERIOD,
      verified: false,
      createdAt: Date.now(),
    };

    // Store pending secret
    this.secrets.set(userId, totpSecret);

    // Generate otpauth:// URI
    const uri = this.generateUri(secret, accountName, totpSecret);

    // Generate QR code data URL
    const qrCodeData = await this.generateQRCodeData(uri);

    return { secret, uri, qrCodeData };
  }

  /**
   * Verify a TOTP code and optionally enable for user
   */
  async verify(userId: string, code: string, enableIfValid = false): Promise<TOTPVerifyResult> {
    const totpSecret = this.secrets.get(userId);

    if (!totpSecret) {
      return { valid: false, error: 'No TOTP configured for this user' };
    }

    // Clean code
    const cleanCode = code.replace(/\s/g, '');

    if (cleanCode.length !== totpSecret.digits) {
      return { valid: false, error: `Code must be ${totpSecret.digits} digits` };
    }

    if (!/^\d+$/.test(cleanCode)) {
      return { valid: false, error: 'Code must contain only digits' };
    }

    // Get current time period
    const currentTime = Math.floor(Date.now() / 1000);
    const counter = Math.floor(currentTime / totpSecret.period);

    // Check current period and adjacent periods for clock drift
    for (let drift = -ALLOWED_DRIFT; drift <= ALLOWED_DRIFT; drift++) {
      const expectedCode = await this.generateCode(totpSecret, counter + drift);
      if (this.timingSafeEqual(cleanCode, expectedCode)) {
        // Valid code
        if (enableIfValid && !totpSecret.verified) {
          totpSecret.verified = true;
        }
        totpSecret.lastUsedAt = Date.now();
        
        return { valid: true, drift };
      }
    }

    return { valid: false, error: 'Invalid code' };
  }

  /**
   * Remove TOTP for a user
   */
  remove(userId: string): boolean {
    return this.secrets.delete(userId);
  }

  /**
   * Check if user has TOTP enabled
   */
  isEnabled(userId: string): boolean {
    const secret = this.secrets.get(userId);
    return secret?.verified ?? false;
  }

  /**
   * Get TOTP status for a user
   */
  getStatus(userId: string): { enabled: boolean; createdAt?: number; lastUsedAt?: number } {
    const secret = this.secrets.get(userId);
    if (!secret) {
      return { enabled: false };
    }
    return {
      enabled: secret.verified,
      createdAt: secret.createdAt,
      lastUsedAt: secret.lastUsedAt,
    };
  }

  /**
   * Generate a TOTP code for testing/backup
   */
  async getCurrentCode(userId: string): Promise<string | null> {
    const secret = this.secrets.get(userId);
    if (!secret) return null;

    const currentTime = Math.floor(Date.now() / 1000);
    const counter = Math.floor(currentTime / secret.period);
    
    return this.generateCode(secret, counter);
  }

  private async generateCode(secret: TOTPSecret, counter: number): Promise<string> {
    // Convert counter to big-endian 8-byte array
    const counterBuffer = new ArrayBuffer(8);
    const counterView = new DataView(counterBuffer);
    counterView.setBigUint64(0, BigInt(counter), false);

    // HMAC
    const algorithm = this.getAlgorithmName(secret.algorithm);
    const key = await crypto.subtle.importKey(
      'raw',
      secret.secret.buffer.slice(secret.secret.byteOffset, secret.secret.byteOffset + secret.secret.byteLength) as ArrayBuffer,
      { name: 'HMAC', hash: algorithm },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', key, counterBuffer);
    const hmac = new Uint8Array(signature);

    // Dynamic truncation
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary = (
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)
    );

    const code = binary % Math.pow(10, secret.digits);
    return code.toString().padStart(secret.digits, '0');
  }

  private generateUri(secret: string, accountName: string, config: TOTPSecret): string {
    const params = new URLSearchParams({
      secret,
      issuer: this.issuer,
      algorithm: config.algorithm,
      digits: config.digits.toString(),
      period: config.period.toString(),
    });

    const label = encodeURIComponent(`${this.issuer}:${accountName}`);
    return `otpauth://totp/${label}?${params}`;
  }

  private async generateQRCodeData(uri: string): Promise<string> {
    // Generate QR code as SVG using a simple implementation
    // In production, use a library like qrcode or better-qrcode
    
    // For now, return a placeholder that tells the client to use the URI directly
    // Real implementation would generate actual QR code data
    return `data:text/plain;base64,${btoa(uri)}`;
  }

  private base32Encode(bytes: Uint8Array): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let result = '';
    let bits = 0;
    let value = 0;

    for (const byte of bytes) {
      value = (value << 8) | byte;
      bits += 8;

      while (bits >= 5) {
        result += alphabet[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }

    if (bits > 0) {
      result += alphabet[(value << (5 - bits)) & 31];
    }

    return result;
  }

  private getAlgorithmName(algorithm: string): string {
    switch (algorithm) {
      case 'SHA1': return 'SHA-1';
      case 'SHA256': return 'SHA-256';
      case 'SHA512': return 'SHA-512';
      default: return 'SHA-1';
    }
  }

  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
}

export function createTOTPManager(config?: { issuer?: string }): TOTPManager {
  return new TOTPManager(config);
}
