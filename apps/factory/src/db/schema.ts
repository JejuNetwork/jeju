/**
 * Factory Database Schema
 * CovenantSQL tables for decentralized persistence
 */

import type { TableSchema } from '@jejunetwork/shared'

// ============================================================================
// Bounty Tables
// ============================================================================

export const bountiesSchema: TableSchema = {
  name: 'bounties',
  columns: [
    { name: 'id', type: 'TEXT', nullable: false },
    { name: 'title', type: 'TEXT', nullable: false },
    { name: 'description', type: 'TEXT', nullable: false },
    { name: 'creator', type: 'TEXT', nullable: false },
    { name: 'reward', type: 'TEXT', nullable: false },
    { name: 'currency', type: 'TEXT', nullable: false },
    { name: 'skills', type: 'JSON', nullable: false },
    { name: 'status', type: 'TEXT', nullable: false, default: 'open' },
    { name: 'deadline', type: 'BIGINT', nullable: false },
    { name: 'milestones', type: 'JSON', nullable: true },
    { name: 'submissions_count', type: 'INTEGER', nullable: false, default: 0 },
    { name: 'created_at', type: 'BIGINT', nullable: false },
    { name: 'updated_at', type: 'BIGINT', nullable: false },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_bounties_creator', columns: ['creator'] },
    { name: 'idx_bounties_status', columns: ['status'] },
    { name: 'idx_bounties_deadline', columns: ['deadline'] },
  ],
  consistency: 'strong',
}

export const bountySubmissionsSchema: TableSchema = {
  name: 'bounty_submissions',
  columns: [
    { name: 'id', type: 'TEXT', nullable: false },
    { name: 'bounty_id', type: 'TEXT', nullable: false },
    { name: 'submitter', type: 'TEXT', nullable: false },
    { name: 'description', type: 'TEXT', nullable: false },
    { name: 'proof_cid', type: 'TEXT', nullable: true },
    { name: 'status', type: 'TEXT', nullable: false, default: 'pending' },
    { name: 'created_at', type: 'BIGINT', nullable: false },
    { name: 'reviewed_at', type: 'BIGINT', nullable: true },
    { name: 'reviewer', type: 'TEXT', nullable: true },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_submissions_bounty', columns: ['bounty_id'] },
    { name: 'idx_submissions_submitter', columns: ['submitter'] },
  ],
}

// ============================================================================
// Job Tables
// ============================================================================

export const jobsSchema: TableSchema = {
  name: 'jobs',
  columns: [
    { name: 'id', type: 'TEXT', nullable: false },
    { name: 'title', type: 'TEXT', nullable: false },
    { name: 'description', type: 'TEXT', nullable: false },
    { name: 'company', type: 'TEXT', nullable: false },
    { name: 'poster', type: 'TEXT', nullable: false },
    { name: 'job_type', type: 'TEXT', nullable: false },
    { name: 'location', type: 'TEXT', nullable: true },
    { name: 'remote', type: 'BOOLEAN', nullable: false, default: false },
    { name: 'salary_min', type: 'TEXT', nullable: true },
    { name: 'salary_max', type: 'TEXT', nullable: true },
    { name: 'salary_currency', type: 'TEXT', nullable: true },
    { name: 'skills', type: 'JSON', nullable: false },
    { name: 'status', type: 'TEXT', nullable: false, default: 'open' },
    { name: 'created_at', type: 'BIGINT', nullable: false },
    { name: 'updated_at', type: 'BIGINT', nullable: false },
    { name: 'expires_at', type: 'BIGINT', nullable: true },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_jobs_poster', columns: ['poster'] },
    { name: 'idx_jobs_status', columns: ['status'] },
    { name: 'idx_jobs_company', columns: ['company'] },
  ],
}

// ============================================================================
// Project Tables
// ============================================================================

