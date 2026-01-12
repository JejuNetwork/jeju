/**
 * Empty stub for server-only modules in browser builds.
 * Provides minimal exports to prevent import errors.
 *
 * Used by the build process to replace server-only packages:
 * - @jejunetwork/kms
 * - @jejunetwork/db
 * - @jejunetwork/deployment
 * - @jejunetwork/messaging
 * - @jejunetwork/contracts
 * - elysia / @elysiajs/*
 * - ioredis
 */

// Export empty object for any default import
export default {}

// Export a no-op function for any named function import
export function noop(): void {}

// Common database stub
export function getSQLit(): null {
  return null
}

// Common type stubs
export type SQLitClient = never

// ============================================================================
// viem contract helpers (stubbed for browser builds)
// ============================================================================

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
  WalletClient as ViemWalletClient,
} from 'viem'

export async function readContract<
  const TAbi extends Abi,
  TFunctionName extends ContractFunctionName<TAbi, 'pure' | 'view'>,
  TArgs extends ContractFunctionArgs<TAbi, 'pure' | 'view', TFunctionName>,
>(
  _client: PublicClient,
  _params: {
    address: Address
    abi: TAbi
    functionName: TFunctionName
    args?: TArgs
    blockNumber?: bigint
    blockTag?: 'latest' | 'earliest' | 'pending' | 'safe' | 'finalized'
  },
): Promise<ReadContractReturnType<TAbi, TFunctionName, TArgs>> {
  throw new Error('readContract is not available in browser builds')
}

export async function writeContract<
  const TAbi extends Abi,
  TFunctionName extends ContractFunctionName<TAbi, 'nonpayable' | 'payable'>,
  TArgs extends ContractFunctionArgs<
    TAbi,
    'nonpayable' | 'payable',
    TFunctionName
  >,
  TChain extends Chain | undefined = Chain | undefined,
  TAccount extends Account | undefined = Account | undefined,
>(
  _client: ViemWalletClient<Transport, TChain, TAccount>,
  _params: {
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
  throw new Error('writeContract is not available in browser builds')
}

// ============================================================================
// Elysia (stubbed for browser builds)
// ============================================================================

type AnyValue =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  | object

export class Elysia {
  use(..._args: AnyValue[]): this {
    return this
  }
  get(..._args: AnyValue[]): this {
    return this
  }
  post(..._args: AnyValue[]): this {
    return this
  }
  put(..._args: AnyValue[]): this {
    return this
  }
  patch(..._args: AnyValue[]): this {
    return this
  }
  delete(..._args: AnyValue[]): this {
    return this
  }
  onError(..._args: AnyValue[]): this {
    return this
  }
  onBeforeHandle(..._args: AnyValue[]): this {
    return this
  }
  derive(..._args: AnyValue[]): this {
    return this
  }
  listen(..._args: AnyValue[]): void {
    throw new Error('Elysia is not available in browser builds')
  }
}
