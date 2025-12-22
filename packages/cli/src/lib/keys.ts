/**
 * Key management utilities
 *
 * Security features:
 * - AES-256-GCM encryption with scrypt key derivation
 * - Secure random key generation
 * - Memory clearing after use
 * - Path traversal protection
 * - Input validation
 * - JSON schema validation for key files
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
} from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { promisify } from 'node:util'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'
import {
  type KeyConfig,
  type KeySet,
  type NetworkType,
  WELL_KNOWN_KEYS,
} from '../types'
import { logger } from './logger'
import { safePath, validateKeyName, validateNetwork } from './security'
import { getKeysDir } from './system'

// Schema validation for key files to prevent insecure deserialization
const KeyConfigSchema = z.object({
  name: z.string().min(1).max(100),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$|^HARDWARE_WALLET$/),
  role: z.string().max(200).optional(),
})

const KeySetSchema = z.object({
  network: z.enum(['localnet', 'testnet', 'mainnet']),
  created: z.string(),
  keys: z.array(KeyConfigSchema),
  encrypted: z.boolean().optional(),
})

const DeployerKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  role: z.string().max(200).optional(),
})

const scryptAsync = promisify(scrypt)

const KEY_LENGTH = 32

export interface OperatorKeySet {
  sequencer: KeyConfig
  batcher: KeyConfig
  proposer: KeyConfig
  challenger: KeyConfig
  admin: KeyConfig
  feeRecipient: KeyConfig
  guardian: KeyConfig
}

export function getDevKeys(): KeyConfig[] {
  return [...WELL_KNOWN_KEYS.dev]
}

export function getDefaultDeployerKey(network: NetworkType): KeyConfig {
  if (network === 'localnet') {
    return WELL_KNOWN_KEYS.dev[0]
  }

  // Validate network to prevent path traversal
  const validNetwork = validateNetwork(network)
  const keysDir = getKeysDir()
  const keyFile = safePath(keysDir, validNetwork, 'deployer.json')

  if (existsSync(keyFile)) {
    const rawData = JSON.parse(readFileSync(keyFile, 'utf-8'))
    // SECURITY: Validate schema to prevent insecure deserialization
    const result = DeployerKeySchema.safeParse(rawData)
    if (!result.success) {
      throw new Error(
        `Invalid deployer key file format: ${result.error.message}`,
      )
    }
    return result.data as KeyConfig
  }

  throw new Error(
    `No deployer key configured for ${validNetwork}. Run: jeju keys genesis -n ${validNetwork}`,
  )
}

export function resolvePrivateKey(network: NetworkType): string {
  // 1. Environment variable
  if (process.env.PRIVATE_KEY) {
    return process.env.PRIVATE_KEY
  }

  // Validate network to prevent path traversal
  const validNetwork = validateNetwork(network)

  // 2. Network-specific key file
  const keysDir = getKeysDir()
  const keyFile = safePath(keysDir, validNetwork, 'deployer.json')
  if (existsSync(keyFile)) {
    const rawData = JSON.parse(readFileSync(keyFile, 'utf-8'))
    // SECURITY: Validate schema to prevent insecure deserialization
    const result = DeployerKeySchema.safeParse(rawData)
    if (!result.success) {
      throw new Error(
        `Invalid deployer key file format: ${result.error.message}`,
      )
    }
    return result.data.privateKey
  }

  // 3. Default dev key for localnet
  if (validNetwork === 'localnet') {
    return WELL_KNOWN_KEYS.dev[0].privateKey
  }

  throw new Error(`No private key configured for ${validNetwork}`)
}

export function generateKey(name: string, role: string): KeyConfig {
  const privateKey = generatePrivateKey()
  const account = privateKeyToAccount(privateKey)
  return {
    name,
    address: account.address,
    privateKey,
    role,
  }
}

export function generateOperatorKeys(): OperatorKeySet {
  return {
    sequencer: generateKey('Sequencer', 'Produces L2 blocks'),
    batcher: generateKey('Batcher', 'Submits transaction batches to L1'),
    proposer: generateKey('Proposer', 'Submits L2 output roots to L1'),
    challenger: generateKey('Challenger', 'Challenges invalid output roots'),
    admin: generateKey('Admin', 'Proxy admin owner'),
    feeRecipient: generateKey('Fee Recipient', 'Receives sequencer fees'),
    guardian: generateKey('Guardian', 'Superchain config guardian'),
  }
}

/**
 * Encrypt a KeySet using AES-256-GCM with scrypt key derivation
 *
 * Format: salt (32) + iv (16) + authTag (16) + encrypted
 */
export async function encryptKeySet(
  keySet: KeySet,
  password: string,
): Promise<Buffer> {
  const salt = randomBytes(32)
  const iv = randomBytes(16)

  // Derive key using scrypt (memory-hard function)
  const key = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer

  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = JSON.stringify(keySet)

  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()])

  const authTag = cipher.getAuthTag()

  // Clear sensitive data from memory
  key.fill(0)

  // Format: salt (32) + iv (16) + authTag (16) + encrypted
  return Buffer.concat([salt, iv, authTag, encrypted])
}

/**
 * Decrypt a KeySet
 */
export async function decryptKeySet(
  encrypted: Buffer,
  password: string,
): Promise<KeySet> {
  const salt = encrypted.subarray(0, 32)
  const iv = encrypted.subarray(32, 48)
  const authTag = encrypted.subarray(48, 64)
  const data = encrypted.subarray(64)

  const key = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()])

  // Clear key from memory
  key.fill(0)

  // SECURITY: Validate decrypted data against schema to prevent insecure deserialization
  const rawData = JSON.parse(decrypted.toString('utf8'))
  const result = KeySetSchema.safeParse(rawData)
  if (!result.success) {
    throw new Error(
      `Invalid decrypted key data format: ${result.error.message}`,
    )
  }
  return result.data as KeySet
}

