/**
 * Manifest Signing - GPG-style signing for deployment manifests
 *
 * SECURITY: Provides integrity verification for manifests to prevent:
 * - Tampered manifests in CI/CD pipelines
 * - Unauthorized modifications to deployment configurations
 * - Supply chain attacks on deployment artifacts
 *
 * Uses secp256k1 ECDSA signatures (Ethereum-compatible) for signing.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  type Address,
  keccak256,
  recoverMessageAddress,
  stringToBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'
import { keyAudit } from './key-audit'
import { logger } from './logger'

// ============================================================================
// Schemas
// ============================================================================

/** Signed manifest schema */
export const SignedManifestSchema = z.object({
  manifest: z.record(z.string(), z.unknown()),
  signature: z.object({
    signer: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
    timestamp: z.string(),
    version: z.literal('1.0'),
    algorithm: z.literal('secp256k1-keccak256'),
  }),
  metadata: z
    .object({
      signedBy: z.string().optional(),
      purpose: z.string().optional(),
      network: z.string().optional(),
    })
    .optional(),
})
export type SignedManifest = z.infer<typeof SignedManifestSchema>

/** Trusted signers list schema */
export const TrustedSignersSchema = z.object({
  signers: z.array(
    z.object({
      address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      name: z.string().min(1).max(100),
      role: z.enum(['deployer', 'admin', 'ci']),
      addedAt: z.string(),
    }),
  ),
  requireSignature: z.boolean(),
  minimumSignatures: z.number().int().min(1).max(10).optional(),
})
export type TrustedSigners = z.infer<typeof TrustedSignersSchema>

// ============================================================================
// Signing Functions
// ============================================================================

/**
 * Sign a manifest with a private key
 *
 * @param manifest - The manifest object to sign
 * @param privateKey - Hex-encoded private key (0x...)
 * @param metadata - Optional metadata about the signing
 * @returns Signed manifest with signature
 */
export async function signManifest(
  manifest: Record<string, unknown>,
  privateKey: `0x${string}`,
  metadata?: {
    signedBy?: string
    purpose?: string
    network?: string
  },
): Promise<SignedManifest> {
  const account = privateKeyToAccount(privateKey)

  // Canonicalize manifest for consistent hashing
  const canonicalManifest = canonicalizeJSON(manifest)
  const manifestHash = keccak256(stringToBytes(canonicalManifest))

  // Create signing message with context
  const timestamp = new Date().toISOString()
  const signingMessage = createSigningMessage(manifestHash, timestamp)

  // Sign the message
  const signature = await account.signMessage({ message: signingMessage })

  // AUDIT: Log signature creation
  const fingerprint = getManifestFingerprint(manifest)
  keyAudit.logSignatureCreated(
    account.address,
    metadata?.network ?? 'unknown',
    metadata?.purpose ?? 'manifest signing',
    fingerprint,
  )

  return {
    manifest,
    signature: {
      signer: account.address,
      signature,
      timestamp,
      version: '1.0',
      algorithm: 'secp256k1-keccak256',
    },
    metadata,
  }
}

/**
 * Verify a signed manifest
 *
 * @param signedManifest - The signed manifest to verify
 * @param trustedSigners - Optional list of trusted signer addresses
 * @returns Verification result with recovered signer
 */
export async function verifyManifest(
  signedManifest: SignedManifest,
  trustedSigners?: Address[],
): Promise<{
  valid: boolean
  signer: Address
  error?: string
}> {
  const { manifest, signature } = signedManifest

  // Verify signature version
  if (signature.version !== '1.0') {
    return {
      valid: false,
      signer: signature.signer as Address,
      error: `Unsupported signature version: ${signature.version}`,
    }
  }

  // Reconstruct the hash
  const canonicalManifest = canonicalizeJSON(manifest)
  const manifestHash = keccak256(stringToBytes(canonicalManifest))

  // Reconstruct signing message
  const signingMessage = createSigningMessage(manifestHash, signature.timestamp)

  // Recover signer from signature
  let recoveredAddress: Address
  try {
    recoveredAddress = await recoverMessageAddress({
      message: signingMessage,
      signature: signature.signature as `0x${string}`,
    })
  } catch (error) {
    return {
      valid: false,
      signer: signature.signer as Address,
      error: `Failed to recover signer: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }

  // Verify recovered address matches claimed signer
  if (recoveredAddress.toLowerCase() !== signature.signer.toLowerCase()) {
    return {
      valid: false,
      signer: recoveredAddress,
      error: `Signer mismatch: recovered ${recoveredAddress}, claimed ${signature.signer}`,
    }
  }

  // Check if signer is trusted (if list provided)
  if (trustedSigners && trustedSigners.length > 0) {
    const isTrusted = trustedSigners.some(
      (addr) => addr.toLowerCase() === recoveredAddress.toLowerCase(),
    )
    if (!isTrusted) {
      return {
        valid: false,
        signer: recoveredAddress,
        error: `Signer ${recoveredAddress} is not in trusted signers list`,
      }
    }
  }

  // Check timestamp is not too old (7 days max by default)
  const signedAt = new Date(signature.timestamp)
  const maxAge = 7 * 24 * 60 * 60 * 1000 // 7 days in ms
  if (Date.now() - signedAt.getTime() > maxAge) {
    return {
      valid: false,
      signer: recoveredAddress,
      error: `Signature expired: signed at ${signature.timestamp}`,
    }
  }

  return {
    valid: true,
    signer: recoveredAddress,
  }
}

/**
 * Sign a manifest file and write the signed version
 *
 * @param manifestPath - Path to the manifest file
 * @param privateKey - Private key for signing
 * @param outputPath - Optional output path (defaults to .signed.json suffix)
 */
export async function signManifestFile(
  manifestPath: string,
  privateKey: `0x${string}`,
  outputPath?: string,
  metadata?: {
    signedBy?: string
    purpose?: string
    network?: string
  },
): Promise<string> {
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest file not found: ${manifestPath}`)
  }

  const manifestContent = readFileSync(manifestPath, 'utf-8')
  const manifest = JSON.parse(manifestContent) as Record<string, unknown>

  const signedManifest = await signManifest(manifest, privateKey, metadata)

  const output = outputPath ?? manifestPath.replace(/\.json$/, '.signed.json')
  writeFileSync(output, JSON.stringify(signedManifest, null, 2))

  logger.success(`Signed manifest written to: ${output}`)
  return output
}

