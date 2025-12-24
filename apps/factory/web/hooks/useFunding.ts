import { deepFundingDistributorAbi } from '@jejunetwork/contracts'
import { isRecord } from '@jejunetwork/types'
import type { Address } from 'viem'
import {
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import {
  bigIntEpochToNumber,
  bigIntToNumber,
} from '../../lib/validation/bigint-utils'
import { addresses } from '../config/contracts'
import {
  type ContributorShareTuple,
  type DAOPoolTuple,
  type DependencyShareTuple,
  type FeeDistributionConfigTuple,
  type FundingEpochTuple,
  type Hex,
  isZeroBytes32,
  toHex,
  type WeightVoteTuple,
  ZERO_BYTES32,
} from '../lib/contract-types'
import type {
  ContributorShare,
  DAOPool,
  DependencyShare,
  FeeDistributionConfig,
  FundingEpoch,
  WeightVote,
} from '../types/funding'

function getAddress(): Address {
  return addresses.deepFundingDistributor
}

function parseDAOPool(data: DAOPoolTuple): DAOPool {
  return {
    daoId: data.daoId,
    token: data.token,
    totalAccumulated: data.totalAccumulated,
    contributorPool: data.contributorPool,
    dependencyPool: data.dependencyPool,
    reservePool: data.reservePool,
    lastDistributedEpoch: Number(data.lastDistributedEpoch),
    epochStartTime: Number(data.epochStartTime),
  }
}

function parseFundingEpoch(data: FundingEpochTuple): FundingEpoch {
  return {
    epochId: Number(data.epochId),
    daoId: data.daoId,
    startTime: Number(data.startTime),
    endTime: Number(data.endTime),
    totalContributorRewards: data.totalContributorRewards,
    totalDependencyRewards: data.totalDependencyRewards,
    totalDistributed: data.totalDistributed,
    finalized: data.finalized,
  }
}

function parseContributorShare(data: ContributorShareTuple): ContributorShare {
  return {
    contributorId: data.contributorId,
    weight: Number(data.weight),
    pendingRewards: data.pendingRewards,
    claimedRewards: data.claimedRewards,
    lastClaimEpoch: Number(data.lastClaimEpoch),
  }
}

function parseDependencyShare(data: DependencyShareTuple): DependencyShare {
  return {
    depHash: data.depHash,
    contributorId: data.contributorId,
    weight: Number(data.weight),
    transitiveDepth: Number(data.transitiveDepth),
    usageCount: Number(data.usageCount),
    pendingRewards: data.pendingRewards,
    claimedRewards: data.claimedRewards,
    isRegistered: data.isRegistered,
  }
}

function parseFeeConfig(
  data: FeeDistributionConfigTuple,
): FeeDistributionConfig {
  return {
    treasuryBps: Number(data.treasuryBps),
    contributorPoolBps: Number(data.contributorPoolBps),
    dependencyPoolBps: Number(data.dependencyPoolBps),
    jejuBps: Number(data.jejuBps),
    burnBps: Number(data.burnBps),
    reserveBps: Number(data.reserveBps),
  }
}

function parseWeightVote(data: WeightVoteTuple): WeightVote {
  return {
    voter: data.voter,
    targetId: data.targetId,
    weightAdjustment: bigIntToNumber(data.weightAdjustment, 'weightAdjustment'),
    reason: data.reason,
    reputation: bigIntToNumber(data.reputation, 'reputation'),
    votedAt: bigIntEpochToNumber(data.votedAt),
  }
}

function isDAOPoolTuple(data: unknown): data is DAOPoolTuple {
  return (
    isRecord(data) &&
    typeof data.daoId === 'string' &&
    typeof data.token === 'string'
  )
}

function isFundingEpochTuple(data: unknown): data is FundingEpochTuple {
  return (
    isRecord(data) &&
    typeof data.epochId === 'bigint' &&
    typeof data.daoId === 'string'
  )
}

function isContributorShareTuple(data: unknown): data is ContributorShareTuple {
  return isRecord(data) && typeof data.contributorId === 'string'
}

function isDependencyShareTuple(data: unknown): data is DependencyShareTuple {
  return isRecord(data) && typeof data.depHash === 'string'
}

function isFeeDistributionConfigTuple(
  data: unknown,
): data is FeeDistributionConfigTuple {
  return isRecord(data) && typeof data.treasuryBps === 'bigint'
}

function isWeightVoteTupleArray(data: unknown): data is WeightVoteTuple[] {
  return Array.isArray(data)
}

export function useDAOPool(daoId: string | undefined) {
  const daoIdHex = daoId ? toHex(daoId) : undefined
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: deepFundingDistributorAbi,
    functionName: 'getDAOPool',
    args: daoIdHex ? [daoIdHex] : undefined,
    query: { enabled: !!daoIdHex },
  })

  const pool: DAOPool | null =
    isDAOPoolTuple(data) && !isZeroBytes32(data.daoId)
      ? parseDAOPool(data)
      : null

  return { pool, isLoading, error, refetch }
}

export function useCurrentEpoch(daoId: string | undefined) {
  const daoIdHex = daoId ? toHex(daoId) : undefined
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: deepFundingDistributorAbi,
    functionName: 'getCurrentEpoch',
    args: daoIdHex ? [daoIdHex] : undefined,
    query: { enabled: !!daoIdHex },
  })

  const epoch: FundingEpoch | null =
    isFundingEpochTuple(data) && data.epochId !== 0n
      ? parseFundingEpoch(data)
      : null

  return { epoch, isLoading, error, refetch }
}

