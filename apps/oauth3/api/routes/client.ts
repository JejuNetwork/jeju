/**
 * Client registration routes with staking, reputation, and moderation
 *
 * SECURITY: Client secrets are hashed before storage.
 * - Plaintext secret returned only ONCE at registration
 * - Stored as hash + salt (argon2id/PBKDF2)
 * - Verification via constant-time comparison
 */

import { Elysia, t } from 'elysia'
import type { Address, Hex } from 'viem'
import { isAddress, toHex, verifyMessage } from 'viem'
import type {
  AuthConfig,
  AuthProvider,
  RegisteredClient,
  ReportCategory,
} from '../../lib/types'
import {
  CLIENT_TIER_THRESHOLDS,
  ClientTier,
  ReportCategory as ReportCategoryEnum,
} from '../../lib/types'
import { hashClientSecret } from '../services/kms'
import { checkReputation } from '../services/reputation'
import { verifyStake } from '../services/staking'
import { clientReportState, clientState } from '../services/state'

/**
 * Verify ownership of a client via signed message.
 * The owner must sign a message proving they control the owner address.
 */
async function verifyOwnership(
  client: RegisteredClient,
  headers: Record<string, string | undefined>,
): Promise<{ valid: boolean; error?: string }> {
  const signature = headers['x-jeju-signature']
  const timestamp = headers['x-jeju-timestamp']
  const address = headers['x-jeju-address']

  if (!signature || !timestamp || !address) {
    return { valid: false, error: 'missing_auth_headers' }
  }

  // Verify the address matches the client owner
  if (address.toLowerCase() !== client.owner.toLowerCase()) {
    return { valid: false, error: 'not_owner' }
  }

  // Timestamp must be within 5 minutes
  const timestampMs = parseInt(timestamp, 10)
  if (
    Number.isNaN(timestampMs) ||
    Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000
  ) {
    return { valid: false, error: 'timestamp_expired' }
  }

  // Verify signature
  const message = `Authorize client management for ${client.clientId} at ${timestamp}`
  const valid = await verifyMessage({
    address: address as Address,
    message,
    signature: signature as Hex,
  })

  if (!valid) {
    return { valid: false, error: 'invalid_signature' }
  }

  return { valid: true }
}

const AuthProviderValues = [
  'wallet',
  'farcaster',
  'github',
  'google',
  'twitter',
  'discord',
  'apple',
  'email',
  'phone',
] as const

const RegisterClientBodySchema = t.Object({
  name: t.String(),
  redirectUris: t.Array(t.String()),
  allowedProviders: t.Optional(
    t.Array(t.Union(AuthProviderValues.map((p) => t.Literal(p)))),
  ),
  owner: t.String({ pattern: '^0x[a-fA-F0-9]{40}$' }),
  /** Optional: request a specific tier (requires matching stake) */
  requestedTier: t.Optional(t.Number({ minimum: 0, maximum: 3 })),
})

/** Valid report categories */
const VALID_REPORT_CATEGORIES = Object.values(ReportCategoryEnum)

const UpdateClientBodySchema = t.Object({
  name: t.Optional(t.String()),
  redirectUris: t.Optional(t.Array(t.String())),
  allowedProviders: t.Optional(
    t.Array(t.Union(AuthProviderValues.map((p) => t.Literal(p)))),
  ),
  active: t.Optional(t.Boolean()),
})