export function saveKeys(
  network: NetworkType,
  keys: KeyConfig[],
  encrypt = false,
): string {
  // Validate network to prevent path traversal
  const validNetwork = validateNetwork(network)
  const keysDir = getKeysDir()
  const networkDir = safePath(keysDir, validNetwork)

  if (!existsSync(networkDir)) {
    mkdirSync(networkDir, { recursive: true, mode: 0o700 })
  }

  const keySet: KeySet = {
    network: validNetwork,
    created: new Date().toISOString(),
    keys,
    encrypted: encrypt,
  }

  const filename = encrypt ? 'operators.json.enc' : 'operators.json'
  const filepath = safePath(networkDir, filename)

  writeFileSync(filepath, JSON.stringify(keySet, null, 2), { mode: 0o600 })
  chmodSync(filepath, 0o600)

  // Also save deployer separately for easy access
  const deployer = keys.find(
    (k) => k.role?.includes('admin') || k.role?.includes('Admin'),
  )
  if (deployer) {
    const deployerFile = safePath(networkDir, 'deployer.json')
    writeFileSync(deployerFile, JSON.stringify(deployer, null, 2), {
      mode: 0o600,
    })
    chmodSync(deployerFile, 0o600)
  }

  return filepath
}

export function loadKeys(network: NetworkType): KeySet | undefined {
  // Validate network to prevent path traversal
  const validNetwork = validateNetwork(network)
  const keysDir = getKeysDir()
  const keyFile = safePath(keysDir, validNetwork, 'operators.json')

  if (!existsSync(keyFile)) {
    return undefined
  }

  const rawData = JSON.parse(readFileSync(keyFile, 'utf-8'))
  // SECURITY: Validate schema to prevent insecure deserialization
  const result = KeySetSchema.safeParse(rawData)
  if (!result.success) {
    throw new Error(
      `Invalid operators key file format: ${result.error.message}`,
    )
  }
  return result.data as KeySet
}

export function hasKeys(network: NetworkType): boolean {
  // Validate network to prevent path traversal
  const validNetwork = validateNetwork(network)
  const keysDir = getKeysDir()
  return (
    existsSync(safePath(keysDir, validNetwork, 'operators.enc')) ||
    existsSync(safePath(keysDir, validNetwork, 'operators.json')) ||
    existsSync(safePath(keysDir, validNetwork, 'addresses.json'))
  )
}

export function loadPrivateKey(name: string): string | undefined {
  // Validate key name to prevent path traversal
  const validName = validateKeyName(name)
  const keysDir = getKeysDir()

  // Check for key file in any network directory (validated networks only)
  for (const network of ['localnet', 'testnet', 'mainnet'] as const) {
    const keyFile = safePath(keysDir, network, `${validName}.json`)
    if (existsSync(keyFile)) {
      const rawData = JSON.parse(readFileSync(keyFile, 'utf-8'))
      // SECURITY: Validate schema to prevent insecure deserialization
      const result = DeployerKeySchema.safeParse(rawData)
      if (!result.success) {
        throw new Error(
          `Invalid key file format for ${validName}: ${result.error.message}`,
        )
      }
      return result.data.privateKey
    }
  }

  // Default to first dev key for deployer in localnet context
  if (validName === 'deployer') {
    return WELL_KNOWN_KEYS.dev[0].privateKey
  }

  return undefined
}

export function showKeyInfo(key: KeyConfig): void {
  logger.keyValue('Name', key.name)
  logger.keyValue('Address', key.address)
  logger.keyValue('Role', key.role || 'N/A')
}

export function printFundingRequirements(
  keys: OperatorKeySet,
  network: NetworkType,
): void {
  const requirements = [
    {
      key: keys.admin,
      amount: network === 'mainnet' ? '1.0 ETH' : '0.5 ETH',
      purpose: 'L1 contract deployments',
    },
    {
      key: keys.batcher,
      amount: network === 'mainnet' ? '0.5 ETH' : '0.1 ETH',
      purpose: 'Submitting batches (ongoing)',
    },
    {
      key: keys.proposer,
      amount: network === 'mainnet' ? '0.5 ETH' : '0.1 ETH',
      purpose: 'Submitting proposals (ongoing)',
    },
    {
      key: keys.sequencer,
      amount: '0.01 ETH',
      purpose: 'Sequencer operations',
    },
  ]

  for (const req of requirements) {
    if (req.key) {
      logger.info(`  ${req.key.name}: ${req.key.address}`)
      logger.info(`    Required: ${req.amount} (${req.purpose})`)
      logger.newline()
    }
  }

  if (network === 'testnet') {
    logger.subheader('Testnet Faucets')
    logger.list([
      'https://sepoliafaucet.com',
      'https://www.alchemy.com/faucets/ethereum-sepolia',
      'https://cloud.google.com/application/web3/faucet/ethereum/sepolia',
    ])
  }
}

export function generateEntropyString(): string {
  return randomBytes(32).toString('hex')
}

export function validatePassword(password: string): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (password.length < 16) {
    errors.push('Minimum 16 characters')
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Must contain uppercase letters')
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Must contain lowercase letters')
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Must contain numbers')
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Must contain special characters (!@#$%^&*...)')
  }

  return { valid: errors.length === 0, errors }
}
