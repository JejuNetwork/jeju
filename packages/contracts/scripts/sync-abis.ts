#!/usr/bin/env bun
/**
 * Sync ABIs from Forge Out Directory
 *
 * Extracts ABIs from forge's compiled artifacts (out/) and writes them to
 * the abis/ directory for distribution and backwards compatibility.
 *
 * Usage:
 *   bun run scripts/sync-abis.ts
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

const CONTRACTS_ROOT = import.meta.dir.replace('/scripts', '')
const OUT_DIR = join(CONTRACTS_ROOT, 'out')
const ABIS_DIR = join(CONTRACTS_ROOT, 'abis')

// Contracts to extract ABIs from (matches wagmi.config.ts)
const CONTRACTS_TO_EXTRACT = [
  // Core contracts
  'ERC20',
  'ERC20Factory',
  'Bazaar',

  // Identity & Moderation
  'IdentityRegistry',
  'ReputationRegistry',
  'ValidationRegistry',
  'BanManager',
  'ModerationMarketplace',

  // OIF (Open Intents Framework)
  'InputSettler',
  'OutputSettler',
  'SolverRegistry',
  'SimpleOracle',
  'HyperlaneOracle',
  'SuperchainOracle',
  'FederatedIdentity',
  'FederatedLiquidity',
  'FederatedSolver',

  // Native Token
  'NetworkToken',
  'JejuToken',

  // Service Contracts
  'CreditManager',
  'MultiTokenPaymaster',

  // Paymaster System
  'TokenRegistry',
  'PaymasterFactory',
  'LiquidityVault',
  'AppTokenPreference',
  'SponsoredPaymaster',

  // Launchpad
  'TokenLaunchpad',
  'BondingCurve',
  'ICOPresale',
  'LPLocker',
  'LaunchpadToken',

  // Chainlink
  'AutomationRegistry',
  'OracleRouter',
  'ChainlinkGovernance',
  'VRFCoordinatorV2_5',

  // Registry contracts
  'NetworkRegistry',
  'RegistrationHelper',
  'UserBlockRegistry',

  // Oracle contracts
  'MockAggregatorV3',
  'SimplePoolOracle',

  // OTC
  'OTC',
]

const ForgeArtifactSchema = z.object({
  abi: z.array(z.record(z.string(), z.unknown())),
  bytecode: z.object({ object: z.string() }).optional(),
  deployedBytecode: z.object({ object: z.string() }).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
type ForgeArtifact = z.infer<typeof ForgeArtifactSchema>

interface AbiOutput {
  abi: readonly Record<string, unknown>[]
}

async function parseArtifact(filePath: string): Promise<ForgeArtifact> {
  const file = Bun.file(filePath)
  const json: unknown = await file.json()
  return ForgeArtifactSchema.parse(json)
}

async function findArtifact(
  contractName: string,
): Promise<ForgeArtifact | null> {
  // Forge outputs to out/{ContractName}.sol/{ContractName}.json
  const solDir = join(OUT_DIR, `${contractName}.sol`)

  const dirExists = await Bun.file(solDir)
    .exists()
    .catch(() => false)
  if (!dirExists) {
    // Try to find in subdirectories
    const outDirs = await readdir(OUT_DIR).catch(() => [] as string[])
    for (const dir of outDirs) {
      if (dir.endsWith('.sol')) {
        const artifactPath = join(OUT_DIR, dir, `${contractName}.json`)
        const file = Bun.file(artifactPath)
        if (await file.exists()) {
          return parseArtifact(artifactPath)
        }
      }
    }
    return null
  }

  const artifactPath = join(solDir, `${contractName}.json`)
  const file = Bun.file(artifactPath)
  if (await file.exists()) {
    return parseArtifact(artifactPath)
  }

  return null
}

async function syncAbis(): Promise<void> {
  console.log('Syncing ABIs from forge out/ to abis/')

  let synced = 0
  let skipped = 0
  const failed = 0

  for (const contractName of CONTRACTS_TO_EXTRACT) {
    const artifact = await findArtifact(contractName)

    if (!artifact) {
      console.log(`  [skip] ${contractName} - artifact not found`)
      skipped++
      continue
    }

    if (!artifact.abi || artifact.abi.length === 0) {
      console.log(`  [skip] ${contractName} - no ABI in artifact`)
      skipped++
      continue
    }

    const output: AbiOutput = { abi: artifact.abi }
    const outputPath = join(ABIS_DIR, `${contractName}.json`)

    await Bun.write(outputPath, JSON.stringify(output, null, 2))
    console.log(`  [sync] ${contractName}`)
    synced++
  }

  console.log(`\nDone: ${synced} synced, ${skipped} skipped, ${failed} failed`)
}

// Run if executed directly
syncAbis().catch((err) => {
  console.error('Failed to sync ABIs:', err)
  process.exit(1)
})
