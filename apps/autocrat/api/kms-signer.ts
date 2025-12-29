/**
 * KMS-based Signer for Autocrat
 *
 * Uses @jejunetwork/kms for all signing operations.
 */

import { isProductionEnv } from '@jejunetwork/config'
import { createKMSSigner, type KMSSigner } from '@jejunetwork/kms'
import {
  type Address,
  type Chain,
  createWalletClient,
  type Hex,
  http,
  type LocalAccount,
  type SignableMessage,
  type TransactionSerializable,
  type Transport,
  type TypedDataDefinition,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { config as autocratConfig } from './config'

// ════════════════════════════════════════════════════════════════════════════
//                     AUTOCRAT-SPECIFIC TYPES
// ════════════════════════════════════════════════════════════════════════════

export interface AutocratKMSConfig {
  address: Address
  fallbackKey?: Hex
  forceProduction?: boolean
}

export interface KMSAccount {
  address: Address
  type: 'kms' | 'local'
  publicKey: Hex
  source: 'custom'
  sign: (message: Hex) => Promise<Hex>
  signMessage: (message: SignableMessage) => Promise<Hex>
  signTransaction: (tx: TransactionSerializable) => Promise<Hex>
  signTypedData: (typedData: TypedDataDefinition) => Promise<Hex>
}

// ════════════════════════════════════════════════════════════════════════════
//                     KMS ACCOUNT FACTORY
// ════════════════════════════════════════════════════════════════════════════

/**
 * Create a KMS-backed account that can be used with viem
 */
export async function createKMSAccount(
  config: AutocratKMSConfig,
): Promise<KMSAccount> {
  const isProduction = isProductionEnv() || config.forceProduction

  // Create KMS signer
  const signer = createKMSSigner({
    serviceId: `autocrat-${config.address.toLowerCase()}`,
    allowLocalDev: !isProduction,
  })

  // Check health
  const health = await signer.checkHealth()

  if (isProduction && !health.available) {
    throw new Error(
      'KMS service unavailable in production. MPC signing required for security.',
    )
  }

  if (health.available) {
    await signer.initialize()
    return createKMSBackedAccount(signer)
  }

  // Development fallback
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
 * Create a KMS-backed account from an initialized signer
 */
function createKMSBackedAccount(signer: KMSSigner): KMSAccount {
  const address = signer.getAddress()
  const viemAccount = signer.getViemAccount()

  return {
    address,
    type: 'kms',
    publicKey: '0x' as Hex, // Not exposed by KMS for security
    source: 'custom' as const,

    sign: async (messageHash: Hex): Promise<Hex> => {
      const result = await signer.sign(messageHash)
      return result.signature
    },

    signMessage: async (message: SignableMessage): Promise<Hex> => {
      return viemAccount.signMessage({ message })
    },

    signTransaction: async (tx: TransactionSerializable): Promise<Hex> => {
      return viemAccount.signTransaction(tx)
    },

    signTypedData: async (typedData: TypedDataDefinition): Promise<Hex> => {
      return viemAccount.signTypedData(typedData)
    },
  }
}

/**
 * Create a local fallback account (development only)
 */
function createLocalFallbackAccount(privateKey: Hex): KMSAccount {
  if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    throw new Error('Invalid private key format. Must be 0x-prefixed 32 bytes.')
  }

  const account = privateKeyToAccount(privateKey)

  console.warn(
    '[KMS] Using local private key. This is NOT secure for production.',
  )

  return {
    address: account.address,
    type: 'local',
    publicKey: account.publicKey,
    source: 'custom' as const,

    sign: async (messageHash: Hex): Promise<Hex> => {
      return account.sign({ hash: messageHash })
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

// ════════════════════════════════════════════════════════════════════════════
//                     WALLET CLIENT FACTORY
// ════════════════════════════════════════════════════════════════════════════

export async function createKMSWalletClient<_TTransport extends Transport>(
  configOrAddress: AutocratKMSConfig | { address: Address },
  chain?: Chain,
  rpcUrl?: string,
): Promise<{ client: WalletClient; account: KMSAccount }> {
  let kmsConfig: AutocratKMSConfig

  if ('address' in configOrAddress) {
    kmsConfig = configOrAddress as AutocratKMSConfig
  } else {
    kmsConfig = configOrAddress
  }

  const kmsAccount = await createKMSAccount(kmsConfig)

  // Convert KMSAccount to LocalAccount for viem
  const localAccount: LocalAccount = {
    address: kmsAccount.address,
    type: 'local',
    source: 'custom',
    publicKey: kmsAccount.publicKey,
    signMessage: async ({ message }) => kmsAccount.signMessage(message),
    signTransaction: async (tx) => kmsAccount.signTransaction(tx),
    signTypedData: async (typedData) =>
      kmsAccount.signTypedData(typedData as TypedDataDefinition),
  }

  const transport = rpcUrl ? http(rpcUrl) : http()
  const chainToUse = chain ?? (await import('viem/chains')).localhost

  const client = createWalletClient({
    account: localAccount,
    chain: chainToUse,
    transport,
  })

  return { client, account: kmsAccount }
}

/**
 * Create a KMS wallet client with HTTP transport
 */
export async function createKMSHttpWalletClient(
  config: AutocratKMSConfig & { chain: Chain; rpcUrl: string },
): Promise<WalletClient> {
  const result = await createKMSWalletClient(
    config,
    config.chain,
    config.rpcUrl,
  )
  return result.client
}

/**
 * Get operator configuration for KMS signing
 * Derives address from operator key if available
 */
export function getOperatorConfig(): AutocratKMSConfig | null {
  const operatorKey = autocratConfig.operatorKey ?? autocratConfig.privateKey
  if (!operatorKey) {
    return null
  }

  // Derive address from private key
  const account = privateKeyToAccount(operatorKey as Hex)
  return {
    address: account.address,
    fallbackKey: operatorKey as Hex,
    forceProduction: isProductionEnv(),
  }
}
