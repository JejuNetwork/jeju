/**
 * Jeju Login Command - Wallet-based authentication
 *
 * Like Vercel CLI login, but using wallet signatures instead of OAuth.
 * Stores encrypted credentials in ~/.jeju/credentials
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDWSUrl, getLocalhostHost } from '@jejunetwork/config'
import { bytesToHex, randomBytes } from '@jejunetwork/shared'
import { Command } from 'commander'
import { type Address, verifyMessage } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'
import { getDefaultDeployerKey } from '../lib/keys'
import { logger } from '../lib/logger'
import type { NetworkType } from '../types'

// Schema for stored credentials
const CredentialsSchema = z.object({
  version: z.literal(1),
  network: z.enum(['localnet', 'testnet', 'mainnet']),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  encryptedKey: z.string().optional(), // Only for non-hardware wallets
  keyType: z.enum(['privateKey', 'hardware', 'external']),
  authToken: z.string(), // JWT-like token from DWS
  createdAt: z.number(),
  expiresAt: z.number(),
})

export type Credentials = z.infer<typeof CredentialsSchema>

// Config directory
const JEJU_CONFIG_DIR = join(homedir(), '.jeju')
const CREDENTIALS_FILE = join(JEJU_CONFIG_DIR, 'credentials.json')

function ensureConfigDir(): void {
  if (!existsSync(JEJU_CONFIG_DIR)) {
    mkdirSync(JEJU_CONFIG_DIR, { mode: 0o700 })
  }
}

function getCredentialsPath(): string {
  return CREDENTIALS_FILE
}

export function loadCredentials(): Credentials | null {
  const path = getCredentialsPath()
  if (!existsSync(path)) return null

  const content = readFileSync(path, 'utf-8')
  const parsed = CredentialsSchema.safeParse(JSON.parse(content))

  if (!parsed.success) {
    logger.warn('Invalid credentials file, please login again')
    return null
  }

  // Check expiration
  if (parsed.data.expiresAt < Date.now()) {
    logger.warn('Session expired, please login again')
    return null
  }

  return parsed.data
}

function saveCredentials(credentials: Credentials): void {
  ensureConfigDir()
  writeFileSync(getCredentialsPath(), JSON.stringify(credentials, null, 2), {
    mode: 0o600,
  })
}

function clearCredentials(): void {
  const path = getCredentialsPath()
  if (existsSync(path)) {
    writeFileSync(path, '{}', { mode: 0o600 })
  }
}

/**
 * Get the current logged-in address
 */
export function getCurrentAddress(network?: NetworkType): Address | null {
  const credentials = loadCredentials()
  if (!credentials) return null

  // Check network match if specified
  if (network && credentials.network !== network) {
    return null
  }

  return credentials.address as Address
}

/**
 * Require login - throws if not logged in
 */
export function requireLogin(network?: NetworkType): Credentials {
  const credentials = loadCredentials()
  if (!credentials) {
    throw new Error(
      'Not logged in. Run `jeju login` to authenticate with your wallet.',
    )
  }

  if (network && credentials.network !== network) {
    throw new Error(
      `Logged in to ${credentials.network}, but ${network} is required. Run \`jeju login --network ${network}\``,
    )
  }

  return credentials
}

/**
 * Authenticate with DWS using wallet signature
 */
async function authenticateWithDWS(
  address: Address,
  signature: string,
  message: string,
  network: NetworkType,
): Promise<{ token: string; expiresAt: number }> {
  const dwsUrl =
    process.env.DWS_URL ?? getDWSUrl() ?? `http://${getLocalhostHost()}:4020`

  const response = await fetch(`${dwsUrl}/auth/wallet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address,
      signature,
      message,
      network,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Authentication failed: ${error}`)
  }

  const result = await response.json()
  return {
    token: result.token,
    expiresAt: result.expiresAt ?? Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days default
  }
}

