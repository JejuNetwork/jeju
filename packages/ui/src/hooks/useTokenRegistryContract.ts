import { useCallback, useMemo } from 'react'
import type { Address } from 'viem'
import {
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { TOKEN_REGISTRY_ABI } from '../contracts'

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

const ETH_ADDRESS =
  '0x0000000000000000000000000000000000000000' as const satisfies Address
const KNOWN_TOKENS: ReadonlyMap<Lowercase<Address>, TokenInfo> = new Map([
  [
    ETH_ADDRESS.toLowerCase() as Lowercase<Address>,
    {
      address: ETH_ADDRESS,
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

export function useTokenRegistry(
  registryAddress: Address | undefined,
): UseTokenRegistryResult {
  // Read all tokens
  const { data: allTokens, refetch: refetchTokens } = useReadContract({
    address: registryAddress,
    abi: TOKEN_REGISTRY_ABI,
    functionName: 'getAllTokens',
  })

  // Read registration fee
  const { data: registrationFee } = useReadContract({
    address: registryAddress,
    abi: TOKEN_REGISTRY_ABI,
    functionName: 'registrationFee',
  })

  // Write: Register token
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

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
    [registryAddress, registrationFee, writeContract],
  )

  // Local token lookup for known tokens
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
    registrationFee,
    registerToken,
    isPending: isPending || isConfirming,
    isSuccess,
    refetchTokens,
    getTokenInfo,
    tokens,
  }
}

export function useTokenConfig(
  registryAddress: Address | undefined,
  tokenAddress: Address | undefined,
): UseTokenConfigResult {
  const { data: config, refetch } = useReadContract({
    address: registryAddress,
    abi: TOKEN_REGISTRY_ABI,
    functionName: 'getTokenConfig',
    args: tokenAddress ? [tokenAddress] : undefined,
  })

  return {
    config: config as TokenConfig | undefined,
    refetch,
  }
}
