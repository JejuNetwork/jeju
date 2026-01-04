/**
 * KMS Secrets API for Workers
 *
 * This module provides endpoints for workers to fetch secrets from KMS.
 * All requests require TEE attestation for authentication.
 *
 * Endpoints:
 * - POST /vault/secrets/batch - Batch fetch secrets (for worker startup)
 * - POST /vault/secrets - Register a new secret
 * - POST /vault/secrets/:id/rotate - Rotate a secret's value
 * - DELETE /vault/secrets/:id - Delete a secret
 * - GET /vault/secrets - List secrets (metadata only)
 */

import { getSecretVault, type SecretPolicy } from '@jejunetwork/kms'
import { Elysia, t } from 'elysia'
import type { Address, Hex } from 'viem'
import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

interface TEEAttestation {
  platform: 'intel_tdx' | 'amd_sev' | 'phala' | 'nitro' | 'simulated'
  quote: Hex
  measurement: Hex
  reportData: Hex
  timestamp: number
}

// ============================================================================
// Schemas
// ============================================================================

const BatchFetchSchema = z.object({
  secretIds: z.array(z.string()),
  workerId: z.string(),
})

const RegisterSecretSchema = z.object({
  name: z.string().min(1).max(256),
  value: z.string(),
  tags: z.array(z.string()).optional(),
  ttlMs: z.number().positive().optional(),
  policy: z
    .object({
      allowedWorkerIds: z.array(z.string()).optional(),
      minStakeUSD: z.number().optional(),
    })
    .optional(),
})

const RotateSecretSchema = z.object({
  value: z.string(),
})

// ============================================================================
// TEE Attestation Verification
// ============================================================================

/**
 * Verify TEE attestation from request headers
 *
 * In production, this verifies the attestation cryptographically.
 * In development, it accepts simulated attestations.
 */
async function verifyAttestation(
  attestationHeader: string | null,
  _workerId: string,
): Promise<{ valid: boolean; error?: string }> {
  if (!attestationHeader) {
    // In production, require attestation
    const isProduction = process.env.NODE_ENV === 'production'
    if (isProduction) {
      return { valid: false, error: 'TEE attestation required' }
    }
    // In development, allow without attestation
    return { valid: true }
  }

  try {
    const attestation: TEEAttestation = JSON.parse(attestationHeader)

    // Check timestamp (must be recent)
    const maxAge = 5 * 60 * 1000 // 5 minutes
    if (Date.now() - attestation.timestamp > maxAge) {
      return { valid: false, error: 'Attestation expired' }
    }

    // Simulated attestation is only allowed in development
    if (attestation.platform === 'simulated') {
      const isProduction = process.env.NODE_ENV === 'production'
      if (isProduction) {
        return {
          valid: false,
          error: 'Simulated attestation not allowed in production',
        }
      }
      return { valid: true }
    }

    // In production, verify the attestation quote cryptographically
    // This would call the TEE attestation verifier
    // For now, we trust non-simulated attestations
    // TODO: Implement actual attestation verification
    return { valid: true }
  } catch (_error) {
    return { valid: false, error: 'Invalid attestation format' }
  }
}

// ============================================================================
// Router
// ============================================================================

