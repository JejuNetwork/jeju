/**
 * Distributor Module - Airdrops, vesting, and fee distribution
 *
 * Provides access to:
 * - Token airdrops and claims
 * - Vesting schedules
 * - Fee distribution
 * - Staking rewards
 */

import type { NetworkType } from '@jejunetwork/types'
import { type Address, encodeFunctionData, type Hex } from 'viem'
import { requireContract } from '../config'
import { parseIdFromLogs } from '../shared/api'
import type { JejuWallet } from '../wallet'

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface Airdrop {
  airdropId: Hex
  token: Address
  merkleRoot: Hex
  totalAmount: bigint
  claimedAmount: bigint
  startsAt: bigint
  endsAt: bigint
  creator: Address
  isActive: boolean
}

export interface VestingSchedule {
  scheduleId: Hex
  beneficiary: Address
  token: Address
  totalAmount: bigint
  releasedAmount: bigint
  startTime: bigint
  cliffDuration: bigint
  vestingDuration: bigint
  revocable: boolean
  revoked: boolean
}

export interface FeePool {
  poolId: Hex
  token: Address
  totalFees: bigint
  distributedFees: bigint
  lastDistribution: bigint
  rewardRate: bigint
}

export interface CreateAirdropParams {
  token: Address
  merkleRoot: Hex
  totalAmount: bigint
  startsAt?: bigint
  endsAt?: bigint
}

export interface CreateVestingParams {
  beneficiary: Address
  token: Address
  amount: bigint
  startTime?: bigint
  cliffDuration: bigint
  vestingDuration: bigint
  revocable?: boolean
}

export interface DistributorModule {
  // Airdrops
  createAirdrop(
    params: CreateAirdropParams,
  ): Promise<{ airdropId: Hex; txHash: Hex }>
  getAirdrop(airdropId: Hex): Promise<Airdrop | null>
  listActiveAirdrops(): Promise<Airdrop[]>
  claimAirdrop(airdropId: Hex, amount: bigint, merkleProof: Hex[]): Promise<Hex>
  hasClaimed(airdropId: Hex, address?: Address): Promise<boolean>
  getClaimableAmount(
    airdropId: Hex,
    amount: bigint,
    merkleProof: Hex[],
    address?: Address,
  ): Promise<bigint>

  // Vesting
  createVesting(
    params: CreateVestingParams,
  ): Promise<{ scheduleId: Hex; txHash: Hex }>
  getVestingSchedule(scheduleId: Hex): Promise<VestingSchedule | null>
  listMyVestingSchedules(): Promise<VestingSchedule[]>
  getVestedAmount(scheduleId: Hex): Promise<bigint>
  getReleasableAmount(scheduleId: Hex): Promise<bigint>
  releaseVested(scheduleId: Hex): Promise<Hex>
  revokeVesting(scheduleId: Hex): Promise<Hex>

  // Fee Distribution
  getFeePool(token: Address): Promise<FeePool | null>
  claimFeeShare(): Promise<Hex>
  getMyFeeShare(): Promise<bigint>
  distributeFees(token: Address): Promise<Hex>

  // Staking Rewards
  getStakingRewards(staker?: Address): Promise<bigint>
  claimStakingRewards(): Promise<Hex>
  getRewardRate(): Promise<bigint>
}

// ═══════════════════════════════════════════════════════════════════════════
//                              ABIs
// ═══════════════════════════════════════════════════════════════════════════

const AIRDROP_MANAGER_ABI = [
  {
    name: 'createAirdrop',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'merkleRoot', type: 'bytes32' },
      { name: 'totalAmount', type: 'uint256' },
      { name: 'startsAt', type: 'uint256' },
      { name: 'endsAt', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'claim',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'airdropId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
      { name: 'merkleProof', type: 'bytes32[]' },
    ],
    outputs: [],
  },
  {
    name: 'airdrops',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'airdropId', type: 'bytes32' }],
    outputs: [
      { name: 'token', type: 'address' },
      { name: 'merkleRoot', type: 'bytes32' },
      { name: 'totalAmount', type: 'uint256' },
      { name: 'claimedAmount', type: 'uint256' },
      { name: 'startsAt', type: 'uint256' },
      { name: 'endsAt', type: 'uint256' },
      { name: 'creator', type: 'address' },
      { name: 'isActive', type: 'bool' },
    ],
  },
  {
    name: 'hasClaimed',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'airdropId', type: 'bytes32' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'getActiveAirdrops',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bytes32[]' }],
  },
  {
    name: 'getClaimableAmount',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'airdropId', type: 'bytes32' },
      { name: 'account', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'merkleProof', type: 'bytes32[]' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const

const TOKEN_VESTING_ABI = [
  {
    name: 'createVestingSchedule',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'beneficiary', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'startTime', type: 'uint256' },
      { name: 'cliffDuration', type: 'uint256' },
      { name: 'vestingDuration', type: 'uint256' },
      { name: 'revocable', type: 'bool' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'vestingSchedules',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'scheduleId', type: 'bytes32' }],
    outputs: [
      { name: 'beneficiary', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'totalAmount', type: 'uint256' },
      { name: 'releasedAmount', type: 'uint256' },
      { name: 'startTime', type: 'uint256' },
      { name: 'cliffDuration', type: 'uint256' },
      { name: 'vestingDuration', type: 'uint256' },
      { name: 'revocable', type: 'bool' },
      { name: 'revoked', type: 'bool' },
    ],
  },
  {
    name: 'getVestedAmount',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'scheduleId', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getReleasableAmount',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'scheduleId', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'release',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'scheduleId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'revoke',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'scheduleId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'getBeneficiarySchedules',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'beneficiary', type: 'address' }],
    outputs: [{ type: 'bytes32[]' }],
  },
] as const

