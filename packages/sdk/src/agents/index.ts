/**
 * Agents Module - AI Agent Vault Management
 *
 * Provides access to:
 * - Agent vault creation and management
 * - Vault deposits and withdrawals
 * - Spend authorization
 * - Execution tracking
 * - Room registry for agent communication
 */

import type { NetworkType } from '@jejunetwork/types'
import { type Address, encodeFunctionData, type Hex, parseEther } from 'viem'
import { requireContract } from '../config'
import type { JejuWallet } from '../wallet'

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface Vault {
  agentId: bigint
  owner: Address
  balance: bigint
  spendLimit: bigint
  totalSpent: bigint
  totalDeposits: bigint
  createdAt: bigint
  lastActivityAt: bigint
  active: boolean
}

export interface SpendRecord {
  agentId: bigint
  spender: Address
  recipient: Address
  amount: bigint
  reason: string
  timestamp: bigint
}

export interface Room {
  roomId: Hex
  name: string
  owner: Address
  isPublic: boolean
  createdAt: bigint
  memberCount: number
}

export interface CreateVaultParams {
  agentId: bigint
  initialDeposit?: bigint
}

export interface SpendParams {
  agentId: bigint
  recipient: Address
  amount: bigint
  reason: string
}

export interface CreateRoomParams {
  name: string
  isPublic: boolean
  initialMembers?: Address[]
}

export interface AgentsModule {
  // Vault Management
  createVault(
    params: CreateVaultParams,
  ): Promise<{ txHash: Hex; vaultAddress: Address }>
  getVault(agentId: bigint): Promise<Vault | null>
  getVaultAddress(agentId: bigint): Promise<Address | null>
  getBalance(agentId: bigint): Promise<bigint>
  getVaultInfo(agentId: bigint): Promise<Vault | null>

  // Deposits & Withdrawals
  deposit(agentId: bigint, amount: bigint): Promise<Hex>
  withdraw(agentId: bigint, amount: bigint): Promise<Hex>

  // Spending
  spend(params: SpendParams): Promise<Hex>
  getSpendHistory(agentId: bigint, limit?: number): Promise<SpendRecord[]>

  // Spender Authorization
  approveSpender(agentId: bigint, spender: Address): Promise<Hex>
  revokeSpender(agentId: bigint, spender: Address): Promise<Hex>
  isApprovedSpender(agentId: bigint, spender: Address): Promise<boolean>
  setSpendLimit(agentId: bigint, limit: bigint): Promise<Hex>

  // Vault Status
  deactivateVault(agentId: bigint): Promise<Hex>
  reactivateVault(agentId: bigint): Promise<Hex>

  // Room Registry
  createRoom(params: CreateRoomParams): Promise<{ txHash: Hex; roomId: Hex }>
  getRoom(roomId: Hex): Promise<Room | null>
  joinRoom(roomId: Hex): Promise<Hex>
  leaveRoom(roomId: Hex): Promise<Hex>
  inviteToRoom(roomId: Hex, member: Address): Promise<Hex>
  listRooms(owner?: Address): Promise<Room[]>
  listMyRooms(): Promise<Room[]>
  getRoomMembers(roomId: Hex): Promise<Address[]>

  // Stats
  getTotalVaults(): Promise<bigint>
  getTotalValueLocked(): Promise<bigint>

  // Constants
  readonly DEFAULT_SPEND_LIMIT: bigint
  readonly MIN_VAULT_BALANCE: bigint
}

// ═══════════════════════════════════════════════════════════════════════════
//                              ABIs
// ═══════════════════════════════════════════════════════════════════════════

const AGENT_VAULT_ABI = [
  {
    name: 'createVault',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'spend',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'reason', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'approveSpender',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'revokeSpender',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'setSpendLimit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'limit', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'deactivateVault',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'reactivateVault',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'getVault',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'getBalance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getVaultInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'agentId', type: 'uint256' },
          { name: 'owner', type: 'address' },
          { name: 'balance', type: 'uint256' },
          { name: 'spendLimit', type: 'uint256' },
          { name: 'totalSpent', type: 'uint256' },
          { name: 'totalDeposits', type: 'uint256' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'lastActivityAt', type: 'uint256' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'isApprovedSpender',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'getSpendHistory',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'limit', type: 'uint256' },
    ],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'agentId', type: 'uint256' },
          { name: 'spender', type: 'address' },
          { name: 'recipient', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'reason', type: 'string' },
          { name: 'timestamp', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'totalVaults',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'totalValueLocked',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

const ROOM_REGISTRY_ABI = [
  {
    name: 'createRoom',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'isPublic', type: 'bool' },
      { name: 'initialMembers', type: 'address[]' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'joinRoom',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'roomId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'leaveRoom',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'roomId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'inviteToRoom',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'roomId', type: 'bytes32' },
      { name: 'member', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'getRoom',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'roomId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'roomId', type: 'bytes32' },
          { name: 'name', type: 'string' },
          { name: 'owner', type: 'address' },
          { name: 'isPublic', type: 'bool' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'memberCount', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getRoomMembers',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'roomId', type: 'bytes32' }],
    outputs: [{ type: 'address[]' }],
  },
  {
    name: 'getRoomsByOwner',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'bytes32[]' }],
  },
] as const

