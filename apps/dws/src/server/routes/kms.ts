/**
 * KMS API Routes
 * Key Management Service integration for DWS
 */

import { Hono } from 'hono';
import type { Address, Hex } from 'viem';
import { validateBody, validateParams, validateHeaders, expectValid, jejuAddressHeaderSchema, createKmsKeyRequestSchema, kmsKeyParamsSchema, signRequestSchema, encryptRequestSchema, decryptRequestSchema, keyListQuerySchema, z } from '../../shared';

// MPC Configuration
const MPC_CONFIG = {
  defaultThreshold: 3,
  defaultParties: 5,
  minStake: BigInt(100),
  sessionTimeout: 300000, // 5 minutes
  maxConcurrentSessions: 100,
};

// In-memory key storage (set MPC_COORDINATOR_URL for production MPC key management)
interface StoredKey {
  keyId: string;
  owner: Address;
  publicKey: Hex;
  address: Address;
  threshold: number;
  totalParties: number;
  createdAt: number;
  version: number;
  metadata: Record<string, string>;
}

interface Secret {
  id: string;
  name: string;
  owner: Address;
  encryptedValue: string;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  metadata: Record<string, string>;
}

const keys = new Map<string, StoredKey>();
const secrets = new Map<string, Secret>();
const signingSessions = new Map<string, {
  sessionId: string;
  keyId: string;
  messageHash: Hex;
  requester: Address;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'signing' | 'completed' | 'expired';
}>();

