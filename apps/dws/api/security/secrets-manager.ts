import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import type { Address } from 'viem'
import { z } from 'zod'

export type SecretScope = 'user' | 'project' | 'environment' | 'global'

export type SecretStatus = 'active' | 'rotating' | 'deprecated' | 'deleted'

export interface Secret {
  secretId: string
  name: string
  scope: SecretScope
  scopeId: string // userId, projectId, or envId
  status: SecretStatus

  // Shares (encrypted)
  shares: SecretShare[]
  threshold: number

  // Metadata
  owner: Address
  createdAt: number
  updatedAt: number
  rotatedAt?: number
  expiresAt?: number

  // Audit
  version: number
  lastAccessedAt?: number
  accessCount: number
}

export interface SecretShare {
  nodeId: string
  shareIndex: number
  encryptedShare: string // AES-256-GCM encrypted
  shareHash: string
}

export interface SecretValue {
  value: string
  version: number
}

export interface AuditEntry {
  entryId: string
  secretId: string
  action: 'create' | 'read' | 'update' | 'delete' | 'rotate' | 'share'
  actor: Address
  timestamp: number
  metadata?: Record<string, string>
  success: boolean
  error?: string
}

export interface SecretConfig {
  threshold: number
  totalShares: number
  expirationDays?: number
}

// ============================================================================
// Schemas
// ============================================================================

export const CreateSecretSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  value: z.string().min(1).max(65536),
  scope: z.enum(['user', 'project', 'environment', 'global']),
  scopeId: z.string(),
  expirationDays: z.number().min(1).max(365).optional(),
})

export const UpdateSecretSchema = z.object({
  value: z.string().min(1).max(65536).optional(),
  expirationDays: z.number().min(1).max(365).optional(),
})

// ============================================================================
// Shamir Secret Sharing (Simplified Implementation)
// ============================================================================

/**
 * Split a secret into n shares with threshold k
 * Uses polynomial interpolation over GF(256)
 */
function splitSecret(secret: Buffer, k: number, n: number): Buffer[] {
  if (k > n) throw new Error('Threshold cannot exceed total shares')
  if (k < 2) throw new Error('Threshold must be at least 2')
  if (n > 255) throw new Error('Cannot have more than 255 shares')

  const shares: Buffer[] = []

  for (let i = 0; i < n; i++) {
    shares.push(Buffer.alloc(secret.length + 1))
    shares[i][0] = i + 1 // Share index (1-indexed)
  }

  // For each byte of the secret
  for (let byteIdx = 0; byteIdx < secret.length; byteIdx++) {
    // Generate random coefficients for polynomial
    const coefficients = [secret[byteIdx]]
    for (let j = 1; j < k; j++) {
      coefficients.push(randomBytes(1)[0])
    }

    // Evaluate polynomial at each share index
    for (let shareIdx = 0; shareIdx < n; shareIdx++) {
      const x = shareIdx + 1
      let y = 0

      for (let j = 0; j < k; j++) {
        y ^= gfMultiply(coefficients[j], gfPow(x, j))
      }

      shares[shareIdx][byteIdx + 1] = y
    }
  }

  return shares
}

/**
 * Reconstruct a secret from k shares
 */
function reconstructSecret(shares: Buffer[], k: number): Buffer {
  if (shares.length < k) {
    throw new Error(`Need at least ${k} shares to reconstruct`)
  }

  // Use first k shares
  const usedShares = shares.slice(0, k)
  const secretLength = usedShares[0].length - 1
  const secret = Buffer.alloc(secretLength)

  // Extract x values (share indices)
  const xs = usedShares.map((s) => s[0])

  // For each byte of the secret
  for (let byteIdx = 0; byteIdx < secretLength; byteIdx++) {
    // Extract y values for this byte
    const ys = usedShares.map((s) => s[byteIdx + 1])

    // Lagrange interpolation at x=0
    let result = 0

    for (let i = 0; i < k; i++) {
      let numerator = 1
      let denominator = 1

      for (let j = 0; j < k; j++) {
        if (i !== j) {
          numerator = gfMultiply(numerator, xs[j])
          denominator = gfMultiply(denominator, xs[i] ^ xs[j])
        }
      }

      const lagrange = gfMultiply(numerator, gfInverse(denominator))
      result ^= gfMultiply(ys[i], lagrange)
    }

    secret[byteIdx] = result
  }

  return secret
}

