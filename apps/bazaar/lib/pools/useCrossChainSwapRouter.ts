import { useWriteContract, useReadContract, useAccount } from 'wagmi'
import { parseEther, type Address } from 'viem'
import { JEJU_CHAIN_ID } from '@/config/chains'

// CrossChainSwapRouter ABI (minimal interface)
const CROSS_CHAIN_SWAP_ROUTER_ABI = [
  {
    type: 'function',
    name: 'swapLocal',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'minAmountOut', type: 'uint256' },
      { name: 'fee', type: 'uint24' }
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable'
  },
  {
    type: 'function',
    name: 'initiateCrossChainSwap',
    inputs: [
      { name: 'destinationToken', type: 'address' },
      { name: 'minOutput', type: 'uint256' },
      { name: 'maxFee', type: 'uint256' }
    ],
    outputs: [{ name: 'requestId', type: 'bytes32' }],
    stateMutability: 'payable'
  },
  {
    type: 'function',
    name: 'quoteLocal',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'fee', type: 'uint24' }
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'priceImpact', type: 'uint256' }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'quoteCrossChain',
    inputs: [
      { name: 'sourceChainId', type: 'uint256' },
      { name: 'destinationToken', type: 'address' },
      { name: 'amountIn', type: 'uint256' }
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'xlpFee', type: 'uint256' },
      { name: 'v4Fee', type: 'uint256' },
      { name: 'routerFee', type: 'uint256' }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'checkRouteLiquidity',
    inputs: [
      { name: 'sourceChainId', type: 'uint256' },
      { name: 'destinationToken', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [
      { name: 'hasLiquidity', type: 'bool' },
      { name: 'xlpLiquidity', type: 'uint256' }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'routerFeeBps',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view'
  }
] as const

// Default router address - will be set after deployment
const CROSS_CHAIN_SWAP_ROUTER_ADDRESS: Record<number, Address> = {
  420691: '0x0000000000000000000000000000000000000000', // To be deployed
  1337: '0x0000000000000000000000000000000000000000',
}

export interface LocalSwapParams {
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  minAmountOut: bigint
  fee?: number
}

export interface CrossChainSwapParams {
  destinationToken: Address
  minOutput: bigint
  maxFee: bigint
  amount: bigint
}

export interface QuoteResult {
  amountOut: bigint
  priceImpact?: bigint
  xlpFee?: bigint
  v4Fee?: bigint
  routerFee?: bigint
}

export function useCrossChainSwapRouter() {
  const { chain } = useAccount()
  const chainId = chain?.id || JEJU_CHAIN_ID
  const routerAddress = CROSS_CHAIN_SWAP_ROUTER_ADDRESS[chainId]

  const { data: routerFee } = useReadContract({
    address: routerAddress,
    abi: CROSS_CHAIN_SWAP_ROUTER_ABI,
    functionName: 'routerFeeBps',
    query: { enabled: routerAddress !== '0x0000000000000000000000000000000000000000' }
  })

  return {
    routerAddress,
    routerFee: routerFee || 10n,
    isConfigured: routerAddress !== '0x0000000000000000000000000000000000000000'
  }
}

export function useLocalSwap() {
  const { routerAddress } = useCrossChainSwapRouter()

  const {
    writeContractAsync: executeSwap,
    data: txHash,
    isPending,
    isSuccess,
    error
  } = useWriteContract()

  const swapLocal = async (params: LocalSwapParams) => {
    const isETHIn = params.tokenIn === '0x0000000000000000000000000000000000000000'
    
    const hash = await executeSwap({
      address: routerAddress,
      abi: CROSS_CHAIN_SWAP_ROUTER_ABI,
      functionName: 'swapLocal',
      args: [
        params.tokenIn,
        params.tokenOut,
        params.amountIn,
        params.minAmountOut,
        params.fee || 3000
      ],
      value: isETHIn ? params.amountIn : 0n
    })

    return hash
  }

  return {
    swapLocal,
    isLoading: isPending,
    isSuccess,
    error,
    txHash
  }
}

export function useCrossChainSwap() {
  const { routerAddress } = useCrossChainSwapRouter()

  const {
    writeContractAsync: initiateSwap,
    data: txHash,
    isPending,
    isSuccess,
    error
  } = useWriteContract()

  const initiateCrossChainSwap = async (params: CrossChainSwapParams) => {
    const hash = await initiateSwap({
      address: routerAddress,
      abi: CROSS_CHAIN_SWAP_ROUTER_ABI,
      functionName: 'initiateCrossChainSwap',
      args: [params.destinationToken, params.minOutput, params.maxFee],
      value: params.amount
    })

    return hash
  }

  return {
    initiateCrossChainSwap,
    isLoading: isPending,
    isSuccess,
    error,
    txHash
  }
}

export function useLocalQuote(
  tokenIn: Address | undefined,
  tokenOut: Address | undefined,
  amountIn: bigint | undefined,
  fee: number = 3000
) {
  const { routerAddress, isConfigured } = useCrossChainSwapRouter()

  const { data, isLoading, error } = useReadContract({
    address: routerAddress,
    abi: CROSS_CHAIN_SWAP_ROUTER_ABI,
    functionName: 'quoteLocal',
    args: tokenIn && tokenOut && amountIn 
      ? [tokenIn, tokenOut, amountIn, fee]
      : undefined,
    query: { enabled: isConfigured && !!tokenIn && !!tokenOut && !!amountIn && amountIn > 0n }
  })

  const result: QuoteResult | null = data ? {
    amountOut: data[0],
    priceImpact: data[1]
  } : null

  return { quote: result, isLoading, error }
}

export function useCrossChainQuote(
  sourceChainId: number | undefined,
  destinationToken: Address | undefined,
  amountIn: bigint | undefined
) {
  const { routerAddress, isConfigured } = useCrossChainSwapRouter()

  const { data, isLoading, error } = useReadContract({
    address: routerAddress,
    abi: CROSS_CHAIN_SWAP_ROUTER_ABI,
    functionName: 'quoteCrossChain',
    args: sourceChainId && destinationToken && amountIn 
      ? [BigInt(sourceChainId), destinationToken, amountIn]
      : undefined,
    query: { enabled: isConfigured && !!sourceChainId && !!destinationToken && !!amountIn && amountIn > 0n }
  })

  const result: QuoteResult | null = data ? {
    amountOut: data[0],
    xlpFee: data[1],
    v4Fee: data[2],
    routerFee: data[3]
  } : null

  return { quote: result, isLoading, error }
}

export function useRouteLiquidity(
  sourceChainId: number | undefined,
  destinationToken: Address | undefined,
  amount: bigint | undefined
) {
  const { routerAddress, isConfigured } = useCrossChainSwapRouter()

  const { data, isLoading, error } = useReadContract({
    address: routerAddress,
    abi: CROSS_CHAIN_SWAP_ROUTER_ABI,
    functionName: 'checkRouteLiquidity',
    args: sourceChainId && destinationToken && amount
      ? [BigInt(sourceChainId), destinationToken, amount]
      : undefined,
    query: { enabled: isConfigured && !!sourceChainId && !!destinationToken && !!amount }
  })

  return {
    hasLiquidity: data?.[0] || false,
    xlpLiquidity: data?.[1] || 0n,
    isLoading,
    error
  }
}
