/**
 * Encrypted Storage API
 * 
 * Integrates @jeju/kms with DA server for permissionless encrypted storage.
 * 
 * Features:
 * - Encrypt data before storing to IPFS
 * - Policy-based access control for decryption
 * - Key rotation with backwards compatibility
 * - Secret storage and injection
 */

import { Hono } from 'hono';
import { keccak256 } from 'ethers';
import type { Address, Hex } from 'viem';

// Types for KMS integration (inline to avoid module resolution issues at runtime)
interface AccessControlPolicy {
  conditions: AccessCondition[];
  operator: 'and' | 'or';
}

interface AccessCondition {
  type: 'timestamp' | 'balance' | 'stake' | 'role' | 'agent' | 'contract';
  chain?: string;
  comparator?: string;
  value?: string | number;
  registryAddress?: string;
  minStakeUSD?: number;
  role?: string;
  agentId?: number;
  tokenAddress?: string;
  contractAddress?: string;
  method?: string;
  parameters?: string[];
  returnValueTest?: { comparator: string; value: string };
}

interface EncryptedPayload {
  ciphertext: string;
  dataHash: string;
  accessControlHash: string;
  policy: AccessControlPolicy;
  providerType: string;
  encryptedAt: number;
  keyId: string;
  metadata?: Record<string, string>;
}

interface Secret {
  id: string;
  name: string;
  encryptedValue: string;
  keyId: string;
  version: number;
  owner: string;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  tags: string[];
  metadata: Record<string, string>;
}

interface SecretPolicy {
  allowedAddresses?: string[];
  allowedRoles?: string[];
  minStake?: string;
  expiresAt?: number;
  maxAccessCount?: number;
  rotationInterval?: number;
}

// In-memory storage for encrypted data and secrets
const encryptedStore = new Map<string, EncryptedPayload>();
const secretStore = new Map<string, Secret>();
const secretVersions = new Map<string, Array<{ version: number; encryptedValue: string; createdAt: number; status: string }>>();
const secretPolicies = new Map<string, SecretPolicy>();
const accessLogs: Array<{ secretId: string; accessor: string; action: string; timestamp: number; success: boolean }> = [];

// Encryption key derived from environment
const ENCRYPTION_KEY = process.env.VAULT_ENCRYPTION_SECRET ?? process.env.KMS_FALLBACK_SECRET ?? 'local-dev-key';

