import { useTypedWriteContract } from '@jejunetwork/shared/wagmi'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import { useCallback, useMemo } from 'react'
import type { Address } from 'viem'
import { useReadContract } from 'wagmi'
import { CONTRACTS } from '../../lib/config'
import { TOKEN_REGISTRY_ABI } from '../lib/constants'

export interface TokenInfo {
  address: Address
  symbol: string
  name: string
  decimals: number
}

export interface TokenConfig {
  tokenAddress: Address
  name: string
  symbol: string
  decimals: number
  oracleAddress: Address
  minFeeMargin: bigint
  maxFeeMargin: bigint
  isActive: boolean
  registrant: Address
  registrationTime: bigint
  totalVolume: bigint
  totalTransactions: bigint
  metadataHash: `0x${string}`
}

// Built-in token definitions using shared ZERO_ADDRESS
const KNOWN_TOKENS: ReadonlyMap<Lowercase<Address>, TokenInfo> = new Map([
  [
    ZERO_ADDRESS.toLowerCase() as Lowercase<Address>,
    {
      address: ZERO_ADDRESS,
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
    },
  ],
])

export interface UseTokenRegistryResult {
  allTokens: Address[]
  registrationFee: bigint | undefined
  registerToken: (
    tokenAddress: Address,
    oracleAddress: Address,
    minFee: number,
    maxFee: number,
  ) => Promise<void>
  isPending: boolean
  isSuccess: boolean
  refetchTokens: () => void
  getTokenInfo: (address: Address) => TokenInfo | undefined
  tokens: TokenInfo[]
}

export interface UseTokenConfigResult {
  config: TokenConfig | undefined
  refetch: () => void
}

export function useTokenRegistry(): UseTokenRegistryResult {
  const registryAddress = CONTRACTS.tokenRegistry as Address | undefined

  const { data: allTokens, refetch: refetchTokens } = useReadContract({
    address: registryAddress,
    abi: TOKEN_REGISTRY_ABI,
    functionName: 'getAllTokens',
  })

  // Note: registrationFee may not exist in minimal ABI
  const registrationFee = 0n // Default to 0 if not available

  const { writeContract, isLoading, isSuccess } = useTypedWriteContract()

  const registerToken = useCallback(
    async (
      tokenAddress: Address,
      oracleAddress: Address,
      minFee: number,
      maxFee: number,
    ) => {
      if (!registryAddress || !registrationFee) {
        throw new Error(
          'Registry not configured or registration fee not loaded',
        )
      }
      writeContract({
        address: registryAddress,
        abi: TOKEN_REGISTRY_ABI,
        functionName: 'registerToken',
        args: [tokenAddress, oracleAddress, BigInt(minFee), BigInt(maxFee)],
        value: registrationFee,
      })
    },
    [registryAddress, writeContract],
  )

  const getTokenInfo = useCallback(
    (address: Address): TokenInfo | undefined => {
      const normalizedAddress = address.toLowerCase() as Lowercase<Address>
      return KNOWN_TOKENS.get(normalizedAddress)
    },
    [],
  )

  const tokens = useMemo(() => Array.from(KNOWN_TOKENS.values()), [])

  return {
    allTokens: allTokens ? (allTokens as Address[]) : [],
    registrationFee: registrationFee as bigint | undefined,
    registerToken,
    isPending: isLoading,
    isSuccess,
    refetchTokens,
    getTokenInfo,
    tokens,
  }
}

export function useTokenConfig(
  tokenAddress: `0x${string}` | undefined,
): UseTokenConfigResult {
  const registryAddress = CONTRACTS.tokenRegistry as Address | undefined

  const { data: config, refetch } = useReadContract({
    address: registryAddress,
    abi: TOKEN_REGISTRY_ABI,
    functionName: 'getTokenConfig' as const,
    args: tokenAddress ? [tokenAddress] : undefined,
  })

  return {
    config: config as TokenConfig | undefined,
    refetch,
  }
}
