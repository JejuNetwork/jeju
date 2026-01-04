/**
 * Jeju Secret Command - Manage environment secrets
 *
 * SECURITY: All secrets are stored in KMS (Key Management Service) and
 * retrieved by workers at runtime. Secrets are NEVER embedded in bundles
 * or deployment configurations.
 *
 * Like `vercel env` or `wrangler secret`:
 * - jeju secret set KEY value - Set a secret (stores in KMS)
 * - jeju secret list - List secrets (metadata only, no values)
 * - jeju secret delete KEY - Delete a secret from KMS
 * - jeju secret pull - Pull secrets to local .env for development
 * - jeju secret push - Push local .env to KMS
 *
 * Architecture:
 * 1. Secrets are registered in KMS by this command
 * 2. Workers receive KMS_SECRET_IDS (list of secret IDs, not values)
 * 3. Workers fetch actual values from KMS at runtime using TEE attestation
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDWSUrl, getLocalhostHost } from '@jejunetwork/config'
import { Command } from 'commander'
import type { Address } from 'viem'
import { logger } from '../lib/logger'
import type { AppManifest, NetworkType } from '../types'
import { requireLogin } from './login'

interface Secret {
  key: string
  createdAt: number
  updatedAt: number
  scope: 'production' | 'preview' | 'development' | 'all'
}

/**
 * Get DWS URL for network
 */
function getDWSUrlForNetwork(network: NetworkType): string {
  switch (network) {
    case 'mainnet':
      return process.env.MAINNET_DWS_URL ?? 'https://dws.jejunetwork.org'
    case 'testnet':
      return (
        process.env.TESTNET_DWS_URL ?? 'https://dws.testnet.jejunetwork.org'
      )
    default:
      return (
        process.env.DWS_URL ??
        getDWSUrl() ??
        `http://${getLocalhostHost()}:4020`
      )
  }
}

/**
 * Load manifest from directory
 */
function loadManifest(dir: string): AppManifest | null {
  const manifestPath = join(dir, 'jeju-manifest.json')
  if (!existsSync(manifestPath)) {
    return null
  }
  return JSON.parse(readFileSync(manifestPath, 'utf-8'))
}

/**
 * Set a secret in KMS
 *
 * SECURITY: This stores the secret in the KMS vault, NOT in worker config.
 * Workers will fetch secrets at runtime using their TEE attestation.
 */
async function setSecret(
  appName: string,
  key: string,
  value: string,
  scope: string,
  network: NetworkType,
  authToken: string,
  address: Address,
): Promise<{ secretId: string }> {
  const dwsUrl = getDWSUrlForNetwork(network)

  // Use the KMS vault endpoint to store secrets securely
  const response = await fetch(`${dwsUrl}/vault/secrets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
      'x-jeju-address': address,
    },
    body: JSON.stringify({
      // Secret name includes app scope for namespacing
      name: `${appName}:${key}`,
      value,
      tags: [appName, scope],
      // Policy allows the deployer to access the secret
      policy: {
        allowedWorkerIds: [`${appName}-worker`],
      },
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to set secret: ${error}`)
  }

  const result = (await response.json()) as { secretId: string }
  return result
}

/**
 * List secrets from KMS (metadata only, no values)
 */
async function listSecrets(
  appName: string,
  network: NetworkType,
  authToken: string,
  address: Address,
): Promise<Secret[]> {
  const dwsUrl = getDWSUrlForNetwork(network)

  // Use vault endpoint to list secrets
  const response = await fetch(`${dwsUrl}/vault/secrets`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'x-jeju-address': address,
    },
  })

  if (!response.ok) {
    // For localnet, DWS may not be running
    if (network === 'localnet') {
      return []
    }
    throw new Error(`Failed to list secrets: ${response.statusText}`)
  }

  const data = (await response.json()) as {
    secrets: Array<{
      id: string
      name: string
      version: number
      createdAt: number
      updatedAt: number
      tags?: string[]
    }>
  }

  // Filter to app's secrets and transform to expected format
  return data.secrets
    .filter((s) => s.name.startsWith(`${appName}:`))
    .map((s) => ({
      key: s.name.replace(`${appName}:`, ''),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      scope: (s.tags?.find((t) =>
        ['production', 'preview', 'development', 'all'].includes(t),
      ) ?? 'all') as Secret['scope'],
    }))
}

/**
 * Delete a secret from KMS
 */
async function deleteSecret(
  appName: string,
  key: string,
  network: NetworkType,
  authToken: string,
  address: Address,
): Promise<void> {
  const dwsUrl = getDWSUrlForNetwork(network)

  // First, get the secret ID from the list
  const secrets = await listSecrets(appName, network, authToken, address)
  const secret = secrets.find((s) => s.key === key)

  if (!secret) {
    throw new Error(`Secret ${key} not found for app ${appName}`)
  }

  // Delete from vault using the namespaced name
  const secretName = `${appName}:${key}`
  const response = await fetch(
    `${dwsUrl}/vault/secrets/${encodeURIComponent(secretName)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'x-jeju-address': address,
      },
    },
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to delete secret: ${error}`)
  }
}

