#!/usr/bin/env bun
/**
 * Migration script for OAuth3 client secrets
 *
 * This script migrates legacy plaintext client secrets to hashed format.
 * Run this once after updating to the new KMS-based security model.
 *
 * Usage:
 *   bun run scripts/migrate-secrets.ts
 *   bun run scripts/migrate-secrets.ts --dry-run
 */

import { hashClientSecret } from '../api/services/kms'
import { clientState, initializeState } from '../api/services/state'
import type { RegisteredClient } from '../lib/types'

const DRY_RUN = process.argv.includes('--dry-run')

async function migrateClientSecrets() {
  console.log('OAuth3 Client Secret Migration')
  console.log('================================')
  console.log('')

  if (DRY_RUN) {
    console.log('DRY RUN MODE - No changes will be made')
    console.log('')
  }

  // Initialize database
  await initializeState()

  // Get all clients
  const clients = await getAllClients()

  console.log(`Found ${clients.length} clients to check`)
  console.log('')

  let migratedCount = 0
  let skippedCount = 0
  let errorCount = 0

  for (const client of clients) {
    try {
      // Skip if already migrated
      if (client.clientSecretHash) {
        console.log(`✓ ${client.clientId} (${client.name}) - Already migrated`)
        skippedCount++
        continue
      }

      // Skip if no secret (public client)
      if (!client.clientSecret) {
        console.log(`○ ${client.clientId} (${client.name}) - Public client, no secret`)
        skippedCount++
        continue
      }

      console.log(`→ ${client.clientId} (${client.name}) - Migrating...`)

      if (!DRY_RUN) {
        // Hash the existing secret
        const hashedSecret = await hashClientSecret(client.clientSecret)

        // Update client with hashed secret
        const updatedClient: RegisteredClient = {
          ...client,
          clientSecretHash: hashedSecret,
          clientSecret: undefined, // Clear plaintext
        }

        await clientState.save(updatedClient)
        console.log(`  ✓ Migrated successfully`)
      } else {
        console.log(`  [DRY RUN] Would hash and update secret`)
      }

      migratedCount++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.log(`  ✗ Error: ${message}`)
      errorCount++
    }
  }

  console.log('')
  console.log('Migration Summary')
  console.log('=================')
  console.log(`Migrated: ${migratedCount}`)
  console.log(`Skipped:  ${skippedCount}`)
  console.log(`Errors:   ${errorCount}`)

  if (DRY_RUN && migratedCount > 0) {
    console.log('')
    console.log('Run without --dry-run to apply changes')
  }
}

async function getAllClients(): Promise<RegisteredClient[]> {
  // Since clientState.list() might not exist, we need to query directly
  // This is a simplified version - in production, implement proper pagination
  const { getCQLClient } = await import('../api/services/state')

  interface ClientRow {
    client_id: string
    client_secret: string | null
    client_secret_hash: string | null
    name: string
    redirect_uris: string
    allowed_providers: string
    owner: string
    created_at: number
    active: number
    stake: string | null
    reputation: string | null
    moderation: string | null
  }

  const CQL_DATABASE_ID = process.env.CQL_DATABASE_ID ?? 'oauth3'

  try {
    const db = await getCQLClient()
    const result = await db.query<ClientRow>(
      'SELECT * FROM clients WHERE active = 1',
      [],
      CQL_DATABASE_ID,
    )

    return result.rows.map((row) => ({
      clientId: row.client_id,
      clientSecret: row.client_secret as `0x${string}` | undefined,
      clientSecretHash: row.client_secret_hash
        ? JSON.parse(row.client_secret_hash)
        : undefined,
      name: row.name,
      redirectUris: JSON.parse(row.redirect_uris),
      allowedProviders: JSON.parse(row.allowed_providers),
      owner: row.owner as `0x${string}`,
      createdAt: row.created_at,
      active: row.active === 1,
      stake: row.stake ? JSON.parse(row.stake) : undefined,
      reputation: row.reputation ? JSON.parse(row.reputation) : undefined,
      moderation: row.moderation ? JSON.parse(row.moderation) : undefined,
    }))
  } catch (err) {
    console.error('Failed to fetch clients:', err)
    return []
  }
}

// Run migration
migrateClientSecrets()
  .then(() => {
    process.exit(0)
  })
  .catch((err) => {
    console.error('Migration failed:', err)
    process.exit(1)
  })

