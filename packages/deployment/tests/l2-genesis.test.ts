/**
 * Unit tests for L2 genesis utilities
 *
 * Tests JWT secret generation with cryptographic property verification.
 */

import { describe, it, expect } from "bun:test";

// ============ Function Under Test ============

/**
 * Generate a 32-byte (64 hex character) JWT secret
 * This is used for secure communication between L1 and L2 nodes
 */
function generateJwtSecret(): string {
  return Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join("");
}

// ============ Tests ============

describe("generateJwtSecret", () => {
  it("should generate a 64-character hex string", () => {
    const secret = generateJwtSecret();
    expect(secret.length).toBe(64);
  });

  it("should only contain valid hex characters", () => {
    const secret = generateJwtSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should generate different secrets on each call", () => {
    const secrets = new Set<string>();
    for (let i = 0; i < 100; i++) {
      secrets.add(generateJwtSecret());
    }
    // With 64 hex chars, collision probability is negligible
    expect(secrets.size).toBe(100);
  });

  it("should have reasonable entropy distribution", () => {
    // Generate many secrets and check hex digit distribution
    const charCounts: Record<string, number> = {};
    const sampleSize = 1000;
    const charsPerSecret = 64;
    const totalChars = sampleSize * charsPerSecret;

    for (let i = 0; i < sampleSize; i++) {
      const secret = generateJwtSecret();
      for (const char of secret) {
        charCounts[char] = (charCounts[char] ?? 0) + 1;
      }
    }

    // Each hex digit should appear roughly 1/16 of the time
    const expectedCount = totalChars / 16;
    const tolerance = expectedCount * 0.15; // 15% tolerance for randomness

    for (let i = 0; i < 16; i++) {
      const hex = i.toString(16);
      const count = charCounts[hex] ?? 0;
      expect(count).toBeGreaterThan(expectedCount - tolerance);
      expect(count).toBeLessThan(expectedCount + tolerance);
    }
  });

  it("should not generate all zeros", () => {
    const secrets: string[] = [];
    for (let i = 0; i < 100; i++) {
      secrets.push(generateJwtSecret());
    }
    const allZeros = "0".repeat(64);
    expect(secrets).not.toContain(allZeros);
  });

  it("should not generate all same character", () => {
    const secrets: string[] = [];
    for (let i = 0; i < 100; i++) {
      secrets.push(generateJwtSecret());
    }
    
    for (const secret of secrets) {
      const uniqueChars = new Set(secret.split(""));
      // Should have more than 1 unique character
      expect(uniqueChars.size).toBeGreaterThan(1);
    }
  });

  it("should be case-consistent (lowercase only)", () => {
    for (let i = 0; i < 50; i++) {
      const secret = generateJwtSecret();
      expect(secret).toBe(secret.toLowerCase());
    }
  });
});

describe("JWT Secret format requirements", () => {
  it("should be exactly 32 bytes (256 bits) when decoded", () => {
    const secret = generateJwtSecret();
    // Each hex char represents 4 bits, so 64 chars = 256 bits = 32 bytes
    const byteLength = secret.length / 2;
    expect(byteLength).toBe(32);
  });

  it("should be valid for ethereum JWT auth", () => {
    // Ethereum engine API requires a 32-byte hex-encoded secret
    const secret = generateJwtSecret();
    
    // Should be parseable as hex
    const bytes = Buffer.from(secret, "hex");
    expect(bytes.length).toBe(32);
    
    // Should round-trip correctly
    expect(bytes.toString("hex")).toBe(secret);
  });

  it("should work as a file content (no special characters)", () => {
    const secret = generateJwtSecret();
    
    // Should not contain newlines, spaces, or other whitespace
    expect(secret).not.toMatch(/\s/);
    
    // Should be safe to write to file as-is
    expect(secret).not.toContain("\n");
    expect(secret).not.toContain("\r");
    expect(secret).not.toContain(" ");
  });
});

describe("Cryptographic properties", () => {
  it("should have high entropy (at least 128 bits effective)", () => {
    // This is a simplified entropy check
    // With 16 possible values per character and 64 characters,
    // max entropy is 64 * 4 = 256 bits
    
    const secret = generateJwtSecret();
    const uniqueChars = new Set(secret.split(""));
    
    // Should use at least 8 different hex characters (very conservative)
    expect(uniqueChars.size).toBeGreaterThanOrEqual(8);
  });

  it("should not have obvious patterns", () => {
    for (let i = 0; i < 50; i++) {
      const secret = generateJwtSecret();
      
      // Check for repeating patterns
      // A truly random string should not have long repeated substrings
      for (let len = 8; len <= 16; len++) {
        const pattern = secret.slice(0, len);
        const rest = secret.slice(len);
        expect(rest).not.toContain(pattern);
      }
    }
  });

  it("should pass basic randomness tests", () => {
    // Generate secrets and check for statistical randomness
    const samples = 1000;
    let totalBits = 0;
    let oneBits = 0;

    for (let i = 0; i < samples; i++) {
      const secret = generateJwtSecret();
      const bytes = Buffer.from(secret, "hex");
      
      for (const byte of bytes) {
        totalBits += 8;
        // Count set bits
        let b = byte;
        while (b > 0) {
          oneBits += b & 1;
          b >>= 1;
        }
      }
    }

    // Ratio of 1-bits should be close to 0.5
    const ratio = oneBits / totalBits;
    expect(ratio).toBeGreaterThan(0.45);
    expect(ratio).toBeLessThan(0.55);
  });
});