// ═══════════════════════════════════════════════════════════════════════════
//                          IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export function createAgentsModule(
  wallet: JejuWallet,
  network: NetworkType,
): AgentsModule {
  const agentVaultAddress = requireContract('agents', 'AgentVault', network)
  const roomRegistryAddress = requireContract('agents', 'RoomRegistry', network)

  const DEFAULT_SPEND_LIMIT = parseEther('0.01')
  const MIN_VAULT_BALANCE = parseEther('0.001')

  return {
    DEFAULT_SPEND_LIMIT,
    MIN_VAULT_BALANCE,

    async createVault(params) {
      const data = encodeFunctionData({
        abi: AGENT_VAULT_ABI,
        functionName: 'createVault',
        args: [params.agentId],
      })

      const txHash = await wallet.sendTransaction({
        to: agentVaultAddress,
        data,
        value: params.initialDeposit ?? 0n,
      })

      const vaultAddress = (await wallet.publicClient.readContract({
        address: agentVaultAddress,
        abi: AGENT_VAULT_ABI,
        functionName: 'getVault',
        args: [params.agentId],
      })) as Address

      return { txHash, vaultAddress }
    },

    async getVault(agentId) {
      return this.getVaultInfo(agentId)
    },

    async getVaultAddress(agentId) {
      const address = (await wallet.publicClient.readContract({
        address: agentVaultAddress,
        abi: AGENT_VAULT_ABI,
        functionName: 'getVault',
        args: [agentId],
      })) as Address

      if (address === '0x0000000000000000000000000000000000000000') {
        return null
      }
      return address
    },

    async getBalance(agentId) {
      return (await wallet.publicClient.readContract({
        address: agentVaultAddress,
        abi: AGENT_VAULT_ABI,
        functionName: 'getBalance',
        args: [agentId],
      })) as bigint
    },

    async getVaultInfo(agentId) {
      const result = await wallet.publicClient.readContract({
        address: agentVaultAddress,
        abi: AGENT_VAULT_ABI,
        functionName: 'getVaultInfo',
        args: [agentId],
      })

      const vault = result as Vault
      if (vault.owner === '0x0000000000000000000000000000000000000000') {
        return null
      }
      return vault
    },

    async deposit(agentId, amount) {
      const data = encodeFunctionData({
        abi: AGENT_VAULT_ABI,
        functionName: 'deposit',
        args: [agentId],
      })

      return wallet.sendTransaction({
        to: agentVaultAddress,
        data,
        value: amount,
      })
    },

    async withdraw(agentId, amount) {
      const data = encodeFunctionData({
        abi: AGENT_VAULT_ABI,
        functionName: 'withdraw',
        args: [agentId, amount],
      })

      return wallet.sendTransaction({
        to: agentVaultAddress,
        data,
      })
    },

    async spend(params) {
      const data = encodeFunctionData({
        abi: AGENT_VAULT_ABI,
        functionName: 'spend',
        args: [params.agentId, params.recipient, params.amount, params.reason],
      })

      return wallet.sendTransaction({
        to: agentVaultAddress,
        data,
      })
    },

    async getSpendHistory(agentId, limit = 100) {
      const result = await wallet.publicClient.readContract({
        address: agentVaultAddress,
        abi: AGENT_VAULT_ABI,
        functionName: 'getSpendHistory',
        args: [agentId, BigInt(limit)],
      })

      return result as SpendRecord[]
    },

    async approveSpender(agentId, spender) {
      const data = encodeFunctionData({
        abi: AGENT_VAULT_ABI,
        functionName: 'approveSpender',
        args: [agentId, spender],
      })

      return wallet.sendTransaction({
        to: agentVaultAddress,
        data,
      })
    },

    async revokeSpender(agentId, spender) {
      const data = encodeFunctionData({
        abi: AGENT_VAULT_ABI,
        functionName: 'revokeSpender',
        args: [agentId, spender],
      })

      return wallet.sendTransaction({
        to: agentVaultAddress,
        data,
      })
    },

    async isApprovedSpender(agentId, spender) {
      return (await wallet.publicClient.readContract({
        address: agentVaultAddress,
        abi: AGENT_VAULT_ABI,
        functionName: 'isApprovedSpender',
        args: [agentId, spender],
      })) as boolean
    },

    async setSpendLimit(agentId, limit) {
      const data = encodeFunctionData({
        abi: AGENT_VAULT_ABI,
        functionName: 'setSpendLimit',
        args: [agentId, limit],
      })

      return wallet.sendTransaction({
        to: agentVaultAddress,
        data,
      })
    },

    async deactivateVault(agentId) {
      const data = encodeFunctionData({
        abi: AGENT_VAULT_ABI,
        functionName: 'deactivateVault',
        args: [agentId],
      })

      return wallet.sendTransaction({
        to: agentVaultAddress,
        data,
      })
    },

    async reactivateVault(agentId) {
      const data = encodeFunctionData({
        abi: AGENT_VAULT_ABI,
        functionName: 'reactivateVault',
        args: [agentId],
      })

      return wallet.sendTransaction({
        to: agentVaultAddress,
        data,
      })
    },

    // Room Registry
    async createRoom(params) {
      const data = encodeFunctionData({
        abi: ROOM_REGISTRY_ABI,
        functionName: 'createRoom',
        args: [params.name, params.isPublic, params.initialMembers ?? []],
      })

      const txHash = await wallet.sendTransaction({
        to: roomRegistryAddress,
        data,
      })

      // Room ID would come from event logs
      return { txHash, roomId: `0x${'0'.repeat(64)}` as Hex }
    },

    async getRoom(roomId) {
      const result = await wallet.publicClient.readContract({
        address: roomRegistryAddress,
        abi: ROOM_REGISTRY_ABI,
        functionName: 'getRoom',
        args: [roomId],
      })

      const room = result as {
        roomId: Hex
        name: string
        owner: Address
        isPublic: boolean
        createdAt: bigint
        memberCount: bigint
      }

      if (room.owner === '0x0000000000000000000000000000000000000000') {
        return null
      }

      return {
        ...room,
        memberCount: Number(room.memberCount),
      }
    },

    async joinRoom(roomId) {
      const data = encodeFunctionData({
        abi: ROOM_REGISTRY_ABI,
        functionName: 'joinRoom',
        args: [roomId],
      })

      return wallet.sendTransaction({
        to: roomRegistryAddress,
        data,
      })
    },

    async leaveRoom(roomId) {
      const data = encodeFunctionData({
        abi: ROOM_REGISTRY_ABI,
        functionName: 'leaveRoom',
        args: [roomId],
      })

      return wallet.sendTransaction({
        to: roomRegistryAddress,
        data,
      })
    },

    async inviteToRoom(roomId, member) {
      const data = encodeFunctionData({
        abi: ROOM_REGISTRY_ABI,
        functionName: 'inviteToRoom',
        args: [roomId, member],
      })

      return wallet.sendTransaction({
        to: roomRegistryAddress,
        data,
      })
    },

    async listRooms(owner) {
      if (!owner) return []

      const roomIds = (await wallet.publicClient.readContract({
        address: roomRegistryAddress,
        abi: ROOM_REGISTRY_ABI,
        functionName: 'getRoomsByOwner',
        args: [owner],
      })) as Hex[]

      const rooms: Room[] = []
      for (const id of roomIds) {
        const room = await this.getRoom(id)
        if (room) rooms.push(room)
      }
      return rooms
    },

    async listMyRooms() {
      return this.listRooms(wallet.address)
    },

    async getRoomMembers(roomId) {
      return (await wallet.publicClient.readContract({
        address: roomRegistryAddress,
        abi: ROOM_REGISTRY_ABI,
        functionName: 'getRoomMembers',
        args: [roomId],
      })) as Address[]
    },

    async getTotalVaults() {
      return (await wallet.publicClient.readContract({
        address: agentVaultAddress,
        abi: AGENT_VAULT_ABI,
        functionName: 'totalVaults',
      })) as bigint
    },

    async getTotalValueLocked() {
      return (await wallet.publicClient.readContract({
        address: agentVaultAddress,
        abi: AGENT_VAULT_ABI,
        functionName: 'totalValueLocked',
      })) as bigint
    },
  }
}
