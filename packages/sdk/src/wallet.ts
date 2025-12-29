/**
 * Wallet utilities for network SDK
 * Supports both EOA and ERC-4337 Smart Accounts
 *
 * For production use, see createKMSWallet in './kms-wallet' for
 * MPC-backed signing where keys never exist in memory.
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
import type { LocalAccount } from 'viem/accounts'
import { getChainConfig, getContract, getServicesConfig } from './config'

export interface WalletConfig {
  /** Pre-configured account (for testing) */
  account: LocalAccount
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
 * Create a wallet from a pre-configured account.
 * For production use, prefer createKMSWallet() for secure MPC-backed signing.
 */
export async function createWallet(config: WalletConfig): Promise<JejuWallet> {
  const chain = getNetworkChain(config.network)
  const services = getServicesConfig(config.network)
  const account = config.account

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
