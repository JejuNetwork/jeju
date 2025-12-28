/**
 * Room SDK - Manages multi-agent coordination rooms.
 */

import {
  type Address,
  encodeAbiParameters,
  type PublicClient,
  parseAbi,
  parseAbiParameters,
} from 'viem'
import type {
  AgentRole,
  CrucibleConfig,
  Room,
  RoomConfig,
  RoomMember,
  RoomMessage,
  RoomPhase,
  RoomState,
  RoomType,
} from '../../lib/types'
import { expect, expectTrue } from '../schemas'
import type { KMSSigner } from './kms-signer'
import { createLogger, type Logger } from './logger'
import type { CrucibleStorage } from './storage'

/** Room data tuple from contract storage mapping */
type RoomDataTuple = [
  bigint, // roomId
  Address, // owner
  string, // name
  string, // description
  string, // stateCid
  number, // roomType
  number, // phase
  bigint, // maxMembers
  boolean, // turnBased
  bigint, // turnTimeout
  bigint, // createdAt
  bigint, // updatedAt
  boolean, // active
]

/** Room member data from contract */
interface RoomMemberData {
  agentId: bigint
  role: number
  score: bigint
  joinedAt: bigint
  lastActiveAt: bigint
  messageCount: bigint
  active: boolean
}

// Full ABI to access all contract data
const ROOM_REGISTRY_ABI = parseAbi([
  'function createRoom(string name, string description, uint8 roomType, bytes config) external returns (uint256 roomId)',
  'function getRoom(uint256 roomId) external view returns (address owner, string name, string stateCid, uint8 roomType, bool active)',
  'function joinRoom(uint256 roomId, uint256 agentId, uint8 role) external',
  'function leaveRoom(uint256 roomId, uint256 agentId) external',
  'function updateRoomState(uint256 roomId, string stateCid) external',
  'function getMembers(uint256 roomId) external view returns (uint256[], uint8[])',
  'function getMember(uint256 roomId, uint256 agentId) external view returns ((uint256 agentId, uint8 role, int256 score, uint256 joinedAt, uint256 lastActiveAt, uint256 messageCount, bool active))',
  'function setPhase(uint256 roomId, uint8 phase) external',
  'function rooms(uint256 roomId) external view returns (uint256 roomId, address owner, string name, string description, string stateCid, uint8 roomType, uint8 phase, uint256 maxMembers, bool turnBased, uint256 turnTimeout, uint256 createdAt, uint256 updatedAt, bool active)',
  'event RoomCreated(uint256 indexed roomId, address owner, string name)',
  'event MemberJoined(uint256 indexed roomId, uint256 indexed agentId, uint8 role)',
  'event StateUpdated(uint256 indexed roomId, string stateCid)',
])

export interface RoomSDKConfig {
  crucibleConfig: CrucibleConfig
  storage: CrucibleStorage
  publicClient: PublicClient
  /** KMS-backed signer for threshold signing */
  kmsSigner: KMSSigner
  logger?: Logger
}

export class RoomSDK {
  private config: CrucibleConfig
  private storage: CrucibleStorage
  private publicClient: PublicClient
  private kmsSigner: KMSSigner
  private log: Logger

  constructor(sdkConfig: RoomSDKConfig) {
    this.config = sdkConfig.crucibleConfig
    this.storage = sdkConfig.storage
    this.publicClient = sdkConfig.publicClient
    this.kmsSigner = sdkConfig.kmsSigner
    this.kmsSigner = sdkConfig.kmsSigner
    this.log = sdkConfig.logger ?? createLogger('RoomSDK')
  }

  /**
   * Check if write operations are available (KMS configured)
   */
  canWrite(): boolean {
    return this.kmsSigner.isInitialized()
  }

  /**
   * Execute a contract write using KMS
   */
  private async executeWrite(params: {
    address: Address
    abi: readonly unknown[]
    functionName: string
    args?: readonly unknown[]
    value?: bigint
  }): Promise<`0x${string}`> {
    if (!this.kmsSigner.isInitialized()) {
      throw new Error('KMS signer not initialized')
    }
    this.log.debug('Executing write via KMS', {
      functionName: params.functionName,
    })
    return this.kmsSigner.signContractWrite(params)
  }

