-- Add JejuGit support to repositories table
ALTER TABLE repositories ADD COLUMN source TEXT DEFAULT 'github';
ALTER TABLE repositories ADD COLUMN source_url TEXT;
ALTER TABLE repositories ADD COLUMN head_cid TEXT;
ALTER TABLE repositories ADD COLUMN pack_cid TEXT;
ALTER TABLE repositories ADD COLUMN storage_backend TEXT DEFAULT 'github';
ALTER TABLE repositories ADD COLUMN reputation_score REAL DEFAULT 0;
ALTER TABLE repositories ADD COLUMN council_proposal_id TEXT;
ALTER TABLE repositories ADD COLUMN verified INTEGER DEFAULT 0;

-- Create index for source filtering
CREATE INDEX IF NOT EXISTS idx_repositories_source ON repositories(source);
CREATE INDEX IF NOT EXISTS idx_repositories_verified ON repositories(verified);
