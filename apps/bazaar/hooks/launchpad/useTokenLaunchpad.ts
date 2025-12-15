import { useAccount, useWriteContract, useReadContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther, type Address } from 'viem'
import { TokenLaunchpadAbi } from '@jejunetwork/contracts'
import { getLaunchpadContracts, hasLaunchpad } from '@/config/contracts'
import { JEJU_CHAIN_ID } from '@/config/chains'

export interface BondingCurveConfig {
  virtualEthReserves: string  // ETH amount (e.g., "30")
  graduationTarget: string    // ETH amount (e.g., "10")
  tokenSupply: string         // Token amount (e.g., "1000000000")
}

export interface ICOConfig {
  presaleAllocationBps: number  // 1000 = 10%
  presalePrice: string          // ETH per token (e.g., "0.0001")
  lpFundingBps: number          // 8000 = 80%
  lpLockDuration: number        // seconds
  buyerLockDuration: number     // seconds
  softCap: string               // ETH amount
  hardCap: string               // ETH amount
  presaleDuration: number       // seconds
}

export interface LaunchInfo {
  id: bigint
  creator: Address
  token: Address
  launchType: 'bonding' | 'ico'
  creatorFeeBps: number
  communityFeeBps: number
  bondingCurve: Address | null
  presale: Address | null
  lpLocker: Address | null
  createdAt: bigint
  graduated: boolean
}

export function useTokenLaunchpad(chainId: number = JEJU_CHAIN_ID) {
  const { address, isConnected } = useAccount()
  const contracts = getLaunchpadContracts(chainId)
  const launchpadAddress = contracts?.tokenLaunchpad as Address | undefined
  const isAvailable = hasLaunchpad(chainId)

  // Write contract hook
  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
    error: writeError,
  } = useWriteContract()

  // Wait for transaction
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  // Read launch count
  const { data: launchCount } = useReadContract({
    address: launchpadAddress,
    abi: TokenLaunchpadAbi,
    functionName: 'launchCount',
    query: { enabled: !!launchpadAddress && isAvailable },
  })

  // Read default community vault
  const { data: defaultCommunityVault } = useReadContract({
    address: launchpadAddress,
    abi: TokenLaunchpadAbi,
    functionName: 'defaultCommunityVault',
    query: { enabled: !!launchpadAddress && isAvailable },
  })

  /**
   * Launch a token with bonding curve (Pump style)
   */
  const launchBondingCurve = (
    name: string,
    symbol: string,
    creatorFeeBps: number,
    communityVault: Address | null,
    config: BondingCurveConfig
  ) => {
    if (!launchpadAddress) {
      throw new Error('Launchpad not available on this chain')
    }

    writeContract({
      address: launchpadAddress,
      abi: TokenLaunchpadAbi,
      functionName: 'launchBondingCurve',
      args: [
        name,
        symbol,
        creatorFeeBps,
        communityVault || '0x0000000000000000000000000000000000000000',
        {
          virtualEthReserves: parseEther(config.virtualEthReserves),
          graduationTarget: parseEther(config.graduationTarget),
          tokenSupply: parseEther(config.tokenSupply),
        },
      ],
    })
  }

  /**
   * Launch a token with ICO presale
   */
  const launchICO = (
    name: string,
    symbol: string,
    totalSupply: string,
    creatorFeeBps: number,
    communityVault: Address | null,
    config: ICOConfig
  ) => {
    if (!launchpadAddress) {
      throw new Error('Launchpad not available on this chain')
    }

    writeContract({
      address: launchpadAddress,
      abi: TokenLaunchpadAbi,
      functionName: 'launchICO',
      args: [
        name,
        symbol,
        parseEther(totalSupply),
        creatorFeeBps,
        communityVault || '0x0000000000000000000000000000000000000000',
        {
          presaleAllocationBps: BigInt(config.presaleAllocationBps),
          presalePrice: parseEther(config.presalePrice),
          lpFundingBps: BigInt(config.lpFundingBps),
          lpLockDuration: BigInt(config.lpLockDuration),
          buyerLockDuration: BigInt(config.buyerLockDuration),
          softCap: parseEther(config.softCap),
          hardCap: parseEther(config.hardCap),
          presaleDuration: BigInt(config.presaleDuration),
        },
      ],
    })
  }

  return {
    // State
    isAvailable,
    isConnected,
    launchpadAddress,
    launchCount: launchCount as bigint | undefined,
    defaultCommunityVault: defaultCommunityVault as Address | undefined,
    
    // Transaction state
    txHash,
    isPending: isWritePending || isConfirming,
    isSuccess,
    error: writeError,
    
    // Actions
    launchBondingCurve,
    launchICO,
  }
}

/**
 * Hook to read a specific launch's details
 */
export function useLaunchInfo(launchId: bigint | undefined, chainId: number = JEJU_CHAIN_ID) {
  const contracts = getLaunchpadContracts(chainId)
  const launchpadAddress = contracts?.tokenLaunchpad as Address | undefined

  const { data, isLoading, error, refetch } = useReadContract({
    address: launchpadAddress,
    abi: TokenLaunchpadAbi,
    functionName: 'getLaunch',
    args: launchId !== undefined ? [launchId] : undefined,
    query: { enabled: !!launchpadAddress && launchId !== undefined },
  })

  const launch = data as {
    id: bigint
    creator: Address
    token: Address
    launchType: number
    feeConfig: { creatorFeeBps: number; communityFeeBps: number; communityVault: Address }
    bondingCurve: Address
    presale: Address
    lpLocker: Address
    createdAt: bigint
    graduated: boolean
  } | undefined

  const launchInfo: LaunchInfo | undefined = launch ? {
    id: launch.id,
    creator: launch.creator,
    token: launch.token,
    launchType: launch.launchType === 0 ? 'bonding' : 'ico',
    creatorFeeBps: launch.feeConfig.creatorFeeBps,
    communityFeeBps: launch.feeConfig.communityFeeBps,
    bondingCurve: launch.bondingCurve !== '0x0000000000000000000000000000000000000000' ? launch.bondingCurve : null,
    presale: launch.presale !== '0x0000000000000000000000000000000000000000' ? launch.presale : null,
    lpLocker: launch.lpLocker !== '0x0000000000000000000000000000000000000000' ? launch.lpLocker : null,
    createdAt: launch.createdAt,
    graduated: launch.graduated,
  } : undefined

  return {
    launch: launchInfo,
    isLoading,
    error,
    refetch,
  }
}

/**
 * Hook to get all launches by a creator
 */
export function useCreatorLaunches(creator: Address | undefined, chainId: number = JEJU_CHAIN_ID) {
  const contracts = getLaunchpadContracts(chainId)
  const launchpadAddress = contracts?.tokenLaunchpad as Address | undefined

  const { data, isLoading, error, refetch } = useReadContract({
    address: launchpadAddress,
    abi: TokenLaunchpadAbi,
    functionName: 'getCreatorLaunches',
    args: creator ? [creator] : undefined,
    query: { enabled: !!launchpadAddress && !!creator },
  })

  return {
    launchIds: data as bigint[] | undefined,
    isLoading,
    error,
    refetch,
  }
}

