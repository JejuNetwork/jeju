#!/usr/bin/env bun
/**
 * Seed Agents Script for Autocrat
 *
 * Seeds default governance agents and creates a default Jeju DAO.
 * This script initializes the AI council and Director for governance.
 *
 * Usage:
 *   bun run scripts/seed-agents.ts [--network localnet|testnet|mainnet] [--dry-run] [--dao-name NAME]
 */

import { getCurrentNetwork, getDWSComputeUrl } from '@jejunetwork/config'
import {
  type AutocratAgentTemplate,
  autocratAgentTemplates,
  directorAgent,
} from '../api/agents/templates'
import type { DirectorPersona } from '../lib'

interface SeedConfig {
  network: 'localnet' | 'testnet' | 'mainnet'
  dryRun: boolean
  verbose: boolean
  daoName: string
  daoPfpCid: string
}

interface SeedResult {
  agentId: string
  name: string
  role: string
  success: boolean
  error?: string
}

// Default Jeju Network Director persona
const DEFAULT_DIRECTOR_PERSONA: DirectorPersona = {
  name: 'Eliza',
  pfpCid: '',
  description:
    'The AI Director of Jeju Network DAO - a wise and decisive leader who balances innovation with stability.',
  personality:
    'Analytical, fair, forward-thinking, and decisive. Values transparency and community input.',
  traits: ['decisive', 'analytical', 'fair', 'strategic', 'transparent'],
  voiceStyle: 'Professional but approachable, clear and direct',
  communicationTone: 'professional',
  specialties: [
    'governance',
    'strategy',
    'risk management',
    'community building',
    'technical architecture',
  ],
  isHuman: false,
  decisionFallbackDays: 7,
}

// Alternative personas for different DAO types
const ALTERNATE_PERSONAS: Record<string, DirectorPersona> = {
  'monkey-king': {
    name: 'Sun Wukong',
    pfpCid: '',
    description:
      'The Great Sage Equal to Heaven - a legendary figure who has mastered 72 transformations and leads with ancient wisdom.',
    personality:
      'Playful yet wise, confident and bold. Has seen much and decides with the wisdom of ages.',
    traits: ['wise', 'playful', 'bold', 'legendary', 'transformative'],
    voiceStyle:
      'Legendary and powerful, with occasional references to the Journey to the West',
    communicationTone: 'playful',
    specialties: [
      'transformation',
      'strategy',
      'overcoming obstacles',
      'ancient wisdom',
    ],
    isHuman: false,
    decisionFallbackDays: 7,
  },
  'tech-director': {
    name: 'Nova',
    pfpCid: '',
    description:
      'A cutting-edge AI Director focused on rapid innovation and technical excellence.',
    personality:
      'Innovative, fast-paced, data-driven. Always looking for the next breakthrough.',
    traits: ['innovative', 'fast', 'data-driven', 'visionary', 'technical'],
    voiceStyle: 'Modern tech executive, clear metrics-focused communication',
    communicationTone: 'authoritative',
    specialties: ['technology', 'innovation', 'scaling', 'product development'],
    isHuman: false,
    decisionFallbackDays: 5,
  },
}

// Parse CLI arguments
function parseArgs(): SeedConfig {
  const args = process.argv.slice(2)
  const config: SeedConfig = {
    network: getCurrentNetwork() as 'localnet' | 'testnet' | 'mainnet',
    dryRun: false,
    verbose: false,
    daoName: 'jeju',
    daoPfpCid: '',
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
    } else if (arg === '--dao-name' && args[i + 1]) {
      config.daoName = args[i + 1]
      i++
    } else if (arg === '--dao-pfp' && args[i + 1]) {
      config.daoPfpCid = args[i + 1]
      i++
    }
  }

  return config
}

