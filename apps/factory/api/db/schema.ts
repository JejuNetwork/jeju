export const FACTORY_SCHEMA = `
-- Bounties table
CREATE TABLE IF NOT EXISTS bounties (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  reward TEXT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'review', 'completed', 'cancelled')),
  creator TEXT NOT NULL,
  deadline INTEGER NOT NULL,
  skills TEXT NOT NULL DEFAULT '[]',
  milestones TEXT DEFAULT '[]',
  submissions INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status);
CREATE INDEX IF NOT EXISTS idx_bounties_creator ON bounties(creator);
CREATE INDEX IF NOT EXISTS idx_bounties_deadline ON bounties(deadline);

-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  company_logo TEXT,
  type TEXT NOT NULL CHECK(type IN ('full-time', 'part-time', 'contract', 'bounty')),
  remote INTEGER NOT NULL DEFAULT 0,
  location TEXT NOT NULL,
  salary_min INTEGER,
  salary_max INTEGER,
  salary_currency TEXT,
  salary_period TEXT,
  skills TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL,
  applications INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed', 'filled')),
  poster TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
CREATE INDEX IF NOT EXISTS idx_jobs_remote ON jobs(remote);

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived', 'completed', 'on_hold')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'private', 'internal')),
  owner TEXT NOT NULL,
  members INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- Project tasks table
CREATE TABLE IF NOT EXISTS project_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed')),
  assignee TEXT,
  due_date INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_status ON project_tasks(status);

-- Issues table
CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL,
  repo TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
  author TEXT NOT NULL,
  labels TEXT NOT NULL DEFAULT '[]',
  assignees TEXT NOT NULL DEFAULT '[]',
  comments_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_issues_repo ON issues(repo);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_number ON issues(repo, number);

-- Issue comments table
CREATE TABLE IF NOT EXISTS issue_comments (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_issue_comments_issue ON issue_comments(issue_id);

-- Pull requests table
CREATE TABLE IF NOT EXISTS pull_requests (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL,
  repo TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed', 'merged')),
  is_draft INTEGER NOT NULL DEFAULT 0,
  author TEXT NOT NULL,
  source_branch TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  labels TEXT NOT NULL DEFAULT '[]',
  reviewers TEXT NOT NULL DEFAULT '[]',
  commits INTEGER NOT NULL DEFAULT 0,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  changed_files INTEGER NOT NULL DEFAULT 0,
  checks_passed INTEGER NOT NULL DEFAULT 0,
  checks_failed INTEGER NOT NULL DEFAULT 0,
  checks_pending INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_prs_repo ON pull_requests(repo);
CREATE INDEX IF NOT EXISTS idx_prs_status ON pull_requests(status);
CREATE INDEX IF NOT EXISTS idx_prs_number ON pull_requests(repo, number);

-- PR reviews table
CREATE TABLE IF NOT EXISTS pr_reviews (
  id TEXT PRIMARY KEY,
  pr_id TEXT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('approved', 'changes_requested', 'commented')),
  body TEXT NOT NULL,
  submitted_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_pr_reviews_pr ON pr_reviews(pr_id);

-- Discussions table
CREATE TABLE IF NOT EXISTS discussions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_avatar TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('general', 'questions', 'announcements', 'show', 'ideas')),
  tags TEXT NOT NULL DEFAULT '[]',
  replies_count INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_locked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  last_reply_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_discussions_category ON discussions(category);
CREATE INDEX IF NOT EXISTS idx_discussions_author ON discussions(author);

-- Discussion replies table
CREATE TABLE IF NOT EXISTS discussion_replies (
  id TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_avatar TEXT NOT NULL,
  content TEXT NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  is_answer INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_discussion_replies_discussion ON discussion_replies(discussion_id);

-- CI runs table
CREATE TABLE IF NOT EXISTS ci_runs (
  id TEXT PRIMARY KEY,
  workflow TEXT NOT NULL,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  commit_message TEXT NOT NULL,
  author TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'success', 'failure', 'cancelled')),
  conclusion TEXT,
  duration INTEGER,
  started_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  completed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_ci_runs_repo ON ci_runs(repo);
CREATE INDEX IF NOT EXISTS idx_ci_runs_status ON ci_runs(status);
CREATE INDEX IF NOT EXISTS idx_ci_runs_workflow ON ci_runs(workflow);

-- CI jobs table
CREATE TABLE IF NOT EXISTS ci_jobs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ci_runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'success', 'failure', 'skipped')),
  duration INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_ci_jobs_run ON ci_jobs(run_id);

-- Agents table (local registry supplement, main data from Crucible)
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  bot_type TEXT NOT NULL,
  character_cid TEXT,
  state_cid TEXT NOT NULL,
  vault_address TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  registered_at INTEGER NOT NULL,
  last_executed_at INTEGER NOT NULL DEFAULT 0,
  execution_count INTEGER NOT NULL DEFAULT 0,
  capabilities TEXT NOT NULL DEFAULT '[]',
  specializations TEXT NOT NULL DEFAULT '[]',
  reputation INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner);
CREATE INDEX IF NOT EXISTS idx_agents_active ON agents(active);
CREATE INDEX IF NOT EXISTS idx_agents_agent_id ON agents(agent_id);

-- Containers table
CREATE TABLE IF NOT EXISTS containers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tag TEXT NOT NULL,
  digest TEXT NOT NULL,
  size INTEGER NOT NULL,
  platform TEXT NOT NULL,
  labels TEXT DEFAULT '{}',
  downloads INTEGER NOT NULL DEFAULT 0,
  owner TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_containers_owner ON containers(owner);
CREATE INDEX IF NOT EXISTS idx_containers_name ON containers(name, tag);

-- Container instances table
CREATE TABLE IF NOT EXISTS container_instances (
  id TEXT PRIMARY KEY,
  container_id TEXT NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'building' CHECK(status IN ('running', 'stopped', 'building', 'failed')),
  cpu TEXT NOT NULL,
  memory TEXT NOT NULL,
  gpu TEXT,
  port INTEGER,
  endpoint TEXT,
  owner TEXT NOT NULL,
  started_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_container_instances_container ON container_instances(container_id);
CREATE INDEX IF NOT EXISTS idx_container_instances_owner ON container_instances(owner);
CREATE INDEX IF NOT EXISTS idx_container_instances_status ON container_instances(status);

-- Datasets table
CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  organization TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('text', 'code', 'image', 'audio', 'multimodal', 'tabular')),
  format TEXT NOT NULL DEFAULT 'unknown',
  size TEXT NOT NULL DEFAULT '0',
  rows INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  stars INTEGER NOT NULL DEFAULT 0,
  license TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  is_verified INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing', 'ready', 'failed')),
  owner TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_datasets_org ON datasets(organization);
CREATE INDEX IF NOT EXISTS idx_datasets_type ON datasets(type);
CREATE INDEX IF NOT EXISTS idx_datasets_status ON datasets(status);

-- Models table
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  organization TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('llm', 'embedding', 'image', 'audio', 'multimodal', 'code')),
  description TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  file_uri TEXT NOT NULL,
  downloads INTEGER NOT NULL DEFAULT 0,
  stars INTEGER NOT NULL DEFAULT 0,
  size TEXT,
  license TEXT,
  status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing', 'ready', 'failed')),
  owner TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_models_org ON models(organization);
CREATE INDEX IF NOT EXISTS idx_models_type ON models(type);
CREATE INDEX IF NOT EXISTS idx_models_status ON models(status);

-- Leaderboard scores table
CREATE TABLE IF NOT EXISTS leaderboard (
  address TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  contributions INTEGER NOT NULL DEFAULT 0,
  bounties_completed INTEGER NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'bronze' CHECK(tier IN ('bronze', 'silver', 'gold', 'diamond')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON leaderboard(score DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_tier ON leaderboard(tier);

-- Repo settings table
CREATE TABLE IF NOT EXISTS repo_settings (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'private')),
  default_branch TEXT NOT NULL DEFAULT 'main',
  has_issues INTEGER NOT NULL DEFAULT 1,
  has_wiki INTEGER NOT NULL DEFAULT 0,
  has_discussions INTEGER NOT NULL DEFAULT 1,
  allow_merge_commit INTEGER NOT NULL DEFAULT 1,
  allow_squash_merge INTEGER NOT NULL DEFAULT 1,
  allow_rebase_merge INTEGER NOT NULL DEFAULT 1,
  delete_branch_on_merge INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  PRIMARY KEY (owner, repo)
);

-- Repo collaborators table
CREATE TABLE IF NOT EXISTS repo_collaborators (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  login TEXT NOT NULL,
  avatar TEXT NOT NULL,
  permission TEXT NOT NULL CHECK(permission IN ('read', 'write', 'admin')),
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  PRIMARY KEY (owner, repo, login)
);

-- Repo webhooks table
CREATE TABLE IF NOT EXISTS repo_webhooks (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  url TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_repo_webhooks_repo ON repo_webhooks(owner, repo);

-- Package settings table
CREATE TABLE IF NOT EXISTS package_settings (
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'private')),
  publish_enabled INTEGER NOT NULL DEFAULT 1,
  deprecated INTEGER NOT NULL DEFAULT 0,
  deprecation_message TEXT,
  download_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  PRIMARY KEY (scope, name)
);

-- Package maintainers table
CREATE TABLE IF NOT EXISTS package_maintainers (
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  login TEXT NOT NULL,
  avatar TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner', 'maintainer')),
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  PRIMARY KEY (scope, name, login)
);

-- Package access tokens table
CREATE TABLE IF NOT EXISTS package_tokens (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  token_name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT '[]',
  expires_at INTEGER,
  last_used INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_package_tokens_package ON package_tokens(scope, name);

-- Issue number sequences (per repo)
CREATE TABLE IF NOT EXISTS issue_sequences (
  repo TEXT PRIMARY KEY,
  next_number INTEGER NOT NULL DEFAULT 1
);

-- PR number sequences (per repo)
CREATE TABLE IF NOT EXISTS pr_sequences (
  repo TEXT PRIMARY KEY,
  next_number INTEGER NOT NULL DEFAULT 1
);

-- Farcaster FID links (wallet address to FID mapping)
CREATE TABLE IF NOT EXISTS fid_links (
  address TEXT PRIMARY KEY,
  fid INTEGER NOT NULL,
  username TEXT,
  display_name TEXT,
  pfp_url TEXT,
  bio TEXT,
  verified_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_fid_links_fid ON fid_links(fid);

-- Farcaster signers (encrypted signer keys for users)
CREATE TABLE IF NOT EXISTS farcaster_signers (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  fid INTEGER NOT NULL,
  signer_public_key TEXT NOT NULL,
  encrypted_private_key TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  key_state TEXT NOT NULL DEFAULT 'pending' CHECK(key_state IN ('pending', 'active', 'revoked')),
  deadline INTEGER,
  signature TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_farcaster_signers_address ON farcaster_signers(address);
CREATE INDEX IF NOT EXISTS idx_farcaster_signers_fid ON farcaster_signers(fid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_farcaster_signers_pubkey ON farcaster_signers(signer_public_key);

-- Project Farcaster channels
CREATE TABLE IF NOT EXISTS project_channels (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  channel_url TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_project_channels_channel ON project_channels(channel_id);

-- Cast reactions (local cache for user reactions)
CREATE TABLE IF NOT EXISTS cast_reactions (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  cast_hash TEXT NOT NULL,
  cast_fid INTEGER NOT NULL,
  reaction_type TEXT NOT NULL CHECK(reaction_type IN ('like', 'recast')),
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cast_reactions_unique ON cast_reactions(address, cast_hash, reaction_type);
CREATE INDEX IF NOT EXISTS idx_cast_reactions_cast ON cast_reactions(cast_hash);
`

export default FACTORY_SCHEMA
