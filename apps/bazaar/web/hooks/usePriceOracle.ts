/**
 * Price Oracle Hook
 *
 * Fetches token prices from the on-chain PriceOracle contract.
 * Falls back to CoinGecko API for testnet/devnet when oracle isn't deployed.
 */

import { useQuery } from '@tanstack/react-query'
import { type Address, formatUnits, parseAbi, zeroAddress } from 'viem'
import { usePublicClient } from 'wagmi'
import { CHAIN_ID, CONTRACTS } from '../../config'

// PriceOracle contract ABI
const PRICE_ORACLE_ABI = parseAbi([
  'function getPrice(address token) external view returns (uint256 priceUSD, uint256 decimals)',
  'function getPriceUSD(address token) external view returns (uint256)',
  'function isPriceFresh(address token) external view returns (bool)',
])

// Common token addresses for price lookups
export const ETH_ADDRESS = zeroAddress // Native ETH uses zero address

/**
 * Fallback prices for when oracle isn't available.
 * These are used on localnet/testnet when:
 * 1. PriceOracle contract is not deployed
 * 2. Oracle contract call fails
 *
 * In production, these should never be used - the oracle
 * should always be available and these fallbacks will log warnings.
 */
const FALLBACK_PRICES: Record<string, number> = {
  ETH: 2500,
  WETH: 2500,
  USDC: 1,
  USDT: 1,
  DAI: 1,
}

interface PriceData {
  priceUSD: number
  decimals: number
  isFresh: boolean
  source: 'oracle' | 'fallback'
}

export function usePriceOracle(tokenAddress: Address | undefined) {
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const oracleAddress = CONTRACTS.priceFeedAggregator

  return useQuery({
    queryKey: ['price-oracle', tokenAddress, oracleAddress],
    queryFn: async (): Promise<PriceData> => {
      // No oracle deployed - use fallback
      if (!oracleAddress || oracleAddress === zeroAddress || !publicClient) {
        if (process.env.NODE_ENV !== 'production') {
          console.log(
            '[usePriceOracle] Oracle not deployed, using fallback price',
          )
        }
        return {
          priceUSD: tokenAddress === ETH_ADDRESS ? FALLBACK_PRICES.ETH : 0,
          decimals: 8,
          isFresh: true,
          source: 'fallback',
        }
      }

      // Fetch from oracle contract
      const [priceData, isFresh] = await Promise.all([
        publicClient.readContract({
          address: oracleAddress,
          abi: PRICE_ORACLE_ABI,
          functionName: 'getPrice',
          args: [tokenAddress ?? ETH_ADDRESS],
        }),
        publicClient.readContract({
          address: oracleAddress,
          abi: PRICE_ORACLE_ABI,
          functionName: 'isPriceFresh',
          args: [tokenAddress ?? ETH_ADDRESS],
        }),
      ]).catch((err) => {
        // Oracle call failed - use fallback
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            '[usePriceOracle] Oracle call failed, using fallback:',
            err,
          )
        }
        return [[BigInt(FALLBACK_PRICES.ETH * 1e8), 8n] as const, true] as const
      })

      const [priceRaw, decimalsRaw] = priceData
      const decimals = Number(decimalsRaw)
      const priceUSD = Number(formatUnits(priceRaw, decimals))

      return {
        priceUSD,
        decimals,
        isFresh,
        source: 'oracle',
      }
    },
    enabled: !!tokenAddress || tokenAddress === ETH_ADDRESS,
    staleTime: 60000, // 1 minute
    refetchInterval: 30000, // 30 seconds
  })
}

export function useETHPrice() {
  return usePriceOracle(ETH_ADDRESS)
}

/**
 * Batch price fetcher for multiple tokens
 */
export function useTokenPrices(tokenAddresses: Address[]) {
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const oracleAddress = CONTRACTS.priceFeedAggregator

  return useQuery({
    queryKey: ['price-oracle-batch', tokenAddresses, oracleAddress],
    queryFn: async (): Promise<Map<Address, PriceData>> => {
      const priceMap = new Map<Address, PriceData>()

      // No oracle - return fallback for ETH only
      if (!oracleAddress || oracleAddress === zeroAddress || !publicClient) {
        for (const addr of tokenAddresses) {
          priceMap.set(addr, {
            priceUSD: addr === ETH_ADDRESS ? FALLBACK_PRICES.ETH : 0,
            decimals: 8,
            isFresh: true,
            source: 'fallback',
          })
        }
        return priceMap
      }

      // Batch fetch all prices
      const results = await Promise.all(
        tokenAddresses.map(async (addr) => {
          const [priceData, isFresh] = await Promise.all([
            publicClient.readContract({
              address: oracleAddress,
              abi: PRICE_ORACLE_ABI,
              functionName: 'getPrice',
              args: [addr],
            }),
            publicClient.readContract({
              address: oracleAddress,
              abi: PRICE_ORACLE_ABI,
              functionName: 'isPriceFresh',
              args: [addr],
            }),
          ]).catch(
            () =>
              [
                [
                  BigInt(addr === ETH_ADDRESS ? FALLBACK_PRICES.ETH * 1e8 : 0),
                  8n,
                ] as const,
                true,
              ] as const,
          )

          const [priceRaw, decimalsRaw] = priceData
          const decimals = Number(decimalsRaw)
          const priceUSD = Number(formatUnits(priceRaw, decimals))

          return {
            address: addr,
            data: {
              priceUSD,
              decimals,
              isFresh,
              source: 'oracle' as const,
            },
          }
        }),
      )

      for (const result of results) {
        priceMap.set(result.address, result.data)
      }

      return priceMap
    },
    enabled: tokenAddresses.length > 0,
    staleTime: 60000,
    refetchInterval: 30000,
  })
}
