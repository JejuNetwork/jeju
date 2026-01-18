/**
 * Browser stub for server-only modules.
 *
 * This file is used by Vite aliases to prevent bundling Node/server deps into the web build.
 * It must be safe to import in the browser and should fail fast if used at runtime.
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
  WalletClient as ViemWalletClient,
} from 'viem'

export default {}

export function noop(): void {}

export function cors(): object {
  return {}
}

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
  group(..._args: AnyValue[]): this {
    return this
  }
  derive(..._args: AnyValue[]): this {
    return this
  }
  onBeforeHandle(..._args: AnyValue[]): this {
    return this
  }
  onError(..._args: AnyValue[]): this {
    return this
  }
  listen(..._args: AnyValue[]): void {
    throw new Error('Elysia is not available in browser builds')
  }
}

export function getSQLit(): null {
  return null
}

export const banManagerAbi: readonly [] = []

export type SQLitClient = never

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

export class SecureSigningService {
  hasKey(_keyId: string): boolean {
    return false
  }

  getAddress(_keyId: string): Address {
    throw new Error('SecureSigningService is not available in browser builds')
  }

  async sign(_request: {
    keyId: string
    message: string
    messageHash: Hex
  }): Promise<{ signature: Hex }> {
    throw new Error('SecureSigningService is not available in browser builds')
  }
}

export function getSecureSigningService(): SecureSigningService {
  throw new Error('SecureSigningService is not available in browser builds')
}

export function createMPCClient(..._args: AnyValue[]): never {
  throw new Error('createMPCClient is not available in browser builds')
}
