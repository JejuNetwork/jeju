/**
 * Contracts Required Module
 *
 * This module ENFORCES that contracts are deployed before tests run.
 * It throws a hard error if contracts are not deployed - NO SKIPPING.
 *
 * Usage:
 *   import { requireContracts } from '@jejunetwork/tests/contracts-required'
 *   const contracts = await requireContracts() // Throws if not deployed
 *
 * Design:
 * - Tests should NOT skip when contracts are missing - they should FAIL
 * - This module verifies contracts on-chain, not just file existence
 * - All contract addresses are returned for test usage
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getL2RpcUrl } from '@jejunetwork/config'
import type { Address } from 'viem'
import { z } from 'zod'

// Schema for deployed contracts
const DeployedContractsSchema = z.object({
  // Core contracts
  jnsRegistry: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  jnsResolver: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  identityRegistry: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  reputationRegistry: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  validationRegistry: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),

  // DWS contracts
  storageManager: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  workerRegistry: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  cdnRegistry: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),

  // Token contracts
  usdc: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  jeju: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  weth: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),

  // Payment contracts
  creditManager: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  universalPaymaster: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  entryPoint: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
})

export type DeployedContracts = z.infer<typeof DeployedContractsSchema>

interface RequireContractsResult {
  contracts: DeployedContracts
  rpcUrl: string
  chainId: number
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * Find the monorepo root
 */
function findMonorepoRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 15; i++) {
    if (
      existsSync(join(dir, 'bun.lock')) &&
      existsSync(join(dir, 'packages'))
    ) {
      return dir
    }
    const parent = join(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  throw new Error('Could not find jeju monorepo root')
}

/**
 * Load deployed contract addresses from the bootstrap file
 */
function loadDeployedContracts(rootDir: string): DeployedContracts {
  const bootstrapFile = join(
    rootDir,
    'packages/contracts/deployments/localnet-complete.json',
  )

  if (!existsSync(bootstrapFile)) {
    throw new Error(
      `CONTRACTS NOT DEPLOYED: ${bootstrapFile} not found.\n\n` +
        'Run one of:\n' +
        '  bun run jeju dev          # Starts chain and deploys contracts\n' +
        '  bun run jeju test         # Uses test orchestrator to deploy\n\n' +
        'Tests CANNOT run without deployed contracts.',
    )
  }

  const data = JSON.parse(readFileSync(bootstrapFile, 'utf-8'))
  const contracts = data?.contracts

  if (!contracts) {
    throw new Error(
      `CONTRACTS NOT DEPLOYED: ${bootstrapFile} has no contracts section.\n\n` +
        'The bootstrap file exists but contains no contract addresses.\n' +
        'Run: bun run jeju dev',
    )
  }

  // Validate at least one critical contract exists
  const jnsRegistry = contracts.jnsRegistry
  if (!jnsRegistry || jnsRegistry === ZERO_ADDRESS) {
    throw new Error(
      `CONTRACTS NOT DEPLOYED: JNS Registry not found in ${bootstrapFile}.\n\n` +
        'The bootstrap file exists but JNS Registry is not deployed.\n' +
        'Run: bun run jeju dev',
    )
  }

  return contracts as DeployedContracts
}

/**
 * Verify a contract is actually deployed on-chain
 */
async function verifyContractOnChain(
  rpcUrl: string,
  address: string,
  contractName: string,
): Promise<void> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getCode',
        params: [address, 'latest'],
        id: 1,
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`RPC request failed: ${response.status}`)
    }

    const data = await response.json()
    const code = data.result as string

    if (!code || code === '0x' || code.length < 4) {
      throw new Error(
        `CONTRACT NOT DEPLOYED ON-CHAIN: ${contractName} at ${address}\n\n` +
          'The bootstrap file has this address but there is no code on-chain.\n' +
          'This usually means the chain was reset without re-deploying contracts.\n\n' +
          'Run: bun run jeju dev\n\n' +
          'Or if using existing chain:\n' +
          '  bun run packages/deployment/scripts/bootstrap-localnet-complete.ts',
      )
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('CONTRACT NOT DEPLOYED')
    ) {
      throw error
    }
    throw new Error(
      `CHAIN NOT AVAILABLE: Cannot verify ${contractName} at ${address}\n\n` +
        `RPC URL: ${rpcUrl}\n` +
        `Error: ${error instanceof Error ? error.message : String(error)}\n\n` +
        'Make sure the chain is running:\n' +
        '  bun run jeju dev',
    )
  }
}

/**
 * Verify the chain is running and get chain ID
 */
async function verifyChainRunning(rpcUrl: string): Promise<number> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`RPC request failed: ${response.status}`)
    }

    const data = await response.json()
    if (data.error) {
      throw new Error(data.error.message)
    }

    return parseInt(data.result, 16)
  } catch (error) {
    throw new Error(
      `CHAIN NOT RUNNING: Cannot connect to RPC at ${rpcUrl}\n\n` +
        `Error: ${error instanceof Error ? error.message : String(error)}\n\n` +
        'Start the chain first:\n' +
        '  bun run jeju dev',
    )
  }
}

/**
 * REQUIRE contracts to be deployed - throws if not
 *
 * This is the main entry point. Call this at the start of any test file
 * that needs contracts. It will throw a hard error if:
 *
 * 1. Chain is not running
 * 2. Bootstrap file doesn't exist
 * 3. Contracts aren't actually deployed on-chain
 *
 * Returns the contract addresses for use in tests.
 */
export async function requireContracts(): Promise<RequireContractsResult> {
  const rootDir = findMonorepoRoot()
  const rpcUrl = getL2RpcUrl()

  // Step 1: Verify chain is running
  const chainId = await verifyChainRunning(rpcUrl)

  // Step 2: Load contract addresses from bootstrap file
  const contracts = loadDeployedContracts(rootDir)

  // Step 3: Verify at least JNS Registry is deployed on-chain
  // This is the critical contract that proves the bootstrap ran successfully
  await verifyContractOnChain(rpcUrl, contracts.jnsRegistry, 'JNS Registry')

  // Step 4: Optionally verify identity registry if present
  if (
    contracts.identityRegistry &&
    contracts.identityRegistry !== ZERO_ADDRESS
  ) {
    await verifyContractOnChain(
      rpcUrl,
      contracts.identityRegistry,
      'Identity Registry',
    )
  }

  return { contracts, rpcUrl, chainId }
}

/**
 * Get contract address or throw if not available
 */
export function getRequiredContract(
  contracts: DeployedContracts,
  name: keyof DeployedContracts,
): Address {
  const address = contracts[name]
  if (!address || address === ZERO_ADDRESS) {
    throw new Error(
      `REQUIRED CONTRACT NOT DEPLOYED: ${name}\n\n` +
        'This contract is required for this test but was not deployed.\n' +
        'Run: bun run jeju dev',
    )
  }
  return address as Address
}

/**
 * Synchronous check that throws if contracts likely not deployed
 * Use this in describe() blocks where async isn't available
 */
export function assertContractsDeployedSync(): DeployedContracts {
  const rootDir = findMonorepoRoot()
  return loadDeployedContracts(rootDir)
}

/**
 * Check if contracts are likely deployed (synchronous, for conditional logic)
 * Returns null if not deployed, contracts if deployed
 */
export function getContractsIfDeployed(): DeployedContracts | null {
  try {
    const rootDir = findMonorepoRoot()
    return loadDeployedContracts(rootDir)
  } catch {
    return null
  }
}
