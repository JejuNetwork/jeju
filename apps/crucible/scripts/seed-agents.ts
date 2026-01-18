#!/usr/bin/env bun
/**
 * Seed Agents Script for Crucible
 *
 * Seeds default agents for local development, testnet, or mainnet.
 * This script registers characters and initializes autonomous agents.
 *
 * Usage:
 *   bun run scripts/seed-agents.ts [--network localnet|testnet|mainnet] [--dry-run]
 */

import {
  getCrucibleUrl,
  getCurrentNetwork,
  getDWSUrl,
} from '@jejunetwork/config'
import { parseEther } from 'viem'
import {
  BLUE_TEAM_CHARACTERS,
  characters,
  RED_TEAM_CHARACTERS,
} from '../api/characters'
import type { AgentCharacter } from '../lib/types'

interface SeedConfig {
  network: 'localnet' | 'testnet' | 'mainnet'
  dryRun: boolean
  verbose: boolean
}

interface SeedResult {
  agentId: string
  name: string
  characterCid: string
  success: boolean
  error?: string
}

// Parse CLI arguments
function parseArgs(): SeedConfig {
  const args = process.argv.slice(2)
  const config: SeedConfig = {
    network: getCurrentNetwork() as 'localnet' | 'testnet' | 'mainnet',
    dryRun: false,
    verbose: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--network' && args[i + 1]) {
      const net = args[i + 1]
      if (net === 'localnet' || net === 'testnet' || net === 'mainnet') {
        config.network = net
      }
      i++
    } else if (arg === '--dry-run') {
      config.dryRun = true
    } else if (arg === '--verbose' || arg === '-v') {
      config.verbose = true
    }
  }

  return config
}

// Get agents to seed based on network
function getAgentsToSeed(network: string): AgentCharacter[] {
  const agents: AgentCharacter[] = []

  // Always seed core agents
  const coreCharacterIds = [
    'project-manager',
    'community-manager',
    'devrel',
    'liaison',
    'social-media-manager',
  ]

  for (const id of coreCharacterIds) {
    const char = characters[id]
    if (char) agents.push(char)
  }

  // Seed blue team for all networks
  for (const id of BLUE_TEAM_CHARACTERS) {
    const char = characters[id]
    if (char) agents.push(char)
  }

  // Only seed red team on localnet and testnet (for adversarial testing)
  if (network === 'localnet' || network === 'testnet') {
    for (const id of RED_TEAM_CHARACTERS) {
      const char = characters[id]
      if (char) agents.push(char)
    }
  }

  return agents
}

// Check if DWS is available
async function checkDWS(
  network: 'localnet' | 'testnet' | 'mainnet',
): Promise<{ available: boolean; endpoint: string }> {
  // Use config-based URL (respects env vars like DWS_URL)
  const endpoint = getDWSUrl(network)

  try {
    const response = await fetch(`${endpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    return { available: response.ok, endpoint }
  } catch {
    return { available: false, endpoint }
  }
}

// Register an agent character
async function registerAgent(
  char: AgentCharacter,
  dwsEndpoint: string,
  crucibleEndpoint: string,
  dryRun: boolean,
): Promise<SeedResult> {
  const result: SeedResult = {
    agentId: char.id,
    name: char.name,
    characterCid: '',
    success: false,
  }

  if (dryRun) {
    console.log(`[DRY RUN] Would register agent: ${char.name} (${char.id})`)
    result.success = true
    result.characterCid = 'dry-run-cid'
    return result
  }

  try {
    // Store character on DWS storage
    const formData = new FormData()
    const charBlob = new Blob([JSON.stringify(char)], {
      type: 'application/json',
    })
    formData.append('file', charBlob, `character-${char.id}.json`)
    formData.append('tier', 'popular')

    const storeResponse = await fetch(`${dwsEndpoint}/storage/upload`, {
      method: 'POST',
      body: formData,
    })

    if (!storeResponse.ok) {
      const errorText = await storeResponse.text()
      throw new Error(
        `Failed to store character: ${storeResponse.status} - ${errorText}`,
      )
    }

    const storeResult = (await storeResponse.json()) as { cid: string }
    result.characterCid = storeResult.cid

    // Register with Crucible API (uses config-based URL)
    const registerResponse = await fetch(`${crucibleEndpoint}/api/v1/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        characterCid: result.characterCid,
        initialFunding: parseEther('0.01').toString(),
        botType: 'ai_agent',
      }),
    })

    if (!registerResponse.ok) {
      const errorText = await registerResponse.text()
      // If agent already exists, that's OK
      if (
        errorText.includes('already exists') ||
        errorText.includes('already registered')
      ) {
        console.log(`  Agent ${char.name} already registered`)
        result.success = true
        return result
      }
      throw new Error(
        `Failed to register agent: ${registerResponse.status} - ${errorText}`,
      )
    }

    result.success = true
    console.log(
      `  Registered: ${char.name} (CID: ${result.characterCid.slice(0, 12)}...)`,
    )
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`  Failed to register ${char.name}: ${result.error}`)
  }

  return result
}

// Main seed function
async function seedAgents(config: SeedConfig): Promise<void> {
  console.log('='.repeat(60))
  console.log('Crucible Agent Seeding')
  console.log('='.repeat(60))
  console.log(`Network: ${config.network}`)
  console.log(`Dry run: ${config.dryRun}`)
  console.log('')

  // Check DWS availability
  const dws = await checkDWS(config.network)
  if (!dws.available && !config.dryRun) {
    console.error(`DWS not available at ${dws.endpoint}`)
    console.error('Start DWS first: cd apps/dws && bun run dev')
    process.exit(1)
  }

  // Get Crucible API URL (respects CRUCIBLE_URL env var)
  const crucibleEndpoint = getCrucibleUrl(config.network)

  console.log(`DWS endpoint: ${dws.endpoint}`)
  console.log(`Crucible API: ${crucibleEndpoint}`)
  console.log('')

  // Get agents to seed
  const agents = getAgentsToSeed(config.network)
  console.log(`Seeding ${agents.length} agents:`)
  console.log('-'.repeat(40))

  const results: SeedResult[] = []
  for (const agent of agents) {
    const result = await registerAgent(
      agent,
      dws.endpoint,
      crucibleEndpoint,
      config.dryRun,
    )
    results.push(result)
  }

  // Summary
  console.log('')
  console.log('='.repeat(60))
  console.log('Summary')
  console.log('='.repeat(60))
  const successful = results.filter((r) => r.success).length
  const failed = results.filter((r) => !r.success).length
  console.log(`Successful: ${successful}`)
  console.log(`Failed: ${failed}`)

  if (failed > 0) {
    console.log('')
    console.log('Failed agents:')
    for (const r of results.filter((r) => !r.success)) {
      console.log(`  - ${r.name}: ${r.error}`)
    }
    process.exit(1)
  }

  console.log('')
  console.log('Agent seeding complete.')
}

// Run
const config = parseArgs()
seedAgents(config).catch((err) => {
  console.error('Seeding failed:', err)
  process.exit(1)
})
