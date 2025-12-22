/**
 * CAIP - Chain Agnostic Improvement Proposals
 *
 * Universal cross-chain addressing for:
 * - CAIP-2: Chain Identification
 * - CAIP-10: Account Identification
 * - CAIP-19: Asset Identification
 *
 * Compatible with EVM and Solana chains.
 */

import { parseAccountId } from './addresses'
import { parseAssetType } from './assets'
import {
  formatChainId,
  parseChainId,
  SOLANA_DEVNET_GENESIS,
  SOLANA_MAINNET_GENESIS,
} from './chains'

export { PublicKey } from '@solana/web3.js'
export {
  getAddress as checksumEvmAddress,
  isAddress as isEvmAddress,
} from 'viem'
export {
  type AccountId,
  areAddressesEqual,
  bytes32ToAddress,
  caip10ToEvmAddress,
  caip10ToSolanaPublicKey,
  createMultiChainAddress,
  createUniversalAddress,
  evmAddressToCAIP10,
  formatAccountId,
  isValidAccountId,
  isValidEvmAddress,
  isValidSolanaAddress,
  type MultiChainAddress,
  parseAccountId,
  shortenAddress,
  solanaAddressToCAIP10,
  type UniversalAddress,
} from './addresses'
export {
  type AssetInfo,
  type AssetNamespace,
  type AssetType,
  CROSS_CHAIN_ASSETS,
  type CrossChainAsset,
  caip19ToErc20Address,
  caip19ToSplMint,
  erc20ToCAIP19,
  erc721ToCAIP19,
  findEquivalentAsset,
  formatAssetType,
  getAssetChainMap,
  getAssetInfo,
  isValidAssetType,
  KNOWN_ASSETS,
  nativeCurrencyToCAIP19,
  parseAssetType,
  SLIP44,
  splTokenToCAIP19,
} from './assets'
export {
  CHAINS,
  type ChainId,
  type ChainInfo,
  type ChainNamespace,
  caip2ToEvmChainId,
  evmChainIdToCAIP2,
  formatChainId,
  getAllChains,
  getChainInfo,
  getMainnetChains,
  getSolanaCluster,
  getTestnetChains,
  isEvmChain,
  isSolanaChain,
  parseChainId,
  SOLANA_DEVNET_GENESIS,
  SOLANA_MAINNET_GENESIS,
  SOLANA_TESTNET_GENESIS,
  solanaClusterToCAIP2,
} from './chains'

export interface UniversalId {
  type: 'chain' | 'account' | 'asset'
  raw: string
  namespace: string
  chainId?: string
  address?: string
  assetNamespace?: string
  assetReference?: string
  tokenId?: string
}

export function parseUniversalId(caip: string): UniversalId {
  if (!caip || typeof caip !== 'string') {
    throw new Error('CAIP identifier must be a non-empty string')
  }

  if (caip.includes('/')) {
    const { chainId, assetNamespace, assetReference, tokenId } =
      parseAssetType(caip)
    return {
      type: 'asset',
      raw: caip,
      namespace: chainId.namespace,
      chainId: formatChainId(chainId),
      assetNamespace,
      assetReference,
      tokenId,
    }
  }

  const colonCount = (caip.match(/:/g) ?? []).length

  if (colonCount === 0) {
    throw new Error(
      `Invalid CAIP identifier: ${caip} - must contain at least one colon`,
    )
  }

  if (colonCount === 1) {
    const chainId = parseChainId(caip)
    return {
      type: 'chain',
      raw: caip,
      namespace: chainId.namespace,
      chainId: formatChainId(chainId),
    }
  }

  const accountId = parseAccountId(caip)
  return {
    type: 'account',
    raw: caip,
    namespace: accountId.chainId.namespace,
    chainId: formatChainId(accountId.chainId),
    address: accountId.address,
  }
}

export function isValidCAIP(caip: string): boolean {
  try {
    parseUniversalId(caip)
    return true
  } catch {
    return false
  }
}

export function getCAIPType(
  caip: string,
): 'chain' | 'account' | 'asset' | undefined {
  try {
    return parseUniversalId(caip).type
  } catch {
    return undefined
  }
}

export class CAIPBuilder {
  private namespace: string = 'eip155'
  private chainReference: string = '1'

  evmChain(chainId: number): this {
    this.namespace = 'eip155'
    this.chainReference = chainId.toString()
    return this
  }

  solanaChain(
    cluster: 'mainnet-beta' | 'devnet' | 'testnet' = 'mainnet-beta',
  ): this {
    this.namespace = 'solana'
    const genesisHashes: Record<string, string> = {
      'mainnet-beta': SOLANA_MAINNET_GENESIS,
      devnet: SOLANA_DEVNET_GENESIS,
      testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z',
    }
    this.chainReference = genesisHashes[cluster]
    return this
  }

  chainId(): string {
    return `${this.namespace}:${this.chainReference}`
  }

  accountId(address: string): string {
    return `${this.namespace}:${this.chainReference}:${address}`
  }

  nativeAsset(): string {
    if (this.namespace === 'eip155') {
      return `${this.namespace}:${this.chainReference}/slip44:60`
    }
    return `${this.namespace}:${this.chainReference}/native:SOL`
  }

  tokenAsset(tokenAddress: string): string {
    if (this.namespace === 'eip155') {
      return `${this.namespace}:${this.chainReference}/erc20:${tokenAddress}`
    }
    return `${this.namespace}:${this.chainReference}/spl:${tokenAddress}`
  }

  nftAsset(contractAddress: string, tokenId: string | number): string {
    if (this.namespace === 'eip155') {
      return `${this.namespace}:${this.chainReference}/erc721:${contractAddress}:${tokenId}`
    }
    throw new Error('NFT assets are EVM-only in this implementation')
  }
}

export function caip(): CAIPBuilder {
  return new CAIPBuilder()
}
