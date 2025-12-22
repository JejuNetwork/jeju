import type { Address } from 'viem'
import { parseAbi } from 'viem'
import {
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import {
  bigIntEpochToNumber,
  bigIntToNumber,
} from '../lib/validation/bigint-utils'
import type {
  ContributorShare,
  DAOPool,
  DependencyShare,
  FeeDistributionConfig,
  FundingEpoch,
  WeightVote,
} from '../types/funding'

// ============ Contract ABI ============

const DEEP_FUNDING_DISTRIBUTOR_ABI = parseAbi([
  'function depositFees(bytes32 daoId, string source) external payable',
  'function setContributorWeight(bytes32 daoId, bytes32 contributorId, uint256 weight) external',
  'function registerDependency(bytes32 daoId, string packageName, string registryType, bytes32 maintainerContributorId, uint256 weight, uint256 transitiveDepth, uint256 usageCount) external',
  'function voteOnWeight(bytes32 daoId, bytes32 targetId, int256 adjustment, string reason, uint256 reputation) external',
  'function finalizeEpoch(bytes32 daoId) external',
  'function claimContributorRewards(bytes32 daoId, bytes32 contributorId, uint256[] epochs, address recipient) external',
  'function claimDependencyRewards(bytes32 daoId, bytes32 depHash, address recipient) external',
  'function getDAOPool(bytes32 daoId) external view returns (tuple(bytes32 daoId, address token, uint256 totalAccumulated, uint256 contributorPool, uint256 dependencyPool, uint256 reservePool, uint256 lastDistributedEpoch, uint256 epochStartTime))',
  'function getCurrentEpoch(bytes32 daoId) external view returns (tuple(uint256 epochId, bytes32 daoId, uint256 startTime, uint256 endTime, uint256 totalContributorRewards, uint256 totalDependencyRewards, uint256 totalDistributed, bool finalized))',
  'function getEpoch(bytes32 daoId, uint256 epochId) external view returns (tuple(uint256 epochId, bytes32 daoId, uint256 startTime, uint256 endTime, uint256 totalContributorRewards, uint256 totalDependencyRewards, uint256 totalDistributed, bool finalized))',
  'function getContributorShare(bytes32 daoId, uint256 epochId, bytes32 contributorId) external view returns (tuple(bytes32 contributorId, uint256 weight, uint256 pendingRewards, uint256 claimedRewards, uint256 lastClaimEpoch))',
  'function getDependencyShare(bytes32 daoId, bytes32 depHash) external view returns (tuple(bytes32 depHash, bytes32 contributorId, uint256 weight, uint256 transitiveDepth, uint256 usageCount, uint256 pendingRewards, uint256 claimedRewards, bool isRegistered))',
  'function getDAOConfig(bytes32 daoId) external view returns (tuple(uint256 treasuryBps, uint256 contributorPoolBps, uint256 dependencyPoolBps, uint256 jejuBps, uint256 burnBps, uint256 reserveBps))',
  'function getEpochVotes(bytes32 daoId, uint256 epochId) external view returns (tuple(address voter, bytes32 targetId, int256 weightAdjustment, string reason, uint256 reputation, uint256 votedAt)[])',
  'function getPendingContributorRewards(bytes32 daoId, bytes32 contributorId) external view returns (uint256)',
  'function defaultConfig() external view returns (tuple(uint256 treasuryBps, uint256 contributorPoolBps, uint256 dependencyPoolBps, uint256 jejuBps, uint256 burnBps, uint256 reserveBps))',
])

// ============ Config ============

import { addresses } from '../config/contracts'

function getAddress(): Address {
  return addresses.deepFundingDistributor
}

// ============ Read Hooks ============

export function useDAOPool(daoId: string | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
    functionName: 'getDAOPool',
    args: daoId ? [daoId as `0x${string}`] : undefined,
    query: { enabled: !!daoId },
  })

  const pool: DAOPool | null =
    data && (data as [string])[0] !== `0x${'0'.repeat(64)}`
      ? {
          daoId: (data as [string])[0],
          token: (data as [string, Address])[1],
          totalAccumulated: (data as [string, Address, bigint])[2],
          contributorPool: (data as [string, Address, bigint, bigint])[3],
          dependencyPool: (
            data as [string, Address, bigint, bigint, bigint]
          )[4],
          reservePool: (
            data as [string, Address, bigint, bigint, bigint, bigint]
          )[5],
          lastDistributedEpoch: Number(
            (
              data as [string, Address, bigint, bigint, bigint, bigint, bigint]
            )[6],
          ),
          epochStartTime: Number(
            (
              data as [
                string,
                Address,
                bigint,
                bigint,
                bigint,
                bigint,
                bigint,
                bigint,
              ]
            )[7],
          ),
        }
      : null

  return { pool, isLoading, error, refetch }
}

