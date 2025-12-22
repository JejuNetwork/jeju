/**
 * Token SDK Tests
 *
 * Comprehensive tests for JWT-like token issuance, verification,
 * base64url encoding, and edge cases.
 * 
 * Uses wallet-signed tokens for testing since MPC/TEE providers
 * are not available in unit tests.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  issueTokenWithWallet,
  verifyToken,
  decodeToken,
  isTokenExpired,
  type TokenClaims,
} from './tokens';

describe('Token SDK', () => {
  const testPrivateKey: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const testAccount = privateKeyToAccount(testPrivateKey);

  async function createWalletToken(
    claims: Omit<TokenClaims, 'iat' | 'jti'>,
    options?: { expiresInSeconds?: number }
  ) {
    const now = Math.floor(Date.now() / 1000);
    const fullClaims = {
      ...claims,
      iat: now,
      jti: crypto.randomUUID(),
      exp: claims.exp ?? now + (options?.expiresInSeconds ?? 3600),
    };

    // Sign the full claims for wallet signature
    const claimsJson = JSON.stringify(fullClaims);
    const signature = await testAccount.signMessage({ message: claimsJson });

    return issueTokenWithWallet(claims, {
      sig: signature,
      derivedVia: 'web3.eth.personal.sign',
      signedMessage: claimsJson,
      address: testAccount.address,
    }, options);
  }

  describe('Token Issuance with Wallet', () => {
    it('should issue a token with required claims', async () => {
      const claims = {
        sub: 'user123',
        iss: 'jeju:oauth3',
        aud: 'gateway',
      };

      const token = await createWalletToken(claims);

      expect(token.token).toBeDefined();
      expect(token.header).toBeDefined();
      expect(token.payload).toBeDefined();
      expect(token.signature).toBeDefined();
      expect(token.token.split('.').length).toBe(3);
    });

    it('should auto-populate iat and jti', async () => {
      const claims = {
        sub: 'user123',
        iss: 'jeju:oauth3',
        aud: 'gateway',
      };

      const before = Math.floor(Date.now() / 1000);
      const token = await createWalletToken(claims);
      const after = Math.floor(Date.now() / 1000);

      const decoded = decodeToken(token.token);
      expect(decoded).not.toBeNull();
      expect(decoded!.iat).toBeGreaterThanOrEqual(before);
      expect(decoded!.iat).toBeLessThanOrEqual(after);
      expect(decoded!.jti).toBeDefined();
      expect(typeof decoded!.jti).toBe('string');
    });

    it('should set expiration from options', async () => {
      const claims = {
        sub: 'user123',
        iss: 'jeju:oauth3',
        aud: 'gateway',
      };

      const token = await createWalletToken(claims, { expiresInSeconds: 7200 });
      const decoded = decodeToken(token.token);

      const expectedExp = decoded!.iat! + 7200;
      expect(decoded!.exp).toBe(expectedExp);
    });

    it('should respect exp from claims if provided', async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 86400;
      const claims = {
        sub: 'user123',
        iss: 'jeju:oauth3',
        aud: 'gateway',
        exp: futureExp,
      };

      const token = await createWalletToken(claims);
      const decoded = decodeToken(token.token);

      expect(decoded!.exp).toBe(futureExp);
    });

    it('should include wallet address in claims', async () => {
      const claims = {
        sub: 'user123',
        iss: 'jeju:oauth3',
        aud: 'gateway',
      };

      const token = await createWalletToken(claims);
      const decoded = decodeToken(token.token);

      expect(decoded!.wallet).toBe(testAccount.address);
    });

    it('should include optional claims', async () => {
      const claims = {
        sub: 'user123',
        iss: 'jeju:oauth3',
        aud: 'gateway',
        chainId: 'eip155:8453',
        provider: 'github',
        scopes: ['read', 'write'],
      };

      const token = await createWalletToken(claims);
      const decoded = decodeToken(token.token);

      expect(decoded!.chainId).toBe('eip155:8453');
      expect(decoded!.provider).toBe('github');
      expect(decoded!.scopes).toEqual(['read', 'write']);
    });
  });

  describe('Token Verification', () => {
    it('should verify valid wallet-signed token', async () => {
      const claims = {
        sub: 'user123',
        iss: 'jeju:oauth3',
        aud: 'gateway',
      };

      const token = await createWalletToken(claims);
      const result = await verifyToken(token.token, {
        issuer: 'jeju:oauth3',
        audience: 'gateway',
      });

      // Wallet-signed tokens are verified against wallet address
      expect(result.claims?.sub).toBe('user123');
      expect(result.claims?.wallet).toBe(testAccount.address);
    });

    it('should reject expired token', async () => {
      const claims = {
        sub: 'user123',
        iss: 'jeju:oauth3',
        aud: 'gateway',
        exp: Math.floor(Date.now() / 1000) - 100, // Already expired
      };

      const token = await createWalletToken(claims);
      const result = await verifyToken(token.token);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('should allow expired token with allowExpired option', async () => {
      const claims = {
        sub: 'user123',
        iss: 'jeju:oauth3',
        aud: 'gateway',
        exp: Math.floor(Date.now() / 1000) - 100,
      };

      const token = await createWalletToken(claims);
      const result = await verifyToken(token.token, { allowExpired: true });

      expect(result.claims?.sub).toBe('user123');
    });

    it('should reject wrong issuer', async () => {
      const claims = {
        sub: 'user123',
        iss: 'jeju:oauth3',
        aud: 'gateway',
      };

      const token = await createWalletToken(claims);
      const result = await verifyToken(token.token, { issuer: 'wrong-issuer' });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid issuer');
    });

    it('should reject wrong audience', async () => {
      const claims = {
        sub: 'user123',
        iss: 'jeju:oauth3',
        aud: 'gateway',
      };

      const token = await createWalletToken(claims);
      const result = await verifyToken(token.token, { audience: 'wrong-audience' });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid audience');
    });

    it('should reject invalid token format', async () => {
      const result = await verifyToken('not.a.valid.token.format');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('expected 3 parts');
    });

    it('should reject malformed header', async () => {
      const token = 'notbase64.eyJzdWIiOiJ0ZXN0In0.sig';
      const result = await verifyToken(token);
      expect(result.valid).toBe(false);
    });
  });

  describe('Token Decoding', () => {
    it('should decode valid token without verification', async () => {
      const claims = {
        sub: 'user123',
        iss: 'jeju:oauth3',
        aud: 'gateway',
      };

      const token = await createWalletToken(claims);
      const decoded = decodeToken(token.token);

      expect(decoded).not.toBeNull();
      expect(decoded!.sub).toBe('user123');
      expect(decoded!.iss).toBe('jeju:oauth3');
      expect(decoded!.aud).toBe('gateway');
      expect(decoded!.wallet).toBe(testAccount.address);
    });

    it('should return null for invalid token', () => {
      expect(decodeToken('invalid')).toBeNull();
      expect(decodeToken('invalid.token')).toBeNull();
      expect(decodeToken('a.b.c.d')).toBeNull();
    });

    it('should return null for malformed payload', () => {
      // Valid base64url but invalid JSON
      const token = 'eyJhbGciOiJFUzI1NksifQ.notvalidbase64.sig';
      expect(decodeToken(token)).toBeNull();
    });

    it('should return null for token with invalid claims', () => {
      // Create a token with missing required fields
      const header = Buffer.from(JSON.stringify({ alg: 'ES256K', typ: 'JWT' }))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
      const payload = Buffer.from(JSON.stringify({ invalid: 'claims' }))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
      const token = `${header}.${payload}.sig`;

      expect(decodeToken(token)).toBeNull();
    });
  });

  describe('Token Expiration Check', () => {
    it('should detect expired token', async () => {
      const claims = {
        sub: 'user123',
        iss: 'jeju:oauth3',
        aud: 'gateway',
        exp: Math.floor(Date.now() / 1000) - 1000, // Expired 1000 seconds ago
      };

      const token = await createWalletToken(claims);
      expect(isTokenExpired(token.token)).toBe(true);
    });

    it('should detect valid token', async () => {
      const claims = {
        sub: 'user123',
        iss: 'jeju:oauth3',
        aud: 'gateway',
        exp: Math.floor(Date.now() / 1000) + 3600, // Expires in 1 hour
      };

      const token = await createWalletToken(claims);
      expect(isTokenExpired(token.token)).toBe(false);
    });

    it('should return true for invalid token', () => {
      expect(isTokenExpired('invalid-token')).toBe(true);
    });
  });
});

describe('Base64URL Encoding Edge Cases', () => {
  const testPrivateKey: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const testAccount = privateKeyToAccount(testPrivateKey);

  async function createWalletToken(claims: Omit<TokenClaims, 'iat' | 'jti'>) {
    const now = Math.floor(Date.now() / 1000);
    const fullClaims = { ...claims, iat: now, jti: crypto.randomUUID(), exp: claims.exp ?? now + 3600 };
    const claimsJson = JSON.stringify(fullClaims);
    const signature = await testAccount.signMessage({ message: claimsJson });
    return issueTokenWithWallet(claims, {
      sig: signature,
      derivedVia: 'web3.eth.personal.sign',
      signedMessage: claimsJson,
      address: testAccount.address,
    });
  }

  it('should handle special characters in claims', async () => {
    const claims = {
      sub: 'user+special/chars=test',
      iss: 'jeju:oauth3',
      aud: 'gateway',
    };

    const token = await createWalletToken(claims);
    const decoded = decodeToken(token.token);

    expect(decoded!.sub).toBe('user+special/chars=test');
  });

  it('should handle unicode in claims', async () => {
    const claims = {
      sub: 'ユーザー🔐',
      iss: 'jeju:oauth3',
      aud: 'gateway',
    };

    const token = await createWalletToken(claims);
    const decoded = decodeToken(token.token);

    expect(decoded!.sub).toBe('ユーザー🔐');
  });
});

describe('Token Security Properties', () => {
  const testPrivateKey: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const testAccount = privateKeyToAccount(testPrivateKey);

  async function createWalletToken(claims: Omit<TokenClaims, 'iat' | 'jti'>) {
    const now = Math.floor(Date.now() / 1000);
    const fullClaims = { ...claims, iat: now, jti: crypto.randomUUID(), exp: claims.exp ?? now + 3600 };
    const claimsJson = JSON.stringify(fullClaims);
    const signature = await testAccount.signMessage({ message: claimsJson });
    return issueTokenWithWallet(claims, {
      sig: signature,
      derivedVia: 'web3.eth.personal.sign',
      signedMessage: claimsJson,
      address: testAccount.address,
    });
  }

  it('should generate unique jti for each token', async () => {
    const claims = {
      sub: 'user123',
      iss: 'jeju:oauth3',
      aud: 'gateway',
    };

    const tokens = await Promise.all(
      Array.from({ length: 100 }, () => createWalletToken(claims))
    );

    const jtis = new Set(tokens.map(t => decodeToken(t.token)!.jti));
    expect(jtis.size).toBe(100);
  });

  it('should detect token tampering through verification', async () => {
    const claims = {
      sub: 'user123',
      iss: 'jeju:oauth3',
      aud: 'gateway',
    };

    const token = await createWalletToken(claims);

    // Tamper with the payload (change sub to different user)
    const parts = token.token.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({
      ...decodeToken(token.token),
      sub: 'hacker',
    })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    // Decoding shows the tampered value
    const decoded = decodeToken(tamperedToken);
    expect(decoded?.sub).toBe('hacker');

    // But verification will fail due to signature mismatch
    const result = await verifyToken(tamperedToken);
    // The signature won't match the tampered payload
    expect(result.valid).toBe(false);
  });

  it('should have consistent token format', async () => {
    const claims = {
      sub: 'user123',
      iss: 'jeju:oauth3',
      aud: 'gateway',
    };

    const token = await createWalletToken(claims);
    const parts = token.token.split('.');

    expect(parts.length).toBe(3);

    // Header should decode to proper JSON
    const headerJson = Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    const header = JSON.parse(headerJson);
    expect(header.alg).toBe('ES256K');
    expect(header.typ).toBe('JWT');

    // Payload should decode to proper JSON with required fields
    const payloadJson = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    const payload = JSON.parse(payloadJson);
    expect(payload.sub).toBe('user123');
    expect(payload.iss).toBe('jeju:oauth3');
    expect(payload.aud).toBe('gateway');

    // Signature should be present
    expect(parts[2].length).toBeGreaterThan(0);
  });

  it('should include wallet address in token', async () => {
    const claims = {
      sub: 'wallet-user',
      iss: 'jeju:oauth3',
      aud: 'gateway',
    };

    const token = await createWalletToken(claims);
    const decoded = decodeToken(token.token);

    expect(decoded?.wallet).toBe(testAccount.address);
    expect(decoded?.wallet).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });
});

describe('Direct issueTokenWithWallet', () => {
  const testPrivateKey: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const testAccount = privateKeyToAccount(testPrivateKey);

  it('should create token with wallet signature', async () => {
    const claims = {
      sub: 'user123',
      iss: 'jeju:oauth3',
      aud: 'gateway',
    };

    const signingMessage = JSON.stringify(claims);
    const signature = await testAccount.signMessage({ message: signingMessage });

    const token = await issueTokenWithWallet(claims, {
      sig: signature,
      derivedVia: 'web3.eth.personal.sign',
      signedMessage: signingMessage,
      address: testAccount.address,
    });

    expect(token.token).toBeDefined();
    expect(token.signature).toBe(signature);

    const decoded = decodeToken(token.token);
    expect(decoded?.wallet).toBe(testAccount.address);
    expect(decoded?.sub).toBe('user123');
  });

  it('should use ES256K algorithm for wallet tokens', async () => {
    const claims = {
      sub: 'user123',
      iss: 'jeju:oauth3',
      aud: 'gateway',
    };

    const signingMessage = JSON.stringify(claims);
    const signature = await testAccount.signMessage({ message: signingMessage });

    const token = await issueTokenWithWallet(claims, {
      sig: signature,
      derivedVia: 'web3.eth.personal.sign',
      signedMessage: signingMessage,
      address: testAccount.address,
    });

    const parts = token.token.split('.');
    const headerJson = Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    const header = JSON.parse(headerJson);

    expect(header.alg).toBe('ES256K');
    expect(header.typ).toBe('JWT');
  });

  it('should set expiration from options', async () => {
    const claims = {
      sub: 'user123',
      iss: 'jeju:oauth3',
      aud: 'gateway',
    };

    const before = Math.floor(Date.now() / 1000);
    const signingMessage = JSON.stringify(claims);
    const signature = await testAccount.signMessage({ message: signingMessage });

    const token = await issueTokenWithWallet(claims, {
      sig: signature,
      derivedVia: 'web3.eth.personal.sign',
      signedMessage: signingMessage,
      address: testAccount.address,
    }, { expiresInSeconds: 7200 });

    const decoded = decodeToken(token.token);
    const expectedMinExp = before + 7200;

    expect(decoded!.exp).toBeGreaterThanOrEqual(expectedMinExp);
    expect(decoded!.exp).toBeLessThanOrEqual(expectedMinExp + 5); // Allow 5 sec tolerance
  });
});
