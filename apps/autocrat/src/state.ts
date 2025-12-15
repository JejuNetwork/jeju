/**
 * Decentralized State Management for Council
 * 
 * Persists council state (proposals, votes, research) to CovenantSQL.
 * DECENTRALIZED: No fallbacks - CQL is required for production.
 */

import { getCQL, type CQLClient } from "@jeju/db";
import { getCacheClient, type CacheClient } from "@jeju/shared/cache";

const CQL_DATABASE_ID = process.env.COVENANTSQL_DATABASE_ID ?? "council";
const CQL_REQUIRED = process.env.CQL_REQUIRED !== "false";

// Types
export interface Proposal {
  id: string;
  title: string;
  description: string;
  author: string;
  status: "draft" | "review" | "voting" | "approved" | "rejected" | "executed";
  qualityScore: number;
  autocratVotes: Record<string, boolean>;
  futarchyMarketId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ResearchResult {
  id: string;
  proposalId: string;
  topic: string;
  summary: string;
  sources: string[];
  confidence: number;
  createdAt: number;
}

export interface ModerationFlag {
  id: string;
  targetId: string;
  targetType: "proposal" | "user" | "research";
  flagType: string;
  reason: string;
  reporterId: string;
  createdAt: number;
}

// CQL Client
let cqlClient: CQLClient | null = null;
let cacheClient: CacheClient | null = null;
let initialized = false;

async function getCQLClient(): Promise<CQLClient> {
  if (!cqlClient) {
    const cqlNodes = process.env.COVENANTSQL_NODES;
    
    if (!cqlNodes && CQL_REQUIRED) {
      throw new Error(
        'Council requires CovenantSQL for decentralized state storage.\n' +
        'Set COVENANTSQL_NODES environment variable or start stack:\n' +
        '  docker compose up -d\n' +
        '\n' +
        'Or set CQL_REQUIRED=false for local testing only (not recommended for production).'
      );
    }
    
    cqlClient = getCQL();
    await cqlClient.initialize();
    await ensureTablesExist();
  }
  return cqlClient;
}

function getCache(): CacheClient {
  if (!cacheClient) {
    cacheClient = getCacheClient("council");
  }
  return cacheClient;
}

async function ensureTablesExist(): Promise<void> {
  const tables = [
    `CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      author TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      quality_score INTEGER DEFAULT 0,
      council_votes TEXT DEFAULT '{}',
      futarchy_market_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS research_results (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      summary TEXT,
      sources TEXT DEFAULT '[]',
      confidence INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS moderation_flags (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      flag_type TEXT NOT NULL,
      reason TEXT,
      reporter_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS council_votes (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      voter_id TEXT NOT NULL,
      vote INTEGER NOT NULL,
      reason TEXT,
      created_at INTEGER NOT NULL
    )`,
  ];

  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_proposals_author ON proposals(author)`,
    `CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status)`,
    `CREATE INDEX IF NOT EXISTS idx_research_proposal ON research_results(proposal_id)`,
    `CREATE INDEX IF NOT EXISTS idx_flags_target ON moderation_flags(target_id)`,
  ];

  for (const ddl of tables) {
    await cqlClient!.exec(ddl, [], CQL_DATABASE_ID);
  }

  for (const idx of indexes) {
    try {
      await cqlClient!.exec(idx, [], CQL_DATABASE_ID);
    } catch (e) {
      // Index creation may fail if index already exists, which is acceptable
      console.debug(`Index creation skipped (may already exist): ${idx.substring(0, 50)}...`);
    }
  }

  console.log("[Council] CovenantSQL tables ensured");
}

// Proposal operations
export const proposalState = {
  async create(proposal: Proposal): Promise<void> {
    const client = await getCQLClient();
    await client.exec(
      `INSERT INTO proposals (id, title, description, author, status, quality_score, council_votes, futarchy_market_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        proposal.id,
        proposal.title,
        proposal.description,
        proposal.author,
        proposal.status,
        proposal.qualityScore,
        JSON.stringify(proposal.autocratVotes),
        proposal.futarchyMarketId ?? null,
        proposal.createdAt,
        proposal.updatedAt,
      ],
      CQL_DATABASE_ID
    );
    // Invalidate cache
    await getCache().delete(`proposal:${proposal.id}`);
  },

  async get(id: string): Promise<Proposal | null> {
    // Check cache first
    const cache = getCache();
    const cached = await cache.get(`proposal:${id}`).catch(() => null);
    if (cached) {
      return JSON.parse(cached) as Proposal;
    }

    const client = await getCQLClient();
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM proposals WHERE id = ?`,
      [id],
      CQL_DATABASE_ID
    );
    const row = result.rows[0];
    if (row) {
      const proposal: Proposal = {
        id: row.id as string,
        title: row.title as string,
        description: row.description as string,
        author: row.author as string,
        status: row.status as Proposal["status"],
        qualityScore: row.quality_score as number,
        autocratVotes: JSON.parse((row.council_votes as string) || "{}"),
        futarchyMarketId: row.futarchy_market_id as string | undefined,
        createdAt: row.created_at as number,
        updatedAt: row.updated_at as number,
      };
      // Cache for 5 minutes
      await cache.set(`proposal:${id}`, JSON.stringify(proposal), 300);
      return proposal;
    }
    return null;
  },

  async update(id: string, updates: Partial<Proposal>): Promise<void> {
    const client = await getCQLClient();
    const sets: string[] = ["updated_at = ?"];
    const params: unknown[] = [Date.now()];

    if (updates.title !== undefined) {
      sets.push("title = ?");
      params.push(updates.title);
    }
    if (updates.description !== undefined) {
      sets.push("description = ?");
      params.push(updates.description);
    }
    if (updates.status !== undefined) {
      sets.push("status = ?");
      params.push(updates.status);
    }
    if (updates.qualityScore !== undefined) {
      sets.push("quality_score = ?");
      params.push(updates.qualityScore);
    }
    if (updates.autocratVotes !== undefined) {
      sets.push("council_votes = ?");
      params.push(JSON.stringify(updates.autocratVotes));
    }
    if (updates.futarchyMarketId !== undefined) {
      sets.push("futarchy_market_id = ?");
      params.push(updates.futarchyMarketId);
    }

    params.push(id);
    await client.exec(
      `UPDATE proposals SET ${sets.join(", ")} WHERE id = ?`,
      params,
      CQL_DATABASE_ID
    );
    // Invalidate cache
    await getCache().delete(`proposal:${id}`);
  },

  async list(status?: Proposal["status"], limit = 50): Promise<Proposal[]> {
    const client = await getCQLClient();
    const where = status ? "WHERE status = ?" : "";
    const params = status ? [status, limit] : [limit];
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM proposals ${where} ORDER BY created_at DESC LIMIT ?`,
      params,
      CQL_DATABASE_ID
    );
    return result.rows.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      description: row.description as string,
      author: row.author as string,
      status: row.status as Proposal["status"],
      qualityScore: row.quality_score as number,
      autocratVotes: JSON.parse((row.council_votes as string) || "{}"),
      futarchyMarketId: row.futarchy_market_id as string | undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    }));
  },
};

