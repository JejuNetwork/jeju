# Jeju Leaderboard

Contributor tracking and analytics for the Jeju Network. Tracks GitHub contributions to `jejunetwork/jeju` with AI-powered summaries.

## Setup

```bash
cd apps/leaderboard
bun install
```

Create `.env`:

```bash
GITHUB_TOKEN=ghp_...
OPENROUTER_API_KEY=sk-or-...
```

Initialize database:

```bash
# Option A: Empty database
bun run db:migrate

# Option B: Sync from production
bun run data:sync
```

## Run

```bash
# Run pipelines
bun run pipeline ingest
bun run pipeline process
bun run pipeline export
bun run pipeline summarize -t repository

# Development server
bun run dev

# Production build
bun run build
bun run start
```

Site accessible at http://localhost:3000

## Test

```bash
# Unit tests
bun test

# Test data ingestion
bun run pipeline ingest --days 1 -v

# Test build
bun run build
```

## Features

- **Contribution Tracking**: PRs, issues, reviews, and commits from `jejunetwork/jeju`
- **Scoring Engine**: RuneScape-inspired XP system tracking expertise areas
- **AI Summaries**: Daily/weekly/monthly contributor and project summaries via OpenRouter
- **Wallet Linking**: Connect GitHub profiles to Jeju Network wallets
