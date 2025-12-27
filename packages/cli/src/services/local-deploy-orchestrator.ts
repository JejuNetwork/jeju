/** Local deploy orchestrator for DWS contracts and apps */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AddressSchema, validateOrNull, ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { z } from 'zod'
import {
  type DeployConfig,
  type DWSContractAddresses,
  deployAppOnchain,
} from '../lib/deploy-app-onchain'
import { registerDWSNode } from '../lib/dws-node'
import { logger } from '../lib/logger'
import type { AppManifest } from '../types'

const DWSContractAddressesSchema = z.object({
  storageManager: AddressSchema,
  workerRegistry: AddressSchema,
  cdnRegistry: AddressSchema,
  jnsRegistry: AddressSchema,
  jnsResolver: AddressSchema,
  jnsRegistrar: AddressSchema,
  jnsReverseRegistrar: AddressSchema,
})

/**
 * Check if DWS contracts are valid (not all zero addresses)
 */
function isValidDWSDeployment(contracts: DWSContractAddresses): boolean {
  // Must have at least storageManager or cdnRegistry deployed
  const hasStorage =
    contracts.storageManager && contracts.storageManager !== ZERO_ADDRESS
  const hasCdn = contracts.cdnRegistry && contracts.cdnRegistry !== ZERO_ADDRESS
  const hasJns = contracts.jnsRegistry && contracts.jnsRegistry !== ZERO_ADDRESS
  return hasStorage || hasCdn || hasJns
}

interface LocalDeployConfig {
  rootDir: string
  rpcUrl: string
  privateKey: Hex
  dwsPort: number
  ipfsApiUrl: string
}

export class LocalDeployOrchestrator {
  private config: LocalDeployConfig
  private dwsContracts: DWSContractAddresses | null = null
  private deployedApps: Map<string, { cid: string; workerId?: Hex }> = new Map()

  constructor(config: LocalDeployConfig) {
    this.config = config
  }

  async deployDWSContracts(): Promise<DWSContractAddresses> {
    logger.step('Deploying DWS contracts...')

    const contractsDir = join(this.config.rootDir, 'packages/contracts')

    // SECURITY: Pass private key via environment variable instead of command line
    // Command line args are visible in 'ps' output and system audit logs
    const cmd = `forge script script/DeployDWS.s.sol:DeployDWS --rpc-url ${this.config.rpcUrl} --private-key $DEPLOYER_PRIVATE_KEY --broadcast`

    try {
      const output = execSync(cmd, {
        cwd: contractsDir,
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
        env: {
          ...process.env,
          DEPLOYER_PRIVATE_KEY: this.config.privateKey,
          ARBISCAN_API_KEY: 'dummy',
          BASESCAN_API_KEY: 'dummy',
          ETHERSCAN_API_KEY: 'dummy',
        },
      })

      const addresses = this.parseDeploymentOutput(output)
      this.dwsContracts = addresses

      this.saveDeployment(addresses)

      logger.success('DWS contracts deployed')
      return addresses
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      throw new Error(`DWS deployment failed: ${errorMsg}`)
    }
  }

  loadDWSContracts(): DWSContractAddresses | null {
    const deploymentFile = join(
      this.config.rootDir,
      'packages/contracts/deployments/dws-localnet.json',
    )

    if (!existsSync(deploymentFile)) {
      return null
    }

    const data = validateOrNull(
      DWSContractAddressesSchema,
      JSON.parse(readFileSync(deploymentFile, 'utf-8')),
    )

    // Validate that the deployment has actual addresses, not placeholders
    if (!data || !isValidDWSDeployment(data)) {
      logger.debug(
        'DWS deployment file has placeholder or invalid addresses, will redeploy',
      )
      return null
    }

    this.dwsContracts = data
    return this.dwsContracts
  }

  async registerLocalNode(): Promise<void> {
    if (!this.dwsContracts) {
      throw new Error(
        'DWS contracts not deployed - call deployDWSContracts() first',
      )
    }

    const dwsEndpoint = `http://localhost:${this.config.dwsPort}`

    await registerDWSNode({
      rpcUrl: this.config.rpcUrl,
      privateKey: this.config.privateKey,
      dwsEndpoint,
      storageManagerAddress: this.dwsContracts.storageManager,
      cdnRegistryAddress: this.dwsContracts.cdnRegistry,
      workerRegistryAddress: this.dwsContracts.workerRegistry,
    })
  }

