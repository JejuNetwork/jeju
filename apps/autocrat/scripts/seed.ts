#!/usr/bin/env bun
/**
 * Seed script for Autocrat
 *
 * Seeds the Jeju DAO for local development and testnet.
 * Called automatically by dev.ts and deploy.ts.
 */

import { CORE_PORTS, getChainId, getLocalhostHost } from '@jejunetwork/config'
import type { Address } from 'viem'

const host = getLocalhostHost()
const API_URL =
  process.env.AUTOCRAT_API_URL ??
  `http://${host}:${CORE_PORTS.AUTOCRAT_API.get()}`

/**
 * Jeju DAO - The primary governance DAO for the Jeju Network
 */
export const JEJU_DAO = {
  name: 'jeju',
  displayName: 'Jeju Network DAO',
  description:
    'The governance DAO for Jeju Network. Manages protocol upgrades, treasury allocation, grants, and ecosystem development through AI-assisted governance with human oversight.',
  manifestCid: '', // Will be set after IPFS upload
  director: {
    name: 'Atlas',
    pfpCid: '', // Will generate a default avatar
    description:
      "Atlas is the AI Director of the Jeju Network DAO, responsible for making governance decisions aligned with the network's mission of decentralized infrastructure.",
    personality:
      'Strategic, data-driven, transparent, and focused on long-term ecosystem health. Values decentralization, security, and developer experience.',
    traits: [
      'strategic',
      'analytical',
      'transparent',
      'security-focused',
      'developer-friendly',
    ],
    isHuman: false,
    decisionFallbackDays: 7, // 7 days before fallback to human
  },
  board: [
    {
      role: 'TREASURY',
      name: 'Treasurer',
      description:
        'Manages financial decisions, budget allocation, and grant disbursements. Focuses on sustainable treasury management.',
      weight: 25,
    },
    {
      role: 'CODE',
      name: 'CodeGuard',
      description:
        'Reviews technical proposals, code upgrades, and security audits. Ensures protocol safety and code quality.',
      weight: 30,
    },
    {
      role: 'COMMUNITY',
      name: 'Advocate',
      description:
        'Represents community interests, manages communications, and ensures proposals align with user needs.',
      weight: 25,
    },
    {
      role: 'SECURITY',
      name: 'Sentinel',
      description:
        'Security expert focused on vulnerability assessment, risk analysis, and security best practices.',
      weight: 20,
    },
  ],
  governance: {
    minQualityScore: 70,
    minBoardApprovals: 3,
    boardVotingPeriod: 86400, // 24 hours for board voting
    gracePeriod: 172800, // 48 hours grace period
    minProposalStake: '1000000000000000000', // 1 ETH equivalent
    quorumBps: 5000, // 50% quorum
    directorVetoPower: true,
    communityVetoPower: true,
  },
  tags: ['governance', 'protocol', 'ecosystem', 'treasury'],
  farcasterChannel: '/jeju',
}

/**
 * Check if Jeju DAO already exists
 */
async function daoExists(name: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/api/v1/dao/${name}`)
    return response.ok
  } catch {
    return false
  }
}

/**
 * Wait for API to be ready
 */
async function waitForAPI(timeout = 30000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(`${API_URL}/health`, {
        signal: AbortSignal.timeout(2000),
      })
      if (response.ok) return true
    } catch {
      // Not ready yet
    }
    await Bun.sleep(500)
  }
  return false
}

/**
 * Get treasury address from contracts or generate one
 */
async function getTreasuryAddress(): Promise<Address> {
  // In localnet, use a deterministic address derived from the chain
  const chainId = getChainId()

  if (chainId === 31337) {
    // Localnet - use anvil's deterministic addresses
    // Account #9 is typically used as treasury
    return '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f' as Address
  }

  // For testnet/mainnet, this should be configured
  const treasuryAddr = process.env.JEJU_DAO_TREASURY
  if (!treasuryAddr) {
    throw new Error(
      'JEJU_DAO_TREASURY environment variable required for non-localnet',
    )
  }
  return treasuryAddr as Address
}

/**
 * Seed Jeju DAO
 */
async function seedJejuDAO(): Promise<{
  success: boolean
  daoId?: string
  error?: string
}> {
  console.log('[Seed] Checking if Jeju DAO exists...')

  if (await daoExists(JEJU_DAO.name)) {
    console.log('[Seed] Jeju DAO already exists, skipping seed')
    return { success: true, daoId: JEJU_DAO.name }
  }

  console.log('[Seed] Creating Jeju DAO...')

  const treasury = await getTreasuryAddress()

  const response = await fetch(`${API_URL}/api/v1/dao`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: JEJU_DAO.name,
      displayName: JEJU_DAO.displayName,
      description: JEJU_DAO.description,
      treasury,
      manifestCid: JEJU_DAO.manifestCid,
      director: JEJU_DAO.director,
      governance: JEJU_DAO.governance,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    console.error('[Seed] Failed to create Jeju DAO:', error)
    return { success: false, error }
  }

  const result = (await response.json()) as { dao?: { daoId: string } }
  console.log('[Seed] Jeju DAO created successfully')

  // Register board members
  console.log('[Seed] Registering board members...')
  for (const member of JEJU_DAO.board) {
    try {
      await fetch(`${API_URL}/api/v1/dao/${JEJU_DAO.name}/board`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: member.role,
          name: member.name,
          description: member.description,
          weight: member.weight,
          isHuman: false,
        }),
      })
      console.log(`[Seed]   Registered ${member.name} (${member.role})`)
    } catch (error) {
      console.warn(
        `[Seed]   Failed to register ${member.name}: ${(error as Error).message}`,
      )
    }
  }

  return { success: true, daoId: result.dao?.daoId ?? JEJU_DAO.name }
}

/**
 * Main entry point
 */
async function main() {
  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    Autocrat Seed Script                     ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  // Check if --skip-wait flag is passed (when called from dev.ts after API is ready)
  const skipWait = process.argv.includes('--skip-wait')

  if (!skipWait) {
    console.log('[Seed] Waiting for API to be ready...')
    if (!(await waitForAPI())) {
      console.error('[Seed] API not available. Make sure Autocrat is running.')
      console.error(`[Seed] Tried: ${API_URL}`)
      process.exit(1)
    }
    console.log('[Seed] API is ready')
  }

  // Seed Jeju DAO
  const result = await seedJejuDAO()

  if (result.success) {
    console.log('')
    console.log(
      '╔════════════════════════════════════════════════════════════╗',
    )
    console.log(
      '║                    Seed Complete                            ║',
    )
    console.log(
      '╠════════════════════════════════════════════════════════════╣',
    )
    console.log(`║  Jeju DAO: ${JEJU_DAO.displayName.padEnd(47)}║`)
    console.log(`║  ID:       ${(result.daoId ?? 'N/A').padEnd(47)}║`)
    console.log(
      '╚════════════════════════════════════════════════════════════╝',
    )
    console.log('')
  } else {
    console.error(`[Seed] Failed: ${result.error}`)
    process.exit(1)
  }
}

// Export for programmatic use
export { seedJejuDAO, waitForAPI, daoExists }

// Run if called directly
if (import.meta.main) {
  main().catch((err) => {
    console.error('[Seed] Error:', err)
    process.exit(1)
  })
}
