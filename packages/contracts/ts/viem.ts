/**
 * Viem Utilities for Contract Interactions
 *
 * Type-safe wrappers for viem that work with typed ABIs from this package.
 *
 * PREFERRED: Use typed ABIs with readContract/writeContract for full type inference:
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
 * DEPRECATED: safeReadContract/safeWriteContract require manual type parameters.
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
export async function readContract<
  const TAbi extends Abi | readonly unknown[],
  TFunctionName extends ContractFunctionName<TAbi, 'pure' | 'view'>,
  TArgs extends ContractFunctionArgs<TAbi, 'pure' | 'view', TFunctionName>,
>(
  client: PublicClient | unknown,
  params: {
    address: Address
    abi: TAbi
    functionName: TFunctionName
    args?: TArgs
    blockNumber?: bigint
    blockTag?: 'latest' | 'earliest' | 'pending' | 'safe' | 'finalized'
  },
): Promise<ReadContractReturnType<TAbi, TFunctionName, TArgs>> {
  const viemClient = client as {
    readContract: (p: unknown) => Promise<unknown>
  }
  return viemClient.readContract(params) as Promise<
    ReadContractReturnType<TAbi, TFunctionName, TArgs>
  >
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
 *   chainId: 1337,
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
 *   chainId: 1337,
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

/**
 * @deprecated Use `readContract` with typed ABIs instead.
 *
 * Simple contract read helper - requires manual type parameter.
 * Prefer using typed ABIs which provide automatic type inference.
 */
export async function safeReadContract<TReturn>(
  client: unknown,
  params: {
    address: Address
    abi: Abi | readonly unknown[]
    functionName: string
    args?: readonly unknown[]
  },
): Promise<TReturn> {
  const viemClient = client as {
    readContract: (args: unknown) => Promise<unknown>
  }
  const result = await viemClient.readContract({
    address: params.address,
    abi: params.abi,
    functionName: params.functionName,
    args: params.args,
  })
  return result as TReturn
}

/**
 * @deprecated Use `writeContract` with typed ABIs instead.
 *
 * Simple contract write helper - no type inference on function names or args.
 * Prefer using typed ABIs which provide automatic type inference.
 */
export async function safeWriteContract(
  client:
    | WalletClient
    | { writeContract: (args: unknown) => Promise<`0x${string}`> },
  params: {
    address: Address
    abi: Abi | readonly unknown[]
    functionName: string
    args?: readonly unknown[]
    account?: Account | Address
    chain?: Chain
    value?: bigint
  },
): Promise<`0x${string}`> {
  return (client as WalletClient).writeContract({
    address: params.address,
    abi: params.abi as Abi,
    functionName: params.functionName as ContractFunctionName<
      Abi,
      'nonpayable' | 'payable'
    >,
    args: params.args as ContractFunctionArgs<
      Abi,
      'nonpayable' | 'payable',
      ContractFunctionName<Abi, 'nonpayable' | 'payable'>
    >,
    account: params.account,
    chain: params.chain,
    value: params.value,
  } as WriteContractParameters<
    Abi,
    ContractFunctionName<Abi, 'nonpayable' | 'payable'>
  >)
}
