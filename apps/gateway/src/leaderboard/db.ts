/**
 * Leaderboard Database Layer
 * 
 * Uses @jejunetwork/db (CQL) for decentralized storage.
 * Schema matches the original leaderboard data model.
 */

import { createDatabaseService, type DatabaseService, type QueryParam } from '@jejunetwork/shared';
import { LEADERBOARD_CONFIG } from './config.js';

// Database instance
let db: DatabaseService | null = null;
let initialized = false;

/**
 * Get or create the database service
 */
export function getLeaderboardDB(): DatabaseService {
  if (!db) {
    db = createDatabaseService({
      databaseId: LEADERBOARD_CONFIG.db.databaseId,
      endpoint: LEADERBOARD_CONFIG.db.endpoint,
      timeout: LEADERBOARD_CONFIG.db.timeout,
      debug: LEADERBOARD_CONFIG.db.debug,
    });
  }
  return db;
}

/**
 * Initialize database with schema
 */
export async function initLeaderboardDB(): Promise<void> {
  if (initialized) return;

  const database = getLeaderboardDB();
  
  // Check health
  const healthy = await database.isHealthy();
  if (!healthy) {
    throw new Error(
      'CQL database not available. Ensure CQL block producer is running:\n' +
      `  Endpoint: ${LEADERBOARD_CONFIG.db.endpoint}\n` +
      '  Run: docker compose up -d'
    );
  }

  // Create tables
  await createSchema(database);
  initialized = true;
  console.log('[Leaderboard DB] Initialized');
}

/**
 * Create schema tables
 */
async function createSchema(database: DatabaseService): Promise<void> {
  const tables = [
    // Users
    `CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      avatar_url TEXT DEFAULT '',
      is_bot INTEGER NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      wallet_data_updated_at INTEGER
    )`,

    // Wallet addresses
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
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, chain_id, account_address)
    )`,

    // Repositories
    `CREATE TABLE IF NOT EXISTS repositories (
      repo_id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      stars INTEGER DEFAULT 0,
      forks INTEGER DEFAULT 0,
      last_fetched_at TEXT DEFAULT '',
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(owner, name)
    )`,

    // Pull requests
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
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(repository, number)
    )`,

    // Issues
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
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(repository, number)
    )`,

    // Commits
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

    // PR reviews
    `CREATE TABLE IF NOT EXISTS pr_reviews (
      id TEXT PRIMARY KEY,
      pr_id TEXT NOT NULL,
      state TEXT NOT NULL,
      body TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      author TEXT,
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,

    // Daily scores
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
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(username, date, category)
    )`,

    // Tags
    `CREATE TABLE IF NOT EXISTS tags (
      name TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      description TEXT DEFAULT '',
      weight REAL NOT NULL DEFAULT 1.0,
      patterns TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,

    // User tag scores
    `CREATE TABLE IF NOT EXISTS user_tag_scores (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      tag TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 0,
      progress REAL NOT NULL DEFAULT 0,
      points_to_next REAL NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(username, tag)
    )`,

    // User summaries
    `CREATE TABLE IF NOT EXISTS user_summaries (
      id TEXT PRIMARY KEY,
      username TEXT,
      interval_type TEXT NOT NULL DEFAULT 'day',
      date TEXT NOT NULL,
      summary TEXT DEFAULT '',
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(username, interval_type, date)
    )`,

    // Repo summaries
    `CREATE TABLE IF NOT EXISTS repo_summaries (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL,
      interval_type TEXT NOT NULL DEFAULT 'month',
      date TEXT NOT NULL,
      summary TEXT DEFAULT '',
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(repo_id, interval_type, date)
    )`,

    // Overall summaries
    `CREATE TABLE IF NOT EXISTS overall_summaries (
      id TEXT PRIMARY KEY,
      interval_type TEXT NOT NULL DEFAULT 'month',
      date TEXT NOT NULL,
      summary TEXT DEFAULT '',
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(interval_type, date)
    )`,

    // Reputation attestations
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
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(wallet_address, chain_id)
    )`,

    // Agent identity links
    `CREATE TABLE IF NOT EXISTS agent_identity_links (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      chain_id TEXT NOT NULL,
      agent_id INTEGER NOT NULL,
      registry_address TEXT NOT NULL,
      is_verified INTEGER DEFAULT 0,
      verified_at TEXT,
      verification_tx_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(wallet_address, chain_id, agent_id)
    )`,
    // DWS integration tables
    `CREATE TABLE IF NOT EXISTS wallet_mappings (
      id INTEGER PRIMARY KEY,
      wallet_address TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS package_stats (
      package_id TEXT PRIMARY KEY,
      package_name TEXT NOT NULL,
      download_count INTEGER NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  ];

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_wallet_addresses_user_id ON wallet_addresses(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_wallet_addresses_address ON wallet_addresses(account_address)',
    'CREATE INDEX IF NOT EXISTS idx_wallet_addresses_verified ON wallet_addresses(is_verified)',
    'CREATE INDEX IF NOT EXISTS idx_raw_prs_author ON raw_pull_requests(author)',
    'CREATE INDEX IF NOT EXISTS idx_raw_prs_repo ON raw_pull_requests(repository)',
    'CREATE INDEX IF NOT EXISTS idx_raw_prs_created_at ON raw_pull_requests(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_raw_issues_author ON raw_issues(author)',
    'CREATE INDEX IF NOT EXISTS idx_raw_issues_repo ON raw_issues(repository)',
    'CREATE INDEX IF NOT EXISTS idx_raw_commits_author ON raw_commits(author)',
    'CREATE INDEX IF NOT EXISTS idx_raw_commits_repo ON raw_commits(repository)',
    'CREATE INDEX IF NOT EXISTS idx_user_daily_scores_username ON user_daily_scores(username)',
    'CREATE INDEX IF NOT EXISTS idx_user_daily_scores_date ON user_daily_scores(date)',
    'CREATE INDEX IF NOT EXISTS idx_user_tag_scores_username ON user_tag_scores(username)',
    'CREATE INDEX IF NOT EXISTS idx_attestations_user_id ON reputation_attestations(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_attestations_wallet ON reputation_attestations(wallet_address)',
    'CREATE INDEX IF NOT EXISTS idx_agent_links_user_id ON agent_identity_links(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_agent_links_agent_id ON agent_identity_links(agent_id)',
    'CREATE INDEX IF NOT EXISTS idx_wallet_mappings_username ON wallet_mappings(username)',
    'CREATE INDEX IF NOT EXISTS idx_package_stats_name ON package_stats(package_name)',
  ];

  // Execute DDL
  for (const ddl of tables) {
    await database.exec(ddl);
  }

  for (const idx of indexes) {
    await database.exec(idx).catch(() => { /* index may exist */ });
  }

  console.log('[Leaderboard DB] Schema created');
}

/**
 * Query helper with typed results
 */
export async function query<T>(sql: string, params: QueryParam[] = []): Promise<T[]> {
  const database = getLeaderboardDB();
  const result = await database.query<T>(sql, params);
  return result.rows;
}

/**
 * Execute statement (INSERT, UPDATE, DELETE)
 */
export async function exec(sql: string, params: QueryParam[] = []): Promise<{ rowsAffected: number }> {
  const database = getLeaderboardDB();
  return database.exec(sql, params);
}

/**
 * Close database connection
 */
export async function closeLeaderboardDB(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
    initialized = false;
  }
}

// Cleanup on process exit
process.on('exit', () => {
  closeLeaderboardDB().catch(console.error);
});