/**
 * Get a secret value from KMS (for pulling to local development)
 *
 * SECURITY: This should only be used for local development.
 * In production, workers fetch secrets directly from KMS using TEE attestation.
 */
async function getSecretValue(
  appName: string,
  key: string,
  network: NetworkType,
  authToken: string,
  address: Address,
): Promise<string | null> {
  const dwsUrl = getDWSUrlForNetwork(network)

  // Use batch fetch endpoint to get secret value
  const secretName = `${appName}:${key}`
  const response = await fetch(`${dwsUrl}/vault/secrets/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
      'x-jeju-address': address,
      'x-worker-id': 'cli-pull', // Special worker ID for CLI operations
    },
    body: JSON.stringify({
      secretIds: [secretName],
      workerId: 'cli-pull',
    }),
  })

  if (!response.ok) {
    if (response.status === 404) {
      return null
    }
    throw new Error(`Failed to get secret ${key}: ${response.statusText}`)
  }

  const data = (await response.json()) as {
    secrets: Array<{ secretId: string; value: string }>
    errors?: Array<{ secretId: string; error: string }>
  }

  const secret = data.secrets.find((s) => s.secretId === secretName)
  return secret?.value ?? null
}

export const secretCommand = new Command('secret')
  .description('Manage environment secrets')
  .alias('env')
  .alias('secrets')

// Set secret
secretCommand
  .command('set <key> [value]')
  .description('Set an environment secret')
  .option('--app <name>', 'App name (default: from manifest)')
  .option(
    '--scope <scope>',
    'Secret scope: production, preview, development, all',
    'all',
  )
  .action(async (key, value, options) => {
    const credentials = requireLogin()
    const network = credentials.network as NetworkType
    const cwd = process.cwd()

    // Get app name
    let appName = options.app
    if (!appName) {
      const manifest = loadManifest(cwd)
      appName = manifest?.name
    }

    if (!appName) {
      logger.error('App name required. Use --app or create jeju-manifest.json')
      return
    }

    // If no value provided, read from stdin
    let secretValue = value
    if (!secretValue) {
      logger.info(`Enter value for ${key}:`)
      const chunks: Buffer[] = []
      for await (const chunk of process.stdin) {
        chunks.push(chunk)
      }
      secretValue = Buffer.concat(chunks).toString().trim()
    }

    if (!secretValue) {
      logger.error('Secret value required')
      return
    }

    // Validate key format
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      logger.warn('Secret keys should be UPPER_SNAKE_CASE')
    }

    logger.step(`Setting ${key} in KMS...`)

    const result = await setSecret(
      appName,
      key,
      secretValue,
      options.scope,
      network,
      credentials.authToken,
      credentials.address as Address,
    )

    logger.success(`Secret ${key} stored in KMS for ${appName}`)
    logger.info(`Secret ID: ${result.secretId}`)
    logger.info(`Scope: ${options.scope}`)
    logger.newline()
    logger.info('SECURITY: Secret is stored in KMS, not in worker config')
    logger.info('Workers fetch secrets at runtime using TEE attestation')
    logger.newline()
    logger.info('Redeploy to apply: jeju publish')
  })

// List secrets
secretCommand
  .command('list')
  .description('List all secrets')
  .alias('ls')
  .option('--app <name>', 'App name (default: from manifest)')
  .action(async (options) => {
    const credentials = requireLogin()
    const network = credentials.network as NetworkType
    const cwd = process.cwd()

    // Get app name
    let appName = options.app
    if (!appName) {
      const manifest = loadManifest(cwd)
      appName = manifest?.name
    }

    if (!appName) {
      logger.error('App name required. Use --app or create jeju-manifest.json')
      return
    }

    logger.header('SECRETS')
    logger.info(`App: ${appName}`)
    logger.newline()

    const secrets = await listSecrets(
      appName,
      network,
      credentials.authToken,
      credentials.address as Address,
    )

    if (secrets.length === 0) {
      logger.info('No secrets configured')
      logger.info('Run `jeju secret set KEY value` to add one')
      return
    }

    console.log(`${'  KEY'.padEnd(30) + 'SCOPE'.padEnd(15)}UPDATED`)
    console.log(`  ${'-'.repeat(55)}`)

    for (const secret of secrets) {
      const key = secret.key.padEnd(28)
      const scope = secret.scope.padEnd(13)
      const updated = new Date(secret.updatedAt).toLocaleDateString()

      console.log(`  ${key} ${scope} ${updated}`)
    }

    logger.newline()
  })

// Delete secret
secretCommand
  .command('delete <key>')
  .description('Delete a secret')
  .alias('rm')
  .option('--app <name>', 'App name (default: from manifest)')
  .option('-f, --force', 'Skip confirmation')
  .action(async (key, options) => {
    const credentials = requireLogin()
    const network = credentials.network as NetworkType
    const cwd = process.cwd()

    // Get app name
    let appName = options.app
    if (!appName) {
      const manifest = loadManifest(cwd)
      appName = manifest?.name
    }

    if (!appName) {
      logger.error('App name required. Use --app or create jeju-manifest.json')
      return
    }

    if (!options.force) {
      logger.warn(`This will delete secret: ${key}`)
      logger.info('Run with --force to confirm')
      return
    }

    logger.step(`Deleting ${key}...`)

    await deleteSecret(
      appName,
      key,
      network,
      credentials.authToken,
      credentials.address as Address,
    )

    logger.success(`Secret ${key} deleted`)
  })

// Pull secrets to local .env
secretCommand
  .command('pull')
  .description('Pull secrets to local .env file')
  .option('--app <name>', 'App name (default: from manifest)')
  .option('-o, --output <file>', 'Output file', '.env.local')
  .action(async (options) => {
    const credentials = requireLogin()
    const network = credentials.network as NetworkType
    const cwd = process.cwd()

    // Get app name
    let appName = options.app
    if (!appName) {
      const manifest = loadManifest(cwd)
      appName = manifest?.name
    }

    if (!appName) {
      logger.error('App name required. Use --app or create jeju-manifest.json')
      return
    }

    logger.step('Pulling secrets...')

    const secrets = await listSecrets(
      appName,
      network,
      credentials.authToken,
      credentials.address as Address,
    )

    if (secrets.length === 0) {
      logger.info('No secrets to pull')
      return
    }

    // Fetch each secret value
    const envLines: string[] = [
      '# Pulled from Jeju Network',
      `# App: ${appName}`,
      `# Date: ${new Date().toISOString()}`,
      '',
    ]

    for (const secret of secrets) {
      const value = await getSecretValue(
        appName,
        secret.key,
        network,
        credentials.authToken,
        credentials.address as Address,
      )

      if (value !== null) {
        // Quote value if it contains special characters
        const needsQuotes = /[\s"'$`\\]/.test(value)
        const quotedValue = needsQuotes
          ? `"${value.replace(/"/g, '\\"')}"`
          : value
        envLines.push(`${secret.key}=${quotedValue}`)
      }
    }

    const outputPath = join(cwd, options.output)
    await Bun.write(outputPath, `${envLines.join('\n')}\n`)

    logger.success(`Pulled ${secrets.length} secrets to ${options.output}`)
    logger.warn('Add this file to .gitignore to keep secrets safe')
  })