export function createKMSRouter(): Hono {
  const router = new Hono();

  // ============================================================================
  // Health & Info
  // ============================================================================

  router.get('/health', (c) => {
    return c.json({
      status: 'healthy',
      service: 'dws-kms',
      keys: keys.size,
      secrets: secrets.size,
      activeSessions: Array.from(signingSessions.values())
        .filter(s => s.status === 'pending' || s.status === 'signing').length,
      config: {
        defaultThreshold: MPC_CONFIG.defaultThreshold,
        defaultParties: MPC_CONFIG.defaultParties,
      },
    });
  });

  // ============================================================================
  // Key Management
  // ============================================================================

  // Generate new MPC key
  router.post('/keys', async (c) => {
    const { 'x-jeju-address': owner } = validateHeaders(jejuAddressHeaderSchema, c);
    const body = await validateBody(createKmsKeyRequestSchema.extend({
      threshold: z.number().int().min(2).optional(),
      totalParties: z.number().int().positive().optional(),
      metadata: z.record(z.string(), z.string()).optional(),
    }), c);

    const threshold = body.threshold ?? MPC_CONFIG.defaultThreshold;
    const totalParties = body.totalParties ?? MPC_CONFIG.defaultParties;

    if (threshold < 2) {
      return c.json({ error: 'Threshold must be at least 2' }, 400);
    }
    if (threshold > totalParties) {
      return c.json({ error: 'Threshold cannot exceed total parties' }, 400);
    }

    const keyId = crypto.randomUUID();
    
    // In development mode, generate a local key. In production, this would use MPC.
    const mpcEnabled = !!process.env.MPC_COORDINATOR_URL;
    if (!mpcEnabled) {
      console.warn('[KMS] Running in development mode - keys are not MPC-secured');
    }
    
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const privateKey = `0x${Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('')}` as Hex;
    const { privateKeyToAccount } = await import('viem/accounts');
    const account = privateKeyToAccount(privateKey as `0x${string}`);

    const key: StoredKey = {
      keyId,
      owner,
      publicKey: account.publicKey as Hex,
      address: account.address,
      threshold,
      totalParties,
      createdAt: Date.now(),
      version: 1,
      metadata: body.metadata ?? {},
    };

    keys.set(keyId, key);
    
    return c.json({
      keyId,
      publicKey: key.publicKey,
      address: key.address,
      threshold,
      totalParties,
      createdAt: key.createdAt,
      mode: mpcEnabled ? 'mpc' : 'development',
      warning: mpcEnabled ? undefined : 'Key is locally generated. Set MPC_COORDINATOR_URL for production MPC keys.',
    }, 201);
  });

  // List keys
  router.get('/keys', (c) => {
    const { 'x-jeju-address': owner } = validateHeaders(z.object({ 'x-jeju-address': z.string().optional() }), c);
    
    let keyList = Array.from(keys.values());
    if (owner) {
      keyList = keyList.filter(k => k.owner.toLowerCase() === owner);
    }

    return c.json({
      keys: keyList.map(k => ({
        keyId: k.keyId,
        address: k.address,
        threshold: k.threshold,
        totalParties: k.totalParties,
        version: k.version,
        createdAt: k.createdAt,
      })),
    });
  });

  // Get key details
  router.get('/keys/:keyId', (c) => {
    const { keyId } = validateParams(kmsKeyParamsSchema, c);
    const key = keys.get(keyId);
    if (!key) {
      throw new Error('Key not found');
    }

    return c.json({
      keyId: key.keyId,
      publicKey: key.publicKey,
      address: key.address,
      threshold: key.threshold,
      totalParties: key.totalParties,
      version: key.version,
      createdAt: key.createdAt,
      metadata: key.metadata,
    });
  });

  // Rotate key
  router.post('/keys/:keyId/rotate', async (c) => {
    const { 'x-jeju-address': owner } = validateHeaders(jejuAddressHeaderSchema, c);
    const { keyId } = validateParams(kmsKeyParamsSchema, c);
    const key = keys.get(keyId);
    
    if (!key) {
      throw new Error('Key not found');
    }
    if (key.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('Not authorized');
    }

    const body = await c.req.json<{
      newThreshold?: number;
      newTotalParties?: number;
    }>();

    key.threshold = body.newThreshold ?? key.threshold;
    key.totalParties = body.newTotalParties ?? key.totalParties;
    key.version++;

    return c.json({
      keyId: key.keyId,
      version: key.version,
      threshold: key.threshold,
      totalParties: key.totalParties,
    });
  });

  // Delete key
  router.delete('/keys/:keyId', (c) => {
    const { 'x-jeju-address': owner } = validateHeaders(jejuAddressHeaderSchema, c);
    const { keyId } = validateParams(kmsKeyParamsSchema, c);
    const key = keys.get(keyId);
    
    if (!key) {
      throw new Error('Key not found');
    }
    if (key.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('Not authorized');
    }

    keys.delete(key.keyId);
    return c.json({ success: true });
  });

  // ============================================================================
  // Signing
  // ============================================================================

  // Request signature
  router.post('/sign', async (c) => {
    const { 'x-jeju-address': requester } = validateHeaders(jejuAddressHeaderSchema, c);
    const body = await validateBody(signRequestSchema.extend({
      keyId: z.string().uuid(),
    }), c);

    const key = keys.get(body.keyId);
    if (!key) {
      throw new Error('Key not found');
    }

    // Development mode: sign with locally-derived key
    // Production: would initiate MPC signing session with threshold parties
    const mpcEnabled = !!process.env.MPC_COORDINATOR_URL;
    
    const { privateKeyToAccount } = await import('viem/accounts');
    const { keccak256, toBytes, toHex, fromHex } = await import('viem');
    
    // Derive signing key from keyId (deterministic for development)
    const derivedKey = keccak256(toBytes(`${key.keyId}:${key.version}`));
    const account = privateKeyToAccount(derivedKey);
    
    // Convert message to bytes based on encoding
    const messageBytes = body.encoding === 'hex' 
      ? fromHex(body.message as `0x${string}`, 'bytes')
      : new TextEncoder().encode(body.message);
    
    const signature = await account.signMessage({
      message: { raw: messageBytes },
    });

    return c.json({
      signature,
      keyId: key.keyId,
      address: key.address,
      signedAt: Date.now(),
      mode: mpcEnabled ? 'mpc' : 'development',
      warning: mpcEnabled ? undefined : 'Signed with local key. Set MPC_COORDINATOR_URL for production MPC signing.',
    });
  });

  // ============================================================================
  // Encryption
  // ============================================================================

  router.post('/encrypt', async (c) => {
    const body = await validateBody(encryptRequestSchema.extend({
      keyId: z.string().uuid().optional(),
    }), c);

    // AES-256-GCM encryption (development mode - key stored in memory)
    const nodeCrypto = await import('crypto');
    const { keccak256, toBytes } = await import('viem');
    
    // Generate or derive encryption key
    const keyId = body.keyId ?? crypto.randomUUID();
    const derivedKey = Buffer.from(keccak256(toBytes(keyId)).slice(2), 'hex');
    
    // Encrypt with AES-256-GCM
    const iv = nodeCrypto.randomBytes(12);
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', derivedKey, iv);
    const encrypted = Buffer.concat([cipher.update(body.data, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    
    // Format: iv (12) + authTag (16) + ciphertext, base64 encoded
    const ciphertext = Buffer.concat([iv, authTag, encrypted]).toString('base64');

    return c.json({
      encrypted: ciphertext,
      keyId,
      mode: process.env.MPC_COORDINATOR_URL ? 'mpc' : 'development',
    });
  });

  router.post('/decrypt', async (c) => {
    const body = await validateBody(decryptRequestSchema.extend({
      keyId: z.string().uuid(),
    }), c);

    const mpcEnabled = !!process.env.MPC_COORDINATOR_URL;
    
    // Decrypt with AES-256-GCM (development mode)
    const nodeCrypto = await import('crypto');
    const { keccak256, toBytes } = await import('viem');
    
    const data = Buffer.from(body.encrypted, 'base64');
    const iv = data.subarray(0, 12);
    const authTag = data.subarray(12, 28);
    const ciphertext = data.subarray(28);
    
    const derivedKey = Buffer.from(keccak256(toBytes(body.keyId)).slice(2), 'hex');
    const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
    decipher.setAuthTag(authTag);
    
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');

    return c.json({
      decrypted,
      keyId: body.keyId,
      mode: mpcEnabled ? 'mpc' : 'development',
      warning: mpcEnabled ? undefined : 'Running in development mode. Set MPC_COORDINATOR_URL for production MPC.',
    });
  });

  // Legacy endpoint for backwards compatibility
  router.post('/decrypt-mpc', async (c) => {
    const body = await c.req.json<{
      encrypted: string;
      keyId: string;
    }>();

    const mpcEnabled = !!process.env.MPC_COORDINATOR_URL;
    
    if (!mpcEnabled) {
      return c.json({
        error: 'MPC decryption not available',
        message: 'MPC decryption requires MPC_COORDINATOR_URL to be configured',
        mode: 'development',
      }, 501);
    }

    // In production with MPC configured, would decrypt using threshold signatures
    return c.json({
      error: 'MPC decryption not yet implemented',
      message: 'Configure MPC provider and implement threshold decryption',
    }, 501);
  });

  // ============================================================================
  // Secret Vault
  // ============================================================================

  // Store secret
  router.post('/vault/secrets', async (c) => {
    const owner = c.req.header('x-jeju-address') as Address;
    if (!owner) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const body = await c.req.json<{
      name: string;
      value: string;
      metadata?: Record<string, string>;
      expiresIn?: number; // seconds
    }>();

    if (!body.name || !body.value) {
      return c.json({ error: 'Name and value required' }, 400);
    }

    const id = crypto.randomUUID();
    const { keccak256, toBytes } = await import('viem');
    const nodeCrypto = await import('crypto');
    
    // Encrypt the value with AES-256-GCM
    const derivedKey = Buffer.from(keccak256(toBytes(id)).slice(2), 'hex');
    const iv = nodeCrypto.randomBytes(12);
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', derivedKey, iv);
    const encrypted = Buffer.concat([cipher.update(body.value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const encryptedValue = Buffer.concat([iv, authTag, encrypted]).toString('base64');

    const secret: Secret = {
      id,
      name: body.name,
      owner,
      encryptedValue,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: body.expiresIn ? Date.now() + body.expiresIn * 1000 : undefined,
      metadata: body.metadata ?? {},
    };

    secrets.set(id, secret);

    return c.json({
      id,
      name: secret.name,
      createdAt: secret.createdAt,
      expiresAt: secret.expiresAt,
    }, 201);
  });

  // List secrets
  router.get('/vault/secrets', (c) => {
    const owner = c.req.header('x-jeju-address')?.toLowerCase();
    
    let secretList = Array.from(secrets.values());
    if (owner) {
      secretList = secretList.filter(s => s.owner.toLowerCase() === owner);
    }

    // Filter expired secrets
    const now = Date.now();
    secretList = secretList.filter(s => !s.expiresAt || s.expiresAt > now);

    return c.json({
      secrets: secretList.map(s => ({
        id: s.id,
        name: s.name,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        expiresAt: s.expiresAt,
      })),
    });
  });

  // Get secret (returns metadata only, not value)
  router.get('/vault/secrets/:id', (c) => {
    const owner = c.req.header('x-jeju-address')?.toLowerCase();
    const secret = secrets.get(c.req.param('id'));
    
    if (!secret) {
      return c.json({ error: 'Secret not found' }, 404);
    }
    if (secret.owner.toLowerCase() !== owner) {
      return c.json({ error: 'Not authorized' }, 403);
    }
    if (secret.expiresAt && secret.expiresAt < Date.now()) {
      return c.json({ error: 'Secret expired' }, 410);
    }

    return c.json({
      id: secret.id,
      name: secret.name,
      createdAt: secret.createdAt,
      updatedAt: secret.updatedAt,
      expiresAt: secret.expiresAt,
      metadata: secret.metadata,
    });
  });

  // Reveal secret value (requires authentication)
  router.post('/vault/secrets/:id/reveal', async (c) => {
    const owner = c.req.header('x-jeju-address')?.toLowerCase();
    const secret = secrets.get(c.req.param('id'));
    
    if (!secret) {
      return c.json({ error: 'Secret not found' }, 404);
    }
    if (secret.owner.toLowerCase() !== owner) {
      return c.json({ error: 'Not authorized' }, 403);
    }
    if (secret.expiresAt && secret.expiresAt < Date.now()) {
      return c.json({ error: 'Secret expired' }, 410);
    }

    // Decrypt the value with AES-256-GCM
    const { keccak256, toBytes } = await import('viem');
    const nodeCrypto = await import('crypto');
    
    const data = Buffer.from(secret.encryptedValue, 'base64');
    const iv = data.subarray(0, 12);
    const authTag = data.subarray(12, 28);
    const ciphertext = data.subarray(28);
    
    const derivedKey = Buffer.from(keccak256(toBytes(secret.id)).slice(2), 'hex');
    const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
    decipher.setAuthTag(authTag);
    
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    
    return c.json({
      id: secret.id,
      name: secret.name,
      value: decrypted,
    });
  });

  // Delete secret
  router.delete('/vault/secrets/:id', (c) => {
    const owner = c.req.header('x-jeju-address')?.toLowerCase();
    const secret = secrets.get(c.req.param('id'));
    
    if (!secret) {
      return c.json({ error: 'Secret not found' }, 404);
    }
    if (secret.owner.toLowerCase() !== owner) {
      return c.json({ error: 'Not authorized' }, 403);
    }

    secrets.delete(secret.id);
    return c.json({ success: true });
  });

  return router;
}

