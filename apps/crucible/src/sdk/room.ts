/**
 * Room SDK - Manages multi-agent coordination rooms.
 */

import { type Address, type PublicClient, type WalletClient, parseAbi, encodeAbiParameters, parseAbiParameters } from 'viem';
import type {
  Room, RoomMember, RoomState, RoomMessage, RoomType, RoomConfig, AgentRole, RoomPhase, CrucibleConfig,
} from '../types';
import { CrucibleStorage } from './storage';
import { createLogger, type Logger } from './logger';

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
]);

export interface RoomSDKConfig {
  crucibleConfig: CrucibleConfig;
  storage: CrucibleStorage;
  publicClient: PublicClient;
  walletClient?: WalletClient;
  logger?: Logger;
}

export class RoomSDK {
  private config: CrucibleConfig;
  private storage: CrucibleStorage;
  private publicClient: PublicClient;
  private walletClient?: WalletClient;
  private log: Logger;

  constructor(sdkConfig: RoomSDKConfig) {
    this.config = sdkConfig.crucibleConfig;
    this.storage = sdkConfig.storage;
    this.publicClient = sdkConfig.publicClient;
    this.walletClient = sdkConfig.walletClient;
    this.log = sdkConfig.logger ?? createLogger('RoomSDK');
  }

  async createRoom(
    name: string,
    description: string,
    roomType: RoomType,
    roomConfig: RoomConfig
  ): Promise<{ roomId: bigint; stateCid: string }> {
    if (!this.walletClient) throw new Error('Wallet client required');

    this.log.info('Creating room', { name, roomType });

    const initialState = this.storage.createInitialRoomState(crypto.randomUUID());
    const stateCid = await this.storage.storeRoomState(initialState);

    // Encode config as ABI parameters
    const configBytes = encodeAbiParameters(
      parseAbiParameters('uint256 maxMembers, bool turnBased, uint256 turnTimeout'),
      [BigInt(roomConfig.maxMembers), roomConfig.turnBased, BigInt(roomConfig.turnTimeout ?? 300)]
    );

    const { request } = await this.publicClient.simulateContract({
      address: this.config.contracts.roomRegistry,
      abi: ROOM_REGISTRY_ABI,
      functionName: 'createRoom',
      args: [name, description, this.roomTypeToNumber(roomType), configBytes],
      account: this.walletClient.account,
    });

    const txHash = await this.walletClient.writeContract(request);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    const roomId = receipt.logs[0]?.topics[1] ? BigInt(receipt.logs[0].topics[1]) : 0n;

    this.log.info('Room created', { roomId: roomId.toString(), stateCid });
    return { roomId, stateCid };
  }

