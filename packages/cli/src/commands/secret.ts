/**
 * Jeju Secret Command - Manage environment secrets
 *
 * Like `vercel env` or `wrangler secret`:
 * - jeju secret set KEY value - Set a secret
 * - jeju secret list - List secrets
 * - jeju secret delete KEY - Delete a secret
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
 * Set a secret
 */
async function setSecret(
  appName: string,
  key: string,
  value: string,
  scope: string,
  network: NetworkType,
  authToken: string,
  address: Address,
): Promise<void> {
  const dwsUrl = getDWSUrlForNetwork(network)

  const response = await fetch(`${dwsUrl}/secrets/set`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
      'X-Jeju-Address': address,
    },
    body: JSON.stringify({
      app: appName,
      key,
      value,
      scope,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to set secret: ${error}`)
  }
}

/**
 * List secrets
 */
async function listSecrets(
  appName: string,
  network: NetworkType,
  authToken: string,
  address: Address,
): Promise<Secret[]> {
  const dwsUrl = getDWSUrlForNetwork(network)

  const response = await fetch(`${dwsUrl}/secrets/list?app=${appName}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'X-Jeju-Address': address,
    },
  })

  if (!response.ok) {
    return []
  }

  const data = await response.json()
  return data.secrets ?? []
}

/**
 * Delete a secret
 */
async function deleteSecret(
  appName: string,
  key: string,
  network: NetworkType,
  authToken: string,
  address: Address,
): Promise<void> {
  const dwsUrl = getDWSUrlForNetwork(network)

  const response = await fetch(`${dwsUrl}/secrets/delete`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
      'X-Jeju-Address': address,
    },
    body: JSON.stringify({
      app: appName,
      key,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to delete secret: ${error}`)
  }
}

/**
 * Get a secret value (for pulling to local)
 */
async function getSecretValue(
  appName: string,
  key: string,
  network: NetworkType,
  authToken: string,
  address: Address,
): Promise<string | null> {
  const dwsUrl = getDWSUrlForNetwork(network)

  const response = await fetch(
    `${dwsUrl}/secrets/get?app=${appName}&key=${key}`,
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Jeju-Address': address,
      },
    },
  )

  if (!response.ok) {
    return null
  }

  const data = await response.json()
  return data.value ?? null
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

    logger.step(`Setting ${key}...`)

    await setSecret(
      appName,
      key,
      secretValue,
      options.scope,
      network,
      credentials.authToken,
      credentials.address as Address,
    )

    logger.success(`Secret ${key} set for ${appName}`)
    logger.info(`Scope: ${options.scope}`)
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

      logger.step(`Setting ${key}...`)

      await setSecret(
        appName,
        key,
        value,
        options.scope,
        network,
        credentials.authToken,
        credentials.address as Address,
      )

      pushed++
    }

    logger.success(`Pushed ${pushed} secrets from ${options.input}`)
    logger.info(`Scope: ${options.scope}`)
    logger.newline()
    logger.info('Redeploy to apply: jeju publish')
  })
