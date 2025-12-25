/**
 * Viem Utilities for Contract Interactions
 *
 * Type-safe wrappers for viem that work with typed ABIs from this package.
 *
 * Use typed ABIs with readContract/writeContract for full type inference:
 * ```typescript
 * import { identityRegistryAbi, readContract } from '@jejunetwork/contracts'
 *
 * const result = await readContract(client, {
 *   address,
 *   abi: identityRegistryAbi,  // Full type inference
 *   functionName: 'isRegistered',  // Autocomplete works
 *   args: [userAddress],  // Type checked
 * })
 * // result is typed as boolean
 * ```
 *
 * @module @jejunetwork/contracts/viem
 */

import type {
  Abi,
  Account,
  Address,
  Chain,
  ContractFunctionArgs,
  ContractFunctionName,
  Hex,
  PublicClient,
  ReadContractReturnType,
  Transport,
  WalletClient,
  WriteContractParameters,
} from 'viem'
import {
  createPublicClient,
  createWalletClient,
  http,
  getContract as viemGetContract,
} from 'viem'

/**
 * Type-safe contract read that works with viem 2.43+ EIP-7702 types.
 *
 * This function properly handles the strict type requirements introduced
 * with EIP-7702 support without requiring authorizationList for standard reads.
 *
 * @example
 * ```typescript
 * const balance = await readContract(publicClient, {
 *   address: tokenAddress,
 *   abi: erc20Abi,
 *   functionName: 'balanceOf',
 *   args: [userAddress],
 * })
 * ```
 */
/** Client interface for readContract operations */
export interface ReadableClient {
  readContract: (params: {
    address: Address
    abi: Abi | readonly unknown[]
    functionName: string
    args?: readonly unknown[]
    blockNumber?: bigint
    blockTag?: 'latest' | 'earliest' | 'pending' | 'safe' | 'finalized'
  }) => Promise<unknown>
}

/**
 * Typed readContract wrapper that accepts any viem-compatible client.
 * Works with viem 2.43+ EIP-7702 types without requiring authorizationList.
 */
export async function readContract<
  const TAbi extends Abi | readonly unknown[],
  TFunctionName extends ContractFunctionName<TAbi, 'pure' | 'view'>,
  TArgs extends ContractFunctionArgs<TAbi, 'pure' | 'view', TFunctionName>,
>(
  client: { readContract: ReadableClient['readContract'] },
  params: {
    address: Address
    abi: TAbi
    functionName: TFunctionName
    args?: TArgs
    blockNumber?: bigint
    blockTag?: 'latest' | 'earliest' | 'pending' | 'safe' | 'finalized'
  },
): Promise<ReadContractReturnType<TAbi, TFunctionName, TArgs>> {
  // Cast params to the expected interface - TArgs is compatible with readonly unknown[]
  return client.readContract({
    address: params.address,
    abi: params.abi,
    functionName: params.functionName as string,
    args: params.args as readonly unknown[] | undefined,
    blockNumber: params.blockNumber,
    blockTag: params.blockTag,
  }) as Promise<ReadContractReturnType<TAbi, TFunctionName, TArgs>>
}

/**
 * Type-safe contract write that works with viem 2.43+ EIP-7702 types.
 *
 * @example
 * ```typescript
 * const hash = await writeContract(walletClient, {
 *   address: contractAddress,
 *   abi: contractAbi,
 *   functionName: 'transfer',
 *   args: [recipient, amount],
 * })
 * ```
 */
export async function writeContract<
  const TAbi extends Abi | readonly unknown[],
  TFunctionName extends ContractFunctionName<TAbi, 'nonpayable' | 'payable'>,
  TArgs extends ContractFunctionArgs<
    TAbi,
    'nonpayable' | 'payable',
    TFunctionName
  >,
  TChain extends Chain | undefined = Chain | undefined,
  TAccount extends Account | undefined = Account | undefined,
>(
  client: WalletClient<Transport, TChain, TAccount>,
  params: {
    address: Address
    abi: TAbi
    functionName: TFunctionName
    args?: TArgs
    value?: bigint
    gas?: bigint
    gasPrice?: bigint
    maxFeePerGas?: bigint
    maxPriorityFeePerGas?: bigint
    nonce?: number
    chain?: TChain
    account?: TAccount
  },
): Promise<Hex> {
  return client.writeContract(
    params as WriteContractParameters<
      TAbi,
      TFunctionName,
      TArgs,
      TChain,
      TAccount
    >,
  )
}

/**
 * Get a type-safe contract instance.
 *
 * @example
 * ```typescript
 * const token = getContract({
 *   address: tokenAddress,
 *   abi: erc20Abi,
 *   client: publicClient,
 * })
 * const balance = await token.read.balanceOf([userAddress])
 * ```
 */
export function getContract<
  const TAbi extends Abi | readonly unknown[],
>(params: {
  address: Address
  abi: TAbi
  client: unknown
}): ReturnType<typeof viemGetContract> {
  return viemGetContract(params as Parameters<typeof viemGetContract>[0])
}

/**
 * Configuration for creating a public client.
 */
export interface PublicClientConfig {
  chainId: number
  rpcUrl: string
  chainName?: string
  nativeCurrency?: {
    name: string
    symbol: string
    decimals: number
  }
}

/**
 * Create a typed public client for contract reads.
 *
 * @example
 * ```typescript
 * const client = createTypedPublicClient({
 *   chainId: 31337,
 *   rpcUrl: 'http://localhost:8545',
 * })
 * ```
 */
export function createTypedPublicClient(
  config: PublicClientConfig,
): ReturnType<typeof createPublicClient> {
  return createPublicClient({
    chain: {
      id: config.chainId,
      name: config.chainName ?? 'Network',
      nativeCurrency: config.nativeCurrency ?? {
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
      },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    },
    transport: http(config.rpcUrl),
  })
}

/**
 * Configuration for creating a wallet client.
 */
export interface WalletClientConfig extends PublicClientConfig {
  account: Account
}

/**
 * Create a typed wallet client for contract writes.
 *
 * @example
 * ```typescript
 * const client = createTypedWalletClient({
 *   chainId: 31337,
 *   rpcUrl: 'http://localhost:8545',
 *   account: privateKeyToAccount('0x...'),
 * })
 * ```
 */
export function createTypedWalletClient(
  config: WalletClientConfig,
): ReturnType<typeof createWalletClient> {
  return createWalletClient({
    account: config.account,
    chain: {
      id: config.chainId,
      name: config.chainName ?? 'Network',
      nativeCurrency: config.nativeCurrency ?? {
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
      },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    },
    transport: http(config.rpcUrl),
  })
}