/**
 * Verify a signed manifest file
 *
 * @param signedManifestPath - Path to the signed manifest file
 * @param trustedSignersPath - Optional path to trusted signers config
 */
export async function verifyManifestFile(
  signedManifestPath: string,
  trustedSignersPath?: string,
): Promise<{
  valid: boolean
  signer: Address
  manifest: Record<string, unknown>
  error?: string
}> {
  if (!existsSync(signedManifestPath)) {
    throw new Error(`Signed manifest file not found: ${signedManifestPath}`)
  }

  const content = readFileSync(signedManifestPath, 'utf-8')
  const rawData = JSON.parse(content) as unknown

  const parseResult = SignedManifestSchema.safeParse(rawData)
  if (!parseResult.success) {
    throw new Error(
      `Invalid signed manifest format: ${parseResult.error.message}`,
    )
  }

  const signedManifest = parseResult.data

  // Load trusted signers if path provided
  let trustedSigners: Address[] = []
  if (trustedSignersPath && existsSync(trustedSignersPath)) {
    const signersContent = readFileSync(trustedSignersPath, 'utf-8')
    const signersData = JSON.parse(signersContent) as unknown
    const signersResult = TrustedSignersSchema.safeParse(signersData)
    if (signersResult.success) {
      trustedSigners = signersResult.data.signers.map(
        (s) => s.address as Address,
      )
    }
  }

  const result = await verifyManifest(signedManifest, trustedSigners)

  return {
    ...result,
    manifest: signedManifest.manifest,
  }
}

/**
 * Load manifest with optional signature verification
 *
 * For production/mainnet deployments, signature verification is required.
 * For localnet/testnet, it's optional but logged.
 *
 * @param manifestPath - Path to manifest (will also check for .signed.json)
 * @param options - Verification options
 */
export async function loadVerifiedManifest(
  manifestPath: string,
  options: {
    requireSignature?: boolean
    network?: 'localnet' | 'testnet' | 'mainnet'
    trustedSignersPath?: string
  } = {},
): Promise<{
  manifest: Record<string, unknown>
  signed: boolean
  signer?: Address
}> {
  const signedPath = manifestPath.replace(/\.json$/, '.signed.json')

  // Check for signed manifest first
  if (existsSync(signedPath)) {
    const result = await verifyManifestFile(
      signedPath,
      options.trustedSignersPath,
    )

    if (!result.valid) {
      if (options.requireSignature || options.network === 'mainnet') {
        throw new Error(
          `Manifest signature verification failed: ${result.error}`,
        )
      }
      logger.warn(`Manifest signature invalid: ${result.error}`)
      logger.warn(
        'Proceeding without verified signature (not recommended for production)',
      )
    } else {
      logger.success(`Manifest verified, signed by: ${result.signer}`)
    }

    return {
      manifest: result.manifest,
      signed: result.valid,
      signer: result.signer,
    }
  }

  // No signed manifest found
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`)
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<
    string,
    unknown
  >

  // Require signature for mainnet
  if (options.requireSignature || options.network === 'mainnet') {
    throw new Error(
      `Signed manifest required for ${options.network ?? 'this'} deployment. ` +
        `Run: jeju manifest sign ${manifestPath}`,
    )
  }

  if (options.network === 'testnet') {
    logger.warn('Using unsigned manifest for testnet deployment')
    logger.info(`Consider signing with: jeju manifest sign ${manifestPath}`)
  }

  return {
    manifest,
    signed: false,
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a deterministic signing message
 */
function createSigningMessage(manifestHash: string, timestamp: string): string {
  return `Jeju Manifest Signature v1.0\n\nManifest Hash: ${manifestHash}\nTimestamp: ${timestamp}\n\nI authorize this deployment manifest.`
}

/**
 * Canonicalize JSON for consistent hashing
 * Sorts object keys recursively and removes undefined values
 */
function canonicalizeJSON(obj: unknown): string {
  return JSON.stringify(obj, (_, value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return value
    }
    // Sort object keys
    return Object.keys(value)
      .sort()
      .reduce(
        (sorted, key) => {
          sorted[key] = value[key]
          return sorted
        },
        {} as Record<string, unknown>,
      )
  })
}

/**
 * Generate a fingerprint for a manifest (for display purposes)
 */
export function getManifestFingerprint(
  manifest: Record<string, unknown>,
): string {
  const canonical = canonicalizeJSON(manifest)
  const hash = createHash('sha256').update(canonical).digest('hex')
  return hash.slice(0, 16).toUpperCase()
}