export const projectsSchema: TableSchema = {
  name: 'projects',
  columns: [
    { name: 'id', type: 'TEXT', nullable: false },
    { name: 'name', type: 'TEXT', nullable: false },
    { name: 'description', type: 'TEXT', nullable: true },
    { name: 'owner', type: 'TEXT', nullable: false },
    { name: 'visibility', type: 'TEXT', nullable: false, default: 'public' },
    { name: 'repo_id', type: 'TEXT', nullable: true },
    { name: 'status', type: 'TEXT', nullable: false, default: 'active' },
    { name: 'created_at', type: 'BIGINT', nullable: false },
    { name: 'updated_at', type: 'BIGINT', nullable: false },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_projects_owner', columns: ['owner'] },
    { name: 'idx_projects_status', columns: ['status'] },
  ],
}

export const projectMembersSchema: TableSchema = {
  name: 'project_members',
  columns: [
    { name: 'project_id', type: 'TEXT', nullable: false },
    { name: 'member', type: 'TEXT', nullable: false },
    { name: 'role', type: 'TEXT', nullable: false, default: 'member' },
    { name: 'added_at', type: 'BIGINT', nullable: false },
    { name: 'added_by', type: 'TEXT', nullable: false },
  ],
  primaryKey: ['project_id', 'member'],
  indexes: [{ name: 'idx_members_member', columns: ['member'] }],
}

// ============================================================================
// Git Repository Tables (metadata, actual data in DWS Git)
// ============================================================================

export const repositoriesSchema: TableSchema = {
  name: 'repositories',
  columns: [
    { name: 'id', type: 'TEXT', nullable: false },
    { name: 'name', type: 'TEXT', nullable: false },
    { name: 'owner', type: 'TEXT', nullable: false },
    { name: 'description', type: 'TEXT', nullable: true },
    { name: 'is_private', type: 'BOOLEAN', nullable: false, default: false },
    { name: 'default_branch', type: 'TEXT', nullable: false, default: 'main' },
    { name: 'stars', type: 'INTEGER', nullable: false, default: 0 },
    { name: 'forks', type: 'INTEGER', nullable: false, default: 0 },
    { name: 'dws_repo_id', type: 'TEXT', nullable: true },
    { name: 'created_at', type: 'BIGINT', nullable: false },
    { name: 'updated_at', type: 'BIGINT', nullable: false },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_repos_owner', columns: ['owner'] },
    { name: 'idx_repos_name', columns: ['name'], unique: false },
    {
      name: 'idx_repos_owner_name',
      columns: ['owner', 'name'],
      unique: true,
    },
  ],
}

// ============================================================================
// Package Tables (metadata, actual data in DWS Pkg)
// ============================================================================

export const packagesSchema: TableSchema = {
  name: 'packages',
  columns: [
    { name: 'id', type: 'TEXT', nullable: false },
    { name: 'name', type: 'TEXT', nullable: false },
    { name: 'owner', type: 'TEXT', nullable: false },
    { name: 'description', type: 'TEXT', nullable: true },
    { name: 'latest_version', type: 'TEXT', nullable: true },
    { name: 'license', type: 'TEXT', nullable: true },
    { name: 'downloads', type: 'INTEGER', nullable: false, default: 0 },
    { name: 'dws_pkg_name', type: 'TEXT', nullable: true },
    { name: 'created_at', type: 'BIGINT', nullable: false },
    { name: 'updated_at', type: 'BIGINT', nullable: false },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_packages_name', columns: ['name'], unique: true },
    { name: 'idx_packages_owner', columns: ['owner'] },
  ],
}

// ============================================================================
// Container Tables (metadata, actual data in DWS Container Registry)
// ============================================================================

export const containersSchema: TableSchema = {
  name: 'containers',
  columns: [
    { name: 'id', type: 'TEXT', nullable: false },
    { name: 'name', type: 'TEXT', nullable: false },
    { name: 'owner', type: 'TEXT', nullable: false },
    { name: 'latest_tag', type: 'TEXT', nullable: true },
    { name: 'latest_digest', type: 'TEXT', nullable: true },
    { name: 'downloads', type: 'INTEGER', nullable: false, default: 0 },
    { name: 'created_at', type: 'BIGINT', nullable: false },
    { name: 'updated_at', type: 'BIGINT', nullable: false },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_containers_name', columns: ['name'] },
    { name: 'idx_containers_owner', columns: ['owner'] },
  ],
}