// Research operations
export const researchState = {
  async save(result: ResearchResult): Promise<void> {
    const client = await getCQLClient();
    await client.exec(
      `INSERT INTO research_results (id, proposal_id, topic, summary, sources, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        result.id,
        result.proposalId,
        result.topic,
        result.summary,
        JSON.stringify(result.sources),
        result.confidence,
        result.createdAt,
      ],
      CQL_DATABASE_ID
    );
  },

  async getByProposal(proposalId: string): Promise<ResearchResult[]> {
    const client = await getCQLClient();
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM research_results WHERE proposal_id = ? ORDER BY created_at DESC`,
      [proposalId],
      CQL_DATABASE_ID
    );
    return result.rows.map((row) => ({
      id: row.id as string,
      proposalId: row.proposal_id as string,
      topic: row.topic as string,
      summary: row.summary as string,
      sources: JSON.parse((row.sources as string) || "[]"),
      confidence: row.confidence as number,
      createdAt: row.created_at as number,
    }));
  },
};

// Moderation operations
export const moderationState = {
  async flag(flag: ModerationFlag): Promise<void> {
    const client = await getCQLClient();
    await client.exec(
      `INSERT INTO moderation_flags (id, target_id, target_type, flag_type, reason, reporter_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        flag.id,
        flag.targetId,
        flag.targetType,
        flag.flagType,
        flag.reason,
        flag.reporterId,
        flag.createdAt,
      ],
      CQL_DATABASE_ID
    );
  },

  async getFlags(targetId: string): Promise<ModerationFlag[]> {
    const client = await getCQLClient();
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM moderation_flags WHERE target_id = ?`,
      [targetId],
      CQL_DATABASE_ID
    );
    return result.rows.map((row) => ({
      id: row.id as string,
      targetId: row.target_id as string,
      targetType: row.target_type as ModerationFlag["targetType"],
      flagType: row.flag_type as string,
      reason: row.reason as string,
      reporterId: row.reporter_id as string,
      createdAt: row.created_at as number,
    }));
  },
};

// Initialize state system
export async function initializeState(): Promise<void> {
  if (initialized) return;
  await getCQLClient();
  initialized = true;
  console.log("[Council] Decentralized state initialized");
}

// Get state mode - always "covenantql" in production
export function getStateMode(): "covenantql" {
  return "covenantql";
}
