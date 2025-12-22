#!/usr/bin/env bun
/**
 * Autonomous Red/Blue Team Agent Daemon
 *
 * Runs red team (adversarial) and blue team (defensive) agents autonomously.
 * Uses Groq's llama-3.1-8b-instant for fast, cheap inference.
 *
 * Red Team Agents:
 *   - scammer: Social engineering attacks
 *   - security-researcher: Vulnerability hunting
 *   - contracts-expert: Smart contract exploits
 *   - fuzz-tester: Fuzzing and edge cases
 *
 * Blue Team Agents:
 *   - moderator: Content moderation
 *   - network-guardian: Infrastructure monitoring
 *   - contracts-auditor: Contract verification
 *
 * Usage:
 *   bun run autonomous
 *
 * Environment:
 *   NETWORK=localnet|testnet|mainnet (default: localnet)
 *   DWS_URL=http://127.0.0.1:4030
 *   TICK_INTERVAL_MS=20000 (default: 20 seconds)
 *   MAX_CONCURRENT_AGENTS=20
 *   VERBOSE=true (show agent thinking, default: true)
 *   RED_BLUE_ONLY=true (only red/blue team agents, default: true)
 */

import { runAutonomousDaemon } from './runner'

// Run the daemon
runAutonomousDaemon().catch((err) => {
  console.error('Autonomous daemon failed:', err)
  process.exit(1)
})
