/**
 * CI Secrets Store - MPC-backed secrets for CI/CD
 *
 * SECURITY: In production, CI_ENCRYPTION_SECRET should be stored in KMS,
 * not in environment variables.
 */

import { isProductionEnv } from '@jejunetwork/config'
import { getMPCCoordinator } from '@jejunetwork/kms'
import { decryptAesGcm, encryptAesGcm, hash256 } from '@jejunetwork/shared'
import type { Address, Hex } from 'viem'
import { getKMSSecret } from '../shared/kms-secrets'
import type {
  CISecret,
  Environment,
  EnvironmentSecret,
  ProtectionRules,
} from './types'

// Type-safe constants
const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'
const ZERO_HEX_64: Hex = `0x${'0'.repeat(64)}`

/** Generate a mock address from an ID (for testing) */
function mockAddressFromId(id: string): Address {
  const suffix = id.slice(-2).padStart(2, '0')
  return `0x${'0'.repeat(38)}${suffix}` as Address
}

interface SecretsStoreConfig {
  mpcNetwork?: 'localnet' | 'testnet' | 'mainnet'
}

// Module-level storage for encrypted secret values (simulates secure storage)
const secretStorage = new Map<string, string>()

// Cached CI encryption secret from KMS
let cachedCISecret: string | null = null
let ciSecretInitialized = false

async function initializeCISecret(): Promise<void> {
  if (ciSecretInitialized) return
  const secret = await getKMSSecret('ci_encryption')
  if (secret) {
    cachedCISecret = secret
  }
  ciSecretInitialized = true
}

export class CISecretsStore {
  private secrets = new Map<string, CISecret>()
  private environments = new Map<string, Environment>()
  private mpc = getMPCCoordinator()
  private partyCounter = 0

  /**
   * Initialize the store (must be called before using)
   */
  async initialize(): Promise<void> {
    await initializeCISecret()
  }

  /**
   * Derive encryption key from server secret + secretId
   * SECURITY: CI_ENCRYPTION_SECRET should be in KMS, not env vars
   */
  private deriveKey(secretId: string): Uint8Array {
    const isProduction = isProductionEnv()

    if (!cachedCISecret) {
      if (isProduction) {
        throw new Error(
          'CRITICAL: CI encryption secret not found in KMS. Store using: jeju secrets set CI_ENCRYPTION_SECRET <value>',
        )
      }
      // Development only: use distinct dev key that won't match any production key
      console.warn(
        '[CISecretsStore] WARNING: CI encryption secret not set. Using dev-only key.',
      )
      return hash256(`DEV_ONLY_INSECURE_KEY_DO_NOT_USE_IN_PROD:${secretId}`)
    }
    return hash256(`${cachedCISecret}:${secretId}`)
  }

  /**
   * Encrypt a secret value with AES-256-GCM
   */
  private async encryptSecret(
    value: string,
    secretId: string,
  ): Promise<string> {
    const key = this.deriveKey(secretId)
    const valueBytes = new TextEncoder().encode(value)
    const { ciphertext, iv, tag } = await encryptAesGcm(valueBytes, key)
    // Format: iv (12) + tag (16) + ciphertext, base64 encoded
    const combined = new Uint8Array(iv.length + tag.length + ciphertext.length)
    combined.set(iv, 0)
    combined.set(tag, 12)
    combined.set(ciphertext, 28)
    return btoa(String.fromCharCode(...combined))
  }

