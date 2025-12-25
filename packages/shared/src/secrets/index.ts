/**
 * Decentralized Secrets Loader
 *
 * Loads secrets from the KMS SecretVault and injects them into the environment.
 * Supports app-specific secrets, automatic rotation detection, and audit logging.
 */

import { expectValid } from '@jejunetwork/types';
import type { Address, Hex } from 'viem';
import { keccak256, toBytes } from 'viem';
import {
  GetSecretResponseSchema,
  ListSecretsResponseSchema,
  StoreSecretResponseSchema,
} from '../schemas';

export interface SecretsConfig {
  vaultEndpoint: string;
  appName: string;
  accessorAddress: Address;
  privateKey?: Hex;
  timeout?: number;
}

// Re-export SecretMetadata type from schemas
export type { SecretMetadata } from '../schemas';

import type { SecretMetadata } from '../schemas';

export interface SecretsLoader {
  loadAll(): Promise<Record<string, string>>;
  get(secretName: string): Promise<string>;
  store(secretName: string, value: string, tags?: string[]): Promise<SecretMetadata>;
  rotate(secretName: string, newValue: string): Promise<SecretMetadata>;
  list(): Promise<SecretMetadata[]>;
  inject(): Promise<void>;
}

class DecentralizedSecretsLoader implements SecretsLoader {
  private config: Required<Omit<SecretsConfig, 'privateKey'>> & Pick<SecretsConfig, 'privateKey'>;
  private loadedSecrets: Map<string, string> = new Map();
  private initialized = false;

  constructor(config: SecretsConfig) {
    this.config = {
      timeout: 5000,
      ...config,
    };
  }

  async loadAll(): Promise<Record<string, string>> {
    const secrets = await this.list();
    const result: Record<string, string> = {};

    for (const secret of secrets) {
      const value = await this.get(secret.name);
      result[secret.name] = value;
      this.loadedSecrets.set(secret.name, value);
    }

    this.initialized = true;
    return result;
  }

  async get(secretName: string): Promise<string> {
    const secretId = this.getSecretId(secretName);
    const signature = await this.signRequest('get', secretId);

    const response = await fetch(`${this.config.vaultEndpoint}/api/secrets/${secretId}`, {
      headers: {
        'X-Accessor-Address': this.config.accessorAddress,
        'X-Request-Signature': signature,
        'X-App-Name': this.config.appName,
      },
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to get secret ${secretName}: ${response.statusText}`);
    }

    const data = expectValid(
      GetSecretResponseSchema,
      await response.json(),
      `get secret ${secretName} response`,
    );
    return data.value;
  }

  async store(secretName: string, value: string, tags: string[] = []): Promise<SecretMetadata> {
    const signature = await this.signRequest('store', secretName);

    const response = await fetch(`${this.config.vaultEndpoint}/api/secrets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Accessor-Address': this.config.accessorAddress,
        'X-Request-Signature': signature,
        'X-App-Name': this.config.appName,
      },
      body: JSON.stringify({
        name: `${this.config.appName}/${secretName}`,
        value,
        tags: [...tags, this.config.appName],
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to store secret ${secretName}: ${response.statusText}`);
    }

    return expectValid(
      StoreSecretResponseSchema,
      await response.json(),
      `store secret ${secretName} response`,
    );
  }

  async rotate(secretName: string, newValue: string): Promise<SecretMetadata> {
    const secretId = this.getSecretId(secretName);
    const signature = await this.signRequest('rotate', secretId);

    const response = await fetch(`${this.config.vaultEndpoint}/api/secrets/${secretId}/rotate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Accessor-Address': this.config.accessorAddress,
        'X-Request-Signature': signature,
        'X-App-Name': this.config.appName,
      },
      body: JSON.stringify({ value: newValue }),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to rotate secret ${secretName}: ${response.statusText}`);
    }

    const data = expectValid(
      StoreSecretResponseSchema,
      await response.json(),
      `rotate secret ${secretName} response`,
    );

    // Update cached value
    this.loadedSecrets.set(secretName, newValue);

    return data;
  }

  async list(): Promise<SecretMetadata[]> {
    const signature = await this.signRequest('list', this.config.appName);

    const response = await fetch(`${this.config.vaultEndpoint}/api/secrets?app=${this.config.appName}`, {
      headers: {
        'X-Accessor-Address': this.config.accessorAddress,
        'X-Request-Signature': signature,
        'X-App-Name': this.config.appName,
      },
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to list secrets: ${response.statusText}`);
    }

    const data = expectValid(
      ListSecretsResponseSchema,
      await response.json(),
      'list secrets response',
    );
    return data.secrets;
  }

