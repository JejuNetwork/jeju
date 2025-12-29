/**
 * KMS-Backed Wallet Client
 *
 * Provides a viem-compatible wallet interface that routes all signing
 * through KMS with FROST threshold cryptography.
 *
 * SECURITY: The full private key is NEVER reconstructed or held in memory.
 * Signing requires threshold agreement from multiple parties.
 *
 * Usage:
 *   const wallet = await createKMSWalletClient({
 *     chain: base,
 *     transport: http(rpcUrl),
 *     kmsKeyId: 'uuid',
 *     ownerAddress: '0x...',
 *   })
 *
 *   // Use like a normal wallet client
 *   const hash = await wallet.sendTransaction({ to, value })
 *   const sig = await wallet.signMessage({ message: 'hello' })
 */

import {
  getCurrentNetwork,
  getKMSUrl,
  isProductionEnv,
} from '@jejunetwork/config'
import type {
  Address,
  Chain,
  Hash,
  Hex,
  LocalAccount,
  PublicClient,
  SignableMessage,
  TransactionSerializable,
  Transport,
  TypedDataDefinition,
} from 'viem'
import {
  createPublicClient,
  encodeFunctionData,
  http,
  keccak256,
  serializeTransaction,
  toHex,
} from 'viem'

// KMS endpoint - env override takes precedence, then config
const KMS_ENDPOINT =
  (typeof process !== 'undefined' ? process.env.KMS_ENDPOINT : undefined) ??
  getKMSUrl(getCurrentNetwork())

interface KMSSignResult {
  signature: Hex
  keyId: string
  address: Address
  mode: 'frost' | 'development'
}

interface KMSKeyInfo {
  keyId: string
  address: Address
  publicKey: Hex
}

interface SendTransactionArgs {
  to: Address
  data?: Hex
  value?: bigint
  gas?: bigint
}

interface KMSWalletConfig {
  chain: Chain
  transport?: Transport
  rpcUrl?: string
  kmsKeyId: string
  ownerAddress: Address
}

/**
 * Hash a signable message
 */
function hashMessage(message: SignableMessage): Hex {
  if (typeof message === 'string') {
    // EIP-191 personal sign
    const prefix = `\x19Ethereum Signed Message:\n${message.length}`
    return keccak256(toHex(prefix + message))
  }
  if ('raw' in message) {
    const raw = message.raw
    if (typeof raw === 'string') {
      return keccak256(raw as Hex)
    }
    return keccak256(toHex(raw))
  }
  return keccak256(toHex(message))
}

/**
 * Get key info from KMS
 */