  async createRoom(
    name: string,
    description: string,
    roomType: RoomType,
    roomConfig: RoomConfig,
  ): Promise<{ roomId: bigint; stateCid: string }> {
    if (!this.canWrite()) {
      throw new Error('Signer required for room creation (KMS or wallet)')
    }

    this.log.info('Creating room', { name, roomType })

    const initialState = this.storage.createInitialRoomState(
      crypto.randomUUID(),
    )
    const stateCid = await this.storage.storeRoomState(initialState)

    // Encode config as ABI parameters
    const configBytes = encodeAbiParameters(
      parseAbiParameters(
        'uint256 maxMembers, bool turnBased, uint256 turnTimeout',
      ),
      [
        BigInt(roomConfig.maxMembers),
        roomConfig.turnBased,
        BigInt(roomConfig.turnTimeout ?? 300),
      ],
    )

    const txHash = await this.executeWrite({
      address: this.config.contracts.roomRegistry,
      abi: ROOM_REGISTRY_ABI,
      functionName: 'createRoom',
      args: [name, description, this.roomTypeToNumber(roomType), configBytes],
    })
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    })

    const log = receipt.logs[0]
    if (!log) {
      throw new Error('Room creation failed: no logs in receipt')
    }
    const topic = log.topics[1]
    if (!topic) {
      throw new Error('Room creation failed: room ID not found in log topics')
    }
    const roomId = BigInt(topic)

    this.log.info('Room created', { roomId: roomId.toString(), stateCid })
    return { roomId, stateCid }
  }

  async getRoom(roomId: bigint): Promise<Room | null> {
    expectTrue(roomId > 0n, 'Room ID must be greater than 0')
    this.log.debug('Getting room', { roomId: roomId.toString() })

    // Fetch full room data from storage mapping
    const roomData = (await this.publicClient.readContract({
      address: this.config.contracts.roomRegistry,
      abi: ROOM_REGISTRY_ABI,
      functionName: 'rooms',
      args: [roomId],
    })) as RoomDataTuple

    const [
      ,
      owner,
      name,
      description,
      stateCid,
      roomTypeNum,
      ,
      maxMembers,
      turnBased,
      turnTimeout,
      createdAt,
      ,
      active,
    ] = roomData

    if (!owner || owner === '0x0000000000000000000000000000000000000000')
      return null

    const [agentIds] = (await this.publicClient.readContract({
      address: this.config.contracts.roomRegistry,
      abi: ROOM_REGISTRY_ABI,
      functionName: 'getMembers',
      args: [roomId],
    })) as [bigint[], number[]]

    const members: RoomMember[] = await Promise.all(
      agentIds.map(async (agentId) => {
        const memberData = (await this.publicClient.readContract({
          address: this.config.contracts.roomRegistry,
          abi: ROOM_REGISTRY_ABI,
          functionName: 'getMember',
          args: [roomId, agentId],
        })) as RoomMemberData

        return {
          agentId,
          role: this.numberToAgentRole(memberData.role),
          joinedAt: Number(memberData.joinedAt) * 1000,
          lastActiveAt: Number(memberData.lastActiveAt) * 1000,
        }
      }),
    )

    return {
      roomId,
      name,
      description,
      owner,
      stateCid,
      members,
      roomType: this.numberToRoomType(roomTypeNum),
      config: {
        maxMembers: Number(maxMembers),
        turnBased,
        turnTimeout: Number(turnTimeout),
        visibility: 'public',
      },
      active,
      createdAt: Number(createdAt) * 1000,
    }
  }

  async joinRoom(
    roomId: bigint,
    agentId: bigint,
    role: AgentRole,
  ): Promise<void> {
    if (!this.canWrite()) throw new Error('KMS signer required')
    expectTrue(roomId > 0n, 'Room ID must be greater than 0')
    expectTrue(agentId > 0n, 'Agent ID must be greater than 0')
    expect(role, 'Role is required')

    this.log.info('Agent joining room', {
      roomId: roomId.toString(),
      agentId: agentId.toString(),
      role,
    })

    await this.executeWrite({
      address: this.config.contracts.roomRegistry,
      abi: ROOM_REGISTRY_ABI,
      functionName: 'joinRoom',
      args: [roomId, agentId, this.agentRoleToNumber(role)],
    })
  }

  async leaveRoom(roomId: bigint, agentId: bigint): Promise<void> {
    if (!this.canWrite()) {
      throw new Error('Signer required for leave room (KMS or wallet)')
    }
    expectTrue(roomId > 0n, 'Room ID must be greater than 0')
    expectTrue(agentId > 0n, 'Agent ID must be greater than 0')

    this.log.info('Agent leaving room', {
      roomId: roomId.toString(),
      agentId: agentId.toString(),
    })

    await this.executeWrite({
      address: this.config.contracts.roomRegistry,
      abi: ROOM_REGISTRY_ABI,
      functionName: 'leaveRoom',
      args: [roomId, agentId],
    })
  }

  async loadState(roomId: bigint): Promise<RoomState> {
    const room = await this.getRoom(roomId)
    if (!room) throw new Error(`Room not found: ${roomId}`)
    return this.storage.loadRoomState(room.stateCid)
  }

  async postMessage(
    roomId: bigint,
    agentId: bigint,
    content: string,
    action?: string,
  ): Promise<RoomMessage> {
    if (!this.canWrite()) {
      throw new Error('Signer required for post message (KMS or wallet)')
    }
    expectTrue(roomId > 0n, 'Room ID must be greater than 0')
    expectTrue(agentId > 0n, 'Agent ID must be greater than 0')
    expect(content, 'Message content is required')
    expectTrue(
      content.length > 0 && content.length <= 10000,
      'Message content must be between 1 and 10000 characters',
    )

    this.log.debug('Posting message', {
      roomId: roomId.toString(),
      agentId: agentId.toString(),
    })

    const state = await this.loadState(roomId)
    const message: RoomMessage = {
      id: crypto.randomUUID(),
      agentId: agentId.toString(),
      content,
      timestamp: Date.now(),
      action,
    }

    const newState: RoomState = {
      ...state,
      version: state.version + 1,
      messages: [...state.messages, message],
      updatedAt: Date.now(),
    }

    const stateCid = await this.storage.storeRoomState(newState)

    await this.executeWrite({
      address: this.config.contracts.roomRegistry,
      abi: ROOM_REGISTRY_ABI,
      functionName: 'updateRoomState',
      args: [roomId, stateCid],
    })
    return message
  }

  async getMessages(roomId: bigint, limit?: number): Promise<RoomMessage[]> {
    expectTrue(roomId > 0n, 'Room ID must be greater than 0')
    if (limit !== undefined) {
      expectTrue(limit > 0 && limit <= 1000, 'Limit must be between 1 and 1000')
    }
    const state = await this.loadState(roomId)
    return state.messages.slice(-(limit ?? 50))
  }

  async setPhase(roomId: bigint, phase: RoomPhase): Promise<void> {
    if (!this.canWrite()) {
      throw new Error('Signer required for set phase (KMS or wallet)')
    }
    expectTrue(roomId > 0n, 'Room ID must be greater than 0')
    expect(phase, 'Phase is required')

    this.log.info('Setting room phase', { roomId: roomId.toString(), phase })

    await this.executeWrite({
      address: this.config.contracts.roomRegistry,
      abi: ROOM_REGISTRY_ABI,
      functionName: 'setPhase',
      args: [roomId, this.phaseToNumber(phase)],
    })

    const state = await this.loadState(roomId)
    const stateCid = await this.storage.storeRoomState({
      ...state,
      version: state.version + 1,
      phase,
      updatedAt: Date.now(),
    })

    await this.executeWrite({
      address: this.config.contracts.roomRegistry,
      abi: ROOM_REGISTRY_ABI,
      functionName: 'updateRoomState',
      args: [roomId, stateCid],
    })
  }

  async updateScore(
    roomId: bigint,
    agentId: bigint,
    delta: number,
  ): Promise<void> {
    if (!this.canWrite()) {
      throw new Error('Signer required for update score (KMS or wallet)')
    }
    expectTrue(roomId > 0n, 'Room ID must be greater than 0')
    expectTrue(agentId > 0n, 'Agent ID must be greater than 0')
    expectTrue(
      typeof delta === 'number' && !Number.isNaN(delta),
      'Delta must be a valid number',
    )

    this.log.debug('Updating score', {
      roomId: roomId.toString(),
      agentId: agentId.toString(),
      delta,
    })

    const state = await this.loadState(roomId)
    const agentIdStr = agentId.toString()

    const stateCid = await this.storage.storeRoomState({
      ...state,
      version: state.version + 1,
      scores: {
        ...state.scores,
        [agentIdStr]:
          (state.scores[agentIdStr] !== undefined
            ? state.scores[agentIdStr]
            : 0) + delta,
      },
      updatedAt: Date.now(),
    })

    await this.executeWrite({
      address: this.config.contracts.roomRegistry,
      abi: ROOM_REGISTRY_ABI,
      functionName: 'updateRoomState',
      args: [roomId, stateCid],
    })
  }

  private roomTypeToNumber(type: RoomType): number {
    return { collaboration: 0, adversarial: 1, debate: 2, council: 3 }[type]
  }

  private numberToRoomType(num: number): RoomType {
    const types = ['collaboration', 'adversarial', 'debate', 'council'] as const
    if (num < 0 || num >= types.length) {
      throw new Error(
        `Invalid room type number: ${num}. Must be 0-${types.length - 1}`,
      )
    }
    return types[num]
  }

  private agentRoleToNumber(role: AgentRole): number {
    return {
      participant: 0,
      moderator: 1,
      red_team: 2,
      blue_team: 3,
      observer: 4,
    }[role]
  }

  private numberToAgentRole(num: number): AgentRole {
    const roles = [
      'participant',
      'moderator',
      'red_team',
      'blue_team',
      'observer',
    ] as const
    if (num < 0 || num >= roles.length) {
      throw new Error(
        `Invalid agent role number: ${num}. Must be 0-${roles.length - 1}`,
      )
    }
    return roles[num]
  }

  private phaseToNumber(phase: RoomPhase): number {
    return { setup: 0, active: 1, paused: 2, completed: 3, archived: 4 }[phase]
  }
}

export function createRoomSDK(config: RoomSDKConfig): RoomSDK {
  return new RoomSDK(config)
}
