/** Local deploy orchestrator for DWS contracts and apps */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Address, Hex } from 'viem'
import {
  type DeployConfig,
  type DWSContractAddresses,
  deployAppOnchain,
} from '../lib/deploy-app-onchain'
import { registerDWSNode } from '../lib/dws-node'
import { logger } from '../lib/logger'
import type { AppManifest } from '../types'

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

    const cmd = `cd ${contractsDir} && ARBISCAN_API_KEY=dummy BASESCAN_API_KEY=dummy ETHERSCAN_API_KEY=dummy forge script script/DeployDWS.s.sol:DeployDWS --rpc-url ${this.config.rpcUrl} --private-key ${this.config.privateKey} --broadcast`

    try {
      const output = execSync(cmd, {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
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

    const data = JSON.parse(readFileSync(deploymentFile, 'utf-8'))
    this.dwsContracts = data as DWSContractAddresses
    return this.dwsContracts
  }

  async registerLocalNode(): Promise<void> {
    if (!this.dwsContracts) {
      throw new Error('DWS contracts not deployed')
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
      throw new Error('DWS contracts not deployed')
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
    logger.step(`Deploying ${apps.length} apps on-chain...`)

    for (const { dir, manifest } of apps) {
      try {
        await this.deployApp(dir, manifest)
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        logger.warn(`Failed to deploy ${manifest.name}: ${errorMsg}`)
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

    return {
      jnsRegistry: addresses.JNSRegistry || ('0x' as Address),
      jnsResolver: addresses.JNSResolver || ('0x' as Address),
      jnsRegistrar: addresses.JNSRegistrar || ('0x' as Address),
      jnsReverseRegistrar: addresses.JNSReverseRegistrar || ('0x' as Address),
      storageManager: addresses.StorageManager || ('0x' as Address),
      workerRegistry: addresses.WorkerRegistry || ('0x' as Address),
      cdnRegistry: addresses.CDNRegistry || ('0x' as Address),
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
