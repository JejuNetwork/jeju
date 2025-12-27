/**
 * Rollback Deployment Tests
 *
 * Tests the rollback-deployment script functionality:
 * - Backup listing
 * - Deployment state loading
 * - Rollback execution
 * - Verification
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { DeploymentStateSchema, expectJson } from '../schemas'

// Test directory setup - use unique ID to prevent test isolation issues
const TEST_ID = `rollback-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const TEST_ROOT = join(import.meta.dir, '..', '.temp', TEST_ID)
const DEPLOYMENTS_DIR = join(TEST_ROOT, 'packages/contracts/deployments')
const BACKUPS_DIR = join(DEPLOYMENTS_DIR, 'backups')

// Test deployment states
const ORIGINAL_STATE = {
  network: 'testnet',
  chainId: 420690,
  timestamp: Date.now() - 86400000, // 1 day ago
  deployer: '0x1234567890123456789012345678901234567890',
  sequencerRegistry: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  disputeGameFactory: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  prover: '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
}

const MODIFIED_STATE = {
  network: 'testnet',
  chainId: 420690,
  timestamp: Date.now(),
  deployer: '0x1234567890123456789012345678901234567890',
  sequencerRegistry: '0x1111111111111111111111111111111111111111',
  disputeGameFactory: '0x2222222222222222222222222222222222222222',
  prover: '0x3333333333333333333333333333333333333333',
}

// Test helper functions that mirror the rollback script
function listBackups(network: string): string[] {
  const networkBackupsDir = join(BACKUPS_DIR, network)
  if (!existsSync(networkBackupsDir)) {
    return []
  }

  const { readdirSync, statSync } = require('node:fs')
  const entries: string[] = []
  for (const entry of readdirSync(networkBackupsDir)) {
    const entryPath = join(networkBackupsDir, entry)
    if (statSync(entryPath).isDirectory()) {
      entries.push(entry)
    }
  }
  return entries.sort().reverse()
}

function findBackup(network: string, backupName: string): string {
  const networkBackupsDir = join(BACKUPS_DIR, network)

  if (backupName === 'latest') {
    const backups = listBackups(network)
    if (backups.length === 0) {
      throw new Error(`No backups found for network ${network}`)
    }
    const latestBackup = backups[0]
    if (!latestBackup) {
      throw new Error(`No valid backup found for network ${network}`)
    }
    return join(networkBackupsDir, latestBackup)
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

function loadDeploymentState(backupPath: string): typeof ORIGINAL_STATE {
  const deploymentFile = join(backupPath, 'deployment.json')
  if (!existsSync(deploymentFile)) {
    throw new Error(`Deployment file not found in backup: ${deploymentFile}`)
  }

  const content = readFileSync(deploymentFile, 'utf-8')
  return expectJson(content, DeploymentStateSchema, 'backup deployment state')
}

function createBackup(
  network: string,
  backupName: string,
  state: typeof ORIGINAL_STATE,
): void {
  const backupDir = join(BACKUPS_DIR, network, backupName)
  mkdirSync(backupDir, { recursive: true })
  writeFileSync(
    join(backupDir, 'deployment.json'),
    JSON.stringify(state, null, 2),
  )
}

function rollbackToBackup(network: string, backupPath: string): void {
  const state = loadDeploymentState(backupPath)
  const deploymentFile = join(DEPLOYMENTS_DIR, `${network}.json`)
  writeFileSync(deploymentFile, JSON.stringify(state, null, 2))
}

// Setup / Teardown

beforeAll(() => {
  // Create test directory structure
  mkdirSync(DEPLOYMENTS_DIR, { recursive: true })
  mkdirSync(join(BACKUPS_DIR, 'testnet'), { recursive: true })

  // Create original backup
  createBackup('testnet', 'backup-original', ORIGINAL_STATE)

  // Create current deployment (modified state)
  writeFileSync(
    join(DEPLOYMENTS_DIR, 'testnet.json'),
    JSON.stringify(MODIFIED_STATE, null, 2),
  )
})

afterAll(() => {
  // Clean up test directory
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true })
  }
})

// Tests

describe('Backup Listing', () => {
  it('should list available backups', () => {
    const backups = listBackups('testnet')
    expect(backups).toContain('backup-original')
  })

  it('should return empty array for non-existent network', () => {
    const backups = listBackups('nonexistent')
    expect(backups).toEqual([])
  })

  it('should sort backups in reverse order (newest first)', () => {
    // Create additional backups
    createBackup('testnet', 'backup-aaa', ORIGINAL_STATE)
    createBackup('testnet', 'backup-zzz', ORIGINAL_STATE)

    const backups = listBackups('testnet')

    // Should be sorted in reverse alphabetical order
    expect(backups[0]).toBe('backup-zzz')
    expect(backups[backups.length - 1]).toBe('backup-aaa')
  })
})

describe('Backup Finding', () => {
  it('should find backup by name', () => {
    const backupPath = findBackup('testnet', 'backup-original')
    expect(backupPath).toContain('backup-original')
    expect(existsSync(backupPath)).toBe(true)
  })

  it('should find latest backup', () => {
    const backupPath = findBackup('testnet', 'latest')
    expect(existsSync(backupPath)).toBe(true)
  })

  it('should throw for non-existent backup', () => {
    expect(() => findBackup('testnet', 'nonexistent-backup')).toThrow(
      'Backup nonexistent-backup not found',
    )
  })

  it('should throw when no backups exist for network', () => {
    expect(() => findBackup('mainnet', 'latest')).toThrow(
      'No backups found for network mainnet',
    )
  })
})

describe('Deployment State Loading', () => {
  it('should load deployment state from backup', () => {
    const backupPath = findBackup('testnet', 'backup-original')
    const state = loadDeploymentState(backupPath)

    expect(state.network).toBe('testnet')
    expect(state.chainId).toBe(420690)
    expect(state.sequencerRegistry).toBe(ORIGINAL_STATE.sequencerRegistry)
    expect(state.disputeGameFactory).toBe(ORIGINAL_STATE.disputeGameFactory)
    expect(state.prover).toBe(ORIGINAL_STATE.prover)
  })

  it('should throw for backup without deployment.json', () => {
    const emptyBackupDir = join(BACKUPS_DIR, 'testnet', 'backup-empty')
    mkdirSync(emptyBackupDir, { recursive: true })

    expect(() => loadDeploymentState(emptyBackupDir)).toThrow(
      'Deployment file not found in backup',
    )
  })

  it('should validate deployment state schema', () => {
    const invalidBackupDir = join(BACKUPS_DIR, 'testnet', 'backup-invalid')
    mkdirSync(invalidBackupDir, { recursive: true })
    writeFileSync(
      join(invalidBackupDir, 'deployment.json'),
      JSON.stringify({ invalid: 'data' }),
    )

    expect(() => loadDeploymentState(invalidBackupDir)).toThrow()
  })
})

describe('Rollback Execution', () => {
  it('should rollback deployment to backup state', () => {
    // Verify current state is modified
    const currentFile = join(DEPLOYMENTS_DIR, 'testnet.json')
    const currentState = JSON.parse(readFileSync(currentFile, 'utf-8'))
    expect(currentState.sequencerRegistry).toBe(
      MODIFIED_STATE.sequencerRegistry,
    )

    // Perform rollback
    const backupPath = findBackup('testnet', 'backup-original')
    rollbackToBackup('testnet', backupPath)

    // Verify state was rolled back
    const rolledBackState = JSON.parse(readFileSync(currentFile, 'utf-8'))
    expect(rolledBackState.sequencerRegistry).toBe(
      ORIGINAL_STATE.sequencerRegistry,
    )
    expect(rolledBackState.disputeGameFactory).toBe(
      ORIGINAL_STATE.disputeGameFactory,
    )
    expect(rolledBackState.prover).toBe(ORIGINAL_STATE.prover)
  })

  it('should preserve all fields during rollback', () => {
    const currentFile = join(DEPLOYMENTS_DIR, 'testnet.json')
    const rolledBackState = JSON.parse(readFileSync(currentFile, 'utf-8'))

    expect(rolledBackState.network).toBe(ORIGINAL_STATE.network)
    expect(rolledBackState.chainId).toBe(ORIGINAL_STATE.chainId)
    expect(rolledBackState.deployer).toBe(ORIGINAL_STATE.deployer)
    expect(rolledBackState.timestamp).toBe(ORIGINAL_STATE.timestamp)
  })
})

describe('End-to-End Rollback Workflow', () => {
  it('should complete full rollback cycle', () => {
    // 1. Create a new deployment state
    const newState = {
      ...ORIGINAL_STATE,
      timestamp: Date.now(),
      sequencerRegistry: '0x9999999999999999999999999999999999999999',
    }
    const deploymentFile = join(DEPLOYMENTS_DIR, 'testnet.json')
    writeFileSync(deploymentFile, JSON.stringify(newState, null, 2))

    // 2. Backup the new state
    createBackup('testnet', `backup-${Date.now()}`, newState)

    // 3. Modify the deployment again
    const modifiedState = {
      ...newState,
      sequencerRegistry: '0x0000000000000000000000000000000000000000',
    }
    writeFileSync(deploymentFile, JSON.stringify(modifiedState, null, 2))

    // 4. Verify current state is modified
    const currentState = JSON.parse(readFileSync(deploymentFile, 'utf-8'))
    expect(currentState.sequencerRegistry).toBe(
      '0x0000000000000000000000000000000000000000',
    )

    // 5. Rollback to original backup
    const backupPath = findBackup('testnet', 'backup-original')
    rollbackToBackup('testnet', backupPath)

    // 6. Verify rollback succeeded
    const finalState = JSON.parse(readFileSync(deploymentFile, 'utf-8'))
    expect(finalState.sequencerRegistry).toBe(ORIGINAL_STATE.sequencerRegistry)
  })
})