// Push local .env to secrets
secretCommand
  .command('push')
  .description('Push local .env file to secrets')
  .option('--app <name>', 'App name (default: from manifest)')
  .option('-i, --input <file>', 'Input file', '.env.local')
  .option(
    '--scope <scope>',
    'Secret scope: production, preview, development, all',
    'development',
  )
  .action(async (options) => {
    const credentials = requireLogin()
    const network = credentials.network as NetworkType
    const cwd = process.cwd()

    // Get app name
    let appName = options.app
    if (!appName) {
      const manifest = loadManifest(cwd)
      appName = manifest?.name
    }

    if (!appName) {
      logger.error('App name required. Use --app or create jeju-manifest.json')
      return
    }

    const inputPath = join(cwd, options.input)
    if (!existsSync(inputPath)) {
      logger.error(`File not found: ${options.input}`)
      return
    }

    const content = readFileSync(inputPath, 'utf-8')
    const lines = content.split('\n')

    let pushed = 0
    const secretIds: string[] = []
    for (const line of lines) {
      // Skip comments and empty lines
      if (!line || line.startsWith('#')) continue

      // Parse KEY=value
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (!match) continue

      const [, key, rawValue] = match

      // Remove quotes if present
      let value = rawValue
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }

      logger.step(`Storing ${key} in KMS...`)

      const result = await setSecret(
        appName,
        key,
        value,
        options.scope,
        network,
        credentials.authToken,
        credentials.address as Address,
      )

      secretIds.push(`${key}:${result.secretId}`)
      pushed++
    }

    logger.success(`Pushed ${pushed} secrets to KMS from ${options.input}`)
    logger.info(`Scope: ${options.scope}`)
    logger.newline()
    logger.info(
      'SECURITY: Secrets stored in KMS, not embedded in worker config',
    )
    logger.info('Secret IDs registered:')
    for (const id of secretIds) {
      logger.info(`  - ${id}`)
    }
    logger.newline()
    logger.info('Redeploy to apply: jeju publish')
  })
