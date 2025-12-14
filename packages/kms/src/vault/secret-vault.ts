/**
 * SecretVault - Encrypted secret storage with access control and audit logging
 */

import { keccak256, toBytes, toHex, type Address, type Hex } from 'viem';
import { kmsLogger as log } from '../logger.js';

export interface Secret {
  id: string;
  name: string;
  encryptedValue: string;
  keyId: string;
  version: number;
  owner: Address;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  tags: string[];
  metadata: Record<string, string>;
}

export interface SecretVersion {
  version: number;
  encryptedValue: string;
  keyId: string;
  createdAt: number;
  rotatedAt?: number;
  status: 'active' | 'rotated' | 'revoked';
}

export interface SecretPolicy {
  allowedAddresses?: Address[];
  allowedRoles?: string[];
  minStake?: bigint;
  expiresAt?: number;
  maxAccessCount?: number;
  rotationInterval?: number;
}

export interface SecretAccessLog {
  secretId: string;
  accessor: Address;
  action: 'read' | 'write' | 'rotate' | 'revoke';
  timestamp: number;
  success: boolean;
  reason?: string;
}

export interface VaultConfig {
  encryptionKeyId?: string;
  daEndpoint?: string;
  auditLogging: boolean;
  autoRotateInterval?: number;
}

export class SecretVault {
  private config: VaultConfig;
  private secrets = new Map<string, Secret>();
  private versions = new Map<string, SecretVersion[]>();
  private policies = new Map<string, SecretPolicy>();
  private accessLogs: SecretAccessLog[] = [];
  private encryptionKey: Uint8Array;
  private initialized = false;

  constructor(config: Partial<VaultConfig> = {}) {
    this.config = { auditLogging: true, ...config };
    const secret = process.env.VAULT_ENCRYPTION_SECRET ?? process.env.KMS_FALLBACK_SECRET;
    if (secret) {
      this.encryptionKey = toBytes(keccak256(toBytes(secret)));
    } else {
      this.encryptionKey = crypto.getRandomValues(new Uint8Array(32));
      log.warn('No VAULT_ENCRYPTION_SECRET set, using ephemeral key');
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.config.daEndpoint) await this.loadFromDA();
    this.initialized = true;
    log.info('SecretVault initialized');
  }

