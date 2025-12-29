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

import type { Address, Hex } from 'viem'
import { hashClientSecret } from '../api/services/kms'
import { initializeState } from '../api/services/state'
import type { AuthProvider, HashedClientSecret } from '../lib/types'

const DRY_RUN = process.argv.includes('--dry-run')

/**
 * Legacy client type for migration - includes plaintext clientSecret
 * that is being migrated to clientSecretHash
 */
interface LegacyClient {
  clientId: string
  /** Plaintext secret (to be migrated) */
  clientSecret: Hex | undefined
  /** Hashed secret (migration target) */
  clientSecretHash: HashedClientSecret | undefined
  name: string
  redirectUris: string[]
  allowedProviders: AuthProvider[]
  owner: Address
  createdAt: number
  active: boolean
}

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
  const clients = await getAllLegacyClients()

  console.log(`Found ${clients.length} clients to check`)
  console.log('')

  let migratedCount = 0
  let skippedCount = 0
  let errorCount = 0

  for (const client of clients) {
    const result = await migrateClient(client)
    switch (result) {
      case 'migrated':
        migratedCount++
        break
      case 'skipped':
        skippedCount++
        break
      case 'error':
        errorCount++
        break
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

async function migrateClient(
  client: LegacyClient,
): Promise<'migrated' | 'skipped' | 'error'> {
  // Skip if already migrated
  if (client.clientSecretHash) {
    console.log(`✓ ${client.clientId} (${client.name}) - Already migrated`)
    return 'skipped'
  }

  // Skip if no secret (public client)
  if (!client.clientSecret) {
    console.log(
      `○ ${client.clientId} (${client.name}) - Public client, no secret`,
    )
    return 'skipped'
  }

  console.log(`→ ${client.clientId} (${client.name}) - Migrating...`)

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would hash and update secret`)
    return 'migrated'
  }

  // Hash the existing secret and update database
  const hashedSecret = await hashClientSecret(client.clientSecret)
  await updateClientSecret(client.clientId, hashedSecret)
  console.log(`  ✓ Migrated successfully`)
  return 'migrated'
}

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
}

async function getAllLegacyClients(): Promise<LegacyClient[]> {
  const { getEQLiteClient } = await import('../api/services/state')

  const EQLITE_DATABASE_ID = process.env.EQLITE_DATABASE_ID ?? 'oauth3'

  const db = await getEQLiteClient()
  const result = await db.query<ClientRow>(
    'SELECT * FROM clients WHERE active = 1',
    [],
    EQLITE_DATABASE_ID,
  )

  return result.rows.map((row) => ({
    clientId: row.client_id,
    clientSecret: (row.client_secret as Hex) || undefined,
    clientSecretHash: row.client_secret_hash
      ? (JSON.parse(row.client_secret_hash) as HashedClientSecret)
      : undefined,
    name: row.name,
    redirectUris: JSON.parse(row.redirect_uris) as string[],
    allowedProviders: JSON.parse(row.allowed_providers) as AuthProvider[],
    owner: row.owner as Address,
    createdAt: row.created_at,
    active: row.active === 1,
  }))
}

async function updateClientSecret(
  clientId: string,
  hashedSecret: HashedClientSecret,
): Promise<void> {
  const { getEQLiteClient } = await import('../api/services/state')
  const EQLITE_DATABASE_ID = process.env.EQLITE_DATABASE_ID ?? 'oauth3'

  const db = await getEQLiteClient()
  await db.exec(
    `UPDATE clients SET client_secret_hash = ?, client_secret = NULL WHERE client_id = ?`,
    [JSON.stringify(hashedSecret), clientId],
    EQLITE_DATABASE_ID,
  )
}

// Run migration
migrateClientSecrets()
  .then(() => {
    process.exit(0)
  })
  .catch((err: Error) => {
    console.error('Migration failed:', err)
    process.exit(1)
  })

