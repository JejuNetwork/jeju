/**
 * KMS-Backed Wallet - Secure signing without local private keys
 *
 * SECURITY: This wallet implementation NEVER handles private keys directly.
 * All signing operations are delegated to KMS (MPC-backed or HSM-backed).
 *
 * For TEE environments, this ensures that even with side-channel attacks,
 * the full private key is never reconstructable from a single party.
 *
 * Architecture:
 * - Client prepares unsigned transactions/messages
 * - KMS coordinator receives signing requests
 * - MPC parties provide partial signatures (threshold: 2-of-3 or 3-of-5)
 * - No single party ever has the complete key
 */

import type { NetworkType } from '@jejunetwork/types'
import {
  createSmartAccountClient,
  type SmartAccountClient,
} from 'permissionless'
import { toSimpleSmartAccount } from 'permissionless/accounts'
import { createPimlicoClient } from 'permissionless/clients/pimlico'
import {
  type Address,
  type Chain,
  createPublicClient,
  type Hex,
  http,
  keccak256,
  type LocalAccount,
  type SignableMessage,
  serializeTransaction,
  type TransactionSerializable,
  toBytes,
} from 'viem'
import { z } from 'zod'
import { getChainConfig, getContract, getServicesConfig } from './config'
import type { BaseWallet } from './wallet'

// ═══════════════════════════════════════════════════════════════════════════
//                         KMS CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export interface KMSWalletConfig {
  /** The wallet address (derived from the KMS-managed key) */
  address: Address
  /** KMS endpoint URL */
  kmsEndpoint: string
  /** KMS key ID for this wallet */
  keyId: string
  /** Network to connect to */
  network: NetworkType
  /** Enable ERC-4337 smart account (default: true) */
  smartAccount?: boolean
  /** Authentication token for KMS requests */
  authToken?: string
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
}

// ═══════════════════════════════════════════════════════════════════════════
//                         KMS RESPONSE SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const KMSSignResponseSchema = z.object({
  signature: z.string(),
  r: z.string(),
  s: z.string(),
  v: z.number(),
  recoveryId: z.number().optional(),
})

const KMSHealthResponseSchema = z.object({
  healthy: z.boolean(),
  threshold: z.number().optional(),
  activeParties: z.number().optional(),
})

// ═══════════════════════════════════════════════════════════════════════════
//                         KMS WALLET INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

export interface KMSWallet extends BaseWallet {
  /** KMS key ID */
  readonly keyId: string

  /**
   * Check KMS health and party status
   */
  checkKMSHealth: () => Promise<{
    healthy: boolean
    threshold?: number
    activeParties?: number
  }>
}

// ═══════════════════════════════════════════════════════════════════════════
//                         INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function getNetworkChain(network: NetworkType): Chain {
  const config = getChainConfig(network)
  const services = getServicesConfig(network)

  return {
    id: config.chainId,
    name: config.name,
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [services.rpc.l2] },
    },
    blockExplorers: {
      default: { name: 'Explorer', url: services.explorer },
    },
  }
}

/**
 * Request a signature from the KMS
 * SECURITY: Only the message hash is sent, never any key material
 */
