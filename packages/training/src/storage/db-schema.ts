/**
 * Database schema for trajectory batch and dataset references
 */

export const TRAJECTORY_BATCH_SCHEMA = `
CREATE TABLE IF NOT EXISTS trajectory_batches (
  batch_id TEXT PRIMARY KEY,
  app_name TEXT NOT NULL,
  archetype TEXT,
  storage_cid TEXT NOT NULL,
  storage_provider TEXT NOT NULL CHECK (storage_provider IN ('ipfs', 'arweave')),
  trajectory_count INTEGER NOT NULL,
  total_steps INTEGER NOT NULL,
  total_reward REAL NOT NULL,
  time_window_start TEXT NOT NULL,
  time_window_end TEXT NOT NULL,
  created_at TEXT NOT NULL,
  compressed_size_bytes INTEGER NOT NULL,
  uncompressed_size_bytes INTEGER NOT NULL,
  trajectory_ids TEXT NOT NULL,
  processed_at TEXT,
  dataset_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_trajectory_batches_app ON trajectory_batches(app_name);
CREATE INDEX IF NOT EXISTS idx_trajectory_batches_archetype ON trajectory_batches(archetype);
CREATE INDEX IF NOT EXISTS idx_trajectory_batches_created ON trajectory_batches(created_at);
CREATE INDEX IF NOT EXISTS idx_trajectory_batches_unprocessed ON trajectory_batches(processed_at) WHERE processed_at IS NULL;
`

export const DATASET_REFERENCE_SCHEMA = `
CREATE TABLE IF NOT EXISTS scored_datasets (
  dataset_id TEXT PRIMARY KEY,
  app_name TEXT NOT NULL,
  archetype TEXT NOT NULL,
  source_batch_cids TEXT NOT NULL,
  permanent_cid TEXT NOT NULL,
  storage_provider TEXT NOT NULL DEFAULT 'arweave',
  trajectory_count INTEGER NOT NULL,
  total_steps INTEGER NOT NULL,
  average_score REAL NOT NULL,
  score_min REAL NOT NULL,
  score_max REAL NOT NULL,
  score_median REAL NOT NULL,
  score_std_dev REAL NOT NULL,
  created_at TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  ruler_model_id TEXT NOT NULL,
  ruler_version TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_datasets_app ON scored_datasets(app_name);
CREATE INDEX IF NOT EXISTS idx_datasets_archetype ON scored_datasets(archetype);
CREATE INDEX IF NOT EXISTS idx_datasets_created ON scored_datasets(created_at);
`

export const ALL_TRAINING_SCHEMAS = [
  TRAJECTORY_BATCH_SCHEMA,
  DATASET_REFERENCE_SCHEMA,
]