// ============================================================================
// Model Tables (metadata, actual data in DWS Storage)
// ============================================================================

export const modelsSchema: TableSchema = {
  name: 'models',
  columns: [
    { name: 'id', type: 'TEXT', nullable: false },
    { name: 'name', type: 'TEXT', nullable: false },
    { name: 'owner', type: 'TEXT', nullable: false },
    { name: 'description', type: 'TEXT', nullable: true },
    { name: 'model_type', type: 'TEXT', nullable: false },
    { name: 'framework', type: 'TEXT', nullable: true },
    { name: 'license', type: 'TEXT', nullable: true },
    { name: 'cid', type: 'TEXT', nullable: true },
    { name: 'size_bytes', type: 'BIGINT', nullable: true },
    { name: 'downloads', type: 'INTEGER', nullable: false, default: 0 },
    { name: 'created_at', type: 'BIGINT', nullable: false },
    { name: 'updated_at', type: 'BIGINT', nullable: false },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_models_name', columns: ['name'] },
    { name: 'idx_models_owner', columns: ['owner'] },
    { name: 'idx_models_type', columns: ['model_type'] },
  ],
}

// ============================================================================
// Dataset Tables
// ============================================================================

export const datasetsSchema: TableSchema = {
  name: 'datasets',
  columns: [
    { name: 'id', type: 'TEXT', nullable: false },
    { name: 'name', type: 'TEXT', nullable: false },
    { name: 'owner', type: 'TEXT', nullable: false },
    { name: 'description', type: 'TEXT', nullable: true },
    { name: 'format', type: 'TEXT', nullable: true },
    { name: 'license', type: 'TEXT', nullable: true },
    { name: 'cid', type: 'TEXT', nullable: true },
    { name: 'size_bytes', type: 'BIGINT', nullable: true },
    { name: 'row_count', type: 'BIGINT', nullable: true },
    { name: 'downloads', type: 'INTEGER', nullable: false, default: 0 },
    { name: 'created_at', type: 'BIGINT', nullable: false },
    { name: 'updated_at', type: 'BIGINT', nullable: false },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_datasets_name', columns: ['name'] },
    { name: 'idx_datasets_owner', columns: ['owner'] },
  ],
}

// ============================================================================
// CI/CD Tables
// ============================================================================

export const ciRunsSchema: TableSchema = {
  name: 'ci_runs',
  columns: [
    { name: 'id', type: 'TEXT', nullable: false },
    { name: 'repo_id', type: 'TEXT', nullable: false },
    { name: 'workflow_name', type: 'TEXT', nullable: false },
    { name: 'trigger', type: 'TEXT', nullable: false },
    { name: 'branch', type: 'TEXT', nullable: true },
    { name: 'commit_sha', type: 'TEXT', nullable: true },
    { name: 'status', type: 'TEXT', nullable: false, default: 'pending' },
    { name: 'started_at', type: 'BIGINT', nullable: false },
    { name: 'completed_at', type: 'BIGINT', nullable: true },
    { name: 'duration_ms', type: 'INTEGER', nullable: true },
    { name: 'logs_cid', type: 'TEXT', nullable: true },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_runs_repo', columns: ['repo_id'] },
    { name: 'idx_runs_status', columns: ['status'] },
  ],
}

// ============================================================================
// Agent Tables
// ============================================================================

