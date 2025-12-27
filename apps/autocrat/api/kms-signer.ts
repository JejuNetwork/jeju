/**
 * KMS-based Signer for Autocrat
 *
 * Provides secure signing using the Jeju KMS service instead of raw private keys.
 * In production, uses MPC threshold signing where no single party has the full key.
 * In development, falls back to KMS dev mode.
 *
 * SECURITY: This replaces direct privateKeyToAccount usage to prevent
 * side-channel attacks in TEE environments.
 */

import {
  getCurrentNetwork,
  getKmsServiceUrl,
  isProductionEnv,
} from '@jejunetwork/config'
import {
  createThresholdSigner,
  type ThresholdSignerConfig,
} from '@jejunetwork/kms'
import {
  type Account,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type LocalAccount,
  type SignableMessage,
  type TransactionSerializable,
  type TypedDataDefinition,
  createWalletClient,
  hashMessage,
  hashTypedData,
  http,
  keccak256,
  serializeTransaction,
  type WalletClient,
  type Transport,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { toHex } from '../lib'

// ============================================================================
// Types
// ============================================================================

export interface KMSSignerConfig {
  /** Address of the signer (for key lookup in KMS) */
  address: Address
  /** Optional: Use local development key if KMS unavailable */
  fallbackKey?: Hex
  /** Force production mode even in dev environment */
  forceProduction?: boolean
}

export interface KMSAccount {
  address: Address
  type: 'kms' | 'local'
  sign: (message: Hex) => Promise<Hex>
  signMessage: (message: SignableMessage) => Promise<Hex>
  signTransaction: (tx: TransactionSerializable) => Promise<Hex>
  signTypedData: (typedData: TypedDataDefinition) => Promise<Hex>
}

// ============================================================================
// KMS Signer Service
// ============================================================================

let kmsInitialized = false
let kmsAvailable = false

async function checkKMSAvailable(): Promise<boolean> {
  if (kmsInitialized) return kmsAvailable

  const endpoint = getKmsServiceUrl()

  try {
    const response = await fetch(`${endpoint}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    kmsAvailable = response.ok
  } catch {
    kmsAvailable = false
  }

  kmsInitialized = true
  return kmsAvailable
}

/**
 * Create a KMS-backed account that can be used with viem
 *
 * In production: Uses MPC threshold signing via KMS
 * In development: Falls back to local key if KMS unavailable
 *
 * @throws Error if in production and KMS is unavailable
 */
export async function createKMSAccount(
  config: KMSSignerConfig,
): Promise<KMSAccount> {
  const isProduction = isProductionEnv() || config.forceProduction
  const kmsUp = await checkKMSAvailable()

  // Production requires KMS
  if (isProduction && !kmsUp) {
    throw new Error(
      'KMS service unavailable in production. MPC signing required for security.',
    )
  }

  // Development with KMS available - use KMS
  if (kmsUp) {
    return createKMSBackedAccount(config.address)
  }

  // Development without KMS - warn and use fallback
  if (config.fallbackKey) {
    console.warn(
      '[KMS] Development mode: Using local key. Set up KMS for production.',
    )
    return createLocalFallbackAccount(config.fallbackKey)
  }

  throw new Error(
    'KMS unavailable and no fallback key provided. ' +
      'Set OPERATOR_KEY for development or configure KMS.',
  )
}

/**
 * Create a KMS-backed account using threshold signing
 */
async function createKMSBackedAccount(address: Address): Promise<KMSAccount> {
  const signer = createThresholdSigner(address)
  await signer.initialize()

  const signWithKMS = async (messageHash: Hex): Promise<Hex> => {
    const result = await signer.signMessage(messageHash)
    return result.signature
  }

  return {
    address,
    type: 'kms',

    sign: signWithKMS,

    signMessage: async (message: SignableMessage): Promise<Hex> => {
      const hash = hashMessage(message)
      return signWithKMS(hash)
    },

    signTransaction: async (tx: TransactionSerializable): Promise<Hex> => {
      const serialized = serializeTransaction(tx)
      const hash = keccak256(serialized)
      return signWithKMS(hash)
    },

    signTypedData: async (typedData: TypedDataDefinition): Promise<Hex> => {
      const hash = hashTypedData(typedData)
      return signWithKMS(hash)
    },
  }
}

/**
 * Create a local fallback account (development only)
 * Logs warning about insecure key handling
 */
function createLocalFallbackAccount(privateKey: Hex): KMSAccount {
  // Validate key format
  if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    throw new Error('Invalid private key format. Must be 0x-prefixed 32 bytes.')
  }

  const account = privateKeyToAccount(privateKey)

  console.warn(
    '[KMS] ⚠️  Using local private key. This is NOT secure for production.',
  )

  return {
    address: account.address,
    type: 'local',

    sign: async (message: Hex): Promise<Hex> => {
      return account.signMessage({ message: { raw: message } })
    },

    signMessage: async (message: SignableMessage): Promise<Hex> => {
      return account.signMessage({ message })
    },

    signTransaction: async (tx: TransactionSerializable): Promise<Hex> => {
      return account.signTransaction(tx)
    },

    signTypedData: async (typedData: TypedDataDefinition): Promise<Hex> => {
      return account.signTypedData(typedData)
    },
  }
}

// ============================================================================
// Wallet Client Factory
// ============================================================================

/**
 * Create a viem WalletClient backed by KMS
 *
 * Use this instead of creating a wallet client with a raw private key.
 */
export async function createKMSWalletClient(
  config: KMSSignerConfig,
  chain: Chain,
  rpcUrl: string,
): Promise<{
  client: WalletClient<Transport, Chain>
  account: KMSAccount
}> {
  const kmsAccount = await createKMSAccount(config)

  // Create a custom account adapter for viem
  const viemAccount: LocalAccount = {
    address: kmsAccount.address,
    type: 'local',
    source: 'custom',
    publicKey: '0x', // Not available from KMS
    signMessage: async ({ message }) => kmsAccount.signMessage(message),
    signTransaction: async (tx) => kmsAccount.signTransaction(tx),
    signTypedData: async (typedData) => kmsAccount.signTypedData(typedData),
  }

  const client = createWalletClient({
    account: viemAccount,
    chain,
    transport: http(rpcUrl),
  }) as WalletClient<Transport, Chain>

  return { client, account: kmsAccount }
}

// ============================================================================
// Migration Helper
// ============================================================================

/**
 * Get the operator key config for KMS
 *
 * Reads OPERATOR_KEY from env and configures KMS appropriately.
 * In production, the key is used as the address for KMS lookup.
 * In development, it can be used as a fallback for local signing.
 */
export function getOperatorConfig(): KMSSignerConfig | null {
  const operatorKey = process.env.OPERATOR_KEY ?? process.env.PRIVATE_KEY

  if (!operatorKey) {
    return null
  }

  // If it's a hex private key, derive the address
  if (operatorKey.startsWith('0x') && operatorKey.length === 66) {
    const account = privateKeyToAccount(operatorKey as Hex)
    return {
      address: account.address,
      fallbackKey: operatorKey as Hex,
    }
  }

  // If it's just an address (for KMS lookup)
  if (operatorKey.startsWith('0x') && operatorKey.length === 42) {
    return {
      address: operatorKey as Address,
    }
  }

  throw new Error(
    'OPERATOR_KEY must be either a hex private key (0x + 64 chars) ' +
      'or an address (0x + 40 chars) for KMS lookup.',
  )
}

/**
 * Check if KMS is properly configured
 */
export async function validateKMSSetup(): Promise<{
  available: boolean
  mode: 'production' | 'development'
  warnings: string[]
}> {
  const warnings: string[] = []
  const isProduction = isProductionEnv()
  const kmsUp = await checkKMSAvailable()

  if (isProduction && !kmsUp) {
    warnings.push('CRITICAL: KMS unavailable in production environment')
  }

  const operatorKey = process.env.OPERATOR_KEY ?? process.env.PRIVATE_KEY
  if (operatorKey && operatorKey.length === 66) {
    if (isProduction) {
      warnings.push(
        'WARNING: Raw private key in env vars. Use KMS key ID instead.',
      )
    }
  }

  return {
    available: kmsUp,
    mode: isProduction ? 'production' : 'development',
    warnings,
  }
}

// ============================================================================
// Exports
// ============================================================================

export { createThresholdSigner, type ThresholdSignerConfig }