export function useCurrentEpoch(daoId: string | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
    functionName: 'getCurrentEpoch',
    args: daoId ? [daoId as `0x${string}`] : undefined,
    query: { enabled: !!daoId },
  })

  const epoch: FundingEpoch | null =
    data && (data as [bigint])[0] !== 0n
      ? {
          epochId: Number((data as [bigint])[0]),
          daoId: (data as [bigint, string])[1],
          startTime: Number((data as [bigint, string, bigint])[2]),
          endTime: Number((data as [bigint, string, bigint, bigint])[3]),
          totalContributorRewards: (
            data as [bigint, string, bigint, bigint, bigint]
          )[4],
          totalDependencyRewards: (
            data as [bigint, string, bigint, bigint, bigint, bigint]
          )[5],
          totalDistributed: (
            data as [bigint, string, bigint, bigint, bigint, bigint, bigint]
          )[6],
          finalized: (
            data as [
              bigint,
              string,
              bigint,
              bigint,
              bigint,
              bigint,
              bigint,
              boolean,
            ]
          )[7],
        }
      : null

  return { epoch, isLoading, error, refetch }
}

export function useEpoch(
  daoId: string | undefined,
  epochId: number | undefined,
) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
    functionName: 'getEpoch',
    args:
      daoId && epochId !== undefined
        ? [daoId as `0x${string}`, BigInt(epochId)]
        : undefined,
    query: { enabled: !!daoId && epochId !== undefined },
  })

  const epoch: FundingEpoch | null = data
    ? {
        epochId: Number((data as [bigint])[0]),
        daoId: (data as [bigint, string])[1],
        startTime: Number((data as [bigint, string, bigint])[2]),
        endTime: Number((data as [bigint, string, bigint, bigint])[3]),
        totalContributorRewards: (
          data as [bigint, string, bigint, bigint, bigint]
        )[4],
        totalDependencyRewards: (
          data as [bigint, string, bigint, bigint, bigint, bigint]
        )[5],
        totalDistributed: (
          data as [bigint, string, bigint, bigint, bigint, bigint, bigint]
        )[6],
        finalized: (
          data as [
            bigint,
            string,
            bigint,
            bigint,
            bigint,
            bigint,
            bigint,
            boolean,
          ]
        )[7],
      }
    : null

  return { epoch, isLoading, error, refetch }
}

export function useContributorShare(
  daoId: string | undefined,
  epochId: number | undefined,
  contributorId: string | undefined,
) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
    functionName: 'getContributorShare',
    args:
      daoId && epochId !== undefined && contributorId
        ? [
            daoId as `0x${string}`,
            BigInt(epochId),
            contributorId as `0x${string}`,
          ]
        : undefined,
    query: { enabled: !!daoId && epochId !== undefined && !!contributorId },
  })

  const share: ContributorShare | null =
    data && (data as [string])[0] !== `0x${'0'.repeat(64)}`
      ? {
          contributorId: (data as [string])[0],
          weight: Number((data as [string, bigint])[1]),
          pendingRewards: (data as [string, bigint, bigint])[2],
          claimedRewards: (data as [string, bigint, bigint, bigint])[3],
          lastClaimEpoch: Number(
            (data as [string, bigint, bigint, bigint, bigint])[4],
          ),
        }
      : null

  return { share, isLoading, error, refetch }
}

export function useDependencyShare(
  daoId: string | undefined,
  depHash: string | undefined,
) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
    functionName: 'getDependencyShare',
    args:
      daoId && depHash
        ? [daoId as `0x${string}`, depHash as `0x${string}`]
        : undefined,
    query: { enabled: !!daoId && !!depHash },
  })

  const share: DependencyShare | null =
    data && (data as [string])[0] !== `0x${'0'.repeat(64)}`
      ? {
          depHash: (data as [string])[0],
          contributorId: (data as [string, string])[1],
          weight: Number((data as [string, string, bigint])[2]),
          transitiveDepth: Number(
            (data as [string, string, bigint, bigint])[3],
          ),
          usageCount: Number(
            (data as [string, string, bigint, bigint, bigint])[4],
          ),
          pendingRewards: (
            data as [string, string, bigint, bigint, bigint, bigint]
          )[5],
          claimedRewards: (
            data as [string, string, bigint, bigint, bigint, bigint, bigint]
          )[6],
          isRegistered: (
            data as [
              string,
              string,
              bigint,
              bigint,
              bigint,
              bigint,
              bigint,
              boolean,
            ]
          )[7],
        }
      : null

  return { share, isLoading, error, refetch }
}

export function useDAOFundingConfig(daoId: string | undefined) {
  const { data, isLoading, error } = useReadContract({
    address: getAddress(),
    abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
    functionName: 'getDAOConfig',
    args: daoId ? [daoId as `0x${string}`] : undefined,
    query: { enabled: !!daoId },
  })

  const config: FeeDistributionConfig | null = data
    ? {
        treasuryBps: Number((data as [bigint])[0]),
        contributorPoolBps: Number((data as [bigint, bigint])[1]),
        dependencyPoolBps: Number((data as [bigint, bigint, bigint])[2]),
        jejuBps: Number((data as [bigint, bigint, bigint, bigint])[3]),
        burnBps: Number((data as [bigint, bigint, bigint, bigint, bigint])[4]),
        reserveBps: Number(
          (data as [bigint, bigint, bigint, bigint, bigint, bigint])[5],
        ),
      }
    : null

  return { config, isLoading, error }
}

