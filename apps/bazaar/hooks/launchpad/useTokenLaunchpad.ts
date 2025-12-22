import { useAccount, useWriteContract, useReadContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther, type Address } from 'viem'
import { AddressSchema } from '@jejunetwork/types'
import { expect, expectTrue, expectPositive } from '@/lib/validation'
import { TokenLaunchpadAbi } from '@jejunetwork/contracts'
import { getLaunchpadContracts, hasLaunchpad } from '@/config/contracts'
import { JEJU_CHAIN_ID } from '@/config/chains'
import {
  validateBondingCurveLaunch,
  validateICOLaunch,
  type BondingCurveConfig,
  type ICOConfig,
  type LaunchInfo,
} from '@/lib/launchpad'

export type { BondingCurveConfig, ICOConfig, LaunchInfo }

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
    const validatedLaunchpadAddress = expect(launchpadAddress, 'Launchpad not available on this chain');
    AddressSchema.parse(validatedLaunchpadAddress);

    expectTrue(name.length > 0, 'Name cannot be empty');
    expectTrue(symbol.length > 0, 'Symbol cannot be empty');
    expectTrue(creatorFeeBps >= 0 && creatorFeeBps <= 10000, 'CreatorFeeBps must be between 0 and 10000');
    expectPositive(parseFloat(config.virtualEthReserves), 'VirtualEthReserves must be positive');
    expectPositive(parseFloat(config.graduationTarget), 'GraduationTarget must be positive');
    expectPositive(parseFloat(config.tokenSupply), 'TokenSupply must be positive');
    
    const validatedCommunityVault = communityVault ? AddressSchema.parse(communityVault) : '0x0000000000000000000000000000000000000000' as Address;

    writeContract({
      address: validatedLaunchpadAddress,
      abi: TokenLaunchpadAbi,
      functionName: 'launchBondingCurve',
      args: [
        name,
        symbol,
        creatorFeeBps,
        validatedCommunityVault,
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
    const validatedLaunchpadAddress = expect(launchpadAddress, 'Launchpad not available on this chain');
    AddressSchema.parse(validatedLaunchpadAddress);
    
    expectTrue(name.length > 0, 'Name cannot be empty');
    expectTrue(symbol.length > 0, 'Symbol cannot be empty');
    expectPositive(parseFloat(totalSupply), 'TotalSupply must be positive');
    expectTrue(creatorFeeBps >= 0 && creatorFeeBps <= 10000, 'CreatorFeeBps must be between 0 and 10000');
    expectPositive(parseFloat(config.presalePrice), 'PresalePrice must be positive');
    expectTrue(config.presaleAllocationBps >= 0 && config.presaleAllocationBps <= 10000, 'PresaleAllocationBps must be between 0 and 10000');
    expectTrue(config.lpFundingBps >= 0 && config.lpFundingBps <= 10000, 'LpFundingBps must be between 0 and 10000');
    expectPositive(parseFloat(config.softCap), 'SoftCap must be positive');
    expectPositive(parseFloat(config.hardCap), 'HardCap must be positive');
    expectTrue(parseFloat(config.hardCap) >= parseFloat(config.softCap), 'HardCap must be >= SoftCap');
    expectPositive(config.presaleDuration, 'PresaleDuration must be positive');
    
    const validatedCommunityVault = communityVault ? AddressSchema.parse(communityVault) : '0x0000000000000000000000000000000000000000' as Address;

    writeContract({
      address: validatedLaunchpadAddress,
      abi: TokenLaunchpadAbi,
      functionName: 'launchICO',
      args: [
        name,
        symbol,
        parseEther(totalSupply),
        creatorFeeBps,
        validatedCommunityVault,
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

