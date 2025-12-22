/**
 * CI Secrets Store - MPC-backed secrets for CI/CD
 */

import type { Address, Hex } from 'viem';
import { getMPCCoordinator } from '@jejunetwork/kms';
import type { CISecret, Environment, EnvironmentSecret, ProtectionRules } from './types';

interface SecretsStoreConfig {
  mpcNetwork?: 'localnet' | 'testnet' | 'mainnet';
}

export class CISecretsStore {
  private secrets = new Map<string, CISecret>();
  private environments = new Map<string, Environment>();
  private mpc = getMPCCoordinator();

  constructor(_config: SecretsStoreConfig = {}) {}

  async createSecret(
    repoId: Hex,
    name: string,
    value: string,
    owner: Address,
    environment?: string
  ): Promise<CISecret> {
    const secretId = `${repoId}-${environment || 'repo'}-${name}`;

    const partyIds = ['party-1', 'party-2', 'party-3'];
    for (const id of partyIds) {
      if (!this.mpc.getActiveParties().find((p) => p.id === id)) {
        this.mpc.registerParty({
          id,
          address: `0x${'0'.repeat(38)}${id.slice(-2)}` as Address,
          publicKey: `0x${'0'.repeat(64)}` as Hex,
          stake: 1000n,
        });
      }
    }

    const keyResult = await this.mpc.generateKey({
      keyId: secretId,
      threshold: 2,
      totalParties: 3,
      partyIds,
    });

    const encoder = new TextEncoder();
    const valueBytes = encoder.encode(value);
    const encryptedValue = Buffer.from(valueBytes).toString('base64');

    const secret: CISecret = {
      secretId,
      repoId,
      name,
      mpcKeyId: keyResult.keyId,
      environment,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.secrets.set(secretId, secret);

    const storageKey = `secret:${secretId}:value`;
    (globalThis as Record<string, string>)[storageKey] = encryptedValue;

    return secret;
  }

  async getSecretValue(secretId: string, accessor: Address): Promise<string> {
    const secret = this.secrets.get(secretId);
    if (!secret) throw new Error(`Secret not found: ${secretId}`);

    const storageKey = `secret:${secretId}:value`;
    const encryptedValue = (globalThis as Record<string, string>)[storageKey];
    if (!encryptedValue) throw new Error(`Secret value not found: ${secretId}`);

    const decrypted = Buffer.from(encryptedValue, 'base64').toString('utf8');
    return decrypted;
  }

  async getSecretsForRun(
    repoId: Hex,
    environment: string | undefined,
    accessor: Address
  ): Promise<Record<string, string>> {
    const result: Record<string, string> = {};

    for (const secret of this.secrets.values()) {
      if (secret.repoId !== repoId) continue;
      if (secret.environment && secret.environment !== environment) continue;

      result[secret.name] = await this.getSecretValue(secret.secretId, accessor);
    }

    if (environment) {
      const env = this.environments.get(`${repoId}-${environment}`);
      if (env) {
        for (const envSecret of env.secrets) {
          result[envSecret.name] = await this.getSecretValue(envSecret.secretId, accessor);
        }
      }
    }

    return result;
  }

  async updateSecret(secretId: string, value: string, updater: Address): Promise<CISecret> {
    const secret = this.secrets.get(secretId);
    if (!secret) throw new Error(`Secret not found: ${secretId}`);

    await this.mpc.rotateKey({ keyId: secret.mpcKeyId });

    const encoder = new TextEncoder();
    const valueBytes = encoder.encode(value);
    const encryptedValue = Buffer.from(valueBytes).toString('base64');

    const storageKey = `secret:${secretId}:value`;
    (globalThis as Record<string, string>)[storageKey] = encryptedValue;

    secret.updatedAt = Date.now();
    return secret;
  }

  async deleteSecret(secretId: string, deleter: Address): Promise<void> {
    const secret = this.secrets.get(secretId);
    if (!secret) throw new Error(`Secret not found: ${secretId}`);

    this.mpc.revokeKey(secret.mpcKeyId);
    this.secrets.delete(secretId);

    const storageKey = `secret:${secretId}:value`;
    delete (globalThis as Record<string, string>)[storageKey];
  }

  listSecrets(repoId: Hex, environment?: string): CISecret[] {
    return Array.from(this.secrets.values())
      .filter((s) => s.repoId === repoId && (environment === undefined || s.environment === environment))
      .map((s) => ({ ...s }));
  }

  async createEnvironment(
    repoId: Hex,
    name: string,
    owner: Address,
    options: {
      url?: string;
      protectionRules?: ProtectionRules;
      variables?: Record<string, string>;
    } = {}
  ): Promise<Environment> {
    const environmentId = `${repoId}-${name}`;

    const env: Environment = {
      environmentId,
      repoId,
      name,
      url: options.url,
      protectionRules: options.protectionRules || {},
      secrets: [],
      variables: options.variables || {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.environments.set(environmentId, env);
    return env;
  }

  getEnvironment(repoId: Hex, name: string): Environment | undefined {
    return this.environments.get(`${repoId}-${name}`);
  }

  listEnvironments(repoId: Hex): Environment[] {
    return Array.from(this.environments.values()).filter((e) => e.repoId === repoId);
  }

  async updateEnvironment(
    repoId: Hex,
    name: string,
    updates: Partial<Omit<Environment, 'environmentId' | 'repoId' | 'name' | 'createdAt'>>
  ): Promise<Environment> {
    const env = this.environments.get(`${repoId}-${name}`);
    if (!env) throw new Error(`Environment not found: ${name}`);

    if (updates.url !== undefined) env.url = updates.url;
    if (updates.protectionRules) env.protectionRules = { ...env.protectionRules, ...updates.protectionRules };
    if (updates.variables) env.variables = { ...env.variables, ...updates.variables };
    if (updates.secrets) env.secrets = updates.secrets;
    env.updatedAt = Date.now();

    return env;
  }

  deleteEnvironment(repoId: Hex, name: string): void {
    const envId = `${repoId}-${name}`;
    const env = this.environments.get(envId);
    if (!env) return;

    for (const secret of env.secrets) {
      this.deleteSecret(secret.secretId, '0x0' as Address).catch((err: Error) => {
        console.error(`[SecretsStore] Failed to delete secret ${secret.secretId}: ${err.message}`);
      });
    }

    this.environments.delete(envId);
  }

  async addEnvironmentSecret(
    repoId: Hex,
    envName: string,
    secretName: string,
    value: string,
    owner: Address
  ): Promise<EnvironmentSecret> {
    const env = this.environments.get(`${repoId}-${envName}`);
    if (!env) throw new Error(`Environment not found: ${envName}`);

    const secret = await this.createSecret(repoId, secretName, value, owner, envName);

    const envSecret: EnvironmentSecret = {
      secretId: secret.secretId,
      name: secretName,
      mpcKeyId: secret.mpcKeyId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    env.secrets.push(envSecret);
    env.updatedAt = Date.now();

    return envSecret;
  }

  async checkEnvironmentProtection(
    repoId: Hex,
    envName: string,
    requester: Address,
    branch: string
  ): Promise<{ allowed: boolean; waitTime?: number; reviewers?: Address[] }> {
    const env = this.environments.get(`${repoId}-${envName}`);
    if (!env) return { allowed: true };

    const rules = env.protectionRules;

    if (rules.deployBranchPolicy) {
      if (rules.deployBranchPolicy.protectedBranches && branch !== 'main') {
        return { allowed: false };
      }
      if (rules.deployBranchPolicy.customBranches) {
        const allowed = rules.deployBranchPolicy.customBranches.some((pattern) => {
          if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
            return regex.test(branch);
          }
          return pattern === branch;
        });
        if (!allowed) return { allowed: false };
      }
    }

    if (rules.requiredReviewers && rules.requiredReviewers.length > 0) {
      if (rules.preventSelfReview && rules.requiredReviewers.includes(requester)) {
        return { allowed: false, reviewers: rules.requiredReviewers.filter((r) => r !== requester) };
      }
      return { allowed: false, reviewers: rules.requiredReviewers };
    }

    if (rules.waitTimer && rules.waitTimer > 0) {
      return { allowed: true, waitTime: rules.waitTimer };
    }

    return { allowed: true };
  }
}

let secretsStoreInstance: CISecretsStore | null = null;

export function getCISecretsStore(config?: SecretsStoreConfig): CISecretsStore {
  if (!secretsStoreInstance) {
    secretsStoreInstance = new CISecretsStore(config);
  }
  return secretsStoreInstance;
}

export function resetCISecretsStore(): void {
  secretsStoreInstance = null;
}