export function useEpochVotes(
  daoId: string | undefined,
  epochId: number | undefined,
) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
    functionName: 'getEpochVotes',
    args:
      daoId && epochId !== undefined
        ? [daoId as `0x${string}`, BigInt(epochId)]
        : undefined,
    query: { enabled: !!daoId && epochId !== undefined },
  })

  const votes: WeightVote[] = data
    ? (data as Array<[Address, string, bigint, string, bigint, bigint]>).map(
        (v) => ({
          voter: v[0],
          targetId: v[1],
          // Use safe conversion with validation for values that should fit in Number
          weightAdjustment: bigIntToNumber(v[2], 'weightAdjustment'),
          reason: v[3],
          reputation: bigIntToNumber(v[4], 'reputation'),
          votedAt: bigIntEpochToNumber(v[5]),
        }),
      )
    : []

  return { votes, isLoading, error, refetch }
}

export function usePendingContributorRewards(
  daoId: string | undefined,
  contributorId: string | undefined,
) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
    functionName: 'getPendingContributorRewards',
    args:
      daoId && contributorId
        ? [daoId as `0x${string}`, contributorId as `0x${string}`]
        : undefined,
    query: { enabled: !!daoId && !!contributorId },
  })

  return { rewards: (data as bigint) || 0n, isLoading, error, refetch }
}

export function useDefaultFundingConfig() {
  const { data, isLoading, error } = useReadContract({
    address: getAddress(),
    abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
    functionName: 'defaultConfig',
  })

  const config: FeeDistributionConfig | null = data
    ? {
        treasuryBps: Number((data as [bigint])[0]),
        contributorPoolBps: Number((data as [bigint, bigint])[1]),
        dependencyPoolBps: Number((data as [bigint, bigint, bigint])[2]),
        jejuBps: Number((data as [bigint, bigint, bigint, bigint])[3]),
        burnBps: Number((data as [bigint, bigint, bigint, bigint, bigint])[4]),
        reserveBps: Number(
          (data as [bigint, bigint, bigint, bigint, bigint, bigint])[5],
        ),
      }
    : null

  return { config, isLoading, error }
}

// ============ Write Hooks ============

export function useDepositFees() {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const deposit = (daoId: string, source: string, amount: bigint) => {
    writeContract({
      address: getAddress(),
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'depositFees',
      args: [daoId as `0x${string}`, source],
      value: amount,
    })
  }

  return { deposit, hash, isPending, isConfirming, isSuccess, error }
}

export function useVoteOnWeight() {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const vote = (
    daoId: string,
    targetId: string,
    adjustment: number,
    reason: string,
    reputation: number,
  ) => {
    writeContract({
      address: getAddress(),
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'voteOnWeight',
      args: [
        daoId as `0x${string}`,
        targetId as `0x${string}`,
        BigInt(adjustment),
        reason,
        BigInt(reputation),
      ],
    })
  }

  return { vote, hash, isPending, isConfirming, isSuccess, error }
}

export function useFinalizeEpoch() {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const finalize = (daoId: string) => {
    writeContract({
      address: getAddress(),
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'finalizeEpoch',
      args: [daoId as `0x${string}`],
    })
  }

  return { finalize, hash, isPending, isConfirming, isSuccess, error }
}

export function useClaimContributorRewards() {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const claim = (
    daoId: string,
    contributorId: string,
    epochs: number[],
    recipient: Address,
  ) => {
    writeContract({
      address: getAddress(),
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'claimContributorRewards',
      args: [
        daoId as `0x${string}`,
        contributorId as `0x${string}`,
        epochs.map(BigInt),
        recipient,
      ],
    })
  }

  return { claim, hash, isPending, isConfirming, isSuccess, error }
}

export function useClaimDependencyRewards() {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const claim = (daoId: string, depHash: string, recipient: Address) => {
    writeContract({
      address: getAddress(),
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'claimDependencyRewards',
      args: [daoId as `0x${string}`, depHash as `0x${string}`, recipient],
    })
  }

  return { claim, hash, isPending, isConfirming, isSuccess, error }
}

export function useSetContributorWeight() {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const setWeight = (daoId: string, contributorId: string, weight: number) => {
    writeContract({
      address: getAddress(),
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'setContributorWeight',
      args: [
        daoId as `0x${string}`,
        contributorId as `0x${string}`,
        BigInt(weight),
      ],
    })
  }

  return { setWeight, hash, isPending, isConfirming, isSuccess, error }
}

export function useRegisterDependency() {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const register = (
    daoId: string,
    packageName: string,
    registryType: string,
    maintainerContributorId: string | null,
    weight: number,
    transitiveDepth: number,
    usageCount: number,
  ) => {
    const maintainerId = maintainerContributorId || `0x${'0'.repeat(64)}`
    writeContract({
      address: getAddress(),
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'registerDependency',
      args: [
        daoId as `0x${string}`,
        packageName,
        registryType,
        maintainerId as `0x${string}`,
        BigInt(weight),
        BigInt(transitiveDepth),
        BigInt(usageCount),
      ],
    })
  }

  return { register, hash, isPending, isConfirming, isSuccess, error }
}
