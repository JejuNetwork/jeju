/**
 * Test Orchestrator
 * 
 * Coordinates all test infrastructure:
 * - Test locking
 * - Localnet startup/teardown
 * - Docker services
 * - App orchestration
 * - Preflight checks
 * - App warmup
 */

import { logger } from '../lib/logger';
import { LocalnetOrchestrator } from './localnet-orchestrator';
import { DockerOrchestrator, type TestProfile } from './docker-orchestrator';
import { AppOrchestrator } from './app-orchestrator';
import type { TestMode } from '../types';

export interface TestOrchestratorOptions {
  mode: TestMode;
  app?: string;
  skipLock?: boolean;
  skipPreflight?: boolean;
  skipWarmup?: boolean;
  skipBootstrap?: boolean;
  keepServices?: boolean;
  force?: boolean;
  rootDir: string;
}

const MODE_TO_PROFILE: Record<TestMode, TestProfile> = {
  unit: 'chain',
  integration: 'services',
  e2e: 'apps',
  full: 'full',
  infra: 'services',
  smoke: 'chain',
};

const MODE_NEEDS_LOCALNET: Record<TestMode, boolean> = {
  unit: false,
  integration: true,
  e2e: true,
  full: true,
  infra: false,
  smoke: false,
};

const MODE_NEEDS_DOCKER: Record<TestMode, boolean> = {
  unit: false,
  integration: true,
  e2e: true,
  full: true,
  infra: true,
  smoke: false,
};

const MODE_NEEDS_APPS: Record<TestMode, boolean> = {
  unit: false,
  integration: false,
  e2e: true,
  full: true,
  infra: false,
  smoke: false,
};

export class TestOrchestrator {
  private options: TestOrchestratorOptions;
  private lockManager: { releaseLock: () => boolean } | null = null;
  private localnetOrchestrator: LocalnetOrchestrator | null = null;
  private dockerOrchestrator: DockerOrchestrator | null = null;
  private appOrchestrator: AppOrchestrator | null = null;
  private setupComplete: boolean = false;

  constructor(options: TestOrchestratorOptions) {
    this.options = options;
  }

  async setup(): Promise<void> {
    if (this.setupComplete) {
      logger.debug('Setup already complete');
      return;
    }

    logger.header(`TEST SETUP - ${this.options.mode.toUpperCase()}`);

    // Step 1: Acquire lock
    if (!this.options.skipLock) {
      try {
        logger.step('Acquiring test lock...');
        const { LockManager } = await import('@jejunetwork/tests/lock-manager');
        this.lockManager = new LockManager({ force: this.options.force });
        const lockResult = this.lockManager.acquireLock();
        
        if (!lockResult.acquired) {
          throw new Error(lockResult.message || 'Failed to acquire test lock');
        }
        logger.success('Lock acquired');
      } catch (error) {
        logger.warn(`Lock manager not available: ${error instanceof Error ? error.message : String(error)}`);
        logger.warn('Continuing without lock - concurrent test runs may conflict');
      }
    }

    // Step 2: Start localnet (if needed)
    if (MODE_NEEDS_LOCALNET[this.options.mode]) {
      logger.step('Starting localnet...');
      this.localnetOrchestrator = new LocalnetOrchestrator(this.options.rootDir);
      await this.localnetOrchestrator.start();
      
      // Wait for chain to be ready
      const ready = await this.localnetOrchestrator.waitForReady(60000);
      if (!ready) {
        throw new Error('Localnet failed to become ready');
      }

      // Bootstrap contracts (if needed)
      if (!this.options.skipBootstrap) {
        await this.localnetOrchestrator.bootstrap();
      }
    }

    // Step 3: Start Docker services (if needed)
    if (MODE_NEEDS_DOCKER[this.options.mode]) {
      logger.step('Starting Docker services...');
      const profile = MODE_TO_PROFILE[this.options.mode];
      this.dockerOrchestrator = new DockerOrchestrator(this.options.rootDir, { profile });
      await this.dockerOrchestrator.start();
      
      const statuses = await this.dockerOrchestrator.status();
      this.dockerOrchestrator.printStatus(statuses);
    }

    // Step 4: Start apps (if E2E mode)
    if (MODE_NEEDS_APPS[this.options.mode]) {
      logger.step('Starting apps...');
      const serviceEnv = this.getServiceEnv();
      this.appOrchestrator = new AppOrchestrator(this.options.rootDir, serviceEnv);
      
      await this.appOrchestrator.start({
        apps: this.options.app ? [this.options.app] : undefined,
      });

      // Warmup apps
      if (!this.options.skipWarmup) {
        await this.appOrchestrator.warmup({
          apps: this.options.app ? [this.options.app] : undefined,
        });
      }
    }

    // Step 5: Run preflight checks
    if (!this.options.skipPreflight && MODE_NEEDS_LOCALNET[this.options.mode]) {
      try {
        logger.step('Running preflight checks...');
        const envVars = this.getEnvVars();
        const rpcUrl = envVars.L2_RPC_URL ?? envVars.JEJU_RPC_URL;
        if (!rpcUrl) {
          throw new Error('No RPC URL available for preflight checks. Localnet may not have started properly.');
        }
        const chainId = envVars.CHAIN_ID;
        if (!chainId) {
          throw new Error('No CHAIN_ID available for preflight checks.');
        }
        const { runPreflightChecks } = await import('@jejunetwork/tests/preflight');
        const preflightResult = await runPreflightChecks({
          rpcUrl,
          chainId: parseInt(chainId),
        });

        if (!preflightResult.success) {
          throw new Error('Preflight checks failed');
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'Preflight checks failed') {
          throw error;
        }
        logger.warn(`Preflight module not available: ${error instanceof Error ? error.message : String(error)}`);
        logger.warn('Continuing without preflight checks');
      }
    }

    this.setupComplete = true;
    logger.success('Test setup complete');
  }

  async teardown(): Promise<void> {
    if (!this.setupComplete && !this.options.keepServices) {
      return;
    }

    logger.step('Tearing down test infrastructure...');

    // Reverse order of setup
    if (this.appOrchestrator && !this.options.keepServices) {
      await this.appOrchestrator.stop();
    }

    if (this.dockerOrchestrator && !this.options.keepServices) {
      await this.dockerOrchestrator.stop();
    }

    if (this.localnetOrchestrator && !this.options.keepServices) {
      await this.localnetOrchestrator.stop();
    }

    if (this.lockManager) {
      this.lockManager.releaseLock();
    }

    this.setupComplete = false;
    logger.success('Teardown complete');
  }

  getEnvVars(): Record<string, string> {
    const env: Record<string, string> = {
      NODE_ENV: 'test',
      CI: process.env.CI || '',
    };

    if (this.localnetOrchestrator) {
      Object.assign(env, this.localnetOrchestrator.getEnvVars());
    }

    if (this.dockerOrchestrator) {
      Object.assign(env, this.dockerOrchestrator.getEnvVars());
    }

    if (this.appOrchestrator) {
      Object.assign(env, this.appOrchestrator.getEnvVars());
    }

    return env;
  }

  private getServiceEnv(): Record<string, string> {
    const env: Record<string, string> = {};

    if (this.localnetOrchestrator) {
      Object.assign(env, this.localnetOrchestrator.getEnvVars());
    }

    if (this.dockerOrchestrator) {
      Object.assign(env, this.dockerOrchestrator.getEnvVars());
    }

    return env;
  }

  isSetup(): boolean {
    return this.setupComplete;
  }
}

export function createTestOrchestrator(options: TestOrchestratorOptions): TestOrchestrator {
  return new TestOrchestrator(options);
}

