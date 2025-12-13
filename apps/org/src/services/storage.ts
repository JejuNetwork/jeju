/**
 * Org Storage - Stores org state on IPFS.
 */

import type { OrgState, Todo, CheckinSchedule, CheckinResponse, TeamMember } from '../types';

export interface OrgStorageConfig {
  apiUrl: string;
  ipfsGateway: string;
}

export class OrgStorage {
  private config: OrgStorageConfig;

  constructor(config: OrgStorageConfig) {
    this.config = config;
  }

  async loadState(cid: string): Promise<OrgState> {
    const r = await fetch(`${this.config.ipfsGateway}/ipfs/${cid}`);
    if (!r.ok) throw new Error(`Failed to load org state: ${r.statusText}`);
    return r.json() as Promise<OrgState>;
  }

  async saveState(state: OrgState): Promise<string> {
    const r = await fetch(`${this.config.apiUrl}/api/v1/add`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: JSON.stringify(state), filename: `org-${state.orgId}-v${state.version}.json`, pin: true }),
    });
    if (!r.ok) throw new Error(`Failed to save org state: ${r.statusText}`);
    return ((await r.json()) as { cid: string }).cid;
  }

  createInitialState(orgId: string): OrgState {
    return { orgId, version: 0, todos: [], checkinSchedules: [], checkinResponses: [], teamMembers: [], metadata: {}, updatedAt: Date.now() };
  }

  async updateState(current: OrgState, updates: Partial<OrgState>): Promise<{ state: OrgState; cid: string }> {
    const state: OrgState = { ...current, ...updates, version: current.version + 1, updatedAt: Date.now() };
    return { state, cid: await this.saveState(state) };
  }

  async addTodo(state: OrgState, todo: Todo) {
    return this.updateState(state, { todos: [...state.todos, todo] });
  }

  async updateTodo(state: OrgState, todoId: string, updates: Partial<Todo>) {
    return this.updateState(state, {
      todos: state.todos.map(t => t.id === todoId ? { ...t, ...updates, updatedAt: Date.now() } : t),
    });
  }

  async completeTodo(state: OrgState, todoId: string) {
    return this.updateTodo(state, todoId, { status: 'completed', completedAt: Date.now() });
  }

  async addCheckinSchedule(state: OrgState, schedule: CheckinSchedule) {
    return this.updateState(state, { checkinSchedules: [...state.checkinSchedules, schedule] });
  }

  async recordCheckinResponse(state: OrgState, response: CheckinResponse) {
    return this.updateState(state, { checkinResponses: [...state.checkinResponses, response] });
  }

  async addTeamMember(state: OrgState, member: TeamMember) {
    const existing = state.teamMembers.find(m => m.agentId === member.agentId);
    if (existing) {
      return this.updateState(state, {
        teamMembers: state.teamMembers.map(m => m.agentId === member.agentId ? { ...m, ...member, lastActiveAt: Date.now() } : m),
      });
    }
    return this.updateState(state, { teamMembers: [...state.teamMembers, member] });
  }
}

export function createOrgStorage(config: OrgStorageConfig): OrgStorage {
  return new OrgStorage(config);
}
