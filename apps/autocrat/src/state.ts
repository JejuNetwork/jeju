/**
 * Decentralized State Management for Autocrat
 * 
 * Persists governance state (proposals, votes, research) to CovenantSQL.
 * CQL is REQUIRED - automatically configured per network.
 */

import { getCQL, type CQLClient, type QueryParam } from "@jejunetwork/db";
import { getCacheClient, type CacheClient } from "@jejunetwork/shared";
import { getCurrentNetwork } from "@jejunetwork/config";
import { z } from 'zod';
import type { StoredObject, AutocratVote } from "./types.js";

const CQL_DATABASE_ID = process.env.CQL_DATABASE_ID ?? "autocrat";

// ============ Schemas for JSON parsing ============

const ProposalStatusSchema = z.enum(["draft", "review", "voting", "approved", "rejected", "executed"]);
const ModerationTargetTypeSchema = z.enum(["proposal", "user", "research"]);

const AutocratVotesRecordSchema = z.record(z.string(), z.boolean());
const SourcesArraySchema = z.array(z.string());

const ProposalSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  author: z.string(),
  status: ProposalStatusSchema,
  qualityScore: z.number(),
  autocratVotes: AutocratVotesRecordSchema,
  futarchyMarketId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// ============ Types ============

export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;
export type ModerationTargetType = z.infer<typeof ModerationTargetTypeSchema>;

export interface Proposal {
  id: string;
  title: string;
  description: string;
  author: string;
  status: ProposalStatus;
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
  targetType: ModerationTargetType;
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
    // CQL URL is automatically resolved from network config
    cqlClient = getCQL({
      databaseId: CQL_DATABASE_ID,
      timeout: 30000,
      debug: process.env.NODE_ENV !== 'production',
    });
    
