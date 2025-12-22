/**
 * CAIP-10: Account Identification
 *
 * Format: chain_id:account_address
 * Examples:
 *   - eip155:1:0xab16a96D359eC26a11e2C2b3d8f8B8942d5Bfcdb
 *   - solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
 */

import { PublicKey } from '@solana/web3.js'
import { getAddress as checksumAddress, isAddress as isEvmAddress } from 'viem'
import {
  type ChainId,
  formatChainId,
  isEvmChain,
  isSolanaChain,
  SOLANA_DEVNET_GENESIS,
  SOLANA_MAINNET_GENESIS,
  SOLANA_TESTNET_GENESIS,
} from './chains'

export interface AccountId {
  chainId: ChainId
  address: string
}

export interface UniversalAddress {
  caip10: string
  chainId: ChainId
  address: string
  isEvm: boolean
  isSolana: boolean
  normalized: string
}

export function parseAccountId(caip10: string): AccountId {
  const lastColonIndex = caip10.lastIndexOf(':')
  if (lastColonIndex === -1) {
    throw new Error(`Invalid CAIP-10 account ID: ${caip10}`)
  }

  const parts = caip10.split(':')
  if (parts.length < 3) {
    throw new Error(`Invalid CAIP-10 account ID: ${caip10}`)
  }

  const namespace = parts[0]
  const reference = parts[1]
  const address = parts.slice(2).join(':')

  return {
    chainId: { namespace: namespace as 'eip155' | 'solana', reference },
    address,
  }
}

export function formatAccountId(accountId: AccountId): string {
  return `${formatChainId(accountId.chainId)}:${accountId.address}`
}

export function createUniversalAddress(caip10: string): UniversalAddress {
  const { chainId, address } = parseAccountId(caip10)
  const chainIdStr = formatChainId(chainId)
  const isEvm = isEvmChain(chainIdStr)
  const isSolana = isSolanaChain(chainIdStr)

  let normalized = address
  if (isEvm) {
    normalized = checksumAddress(address as `0x${string}`)
  } else if (isSolana) {
    normalized = new PublicKey(address).toBase58()
  }

  return {
    caip10: formatAccountId({ chainId, address: normalized }),
    chainId,
    address,
    isEvm,
    isSolana,
    normalized,
  }
}

export function isValidAccountId(caip10: string): boolean {
  try {
    const { chainId, address } = parseAccountId(caip10)
    const chainIdStr = formatChainId(chainId)

    if (isEvmChain(chainIdStr)) {
      return isEvmAddress(address)
    }

    if (isSolanaChain(chainIdStr)) {
      return isValidSolanaAddress(address)
    }

    return false
  } catch {
    return false
  }
}

export function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address)
    return true
  } catch {
    return false
  }
}

export function isValidEvmAddress(address: string): boolean {
  return isEvmAddress(address)
}

export function evmAddressToCAIP10(chainId: number, address: string): string {
  if (!isEvmAddress(address)) {
    throw new Error(`Invalid EVM address: ${address}`)
  }

  return `eip155:${chainId}:${checksumAddress(address as `0x${string}`)}`
}

export function solanaAddressToCAIP10(
  address: string,
  cluster: 'mainnet-beta' | 'devnet' | 'testnet' = 'mainnet-beta',
): string {
  const pubkey = new PublicKey(address)

  const genesisHashes = {
    'mainnet-beta': SOLANA_MAINNET_GENESIS,
    devnet: SOLANA_DEVNET_GENESIS,
    testnet: SOLANA_TESTNET_GENESIS,
  } as const

  return `solana:${genesisHashes[cluster]}:${pubkey.toBase58()}`
}

export function caip10ToEvmAddress(caip10: string): `0x${string}` | undefined {
  const { chainId, address } = parseAccountId(caip10)
  const chainIdStr = formatChainId(chainId)

  if (!isEvmChain(chainIdStr)) {
    return undefined
  }

  return checksumAddress(address as `0x${string}`)
}

export function caip10ToSolanaPublicKey(caip10: string): PublicKey | undefined {
  const { chainId, address } = parseAccountId(caip10)
  const chainIdStr = formatChainId(chainId)

  if (!isSolanaChain(chainIdStr)) {
    return undefined
  }

  return new PublicKey(address)
}

export interface MultiChainAddress {
  original: string
  evm?: `0x${string}`
  solana?: PublicKey
  bytes32: Uint8Array
}

export function createMultiChainAddress(caip10: string): MultiChainAddress {
  const { chainId, address } = parseAccountId(caip10)
  const chainIdStr = formatChainId(chainId)

  const result: MultiChainAddress = {
    original: address,
    bytes32: new Uint8Array(32),
  }

  if (isEvmChain(chainIdStr)) {
    result.evm = checksumAddress(address as `0x${string}`)
    const bytes = Buffer.from(address.slice(2), 'hex')
    result.bytes32.set(bytes, 12)
  } else if (isSolanaChain(chainIdStr)) {
    result.solana = new PublicKey(address)
    result.bytes32 = result.solana.toBytes()
  }

  return result
}

export function bytes32ToAddress(bytes: Uint8Array, isEvm: boolean): string {
  if (isEvm) {
    const addressBytes = bytes.slice(12)
    return checksumAddress(
      `0x${Buffer.from(addressBytes).toString('hex')}` as `0x${string}`,
    )
  } else {
    return new PublicKey(bytes).toBase58()
  }
}

export function areAddressesEqual(a: string, b: string): boolean {
  try {
    const addrA = createUniversalAddress(a)
    const addrB = createUniversalAddress(b)

    return (
      formatChainId(addrA.chainId) === formatChainId(addrB.chainId) &&
      addrA.normalized.toLowerCase() === addrB.normalized.toLowerCase()
    )
  } catch {
    return false
  }
}

export function shortenAddress(caip10: string, chars: number = 4): string {
  const { address } = parseAccountId(caip10)

  if (address.length <= chars * 2 + 3) {
    return address
  }

  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}