const FEE_DISTRIBUTOR_ABI = [
  {
    name: 'pools',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      { name: 'totalFees', type: 'uint256' },
      { name: 'distributedFees', type: 'uint256' },
      { name: 'lastDistribution', type: 'uint256' },
      { name: 'rewardRate', type: 'uint256' },
    ],
  },
  {
    name: 'claimable',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'claim',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'distribute',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [],
  },
] as const

const STAKING_REWARD_DISTRIBUTOR_ABI = [
  {
    name: 'earned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getReward',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'rewardRate',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

// ═══════════════════════════════════════════════════════════════════════════
//                          IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export function createDistributorModule(
  wallet: JejuWallet,
  network: NetworkType,
): DistributorModule {
  const airdropManagerAddress = requireContract(
    'distributor',
    'AirdropManager',
    network,
  )
  const tokenVestingAddress = requireContract(
    'distributor',
    'TokenVesting',
    network,
  )
  const feeDistributorAddress = requireContract(
    'distributor',
    'FeeDistributor',
    network,
  )
  const stakingRewardAddress = requireContract(
    'distributor',
    'StakingRewardDistributor',
    network,
  )

  async function readAirdrop(airdropId: Hex): Promise<Airdrop | null> {
    const result = await wallet.publicClient.readContract({
      address: airdropManagerAddress,
      abi: AIRDROP_MANAGER_ABI,
      functionName: 'airdrops',
      args: [airdropId],
    })

    if (result[0] === '0x0000000000000000000000000000000000000000') return null

    return {
      airdropId,
      token: result[0],
      merkleRoot: result[1],
      totalAmount: result[2],
      claimedAmount: result[3],
      startsAt: result[4],
      endsAt: result[5],
      creator: result[6],
      isActive: result[7],
    }
  }

  async function readVestingSchedule(
    scheduleId: Hex,
  ): Promise<VestingSchedule | null> {
    const result = await wallet.publicClient.readContract({
      address: tokenVestingAddress,
      abi: TOKEN_VESTING_ABI,
      functionName: 'vestingSchedules',
      args: [scheduleId],
    })

    if (result[0] === '0x0000000000000000000000000000000000000000') return null

    return {
      scheduleId,
      beneficiary: result[0],
      token: result[1],
      totalAmount: result[2],
      releasedAmount: result[3],
      startTime: result[4],
      cliffDuration: result[5],
      vestingDuration: result[6],
      revocable: result[7],
      revoked: result[8],
    }
  }

  return {
    // Airdrops
    async createAirdrop(params) {
      const now = BigInt(Math.floor(Date.now() / 1000))
      const startsAt = params.startsAt ?? now
      const endsAt = params.endsAt ?? now + 30n * 24n * 60n * 60n // 30 days

      const data = encodeFunctionData({
        abi: AIRDROP_MANAGER_ABI,
        functionName: 'createAirdrop',
        args: [
          params.token,
          params.merkleRoot,
          params.totalAmount,
          startsAt,
          endsAt,
        ],
      })

      const txHash = await wallet.sendTransaction({
        to: airdropManagerAddress,
        data,
      })

      return { airdropId: params.merkleRoot, txHash }
    },

    getAirdrop: readAirdrop,

    async listActiveAirdrops() {
      const ids = await wallet.publicClient.readContract({
        address: airdropManagerAddress,
        abi: AIRDROP_MANAGER_ABI,
        functionName: 'getActiveAirdrops',
        args: [],
      })

      const airdrops: Airdrop[] = []
      for (const id of ids) {
        const airdrop = await readAirdrop(id)
        if (airdrop) airdrops.push(airdrop)
      }
      return airdrops
    },

    async claimAirdrop(airdropId, amount, merkleProof) {
      const data = encodeFunctionData({
        abi: AIRDROP_MANAGER_ABI,
        functionName: 'claim',
        args: [airdropId, amount, merkleProof],
      })
      return wallet.sendTransaction({ to: airdropManagerAddress, data })
    },

    async hasClaimed(airdropId, address) {
      return wallet.publicClient.readContract({
        address: airdropManagerAddress,
        abi: AIRDROP_MANAGER_ABI,
        functionName: 'hasClaimed',
        args: [airdropId, address ?? wallet.address],
      })
    },

    async getClaimableAmount(airdropId, amount, merkleProof, address) {
      // Verify merkle proof and return claimable amount
      // If already claimed, returns 0
      const hasClaimed = await wallet.publicClient.readContract({
        address: airdropManagerAddress,
        abi: AIRDROP_MANAGER_ABI,
        functionName: 'hasClaimed',
        args: [airdropId, address ?? wallet.address],
      })

      if (hasClaimed) return 0n

      // Verify the proof is valid by checking against the contract
      return wallet.publicClient.readContract({
        address: airdropManagerAddress,
        abi: AIRDROP_MANAGER_ABI,
        functionName: 'getClaimableAmount',
        args: [airdropId, address ?? wallet.address, amount, merkleProof],
      })
    },

    // Vesting
    async createVesting(params) {
      const startTime =
        params.startTime ?? BigInt(Math.floor(Date.now() / 1000))

      const data = encodeFunctionData({
        abi: TOKEN_VESTING_ABI,
        functionName: 'createVestingSchedule',
        args: [
          params.beneficiary,
          params.token,
          params.amount,
          startTime,
          params.cliffDuration,
          params.vestingDuration,
          params.revocable ?? false,
        ],
      })

      const txHash = await wallet.sendTransaction({
        to: tokenVestingAddress,
        data,
      })

      // Parse scheduleId from VestingScheduleCreated event
      const scheduleId = await parseIdFromLogs(
        wallet.publicClient,
        txHash,
        'VestingScheduleCreated(bytes32,address,address,uint256)',
        'scheduleId',
      )

      return { scheduleId, txHash }
    },

    getVestingSchedule: readVestingSchedule,

    async listMyVestingSchedules() {
      const ids = await wallet.publicClient.readContract({
        address: tokenVestingAddress,
        abi: TOKEN_VESTING_ABI,
        functionName: 'getBeneficiarySchedules',
        args: [wallet.address],
      })

      const schedules: VestingSchedule[] = []
      for (const id of ids) {
        const schedule = await readVestingSchedule(id)
        if (schedule) schedules.push(schedule)
      }
      return schedules
    },

    async getVestedAmount(scheduleId) {
      return wallet.publicClient.readContract({
        address: tokenVestingAddress,
        abi: TOKEN_VESTING_ABI,
        functionName: 'getVestedAmount',
        args: [scheduleId],
      })
    },

    async getReleasableAmount(scheduleId) {
      return wallet.publicClient.readContract({
        address: tokenVestingAddress,
        abi: TOKEN_VESTING_ABI,
        functionName: 'getReleasableAmount',
        args: [scheduleId],
      })
    },

    async releaseVested(scheduleId) {
      const data = encodeFunctionData({
        abi: TOKEN_VESTING_ABI,
        functionName: 'release',
        args: [scheduleId],
      })
      return wallet.sendTransaction({ to: tokenVestingAddress, data })
    },

    async revokeVesting(scheduleId) {
      const data = encodeFunctionData({
        abi: TOKEN_VESTING_ABI,
        functionName: 'revoke',
        args: [scheduleId],
      })
      return wallet.sendTransaction({ to: tokenVestingAddress, data })
    },

    // Fee Distribution
    async getFeePool(token) {
      const result = await wallet.publicClient.readContract({
        address: feeDistributorAddress,
        abi: FEE_DISTRIBUTOR_ABI,
        functionName: 'pools',
        args: [token],
      })

      return {
        poolId: token as Hex,
        token,
        totalFees: result[0],
        distributedFees: result[1],
        lastDistribution: result[2],
        rewardRate: result[3],
      }
    },

    async claimFeeShare() {
      const data = encodeFunctionData({
        abi: FEE_DISTRIBUTOR_ABI,
        functionName: 'claim',
        args: [],
      })
      return wallet.sendTransaction({ to: feeDistributorAddress, data })
    },

    async getMyFeeShare() {
      return wallet.publicClient.readContract({
        address: feeDistributorAddress,
        abi: FEE_DISTRIBUTOR_ABI,
        functionName: 'claimable',
        args: [wallet.address],
      })
    },

    async distributeFees(token) {
      const data = encodeFunctionData({
        abi: FEE_DISTRIBUTOR_ABI,
        functionName: 'distribute',
        args: [token],
      })
      return wallet.sendTransaction({ to: feeDistributorAddress, data })
    },

    // Staking Rewards
    async getStakingRewards(staker) {
      return wallet.publicClient.readContract({
        address: stakingRewardAddress,
        abi: STAKING_REWARD_DISTRIBUTOR_ABI,
        functionName: 'earned',
        args: [staker ?? wallet.address],
      })
    },

    async claimStakingRewards() {
      const data = encodeFunctionData({
        abi: STAKING_REWARD_DISTRIBUTOR_ABI,
        functionName: 'getReward',
        args: [],
      })
      return wallet.sendTransaction({ to: stakingRewardAddress, data })
    },

    async getRewardRate() {
      return wallet.publicClient.readContract({
        address: stakingRewardAddress,
        abi: STAKING_REWARD_DISTRIBUTOR_ABI,
        functionName: 'rewardRate',
        args: [],
      })
    },
  }
}
