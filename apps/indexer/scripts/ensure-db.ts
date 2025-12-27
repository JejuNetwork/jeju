/**
 * Ensures the indexer database is ready for development.
 * - Starts PostgreSQL container if not running
 * - Creates the indexer database
 * - Applies migrations
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'

const CONTAINER_NAME = 'squid-db-1'
const _DB_PORT = 23798
const DB_NAME = 'indexer'

async function isContainerRunning(): Promise<boolean> {
  const result = await $`docker ps -q -f name=${CONTAINER_NAME}`
    .nothrow()
    .quiet()
  return result.exitCode === 0 && result.stdout.toString().trim().length > 0
}

async function isPostgresReady(): Promise<boolean> {
  const result = await $`docker exec ${CONTAINER_NAME} pg_isready -U postgres`
    .nothrow()
    .quiet()
  return result.exitCode === 0
}

async function startContainer(): Promise<boolean> {
  // Check if container exists but is stopped
  const stoppedResult = await $`docker ps -aq -f name=${CONTAINER_NAME}`
    .nothrow()
    .quiet()

  if (stoppedResult.stdout.toString().trim()) {
    console.log('Starting existing postgres container...')
    const startResult = await $`docker start ${CONTAINER_NAME}`
      .nothrow()
      .quiet()
    return startResult.exitCode === 0
  }

  // Start via docker-compose
  console.log('Starting postgres container via docker-compose...')
  const composeResult = await $`docker compose up -d`.nothrow().quiet()
  return composeResult.exitCode === 0
}

async function createIndexerDatabase(): Promise<void> {
  const checkResult =
    await $`docker exec ${CONTAINER_NAME} psql -U postgres -lqt`
      .nothrow()
      .quiet()
  const databases = checkResult.stdout.toString()

  if (!databases.includes(DB_NAME)) {
    console.log('Creating indexer database...')
    await $`docker exec ${CONTAINER_NAME} psql -U postgres -c "CREATE DATABASE ${DB_NAME};"`
      .nothrow()
      .quiet()
    console.log('Database created.')
  }
}

async function applyMigrations(): Promise<boolean> {
  const rootDir = join(import.meta.dir, '..')
  const migrationsDir = join(rootDir, 'db/migrations')

  if (!existsSync(migrationsDir)) {
    console.log('No migrations directory found, skipping migrations.')
    return true
  }

  const files = await Bun.file(migrationsDir).exists()
  if (!files) {
    return true
  }

  console.log('Applying database migrations...')
  const result = await $`bunx squid-typeorm-migration-apply`.nothrow().quiet()

  if (result.exitCode !== 0) {
    // Try generating migrations first
    console.log('Migrations failed, attempting to generate schema...')
    await $`bunx sqd migration:generate`.nothrow().quiet()
    const retryResult = await $`bunx squid-typeorm-migration-apply`
      .nothrow()
      .quiet()
    return retryResult.exitCode === 0
  }

  return true
}

async function main(): Promise<void> {
  console.log('Ensuring indexer database is ready...')

  // Check if container is running
  if (await isContainerRunning()) {
    console.log('Postgres container already running.')
  } else {
    const started = await startContainer()
    if (!started) {
      console.error('Failed to start postgres container.')
      process.exit(1)
    }
  }

  // Wait for postgres to be ready
  console.log('Waiting for postgres to be ready...')
  for (let i = 0; i < 30; i++) {
    if (await isPostgresReady()) {
      break
    }
    await Bun.sleep(1000)
    if (i === 29) {
      console.error('Postgres failed to become ready.')
      process.exit(1)
    }
  }

  // Create the indexer database
  await createIndexerDatabase()

  // Apply migrations
  const migrationsOk = await applyMigrations()
  if (!migrationsOk) {
    console.warn('Warning: Migrations may not have applied correctly.')
  }

  console.log('Database ready.')
}

await main()
