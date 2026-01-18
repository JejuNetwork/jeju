/** Localnet orchestrator for Kurtosis lifecycle management */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  bootstrapContracts,
  checkRpcHealth,
  getRpcChainId,
  loadPortsConfig,
  startLocalnet,
  stopLocalnet,
} from '../lib/chain'
import { logger } from '../lib/logger'
import { DEFAULT_PORTS } from '../types'

export interface LocalnetStatus {
  running: boolean
  l1Rpc?: string
  l2Rpc?: string
  chainId?: number
  bootstrapped?: boolean
}

export class LocalnetOrchestrator {
  private rootDir: string
  private started: boolean = false
  private bootstrapped: boolean = false
  private chainId: number = 31337

  constructor(rootDir: string) {
    this.rootDir = rootDir
  }

  private getPorts(): { l1Port: number; l2Port: number } {
    return (
      loadPortsConfig(this.rootDir) ?? {
        l1Port: DEFAULT_PORTS.l1Rpc,
        l2Port: DEFAULT_PORTS.l2Rpc,
      }
    )
  }

  async start(): Promise<void> {
    if (this.started) {
      logger.debug('Localnet already started')
      return
    }

    logger.step('Starting localnet...')

    const ports = await startLocalnet(this.rootDir)
    const l2RpcUrl = `http://127.0.0.1:${ports.l2Port}`
    const detectedChainId = await getRpcChainId(l2RpcUrl, 2000)
    if (detectedChainId !== null) {
      this.chainId = detectedChainId
    }
    this.started = true

    logger.success(
      `Localnet running (L1: ${ports.l1Port}, L2: ${ports.l2Port})`,
    )
  }

  async bootstrap(): Promise<void> {
    if (this.bootstrapped) {
      logger.debug('Contracts already bootstrapped')
      return
    }

    const ports = this.getPorts()

    const l2RpcUrl = `http://127.0.0.1:${ports.l2Port}`
    const healthy = await checkRpcHealth(l2RpcUrl, 2000)
    if (!healthy) {
      throw new Error('Localnet not running - cannot bootstrap')
    }

    logger.step('Bootstrapping contracts...')
    await bootstrapContracts(this.rootDir, l2RpcUrl)
    this.bootstrapped = true

    logger.success('Contracts bootstrapped')
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return
    }

    logger.step('Stopping localnet...')
    await stopLocalnet()
    this.started = false
    this.bootstrapped = false

    logger.success('Localnet stopped')
  }

  async waitForReady(timeout = 60000): Promise<boolean> {
    const ports = this.getPorts()
    const l2RpcUrl = `http://127.0.0.1:${ports.l2Port}`
    return await checkRpcHealth(l2RpcUrl, timeout)
  }

  getEnvVars(): Record<string, string> {
    const ports = this.getPorts()
    const l2RpcUrl = `http://127.0.0.1:${ports.l2Port}`

    return {
      L1_RPC_URL: `http://127.0.0.1:${ports.l1Port}`,
      L2_RPC_URL: l2RpcUrl,
      JEJU_RPC_URL: l2RpcUrl,
      CHAIN_ID: String(this.chainId),
    }
  }

  getStatus(): LocalnetStatus {
    const ports = this.getPorts()

    const bootstrapFile = join(
      this.rootDir,
      'packages/contracts/deployments/localnet-complete.json',
    )

    return {
      running: this.started,
      l1Rpc: `http://127.0.0.1:${ports.l1Port}`,
      l2Rpc: `http://127.0.0.1:${ports.l2Port}`,
      chainId: this.chainId,
      bootstrapped: existsSync(bootstrapFile),
    }
  }
}

export function createLocalnetOrchestrator(
  rootDir: string,
): LocalnetOrchestrator {
  return new LocalnetOrchestrator(rootDir)
}