async function getKMSKeyInfo(
  keyId: string,
  ownerAddress: Address,
): Promise<KMSKeyInfo> {
  const response = await fetch(`${KMS_ENDPOINT}/keys/${keyId}`, {
    headers: {
      'x-jeju-address': ownerAddress,
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`KMS key not found: ${error}`)
  }

  return response.json() as Promise<KMSKeyInfo>
}

/**
 * Request signature from KMS
 */
async function requestKMSSignature(
  keyId: string,
  messageHash: Hex,
  ownerAddress: Address,
): Promise<Hex> {
  const response = await fetch(`${KMS_ENDPOINT}/sign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': ownerAddress,
    },
    body: JSON.stringify({
      keyId,
      messageHash,
      encoding: 'hex',
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`KMS signing failed: ${error}`)
  }

  const result = (await response.json()) as KMSSignResult
  return result.signature
}

/**
 * KMS Account - viem LocalAccount that routes signing through KMS
 */
async function createKMSAccount(
  kmsKeyId: string,
  ownerAddress: Address,
): Promise<LocalAccount> {
  // Get key info from KMS
  const keyInfo = await getKMSKeyInfo(kmsKeyId, ownerAddress)

  async function signMessage({
    message,
  }: {
    message: SignableMessage
  }): Promise<Hex> {
    const messageHash = hashMessage(message)
    return requestKMSSignature(kmsKeyId, messageHash, ownerAddress)
  }

  async function signTransaction(
    transaction: TransactionSerializable,
  ): Promise<Hex> {
    // Serialize and hash the transaction
    const serialized = serializeTransaction(transaction)
    const hash = keccak256(serialized)
    return requestKMSSignature(kmsKeyId, hash, ownerAddress)
  }

  return {
    address: keyInfo.address,
    type: 'local',
    publicKey: keyInfo.publicKey,
    source: 'custom' as const,
    signMessage,
    signTransaction,
    signTypedData: async () => {
      throw new Error(
        'signTypedData not yet implemented for KMS wallet - use signMessage with pre-hashed EIP-712 data',
      )
    },
  } as LocalAccount
}

/**
 * KMS Wallet Client - Full wallet client with KMS-backed signing
 */
export interface KMSWalletClient {
  account: LocalAccount
  chain: Chain
  publicClient: PublicClient

  // Core signing methods
  signMessage(args: { message: SignableMessage }): Promise<Hex>
  signTypedData(typedData: TypedDataDefinition): Promise<Hex>
  signTransaction(transaction: TransactionSerializable): Promise<Hex>

  // Transaction methods
  sendTransaction(args: SendTransactionArgs): Promise<Hash>
  writeContract(args: {
    address: Address
    abi: readonly unknown[]
    functionName: string
    args?: readonly unknown[]
    value?: bigint
    gas?: bigint
  }): Promise<Hash>

  // Utility
  getAddress(): Address
}

/**
 * Create a KMS-backed wallet client
 *
 * All signing operations route through KMS with FROST threshold cryptography.
 * The private key is NEVER reconstructed or held in memory.
 */
export async function createKMSWalletClient(
  config: KMSWalletConfig,
): Promise<KMSWalletClient> {
  const { chain, kmsKeyId, ownerAddress } = config

  // Create KMS-backed account
  const account = await createKMSAccount(kmsKeyId, ownerAddress)

  // Create public client for reading chain state
  const transport = config.transport ?? http(config.rpcUrl)
  const publicClient = createPublicClient({
    chain,
    transport,
  })

  async function sendTransaction(args: SendTransactionArgs): Promise<Hash> {
    // Get nonce
    const nonce = await publicClient.getTransactionCount({
      address: account.address,
    })

    // Get gas estimate
    const gas =
      args.gas ??
      (await publicClient.estimateGas({
        account: account.address,
        to: args.to,
        value: args.value,
        data: args.data,
      }))

    // Get gas price
    const gasPrice = await publicClient.getGasPrice()

    // Build transaction
    const tx: TransactionSerializable = {
      to: args.to,
      value: args.value ?? 0n,
      data: args.data,
      nonce,
      gas,
      gasPrice,
      chainId: chain.id,
    }

    // Sign transaction via KMS
    const signedTx = await account.signTransaction(tx)

    // Send raw transaction
    const hash = await publicClient.sendRawTransaction({
      serializedTransaction: signedTx,
    })

    return hash
  }

  return {
    account,
    chain,
    publicClient,

    async signMessage({ message }) {
      return account.signMessage({ message })
    },

    async signTypedData(typedData) {
      return account.signTypedData(typedData)
    },

    async signTransaction(transaction) {
      return account.signTransaction(
        transaction as Parameters<typeof account.signTransaction>[0],
      )
    },

    sendTransaction,

    async writeContract(args) {
      // Encode function call
      const data = encodeFunctionData({
        abi: args.abi,
        functionName: args.functionName,
        args: args.args ?? [],
      })

      // Send transaction
      return sendTransaction({
        to: args.address,
        data,
        value: args.value,
        gas: args.gas,
      })
    },

    getAddress() {
      return account.address
    },
  }
}

/**
 * Create or get existing KMS key for a service
 */
export async function getOrCreateKMSKey(
  serviceName: string,
  ownerAddress: Address,
): Promise<string> {
  // Check environment for existing key ID
  const envKeyId = process.env[`${serviceName.toUpperCase()}_KMS_KEY_ID`]
  if (envKeyId) {
    return envKeyId
  }

  // In production, key must exist
  if (isProductionEnv()) {
    throw new Error(
      `${serviceName.toUpperCase()}_KMS_KEY_ID must be set in production`,
    )
  }

  // Development: create new key
  console.warn(
    `[${serviceName}] Creating development KMS key. Set ${serviceName.toUpperCase()}_KMS_KEY_ID for production.`,
  )

  const response = await fetch(`${KMS_ENDPOINT}/keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': ownerAddress,
    },
    body: JSON.stringify({
      threshold: 2,
      totalParties: 3,
      metadata: {
        service: serviceName,
        createdAt: new Date().toISOString(),
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to create KMS key: ${await response.text()}`)
  }

  const result = (await response.json()) as { keyId: string }
  return result.keyId
}

/**
 * Check if KMS is available
 */
export async function isKMSAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${KMS_ENDPOINT}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  } catch {
    return false
  }
}