export function createClientRouter(_config: AuthConfig) {
  return (
    new Elysia({ name: 'client', prefix: '/client' })
      .post(
        '/register',
        async ({ body, set }) => {
          if (!isAddress(body.owner)) {
            set.status = 400
            return { error: 'invalid_owner_address' }
          }

          const owner: Address = body.owner

          // Verify reputation
          const reputationCheck = await checkReputation(owner)
          if (reputationCheck.isBanned) {
            set.status = 403
            return {
              error: 'owner_banned',
              error_description:
                'This address is banned from registering clients',
            }
          }

          if (!reputationCheck.hasMinReputation) {
            set.status = 403
            return {
              error: 'insufficient_reputation',
              error_description: reputationCheck.error,
              score: reputationCheck.score,
            }
          }

          // Verify staking
          const stakeResult = await verifyStake(owner)
          if (!stakeResult.valid) {
            set.status = 400
            return {
              error: 'stake_verification_failed',
              error_description: stakeResult.error,
            }
          }

          // Check if requested tier matches stake
          const requestedTier = (body.requestedTier ??
            ClientTier.FREE) as ClientTier
          const actualTier = stakeResult.stake?.tier ?? ClientTier.FREE

          if (requestedTier > actualTier) {
            const requiredStake = CLIENT_TIER_THRESHOLDS[requestedTier]
            set.status = 400
            return {
              error: 'insufficient_stake',
              error_description: `Requested tier ${requestedTier} requires stake of ${requiredStake} wei, but owner has stake tier ${actualTier}`,
              requiredStake: requiredStake.toString(),
              currentStake: stakeResult.stake?.amount.toString() ?? '0',
            }
          }

          const clientId = crypto.randomUUID()
          // Use cryptographically secure random bytes for secret
          const randomBytes = crypto.getRandomValues(new Uint8Array(32))
          const clientSecretPlaintext = toHex(randomBytes) as Hex

          // Hash the secret for secure storage - plaintext only returned once
          const clientSecretHash = await hashClientSecret(clientSecretPlaintext)

          const client: RegisteredClient = {
            clientId,
            // Store hash only, never plaintext
            clientSecretHash,
            name: body.name,
            redirectUris: body.redirectUris,
            allowedProviders: (body.allowedProviders ?? [
              'wallet',
              'farcaster',
              'github',
              'google',
            ]) as AuthProvider[],
            owner: owner,
            createdAt: Date.now(),
            active: true,
            stake: stakeResult.stake,
            reputation: {
              score: reputationCheck.score,
              successfulAuths: 0,
              reportCount: 0,
              lastUpdated: Date.now(),
            },
            moderation: {
              status: 'active',
              activeReports: 0,
            },
          }

          await clientState.save(client)

          // Return plaintext secret ONLY at registration
          // Client must store it securely - it cannot be recovered
          return {
            clientId,
            clientSecret: clientSecretPlaintext, // One-time plaintext
            name: client.name,
            redirectUris: client.redirectUris,
            allowedProviders: client.allowedProviders,
            createdAt: client.createdAt,
            tier: client.stake?.tier ?? ClientTier.FREE,
            reputationScore: client.reputation?.score,
            _warning:
              'Store your client_secret securely. It cannot be recovered.',
          }
        },
        { body: RegisterClientBodySchema },
      )

      .get('/:clientId', async ({ params, set }) => {
        const client = await clientState.get(params.clientId)
        if (!client) {
          set.status = 404
          return { error: 'client_not_found' }
        }

        // Check if suspended and auto-unsuspend if time expired
        if (
          client.moderation?.status === 'suspended' &&
          client.moderation.suspensionEndsAt &&
          client.moderation.suspensionEndsAt < Date.now()
        ) {
          client.moderation.status = 'active'
          client.moderation.suspensionReason = undefined
          client.moderation.suspensionEndsAt = undefined
          await clientState.save(client)
        }

        return {
          clientId: client.clientId,
          name: client.name,
          redirectUris: client.redirectUris,
          allowedProviders: client.allowedProviders,
          owner: client.owner,
          createdAt: client.createdAt,
          active: client.active,
          tier: client.stake?.tier ?? ClientTier.FREE,
          reputationScore: client.reputation?.score,
          moderationStatus: client.moderation?.status ?? 'active',
        }
      })

      .patch(
        '/:clientId',
        async ({ params, body, headers, set }) => {
          const client = await clientState.get(params.clientId)
          if (!client) {
            set.status = 404
            return { error: 'client_not_found' }
          }

          // Verify ownership before allowing modifications
          const ownershipResult = await verifyOwnership(client, headers)
          if (!ownershipResult.valid) {
            set.status = 403
            return { error: ownershipResult.error }
          }

          if (body.name !== undefined) client.name = body.name
          if (body.redirectUris !== undefined)
            client.redirectUris = body.redirectUris
          if (body.allowedProviders !== undefined)
            client.allowedProviders = body.allowedProviders as AuthProvider[]
          if (body.active !== undefined) client.active = body.active

          await clientState.save(client)

          return {
            clientId: client.clientId,
            name: client.name,
            redirectUris: client.redirectUris,
            allowedProviders: client.allowedProviders,
            active: client.active,
          }
        },
        { body: UpdateClientBodySchema },
      )

      .delete('/:clientId', async ({ params, headers, set }) => {
        const client = await clientState.get(params.clientId)
        if (!client) {
          set.status = 404
          return { error: 'client_not_found' }
        }

        // Verify ownership before allowing deletion
        const ownershipResult = await verifyOwnership(client, headers)
        if (!ownershipResult.valid) {
          set.status = 403
          return { error: ownershipResult.error }
        }

        await clientState.delete(params.clientId)
        return { success: true }
      })

      .post('/:clientId/rotate-secret', async ({ params, headers, set }) => {
        const client = await clientState.get(params.clientId)
        if (!client) {
          set.status = 404
          return { error: 'client_not_found' }
        }

        // Verify ownership before allowing secret rotation
        const ownershipResult = await verifyOwnership(client, headers)
        if (!ownershipResult.valid) {
          set.status = 403
          return { error: ownershipResult.error }
        }

        // Generate new secret and hash it
        const randomBytes = crypto.getRandomValues(new Uint8Array(32))
        const newSecretPlaintext = toHex(randomBytes) as Hex
        const newSecretHash = await hashClientSecret(newSecretPlaintext)

        // Store hash only
        client.clientSecretHash = newSecretHash
        await clientState.save(client)

        // Return plaintext ONLY at rotation
        return {
          clientId: client.clientId,
          clientSecret: newSecretPlaintext,
          _warning:
            'Store your new client_secret securely. It cannot be recovered.',
        }
      })

      // ========== Moderation Routes ==========

      .post(
        '/:clientId/report',
        async ({ params, body, headers, set }) => {
          const client = await clientState.get(params.clientId)
          if (!client) {
            set.status = 404
            return { error: 'client_not_found' }
          }

          // Validate category
          if (
            !VALID_REPORT_CATEGORIES.includes(body.category as ReportCategory)
          ) {
            set.status = 400
            return {
              error: 'invalid_category',
              error_description: `Category must be one of: ${VALID_REPORT_CATEGORIES.join(', ')}`,
            }
          }

          // Verify reporter address via signature
          const reporterAddress = headers['x-jeju-address']
          const signature = headers['x-jeju-signature']
          const timestamp = headers['x-jeju-timestamp']

          if (!reporterAddress || !signature || !timestamp) {
            set.status = 401
            return { error: 'missing_auth_headers' }
          }

          if (!isAddress(reporterAddress)) {
            set.status = 400
            return { error: 'invalid_reporter_address' }
          }

          // Verify timestamp
          const timestampMs = parseInt(timestamp, 10)
          if (
            Number.isNaN(timestampMs) ||
            Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000
          ) {
            set.status = 401
            return { error: 'timestamp_expired' }
          }

          // Verify signature
          const message = `Report client ${params.clientId} at ${timestamp}`
          const valid = await verifyMessage({
            address: reporterAddress as Address,
            message,
            signature: signature as Hex,
          })

          if (!valid) {
            set.status = 401
            return { error: 'invalid_signature' }
          }

          // Check reporter reputation (must have minimum to report)
          const reporterRep = await checkReputation(reporterAddress as Address)
          if (!reporterRep.hasMinReputation) {
            set.status = 403
            return {
              error: 'insufficient_reputation',
              error_description:
                'Reporter must have minimum reputation score to file reports',
            }
          }

          // Prevent spam: check if already reported this client recently
          const hasRecentReport = await clientReportState.hasReportedRecently(
            params.clientId,
            reporterAddress,
          )
          if (hasRecentReport) {
            set.status = 429
            return {
              error: 'already_reported',
              error_description:
                'You have already reported this client in the last 24 hours',
            }
          }

          // Create and save the report
          const reportId = crypto.randomUUID()
          await clientReportState.save({
            reportId,
            clientId: params.clientId,
            reporterAddress: reporterAddress.toLowerCase(),
            category: body.category,
            evidence: body.evidence,
            status: 'pending',
            createdAt: Date.now(),
          })

          // Update client moderation info
          const moderation = client.moderation ?? {
            status: 'active' as const,
            activeReports: 0,
          }

          moderation.activeReports++
          moderation.lastReportedAt = Date.now()

          // Auto-flag if too many reports
          if (moderation.activeReports >= 3 && moderation.status === 'active') {
            moderation.status = 'flagged'
          }

          // Auto-suspend if many reports
          if (
            moderation.activeReports >= 5 &&
            moderation.status === 'flagged'
          ) {
            moderation.status = 'suspended'
            moderation.suspensionReason =
              'Auto-suspended due to multiple reports'
            moderation.suspensionEndsAt = Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
          }

          if (client.reputation) {
            client.reputation.reportCount++
          }

          client.moderation = moderation
          await clientState.save(client)

          return {
            reportId,
            status: 'pending',
            message: 'Report submitted successfully',
            clientStatus: moderation.status,
          }
        },
        {
          body: t.Object({
            category: t.String(),
            evidence: t.String({ minLength: 10 }),
          }),
        },
      )

      .get('/:clientId/moderation', async ({ params, set }) => {
        const client = await clientState.get(params.clientId)
        if (!client) {
          set.status = 404
          return { error: 'client_not_found' }
        }

        return {
          clientId: params.clientId,
          status: client.moderation?.status ?? 'active',
          activeReports: client.moderation?.activeReports ?? 0,
          lastReportedAt: client.moderation?.lastReportedAt,
          suspensionReason: client.moderation?.suspensionReason,
          suspensionEndsAt: client.moderation?.suspensionEndsAt,
          reputationScore: client.reputation?.score ?? 5000,
          stakeTier: client.stake?.tier ?? ClientTier.FREE,
        }
      })

      .get('/:clientId/reports', async ({ params, headers, set }) => {
        const client = await clientState.get(params.clientId)
        if (!client) {
          set.status = 404
          return { error: 'client_not_found' }
        }

        // Verify ownership to view reports
        const ownershipResult = await verifyOwnership(client, headers)
        if (!ownershipResult.valid) {
          set.status = 403
          return { error: ownershipResult.error }
        }

        const reports = await clientReportState.getByClient(params.clientId)
        return {
          clientId: params.clientId,
          reports: reports.map((r) => ({
            reportId: r.reportId,
            category: r.category,
            status: r.status,
            createdAt: r.createdAt,
            resolvedAt: r.resolvedAt,
            resolution: r.resolution,
          })),
        }
      })
  )
}
