#!/usr/bin/env bun
/**
 * Autonomous Agent Daemon Entry Point
 *
 * Runs autonomous agents on configurable tick intervals.
 * Each agent uses the LLM to decide what actions to take.
 *
 * Usage:
 *   bun run autonomous
 *
 * Environment:
 *   NETWORK=localnet|testnet|mainnet
 *   DWS_URL=http://127.0.0.1:4030
 *   TICK_INTERVAL_MS=60000  (default: 1 minute)
 *   MAX_CONCURRENT_AGENTS=10
 *   ENABLE_BUILTIN_CHARACTERS=true
 */

import { runAutonomousDaemon } from './runner'

// Run the daemon
runAutonomousDaemon().catch((err) => {
  console.error('Autonomous daemon failed:', err)
  process.exit(1)
})
