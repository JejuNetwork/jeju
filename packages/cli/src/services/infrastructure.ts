/** Infrastructure service for Jeju development */

import { existsSync } from 'node:fs'
import { platform } from 'node:os'
import { join } from 'node:path'
import {
  CORE_PORTS,
  getDWSUrl,
  getFarcasterHubUrl,
  getIpfsApiUrl,
  getL2RpcUrl,
  getLocalhostHost,
  getSQLitBlockProducerUrl,
  INFRA_PORTS,
} from '@jejunetwork/config'
import { execa, type ResultPromise } from 'execa'
import { logger } from '../lib/logger'
import { DEFAULT_PORTS } from '../types'

// ERC-4337 Bundler port
const BUNDLER_PORT = 4337

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
  l1: boolean
  l2: boolean
  localnet: boolean
  bundler: boolean
  messageRelay: boolean
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

const L1_PORT = DEFAULT_PORTS.l1Rpc // 6545
const L2_PORT = DEFAULT_PORTS.l2Rpc // 6546
const L1_CHAIN_ID = 1337
const L2_CHAIN_ID = 31337

let sqlitProcess: ResultPromise | null = null
let bundlerProcess: ResultPromise | null = null
let messageRelayProcess: ResultPromise | null = null

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

    // Fall back to SQLite-based SQLit server
    logger.step('Starting SQLit server...')

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
        logger.success(`SQLit server running on port ${SQLIT_PORT}`)
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

    await this.stopMessageRelay()
    logger.success('Message relay stopped')

    await this.stopBundler()
    logger.success('Bundler stopped')

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

  async isL1Running(): Promise<boolean> {
    try {
      const response = await fetch(`http://${getLocalhostHost()}:${L1_PORT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: [],
          id: 1,
        }),
        signal: AbortSignal.timeout(2000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  async isL2Running(): Promise<boolean> {
    try {
      const response = await fetch(`http://${getLocalhostHost()}:${L2_PORT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: [],
          id: 1,
        }),
        signal: AbortSignal.timeout(2000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  async isLocalnetRunning(): Promise<boolean> {
    // Both L1 and L2 must be running
    const [l1, l2] = await Promise.all([this.isL1Running(), this.isL2Running()])
    return l1 && l2
  }

  async isBundlerRunning(): Promise<boolean> {
    try {
      // Stackup bundler doesn't have /health, use RPC method instead
      const response = await fetch(
        `http://${getLocalhostHost()}:${BUNDLER_PORT}/`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_supportedEntryPoints',
            params: [],
            id: 1,
          }),
          signal: AbortSignal.timeout(2000),
        },
      )
      if (!response.ok) return false
      const data = await response.json()
      return Array.isArray(data.result)
    } catch {
      return false
    }
  }

  async startBundler(): Promise<boolean> {
    if (await this.isBundlerRunning()) {
      logger.success('Bundler already running')
      return true
    }

    logger.step('Starting ERC-4337 bundler...')

    const bundlerScript = join(
      this.rootDir,
      'packages/deployment/scripts/bundler/index.ts',
    )
    if (!existsSync(bundlerScript)) {
      logger.error(
        'Bundler script not found at packages/deployment/scripts/bundler/index.ts',
      )
      return false
    }

    // Try to read EntryPoint address from deployment file
    let entryPointAddress: string | undefined
    const deploymentFile = join(
      this.rootDir,
      'packages/contracts/deployments/localnet-complete.json',
    )
    if (existsSync(deploymentFile)) {
      try {
        const { readFileSync } = await import('node:fs')
        const deployment = JSON.parse(readFileSync(deploymentFile, 'utf-8'))
        if (deployment?.contracts?.entryPoint) {
          entryPointAddress = deployment.contracts.entryPoint
          logger.debug(`Using EntryPoint from deployment: ${entryPointAddress}`)
        }
      } catch {
        // Use default
      }
    }

    bundlerProcess = execa('bun', ['run', bundlerScript], {
      cwd: this.rootDir,
      env: {
        ...process.env,
        BUNDLER_PORT: String(BUNDLER_PORT),
        BUNDLER_NETWORK: 'localnet',
        JEJU_RPC_URL: getL2RpcUrl(),
        ...(entryPointAddress
          ? { ENTRY_POINT_ADDRESS: entryPointAddress }
          : {}),
      },
      stdio: 'pipe',
    })

    // Wait for bundler to start
    for (let i = 0; i < 30; i++) {
      await this.sleep(500)
      if (await this.isBundlerRunning()) {
        logger.success(`Bundler running on port ${BUNDLER_PORT}`)
        return true
      }
    }

    logger.error('Bundler failed to start within 15 seconds')
    return false
  }

  async stopBundler(): Promise<void> {
    if (bundlerProcess) {
      bundlerProcess.kill('SIGTERM')
      bundlerProcess = null
    }
  }

  async startLocalnet(): Promise<boolean> {
    logger.step('Starting dual-chain localnet (L1 + L2)...')

    try {
      const { exitCode } = await execa('which', ['anvil'], { reject: false })
      if (exitCode !== 0) {
        logger.error('Anvil not found')
        logger.info('  Install: curl -L https://foundry.paradigm.xyz | bash')
        return false
      }

      // Start L1 if not running
      if (!(await this.isL1Running())) {
        execa(
          'anvil',
          ['--port', String(L1_PORT), '--chain-id', String(L1_CHAIN_ID)],
          {
            cwd: this.rootDir,
            stdio: 'ignore',
            detached: true,
          },
        ).unref()
        logger.debug(`Starting L1 on port ${L1_PORT} (chain ${L1_CHAIN_ID})`)
      }

      // Start L2 if not running
      if (!(await this.isL2Running())) {
        execa(
          'anvil',
          ['--port', String(L2_PORT), '--chain-id', String(L2_CHAIN_ID)],
          {
            cwd: this.rootDir,
            stdio: 'ignore',
            detached: true,
          },
        ).unref()
        logger.debug(`Starting L2 on port ${L2_PORT} (chain ${L2_CHAIN_ID})`)
      }

      // Wait for both to be ready
      for (let i = 0; i < 30; i++) {
        await this.sleep(500)
        const [l1Ready, l2Ready] = await Promise.all([
          this.isL1Running(),
          this.isL2Running(),
        ])
        if (l1Ready && l2Ready) {
          logger.success(`L1 running on port ${L1_PORT} (chain ${L1_CHAIN_ID})`)
          logger.success(`L2 running on port ${L2_PORT} (chain ${L2_CHAIN_ID})`)
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

  async startMessageRelay(): Promise<boolean> {
    logger.step('Starting cross-chain message relay...')

    const relayScript = join(
      this.rootDir,
      'packages/deployment/scripts/bridge/message-relay.ts',
    )
    if (!existsSync(relayScript)) {
      logger.warn(
        'Message relay script not found - cross-chain messaging disabled',
      )
      return false
    }

    // Check if deployment file exists with messenger addresses
    const deploymentFile = join(
      this.rootDir,
      'packages/contracts/deployments/localnet-crosschain.json',
    )

    if (!existsSync(deploymentFile)) {
      logger.debug('Cross-chain deployment not found, skipping relay')
      return false
    }

    try {
      const { readFileSync } = await import('node:fs')
      const deployment = JSON.parse(readFileSync(deploymentFile, 'utf-8'))

      if (!deployment.l1Messenger || !deployment.l2Messenger) {
        logger.debug('Messenger addresses not found, skipping relay')
        return false
      }

      messageRelayProcess = execa('bun', ['run', relayScript], {
        cwd: this.rootDir,
        env: {
          ...process.env,
          L1_RPC_URL: `http://${getLocalhostHost()}:${L1_PORT}`,
          L2_RPC_URL: `http://${getLocalhostHost()}:${L2_PORT}`,
          L1_CHAIN_ID: String(L1_CHAIN_ID),
          L2_CHAIN_ID: String(L2_CHAIN_ID),
          L1_MESSENGER_ADDRESS: deployment.l1Messenger,
          L2_MESSENGER_ADDRESS: deployment.l2Messenger,
        },
        stdio: 'pipe',
      })

      // Give it a moment to start
      await this.sleep(1000)
      logger.success('Message relay running')
      return true
    } catch (error) {
      logger.warn('Failed to start message relay')
      logger.debug(String(error))
      return false
    }
  }

  async stopMessageRelay(): Promise<void> {
    if (messageRelayProcess) {
      messageRelayProcess.kill('SIGTERM')
      messageRelayProcess = null
    }
  }

  async stopLocalnet(): Promise<void> {
    // Stop both L1 and L2
    await execa('pkill', ['-f', `anvil.*--port.*${L1_PORT}`], {
      reject: false,
    })
    await execa('pkill', ['-f', `anvil.*--port.*${L2_PORT}`], {
      reject: false,
    })
  }

  async getStatus(): Promise<InfrastructureStatus> {
    const sqlit = await this.isSQLitRunning()
    const docker = await this.isDockerRunning()
    const dockerServices = docker ? await this.checkDockerServices() : []
    const l1 = await this.isL1Running()
    const l2 = await this.isL2Running()
    const localnet = l1 && l2
    const bundler = await this.isBundlerRunning()
    const messageRelay = messageRelayProcess !== null

    const sqlitHealth = await this.getSQLitHealth()
    const services = [sqlitHealth, ...dockerServices]

    const allHealthy =
      sqlit && docker && dockerServices.every((s) => s.healthy) && localnet

    return {
      docker,
      sqlit,
      services,
      l1,
      l2,
      localnet,
      bundler,
      messageRelay,
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
      logger.success('Localnet already running (L1 + L2)')
    }

    // Wait for all parallel tasks to complete
    const results = await Promise.all(startTasks)

    // Start bundler after localnet is up (needs chain connection)
    const bundlerRunning = await this.isBundlerRunning()
    if (!bundlerRunning) {
      const bundlerSuccess = await this.startBundler()
      if (!bundlerSuccess) {
        logger.warn(
          'Bundler failed to start - gasless transactions unavailable',
        )
      }
    } else {
      logger.success(`Bundler already running on port ${BUNDLER_PORT}`)
    }

    // Start message relay for cross-chain communication
    if (messageRelayProcess === null) {
      await this.startMessageRelay()
    }

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
        label: 'L1 Chain',
        value: status.l1
          ? `http://${getLocalhostHost()}:${L1_PORT} (chain ${L1_CHAIN_ID})`
          : 'stopped',
        status: status.l1 ? 'ok' : 'error',
      },
    ])

    logger.table([
      {
        label: 'L2 Chain',
        value: status.l2
          ? `http://${getLocalhostHost()}:${L2_PORT} (chain ${L2_CHAIN_ID})`
          : 'stopped',
        status: status.l2 ? 'ok' : 'error',
      },
    ])

    logger.table([
      {
        label: 'Bundler (ERC-4337)',
        value: status.bundler
          ? `http://${getLocalhostHost()}:${BUNDLER_PORT}`
          : 'stopped',
        status: status.bundler ? 'ok' : 'warn',
      },
    ])

    logger.table([
      {
        label: 'Message Relay',
        value: status.messageRelay ? 'running' : 'stopped',
        status: status.messageRelay ? 'ok' : 'warn',
      },
    ])
  }

  /**
   * Get environment variables for running services
   */
  getEnvVars(): Record<string, string> {
    const dwsUrl = getDWSUrl()
    const localhost = getLocalhostHost()
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
      // ERC-4337 bundler (v0.7 EntryPoint deployed by bootstrap)
      BUNDLER_URL: `http://${localhost}:${BUNDLER_PORT}`,
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
