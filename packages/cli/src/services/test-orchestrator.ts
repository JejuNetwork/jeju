/**
 * Test orchestrator for infrastructure coordination
 *
 * FAIL-FAST DESIGN:
 * - All infrastructure is mandatory for E2E/integration tests
 * - If any service fails to start, the test run crashes immediately
 * - No skip options for required infrastructure
 * - Smoke tests run before E2E tests to verify testing system works
 */

import { getEQLiteBlockProducerUrl } from '@jejunetwork/config'
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

  constructor(options: TestOrchestratorOptions) {
    this.options = options
    this.infrastructureService = new InfrastructureService(options.rootDir)
  }

  async setup(): Promise<void> {
    if (this.setupComplete) {
      logger.debug('Setup already complete')
      return
    }

    logger.header(`TEST SETUP - ${this.options.mode.toUpperCase()}`)

    // Step 1: Start EQLite (required for all tests)
    logger.step('Starting EQLite (core database)...')
    const eqliteStarted = await this.infrastructureService.startEQLite()
    if (!eqliteStarted) {
      throw new Error(
        'FATAL: Failed to start EQLite. EQLite is required for all tests. ' +
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
      logger.success('Contracts deployed')
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
      await this.infrastructureService.stopEQLite()
    }

    if (this.lockManager) {
      this.lockManager.releaseLock()
    }

    this.setupComplete = false
    logger.success('Teardown complete')
  }

  getEnvVars(): Record<string, string> {
    // All infrastructure is verified during setup - no skip conditions needed
    // Tests can assume all services are available when orchestrator is used
    const env: Record<string, string> = {
      NODE_ENV: 'test',
      CI: process.env.CI || '',
      EQLITE_URL: getEQLiteBlockProducerUrl(),
      // Infrastructure is ALWAYS available when using the test orchestrator
      // Tests should NOT check these - if setup passed, everything is ready
      INFRA_READY: 'true',
      EQLITE_AVAILABLE: 'true',
      ANVIL_AVAILABLE: this.localnetOrchestrator ? 'true' : 'false',
      DOCKER_AVAILABLE: this.dockerOrchestrator ? 'true' : 'false',
      IPFS_AVAILABLE: this.dockerOrchestrator ? 'true' : 'false',
    }

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

  isSetup(): boolean {
    return this.setupComplete
  }
}

export function createTestOrchestrator(
  options: TestOrchestratorOptions,
): TestOrchestrator {
  return new TestOrchestrator(options)
}
