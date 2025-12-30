/** Infrastructure service for Jeju development */

import { existsSync } from 'node:fs'
import { platform } from 'node:os'
import { join } from 'node:path'
import {
  CORE_PORTS,
  getDWSUrl,
  getSQLitBlockProducerUrl,
  getFarcasterHubUrl,
  getIpfsApiUrl,
  getL2RpcUrl,
  getLocalhostHost,
  INFRA_PORTS,
} from '@jejunetwork/config'
import { execa, type ResultPromise } from 'execa'
import { logger } from '../lib/logger'
import { DEFAULT_PORTS } from '../types'

export interface ServiceHealth {
  name: string
  port: number
  healthy: boolean
  url: string
}

export interface InfrastructureStatus {
  docker: boolean
  sqlit: boolean
  services: ServiceHealth[]
  localnet: boolean
  allHealthy: boolean
}

const SQLIT_PORT = INFRA_PORTS.SQLit.get()

// DWS provides cache and DA services via /cache and /da endpoints
const DWS_PORT = CORE_PORTS.DWS_API.get()

// Docker services - IPFS is started via Docker, cache/DA are provided by DWS
const DOCKER_SERVICES = {
  ipfs: {
    port: CORE_PORTS.IPFS_API.DEFAULT,
    healthPath: '/api/v0/id',
    name: 'IPFS',
    container: 'jeju-ipfs',
    required: true,
  },
  farcaster: {
    port: 2281,
    healthPath: '/v1/info',
    name: 'Farcaster Hub',
    container: 'jeju-farcaster-hub',
    required: false,
  },
} as const

const LOCALNET_PORT = DEFAULT_PORTS.l2Rpc

let sqlitProcess: ResultPromise | null = null

export class InfrastructureService {
  private rootDir: string

  constructor(rootDir: string) {
    this.rootDir = rootDir
  }

  async isSQLitRunning(): Promise<boolean> {
    try {
      const response = await fetch(
        `http://${getLocalhostHost()}:${SQLIT_PORT}/v1/status`,
        {
          signal: AbortSignal.timeout(2000),
        },
      )
      return response.ok
    } catch {
      return false
    }
  }

  async startSQLit(): Promise<boolean> {
    if (await this.isSQLitRunning()) {
      logger.success('SQLit already running')
      return true
    }

    // First try Docker-based SQLit if available
    const dockerAvailable = await this.isDockerRunning()
    const composeFile = join(
      this.rootDir,
      'packages/deployment/docker/sqlit-internal.compose.yaml',
    )

    if (dockerAvailable && existsSync(composeFile)) {
      logger.step('Starting SQLit Docker cluster...')

      const dockerProcess = execa(
        'docker',
        ['compose', '-f', composeFile, 'up', '-d'],
        {
          cwd: this.rootDir,
          stdio: 'pipe',
        },
      )

      try {
        await dockerProcess
        // Wait for Docker startup
        for (let i = 0; i < 60; i++) {
          await this.sleep(500)
          if (await this.isSQLitRunning()) {
            logger.success(`SQLit cluster running on port ${SQLIT_PORT}`)
            return true
          }
        }
      } catch (err) {
        logger.debug(`Docker SQLit failed: ${String(err)}`)
      }
    }

    // Fall back to SQLit-based SQLit server
    logger.step('Starting SQLit SQLit server...')

    const serverPath = join(this.rootDir, 'packages/db/src/server.ts')
    if (!existsSync(serverPath)) {
      logger.error('SQLit server not found at packages/db/src/server.ts')
      return false
    }

    sqlitProcess = execa('bun', ['run', serverPath], {
      cwd: this.rootDir,
      env: {
        ...process.env,
        PORT: String(SQLIT_PORT),
        SQLIT_PORT: String(SQLIT_PORT),
      },
      stdio: 'pipe',
    })

    // Wait for server to start
    for (let i = 0; i < 20; i++) {
      await this.sleep(250)
      if (await this.isSQLitRunning()) {
        logger.success(`SQLit SQLit server running on port ${SQLIT_PORT}`)
        logger.keyValue(
          '  API Endpoint',
          `http://${getLocalhostHost()}:${SQLIT_PORT}`,
        )
        logger.info('  Mode: SQLit-compatible (local development)')
        return true
      }
    }

    logger.error('SQLit server failed to start within 5 seconds')
    return false
  }

  async stopSQLit(): Promise<void> {
    // Stop SQLit server process if running
    if (sqlitProcess) {
      sqlitProcess.kill('SIGTERM')
      sqlitProcess = null
    }

    // Stop Docker cluster if running
    const composeFile = join(
      this.rootDir,
      'packages/deployment/docker/sqlit-internal.compose.yaml',
    )

    if (existsSync(composeFile) && (await this.isDockerRunning())) {
      logger.step('Stopping SQLit cluster...')
      await execa('docker', ['compose', '-f', composeFile, 'down'], {
        cwd: this.rootDir,
        reject: false,
      })
    }
  }