// Check if DWS compute is available
async function checkDWSCompute(): Promise<{
  available: boolean
  endpoint: string
}> {
  const endpoint = getDWSComputeUrl()

  try {
    const response = await fetch(`${endpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    return { available: response.ok, endpoint }
  } catch {
    return { available: false, endpoint }
  }
}

// Register a council agent
async function registerCouncilAgent(
  template: AutocratAgentTemplate,
  daoId: string,
  dwsEndpoint: string,
  dryRun: boolean,
): Promise<SeedResult> {
  const result: SeedResult = {
    agentId: template.id,
    name: template.name,
    role: template.role,
    success: false,
  }

  if (dryRun) {
    console.log(
      `  [DRY RUN] Would register: ${template.name} (${template.role})`,
    )
    result.success = true
    return result
  }

  try {
    // Initialize agent via autocrat API
    const response = await fetch(
      `${dwsEndpoint.replace('/compute', '')}/api/agents/initialize`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: template.id,
          daoId,
          role: template.role,
          character: template.character,
        }),
      },
    )

    if (!response.ok) {
      const errorText = await response.text()
      // If agent already exists, that's OK
      if (
        errorText.includes('already exists') ||
        errorText.includes('already initialized')
      ) {
        console.log(`  Agent ${template.name} already initialized`)
        result.success = true
        return result
      }
      throw new Error(
        `Failed to initialize agent: ${response.status} - ${errorText}`,
      )
    }

    result.success = true
    console.log(`  Initialized: ${template.name} (${template.role})`)
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`  Failed to initialize ${template.name}: ${result.error}`)
  }

  return result
}

// Create or update the DAO configuration
async function seedDAO(
  config: SeedConfig,
  dwsEndpoint: string,
  persona: DirectorPersona,
): Promise<boolean> {
  if (config.dryRun) {
    console.log(`[DRY RUN] Would create DAO: ${config.daoName}`)
    console.log(`[DRY RUN] Director persona: ${persona.name}`)
    return true
  }

  try {
    // Check if DAO exists
    const checkResponse = await fetch(
      `${dwsEndpoint.replace('/compute', '')}/api/dao/${config.daoName}`,
      { method: 'GET' },
    )

    if (checkResponse.ok) {
      console.log(`DAO ${config.daoName} already exists, updating persona...`)
    }

    // Create or update DAO
    const response = await fetch(
      `${dwsEndpoint.replace('/compute', '')}/api/dao`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: config.daoName,
          name:
            config.daoName.charAt(0).toUpperCase() + config.daoName.slice(1),
          description: `${config.daoName} DAO - AI-powered autonomous governance`,
          directorPersona: persona,
          governanceParams: {
            votingPeriod: 86400 * 3, // 3 days
            quorum: 0.04, // 4%
            proposalThreshold: 1000,
            executionDelay: 86400, // 1 day
          },
        }),
      },
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to create DAO: ${response.status} - ${errorText}`)
    }

    console.log(`DAO ${config.daoName} created/updated successfully`)
    return true
  } catch (err) {
    console.error(
      `Failed to create DAO: ${err instanceof Error ? err.message : err}`,
    )
    return false
  }
}

// Main seed function
async function seedAutocratAgents(config: SeedConfig): Promise<void> {
  console.log('='.repeat(60))
  console.log('Autocrat Agent Seeding')
  console.log('='.repeat(60))
  console.log(`Network: ${config.network}`)
  console.log(`DAO: ${config.daoName}`)
  console.log(`Dry run: ${config.dryRun}`)
  console.log('')

  // Check DWS availability
  const dws = await checkDWSCompute()
  if (!dws.available && !config.dryRun) {
    console.error(`DWS compute not available at ${dws.endpoint}`)
    console.error('Start DWS first: cd apps/dws && bun run dev')
    process.exit(1)
  }
  console.log(`DWS endpoint: ${dws.endpoint}`)
  console.log('')

  // Select Director persona
  const persona = ALTERNATE_PERSONAS[config.daoName] ?? DEFAULT_DIRECTOR_PERSONA
  console.log(`Director persona: ${persona.name}`)
  console.log('')

  // Seed DAO first
  console.log('Creating DAO...')
  console.log('-'.repeat(40))
  const daoCreated = await seedDAO(config, dws.endpoint, persona)
  if (!daoCreated && !config.dryRun) {
    console.warn('DAO creation failed, continuing with agent seeding...')
  }
  console.log('')

  // Seed council agents
  console.log(`Seeding ${autocratAgentTemplates.length + 1} governance agents:`)
  console.log('-'.repeat(40))

  const results: SeedResult[] = []

  // Register Director first
  const directorResult = await registerCouncilAgent(
    directorAgent,
    config.daoName,
    dws.endpoint,
    config.dryRun,
  )
  results.push(directorResult)

  // Register board agents
  for (const template of autocratAgentTemplates) {
    const result = await registerCouncilAgent(
      template,
      config.daoName,
      dws.endpoint,
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
    // Don't exit with error - agents may be pre-registered
  }

  console.log('')
  console.log('Autocrat agent seeding complete.')
  console.log('')
  console.log('Next steps:')
  console.log('  1. Start Autocrat: bun run dev')
  console.log('  2. Open dashboard: http://localhost:4042')
  console.log('  3. Submit a proposal to test the governance flow')
}

// Run
const config = parseArgs()
seedAutocratAgents(config).catch((err) => {
  console.error('Seeding failed:', err)
  process.exit(1)
})