export const loginCommand = new Command('login')
  .description('Authenticate with Jeju Network using your wallet')
  .option('-n, --network <network>', 'Network to authenticate with', 'testnet')
  .option(
    '-k, --private-key <key>',
    'Private key (or use DEPLOYER_PRIVATE_KEY env)',
  )
  .option('--hardware', 'Use hardware wallet (Ledger/Trezor)')
  .option('--external', 'Sign externally (outputs message to sign)')
  .action(async (options) => {
    logger.header('JEJU LOGIN')

    const network = options.network as NetworkType
    if (!['localnet', 'testnet', 'mainnet'].includes(network)) {
      logger.error(`Invalid network: ${network}`)
      return
    }

    // Check if already logged in
    const existing = loadCredentials()
    if (existing && existing.network === network) {
      logger.info(`Already logged in as ${existing.address}`)
      logger.info(`Network: ${existing.network}`)
      logger.info(
        `Expires: ${new Date(existing.expiresAt).toLocaleDateString()}`,
      )
      logger.newline()
      logger.info(
        'Run `jeju logout` to sign out, or `jeju login` again to re-authenticate.',
      )
      return
    }

    // Determine authentication method
    if (options.hardware) {
      logger.error('Hardware wallet authentication is not supported.')
      logger.info('Alternatives:')
      logger.info('  - Use --external to sign with your hardware wallet manually')
      logger.info('  - Export private key and use --private-key (not recommended)')
      process.exit(1)
    }

    if (options.external) {
      // External signing - output message for user to sign elsewhere
      const nonce = bytesToHex(randomBytes(32))
      const timestamp = Date.now()
      const message = `Sign this message to authenticate with Jeju Network.\n\nNetwork: ${network}\nNonce: ${nonce}\nTimestamp: ${timestamp}`

      logger.info('Sign the following message with your wallet:\n')
      console.log('---')
      console.log(message)
      console.log('---\n')

      logger.info('Then run:')
      logger.info(
        `jeju login --network ${network} --signature <your-signature> --address <your-address>`,
      )
      return
    }

    // Get private key
    let privateKey: `0x${string}`

    if (options.privateKey) {
      privateKey = options.privateKey as `0x${string}`
    } else if (process.env.DEPLOYER_PRIVATE_KEY) {
      privateKey = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`
    } else {
      // Try to get from keystore
      try {
        const key = getDefaultDeployerKey(network)
        privateKey = key.privateKey as `0x${string}`
      } catch {
        logger.error('No private key provided.')
        logger.info('Options:')
        logger.info('  - Set DEPLOYER_PRIVATE_KEY environment variable')
        logger.info('  - Pass --private-key flag')
        logger.info('  - Use --external to sign manually')
        logger.info('  - Run `jeju keys generate` to create a new keypair')
        return
      }
    }

    // Validate private key format
    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
      logger.error('Invalid private key format')
      return
    }

    const account = privateKeyToAccount(privateKey)
    const address = account.address

    logger.step(`Authenticating as ${address}...`)
    logger.info(`Network: ${network}`)

    // Create auth message
    const nonce = bytesToHex(randomBytes(32))
    const timestamp = Date.now()
    const message = `Sign this message to authenticate with Jeju Network.\n\nNetwork: ${network}\nNonce: ${nonce}\nTimestamp: ${timestamp}`

    // Sign message
    const signature = await account.signMessage({ message })

    // Verify locally first
    const isValid = await verifyMessage({
      address,
      message,
      signature,
    })

    if (!isValid) {
      logger.error('Signature verification failed')
      return
    }

    // Authenticate with DWS
    let authResult: { token: string; expiresAt: number }

    // For localnet, create a local token (DWS may not be running)
    if (network === 'localnet') {
      authResult = {
        token: `local-${address}-${timestamp}`,
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year for local
      }
      logger.info('Using local authentication (no DWS server required)')
    } else {
      authResult = await authenticateWithDWS(
        address,
        signature,
        message,
        network,
      )
    }

    // Save credentials (don't encrypt private key for now, use env var pattern)
    const credentials: Credentials = {
      version: 1,
      network,
      address,
      keyType: 'privateKey',
      authToken: authResult.token,
      createdAt: Date.now(),
      expiresAt: authResult.expiresAt,
    }

    saveCredentials(credentials)

    logger.success(`Logged in as ${address}`)
    logger.info(`Network: ${network}`)
    logger.info(
      `Session expires: ${new Date(authResult.expiresAt).toLocaleDateString()}`,
    )
    logger.newline()
    logger.info('Run `jeju account` to view your account details')
    logger.info('Run `jeju logout` to sign out')
  })

export const logoutCommand = new Command('logout')
  .description('Sign out of Jeju Network')
  .action(() => {
    const credentials = loadCredentials()
    if (!credentials) {
      logger.info('Not currently logged in')
      return
    }

    clearCredentials()
    logger.success(`Logged out from ${credentials.address}`)
  })

export const whoamiCommand = new Command('whoami')
  .description('Display current authenticated user')
  .action(() => {
    const credentials = loadCredentials()
    if (!credentials) {
      logger.info('Not logged in')
      logger.info('Run `jeju login` to authenticate')
      return
    }

    logger.header('JEJU WHOAMI')
    logger.keyValue('Address', credentials.address)
    logger.keyValue('Network', credentials.network)
    logger.keyValue('Key Type', credentials.keyType)
    logger.keyValue(
      'Expires',
      new Date(credentials.expiresAt).toLocaleDateString(),
    )

    const daysRemaining = Math.ceil(
      (credentials.expiresAt - Date.now()) / (24 * 60 * 60 * 1000),
    )
    if (daysRemaining < 7) {
      logger.warn(
        `Session expires in ${daysRemaining} days. Run \`jeju login\` to refresh.`,
      )
    }
  })