// Galois Field (GF(256)) arithmetic
const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)

// Initialize GF tables
;(function initGF() {
  let x = 1
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x = x << 1
    if (x & 0x100) x ^= 0x11d // x^8 + x^4 + x^3 + x^2 + 1
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255]
  }
})()

function gfMultiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return GF_EXP[GF_LOG[a] + GF_LOG[b]]
}

function gfPow(base: number, exp: number): number {
  if (exp === 0) return 1
  if (base === 0) return 0
  return GF_EXP[(GF_LOG[base] * exp) % 255]
}

function gfInverse(a: number): number {
  if (a === 0) throw new Error('Cannot invert 0')
  return GF_EXP[255 - GF_LOG[a]]
}

// ============================================================================
// Secrets Manager
// ============================================================================

interface SecretNode {
  nodeId: string
  encryptionKey: Buffer
}

export class SecretsManager {
  private secrets = new Map<string, Secret>()
  private secretsByScope = new Map<string, Set<string>>() // scopeId -> secretIds
  private auditLog: AuditEntry[] = []

  private nodes: SecretNode[] = []
  private defaultThreshold = 3
  private defaultTotalShares = 5

  private masterKey: Buffer

  constructor(masterKey?: string) {
    this.masterKey = masterKey ? Buffer.from(masterKey, 'hex') : randomBytes(32)

    // Initialize default nodes
    this.initializeNodes()
  }

  private initializeNodes(): void {
    // In production, these would be actual DWS nodes
    for (let i = 0; i < 5; i++) {
      this.nodes.push({
        nodeId: `node-${i}`,
        encryptionKey: createHash('sha256')
          .update(this.masterKey)
          .update(`node-${i}`)
          .digest(),
      })
    }
  }

  // =========================================================================
  // Secret Lifecycle
  // =========================================================================

  async createSecret(
    owner: Address,
    params: z.infer<typeof CreateSecretSchema>,
    config: Partial<SecretConfig> = {},
  ): Promise<Secret> {
    const secretId = createHash('sha256')
      .update(`${owner}-${params.name}-${Date.now()}`)
      .digest('hex')
      .slice(0, 16)

    const threshold = config.threshold ?? this.defaultThreshold
    const totalShares = config.totalShares ?? this.defaultTotalShares

    // Encrypt the secret value first
    const encryptedValue = this.encryptValue(params.value)

    // Split into shares
    const rawShares = splitSecret(encryptedValue, threshold, totalShares)

    // Encrypt each share with its node's key
    const shares: SecretShare[] = rawShares.map((share, i) => {
      const node = this.nodes[i]
      const encryptedShare = this.encryptShareForNode(share, node)

      return {
        nodeId: node.nodeId,
        shareIndex: i + 1,
        encryptedShare,
        shareHash: createHash('sha256').update(share).digest('hex'),
      }
    })

    const secret: Secret = {
      secretId,
      name: params.name,
      scope: params.scope,
      scopeId: params.scopeId,
      status: 'active',
      shares,
      threshold,
      owner,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: params.expirationDays
        ? Date.now() + params.expirationDays * 24 * 60 * 60 * 1000
        : undefined,
      version: 1,
      accessCount: 0,
    }

    this.secrets.set(secretId, secret)

    // Index by scope
    const scopeSecrets = this.secretsByScope.get(params.scopeId) ?? new Set()
    scopeSecrets.add(secretId)
    this.secretsByScope.set(params.scopeId, scopeSecrets)

    // Audit
    this.logAudit(secretId, 'create', owner, true)

    console.log(
      `[Secrets] Created secret ${params.name} (${secretId}) with ${threshold}/${totalShares} threshold`,
    )

    return secret
  }