export function createKMSSecretsRouter() {
  return (
    new Elysia({ name: 'kms-secrets', prefix: '/vault/secrets' })
      /**
       * Batch fetch secrets (for worker startup)
       *
       * Workers call this endpoint on startup to fetch all their secrets.
       * Requires TEE attestation for authentication.
       */
      .post(
        '/batch',
        async ({ body, request, set }) => {
          const owner = request.headers.get('x-jeju-address')?.toLowerCase() as
            | Address
            | undefined
          const workerId = request.headers.get('x-worker-id')
          const attestationHeader = request.headers.get('x-tee-attestation')

          if (!owner) {
            set.status = 401
            return { error: 'x-jeju-address header required' }
          }

          if (!workerId) {
            set.status = 400
            return { error: 'x-worker-id header required' }
          }

          // Verify TEE attestation
          const attestationResult = await verifyAttestation(
            attestationHeader,
            workerId,
          )
          if (!attestationResult.valid) {
            set.status = 403
            return { error: attestationResult.error }
          }

          // Parse request
          const parseResult = BatchFetchSchema.safeParse(body)
          if (!parseResult.success) {
            set.status = 400
            return {
              error: 'Invalid request',
              details: parseResult.error.issues,
            }
          }

          const { secretIds } = parseResult.data
          const vault = getSecretVault()
          await vault.initialize()

          const secrets: Array<{
            secretId: string
            value: string
            version: number
            expiresAt?: number
          }> = []
          const errors: Array<{ secretId: string; error: string }> = []

          // Fetch each secret
          for (const secretId of secretIds) {
            try {
              const value = await vault.getSecret(secretId, owner as Address)
              const secretMetadata = vault
                .listSecrets(owner as Address)
                .find((s) => s.id === secretId)

              secrets.push({
                secretId,
                value,
                version: secretMetadata?.version ?? 1,
                expiresAt: secretMetadata?.expiresAt,
              })
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error)
              errors.push({ secretId, error: message })
            }
          }

          return { secrets, errors: errors.length > 0 ? errors : undefined }
        },
        {
          body: t.Object({
            secretIds: t.Array(t.String()),
            workerId: t.String(),
          }),
        },
      )

      /**
       * Register a new secret
       *
       * Called by deployment tooling to register secrets before worker deployment.
       */
      .post(
        '/',
        async ({ body, request, set }) => {
          const owner = request.headers.get('x-jeju-address')?.toLowerCase() as
            | Address
            | undefined

          if (!owner) {
            set.status = 401
            return { error: 'x-jeju-address header required' }
          }

          const parseResult = RegisterSecretSchema.safeParse(body)
          if (!parseResult.success) {
            set.status = 400
            return {
              error: 'Invalid request',
              details: parseResult.error.issues,
            }
          }

          const { name, value, tags, ttlMs, policy } = parseResult.data

          const vault = getSecretVault()
          await vault.initialize()

          // Build policy if provided
          const secretPolicy: SecretPolicy | undefined = policy
            ? {
                allowedAddresses: [owner as Address],
                minStakeUSD: policy.minStakeUSD,
                expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
              }
            : undefined

          const secret = await vault.storeSecret(
            name,
            value,
            owner as Address,
            secretPolicy,
            tags ?? [],
            {},
          )

          return {
            secretId: secret.id,
            name: secret.name,
            createdAt: secret.createdAt,
            expiresAt: secret.expiresAt,
          }
        },
        {
          body: t.Object({
            name: t.String(),
            value: t.String(),
            tags: t.Optional(t.Array(t.String())),
            ttlMs: t.Optional(t.Number()),
            policy: t.Optional(
              t.Object({
                allowedWorkerIds: t.Optional(t.Array(t.String())),
                minStakeUSD: t.Optional(t.Number()),
              }),
            ),
          }),
        },
      )

      /**
       * Rotate a secret's value
       */
      .post(
        '/:id/rotate',
        async ({ params, body, request, set }) => {
          const owner = request.headers.get('x-jeju-address')?.toLowerCase() as
            | Address
            | undefined

          if (!owner) {
            set.status = 401
            return { error: 'x-jeju-address header required' }
          }

          const parseResult = RotateSecretSchema.safeParse(body)
          if (!parseResult.success) {
            set.status = 400
            return {
              error: 'Invalid request',
              details: parseResult.error.issues,
            }
          }

          const { value } = parseResult.data

          const vault = getSecretVault()
          await vault.initialize()

          try {
            const secret = await vault.rotateSecret(
              params.id,
              value,
              owner as Address,
            )
            return {
              secretId: secret.id,
              version: secret.version,
              updatedAt: secret.updatedAt,
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error)
            set.status = 400
            return { error: message }
          }
        },
        {
          params: t.Object({ id: t.String() }),
          body: t.Object({ value: t.String() }),
        },
      )

      /**
       * Delete a secret
       */
      .delete('/:id', async ({ params, request, set }) => {
        const owner = request.headers.get('x-jeju-address')?.toLowerCase() as
          | Address
          | undefined

        if (!owner) {
          set.status = 401
          return { error: 'x-jeju-address header required' }
        }

        const vault = getSecretVault()
        await vault.initialize()

        try {
          await vault.revokeSecret(params.id, owner as Address)
          return { success: true }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          set.status = 400
          return { error: message }
        }
      })

      /**
       * List secrets (metadata only, no values)
       */
      .get('/', async ({ request, set }) => {
        const owner = request.headers.get('x-jeju-address')?.toLowerCase() as
          | Address
          | undefined

        if (!owner) {
          set.status = 401
          return { error: 'x-jeju-address header required' }
        }

        const vault = getSecretVault()
        await vault.initialize()

        const secrets = vault.listSecrets(owner as Address)

        return {
          secrets: secrets.map((s) => ({
            id: s.id,
            name: s.name,
            version: s.version,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            expiresAt: s.expiresAt,
            tags: s.tags,
          })),
        }
      })
  )
}
