/**
 * Decentralized State Management for Crucible
 * 
 * Persists agent, room, and bot state to CovenantSQL.
 * DECENTRALIZED: No fallbacks - CQL is required for production.
 */

import { getCQL, type CQLClient, type QueryParam } from "@jejunetwork/db";
import { getCacheClient, type CacheClient } from "@jejunetwork/shared";
import type {
  AgentDefinition,
  AgentState,
  Room,
  RoomState,
  ExecutionResult,
  TradingBotState,
  OrgToolState,
} from "./types";

const CQL_DATABASE_ID = process.env.COVENANTSQL_DATABASE_ID ?? "crucible";
const CQL_REQUIRED = process.env.CQL_REQUIRED !== "false";

// CQL Client
let cqlClient: CQLClient | null = null;
let cacheClient: CacheClient | null = null;
let initialized = false;

async function getCQLClient(): Promise<CQLClient> {
  if (!cqlClient) {
    const cqlNodes = process.env.COVENANTSQL_NODES;
    
    if (!cqlNodes && CQL_REQUIRED) {
      throw new Error(
        'Crucible requires CovenantSQL for decentralized state storage.\n' +
        'Set COVENANTSQL_NODES environment variable or start stack:\n' +
        '  docker compose up -d\n' +
        '\n' +
        'Or set CQL_REQUIRED=false for local testing only (not recommended for production).'
      );
    }
    
    cqlClient = getCQL();
    await ensureTablesExist();
  }
  return cqlClient;
}

function getCache(): CacheClient {
  if (!cacheClient) {
    cacheClient = getCacheClient("crucible");
  }
  return cacheClient;
}