  async getSecret(
    secretId: string,
    accessor: Address,
  ): Promise<SecretValue | null> {
    const secret = this.secrets.get(secretId)
    if (!secret) {
      this.logAudit(secretId, 'read', accessor, false, 'Secret not found')
      return null
    }

    // Check authorization
    if (!this.checkAccess(secret, accessor)) {
      this.logAudit(secretId, 'read', accessor, false, 'Unauthorized')
      return null
    }

    // Check expiration
    if (secret.expiresAt && secret.expiresAt < Date.now()) {
      this.logAudit(secretId, 'read', accessor, false, 'Secret expired')
      return null
    }

    // Collect shares
    const shares: Buffer[] = []
    for (const share of secret.shares) {
      if (shares.length >= secret.threshold) break

      const node = this.nodes.find((n) => n.nodeId === share.nodeId)
      if (!node) continue

      const decryptedShare = this.decryptShareFromNode(
        share.encryptedShare,
        node,
      )
      shares.push(decryptedShare)
    }

    if (shares.length < secret.threshold) {
      this.logAudit(secretId, 'read', accessor, false, 'Insufficient shares')
      return null
    }

    // Reconstruct and decrypt
    const encryptedValue = reconstructSecret(shares, secret.threshold)
    const value = this.decryptValue(encryptedValue)

    // Update access stats
    secret.lastAccessedAt = Date.now()
    secret.accessCount++

    this.logAudit(secretId, 'read', accessor, true)

    return {
      value,
      version: secret.version,
    }
  }

  async updateSecret(
    secretId: string,
    owner: Address,
    params: z.infer<typeof UpdateSecretSchema>,
  ): Promise<Secret | null> {
    const secret = this.secrets.get(secretId)
    if (!secret) return null
    if (secret.owner !== owner) {
      this.logAudit(secretId, 'update', owner, false, 'Unauthorized')
      return null
    }

    if (params.value) {
      // Re-share with new value
      const encryptedValue = this.encryptValue(params.value)
      const rawShares = splitSecret(
        encryptedValue,
        secret.threshold,
        secret.shares.length,
      )

      secret.shares = rawShares.map((share, i) => {
        const node = this.nodes[i]
        return {
          nodeId: node.nodeId,
          shareIndex: i + 1,
          encryptedShare: this.encryptShareForNode(share, node),
          shareHash: createHash('sha256').update(share).digest('hex'),
        }
      })

      secret.version++
    }

    if (params.expirationDays) {
      secret.expiresAt =
        Date.now() + params.expirationDays * 24 * 60 * 60 * 1000
    }

    secret.updatedAt = Date.now()

    this.logAudit(secretId, 'update', owner, true)

    return secret
  }

  async rotateSecret(secretId: string, owner: Address): Promise<Secret | null> {
    const secret = this.secrets.get(secretId)
    if (!secret) return null
    if (secret.owner !== owner) return null

    secret.status = 'rotating'

    // Get current value
    const currentValue = await this.getSecret(secretId, owner)
    if (!currentValue) {
      secret.status = 'active'
      return null
    }

    // Re-share with same value (new random polynomial)
    const encryptedValue = this.encryptValue(currentValue.value)
    const rawShares = splitSecret(
      encryptedValue,
      secret.threshold,
      secret.shares.length,
    )

    secret.shares = rawShares.map((share, i) => {
      const node = this.nodes[i]
      return {
        nodeId: node.nodeId,
        shareIndex: i + 1,
        encryptedShare: this.encryptShareForNode(share, node),
        shareHash: createHash('sha256').update(share).digest('hex'),
      }
    })

    secret.version++
    secret.rotatedAt = Date.now()
    secret.updatedAt = Date.now()
    secret.status = 'active'

    this.logAudit(secretId, 'rotate', owner, true)

    console.log(
      `[Secrets] Rotated secret ${secret.name} to version ${secret.version}`,
    )

    return secret
  }

  async deleteSecret(secretId: string, owner: Address): Promise<boolean> {
    const secret = this.secrets.get(secretId)
    if (!secret) return false
    if (secret.owner !== owner) {
      this.logAudit(secretId, 'delete', owner, false, 'Unauthorized')
      return false
    }

    secret.status = 'deleted'
    secret.shares = [] // Clear shares
    secret.updatedAt = Date.now()

    // Remove from scope index
    const scopeSecrets = this.secretsByScope.get(secret.scopeId)
    scopeSecrets?.delete(secretId)

    this.logAudit(secretId, 'delete', owner, true)

    console.log(`[Secrets] Deleted secret ${secret.name}`)

    return true
  }

  // =========================================================================
  // Environment Variables
  // =========================================================================

  async getEnvironmentSecrets(
    scopeId: string,
    accessor: Address,
  ): Promise<Record<string, string>> {
    const secretIds = this.secretsByScope.get(scopeId)
    if (!secretIds) return {}

    const env: Record<string, string> = {}

    for (const secretId of secretIds) {
      const secret = this.secrets.get(secretId)
      if (!secret || secret.status !== 'active') continue

      const value = await this.getSecret(secretId, accessor)
      if (value) {
        env[secret.name] = value.value
      }
    }

    return env
  }