  async storeSecret(
    name: string,
    value: string,
    owner: Address,
    policy?: SecretPolicy,
    tags: string[] = [],
    metadata: Record<string, string> = {}
  ): Promise<Secret> {
    await this.ensureInitialized();

    const secretId = `secret-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const keyId = this.config.encryptionKeyId ?? `vault-key-${secretId}`;
    const encryptedValue = await this.encrypt(value, keyId);

    const secret: Secret = {
      id: secretId,
      name,
      encryptedValue,
      keyId,
      version: 1,
      owner,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: policy?.expiresAt,
      tags,
      metadata,
    };

    this.secrets.set(secretId, secret);
    this.versions.set(secretId, [{ version: 1, encryptedValue, keyId, createdAt: Date.now(), status: 'active' }]);
    if (policy) this.policies.set(secretId, policy);

    this.logAccess(secretId, owner, 'write', true);
    if (this.config.daEndpoint) await this.persistToDA(secret);

    log.info('Secret stored', { secretId, name, owner });
    return secret;
  }

  async getSecret(secretId: string, accessor: Address): Promise<string> {
    await this.ensureInitialized();

    const secret = this.secrets.get(secretId);
    if (!secret) {
      this.logAccess(secretId, accessor, 'read', false, 'Secret not found');
      throw new Error(`Secret ${secretId} not found`);
    }

    const policy = this.policies.get(secretId);
    if (policy && !await this.checkAccess(secretId, accessor, policy)) {
      this.logAccess(secretId, accessor, 'read', false, 'Access denied');
      throw new Error(`Access denied to secret ${secretId}`);
    }

    if (secret.expiresAt && Date.now() > secret.expiresAt) {
      this.logAccess(secretId, accessor, 'read', false, 'Secret expired');
      throw new Error(`Secret ${secretId} has expired`);
    }

    const value = await this.decrypt(secret.encryptedValue, secret.keyId);
    this.logAccess(secretId, accessor, 'read', true);
    return value;
  }

  async rotateSecret(secretId: string, newValue: string, rotator: Address): Promise<Secret> {
    await this.ensureInitialized();

    const secret = this.secrets.get(secretId);
    if (!secret) {
      this.logAccess(secretId, rotator, 'rotate', false, 'Secret not found');
      throw new Error(`Secret ${secretId} not found`);
    }

    if (secret.owner !== rotator) {
      this.logAccess(secretId, rotator, 'rotate', false, 'Not authorized');
      throw new Error('Only secret owner can rotate');
    }

    const versions = this.versions.get(secretId) ?? [];
    const currentVersion = versions.find(v => v.status === 'active');
    if (currentVersion) {
      currentVersion.status = 'rotated';
      currentVersion.rotatedAt = Date.now();
    }

    const newKeyId = `vault-key-${secretId}-v${secret.version + 1}`;
    const encryptedValue = await this.encrypt(newValue, newKeyId);

    versions.push({ version: secret.version + 1, encryptedValue, keyId: newKeyId, createdAt: Date.now(), status: 'active' });

    secret.encryptedValue = encryptedValue;
    secret.keyId = newKeyId;
    secret.version++;
    secret.updatedAt = Date.now();

    this.logAccess(secretId, rotator, 'rotate', true);
    if (this.config.daEndpoint) await this.persistToDA(secret);

    log.info('Secret rotated', { secretId, newVersion: secret.version });
    return secret;
  }

  async revokeSecret(secretId: string, revoker: Address): Promise<void> {
    await this.ensureInitialized();

    const secret = this.secrets.get(secretId);
    if (!secret) {
      this.logAccess(secretId, revoker, 'revoke', false, 'Secret not found');
      throw new Error(`Secret ${secretId} not found`);
    }

    if (secret.owner !== revoker) {
      this.logAccess(secretId, revoker, 'revoke', false, 'Not authorized');
      throw new Error('Only secret owner can revoke');
    }

    const versions = this.versions.get(secretId) ?? [];
    for (const v of versions) v.status = 'revoked';

    this.secrets.delete(secretId);
    this.logAccess(secretId, revoker, 'revoke', true);
    log.info('Secret revoked', { secretId });
  }

  async getSecretVersion(secretId: string, version: number, accessor: Address): Promise<string> {
    await this.ensureInitialized();

    const versions = this.versions.get(secretId);
    if (!versions) throw new Error(`Secret ${secretId} not found`);

    const versionRecord = versions.find(v => v.version === version);
    if (!versionRecord) throw new Error(`Version ${version} not found for secret ${secretId}`);
    if (versionRecord.status === 'revoked') throw new Error(`Version ${version} has been revoked`);

    const policy = this.policies.get(secretId);
    if (policy && !await this.checkAccess(secretId, accessor, policy)) throw new Error('Access denied');

    return this.decrypt(versionRecord.encryptedValue, versionRecord.keyId);
  }

  async injectSecrets(
    secretIds: string[],
    envMapping: Record<string, string>,
    accessor: Address
  ): Promise<Record<string, string>> {
    await this.ensureInitialized();

    const env: Record<string, string> = {};
    for (const secretId of secretIds) {
      const envKey = envMapping[secretId];
      if (envKey) env[envKey] = await this.getSecret(secretId, accessor);
    }

    log.info('Secrets injected', { count: Object.keys(env).length, accessor });
    return env;
  }

  listSecrets(accessor: Address): Secret[] {
    const accessible: Secret[] = [];

    for (const secret of this.secrets.values()) {
      if (secret.owner === accessor) {
        accessible.push({ ...secret, encryptedValue: '[REDACTED]' });
        continue;
      }
      const policy = this.policies.get(secret.id);
      if (policy?.allowedAddresses?.includes(accessor)) {
        accessible.push({ ...secret, encryptedValue: '[REDACTED]' });
      }
    }

    return accessible;
  }

  getAuditLogs(secretId: string, limit = 100): SecretAccessLog[] {
    return this.accessLogs.filter(l => l.secretId === secretId).slice(-limit);
  }

  updatePolicy(secretId: string, policy: SecretPolicy, updater: Address): void {
    const secret = this.secrets.get(secretId);
    if (!secret) throw new Error(`Secret ${secretId} not found`);
    if (secret.owner !== updater) throw new Error('Only owner can update policy');
    this.policies.set(secretId, policy);
    log.info('Policy updated', { secretId });
  }

  private async checkAccess(secretId: string, accessor: Address, policy: SecretPolicy): Promise<boolean> {
    if (policy.expiresAt && Date.now() > policy.expiresAt) return false;
    if (policy.allowedAddresses && !policy.allowedAddresses.includes(accessor)) return false;
    
    if (policy.maxAccessCount) {
      const accessCount = this.accessLogs.filter(l => l.secretId === secretId && l.accessor === accessor && l.success).length;
      if (accessCount >= policy.maxAccessCount) return false;
    }

    if (policy.minStake !== undefined && policy.minStake > 0n) {
      log.warn('minStake check requires on-chain verification', { secretId, accessor, required: policy.minStake.toString() });
      return false;
    }

    return true;
  }

  private async encrypt(value: string, keyId: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const keyMaterial = toBytes(keccak256(toBytes(`${keyId}:${toHex(this.encryptionKey)}`)));
    const cryptoKey = await crypto.subtle.importKey('raw', keyMaterial, { name: 'AES-GCM' }, false, ['encrypt']);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, new TextEncoder().encode(value));

    const encryptedArray = new Uint8Array(encrypted);
    return JSON.stringify({
      ciphertext: toHex(encryptedArray.slice(0, -16)),
      iv: toHex(iv),
      tag: toHex(encryptedArray.slice(-16)),
    });
  }

  private async decrypt(encryptedValue: string, keyId: string): Promise<string> {
    const { ciphertext, iv, tag } = JSON.parse(encryptedValue) as { ciphertext: string; iv: string; tag: string };
    const keyMaterial = toBytes(keccak256(toBytes(`${keyId}:${toHex(this.encryptionKey)}`)));
    const cryptoKey = await crypto.subtle.importKey('raw', keyMaterial, { name: 'AES-GCM' }, false, ['decrypt']);
    const combined = new Uint8Array([...toBytes(ciphertext as Hex), ...toBytes(tag as Hex)]);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toBytes(iv as Hex) }, cryptoKey, combined);
    return new TextDecoder().decode(decrypted);
  }

  private logAccess(secretId: string, accessor: Address, action: SecretAccessLog['action'], success: boolean, reason?: string): void {
    if (!this.config.auditLogging) return;
    this.accessLogs.push({ secretId, accessor, action, timestamp: Date.now(), success, reason });
    if (this.accessLogs.length > 10000) this.accessLogs.splice(0, this.accessLogs.length - 10000);
  }

  private async loadFromDA(): Promise<{ success: boolean; count: number }> {
    if (!this.config.daEndpoint) return { success: true, count: 0 };

    const response = await fetch(`${this.config.daEndpoint}/api/secrets/list`, { signal: AbortSignal.timeout(5000) })
      .catch((error: Error) => { log.error('DA connection failed', { error: error.message }); return null; });

    if (!response?.ok) return { success: false, count: 0 };

    const data = await response.json() as { secrets: Secret[] };
    for (const secret of data.secrets) this.secrets.set(secret.id, secret);
    log.info('Loaded secrets from DA', { count: data.secrets.length });
    return { success: true, count: data.secrets.length };
  }

  private async persistToDA(secret: Secret): Promise<boolean> {
    if (!this.config.daEndpoint) return true;

    const response = await fetch(`${this.config.daEndpoint}/api/secrets/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret }),
      signal: AbortSignal.timeout(5000),
    }).catch((error: Error) => { log.error('DA persistence failed', { secretId: secret.id, error: error.message }); return null; });

    if (!response?.ok) {
      log.error('Secret not persisted to DA', { secretId: secret.id });
      return false;
    }
    return true;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) await this.initialize();
  }

  getStatus() {
    return {
      initialized: this.initialized,
      secretCount: this.secrets.size,
      auditLogCount: this.accessLogs.length,
      daConfigured: !!this.config.daEndpoint,
    };
  }
}

let vaultInstance: SecretVault | null = null;

export function getSecretVault(config?: Partial<VaultConfig>): SecretVault {
  if (!vaultInstance) {
    vaultInstance = new SecretVault({
      daEndpoint: process.env.DA_ENDPOINT ?? process.env.VAULT_DA_ENDPOINT,
      auditLogging: process.env.VAULT_AUDIT_LOGGING !== 'false',
      ...config,
    });
  }
  return vaultInstance;
}

export function resetSecretVault(): void {
  vaultInstance = null;
}
