/**
 * Storage SDK - Handles agent state persistence on IPFS.
 */

import type { AgentCharacter, AgentState, RoomState } from '../types';
import { createLogger, type Logger } from './logger';

export interface StorageConfig {
  apiUrl: string;
  ipfsGateway: string;
  logger?: Logger;
}

export class CrucibleStorage {
  private config: StorageConfig;
  private log: Logger;

  constructor(config: StorageConfig) {
    this.config = config;
    this.log = config.logger ?? createLogger('Storage');
  }

  async storeCharacter(character: AgentCharacter): Promise<string> {
    this.log.debug('Storing character', { id: character.id, name: character.name });
    const cid = await this.upload(JSON.stringify(character, null, 2), `character-${character.id}.json`);
    this.log.info('Character stored', { id: character.id, cid });
    return cid;
  }

  async loadCharacter(cid: string): Promise<AgentCharacter> {
    this.log.debug('Loading character', { cid });
    const content = await this.fetch(cid);
    return JSON.parse(content) as AgentCharacter;
  }

  async storeAgentState(state: AgentState): Promise<string> {
    this.log.debug('Storing agent state', { agentId: state.agentId, version: state.version });
    return this.upload(JSON.stringify(state), `state-${state.agentId}-v${state.version}.json`);
  }

  async loadAgentState(cid: string): Promise<AgentState> {
    this.log.debug('Loading agent state', { cid });
    return JSON.parse(await this.fetch(cid)) as AgentState;
  }

  createInitialState(agentId: string): AgentState {
    return { agentId, version: 0, memories: [], rooms: [], context: {}, updatedAt: Date.now() };
  }

  async updateAgentState(current: AgentState, updates: Partial<AgentState>): Promise<{ state: AgentState; cid: string }> {
    const state: AgentState = { ...current, ...updates, version: current.version + 1, updatedAt: Date.now() };
    const cid = await this.storeAgentState(state);
    this.log.info('Agent state updated', { agentId: state.agentId, version: state.version, cid });
    return { state, cid };
  }

  async storeRoomState(state: RoomState): Promise<string> {
    this.log.debug('Storing room state', { roomId: state.roomId, version: state.version });
    return this.upload(JSON.stringify(state), `room-${state.roomId}-v${state.version}.json`);
  }

  async loadRoomState(cid: string): Promise<RoomState> {
    this.log.debug('Loading room state', { cid });
    return JSON.parse(await this.fetch(cid)) as RoomState;
  }

  createInitialRoomState(roomId: string): RoomState {
    return { roomId, version: 0, messages: [], scores: {}, phase: 'setup', metadata: {}, updatedAt: Date.now() };
  }

  async exists(cid: string): Promise<boolean> {
    return (await fetch(`${this.config.ipfsGateway}/ipfs/${cid}`, { method: 'HEAD' })).ok;
  }

  async pin(cid: string): Promise<void> {
    this.log.debug('Pinning CID', { cid });
    const r = await fetch(`${this.config.apiUrl}/api/v1/pin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cid }),
    });
    if (!r.ok) {
      this.log.error('Pin failed', { cid, status: r.status });
      throw new Error(`Failed to pin CID: ${r.statusText}`);
    }
  }

  private async upload(content: string, filename: string): Promise<string> {
    const r = await fetch(`${this.config.apiUrl}/api/v1/add`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, filename, pin: true }),
    });
    if (!r.ok) {
      const error = await r.text();
      this.log.error('Upload failed', { filename, status: r.status, error });
      throw new Error(`Failed to upload to IPFS: ${error}`);
    }
    return ((await r.json()) as { cid: string }).cid;
  }

  private async fetch(cid: string): Promise<string> {
    const r = await fetch(`${this.config.ipfsGateway}/ipfs/${cid}`);
    if (!r.ok) {
      this.log.error('Fetch failed', { cid, status: r.status });
      throw new Error(`Failed to fetch from IPFS: ${r.statusText}`);
    }
    return r.text();
  }
}

export function createStorage(config: StorageConfig): CrucibleStorage {
  return new CrucibleStorage(config);
}