  // Cache and DA services are now provided by DWS at /cache and /da endpoints
  async isCacheServiceRunning(): Promise<boolean> {
    try {
      const response = await fetch(
        `http://${getLocalhostHost()}:${DWS_PORT}/cache/health`,
        { signal: AbortSignal.timeout(2000) },
      )
      return response.ok
    } catch {
      return false
    }
  }

  async isDAServerRunning(): Promise<boolean> {
    try {
      const response = await fetch(
        `http://${getLocalhostHost()}:${DWS_PORT}/da/health`,
        {
          signal: AbortSignal.timeout(2000),
        },
      )
      return response.ok
    } catch {
      return false
    }
  }

  async isDockerRunning(): Promise<boolean> {
    try {
      const result = await execa('docker', ['info'], {
        timeout: 10000,
        reject: false,
      })
      return result.exitCode === 0
    } catch {
      return false
    }
  }

  async isDockerInstalled(): Promise<boolean> {
    try {
      await execa('docker', ['--version'], { timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  async startDocker(): Promise<boolean> {
    const os = platform()

    logger.step('Starting Docker...')

    if (os === 'darwin') {
      try {
        await execa('open', ['-a', 'Docker'], { reject: false })

        for (let i = 0; i < 60; i++) {
          await this.sleep(1000)
          if (await this.isDockerRunning()) {
            logger.success('Docker started')
            return true
          }
          if (i % 10 === 9) {
            logger.info(`  Waiting for Docker to start... (${i + 1}s)`)
          }
        }

        logger.error('Docker failed to start within 60 seconds')
        return false
      } catch {
        logger.error('Failed to start Docker Desktop')
        return false
      }
    } else if (os === 'linux') {
      try {
        await execa('sudo', ['systemctl', 'start', 'docker'], {
          timeout: 30000,
          reject: false,
        })

        for (let i = 0; i < 30; i++) {
          await this.sleep(1000)
          if (await this.isDockerRunning()) {
            logger.success('Docker started')
            return true
          }
        }

        return false
      } catch {
        logger.error('Failed to start Docker service')
        logger.info('  Try: sudo systemctl start docker')
        return false
      }
    } else {
      logger.error(`Unsupported OS: ${os}`)
      logger.info('  Please start Docker manually')
      return false
    }
  }

  async checkDockerServiceHealth(
    key: keyof typeof DOCKER_SERVICES,
  ): Promise<ServiceHealth> {
    const config = DOCKER_SERVICES[key]
    const url = `http://127.0.0.1:${config.port}${config.healthPath}`

    try {
      const response = await fetch(url, {
        method: config.healthPath.startsWith('/api/v0') ? 'POST' : 'GET',
        signal: AbortSignal.timeout(3000),
      })

      return {
        name: config.name,
        port: config.port,
        healthy: response.ok,
        url: `http://127.0.0.1:${config.port}`,
      }
    } catch {
      return {
        name: config.name,
        port: config.port,
        healthy: false,
        url: `http://127.0.0.1:${config.port}`,
      }
    }
  }

  async checkDockerServices(): Promise<ServiceHealth[]> {
    const results: ServiceHealth[] = []

    for (const key of Object.keys(
      DOCKER_SERVICES,
    ) as (keyof typeof DOCKER_SERVICES)[]) {
      results.push(await this.checkDockerServiceHealth(key))
    }

    return results
  }

  async getSQLitHealth(): Promise<ServiceHealth> {
    const healthy = await this.isSQLitRunning()
    return {
      name: 'SQLit (SQLit)',
      port: SQLIT_PORT,
      healthy,
      url: `http://${getLocalhostHost()}:${SQLIT_PORT}`,
    }
  }

  async startDockerServices(): Promise<boolean> {
    logger.step('Starting Docker services...')

    // Start IPFS via Docker (cache and DA are provided by DWS)
    const composePath = join(
      this.rootDir,
      'packages/deployment/docker/localnet.compose.yaml',
    )
    if (!existsSync(composePath)) {
      logger.error(
        'localnet.compose.yaml not found in packages/deployment/docker/',
      )
      return false
    }

    try {
      await execa(
        'docker',
        ['compose', '-f', composePath, 'up', '-d', 'ipfs'],
        {
          cwd: this.rootDir,
          stdio: 'pipe',
        },
      )

      logger.info('  Waiting for services to be healthy...')
      const requiredServices = Object.entries(DOCKER_SERVICES)
        .filter(([_, config]) => config.required)
        .map(([key]) => key)

      for (let attempt = 0; attempt < 60; attempt++) {
        const services = await this.checkDockerServices()
        const requiredHealthy = services
          .filter((s) =>
            requiredServices.some(
              (key) =>
                DOCKER_SERVICES[key as keyof typeof DOCKER_SERVICES].name ===
                s.name,
            ),
          )
          .every((s) => s.healthy)

        if (requiredHealthy) {
          for (const service of services.filter((s) => s.healthy)) {
            logger.success(`  ${service.name} ready`)
          }
          return true
        }

        await this.sleep(1000)

        if (attempt % 10 === 9) {
          const unhealthy = services
            .filter(
              (s) =>
                !s.healthy &&
                requiredServices.some(
                  (key) =>
                    DOCKER_SERVICES[key as keyof typeof DOCKER_SERVICES]
                      .name === s.name,
                ),
            )
            .map((s) => s.name)
          logger.info(`  Still waiting for: ${unhealthy.join(', ')}`)
        }
      }

      logger.error('Services did not become healthy within 60 seconds')
      return false
    } catch (error) {
      logger.error('Failed to start Docker services')
      logger.debug(String(error))
      return false
    }
  }

  async stopServices(): Promise<void> {
    logger.step('Stopping all services...')

    await this.stopSQLit()
    logger.success('SQLit stopped')

    const composePath = join(
      this.rootDir,
      'packages/deployment/docker/localnet.compose.yaml',
    )
    await execa('docker', ['compose', '-f', composePath, 'down'], {
      cwd: this.rootDir,
      stdio: 'pipe',
      reject: false,
    })
    logger.success('Docker services stopped')
  }

  async isLocalnetRunning(): Promise<boolean> {
    try {
      const response = await fetch(
        `http://${getLocalhostHost()}:${LOCALNET_PORT}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_chainId',
            params: [],
            id: 1,
          }),
          signal: AbortSignal.timeout(2000),
        },
      )
      return response.ok
    } catch {
      return false
    }
  }

  async startLocalnet(): Promise<boolean> {
    if (await this.isLocalnetRunning()) {
      logger.success('Localnet already running')
      return true
    }

    logger.step('Starting localnet...')

    try {
      const { exitCode } = await execa('which', ['anvil'], { reject: false })
      if (exitCode !== 0) {
        logger.error('Anvil not found')
        logger.info('  Install: curl -L https://foundry.paradigm.xyz | bash')
        return false
      }

      execa('anvil', ['--port', String(LOCALNET_PORT), '--chain-id', '31337'], {
        cwd: this.rootDir,
        stdio: 'ignore',
        detached: true,
      }).unref()

      for (let i = 0; i < 30; i++) {
        await this.sleep(500)
        if (await this.isLocalnetRunning()) {
          logger.success(`Localnet running on port ${LOCALNET_PORT}`)
          return true
        }
      }

      logger.error('Localnet failed to start')
      return false
    } catch (error) {
      logger.error('Failed to start localnet')
      logger.debug(String(error))
      return false
    }
  }

  async stopLocalnet(): Promise<void> {
    await execa('pkill', ['-f', `anvil.*--port.*${LOCALNET_PORT}`], {
      reject: false,
    })
  }

  async getStatus(): Promise<InfrastructureStatus> {
    const sqlit = await this.isSQLitRunning()
    const docker = await this.isDockerRunning()
    const dockerServices = docker ? await this.checkDockerServices() : []
    const localnet = await this.isLocalnetRunning()

    const sqlitHealth = await this.getSQLitHealth()
    const services = [sqlitHealth, ...dockerServices]

    const allHealthy =
      sqlit && docker && dockerServices.every((s) => s.healthy) && localnet

    return {
      docker,
      sqlit,
      services,
      localnet,
      allHealthy,
    }
  }

  /**
   * Ensure all infrastructure is running
   * Auto-starts what's missing - parallelized for speed
   */
  async ensureRunning(): Promise<boolean> {
    logger.header('INFRASTRUCTURE')
    logger.info('Starting infrastructure in parallel...\n')

    // Check what's already running in parallel
    const [sqlitRunning, dockerInstalled, dockerRunning, localnetRunning] =
      await Promise.all([
        this.isSQLitRunning(),
        this.isDockerInstalled(),
        this.isDockerRunning(),
        this.isLocalnetRunning(),
      ])

    // Fail fast if Docker isn't installed
    if (!dockerInstalled) {
      logger.error('Docker is not installed')
      logger.info('  Install: https://docs.docker.com/get-docker/')
      return false
    }

    // Start independent services in parallel
    const startTasks: Promise<{ name: string; success: boolean }>[] = []

    // SQLit can start independently
    if (!sqlitRunning) {
      startTasks.push(
        this.startSQLit().then((success) => ({ name: 'SQLit', success })),
      )
    } else {
      logger.success(`SQLit already running on port ${SQLIT_PORT}`)
    }

    // Docker + services need to be sequential, but can run parallel to SQLit
    const dockerTask = async (): Promise<{
      name: string
      success: boolean
    }> => {
      // Start Docker if not running
      if (!dockerRunning) {
        const started = await this.startDocker()
        if (!started) {
          return { name: 'Docker', success: false }
        }
      } else {
        logger.success('Docker already running')
      }

      // Now start Docker services
      let dockerServices = await this.checkDockerServices()
      const requiredNames: string[] = Object.entries(DOCKER_SERVICES)
        .filter(([_, config]) => config.required)
        .map(([_, config]) => config.name)
      const unhealthyRequired = dockerServices.filter(
        (s) => !s.healthy && requiredNames.includes(s.name),
      )

      if (unhealthyRequired.length > 0) {
        logger.info(
          `Starting Docker services: ${unhealthyRequired.map((s) => s.name).join(', ')}`,
        )
        const started = await this.startDockerServices()
        if (!started) {
          return { name: 'Docker Services', success: false }
        }
        dockerServices = await this.checkDockerServices()
      } else {
        for (const service of dockerServices) {
          if (service.healthy) {
            logger.success(`${service.name} healthy`)
          }
        }
      }

      // Verify required Docker services are healthy
      const stillUnhealthy = dockerServices.filter(
        (s) => !s.healthy && requiredNames.includes(s.name),
      )
      if (stillUnhealthy.length > 0) {
        logger.error(
          `Services not healthy: ${stillUnhealthy.map((s) => s.name).join(', ')}`,
        )
        return { name: 'Docker Services', success: false }
      }

      return { name: 'Docker', success: true }
    }

    startTasks.push(dockerTask())

    // Localnet can start in parallel with everything else
    if (!localnetRunning) {
      startTasks.push(
        this.startLocalnet().then((success) => ({ name: 'Localnet', success })),
      )
    } else {
      logger.success(`Localnet already running on port ${LOCALNET_PORT}`)
    }

    // Wait for all parallel tasks to complete
    const results = await Promise.all(startTasks)

    // Check all results
    const failures = results.filter((r) => !r.success)
    if (failures.length > 0) {
      logger.error(`Failed to start: ${failures.map((f) => f.name).join(', ')}`)
      return false
    }

    logger.newline()
    logger.success('All infrastructure ready')

    return true
  }

  /**
   * Print status table
   */
  printStatus(status: InfrastructureStatus): void {
    logger.subheader('Infrastructure Status')

    // SQLit first - it's the core database
    logger.table([
      {
        label: 'SQLit (native)',
        value: status.sqlit
          ? `http://${getLocalhostHost()}:${SQLIT_PORT}`
          : 'stopped',
        status: status.sqlit ? 'ok' : 'error',
      },
    ])

    logger.table([
      {
        label: 'Docker',
        value: status.docker ? 'running' : 'stopped',
        status: status.docker ? 'ok' : 'error',
      },
    ])

    // Docker services (SQLit already shown above)
    for (const service of status.services) {
      if (service.name === 'SQLit') continue // Already shown
      logger.table([
        {
          label: service.name,
          value: service.healthy ? service.url : 'not running',
          status: service.healthy ? 'ok' : 'error',
        },
      ])
    }

    logger.table([
      {
        label: 'Localnet',
        value: status.localnet
          ? `http://${getLocalhostHost()}:${LOCALNET_PORT}`
          : 'stopped',
        status: status.localnet ? 'ok' : 'error',
      },
    ])
  }

  /**
   * Get environment variables for running services
   */
  getEnvVars(): Record<string, string> {
    const dwsUrl = getDWSUrl()
    return {
      L2_RPC_URL: getL2RpcUrl(),
      JEJU_RPC_URL: getL2RpcUrl(),
      SQLIT_URL: getSQLitBlockProducerUrl(),
      SQLIT_BLOCK_PRODUCER_ENDPOINT: getSQLitBlockProducerUrl(),
      IPFS_API_URL: getIpfsApiUrl(),
      // Cache and DA are now provided by DWS
      DA_URL: `${dwsUrl}/da`,
      CACHE_URL: `${dwsUrl}/cache`,
      DWS_URL: dwsUrl,
      FARCASTER_HUB_URL: getFarcasterHubUrl(),
      CHAIN_ID: '31337',
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

export function createInfrastructureService(
  rootDir: string,
): InfrastructureService {
  return new InfrastructureService(rootDir)
}