async function ensureTablesExist(): Promise<void> {
  const tables = [
    `CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL UNIQUE,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      bot_type TEXT NOT NULL,
      character_cid TEXT,
      state_cid TEXT,
      vault_address TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      registered_at INTEGER NOT NULL,
      last_executed_at INTEGER DEFAULT 0,
      execution_count INTEGER DEFAULT 0,
      strategies TEXT,
      chains TEXT,
      treasury_address TEXT,
      org_id TEXT,
      capabilities TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS agent_states (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      memories TEXT DEFAULT '[]',
      rooms TEXT DEFAULT '[]',
      context TEXT DEFAULT '{}',
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      owner TEXT NOT NULL,
      state_cid TEXT,
      members TEXT DEFAULT '[]',
      room_type TEXT NOT NULL,
      config TEXT DEFAULT '{}',
      active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS room_states (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      messages TEXT DEFAULT '[]',
      scores TEXT DEFAULT '{}',
      current_turn TEXT,
      phase TEXT DEFAULT 'setup',
      metadata TEXT DEFAULT '{}',
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      output TEXT,
      new_state_cid TEXT,
      cost TEXT DEFAULT '{}',
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS trading_bot_states (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL UNIQUE,
      last_execution INTEGER DEFAULT 0,
      metrics TEXT DEFAULT '{}',
      opportunities TEXT DEFAULT '[]',
      config TEXT DEFAULT '{}',
      version INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS org_tool_states (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      todos TEXT DEFAULT '[]',
      checkin_schedules TEXT DEFAULT '[]',
      checkin_responses TEXT DEFAULT '[]',
      team_members TEXT DEFAULT '[]',
      version INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`,
  ];

  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner)`,
    `CREATE INDEX IF NOT EXISTS idx_agents_bot_type ON agents(bot_type)`,
    `CREATE INDEX IF NOT EXISTS idx_rooms_owner ON rooms(owner)`,
    `CREATE INDEX IF NOT EXISTS idx_executions_agent ON executions(agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_org_states_org ON org_tool_states(org_id)`,
  ];

  for (const ddl of tables) {
    await cqlClient!.exec(ddl, [], CQL_DATABASE_ID);
  }

  for (const idx of indexes) {
    await cqlClient!.exec(idx, [], CQL_DATABASE_ID).catch(() => {});
  }

  console.log("[Crucible] CovenantSQL tables ensured");
}

// Agent operations
export const agentState = {
  async save(agent: AgentDefinition): Promise<void> {
    const id = agent.agentId.toString();
    const client = await getCQLClient();
    await client.exec(
      `INSERT INTO agents (id, agent_id, owner, name, bot_type, character_cid, state_cid, vault_address, 
       active, registered_at, last_executed_at, execution_count, strategies, chains, treasury_address, org_id, capabilities)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, state_cid = excluded.state_cid, active = excluded.active,
       last_executed_at = excluded.last_executed_at, execution_count = excluded.execution_count`,
      [
        id, id, agent.owner, agent.name, agent.botType, agent.characterCid ?? null,
        agent.stateCid, agent.vaultAddress, agent.active ? 1 : 0, agent.registeredAt,
        agent.lastExecutedAt, agent.executionCount, JSON.stringify(agent.strategies ?? []),
        JSON.stringify(agent.chains ?? []), agent.treasuryAddress ?? null,
        agent.orgId ?? null, JSON.stringify(agent.capabilities ?? []),
      ],
      CQL_DATABASE_ID
    );
    await getCache().delete(`agent:${id}`);
  },

  async get(agentId: string): Promise<AgentDefinition | null> {
    const cache = getCache();
    const cached = await cache.get(`agent:${agentId}`).catch(() => null);
    if (cached) return JSON.parse(cached) as AgentDefinition;

    const client = await getCQLClient();
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM agents WHERE agent_id = ?`,
      [agentId],
      CQL_DATABASE_ID
    );
    const row = result.rows[0];
    if (row) {
      const agent: AgentDefinition = {
        agentId: BigInt(row.agent_id as string),
        owner: row.owner as `0x${string}`,
        name: row.name as string,
        botType: row.bot_type as AgentDefinition["botType"],
        characterCid: row.character_cid as string | undefined,
        stateCid: row.state_cid as string,
        vaultAddress: row.vault_address as `0x${string}`,
        active: (row.active as number) === 1,
        registeredAt: row.registered_at as number,
        lastExecutedAt: row.last_executed_at as number,
        executionCount: row.execution_count as number,
        strategies: JSON.parse((row.strategies as string) || "[]"),
        chains: JSON.parse((row.chains as string) || "[]"),
        treasuryAddress: row.treasury_address as `0x${string}` | undefined,
        orgId: row.org_id as string | undefined,
        capabilities: JSON.parse((row.capabilities as string) || "[]"),
      };
      await cache.set(`agent:${agentId}`, JSON.stringify(agent), 300);
      return agent;
    }
    return null;
  },

  async list(filter?: { owner?: string; botType?: string; active?: boolean }): Promise<AgentDefinition[]> {
    const client = await getCQLClient();
    const conditions: string[] = [];
    const params: QueryParam[] = [];

    if (filter?.owner) {
      conditions.push("owner = ?");
      params.push(filter.owner);
    }
    if (filter?.botType) {
      conditions.push("bot_type = ?");
      params.push(filter.botType);
    }
    if (filter?.active !== undefined) {
      conditions.push("active = ?");
      params.push(filter.active ? 1 : 0);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM agents ${where} ORDER BY registered_at DESC LIMIT 100`,
      params,
      CQL_DATABASE_ID
    );
    return result.rows.map((row) => ({
      agentId: BigInt(row.agent_id as string),
      owner: row.owner as `0x${string}`,
      name: row.name as string,
      botType: row.bot_type as AgentDefinition["botType"],
      characterCid: row.character_cid as string | undefined,
      stateCid: row.state_cid as string,
      vaultAddress: row.vault_address as `0x${string}`,
      active: (row.active as number) === 1,
      registeredAt: row.registered_at as number,
      lastExecutedAt: row.last_executed_at as number,
      executionCount: row.execution_count as number,
    }));
  },
};

// Room operations
export const roomState = {
  async save(room: Room): Promise<void> {
    const id = room.roomId.toString();
    const client = await getCQLClient();
    await client.exec(
      `INSERT INTO rooms (id, room_id, name, description, owner, state_cid, members, room_type, config, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, state_cid = excluded.state_cid, members = excluded.members, active = excluded.active`,
      [
        id, id, room.name, room.description, room.owner, room.stateCid,
        JSON.stringify(room.members), room.roomType, JSON.stringify(room.config),
        room.active ? 1 : 0, room.createdAt,
      ],
      CQL_DATABASE_ID
    );
    await getCache().delete(`room:${id}`);
  },

  async get(roomId: string): Promise<Room | null> {
    const cache = getCache();
    const cached = await cache.get(`room:${roomId}`).catch(() => null);
    if (cached) return JSON.parse(cached) as Room;

    const client = await getCQLClient();
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM rooms WHERE room_id = ?`,
      [roomId],
      CQL_DATABASE_ID
    );
    const row = result.rows[0];
    if (row) {
      const room: Room = {
        roomId: BigInt(row.room_id as string),
        name: row.name as string,
        description: row.description as string,
        owner: row.owner as `0x${string}`,
        stateCid: row.state_cid as string,
        members: JSON.parse((row.members as string) || "[]"),
        roomType: row.room_type as Room["roomType"],
        config: JSON.parse((row.config as string) || "{}"),
        active: (row.active as number) === 1,
        createdAt: row.created_at as number,
      };
      await cache.set(`room:${roomId}`, JSON.stringify(room), 300);
      return room;
    }
    return null;
  },

  async list(filter?: { owner?: string; roomType?: string }): Promise<Room[]> {
    const client = await getCQLClient();
    const conditions: string[] = [];
    const params: QueryParam[] = [];

    if (filter?.owner) {
      conditions.push("owner = ?");
      params.push(filter.owner);
    }
    if (filter?.roomType) {
      conditions.push("room_type = ?");
      params.push(filter.roomType);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM rooms ${where} ORDER BY created_at DESC LIMIT 100`,
      params,
      CQL_DATABASE_ID
    );
    return result.rows.map((row) => ({
      roomId: BigInt(row.room_id as string),
      name: row.name as string,
      description: row.description as string,
      owner: row.owner as `0x${string}`,
      stateCid: row.state_cid as string,
      members: JSON.parse((row.members as string) || "[]"),
      roomType: row.room_type as Room["roomType"],
      config: JSON.parse((row.config as string) || "{}"),
      active: (row.active as number) === 1,
      createdAt: row.created_at as number,
    }));
  },
};

// Execution logging
export const executionState = {
  async save(execution: ExecutionResult): Promise<void> {
    const client = await getCQLClient();
    await client.exec(
      `INSERT INTO executions (id, agent_id, status, output, new_state_cid, cost, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        execution.executionId,
        execution.agentId.toString(),
        execution.status,
        JSON.stringify(execution.output),
        execution.newStateCid ?? null,
        JSON.stringify(execution.cost),
        JSON.stringify(execution.metadata),
        execution.metadata.startedAt,
      ],
      CQL_DATABASE_ID
    );
  },

  async getByAgent(agentId: string, limit = 50): Promise<ExecutionResult[]> {
    const client = await getCQLClient();
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM executions WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`,
      [agentId, limit],
      CQL_DATABASE_ID
    );
    return result.rows.map((row) => ({
      executionId: row.id as string,
      agentId: BigInt(row.agent_id as string),
      status: row.status as ExecutionResult["status"],
      output: JSON.parse((row.output as string) || "null"),
      newStateCid: row.new_state_cid as string | undefined,
      cost: JSON.parse((row.cost as string) || "{}"),
      metadata: JSON.parse((row.metadata as string) || "{}"),
    }));
  },
};

// Initialize state system
export async function initializeState(): Promise<void> {
  if (initialized) return;
  await getCQLClient();
  initialized = true;
  console.log("[Crucible] Decentralized state initialized");
}

// Get state mode - always "covenantql" in production
export function getStateMode(): "covenantql" {
  return "covenantql";
}
