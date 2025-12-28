/** Docker-based services orchestrator for testing */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  CORE_PORTS,
  getIpfsApiUrl,
  getL1RpcUrl,
  getL2RpcUrl,
  getLocalhostHost,
} from '@jejunetwork/config'
import { execa } from 'execa'
import { logger } from '../lib/logger'

export type TestProfile = 'chain' | 'services' | 'apps' | 'full' | 'solana'

export interface ServiceStatus {
  name: string
  status: 'running' | 'stopped' | 'starting' | 'error'
  port?: number
  url?: string
  healthy: boolean
}

export interface OrchestratorConfig {
  profile: TestProfile
  projectName?: string
  detach?: boolean
  timeout?: number
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  profile: 'services',
  projectName: 'jeju-test',
  detach: true,
  timeout: 120000,
}

const SERVICE_PORTS: Record<string, { port: number; healthPath: string }> = {
  'geth-l1': { port: 8545, healthPath: '/' },
  'op-geth': { port: 9545, healthPath: '/' },
  postgres: { port: 5432, healthPath: '' },
  redis: { port: 6379, healthPath: '' },
  ipfs: { port: CORE_PORTS.IPFS_API.DEFAULT, healthPath: '/api/v0/id' },
  prometheus: { port: 9090, healthPath: '/-/healthy' },
  grafana: { port: 4010, healthPath: '/api/health' },
  solana: { port: 8899, healthPath: '/' },
  arbitrum: { port: 8547, healthPath: '/' },
  base: { port: 8548, healthPath: '/' },
}

const PROFILE_SERVICES: Record<TestProfile, string[]> = {
  chain: ['geth-l1', 'op-geth'],
  services: ['geth-l1', 'op-geth', 'postgres', 'redis', 'ipfs'],
  // apps uses Kurtosis for chain, only needs DBs and storage
  apps: ['postgres', 'redis', 'ipfs'],
  full: [
    'geth-l1',
    'op-geth',
    'postgres',
    'redis',
    'ipfs',
    'prometheus',
    'grafana',
    'solana',
    'arbitrum',
    'base',
  ],
  solana: ['solana'],
}

export class DockerOrchestrator {
  private config: OrchestratorConfig
  private composePath: string
  private rootDir: string

  constructor(rootDir: string, config: Partial<OrchestratorConfig> = {}) {
    this.rootDir = rootDir
    this.config = {
      profile: config.profile ?? DEFAULT_CONFIG.profile,
      projectName: config.projectName ?? DEFAULT_CONFIG.projectName,
      detach: config.detach ?? DEFAULT_CONFIG.detach,
      timeout: config.timeout ?? DEFAULT_CONFIG.timeout,
    }
    this.composePath = join(rootDir, 'packages/tests/docker-compose.test.yml')
  }

  async start(): Promise<void> {
    if (!existsSync(this.composePath)) {
      throw new Error(`Docker compose file not found: ${this.composePath}`)
    }

    await this.checkDocker()

    logger.step(`Starting services (profile: ${this.config.profile})...`)

    const args = [
      'compose',
      '-f',
      this.composePath,
      '-p',
      this.config.projectName || 'jeju-test',
      '--profile',
      this.config.profile,
      'up',
    ]

    if (this.config.detach) {
      args.push('-d')
    }

    args.push(
      '--wait',
      '--wait-timeout',
      String(Math.floor((this.config.timeout || 120000) / 1000)),
    )

    try {
      await execa('docker', args, {
        cwd: this.rootDir,
        stdio: 'inherit',
      })
      logger.success('Services started')
    } catch (error) {
      logger.error('Failed to start services')
      throw error
    }

    await this.waitForHealthy()
  }

  async stop(): Promise<void> {
    logger.step('Stopping services...')

    await execa(
      'docker',
      [
        'compose',
        '-f',
        this.composePath,
        '-p',
        this.config.projectName || 'jeju-test',
        'down',
        '-v',
        '--remove-orphans',
      ],
      {
        cwd: this.rootDir,
        stdio: 'pipe',
        reject: false, // Don't throw if services weren't running
      },
    )
    logger.success('Services stopped')
  }

  async status(): Promise<ServiceStatus[]> {
    const statuses: ServiceStatus[] = []
    const expectedServices = PROFILE_SERVICES[this.config.profile]

    for (const serviceName of expectedServices) {
      const serviceInfo = SERVICE_PORTS[serviceName]
      if (!serviceInfo) continue

      const status = await this.checkServiceHealth(serviceName, serviceInfo)
      statuses.push(status)
    }

    return statuses
  }