export function useEpoch(
  daoId: string | undefined,
  epochId: number | undefined,
) {
  const daoIdHex = daoId ? toHex(daoId) : undefined
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: deepFundingDistributorAbi,
    functionName: 'getEpoch',
    args:
      daoIdHex && epochId !== undefined
        ? [daoIdHex, BigInt(epochId)]
        : undefined,
    query: { enabled: !!daoIdHex && epochId !== undefined },
  })

  const epoch: FundingEpoch | null = isFundingEpochTuple(data)
    ? parseFundingEpoch(data)
    : null

  return { epoch, isLoading, error, refetch }
}

export function useContributorShare(
  daoId: string | undefined,
  epochId: number | undefined,
  contributorId: string | undefined,
) {
  const daoIdHex = daoId ? toHex(daoId) : undefined
  const contributorIdHex = contributorId ? toHex(contributorId) : undefined
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: deepFundingDistributorAbi,
    functionName: 'getContributorShare',
    args:
      daoIdHex && epochId !== undefined && contributorIdHex
        ? [daoIdHex, BigInt(epochId), contributorIdHex]
        : undefined,
    query: {
      enabled: !!daoIdHex && epochId !== undefined && !!contributorIdHex,
    },
  })

  const share: ContributorShare | null =
    isContributorShareTuple(data) && !isZeroBytes32(data.contributorId)
      ? parseContributorShare(data)
      : null

  return { share, isLoading, error, refetch }
}

export function useDependencyShare(
  daoId: string | undefined,
  depHash: string | undefined,
) {
  const daoIdHex = daoId ? toHex(daoId) : undefined
  const depHashHex = depHash ? toHex(depHash) : undefined
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: deepFundingDistributorAbi,
    functionName: 'getDependencyShare',
    args: daoIdHex && depHashHex ? [daoIdHex, depHashHex] : undefined,
    query: { enabled: !!daoIdHex && !!depHashHex },
  })

  const share: DependencyShare | null =
    isDependencyShareTuple(data) && !isZeroBytes32(data.depHash)
      ? parseDependencyShare(data)
      : null

  return { share, isLoading, error, refetch }
}

export function useDAOFundingConfig(daoId: string | undefined) {
  const daoIdHex = daoId ? toHex(daoId) : undefined
  const { data, isLoading, error } = useReadContract({
    address: getAddress(),
    abi: deepFundingDistributorAbi,
    functionName: 'getDAOConfig',
    args: daoIdHex ? [daoIdHex] : undefined,
    query: { enabled: !!daoIdHex },
  })

  const config: FeeDistributionConfig | null = isFeeDistributionConfigTuple(
    data,
  )
    ? parseFeeConfig(data)
    : null

  return { config, isLoading, error }
}

export function useEpochVotes(
  daoId: string | undefined,
  epochId: number | undefined,
) {
  const daoIdHex = daoId ? toHex(daoId) : undefined
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: deepFundingDistributorAbi,
    functionName: 'getEpochVotes',
    args:
      daoIdHex && epochId !== undefined
        ? [daoIdHex, BigInt(epochId)]
        : undefined,
    query: { enabled: !!daoIdHex && epochId !== undefined },
  })

  const votes: WeightVote[] = isWeightVoteTupleArray(data)
    ? data.map(parseWeightVote)
    : []

  return { votes, isLoading, error, refetch }
}

export function usePendingContributorRewards(
  daoId: string | undefined,
  contributorId: string | undefined,
) {
  const daoIdHex = daoId ? toHex(daoId) : undefined
  const contributorIdHex = contributorId ? toHex(contributorId) : undefined
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: deepFundingDistributorAbi,
    functionName: 'getPendingContributorRewards',
    args:
      daoIdHex && contributorIdHex ? [daoIdHex, contributorIdHex] : undefined,
    query: { enabled: !!daoIdHex && !!contributorIdHex },
  })

  return { rewards: data ?? 0n, isLoading, error, refetch }
}

export function useDefaultFundingConfig() {
  const { data, isLoading, error } = useReadContract({
    address: getAddress(),
    abi: deepFundingDistributorAbi,
    functionName: 'defaultConfig',
  })

  const config: FeeDistributionConfig | null = isFeeDistributionConfigTuple(
    data,
  )
    ? parseFeeConfig(data)
    : null

  return { config, isLoading, error }
}

export function useDepositFees() {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const deposit = (daoId: string, source: string, amount: bigint) => {
    writeContract({
      address: getAddress(),
      abi: deepFundingDistributorAbi,
      functionName: 'depositFees',
      args: [toHex(daoId), source],
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
      abi: deepFundingDistributorAbi,
      functionName: 'voteOnWeight',
      args: [
        toHex(daoId),
        toHex(targetId),
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
      abi: deepFundingDistributorAbi,
      functionName: 'finalizeEpoch',
      args: [toHex(daoId)],
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
      abi: deepFundingDistributorAbi,
      functionName: 'claimContributorRewards',
      args: [toHex(daoId), toHex(contributorId), epochs.map(BigInt), recipient],
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
      abi: deepFundingDistributorAbi,
      functionName: 'claimDependencyRewards',
      args: [toHex(daoId), toHex(depHash), recipient],
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
      abi: deepFundingDistributorAbi,
      functionName: 'setContributorWeight',
      args: [toHex(daoId), toHex(contributorId), BigInt(weight)],
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
    const maintainerId: Hex = maintainerContributorId
      ? toHex(maintainerContributorId)
      : ZERO_BYTES32
    writeContract({
      address: getAddress(),
      abi: deepFundingDistributorAbi,
      functionName: 'registerDependency',
      args: [
        toHex(daoId),
        packageName,
        registryType,
        maintainerId,
        BigInt(weight),
        BigInt(transitiveDepth),
        BigInt(usageCount),
      ],
    })
  }

  return { register, hash, isPending, isConfirming, isSuccess, error }
}
