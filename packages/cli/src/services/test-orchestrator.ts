/** Test orchestrator for infrastructure coordination */

import { getCQLBlockProducerUrl } from '@jejunetwork/config'
import { logger } from '../lib/logger'
import type { TestMode } from '../types'
import { AppOrchestrator } from './app-orchestrator'
import { DockerOrchestrator, type TestProfile } from './docker-orchestrator'
import { InfrastructureService } from './infrastructure'
import { LocalnetOrchestrator } from './localnet-orchestrator'

export interface TestOrchestratorOptions {
  mode: TestMode
  app?: string
  skipLock?: boolean
  skipPreflight?: boolean
  skipWarmup?: boolean
  skipBootstrap?: boolean
  keepServices?: boolean
  force?: boolean
  rootDir: string
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

    logger.step('Starting CQL (core database)...')
    const cqlStarted = await this.infrastructureService.startCQL()
    if (!cqlStarted) {
      throw new Error('Failed to start CQL - required for all tests')
    }

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
          throw new Error(lockResult.message || 'Failed to acquire test lock')
        }
        logger.success('Lock acquired')
      } else {
        logger.warn('Lock manager not available')
        logger.warn(
          'Continuing without lock - concurrent test runs may conflict',
        )
      }
    }

    if (MODE_NEEDS_LOCALNET[this.options.mode]) {
      logger.step('Starting localnet...')
      this.localnetOrchestrator = new LocalnetOrchestrator(this.options.rootDir)
      await this.localnetOrchestrator.start()

      const ready = await this.localnetOrchestrator.waitForReady(60000)
      if (!ready) {
        throw new Error('Localnet failed to become ready')
      }

      if (!this.options.skipBootstrap) {
        await this.localnetOrchestrator.bootstrap()
      }
    }

    if (MODE_NEEDS_DOCKER[this.options.mode]) {
      logger.step('Starting Docker services...')
      const profile = MODE_TO_PROFILE[this.options.mode]
      this.dockerOrchestrator = new DockerOrchestrator(this.options.rootDir, {
        profile,
      })
      await this.dockerOrchestrator.start()

      const statuses = await this.dockerOrchestrator.status()
      this.dockerOrchestrator.printStatus(statuses)
    }

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

      if (!this.options.skipWarmup) {
        await this.appOrchestrator.warmup({
          apps: this.options.app ? [this.options.app] : undefined,
        })
      }
    }

    if (!this.options.skipPreflight && MODE_NEEDS_LOCALNET[this.options.mode]) {
      logger.step('Running preflight checks...')
      const envVars = this.getEnvVars()
      const rpcUrl = envVars.L2_RPC_URL ?? envVars.JEJU_RPC_URL
      if (!rpcUrl) {
        throw new Error(
          'No RPC URL available for preflight checks. Localnet may not have started properly.',
        )
      }
      const chainId = envVars.CHAIN_ID
      if (!chainId) {
        throw new Error('No CHAIN_ID available for preflight checks.')
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
          throw new Error('Preflight checks failed')
        }
        logger.success('Preflight checks passed')
      } else {
        logger.warn('Preflight module not available, skipping checks')
      }
    }

    this.setupComplete = true
    logger.success('Test setup complete')
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
      await this.infrastructureService.stopCQL()
    }

    if (this.lockManager) {
      this.lockManager.releaseLock()
    }

    this.setupComplete = false
    logger.success('Teardown complete')
  }

  getEnvVars(): Record<string, string> {
    const env: Record<string, string> = {
      NODE_ENV: 'test',
      CI: process.env.CI || '',
      CQL_URL: getCQLBlockProducerUrl(),
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