  /**
   * Decrypt a secret value with AES-256-GCM
   */
  private async decryptSecret(
    encryptedValue: string,
    secretId: string,
  ): Promise<string> {
    const key = this.deriveKey(secretId)
    const binaryStr = atob(encryptedValue)
    const data = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) {
      data[i] = binaryStr.charCodeAt(i)
    }
    const iv = data.subarray(0, 12)
    const tag = data.subarray(12, 28)
    const ciphertext = data.subarray(28)
    const decrypted = await decryptAesGcm(ciphertext, key, iv, tag)
    return new TextDecoder().decode(decrypted)
  }

  async createSecret(
    repoId: Hex,
    name: string,
    value: string,
    _owner: Address,
    environment?: string,
  ): Promise<CISecret> {
    const secretId = `${repoId}-${environment ?? 'repo'}-${name}`

    const partyIds = ['party-1', 'party-2', 'party-3']
    for (const id of partyIds) {
      if (!this.mpc.getActiveParties().find((p) => p.id === id)) {
        this.partyCounter++
        this.mpc.registerParty({
          id,
          index: this.partyCounter,
          endpoint: `http://localhost:${3000 + this.partyCounter}`,
          address: mockAddressFromId(id),
          publicKey: ZERO_HEX_64,
          stake: 1000n,
          registeredAt: Date.now(),
        })
      }
    }

    const keyResult = await this.mpc.generateKey({
      keyId: secretId,
      threshold: 2,
      totalParties: 3,
      partyIds,
      curve: 'secp256k1',
    })

    // Encrypt the value with AES-256-GCM using server secret
    const encryptedValue = await this.encryptSecret(value, secretId)

    const secret: CISecret = {
      secretId,
      repoId,
      name,
      mpcKeyId: keyResult.keyId,
      environment,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.secrets.set(secretId, secret)

    const storageKey = `secret:${secretId}:value`
    secretStorage.set(storageKey, encryptedValue)

    return secret
  }

  async getSecretValue(secretId: string, _accessor: Address): Promise<string> {
    const secret = this.secrets.get(secretId)
    if (!secret) throw new Error(`Secret not found: ${secretId}`)

    const storageKey = `secret:${secretId}:value`
    const encryptedValue = secretStorage.get(storageKey)
    if (!encryptedValue) throw new Error(`Secret value not found: ${secretId}`)

    // Decrypt the value with AES-256-GCM
    return await this.decryptSecret(encryptedValue, secretId)
  }

  async getSecretsForRun(
    repoId: Hex,
    environment: string | undefined,
    accessor: Address,
  ): Promise<Record<string, string>> {
    const result: Record<string, string> = {}

    for (const secret of this.secrets.values()) {
      if (secret.repoId !== repoId) continue
      if (secret.environment && secret.environment !== environment) continue

      result[secret.name] = await this.getSecretValue(secret.secretId, accessor)
    }

    if (environment) {
      const env = this.environments.get(`${repoId}-${environment}`)
      if (env) {
        for (const envSecret of env.secrets) {
          result[envSecret.name] = await this.getSecretValue(
            envSecret.secretId,
            accessor,
          )
        }
      }
    }

    return result
  }

  async updateSecret(
    secretId: string,
    value: string,
    _updater: Address,
  ): Promise<CISecret> {
    const secret = this.secrets.get(secretId)
    if (!secret) throw new Error(`Secret not found: ${secretId}`)

    await this.mpc.rotateKey({ keyId: secret.mpcKeyId, preserveAddress: true })

    // Encrypt the value with AES-256-GCM using server secret
    const encryptedValue = await this.encryptSecret(value, secretId)

    const storageKey = `secret:${secretId}:value`
    secretStorage.set(storageKey, encryptedValue)

    secret.updatedAt = Date.now()
    return secret
  }

  async deleteSecret(secretId: string, _deleter: Address): Promise<void> {
    const secret = this.secrets.get(secretId)
    if (!secret) throw new Error(`Secret not found: ${secretId}`)

    this.mpc.revokeKey(secret.mpcKeyId)
    this.secrets.delete(secretId)

    const storageKey = `secret:${secretId}:value`
    secretStorage.delete(storageKey)
  }

  listSecrets(repoId: Hex, environment?: string): CISecret[] {
    return Array.from(this.secrets.values())
      .filter(
        (s) =>
          s.repoId === repoId &&
          (environment === undefined || s.environment === environment),
      )
      .map((s) => ({ ...s }))
  }

  async createEnvironment(
    repoId: Hex,
    name: string,
    _owner: Address,
    options: {
      url?: string
      protectionRules?: ProtectionRules
      variables?: Record<string, string>
    } = {},
  ): Promise<Environment> {
    const environmentId = `${repoId}-${name}`

    const env: Environment = {
      environmentId,
      repoId,
      name,
      url: options.url,
      protectionRules: options.protectionRules ?? {},
      secrets: [],
      variables: options.variables ?? {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.environments.set(environmentId, env)
    return env
  }

  getEnvironment(repoId: Hex, name: string): Environment | undefined {
    return this.environments.get(`${repoId}-${name}`)
  }

  listEnvironments(repoId: Hex): Environment[] {
    return Array.from(this.environments.values()).filter(
      (e) => e.repoId === repoId,
    )
  }

  async updateEnvironment(
    repoId: Hex,
    name: string,
    updates: Partial<
      Omit<Environment, 'environmentId' | 'repoId' | 'name' | 'createdAt'>
    >,
  ): Promise<Environment> {
    const env = this.environments.get(`${repoId}-${name}`)
    if (!env) throw new Error(`Environment not found: ${name}`)

    if (updates.url !== undefined) env.url = updates.url
    if (updates.protectionRules)
      env.protectionRules = {
        ...env.protectionRules,
        ...updates.protectionRules,
      }
    if (updates.variables)
      env.variables = { ...env.variables, ...updates.variables }
    if (updates.secrets) env.secrets = updates.secrets
    env.updatedAt = Date.now()

    return env
  }

  deleteEnvironment(repoId: Hex, name: string): void {
    const envId = `${repoId}-${name}`
    const env = this.environments.get(envId)
    if (!env) return

    for (const secret of env.secrets) {
      this.deleteSecret(secret.secretId, ZERO_ADDRESS).catch((err: Error) => {
        console.error(
          `[SecretsStore] Failed to delete secret ${secret.secretId}: ${err.message}`,
        )
      })
    }

    this.environments.delete(envId)
  }

  async addEnvironmentSecret(
    repoId: Hex,
    envName: string,
    secretName: string,
    value: string,
    owner: Address,
  ): Promise<EnvironmentSecret> {
    const env = this.environments.get(`${repoId}-${envName}`)
    if (!env) throw new Error(`Environment not found: ${envName}`)

    const secret = await this.createSecret(
      repoId,
      secretName,
      value,
      owner,
      envName,
    )

    const envSecret: EnvironmentSecret = {
      secretId: secret.secretId,
      name: secretName,
      mpcKeyId: secret.mpcKeyId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    env.secrets.push(envSecret)
    env.updatedAt = Date.now()

    return envSecret
  }

  async checkEnvironmentProtection(
    repoId: Hex,
    envName: string,
    requester: Address,
    branch: string,
  ): Promise<{ allowed: boolean; waitTime?: number; reviewers?: Address[] }> {
    const env = this.environments.get(`${repoId}-${envName}`)
    if (!env) return { allowed: true }

    const rules = env.protectionRules

    if (rules.deployBranchPolicy) {
      if (rules.deployBranchPolicy.protectedBranches && branch !== 'main') {
        return { allowed: false }
      }
      if (rules.deployBranchPolicy.customBranches) {
        const allowed = rules.deployBranchPolicy.customBranches.some(
          (pattern) => {
            if (pattern.includes('*')) {
              const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`)
              return regex.test(branch)
            }
            return pattern === branch
          },
        )
        if (!allowed) return { allowed: false }
      }
    }

    if (rules.requiredReviewers && rules.requiredReviewers.length > 0) {
      if (
        rules.preventSelfReview &&
        rules.requiredReviewers.includes(requester)
      ) {
        return {
          allowed: false,
          reviewers: rules.requiredReviewers.filter((r) => r !== requester),
        }
      }
      return { allowed: false, reviewers: rules.requiredReviewers }
    }

    if (rules.waitTimer && rules.waitTimer > 0) {
      return { allowed: true, waitTime: rules.waitTimer }
    }

    return { allowed: true }
  }
}

let secretsStoreInstance: CISecretsStore | null = null

export function getCISecretsStore(
  _config?: SecretsStoreConfig,
): CISecretsStore {
  if (!secretsStoreInstance) {
    secretsStoreInstance = new CISecretsStore()
  }
  return secretsStoreInstance
}

export function resetCISecretsStore(): void {
  secretsStoreInstance = null
}