  async deployApp(appDir: string, manifest: AppManifest): Promise<void> {
    if (!this.dwsContracts) {
      throw new Error(
        'DWS contracts not deployed - call deployDWSContracts() first',
      )
    }

    const deployConfig: DeployConfig = {
      rpcUrl: this.config.rpcUrl,
      privateKey: this.config.privateKey,
      contracts: this.dwsContracts,
      ipfsApiUrl: this.config.ipfsApiUrl,
    }

    const result = await deployAppOnchain(appDir, manifest, deployConfig)

    this.deployedApps.set(manifest.name, {
      cid: result.frontendCid ?? '',
      workerId: result.workerId,
    })
  }

  async deployAllApps(
    apps: Array<{ dir: string; manifest: AppManifest }>,
  ): Promise<void> {
    logger.step(`Deploying ${apps.length} apps on-chain in parallel...`)

    // Deploy all apps in parallel using Promise.allSettled to continue even if some fail
    const deployResults = await Promise.allSettled(
      apps.map(async ({ dir, manifest }) => {
        await this.deployApp(dir, manifest)
        return manifest.name
      }),
    )

    // Report failures
    for (let i = 0; i < deployResults.length; i++) {
      const result = deployResults[i]
      if (result.status === 'rejected') {
        const errorMsg =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason)
        logger.warn(`Failed to deploy ${apps[i].manifest.name}: ${errorMsg}`)
      }
    }

    logger.success(`Deployed ${this.deployedApps.size} apps`)
  }

  getDeployedApps(): Map<string, { cid: string; workerId?: Hex }> {
    return this.deployedApps
  }

  getContractAddresses(): DWSContractAddresses | null {
    return this.dwsContracts
  }

  private parseDeploymentOutput(output: string): DWSContractAddresses {
    const addressRegex = /(\w+):\s+(0x[a-fA-F0-9]{40})/g
    const addresses: Record<string, Address> = {}

    for (const match of output.matchAll(addressRegex)) {
      addresses[match[1]] = match[2] as Address
    }

    // Validate required contracts were deployed
    const required = [
      'JNSRegistry',
      'StorageManager',
      'WorkerRegistry',
      'CDNRegistry',
    ]
    const missing = required.filter((name) => !addresses[name])
    if (missing.length > 0) {
      throw new Error(
        `Missing required contracts in deployment output: ${missing.join(', ')}`,
      )
    }

    return {
      jnsRegistry: addresses.JNSRegistry,
      jnsResolver: addresses.JNSResolver ?? ZERO_ADDRESS,
      jnsRegistrar: addresses.JNSRegistrar ?? ZERO_ADDRESS,
      jnsReverseRegistrar: addresses.JNSReverseRegistrar ?? ZERO_ADDRESS,
      storageManager: addresses.StorageManager,
      workerRegistry: addresses.WorkerRegistry,
      cdnRegistry: addresses.CDNRegistry,
    }
  }

  private saveDeployment(addresses: DWSContractAddresses): void {
    const deploymentFile = join(
      this.config.rootDir,
      'packages/contracts/deployments/dws-localnet.json',
    )

    const { writeFileSync, mkdirSync } = require('node:fs')
    const deploymentDir = join(
      this.config.rootDir,
      'packages/contracts/deployments',
    )

    if (!existsSync(deploymentDir)) {
      mkdirSync(deploymentDir, { recursive: true })
    }

    writeFileSync(deploymentFile, JSON.stringify(addresses, null, 2))
    logger.debug(`DWS deployment saved to ${deploymentFile}`)
  }
}

export function createLocalDeployOrchestrator(
  rootDir: string,
  rpcUrl: string,
  privateKey: Hex,
): LocalDeployOrchestrator {
  return new LocalDeployOrchestrator({
    rootDir,
    rpcUrl,
    privateKey,
    dwsPort: 4030,
    ipfsApiUrl: 'http://localhost:5001',
  })
}