async function deriveKey(keyId: string): Promise<CryptoKey> {
  const keyMaterial = new TextEncoder().encode(`${keyId}:${ENCRYPTION_KEY}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', keyMaterial);
  
  return crypto.subtle.importKey(
    'raw',
    hashBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encrypt(data: string, keyId: string): Promise<{ ciphertext: string; iv: string; tag: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await deriveKey(keyId);
  
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    new TextEncoder().encode(data)
  );

  const encryptedArray = new Uint8Array(encrypted);
  const ciphertext = encryptedArray.slice(0, -16);
  const tag = encryptedArray.slice(-16);

  return {
    ciphertext: Buffer.from(ciphertext).toString('hex'),
    iv: Buffer.from(iv).toString('hex'),
    tag: Buffer.from(tag).toString('hex'),
  };
}

async function decrypt(ciphertext: string, iv: string, tag: string, keyId: string): Promise<string> {
  const cryptoKey = await deriveKey(keyId);
  
  const ciphertextBytes = Buffer.from(ciphertext, 'hex');
  const ivBytes = Buffer.from(iv, 'hex');
  const tagBytes = Buffer.from(tag, 'hex');
  
  const combined = new Uint8Array([...ciphertextBytes, ...tagBytes]);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    cryptoKey,
    combined
  );

  return new TextDecoder().decode(decrypted);
}

function evaluatePolicy(policy: AccessControlPolicy, accessor: string, timestamp: number): boolean {
  for (const condition of policy.conditions) {
    let result = false;
    
    switch (condition.type) {
      case 'timestamp':
        const value = typeof condition.value === 'number' ? condition.value : parseInt(condition.value ?? '0');
        result = timestamp >= value;
        break;
      case 'balance':
      case 'stake':
      case 'role':
      case 'agent':
      case 'contract':
        // In production, these would check on-chain state
        result = true;
        break;
    }

    if (policy.operator === 'and' && !result) return false;
    if (policy.operator === 'or' && result) return true;
  }

  return policy.operator === 'and';
}

export function createEncryptedStorageRoutes(): Hono {
  const app = new Hono();

  /**
   * Store encrypted data
   */
  app.post('/api/v1/encrypted/store', async (c) => {
    const body = await c.req.json() as {
      data: string;
      policy: AccessControlPolicy;
      owner: string;
      metadata?: Record<string, string>;
    };

    const keyId = `enc-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const { ciphertext, iv, tag } = await encrypt(body.data, keyId);
    
    const encryptedAt = Math.floor(Date.now() / 1000);
    const dataHash = keccak256(Buffer.from(body.data));
    const accessControlHash = keccak256(Buffer.from(JSON.stringify(body.policy)));

    const payload: EncryptedPayload = {
      ciphertext: JSON.stringify({ ciphertext, iv, tag, version: 1 }),
      dataHash,
      accessControlHash,
      policy: body.policy,
      providerType: 'jeju-kms',
      encryptedAt,
      keyId,
      metadata: { ...body.metadata, owner: body.owner },
    };

    encryptedStore.set(keyId, payload);

    return c.json({
      keyId,
      dataHash,
      accessControlHash,
      encryptedAt,
    });
  });

  /**
   * Retrieve and decrypt data
   */
  app.post('/api/v1/encrypted/retrieve', async (c) => {
    const body = await c.req.json() as {
      keyId: string;
      accessor: string;
      authSignature?: string;
    };

    const payload = encryptedStore.get(body.keyId);
    if (!payload) {
      return c.json({ error: 'Data not found' }, 404);
    }

    // Evaluate access policy
    const now = Math.floor(Date.now() / 1000);
    const allowed = evaluatePolicy(payload.policy, body.accessor, now);
    if (!allowed) {
      return c.json({ error: 'Access denied' }, 403);
    }

    // Decrypt
    const parsed = JSON.parse(payload.ciphertext) as { ciphertext: string; iv: string; tag: string };
    const data = await decrypt(parsed.ciphertext, parsed.iv, parsed.tag, body.keyId);

    return c.json({
      data,
      keyId: body.keyId,
      policy: payload.policy,
      encryptedAt: payload.encryptedAt,
    });
  });

  /**
   * Store a secret
   */
  app.post('/api/v1/secrets/store', async (c) => {
    const body = await c.req.json() as {
      name: string;
      value: string;
      owner: string;
      policy?: SecretPolicy;
      tags?: string[];
      metadata?: Record<string, string>;
    };

    const secretId = `secret-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const keyId = `vault-key-${secretId}`;
    const { ciphertext, iv, tag } = await encrypt(body.value, keyId);

    const secret: Secret = {
      id: secretId,
      name: body.name,
      encryptedValue: JSON.stringify({ ciphertext, iv, tag }),
      keyId,
      version: 1,
      owner: body.owner,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: body.policy?.expiresAt,
      tags: body.tags ?? [],
      metadata: body.metadata ?? {},
    };

    secretStore.set(secretId, secret);
    secretVersions.set(secretId, [{
      version: 1,
      encryptedValue: secret.encryptedValue,
      createdAt: Date.now(),
      status: 'active',
    }]);

    if (body.policy) {
      secretPolicies.set(secretId, body.policy);
    }

    accessLogs.push({
      secretId,
      accessor: body.owner,
      action: 'write',
      timestamp: Date.now(),
      success: true,
    });

    return c.json({
      secretId,
      name: body.name,
      version: 1,
      createdAt: secret.createdAt,
    });
  });

  /**
   * Retrieve a secret
   */
  app.post('/api/v1/secrets/retrieve', async (c) => {
    const body = await c.req.json() as {
      secretId: string;
      accessor: string;
      version?: number;
    };

    const secret = secretStore.get(body.secretId);
    if (!secret) {
      accessLogs.push({
        secretId: body.secretId,
        accessor: body.accessor,
        action: 'read',
        timestamp: Date.now(),
        success: false,
      });
      return c.json({ error: 'Secret not found' }, 404);
    }

    // Check policy
    const policy = secretPolicies.get(body.secretId);
    if (policy) {
      if (policy.expiresAt && Date.now() > policy.expiresAt) {
        return c.json({ error: 'Secret expired' }, 403);
      }
      if (policy.allowedAddresses && !policy.allowedAddresses.includes(body.accessor)) {
        if (secret.owner !== body.accessor) {
          return c.json({ error: 'Access denied' }, 403);
        }
      }
    }

    // Get correct version
    let encryptedValue = secret.encryptedValue;
    let keyId = secret.keyId;
    
    if (body.version && body.version !== secret.version) {
      const versions = secretVersions.get(body.secretId);
      const versionRecord = versions?.find(v => v.version === body.version);
      if (!versionRecord) {
        return c.json({ error: `Version ${body.version} not found` }, 404);
      }
      if (versionRecord.status === 'revoked') {
        return c.json({ error: `Version ${body.version} revoked` }, 403);
      }
      encryptedValue = versionRecord.encryptedValue;
      keyId = `vault-key-${body.secretId}-v${body.version}`;
    }

    // Decrypt
    const parsed = JSON.parse(encryptedValue) as { ciphertext: string; iv: string; tag: string };
    const value = await decrypt(parsed.ciphertext, parsed.iv, parsed.tag, keyId);

    accessLogs.push({
      secretId: body.secretId,
      accessor: body.accessor,
      action: 'read',
      timestamp: Date.now(),
      success: true,
    });

    return c.json({
      secretId: body.secretId,
      name: secret.name,
      value,
      version: body.version ?? secret.version,
    });
  });

  /**
   * Rotate a secret
   */
  app.post('/api/v1/secrets/rotate', async (c) => {
    const body = await c.req.json() as {
      secretId: string;
      newValue: string;
      rotator: string;
    };

    const secret = secretStore.get(body.secretId);
    if (!secret) {
      return c.json({ error: 'Secret not found' }, 404);
    }

    if (secret.owner !== body.rotator) {
      return c.json({ error: 'Only owner can rotate' }, 403);
    }

    const versions = secretVersions.get(body.secretId) ?? [];
    
    // Mark current as rotated
    const currentVersion = versions.find(v => v.status === 'active');
    if (currentVersion) {
      currentVersion.status = 'rotated';
    }

    const newVersion = secret.version + 1;
    const newKeyId = `vault-key-${body.secretId}-v${newVersion}`;
    const { ciphertext, iv, tag } = await encrypt(body.newValue, newKeyId);
    const newEncryptedValue = JSON.stringify({ ciphertext, iv, tag });

    versions.push({
      version: newVersion,
      encryptedValue: newEncryptedValue,
      createdAt: Date.now(),
      status: 'active',
    });

    secret.encryptedValue = newEncryptedValue;
    secret.keyId = newKeyId;
    secret.version = newVersion;
    secret.updatedAt = Date.now();

    accessLogs.push({
      secretId: body.secretId,
      accessor: body.rotator,
      action: 'rotate',
      timestamp: Date.now(),
      success: true,
    });

    return c.json({
      secretId: body.secretId,
      name: secret.name,
      version: newVersion,
      rotatedAt: Date.now(),
    });
  });

  /**
   * List secrets for an owner
   */
  app.get('/api/v1/secrets/list', async (c) => {
    const owner = c.req.query('owner');
    if (!owner) {
      return c.json({ error: 'Owner required' }, 400);
    }

    const secrets = Array.from(secretStore.values())
      .filter(s => s.owner === owner)
      .map(s => ({
        id: s.id,
        name: s.name,
        version: s.version,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        tags: s.tags,
      }));

    return c.json({ secrets });
  });

  /**
   * Get audit logs for a secret
   */
  app.get('/api/v1/secrets/:secretId/audit', async (c) => {
    const secretId = c.req.param('secretId');
    const limit = parseInt(c.req.query('limit') ?? '100');

    const logs = accessLogs
      .filter(l => l.secretId === secretId)
      .slice(-limit);

    return c.json({ logs });
  });

  /**
   * Inject secrets into environment format
   */
  app.post('/api/v1/secrets/inject', async (c) => {
    const body = await c.req.json() as {
      secretIds: string[];
      envMapping: Record<string, string>;
      accessor: string;
    };

    const env: Record<string, string> = {};

    for (const secretId of body.secretIds) {
      const envKey = body.envMapping[secretId];
      if (!envKey) continue;

      const secret = secretStore.get(secretId);
      if (!secret) continue;

      // Check access
      if (secret.owner !== body.accessor) {
        const policy = secretPolicies.get(secretId);
        if (policy?.allowedAddresses && !policy.allowedAddresses.includes(body.accessor)) {
          continue;
        }
      }

      // Decrypt
      const parsed = JSON.parse(secret.encryptedValue) as { ciphertext: string; iv: string; tag: string };
      const value = await decrypt(parsed.ciphertext, parsed.iv, parsed.tag, secret.keyId);
      env[envKey] = value;
    }

    return c.json({ env, count: Object.keys(env).length });
  });

  /**
   * Search encrypted data by metadata
   */
  app.post('/api/v1/encrypted/search', async (c) => {
    const body = await c.req.json() as {
      metadata: Record<string, string>;
      accessor: string;
    };

    const results: Array<{
      keyId: string;
      dataHash: string;
      encryptedAt: number;
      metadata: Record<string, string>;
    }> = [];

    for (const [keyId, payload] of encryptedStore.entries()) {
      // Check if all requested metadata matches
      let matches = true;
      for (const [key, value] of Object.entries(body.metadata)) {
        if (payload.metadata?.[key] !== value) {
          matches = false;
          break;
        }
      }

      if (matches) {
        results.push({
          keyId,
          dataHash: payload.dataHash,
          encryptedAt: payload.encryptedAt,
          metadata: payload.metadata ?? {},
        });
      }
    }

    return c.json({ results });
  });

  /**
   * Health check
   */
  app.get('/api/v1/encrypted/health', (c) => {
    return c.json({
      status: 'healthy',
      encryptedDataCount: encryptedStore.size,
      secretCount: secretStore.size,
      auditLogCount: accessLogs.length,
    });
  });

  return app;
}