export const agentsSchema: TableSchema = {
  name: 'agents',
  columns: [
    { name: 'id', type: 'TEXT', nullable: false },
    { name: 'name', type: 'TEXT', nullable: false },
    { name: 'owner', type: 'TEXT', nullable: false },
    { name: 'agent_type', type: 'TEXT', nullable: false },
    { name: 'description', type: 'TEXT', nullable: true },
    { name: 'character_cid', type: 'TEXT', nullable: true },
    { name: 'state_cid', type: 'TEXT', nullable: true },
    { name: 'active', type: 'BOOLEAN', nullable: false, default: true },
    { name: 'execution_count', type: 'INTEGER', nullable: false, default: 0 },
    { name: 'dws_agent_id', type: 'TEXT', nullable: true },
    { name: 'created_at', type: 'BIGINT', nullable: false },
    { name: 'updated_at', type: 'BIGINT', nullable: false },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_agents_owner', columns: ['owner'] },
    { name: 'idx_agents_type', columns: ['agent_type'] },
    { name: 'idx_agents_active', columns: ['active'] },
  ],
}

// ============================================================================
// Issue Tables
// ============================================================================

export const issuesSchema: TableSchema = {
  name: 'issues',
  columns: [
    { name: 'id', type: 'TEXT', nullable: false },
    { name: 'repo_id', type: 'TEXT', nullable: false },
    { name: 'number', type: 'INTEGER', nullable: false },
    { name: 'title', type: 'TEXT', nullable: false },
    { name: 'body', type: 'TEXT', nullable: true },
    { name: 'author', type: 'TEXT', nullable: false },
    { name: 'status', type: 'TEXT', nullable: false, default: 'open' },
    { name: 'labels', type: 'JSON', nullable: true },
    { name: 'assignees', type: 'JSON', nullable: true },
    { name: 'created_at', type: 'BIGINT', nullable: false },
    { name: 'updated_at', type: 'BIGINT', nullable: false },
    { name: 'closed_at', type: 'BIGINT', nullable: true },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_issues_repo', columns: ['repo_id'] },
    { name: 'idx_issues_author', columns: ['author'] },
    { name: 'idx_issues_status', columns: ['status'] },
    {
      name: 'idx_issues_repo_number',
      columns: ['repo_id', 'number'],
      unique: true,
    },
  ],
}

// ============================================================================
// Pull Request Tables
// ============================================================================

export const pullsSchema: TableSchema = {
  name: 'pulls',
  columns: [
    { name: 'id', type: 'TEXT', nullable: false },
    { name: 'repo_id', type: 'TEXT', nullable: false },
    { name: 'number', type: 'INTEGER', nullable: false },
    { name: 'title', type: 'TEXT', nullable: false },
    { name: 'body', type: 'TEXT', nullable: true },
    { name: 'author', type: 'TEXT', nullable: false },
    { name: 'source_branch', type: 'TEXT', nullable: false },
    { name: 'target_branch', type: 'TEXT', nullable: false },
    { name: 'status', type: 'TEXT', nullable: false, default: 'open' },
    { name: 'is_draft', type: 'BOOLEAN', nullable: false, default: false },
    { name: 'labels', type: 'JSON', nullable: true },
    { name: 'reviewers', type: 'JSON', nullable: true },
    { name: 'created_at', type: 'BIGINT', nullable: false },
    { name: 'updated_at', type: 'BIGINT', nullable: false },
    { name: 'merged_at', type: 'BIGINT', nullable: true },
    { name: 'closed_at', type: 'BIGINT', nullable: true },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_pulls_repo', columns: ['repo_id'] },
    { name: 'idx_pulls_author', columns: ['author'] },
    { name: 'idx_pulls_status', columns: ['status'] },
    {
      name: 'idx_pulls_repo_number',
      columns: ['repo_id', 'number'],
      unique: true,
    },
  ],
}

// ============================================================================
// Export all schemas
// ============================================================================

export const ALL_SCHEMAS: TableSchema[] = [
  bountiesSchema,
  bountySubmissionsSchema,
  jobsSchema,
  projectsSchema,
  projectMembersSchema,
  repositoriesSchema,
  packagesSchema,
  containersSchema,
  modelsSchema,
  datasetsSchema,
  ciRunsSchema,
  agentsSchema,
  issuesSchema,
  pullsSchema,
]