  async inject(): Promise<void> {
    if (!this.initialized) {
      await this.loadAll();
    }

    for (const [name, value] of this.loadedSecrets) {
      // Convert secret name to env var format: my-secret → MY_SECRET
      const envKey = name.toUpperCase().replace(/-/g, '_').replace(/\//g, '_');
      process.env[envKey] = value;
    }

    console.log(`[Secrets] Injected ${this.loadedSecrets.size} secrets into environment`);
  }

  private getSecretId(secretName: string): string {
    return `${this.config.appName}/${secretName}`;
  }

  private async signRequest(action: string, resource: string): Promise<string> {
    if (!this.config.privateKey) {
      return '';
    }

    const message = `${action}:${resource}:${Date.now()}`;
    const hash = keccak256(toBytes(message));
    return hash;
  }
}

// App-specific secrets configuration
export interface AppSecretsConfig {
  required: string[];
  optional: string[];
}

// Validate that all required secrets are present
export function validateSecrets(config: AppSecretsConfig, loaded: Record<string, string>): void {
  const missing = config.required.filter((name) => !loaded[name]);

  if (missing.length > 0) {
    throw new Error(`Missing required secrets: ${missing.join(', ')}`);
  }
}

// Load secrets from environment for local development
export function loadSecretsFromEnv(config: AppSecretsConfig): Record<string, string> {
  const secrets: Record<string, string> = {};

  for (const name of [...config.required, ...config.optional]) {
    const envKey = name.toUpperCase().replace(/-/g, '_');
    const value = process.env[envKey];
    if (value) {
      secrets[name] = value;
    }
  }

  return secrets;
}

// Singleton loader per app
const loaders = new Map<string, SecretsLoader>();

export function getSecretsLoader(appName: string): SecretsLoader {
  const existing = loaders.get(appName);
  if (existing) return existing;

  const vaultEndpoint = process.env.VAULT_ENDPOINT ?? process.env.DA_ENDPOINT ?? 'http://localhost:4010';
  const accessorAddress = (process.env.ACCESSOR_ADDRESS ?? process.env.DEPLOYER_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address;
  const privateKey = process.env.PRIVATE_KEY as Hex | undefined;

  const loader = new DecentralizedSecretsLoader({
    vaultEndpoint,
    appName,
    accessorAddress,
    privateKey,
    timeout: parseInt(process.env.SECRETS_TIMEOUT ?? '5000', 10),
  });

  loaders.set(appName, loader);
  return loader;
}

export function resetSecretsLoaders(): void {
  loaders.clear();
}

/**
 * Initialize app secrets from vault or environment
 *
 * @param appName - The app name (e.g., 'leaderboard', 'council')
 * @param config - Required and optional secrets configuration
 * @returns Loaded secrets
 */
export async function initializeSecrets(
  appName: string,
  config: AppSecretsConfig
): Promise<Record<string, string>> {
  // Check if vault is configured
  const vaultEndpoint = process.env.VAULT_ENDPOINT ?? process.env.DA_ENDPOINT;

  if (vaultEndpoint && process.env.USE_VAULT !== 'false') {
    console.log(`[Secrets] Loading from vault for ${appName}`);

    const loader = getSecretsLoader(appName);
    const secrets = await loader.loadAll();
    validateSecrets(config, secrets);
    await loader.inject();

    return secrets;
  }

  // Fall back to environment variables
  console.log(`[Secrets] Loading from environment for ${appName}`);
  const secrets = loadSecretsFromEnv(config);
  validateSecrets(config, secrets);

  return secrets;
}
