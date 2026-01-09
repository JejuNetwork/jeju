/**
 * Test orchestrator for infrastructure coordination
 *
 * FAIL-FAST DESIGN:
 * - All infrastructure is mandatory for E2E/integration tests
 * - If any service fails to start, the test run crashes immediately
 * - No skip options for required infrastructure
 * - Smoke tests run before E2E tests to verify testing system works
 * - Contracts MUST be deployed before tests run - verified on-chain
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getL2RpcUrl,
  getServicesConfig,
  getSQLitBlockProducerUrl,
  type NetworkType,
} from '@jejunetwork/config'
import { logger } from '../lib/logger'
import { runSmokeTests } from '../testing/smoke-test-runner'
import type { TestMode } from '../types'
import { AppOrchestrator } from './app-orchestrator'
import { DockerOrchestrator, type TestProfile } from './docker-orchestrator'
import { InfrastructureService } from './infrastructure'
import { LocalnetOrchestrator } from './localnet-orchestrator'

export interface TestOrchestratorOptions {
  mode: TestMode
  app?: string
  /** Skip test lock acquisition (use with caution) */
  skipLock?: boolean
  /** Keep services running after tests complete */
  keepServices?: boolean
  /** Force override existing test lock */
  force?: boolean
  /** Root directory of the monorepo */
  rootDir: string
  /** Run in headless mode (default: true in CI) */
  headless?: boolean
  /** Skip smoke tests (not recommended) */
  skipSmokeTests?: boolean
  /** Target network: localnet, testnet, mainnet */
  network?: 'localnet' | 'testnet' | 'mainnet'
}

const MODE_TO_PROFILE: Record<TestMode, TestProfile> = {
  unit: 'chain',
  integration: 'services',
  e2e: 'apps',
  full: 'full',
  infra: 'services',
  smoke: 'chain',
}

const MODE_NEEDS_LOCALNET: Record<TestMode, boolean> = {
  unit: false,
  integration: true,
  e2e: true,
  full: true,
  infra: false,
  smoke: false,
}

const MODE_NEEDS_DOCKER: Record<TestMode, boolean> = {
  unit: false,
  integration: true,
  e2e: true,
  full: true,
  infra: true,
  smoke: false,
}

const MODE_NEEDS_APPS: Record<TestMode, boolean> = {
  unit: false,
  integration: false,
  e2e: true,
  full: true,
  infra: false,
  smoke: false,
}

export class TestOrchestrator {
  private options: TestOrchestratorOptions
  private infrastructureService: InfrastructureService
  private lockManager: {
    acquireLock: () => { acquired: boolean; message?: string }
    releaseLock: () => boolean
  } | null = null
  private localnetOrchestrator: LocalnetOrchestrator | null = null
  private dockerOrchestrator: DockerOrchestrator | null = null
  private appOrchestrator: AppOrchestrator | null = null
  private setupComplete: boolean = false
  private contractsVerified: boolean = false

  constructor(options: TestOrchestratorOptions) {
    this.options = options
    this.infrastructureService = new InfrastructureService(options.rootDir)
  }