  async waitForHealthy(timeout = 60000): Promise<void> {
    const startTime = Date.now()
    const expectedServices = PROFILE_SERVICES[this.config.profile]

    logger.step('Waiting for services to be healthy...')

    while (Date.now() - startTime < timeout) {
      let allHealthy = true

      for (const serviceName of expectedServices) {
        const serviceInfo = SERVICE_PORTS[serviceName]
        if (!serviceInfo) continue

        const status = await this.checkServiceHealth(serviceName, serviceInfo)
        if (!status.healthy) {
          allHealthy = false
          break
        }
      }

      if (allHealthy) {
        logger.success('All services healthy')
        return
      }

      await new Promise((r) => setTimeout(r, 2000))
    }

    throw new Error('Services did not become healthy in time')
  }

  private async checkServiceHealth(
    name: string,
    info: { port: number; healthPath: string },
  ): Promise<ServiceStatus> {
    const url = `http://127.0.0.1:${info.port}${info.healthPath}`

    try {
      if (name === 'postgres') {
        const result = await execa(
          'docker',
          ['exec', 'jeju-postgres', 'pg_isready', '-U', 'jeju'],
          {
            reject: false,
          },
        )
        return {
          name,
          status: result.exitCode === 0 ? 'running' : 'error',
          port: info.port,
          healthy: result.exitCode === 0,
        }
      }

      if (name === 'redis') {
        const result = await execa(
          'docker',
          ['exec', 'jeju-redis', 'redis-cli', 'ping'],
          {
            reject: false,
          },
        )
        return {
          name,
          status: result.stdout.includes('PONG') ? 'running' : 'error',
          port: info.port,
          healthy: result.stdout.includes('PONG') || false,
        }
      }

      // IPFS API requires POST
      const method =
        name.includes('geth') || name === 'solana' || name === 'ipfs'
          ? 'POST'
          : 'GET'
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body:
          name.includes('geth') ||
          name.includes('arbitrum') ||
          name.includes('base')
            ? JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_blockNumber',
                params: [],
                id: 1,
              })
            : name === 'solana'
              ? JSON.stringify({ jsonrpc: '2.0', method: 'getVersion', id: 1 })
              : undefined,
        signal: AbortSignal.timeout(3000),
      })

      return {
        name,
        status: response.ok ? 'running' : 'error',
        port: info.port,
        url: `http://127.0.0.1:${info.port}`,
        healthy: response.ok,
      }
    } catch {
      return {
        name,
        status: 'stopped',
        port: info.port,
        healthy: false,
      }
    }
  }

  private async checkDocker(): Promise<void> {
    try {
      await execa('docker', ['info'], { stdio: 'pipe' })
    } catch {
      throw new Error('Docker is not running. Start Docker and try again.')
    }
  }

  getEnvVars(): Record<string, string> {
    const host = getLocalhostHost()
    const env: Record<string, string> = {
      L1_RPC_URL: getL1RpcUrl(),
      L2_RPC_URL: getL2RpcUrl(),
      JEJU_RPC_URL: getL2RpcUrl(),
      CHAIN_ID: '31337',
      DATABASE_URL: `postgresql://jeju:jeju@${host}:5432/jeju`,
      REDIS_URL: `redis://${host}:6379`,
      IPFS_API_URL: getIpfsApiUrl(),
      IPFS_GATEWAY_URL: `http://${host}:8080`,
    }

    if (this.config.profile === 'full' || this.config.profile === 'solana') {
      env.SOLANA_RPC_URL = `http://${host}:8899`
      env.SOLANA_WS_URL = `ws://${host}:8900`
    }

    if (this.config.profile === 'full') {
      env.ARBITRUM_RPC_URL = `http://${host}:8547`
      env.BASE_RPC_URL = `http://${host}:8548`
    }

    return env
  }

  printStatus(statuses: ServiceStatus[]): void {
    logger.subheader('Services')

    for (const status of statuses) {
      logger.table([
        {
          label: status.name,
          value: status.url || `port ${status.port}`,
          status: status.healthy ? 'ok' : 'error',
        },
      ])
    }
  }
}

export function createDockerOrchestrator(
  rootDir: string,
  profile: TestProfile = 'services',
): DockerOrchestrator {
  return new DockerOrchestrator(rootDir, { profile })
}
