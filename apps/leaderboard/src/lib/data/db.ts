/**
 * Decentralized Database Layer for Leaderboard
 * 
 * Uses CovenantSQL for decentralized storage with BFT consensus.
 * DECENTRALIZED: No fallbacks - CQL is required.
 */

import * as schema from "./schema";
import { getCQL } from "@jeju/db";
import type { CQLClient } from "@jeju/db";

// Database configuration
interface DatabaseConfig {
  cqlDatabaseId: string;
  cqlRequired: boolean;
}

const config: DatabaseConfig = {
  cqlDatabaseId: process.env.COVENANTSQL_DATABASE_ID ?? "leaderboard",
  cqlRequired: process.env.CQL_REQUIRED !== "false", // Default to required
};

// CQL client for decentralized mode
let cqlClient: CQLClient | null = null;
let initialized = false;

/**
 * Initialize the database connection
 * 
 * DECENTRALIZED: Requires CovenantSQL. No SQLite fallback.
 */
export async function initializeDatabase(): Promise<void> {
  if (initialized) return;

  const cqlNodes = process.env.COVENANTSQL_NODES;
  
  if (!cqlNodes && config.cqlRequired) {
    throw new Error(
      'Leaderboard requires CovenantSQL for decentralized storage.\n' +
      'Set COVENANTSQL_NODES environment variable or start stack:\n' +
      '  docker compose up -d\n' +
      '\n' +
      'Or set CQL_REQUIRED=false for testing (not recommended for production).'
    );
  }

  console.log("[Database] Initializing CovenantSQL connection...");
  cqlClient = getCQL();
  await cqlClient.initialize();
  await ensureCQLTablesExist();
  console.log("[Database] CovenantSQL connected");
  initialized = true;
}

/**
 * Get the CQL client
 */
export function getCQLClient(): CQLClient {
  if (!cqlClient) {
    throw new Error("Database not initialized. Call initializeDatabase() first.");
  }
  return cqlClient;
}

/**
 * Get database mode - always CQL in production
 */
export function getDatabaseMode(): "covenantql" {
  return "covenantql";
}

/**
 * Execute a query
 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  if (!cqlClient) {
    throw new Error("Database not initialized. Call initializeDatabase() first.");
  }
  const result = await cqlClient.query<T>(sql, params, config.cqlDatabaseId);
  return result.rows;
}

/**
 * Execute a statement (INSERT, UPDATE, DELETE)
 */
export async function exec(
  sql: string,
  params: unknown[] = []
): Promise<{ changes: number; lastInsertRowid: number }> {
  if (!cqlClient) {
    throw new Error("Database not initialized. Call initializeDatabase() first.");
  }
  const result = await cqlClient.exec(sql, params, config.cqlDatabaseId);
  return { changes: result.affectedRows, lastInsertRowid: 0 };
}

/**
 * Run a transaction
 */