  /**
   * Verify contracts are deployed on-chain - REQUIRED for integration/e2e/full tests
   * This is a HARD check - throws if contracts aren't deployed
   */
  private async verifyContractsDeployed(): Promise<void> {
    const bootstrapFile = join(
      this.options.rootDir,
      'packages/contracts/deployments/localnet-complete.json',
    )

    // Check 1: Bootstrap file must exist
    if (!existsSync(bootstrapFile)) {
      throw new Error(
        'FATAL: Contracts not deployed - bootstrap file not found.\n\n' +
          `Expected: ${bootstrapFile}\n\n` +
          'The test orchestrator requires contracts to be deployed.\n' +
          'Run: bun run jeju dev (which bootstraps contracts automatically)',
      )
    }

    // Check 2: Bootstrap file must have valid contracts
    const data = JSON.parse(readFileSync(bootstrapFile, 'utf-8'))
    const contracts = data?.contracts
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

    if (
      !contracts ||
      !contracts.jnsRegistry ||
      contracts.jnsRegistry === ZERO_ADDRESS
    ) {
      throw new Error(
        'FATAL: Contracts not deployed - JNS Registry not found in bootstrap file.\n\n' +
          'The bootstrap file exists but contracts are not properly configured.\n' +
          'Run: bun run jeju dev',
      )
    }

    // Check 3: Verify at least one contract is actually on-chain
    const rpcUrl = getL2RpcUrl()
    const contractAddress = contracts.jnsRegistry as string

    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getCode',
          params: [contractAddress, 'latest'],
          id: 1,
        }),
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) {
        throw new Error(`RPC request failed: ${response.status}`)
      }

      const result = await response.json()
      const code = result.result as string

      if (!code || code === '0x' || code.length < 4) {
        throw new Error(
          'FATAL: Contracts not deployed on-chain.\n\n' +
            `JNS Registry at ${contractAddress} has no code.\n` +
            'This usually means the chain was reset without re-deploying contracts.\n\n' +
            'Run: bun run jeju dev (or use --no-bootstrap if contracts are known good)',
        )
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('FATAL:')) {
        throw error
      }
      throw new Error(
        'FATAL: Cannot verify contracts on-chain.\n\n' +
          `RPC: ${rpcUrl}\n` +
          `Error: ${error instanceof Error ? error.message : String(error)}\n\n` +
          'Make sure the chain is running: bun run jeju dev',
      )
    }

    this.contractsVerified = true
    logger.success('Contracts verified on-chain')
  }

  async setup(): Promise<void> {
    if (this.setupComplete) {
      logger.debug('Setup already complete')
      return
    }

    const network = this.options.network ?? 'localnet'
    const isRemoteNetwork = network !== 'localnet'

    logger.header(`TEST SETUP - ${this.options.mode.toUpperCase()}`)

    // Remote network mode: skip all local infrastructure
    if (isRemoteNetwork) {
      logger.info(`Remote network mode: ${network}`)
      logger.info(
        'Skipping local infrastructure - testing against deployed services',
      )

      // Verify remote services are accessible
      await this.verifyRemoteServices(network)

      this.setupComplete = true
      logger.newline()
      logger.success(`Remote test setup complete - targeting ${network}`)
      return
    }

    // Local network mode: start all required infrastructure

    // Step 1: Start SQLit (required for all tests)
    logger.step('Starting SQLit (core database)...')
    const sqlitStarted = await this.infrastructureService.startSQLit()
    if (!sqlitStarted) {
      throw new Error(
        'FATAL: Failed to start SQLit. SQLit is required for all tests. ' +
          'Check packages/db for errors.',
      )
    }

    // Step 2: Acquire test lock
    if (!this.options.skipLock) {
      logger.step('Acquiring test lock...')
      type LockManagerModule = {
        LockManager: new (opts: {
          force?: boolean
        }) => {
          acquireLock: () => { acquired: boolean; message?: string }
          releaseLock: () => boolean
        }
      }
      const lockModule = (await import('@jejunetwork/tests/lock-manager').catch(
        () => null,
      )) as LockManagerModule | null

      if (lockModule) {
        this.lockManager = new lockModule.LockManager({
          force: this.options.force,
        })
        const lockResult = this.lockManager.acquireLock()

        if (!lockResult.acquired) {
          throw new Error(
            `FATAL: ${lockResult.message || 'Failed to acquire test lock. Another test may be running.'}`,
          )
        }
        logger.success('Lock acquired')
      }
    }

    // Step 3: Start localnet (REQUIRED for integration/e2e/full)
    if (MODE_NEEDS_LOCALNET[this.options.mode]) {
      logger.step('Starting localnet (Anvil)...')
      this.localnetOrchestrator = new LocalnetOrchestrator(this.options.rootDir)
      await this.localnetOrchestrator.start()

      const ready = await this.localnetOrchestrator.waitForReady(60000)
      if (!ready) {
        throw new Error(
          'FATAL: Localnet (Anvil) failed to become ready within 60 seconds. ' +
            'Check that anvil is installed: curl -L https://foundry.paradigm.xyz | bash',
        )
      }

      // Bootstrap contracts (REQUIRED - no skip option)
      logger.step('Bootstrapping contracts...')
      await this.localnetOrchestrator.bootstrap()

      // CRITICAL: Verify contracts are actually deployed on-chain
      // This catches cases where bootstrap ran but chain was reset
      logger.step('Verifying contracts on-chain...')
      await this.verifyContractsDeployed()
    }

    // Step 4: Start Docker services (REQUIRED for integration/e2e/full/infra)
    if (MODE_NEEDS_DOCKER[this.options.mode]) {
      logger.step('Starting Docker services...')
      const profile = MODE_TO_PROFILE[this.options.mode]
      this.dockerOrchestrator = new DockerOrchestrator(this.options.rootDir, {
        profile,
      })
      await this.dockerOrchestrator.start()

      const statuses = await this.dockerOrchestrator.status()
      const unhealthy = statuses.filter((s) => !s.healthy)
      if (unhealthy.length > 0) {
        throw new Error(
          'FATAL: Docker services failed to start: ' +
            unhealthy.map((s) => s.name).join(', '),
        )
      }
      this.dockerOrchestrator.printStatus(statuses)
    }

    // Step 5: Start apps (REQUIRED for e2e/full)
    if (MODE_NEEDS_APPS[this.options.mode]) {
      logger.step('Starting apps...')
      const serviceEnv = this.getServiceEnv()
      this.appOrchestrator = new AppOrchestrator(
        this.options.rootDir,
        serviceEnv,
      )

      await this.appOrchestrator.start({
        apps: this.options.app ? [this.options.app] : undefined,
      })

      // Warmup apps (REQUIRED - ensures apps are actually ready)
      logger.step('Warming up apps...')
      await this.appOrchestrator.warmup({
        apps: this.options.app ? [this.options.app] : undefined,
      })
    }

    // Step 6: Run preflight checks (REQUIRED for modes that need chain)
    if (MODE_NEEDS_LOCALNET[this.options.mode]) {
      logger.step('Running preflight checks...')
      const envVars = this.getEnvVars()
      const rpcUrl = envVars.L2_RPC_URL ?? envVars.JEJU_RPC_URL
      if (!rpcUrl) {
        throw new Error(
          'FATAL: No RPC URL available. Localnet did not start properly.',
        )
      }
      const chainId = envVars.CHAIN_ID
      if (!chainId) {
        throw new Error('FATAL: No CHAIN_ID available.')
      }
      type PreflightModule = {
        runPreflightChecks: (opts: {
          rpcUrl: string
          chainId: number
        }) => Promise<{ success: boolean }>
      }
      const preflightModule = (await import(
        '@jejunetwork/tests/preflight'
      ).catch(() => null)) as PreflightModule | null

      if (preflightModule) {
        const preflightResult = await preflightModule.runPreflightChecks({
          rpcUrl,
          chainId: parseInt(chainId, 10),
        })

        if (!preflightResult.success) {
          throw new Error(
            'FATAL: Preflight checks failed. Chain is not ready for tests.',
          )
        }
        logger.success('Preflight checks passed')
      }
    }

    // Step 7: Run smoke tests for E2E mode (REQUIRED unless skipped)
    if (this.options.mode === 'e2e' && !this.options.skipSmokeTests) {
      logger.newline()
      const smokeResult = await runSmokeTests({
        rootDir: this.options.rootDir,
        headless: this.options.headless ?? !!process.env.CI,
        skipAIVerification: false,
      })

      if (!smokeResult.passed) {
        throw new Error(
          'FATAL: Smoke tests failed. E2E testing infrastructure is not working properly. ' +
            'Errors: ' +
            smokeResult.errors.join(', '),
        )
      }
    }

    this.setupComplete = true
    logger.newline()
    logger.success('Test setup complete - all infrastructure verified')
  }

  async teardown(): Promise<void> {
    if (!this.setupComplete && !this.options.keepServices) {
      return
    }

    logger.step('Tearing down test infrastructure...')

    if (this.appOrchestrator && !this.options.keepServices) {
      await this.appOrchestrator.stop()
    }

    if (this.dockerOrchestrator && !this.options.keepServices) {
      await this.dockerOrchestrator.stop()
    }

    if (this.localnetOrchestrator && !this.options.keepServices) {
      await this.localnetOrchestrator.stop()
    }

    if (!this.options.keepServices) {
      await this.infrastructureService.stopSQLit()
    }

    if (this.lockManager) {
      this.lockManager.releaseLock()
    }

    this.setupComplete = false
    logger.success('Teardown complete')
  }

  getEnvVars(): Record<string, string> {
    const network = this.options.network ?? 'localnet'
    const isRemoteNetwork = network !== 'localnet'
    const services = getServicesConfig(network)

    // All infrastructure is verified during setup - no skip conditions needed
    // Tests can assume all services are available when orchestrator is used
    const env: Record<string, string> = {
      NODE_ENV: 'test',
      CI: process.env.CI || '',
      JEJU_NETWORK: network,
      // RPC and chain configuration from services.json
      RPC_URL: services.rpc.l2,
      JEJU_RPC_URL: services.rpc.l2,
      L2_RPC_URL: services.rpc.l2,
      L1_RPC_URL: services.rpc.l1,
      WS_URL: services.rpc.ws,
      CHAIN_ID:
        network === 'localnet'
          ? '31337'
          : network === 'testnet'
            ? '420690'
            : '420691',
      // Service URLs for the target network
      INDEXER_URL: services.indexer.graphql,
      EXPLORER_URL: services.explorer,
      DWS_URL: services.dws.api,
      DWS_API_URL: services.dws.api,
      GATEWAY_URL: services.gateway.api,
      GATEWAY_UI_URL: services.gateway.ui,
      BAZAAR_URL: services.bazaar,
      AUTOCRAT_URL: services.autocrat.api,
      CRUCIBLE_URL: services.crucible.api,
      FACTORY_URL: services.factory.api,
      SQLIT_URL: isRemoteNetwork
        ? services.sqlit.blockProducer
        : getSQLitBlockProducerUrl(),
      // Skip local webserver when testing remote
      SKIP_WEBSERVER: isRemoteNetwork ? '1' : '',
      // Infrastructure flags
      INFRA_READY: 'true',
      SQLIT_AVAILABLE: 'true',
      ANVIL_AVAILABLE: this.localnetOrchestrator ? 'true' : 'false',
      DOCKER_AVAILABLE: this.dockerOrchestrator ? 'true' : 'false',
      IPFS_AVAILABLE: this.dockerOrchestrator ? 'true' : 'false',
      // CONTRACTS_VERIFIED means we've verified contracts on-chain, not just file exists
      CONTRACTS_VERIFIED:
        this.contractsVerified || isRemoteNetwork ? 'true' : 'false',
      CONTRACTS_DEPLOYED:
        this.contractsVerified || isRemoteNetwork ? 'true' : 'false',
    }

    // Local network - add local infrastructure env vars
    if (!isRemoteNetwork) {
      Object.assign(env, this.infrastructureService.getEnvVars())

      if (this.localnetOrchestrator) {
        Object.assign(env, this.localnetOrchestrator.getEnvVars())
      }

      if (this.dockerOrchestrator) {
        Object.assign(env, this.dockerOrchestrator.getEnvVars())
      }

      if (this.appOrchestrator) {
        Object.assign(env, this.appOrchestrator.getEnvVars())
      }
    }

    return env
  }

  private getServiceEnv(): Record<string, string> {
    const env: Record<string, string> = {}

    if (this.localnetOrchestrator) {
      Object.assign(env, this.localnetOrchestrator.getEnvVars())
    }

    if (this.dockerOrchestrator) {
      Object.assign(env, this.dockerOrchestrator.getEnvVars())
    }

    return env
  }

  /**
   * Verify remote services are accessible before running tests
   */
  private async verifyRemoteServices(network: NetworkType): Promise<void> {
    logger.step('Verifying remote services are accessible...')

    const services = getServicesConfig(network)

    // Check RPC is accessible
    const rpcHealthy = await this.checkRpcHealth(services.rpc.l2)
    if (!rpcHealthy) {
      throw new Error(
        `FATAL: RPC not accessible for ${network}: ${services.rpc.l2}\n` +
          'Make sure the chain is running and accessible.',
      )
    }
    logger.success(`RPC accessible: ${services.rpc.l2}`)

    // Check DWS API is accessible
    const dwsHealthy = await this.checkHttpHealth(`${services.dws.api}/health`)
    if (!dwsHealthy) {
      logger.warn(
        `DWS API not accessible: ${services.dws.api} (some tests may fail)`,
      )
    } else {
      logger.success(`DWS API accessible: ${services.dws.api}`)
    }

    // Check Indexer is accessible
    if (services.indexer.api) {
      const indexerHealthy = await this.checkHttpHealth(services.indexer.api)
      if (!indexerHealthy) {
        logger.warn(
          `Indexer not accessible: ${services.indexer.api} (some tests may fail)`,
        )
      } else {
        logger.success(`Indexer accessible: ${services.indexer.api}`)
      }
    } else {
      logger.warn('Indexer API URL not configured (some tests may fail)')
    }

    logger.success(`Remote services verified for ${network}`)
  }

  /**
   * Check if an RPC endpoint is healthy
   */
  private async checkRpcHealth(rpcUrl: string): Promise<boolean> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
      signal: controller.signal,
    })
      .catch(() => null)
      .finally(() => clearTimeout(timeoutId))

    if (!response?.ok) return false

    const data = (await response.json().catch(() => null)) as {
      result?: string
      error?: unknown
    } | null
    return Boolean(data?.result && !data?.error)
  }

  /**
   * Check if an HTTP endpoint is healthy
   */
  private async checkHttpHealth(url: string): Promise<boolean> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    })
      .catch(() => null)
      .finally(() => clearTimeout(timeoutId))

    return Boolean(response?.ok || (response && response.status < 500))
  }

  isSetup(): boolean {
    return this.setupComplete
  }
}

export function createTestOrchestrator(
  options: TestOrchestratorOptions,
): TestOrchestrator {
  return new TestOrchestrator(options)
}
