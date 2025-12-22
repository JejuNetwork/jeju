/**
 * Leaderboard Pipelines
 *
 * Data ingestion and processing pipelines for GitHub contribution tracking.
 * Can be run via CLI or scheduled through cron/CI.
 *
 * Commands:
 *   bun run leaderboard:ingest   - Fetch data from GitHub
 *   bun run leaderboard:process  - Calculate contribution scores
 *   bun run leaderboard:export   - Export stats to DWS storage
 *   bun run leaderboard:summarize - Generate AI summaries
 */

export { type ExportOptions, runExport } from './export.js'
export { type IngestOptions, runIngest } from './ingest.js'
export { type ProcessOptions, runProcess } from './process.js'
export { runSummarize, type SummarizeOptions } from './summarize.js'
