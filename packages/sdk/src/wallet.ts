/**
 * Wallet utilities for network SDK
 * Supports both EOA and ERC-4337 Smart Accounts
 *
 * ⚠️ SECURITY WARNING FOR TEE/PRODUCTION ENVIRONMENTS ⚠️
 *
 * This wallet implementation handles private keys in memory.
 * For production deployments, especially in TEE environments where
 * side-channel attacks are possible, use createKMSWallet() instead.
 *
 * KMS-backed wallets:
 * - Never expose private keys in process memory
 * - Use MPC (2-of-3 or 3-of-5) threshold signing
 * - No single party ever has the complete key
 *
 * @see createKMSWallet in './kms-wallet' for secure signing
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
  createWalletClient,
  type Hex,
  http,
  type PublicClient,
  type WalletClient,
} from 'viem'
import {
  type LocalAccount,
  mnemonicToAccount,
  privateKeyToAccount,
} from 'viem/accounts'
import { getChainConfig, getContract, getServicesConfig } from './config'

/**
 * Check if running in a production environment where local keys are dangerous
 */
function isProductionEnvironment(): boolean {
  const env = process.env.NODE_ENV
  const network = process.env.JEJU_NETWORK ?? process.env.NETWORK
  return (
    env === 'production' ||
    network === 'mainnet' ||
    network === 'testnet' ||
    process.env.TEE_PLATFORM === 'intel_tdx' ||
    process.env.TEE_PLATFORM === 'amd_sev'
  )
}

export interface WalletConfig {
  privateKey?: Hex
  mnemonic?: string
  account?: LocalAccount
  smartAccount?: boolean
  network: NetworkType
}

/**
 * Base wallet interface shared by JejuWallet and KMSWallet
 * Use this type for functions that accept either wallet type
 */
export interface BaseWallet {
  /** Wallet address */
  readonly address: Address
  /** Public client for read operations */
  readonly publicClient: PublicClient
  /** Smart account client (if enabled) */
  readonly smartAccountClient?: SmartAccountClient
  /** Whether using smart account */
  readonly isSmartAccount: boolean
  /** Chain configuration */
  readonly chain: Chain
  /** Send a transaction */
  sendTransaction: (params: {
    to: Address
    value?: bigint
    data?: Hex
  }) => Promise<Hex>
  /** Sign a message */
  signMessage: (message: string) => Promise<Hex>
  /** Get native token balance */
  getBalance: () => Promise<bigint>
}

/**
 * Full wallet with local account access
 * Extends BaseWallet with account and walletClient for local key operations
 */
export interface JejuWallet extends BaseWallet {
  /** Local account (only available for local key wallets) */
  account: LocalAccount
  /** Wallet client for signing operations */
  walletClient: WalletClient
}

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
 * Create a wallet from a private key, mnemonic, or pre-configured account.
 *
 * ⚠️ SECURITY WARNING: This function handles private keys in memory.
 * For production/TEE environments, use createKMSWallet() instead.
 *
 * @deprecated For production use. Use createKMSWallet() for secure signing.
 */
export async function createWallet(config: WalletConfig): Promise<JejuWallet> {
  const chain = getNetworkChain(config.network)
  const services = getServicesConfig(config.network)

  // SECURITY: Warn about private key usage in production
  if (
    isProductionEnvironment() &&
    (config.privateKey || config.mnemonic) &&
    !process.env.ALLOW_INSECURE_LOCAL_KEYS
  ) {
    console.warn(
      '\n⚠️  SECURITY WARNING: Using private keys in production environment.\n' +
        '   Private keys in memory are vulnerable to side-channel attacks.\n' +
        '   Consider using createKMSWallet() for MPC-backed signing.\n' +
        '   Set ALLOW_INSECURE_LOCAL_KEYS=true to suppress this warning.\n',
    )
  }

  // Create account from private key or mnemonic
  let account: LocalAccount
  if (config.account) {
    account = config.account
  } else if (config.privateKey) {
    account = privateKeyToAccount(config.privateKey)
  } else if (config.mnemonic) {
    account = mnemonicToAccount(config.mnemonic)
  } else {
    throw new Error('Wallet requires privateKey, mnemonic, or account')
  }

  const publicClient = createPublicClient({
    chain,
    transport: http(services.rpc.l2),
  })

  const walletClient = createWalletClient({
    chain,
    transport: http(services.rpc.l2),
    account,
  })

  // Create smart account if enabled (default: true)
  const useSmartAccount = config.smartAccount !== false
  let smartAccountClient: SmartAccountClient | undefined
  let effectiveAddress: Address = account.address

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

  const wallet: JejuWallet = {
    address: effectiveAddress,
    account,
    publicClient,
    walletClient,
    smartAccountClient,
    isSmartAccount: !!smartAccountClient,
    chain,

    async sendTransaction({ to, value, data }) {
      if (smartAccountClient?.account) {
        // SmartAccountClient's sendTransaction has compatible signature but different generics
        const hash = await smartAccountClient.sendTransaction({
          to,
          value: value ?? 0n,
          data: data ?? '0x',
          account: smartAccountClient.account,
          chain,
        })
        return hash
      }

      const hash = await walletClient.sendTransaction({
        to,
        value: value ?? 0n,
        data: data ?? '0x',
        chain,
        account,
      })
      return hash
    },

    async signMessage(message: string) {
      return walletClient.signMessage({ message, account })
    },

    async getBalance() {
      return publicClient.getBalance({ address: effectiveAddress })
    },
  }

  return wallet
}