  // =========================================================================
  // Encryption
  // =========================================================================

  private encryptValue(value: string): Buffer {
    const iv = randomBytes(16)
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv)

    let encrypted = cipher.update(value, 'utf8')
    encrypted = Buffer.concat([encrypted, cipher.final()])

    const authTag = cipher.getAuthTag()

    return Buffer.concat([iv, authTag, encrypted])
  }

  private decryptValue(encrypted: Buffer): string {
    const iv = encrypted.subarray(0, 16)
    const authTag = encrypted.subarray(16, 32)
    const data = encrypted.subarray(32)

    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(data)
    decrypted = Buffer.concat([decrypted, decipher.final()])

    return decrypted.toString('utf8')
  }

  private encryptShareForNode(share: Buffer, node: SecretNode): string {
    const iv = randomBytes(16)
    const cipher = createCipheriv('aes-256-gcm', node.encryptionKey, iv)

    let encrypted = cipher.update(share)
    encrypted = Buffer.concat([encrypted, cipher.final()])

    const authTag = cipher.getAuthTag()

    return Buffer.concat([iv, authTag, encrypted]).toString('base64')
  }

  private decryptShareFromNode(
    encryptedShare: string,
    node: SecretNode,
  ): Buffer {
    const data = Buffer.from(encryptedShare, 'base64')

    const iv = data.subarray(0, 16)
    const authTag = data.subarray(16, 32)
    const encrypted = data.subarray(32)

    const decipher = createDecipheriv('aes-256-gcm', node.encryptionKey, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encrypted)
    decrypted = Buffer.concat([decrypted, decipher.final()])

    return decrypted
  }

  // =========================================================================
  // Access Control
  // =========================================================================

  private checkAccess(secret: Secret, accessor: Address): boolean {
    // Owner always has access
    if (secret.owner === accessor) return true

    // Scope-based access would check additional permissions
    // For now, only owner has access
    return false
  }

  // =========================================================================
  // Audit
  // =========================================================================

  private logAudit(
    secretId: string,
    action: AuditEntry['action'],
    actor: Address,
    success: boolean,
    error?: string,
  ): void {
    const entry: AuditEntry = {
      entryId: createHash('sha256')
        .update(`${secretId}-${action}-${Date.now()}-${Math.random()}`)
        .digest('hex')
        .slice(0, 16),
      secretId,
      action,
      actor,
      timestamp: Date.now(),
      success,
      error,
    }

    this.auditLog.push(entry)

    // Keep only last 10000 entries
    if (this.auditLog.length > 10000) {
      this.auditLog.shift()
    }
  }

  getAuditLog(secretId?: string, limit = 100): AuditEntry[] {
    let entries = this.auditLog

    if (secretId) {
      entries = entries.filter((e) => e.secretId === secretId)
    }

    return entries.slice(-limit)
  }

  // =========================================================================
  // Queries
  // =========================================================================

  getSecretMetadata(secretId: string): Omit<Secret, 'shares'> | undefined {
    const secret = this.secrets.get(secretId)
    if (!secret) return undefined

    // Return metadata without shares
    const { shares: _, ...metadata } = secret
    return metadata
  }

  listSecrets(owner: Address): Array<Omit<Secret, 'shares'>> {
    return Array.from(this.secrets.values())
      .filter((s) => s.owner === owner && s.status === 'active')
      .map(({ shares: _, ...metadata }) => metadata)
  }

  listSecretsByScope(scopeId: string): Array<Omit<Secret, 'shares'>> {
    const secretIds = this.secretsByScope.get(scopeId) ?? new Set()

    return Array.from(secretIds)
      .map((id) => this.secrets.get(id))
      .filter((s): s is Secret => s !== undefined && s.status === 'active')
      .map(({ shares: _, ...metadata }) => metadata)
  }
}

// ============================================================================
// Factory
// ============================================================================

let secretsManager: SecretsManager | null = null

export function getSecretsManager(): SecretsManager {
  if (!secretsManager) {
    const masterKey = process.env.SECRETS_MASTER_KEY
    secretsManager = new SecretsManager(masterKey)
  }
  return secretsManager
}
