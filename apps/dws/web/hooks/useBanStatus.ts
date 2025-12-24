import { useAccount, useReadContract } from 'wagmi'
import { CONTRACTS } from '../config'

const BAN_MANAGER_ABI = [
  {
    name: 'isAddressBanned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getAddressBanRecord',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'isBanned', type: 'bool' },
          { name: 'banType', type: 'uint8' },
          { name: 'bannedAt', type: 'uint256' },
          { name: 'expiresAt', type: 'uint256' },
          { name: 'reason', type: 'string' },
          { name: 'proposalId', type: 'bytes32' },
          { name: 'reporter', type: 'address' },
          { name: 'caseId', type: 'bytes32' },
        ],
      },
    ],
  },
] as const

export function useBanStatus() {
  const { address, isConnected } = useAccount()

  const { data: isBanned, isLoading } = useReadContract({
    address: CONTRACTS.banManager,
    abi: BAN_MANAGER_ABI,
    functionName: 'isAddressBanned',
    args: address ? [address] : undefined,
    query: {
      enabled:
        isConnected &&
        !!address &&
        CONTRACTS.banManager !== '0x0000000000000000000000000000000000000000',
    },
  })

  const { data: banRecord } = useReadContract({
    address: CONTRACTS.banManager,
    abi: BAN_MANAGER_ABI,
    functionName: 'getAddressBanRecord',
    args: address ? [address] : undefined,
    query: {
      enabled: isConnected && !!address && isBanned === true,
    },
  })

  return {
    isBanned: isBanned ?? false,
    isLoading,
    banRecord: banRecord as
      | {
          isBanned: boolean
          banType: number
          bannedAt: bigint
          expiresAt: bigint
          reason: string
          proposalId: string
          reporter: string
          caseId: string
        }
      | undefined,
  }
}