    const healthy = await cqlClient.isHealthy();
    if (!healthy) {
      const network = getCurrentNetwork();
      throw new Error(
        `Autocrat requires CovenantSQL for decentralized state (network: ${network}).\n` +
        'Ensure CQL is running: docker compose up -d cql'
      );
    }
    
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
    `CREATE TABLE IF NOT EXISTS autocrat_votes (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      role TEXT NOT NULL,
      vote TEXT NOT NULL,
      reasoning TEXT,
      confidence INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS proposal_content_index (
      content_hash TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      proposal_type INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS storage_objects (
      hash TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      object_type TEXT,
      created_at INTEGER NOT NULL
    )`,
  ];

  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_proposals_author ON proposals(author)`,
    `CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status)`,
    `CREATE INDEX IF NOT EXISTS idx_research_proposal ON research_results(proposal_id)`,
    `CREATE INDEX IF NOT EXISTS idx_flags_target ON moderation_flags(target_id)`,
    `CREATE INDEX IF NOT EXISTS idx_autocrat_votes_proposal ON autocrat_votes(proposal_id)`,
    `CREATE INDEX IF NOT EXISTS idx_storage_type ON storage_objects(object_type)`,
  ];

  for (const ddl of tables) {
    await cqlClient!.exec(ddl, [], CQL_DATABASE_ID);
  }

  for (const idx of indexes) {
    await cqlClient!.exec(idx, [], CQL_DATABASE_ID);
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
      const parsed = JSON.parse(cached);
      return ProposalSchema.parse(parsed);
    }

    const client = await getCQLClient();
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM proposals WHERE id = ?`,
      [id],
      CQL_DATABASE_ID
    );
    const row = result.rows[0];
    if (row) {
      const autocratVotes = AutocratVotesRecordSchema.parse(
        JSON.parse((row.council_votes as string) || "{}")
      );
      const proposal: Proposal = {
        id: row.id as string,
        title: row.title as string,
        description: row.description as string,
        author: row.author as string,
        status: ProposalStatusSchema.parse(row.status),
        qualityScore: row.quality_score as number,
        autocratVotes,
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
    const params: QueryParam[] = [Date.now()];

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

  async list(status?: ProposalStatus, limit = 50): Promise<Proposal[]> {
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
      status: ProposalStatusSchema.parse(row.status),
      qualityScore: row.quality_score as number,
      autocratVotes: AutocratVotesRecordSchema.parse(
        JSON.parse((row.council_votes as string) || "{}")
      ),
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
      sources: SourcesArraySchema.parse(JSON.parse((row.sources as string) || "[]")),
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

// Autocrat vote operations (individual council member votes on proposals)
export const autocratVoteState = {
  async save(proposalId: string, vote: AutocratVote): Promise<void> {
    const client = await getCQLClient();
    const id = `${proposalId}-${vote.role}-${vote.timestamp}`;
    await client.exec(
      `INSERT INTO autocrat_votes (id, proposal_id, role, vote, reasoning, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, proposalId, vote.role, vote.vote, vote.reasoning, vote.confidence, vote.timestamp],
      CQL_DATABASE_ID
    );
  },

  async getByProposal(proposalId: string): Promise<AutocratVote[]> {
    const client = await getCQLClient();
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM autocrat_votes WHERE proposal_id = ? ORDER BY created_at ASC`,
      [proposalId],
      CQL_DATABASE_ID
    );
    return result.rows.map((row) => ({
      role: row.role as string,
      vote: row.vote as string,
      reasoning: row.reasoning as string,
      confidence: row.confidence as number,
      timestamp: row.created_at as number,
    }));
  },
};

// Proposal content index for duplicate detection
export interface ProposalContent {
  title: string;
  description: string;
  proposalType: number;
  createdAt: number;
  contentHash: string;
}

export const proposalIndexState = {
  async index(contentHash: string, title: string, description: string, proposalType: number): Promise<void> {
    const client = await getCQLClient();
    await client.exec(
      `INSERT INTO proposal_content_index (content_hash, title, description, proposal_type, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(content_hash) DO NOTHING`,
      [contentHash, title, description, proposalType, Date.now()],
      CQL_DATABASE_ID
    );
  },

  async findSimilar(title: string, threshold = 30): Promise<Array<{ contentHash: string; title: string; similarity: number }>> {
    const client = await getCQLClient();
    const result = await client.query<Record<string, unknown>>(
      `SELECT content_hash, title FROM proposal_content_index`,
      [],
      CQL_DATABASE_ID
    );

    const words = new Set(title.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    if (words.size === 0) return [];

    const results: Array<{ contentHash: string; title: string; similarity: number }> = [];
    for (const row of result.rows) {
      const pTitle = row.title as string;
      const pWords = new Set(pTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3));
      const matches = [...words].filter(w => pWords.has(w)).length;
      const similarity = Math.round((matches / Math.max(words.size, 1)) * 100);
      if (similarity >= threshold) {
        results.push({ contentHash: row.content_hash as string, title: pTitle, similarity });
      }
    }
    return results.sort((a, b) => b.similarity - a.similarity).slice(0, 5);
  },

  async getAll(): Promise<Map<string, ProposalContent>> {
    const client = await getCQLClient();
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM proposal_content_index`,
      [],
      CQL_DATABASE_ID
    );
    const map = new Map<string, ProposalContent>();
    for (const row of result.rows) {
      map.set(row.content_hash as string, {
        contentHash: row.content_hash as string,
        title: row.title as string,
        description: row.description as string,
        proposalType: row.proposal_type as number,
        createdAt: row.created_at as number,
      });
    }
    return map;
  },
};

// Schema for CEO Analysis Result
const CEOAnalysisResultSchema = z.object({
  approved: z.boolean(),
  reasoning: z.string(),
  personaResponse: z.string(),
  confidence: z.number(),
  alignment: z.number(),
  recommendations: z.array(z.string()),
});

// Schema for TEE Attestation
const TEEAttestationSchema = z.object({
  provider: z.enum(['local', 'remote']),
  quote: z.string().optional(),
  measurement: z.string().optional(),
  timestamp: z.number(),
  verified: z.boolean(),
});

// Schema for TEE Decision Data
const TEEDecisionDataSchema = z.object({
  approved: z.boolean(),
  publicReasoning: z.string(),
  confidenceScore: z.number(),
  alignmentScore: z.number(),
  recommendations: z.array(z.string()),
  encryptedHash: z.string(),
  attestation: TEEAttestationSchema,
});

// Schema for validating stored objects retrieved from database
const StoredObjectSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('vote'),
    proposalId: z.string(),
    daoId: z.string().optional(),
    role: z.string(),
    vote: z.string(),
    reasoning: z.string(),
    confidence: z.number(),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal('research'),
    proposalId: z.string(),
    report: z.string(),
    model: z.string(),
    completedAt: z.number(),
  }),
  z.object({
    type: z.literal('commentary'),
    proposalId: z.string(),
    content: z.string(),
    sentiment: z.enum(['positive', 'negative', 'neutral', 'concern']),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal('ceo_decision'),
    proposalId: z.string(),
    approved: z.boolean(),
    confidenceScore: z.number(),
    alignmentScore: z.number(),
    autocratVotes: z.object({
      approve: z.number(),
      reject: z.number(),
      abstain: z.number(),
    }),
    reasoning: z.string(),
    recommendations: z.array(z.string()),
    timestamp: z.string(),
    model: z.string(),
    teeMode: z.string(),
  }),
  z.object({
    type: z.literal('autocrat_vote_detail'),
    proposalId: z.string(),
    daoId: z.string(),
    agent: z.string(),
    role: z.string(),
    vote: z.enum(['APPROVE', 'REJECT', 'ABSTAIN']),
    reasoning: z.string(),
    confidence: z.number(),
  }),
  z.object({
    type: z.literal('ceo_decision_detail'),
    proposalId: z.string(),
    daoId: z.string(),
    ceoAnalysis: CEOAnalysisResultSchema,
    teeDecision: TEEDecisionDataSchema,
    personaResponse: z.string(),
    decidedAt: z.number(),
  }),
]);

// Generic object storage (replaces local file storage)
export const storageState = {
  async store(data: StoredObject): Promise<string> {
    const content = JSON.stringify(data);
    const { keccak256, stringToHex } = await import('viem');
    const hash = keccak256(stringToHex(content)).slice(2, 50);
    
    const client = await getCQLClient();
    const objectType = data.type;
    
    await client.exec(
      `INSERT INTO storage_objects (hash, content, object_type, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(hash) DO NOTHING`,
      [hash, content, objectType, Date.now()],
      CQL_DATABASE_ID
    );
    
    // Also cache for fast retrieval
    await getCache().set(`storage:${hash}`, content, 3600);
    
    return hash;
  },

  async retrieve(hash: string): Promise<StoredObject | null> {
    // Check cache first
    const cache = getCache();
    const cached = await cache.get(`storage:${hash}`).catch(() => null);
    if (cached) {
      const parsed: unknown = JSON.parse(cached);
      return StoredObjectSchema.parse(parsed);
    }

    const client = await getCQLClient();
    const result = await client.query<{ content: string }>(
      `SELECT content FROM storage_objects WHERE hash = ?`,
      [hash],
      CQL_DATABASE_ID
    );
    
    if (result.rows[0]) {
      const content = result.rows[0].content;
      await cache.set(`storage:${hash}`, content, 3600);
      const parsed: unknown = JSON.parse(content);
      return StoredObjectSchema.parse(parsed);
    }
    return null;
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