export async function transaction<T>(
  fn: () => Promise<T>
): Promise<T> {
  if (!cqlClient) {
    throw new Error("Database not initialized. Call initializeDatabase() first.");
  }
  const tx = await cqlClient.beginTransaction();
  try {
    const result = await fn();
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

/**
 * Create tables in CovenantSQL
 */
async function ensureCQLTablesExist(): Promise<void> {
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      avatar_url TEXT DEFAULT '',
      is_bot INTEGER NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      wallet_data_updated_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS wallet_addresses (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      chain_id TEXT NOT NULL,
      account_address TEXT NOT NULL,
      label TEXT,
      is_primary INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      signature TEXT,
      signature_message TEXT,
      is_verified INTEGER DEFAULT 0,
      verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS repositories (
      repo_id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      stars INTEGER DEFAULT 0,
      forks INTEGER DEFAULT 0,
      last_fetched_at TEXT DEFAULT '',
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS raw_pull_requests (
      id TEXT PRIMARY KEY,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      state TEXT NOT NULL,
      merged INTEGER NOT NULL DEFAULT 0,
      author TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT,
      merged_at TEXT,
      repository TEXT NOT NULL,
      head_ref_oid TEXT,
      base_ref_oid TEXT,
      additions INTEGER DEFAULT 0,
      deletions INTEGER DEFAULT 0,
      changed_files INTEGER DEFAULT 0,
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS raw_issues (
      id TEXT PRIMARY KEY,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      state TEXT NOT NULL,
      locked INTEGER DEFAULT 0,
      author TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT,
      repository TEXT NOT NULL,
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS raw_commits (
      oid TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      message_headline TEXT,
      committed_date TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_email TEXT NOT NULL,
      author_date TEXT NOT NULL,
      author TEXT,
      repository TEXT NOT NULL,
      additions INTEGER DEFAULT 0,
      deletions INTEGER DEFAULT 0,
      changed_files INTEGER DEFAULT 0,
      pull_request_id TEXT,
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS user_daily_scores (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      date TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      score REAL NOT NULL DEFAULT 0,
      pr_score REAL DEFAULT 0,
      issue_score REAL DEFAULT 0,
      review_score REAL DEFAULT 0,
      comment_score REAL DEFAULT 0,
      metrics TEXT NOT NULL DEFAULT '{}',
      category TEXT DEFAULT 'day',
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS tags (
      name TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      description TEXT DEFAULT '',
      weight REAL NOT NULL DEFAULT 1.0,
      patterns TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS user_tag_scores (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      tag TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 0,
      progress REAL NOT NULL DEFAULT 0,
      points_to_next REAL NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS user_summaries (
      id TEXT PRIMARY KEY,
      username TEXT,
      interval_type TEXT NOT NULL DEFAULT 'day',
      date TEXT NOT NULL,
      summary TEXT DEFAULT '',
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS repo_summaries (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL,
      interval_type TEXT NOT NULL DEFAULT 'month',
      date TEXT NOT NULL,
      summary TEXT DEFAULT '',
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS overall_summaries (
      id TEXT PRIMARY KEY,
      interval_type TEXT NOT NULL DEFAULT 'month',
      date TEXT NOT NULL,
      summary TEXT DEFAULT '',
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS reputation_attestations (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      chain_id TEXT NOT NULL,
      total_score REAL NOT NULL DEFAULT 0,
      pr_score REAL NOT NULL DEFAULT 0,
      issue_score REAL NOT NULL DEFAULT 0,
      review_score REAL NOT NULL DEFAULT 0,
      commit_score REAL NOT NULL DEFAULT 0,
      merged_pr_count INTEGER NOT NULL DEFAULT 0,
      total_pr_count INTEGER NOT NULL DEFAULT 0,
      total_commits INTEGER NOT NULL DEFAULT 0,
      normalized_score INTEGER NOT NULL DEFAULT 0,
      attestation_hash TEXT,
      oracle_signature TEXT,
      tx_hash TEXT,
      agent_id INTEGER,
      validation_request_hash TEXT,
      score_calculated_at TEXT NOT NULL,
      attested_at TEXT,
      submitted_on_chain_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  ];

  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_wallet_addresses_user_id ON wallet_addresses(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_raw_prs_author ON raw_pull_requests(author)`,
    `CREATE INDEX IF NOT EXISTS idx_raw_prs_repo ON raw_pull_requests(repository)`,
    `CREATE INDEX IF NOT EXISTS idx_raw_issues_author ON raw_issues(author)`,
    `CREATE INDEX IF NOT EXISTS idx_raw_commits_author ON raw_commits(author)`,
    `CREATE INDEX IF NOT EXISTS idx_user_daily_scores_username ON user_daily_scores(username)`,
    `CREATE INDEX IF NOT EXISTS idx_user_daily_scores_date ON user_daily_scores(date)`,
    `CREATE INDEX IF NOT EXISTS idx_user_tag_scores_username ON user_tag_scores(username)`,
  ];

  for (const ddl of tables) {
    await cqlClient!.exec(ddl, [], config.cqlDatabaseId);
  }

  for (const idx of indexes) {
    await cqlClient!.exec(idx, [], config.cqlDatabaseId).catch(() => {
      // Index might already exist
    });
  }

  console.log("[Database] CovenantSQL tables ensured");
}

/**
 * Close database connection
 */
export async function closeDatabase(): Promise<void> {
  if (cqlClient) {
    await cqlClient.close();
    cqlClient = null;
    initialized = false;
  }
}

/**
 * Legacy db export - throws an error guiding to new API
 */
export const db = new Proxy({} as unknown, {
  get(_, prop) {
    throw new Error(
      `Direct db.${String(prop)} access is no longer supported.\n` +
      `Use the query() and exec() functions for CQL operations.\n` +
      `See packages/db for API documentation.`
    );
  },
}) as typeof schema;

// Export schema for type access
export { schema };

// Cleanup on process exit
process.on("exit", () => {
  closeDatabase().catch(console.error);
});
