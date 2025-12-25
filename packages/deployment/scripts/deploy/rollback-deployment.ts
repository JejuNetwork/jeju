#!/usr/bin/env bun
/**
 * @internal Used by CLI: `jeju deploy rollback`
 *
 * Deployment Rollback Script
 *
 * Rolls back contract deployments to a previous version by:
 * 1. Loading previous deployment state from backup
 * 2. Updating environment variables
 * 3. Verifying rollback state
 *
 * Usage:
 *   jeju deploy rollback --network=testnet --backup=backup-1234567890
 *   jeju deploy rollback --network=mainnet --backup=latest
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  type DeploymentState,
  DeploymentStateSchema,
  expectJson,
} from '../../schemas'
import { logger } from '../shared/logger'

const ROOT = join(import.meta.dir, '..')
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments')
const BACKUPS_DIR = join(ROOT, 'packages/contracts/deployments/backups')

function parseArgs(): { network: string; backup: string } {
  const networkArg = process.argv.find((arg) => arg.startsWith('--network='))
  const backupArg = process.argv.find((arg) => arg.startsWith('--backup='))

  const network = networkArg ? networkArg.split('=')[1] : 'testnet'
  const backup = backupArg ? backupArg.split('=')[1] : 'latest'

  if (!['testnet', 'mainnet', 'localnet'].includes(network)) {
    throw new Error(
      `Invalid network: ${network}. Must be testnet, mainnet, or localnet`,
    )
  }

  return { network, backup }
}

function listBackups(network: string): string[] {
  const networkBackupsDir = join(BACKUPS_DIR, network)
  if (!existsSync(networkBackupsDir)) {
    return []
  }

  // List backup directories, sorted by timestamp (newest first)
  const backups: string[] = []
  try {
    const entries = readdirSync(networkBackupsDir)
    for (const entry of entries) {
      const backupPath = join(networkBackupsDir, entry)
      try {
        if (statSync(backupPath).isDirectory()) {
          backups.push(entry)
        }
      } catch (err) {
        // Skip entries that can't be stat'd
        if (process.env.DEBUG) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          console.warn(`Failed to stat backup entry ${entry}: ${errorMessage}`)
        }
      }
    }
  } catch (err) {
    // Directory doesn't exist or can't be read
    const errorMessage = err instanceof Error ? err.message : String(err)
    if (process.env.DEBUG) {
      console.warn(
        `Failed to read backups directory ${networkBackupsDir}: ${errorMessage}`,
      )
    }
  }

  return backups.sort().reverse()
}

function findBackup(network: string, backupName: string): string {
  const networkBackupsDir = join(BACKUPS_DIR, network)

  if (backupName === 'latest') {
    const backups = listBackups(network)
    if (backups.length === 0) {
      throw new Error(`No backups found for network ${network}`)
    }
    return join(networkBackupsDir, backups[0])
  }

  const backupPath = join(networkBackupsDir, backupName)
  if (!existsSync(backupPath)) {
    const available = listBackups(network)
    throw new Error(
      `Backup ${backupName} not found. Available backups: ${available.join(', ') || 'none'}`,
    )
  }

  return backupPath
}

function loadDeploymentState(backupPath: string): DeploymentState {
  const deploymentFile = join(backupPath, 'deployment.json')
  if (!existsSync(deploymentFile)) {
    throw new Error(`Deployment file not found in backup: ${deploymentFile}`)
  }

  const content = readFileSync(deploymentFile, 'utf-8')
  return expectJson(content, DeploymentStateSchema, `backup deployment state`)
}

function updateEnvFile(_network: string, state: DeploymentState): void {
  const envPath = join(ROOT, '.env')
  const envBackupPath = join(ROOT, `.env.backup.${Date.now()}`)

  // Backup current .env if it exists
  if (existsSync(envPath)) {
    copyFileSync(envPath, envBackupPath)
    logger.debug(`Backed up .env to ${envBackupPath}`)
  }

  // Read existing .env or create new
  let envContent = ''
  if (existsSync(envPath)) {
    envContent = readFileSync(envPath, 'utf-8')
  }

  // Update contract addresses
  const updates: Record<string, string> = {
    SEQUENCER_REGISTRY_ADDRESS: state.sequencerRegistry ?? '',
    THRESHOLD_BATCH_SUBMITTER_ADDRESS: state.thresholdBatchSubmitter ?? '',
    DISPUTE_GAME_FACTORY_ADDRESS: state.disputeGameFactory ?? '',
    PROVER_ADDRESS: state.prover ?? '',
    PROXY_REGISTRY_ADDRESS: state.proxyRegistry ?? '',
    PROXY_PAYMENT_ADDRESS: state.proxyPayment ?? '',
  }

  // Update or add each address
  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, 'm')
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${value}`)
    } else {
      envContent += `\n${key}=${value}`
    }
  }

  writeFileSync(envPath, envContent)
  logger.success(`Updated .env file with rollback addresses`)
}

async function verifyRollback(
  network: string,
  state: DeploymentState,
): Promise<boolean> {
  logger.info('Verifying rollback state...')

  // Check that deployment file exists
  const deploymentFile = join(DEPLOYMENTS_DIR, `${network}.json`)
  if (!existsSync(deploymentFile)) {
    logger.warn(`Deployment file not found: ${deploymentFile}`)
    return false
  }

  const currentState = expectJson(
    readFileSync(deploymentFile, 'utf-8'),
    DeploymentStateSchema,
    `current deployment state`,
  )

  // Verify key addresses match
  const keyFields = [
    'sequencerRegistry',
    'disputeGameFactory',
    'prover',
  ] as const
  let allMatch = true

  for (const field of keyFields) {
    const current = currentState[field]
    const expected = state[field]

    if (current !== expected) {
      logger.warn(
        `Mismatch in ${field}: current=${current}, expected=${expected}`,
      )
      allMatch = false
    } else {
      logger.debug(`✓ ${field} matches: ${current}`)
    }
  }

  if (allMatch) {
    logger.success('Rollback verification passed - all addresses match')
  } else {
    logger.warn(
      'Rollback verification found mismatches - manual review recommended',
    )
  }

  return allMatch
}

async function rollbackDeployment(
  network: string,
  backupName: string,
): Promise<void> {
  logger.info(`Rolling back ${network} deployment to backup: ${backupName}`)

  // Find backup
  const backupPath = findBackup(network, backupName)
  logger.info(`Using backup from: ${backupPath}`)

  // Load deployment state
  const state = loadDeploymentState(backupPath)
  logger.info(
    `Loaded deployment state from timestamp: ${new Date(state.timestamp).toISOString()}`,
  )

  // Backup current deployment
  const currentDeploymentFile = join(DEPLOYMENTS_DIR, `${network}.json`)
  if (existsSync(currentDeploymentFile)) {
    const currentBackupDir = join(
      BACKUPS_DIR,
      network,
      `pre-rollback-${Date.now()}`,
    )
    mkdirSync(currentBackupDir, { recursive: true })
    copyFileSync(
      currentDeploymentFile,
      join(currentBackupDir, 'deployment.json'),
    )
    logger.info(`Backed up current deployment to ${currentBackupDir}`)
  }

  // Restore deployment file
  const backupDeploymentFile = join(backupPath, 'deployment.json')
  copyFileSync(backupDeploymentFile, currentDeploymentFile)
  logger.success(`Restored deployment file: ${currentDeploymentFile}`)

  // Update .env file
  updateEnvFile(network, state)

  // Verify rollback
  const verified = await verifyRollback(network, state)

  if (verified) {
    logger.success(`Rollback complete for ${network}`)
    logger.info(
      `Deployment state restored to timestamp: ${new Date(state.timestamp).toISOString()}`,
    )
  } else {
    logger.warn(
      `Rollback completed but verification found issues - manual review required`,
    )
  }
}

async function main(): Promise<void> {
  try {
    const { network, backup } = parseArgs()

    logger.box(`
Deployment Rollback
Network: ${network.toUpperCase()}
Backup: ${backup}
    `)

    if (network === 'mainnet') {
      logger.warn('MAINNET ROLLBACK - This will affect production!')
      logger.warn('Press Ctrl+C within 10 seconds to cancel...')
      await Bun.sleep(10000)
    }

    await rollbackDeployment(network, backup)

    logger.box(`
Rollback Complete
Network: ${network.toUpperCase()}
Next steps:
  1. Verify contract addresses in .env file
  2. Restart services: bun run scripts/start.ts
  3. Run health checks: bun run scripts/start.ts --status
    `)
  } catch (error) {
    logger.error(
      `Rollback failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    if (error instanceof Error && error.stack) {
      logger.debug(`Stack trace: ${error.stack}`)
    }
    process.exit(1)
  }
}

if (import.meta.main) {
  main()
}