async function requestKMSSignature(
  kmsEndpoint: string,
  keyId: string,
  messageHash: Hex,
  authToken?: string,
  timeout = 30000,
): Promise<{ signature: Hex; v: number; r: Hex; s: Hex }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`
  }

  const response = await fetch(`${kmsEndpoint}/sign`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      keyId,
      messageHash,
      hashAlgorithm: 'keccak256',
    }),
    signal: AbortSignal.timeout(timeout),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`KMS signing failed: ${response.status} - ${error}`)
  }

  const rawData: unknown = await response.json()
  const data = KMSSignResponseSchema.parse(rawData)

  return {
    signature: data.signature as Hex,
    v: data.v,
    r: data.r as Hex,
    s: data.s as Hex,
  }
}

/**
 * Create a viem LocalAccount that delegates signing to KMS
 * SECURITY: This account never handles private keys, all signing is via KMS
 */
function createKMSAccount(
  address: Address,
  kmsEndpoint: string,
  keyId: string,
  authToken?: string,
  timeout = 30000,
): LocalAccount {
  // Sign a message via KMS
  async function signMessage({
    message,
  }: {
    message: SignableMessage
  }): Promise<Hex> {
    let messageBytes: Uint8Array
    if (typeof message === 'string') {
      messageBytes = toBytes(message)
    } else if ('raw' in message) {
      messageBytes =
        typeof message.raw === 'string' ? toBytes(message.raw) : message.raw
    } else {
      messageBytes = toBytes(message)
    }

    // Ethereum signed message prefix
    const prefix = `\x19Ethereum Signed Message:\n${messageBytes.length}`
    const prefixedMessage = new Uint8Array([
      ...toBytes(prefix),
      ...messageBytes,
    ])
    const messageHash = keccak256(prefixedMessage)

    const { signature } = await requestKMSSignature(
      kmsEndpoint,
      keyId,
      messageHash,
      authToken,
      timeout,
    )
    return signature
  }

  // Sign a transaction via KMS
  async function signTransaction(
    transaction: TransactionSerializable,
  ): Promise<Hex> {
    const serialized = serializeTransaction(transaction)
    const txHash = keccak256(serialized)

    const { v, r, s } = await requestKMSSignature(
      kmsEndpoint,
      keyId,
      txHash,
      authToken,
      timeout,
    )

    // Append signature to serialized transaction
    // For EIP-1559/EIP-2930 transactions, we use the signature components
    const signedTx = serializeTransaction(transaction, {
      r,
      s,
      v: BigInt(v),
    })

    return signedTx
  }

  return {
    address,
    type: 'local',
    // KMS accounts don't expose their public key locally - it's managed by KMS
    // This is a placeholder that signals KMS-backed signing
    publicKey: `0x04${'0'.repeat(128)}` as Hex,
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

// ═══════════════════════════════════════════════════════════════════════════
//                         KMS WALLET FACTORY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a KMS-backed wallet
 *
 * SECURITY GUARANTEES:
 * - No private key is ever stored or handled in this process
 * - All signing operations are delegated to KMS
 * - KMS uses MPC (2-of-3 or 3-of-5) so no single party has the full key
 * - Even with full memory access, attacker cannot reconstruct the key
 *
 * @example
 * ```typescript
 * const wallet = await createKMSWallet({
 *   address: '0x...', // Your wallet address (from KMS key generation)
 *   kmsEndpoint: 'https://kms.jeju.network',
 *   keyId: 'key-abc123',
 *   network: 'mainnet',
 * });
 *
 * // Sign and send transaction
 * const txHash = await wallet.sendTransaction({
 *   to: '0x...',
 *   value: parseEther('1'),
 * });
 * ```
 */
export async function createKMSWallet(
  config: KMSWalletConfig,
): Promise<KMSWallet> {
  const chain = getNetworkChain(config.network)
  const services = getServicesConfig(config.network)
  const timeout = config.timeout ?? 30000

  // Create KMS-backed account
  const account = createKMSAccount(
    config.address,
    config.kmsEndpoint,
    config.keyId,
    config.authToken,
    timeout,
  )

  const publicClient = createPublicClient({
    chain,
    transport: http(services.rpc.l2),
  })

  // Create smart account if enabled (default: true)
  const useSmartAccount = config.smartAccount !== false
  let smartAccountClient: SmartAccountClient | undefined
  let effectiveAddress: Address = config.address

  if (useSmartAccount) {
    const entryPoint = getContract(
      'payments',
      'entryPoint',
      config.network,
    ) as Address
    const factoryAddress = getContract(
      'payments',
      'accountFactory',
      config.network,
    ) as Address

    // Only create smart account if contracts are deployed
    if (entryPoint && factoryAddress && entryPoint !== '0x') {
      const smartAccount = await toSimpleSmartAccount({
        client: publicClient,
        owner: account,
        entryPoint: {
          address: entryPoint,
          version: '0.7',
        },
        factoryAddress,
      })

      const bundlerUrl = `${services.gateway.api}/bundler`

      const pimlicoClient = createPimlicoClient({
        transport: http(bundlerUrl),
        entryPoint: {
          address: entryPoint,
          version: '0.7',
        },
      })

      smartAccountClient = createSmartAccountClient({
        account: smartAccount,
        chain,
        bundlerTransport: http(bundlerUrl),
        paymaster: pimlicoClient,
      })

      effectiveAddress = smartAccount.address
    }
  }

  const wallet: KMSWallet = {
    address: effectiveAddress,
    publicClient,
    smartAccountClient,
    isSmartAccount: !!smartAccountClient,
    chain,
    keyId: config.keyId,

    async sendTransaction({ to, value, data }) {
      if (smartAccountClient?.account) {
        const hash = await smartAccountClient.sendTransaction({
          to,
          value: value ?? 0n,
          data: data ?? '0x',
          account: smartAccountClient.account,
          chain,
        })
        return hash
      }

      // For EOA, we need to sign via KMS
      const nonce = await publicClient.getTransactionCount({
        address: config.address,
      })
      const gasPrice = await publicClient.getGasPrice()
      const gasLimit = await publicClient.estimateGas({
        account: config.address,
        to,
        value: value ?? 0n,
        data: data ?? '0x',
      })

      const tx: TransactionSerializable = {
        to,
        value: value ?? 0n,
        data: data ?? '0x',
        nonce,
        gasPrice,
        gas: gasLimit,
        chainId: chain.id,
      }

      const signedTx = await account.signTransaction(tx)
      const hash = await publicClient.sendRawTransaction({
        serializedTransaction: signedTx,
      })

      return hash
    },

    async signMessage(message: string) {
      return account.signMessage({ message })
    },

    async getBalance() {
      return publicClient.getBalance({ address: effectiveAddress })
    },

    async checkKMSHealth() {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (config.authToken) {
        headers.Authorization = `Bearer ${config.authToken}`
      }

      const response = await fetch(`${config.kmsEndpoint}/health`, {
        headers,
        signal: AbortSignal.timeout(5000),
      }).catch(() => null)

      if (!response || !response.ok) {
        return { healthy: false }
      }

      const rawData: unknown = await response.json()
      return KMSHealthResponseSchema.parse(rawData)
    },
  }

  return wallet
}

// ═══════════════════════════════════════════════════════════════════════════
//                         SECURITY UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate that a wallet configuration uses KMS and not local keys
 * SECURITY: Use this in production to ensure no local key usage
 */
export function validateSecureWalletConfig(config: {
  privateKey?: Hex
  mnemonic?: string
  kmsEndpoint?: string
  keyId?: string
}): void {
  if (config.privateKey || config.mnemonic) {
    throw new Error(
      'SECURITY: Production deployments must not use privateKey or mnemonic. ' +
        'Use KMS-backed wallet with createKMSWallet() instead.',
    )
  }

  if (!config.kmsEndpoint || !config.keyId) {
    throw new Error(
      'SECURITY: KMS configuration required. Provide kmsEndpoint and keyId.',
    )
  }
}

/**
 * Check if running in a secure TEE environment
 * SECURITY: Returns true if hardware TEE attestation is available
 */
export async function isSecureTEEEnvironment(): Promise<boolean> {
  // Check for Intel TDX or AMD SEV
  const platform = process.env.TEE_PLATFORM
  if (platform === 'intel_tdx' || platform === 'amd_sev') {
    return true
  }

  // Check for dstack attestation endpoint
  const dstackEndpoint = process.env.DSTACK_ENDPOINT
  if (dstackEndpoint) {
    const response = await fetch(`${dstackEndpoint}/attestation/status`, {
      signal: AbortSignal.timeout(2000),
    }).catch(() => null)

    if (response?.ok) {
      const data = (await response.json()) as { hardware?: boolean }
      return data.hardware === true
    }
  }

  return false
}

