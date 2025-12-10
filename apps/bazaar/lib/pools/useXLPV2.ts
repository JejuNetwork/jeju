import { useReadContract, useWriteContract, useAccount, useReadContracts } from 'wagmi'
import { getXLPContracts } from '@/config/contracts'
import { JEJU_CHAIN_ID } from '@/config/chains'
import type { Address, Abi } from 'viem'
import { parseEther, formatEther } from 'viem'

// XLP V2 Factory ABI (minimal)
const V2_FACTORY_ABI: Abi = [
  {
    inputs: [{ name: 'tokenA', type: 'address' }, { name: 'tokenB', type: 'address' }],
    name: 'getPair',
    outputs: [{ name: 'pair', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenA', type: 'address' }, { name: 'tokenB', type: 'address' }],
    name: 'createPair',
    outputs: [{ name: 'pair', type: 'address' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'allPairsLength',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: '', type: 'uint256' }],
    name: 'allPairs',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
]

// XLP V2 Pair ABI (minimal)
const V2_PAIR_ABI: Abi = [
  {
    inputs: [],
    name: 'getReserves',
    outputs: [
      { name: 'reserve0', type: 'uint112' },
      { name: 'reserve1', type: 'uint112' },
      { name: 'blockTimestampLast', type: 'uint32' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token0',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'to', type: 'address' }],
    name: 'mint',
    outputs: [{ name: 'liquidity', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'to', type: 'address' }],
    name: 'burn',
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'amount0Out', type: 'uint256' },
      { name: 'amount1Out', type: 'uint256' },
      { name: 'to', type: 'address' },
      { name: 'data', type: 'bytes' },
    ],
    name: 'swap',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
]

export interface V2Pair {
  address: Address
  token0: Address
  token1: Address
  reserve0: bigint
  reserve1: bigint
  totalSupply: bigint
}

export interface V2SwapQuote {
  amountOut: bigint
  priceImpact: number
  fee: bigint
}

// Get pair address for two tokens
export function useV2Pair(token0: Address | null, token1: Address | null) {
  const contracts = getXLPContracts(JEJU_CHAIN_ID)

  const { data: pairAddress, isLoading, error, refetch } = useReadContract({
    address: contracts?.v2Factory,
    abi: V2_FACTORY_ABI,
    functionName: 'getPair',
    args: token0 && token1 ? [token0, token1] : undefined,
    query: { enabled: !!token0 && !!token1 && !!contracts?.v2Factory },
  })

  return {
    pairAddress: pairAddress as Address | undefined,
    isLoading,
    error,
    refetch,
  }
}

// Get full pair data including reserves
export function useV2PairData(pairAddress: Address | null) {
  const { address: userAddress } = useAccount()

  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: pairAddress
      ? [
          { address: pairAddress, abi: V2_PAIR_ABI, functionName: 'getReserves' },
          { address: pairAddress, abi: V2_PAIR_ABI, functionName: 'token0' },
          { address: pairAddress, abi: V2_PAIR_ABI, functionName: 'token1' },
          { address: pairAddress, abi: V2_PAIR_ABI, functionName: 'totalSupply' },
          { address: pairAddress, abi: V2_PAIR_ABI, functionName: 'balanceOf', args: [userAddress] },
        ]
      : [],
    query: { enabled: !!pairAddress },
  })

  if (!data || !pairAddress) {
    return { pair: null, userLpBalance: 0n, isLoading, error, refetch }
  }

  const reservesResult = data[0]
  const token0Result = data[1]
  const token1Result = data[2]
  const supplyResult = data[3]
  const balanceResult = data[4]

  if (
    !reservesResult || reservesResult.status !== 'success' ||
    !token0Result || token0Result.status !== 'success' ||
    !token1Result || token1Result.status !== 'success' ||
    !supplyResult || supplyResult.status !== 'success'
  ) {
    return { pair: null, userLpBalance: 0n, isLoading, error, refetch }
  }

  const [reserve0, reserve1] = reservesResult.result as [bigint, bigint, number]

  const pair: V2Pair = {
    address: pairAddress,
    token0: token0Result.result as Address,
    token1: token1Result.result as Address,
    reserve0,
    reserve1,
    totalSupply: supplyResult.result as bigint,
  }

  const userLpBalance = balanceResult?.status === 'success' ? (balanceResult.result as bigint) : 0n

  return { pair, userLpBalance, isLoading, error, refetch }
}

// Calculate swap output (V2 constant product)
export function calculateV2SwapOutput(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint
): V2SwapQuote {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) {
    return { amountOut: 0n, priceImpact: 0, fee: 0n }
  }

  // 0.3% fee
  const amountInWithFee = amountIn * 997n
  const numerator = amountInWithFee * reserveOut
  const denominator = reserveIn * 1000n + amountInWithFee
  const amountOut = numerator / denominator

  // Calculate fee
  const fee = (amountIn * 3n) / 1000n

  // Calculate price impact
  const spotPrice = Number(reserveOut) / Number(reserveIn)
  const executionPrice = Number(amountOut) / Number(amountIn)
  const priceImpact = ((spotPrice - executionPrice) / spotPrice) * 100

  return { amountOut, priceImpact, fee }
}

// Create new V2 pair
export function useCreateV2Pair() {
  const contracts = getXLPContracts(JEJU_CHAIN_ID)

  const { writeContractAsync, isPending, isSuccess, error, data: txHash } = useWriteContract()

  const createPair = async (token0: Address, token1: Address) => {
    if (!contracts?.v2Factory) throw new Error('V2 Factory not deployed')

    const hash = await writeContractAsync({
      address: contracts.v2Factory,
      abi: V2_FACTORY_ABI,
      functionName: 'createPair',
      args: [token0, token1],
    })
    return hash
  }

  return { createPair, isLoading: isPending, isSuccess, error, txHash }
}

// Add liquidity to V2 pair
export function useV2AddLiquidity() {
  const { address } = useAccount()
  const { writeContractAsync, isPending, isSuccess, error, data: txHash } = useWriteContract()

  const addLiquidity = async (pairAddress: Address) => {
    if (!address) throw new Error('Wallet not connected')

    // Tokens must be transferred to pair first, then call mint
    const hash = await writeContractAsync({
      address: pairAddress,
      abi: V2_PAIR_ABI,
      functionName: 'mint',
      args: [address],
    })
    return hash
  }

  return { addLiquidity, isLoading: isPending, isSuccess, error, txHash }
}

// Remove liquidity from V2 pair
export function useV2RemoveLiquidity() {
  const { address } = useAccount()
  const { writeContractAsync, isPending, isSuccess, error, data: txHash } = useWriteContract()

  const removeLiquidity = async (pairAddress: Address) => {
    if (!address) throw new Error('Wallet not connected')

    // LP tokens must be transferred to pair first, then call burn
    const hash = await writeContractAsync({
      address: pairAddress,
      abi: V2_PAIR_ABI,
      functionName: 'burn',
      args: [address],
    })
    return hash
  }

  return { removeLiquidity, isLoading: isPending, isSuccess, error, txHash }
}

// Execute V2 swap
export function useV2Swap() {
  const { address } = useAccount()
  const { writeContractAsync, isPending, isSuccess, error, data: txHash } = useWriteContract()

  const swap = async (
    pairAddress: Address,
    amount0Out: bigint,
    amount1Out: bigint,
    to?: Address
  ) => {
    if (!address) throw new Error('Wallet not connected')

    const hash = await writeContractAsync({
      address: pairAddress,
      abi: V2_PAIR_ABI,
      functionName: 'swap',
      args: [amount0Out, amount1Out, to || address, '0x'],
    })
    return hash
  }

  return { swap, isLoading: isPending, isSuccess, error, txHash }
}

// Get all V2 pairs
export function useAllV2Pairs() {
  const contracts = getXLPContracts(JEJU_CHAIN_ID)

  const { data: pairCount } = useReadContract({
    address: contracts?.v2Factory,
    abi: V2_FACTORY_ABI,
    functionName: 'allPairsLength',
    query: { enabled: !!contracts?.v2Factory },
  })

  const pairIndices = pairCount ? Array.from({ length: Number(pairCount) }, (_, i) => i) : []

  const { data: pairAddresses, isLoading, error, refetch } = useReadContracts({
    contracts: pairIndices.map((i) => ({
      address: contracts?.v2Factory,
      abi: V2_FACTORY_ABI,
      functionName: 'allPairs',
      args: [BigInt(i)],
    })),
    query: { enabled: pairIndices.length > 0 && !!contracts?.v2Factory },
  })

  const pairs = (pairAddresses || [])
    .filter((r) => r.status === 'success')
    .map((r) => r.result as Address)

  return { pairs, pairCount: Number(pairCount || 0), isLoading, error, refetch }
}