  async getRoom(roomId: bigint): Promise<Room | null> {
    this.log.debug('Getting room', { roomId: roomId.toString() });

    // Fetch full room data from storage mapping
    const roomData = await this.publicClient.readContract({
      address: this.config.contracts.roomRegistry,
      abi: ROOM_REGISTRY_ABI,
      functionName: 'rooms',
      args: [roomId],
    }) as [bigint, Address, string, string, string, number, number, bigint, boolean, bigint, bigint, bigint, boolean];

    const [, owner, name, description, stateCid, roomTypeNum, phaseNum, maxMembers, turnBased, turnTimeout, createdAt, , active] = roomData;

    if (!owner || owner === '0x0000000000000000000000000000000000000000') return null;

    const [agentIds] = await this.publicClient.readContract({
      address: this.config.contracts.roomRegistry,
      abi: ROOM_REGISTRY_ABI,
      functionName: 'getMembers',
      args: [roomId],
    }) as [bigint[], number[]];

    const members: RoomMember[] = await Promise.all(agentIds.map(async (agentId) => {
      const memberData = await this.publicClient.readContract({
        address: this.config.contracts.roomRegistry,
        abi: ROOM_REGISTRY_ABI,
        functionName: 'getMember',
        args: [roomId, agentId],
      }) as { agentId: bigint; role: number; score: bigint; joinedAt: bigint; lastActiveAt: bigint; messageCount: bigint; active: boolean };

      return {
        agentId,
        role: this.numberToAgentRole(memberData.role),
        joinedAt: Number(memberData.joinedAt) * 1000,
        lastActiveAt: Number(memberData.lastActiveAt) * 1000,
      };
    }));

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
    };
  }

  async joinRoom(roomId: bigint, agentId: bigint, role: AgentRole): Promise<void> {
    if (!this.walletClient) throw new Error('Wallet client required');

    this.log.info('Agent joining room', { roomId: roomId.toString(), agentId: agentId.toString(), role });

    const { request } = await this.publicClient.simulateContract({
      address: this.config.contracts.roomRegistry,
      abi: ROOM_REGISTRY_ABI,
      functionName: 'joinRoom',
      args: [roomId, agentId, this.agentRoleToNumber(role)],
      account: this.walletClient.account,
    });

    await this.walletClient.writeContract(request);
  }

  async leaveRoom(roomId: bigint, agentId: bigint): Promise<void> {
    if (!this.walletClient) throw new Error('Wallet client required');

    this.log.info('Agent leaving room', { roomId: roomId.toString(), agentId: agentId.toString() });

    const { request } = await this.publicClient.simulateContract({
      address: this.config.contracts.roomRegistry,
      abi: ROOM_REGISTRY_ABI,
      functionName: 'leaveRoom',
      args: [roomId, agentId],
      account: this.walletClient.account,
    });

    await this.walletClient.writeContract(request);
  }

  async loadState(roomId: bigint): Promise<RoomState> {
    const room = await this.getRoom(roomId);
    if (!room) throw new Error(`Room not found: ${roomId}`);
    return this.storage.loadRoomState(room.stateCid);
  }

  async postMessage(roomId: bigint, agentId: bigint, content: string, action?: string): Promise<RoomMessage> {
    if (!this.walletClient) throw new Error('Wallet client required');

    this.log.debug('Posting message', { roomId: roomId.toString(), agentId: agentId.toString() });

    const state = await this.loadState(roomId);
    const message: RoomMessage = {
      id: crypto.randomUUID(),
      agentId: agentId.toString(),
      content,
      timestamp: Date.now(),
      action,
    };

    const newState: RoomState = {
      ...state,
      version: state.version + 1,
      messages: [...state.messages, message],
      updatedAt: Date.now(),
    };

    const stateCid = await this.storage.storeRoomState(newState);

    const { request } = await this.publicClient.simulateContract({
      address: this.config.contracts.roomRegistry,
      abi: ROOM_REGISTRY_ABI,
      functionName: 'updateRoomState',
      args: [roomId, stateCid],
      account: this.walletClient.account,
    });

    await this.walletClient.writeContract(request);
    return message;
  }

  async getMessages(roomId: bigint, limit?: number): Promise<RoomMessage[]> {
    const state = await this.loadState(roomId);
    return state.messages.slice(-(limit ?? 50));
  }

  async setPhase(roomId: bigint, phase: RoomPhase): Promise<void> {
    if (!this.walletClient) throw new Error('Wallet client required');

    this.log.info('Setting room phase', { roomId: roomId.toString(), phase });

    const { request } = await this.publicClient.simulateContract({
      address: this.config.contracts.roomRegistry,
      abi: ROOM_REGISTRY_ABI,
      functionName: 'setPhase',
      args: [roomId, this.phaseToNumber(phase)],
      account: this.walletClient.account,
    });

    await this.walletClient.writeContract(request);

    const state = await this.loadState(roomId);
    const stateCid = await this.storage.storeRoomState({
      ...state, version: state.version + 1, phase, updatedAt: Date.now(),
    });

    const { request: updateRequest } = await this.publicClient.simulateContract({
      address: this.config.contracts.roomRegistry,
      abi: ROOM_REGISTRY_ABI,
      functionName: 'updateRoomState',
      args: [roomId, stateCid],
      account: this.walletClient.account,
    });

    await this.walletClient.writeContract(updateRequest);
  }

  async updateScore(roomId: bigint, agentId: bigint, delta: number): Promise<void> {
    if (!this.walletClient) throw new Error('Wallet client required');

    this.log.debug('Updating score', { roomId: roomId.toString(), agentId: agentId.toString(), delta });

    const state = await this.loadState(roomId);
    const agentIdStr = agentId.toString();

    const stateCid = await this.storage.storeRoomState({
      ...state,
      version: state.version + 1,
      scores: { ...state.scores, [agentIdStr]: (state.scores[agentIdStr] ?? 0) + delta },
      updatedAt: Date.now(),
    });

    const { request } = await this.publicClient.simulateContract({
      address: this.config.contracts.roomRegistry,
      abi: ROOM_REGISTRY_ABI,
      functionName: 'updateRoomState',
      args: [roomId, stateCid],
      account: this.walletClient.account,
    });

    await this.walletClient.writeContract(request);
  }

  private roomTypeToNumber(type: RoomType): number {
    return { collaboration: 0, adversarial: 1, debate: 2, council: 3 }[type];
  }

  private numberToRoomType(num: number): RoomType {
    return (['collaboration', 'adversarial', 'debate', 'council'] as const)[num] ?? 'collaboration';
  }

  private agentRoleToNumber(role: AgentRole): number {
    return { participant: 0, moderator: 1, red_team: 2, blue_team: 3, observer: 4 }[role];
  }

  private numberToAgentRole(num: number): AgentRole {
    return (['participant', 'moderator', 'red_team', 'blue_team', 'observer'] as const)[num] ?? 'participant';
  }

  private phaseToNumber(phase: RoomPhase): number {
    return { setup: 0, active: 1, paused: 2, completed: 3, archived: 4 }[phase];
  }
}

export function createRoomSDK(config: RoomSDKConfig): RoomSDK {
  return new RoomSDK(config);
}
