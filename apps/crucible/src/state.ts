/**
 * Decentralized State Management for Crucible
 * 
 * Persists agent, room, and bot state to CovenantSQL.
 * CQL is REQUIRED - automatically configured per network.
 */

import { getCQL, type CQLClient, type QueryParam } from "@jejunetwork/db";
import { getCacheClient, type CacheClient } from "@jejunetwork/shared";
import { getCurrentNetwork } from "@jejunetwork/config";
import type {
  AgentDefinition,
  AgentState,
  Room,
  RoomState,
  ExecutionResult,
  TradingBotState,
  OrgToolState,
} from "./types";
import { expect, AgentDefinitionSchema, AgentStateSchema, RoomStateSchema, TradingBotStrategyArraySchema, TradingBotChainArraySchema, StringArraySchema, RoomMemberArraySchema, RoomSchema, RoomConfigSchema, ExecutionOutputSchema, ExecutionCostSchema, ExecutionMetadataSchema, ExecutionResultSchema, parseOrThrow } from "./schemas";
import type { TradingBotStrategy, TradingBotChain, RoomMember } from "./types";
import { createLogger } from "./sdk/logger";

const log = createLogger('State');

const CQL_DATABASE_ID = process.env.CQL_DATABASE_ID;

function getCQLDatabaseId(): string {
  if (!CQL_DATABASE_ID) {
    throw new Error('CQL_DATABASE_ID environment variable is required for Crucible state management');
  }
  return CQL_DATABASE_ID;
}

/**
 * Parse JSON field from database with explicit validation
 * Throws if the field is empty string (which is invalid JSON)
 */
function parseJsonField<T>(value: string | null, defaultForNull: T): T {
  if (value === null) {
    return defaultForNull;
  }
  if (value === '') {
    throw new Error('Invalid JSON field: empty string is not valid JSON');
  }
  return JSON.parse(value) as T;
}

// CQL Client
let cqlClient: CQLClient | null = null;
let cacheClient: CacheClient | null = null;
let initialized = false;

async function getCQLClient(): Promise<CQLClient> {
  if (!cqlClient) {
    // CQL URL is automatically resolved from network config
    const databaseId = getCQLDatabaseId();
    cqlClient = getCQL({
      databaseId,
      timeout: 30000,
      debug: process.env.NODE_ENV !== 'production',
    });
    
    const healthy = await cqlClient.isHealthy();
    if (!healthy) {
      const network = getCurrentNetwork();
      throw new Error(
        `Crucible requires CovenantSQL for decentralized state (network: ${network}).\n` +
        'Ensure CQL is running: docker compose up -d cql'
      );
    }
    
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

  const databaseId = getCQLDatabaseId();
  for (const ddl of tables) {
    await cqlClient!.exec(ddl, [], databaseId);
  }

  for (const idx of indexes) {
    const databaseId = getCQLDatabaseId();
    await cqlClient!.exec(idx, [], databaseId);
  }

  log.info('CovenantSQL tables ensured');
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
      getCQLDatabaseId()
    );
    await getCache().delete(`agent:${id}`);
  },

  async get(agentId: string): Promise<AgentDefinition | null> {
    expect(agentId, 'Agent ID is required');
    const cache = getCache();
    const cached = await cache.get(`agent:${agentId}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      return AgentDefinitionSchema.parse(parsed) as AgentDefinition;
    }

    const client = await getCQLClient();
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM agents WHERE agent_id = ?`,
      [agentId],
      getCQLDatabaseId()
    );
    const row = result.rows[0];
    if (row) {
      const parsed = AgentDefinitionSchema.parse({
        agentId: row.agent_id as string,
        owner: row.owner as string,
        name: row.name as string,
        botType: row.bot_type as string,
        characterCid: row.character_cid as string | undefined,
        stateCid: row.state_cid as string,
        vaultAddress: row.vault_address as string,
        active: (row.active as number) === 1,
        registeredAt: row.registered_at as number,
        lastExecutedAt: row.last_executed_at as number,
        executionCount: row.execution_count as number,
        strategies: parseJsonField(row.strategies as string | null, []),
        chains: parseJsonField(row.chains as string | null, []),
        treasuryAddress: row.treasury_address as string | undefined,
        orgId: row.org_id as string | undefined,
        capabilities: parseJsonField(row.capabilities as string | null, []),
      });
      await cache.set(`agent:${agentId}`, JSON.stringify(parsed), 300);
      return parsed as AgentDefinition;
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
      getCQLDatabaseId()
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
      getCQLDatabaseId()
    );
    await getCache().delete(`room:${id}`);
  },

  async get(roomId: string): Promise<Room | null> {
    expect(roomId, 'Room ID is required');
    const cache = getCache();
    const cached = await cache.get(`room:${roomId}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      return RoomSchema.parse(parsed);
    }

    const client = await getCQLClient();
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM rooms WHERE room_id = ?`,
      [roomId],
      getCQLDatabaseId()
    );
    const row = result.rows[0];
    if (row) {
      const parsed = RoomSchema.parse({
        roomId: row.room_id as string,
        name: row.name as string,
        description: row.description as string,
        owner: row.owner as string,
        stateCid: row.state_cid as string,
        members: parseJsonField(row.members as string | null, []),
        roomType: row.room_type as string,
        config: parseJsonField(row.config as string | null, {}),
        active: (row.active as number) === 1,
        createdAt: row.created_at as number,
      });
      await cache.set(`room:${roomId}`, JSON.stringify(parsed), 300);
      return parsed;
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
      getCQLDatabaseId()
    );
    return result.rows.map((row) => {
      const parsed = RoomSchema.parse({
        roomId: row.room_id as string,
        name: row.name as string,
        description: row.description as string,
        owner: row.owner as string,
        stateCid: row.state_cid as string,
        members: parseJsonField(row.members as string | null, []),
        roomType: row.room_type as string,
        config: parseJsonField(row.config as string | null, {}),
        active: (row.active as number) === 1,
        createdAt: row.created_at as number,
      });
      return parsed as Room;
    });
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
      getCQLDatabaseId()
    );
  },

  async getByAgent(agentId: string, limit = 50): Promise<ExecutionResult[]> {
    const client = await getCQLClient();
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM executions WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`,
      [agentId, limit],
      getCQLDatabaseId()
    );
    return result.rows.map((row) => {
      const outputRaw = parseJsonField(row.output as string | null, null);
      const costRaw = parseJsonField(row.cost as string | null, {});
      const metadataRaw = parseJsonField(row.metadata as string | null, {});
      
      const parsed = ExecutionResultSchema.parse({
        executionId: expect(row.id as string, 'Execution ID is required'),
        agentId: expect(row.agent_id as string, 'Agent ID is required'),
        status: expect(row.status as ExecutionResult["status"], 'Status is required'),
        output: outputRaw,
        newStateCid: row.new_state_cid as string | undefined,
        cost: costRaw,
        metadata: metadataRaw,
      });
      return parsed as ExecutionResult;
    });
  },
};

// Initialize state system
export async function initializeState(): Promise<void> {
  if (initialized) return;
  await getCQLClient();
  initialized = true;
  log.info('Decentralized state initialized');
}

// Get state mode - always "covenantql" in production
export function getStateMode(): "covenantql" {
  return "covenantql";
}
