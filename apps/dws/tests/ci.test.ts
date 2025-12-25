/**
 * CI/CD System Tests
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Address, Hex } from 'viem'
import {
  NATIVE_ACTIONS,
  parseActionRef,
  resolveAction,
} from '../api/ci/action-resolver'
import { CIEventBus, resetCIEventBus } from '../api/ci/event-bus'
import { RunnerManager, resetRunnerManager } from '../api/ci/runner-manager'
import { CIScheduler, resetCIScheduler } from '../api/ci/scheduler'
import { CISecretsStore, resetCISecretsStore } from '../api/ci/secrets-store'
import type { Workflow } from '../api/ci/types'
import { WorkflowEngine } from '../api/ci/workflow-engine'

const TEST_REPO_ID =
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex
const TEST_WORKFLOW_ID =
  '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as Hex
const TEST_ADDRESS = '0x1234567890123456789012345678901234567890' as Address

const mockBackend = {
  upload: async (content: Buffer, _options: { filename: string }) => ({
    cid: `Qm${Math.random().toString(36).slice(2)}`,
    size: content.length,
  }),
  download: async (_cid: string) => ({
    content: Buffer.from('test'),
    metadata: {},
  }),
}

const mockRepoManager = {
  getObjectStore: () => ({
    getCommit: async () => ({ tree: 'abc123' }),
    getTree: async () => ({ entries: [] }),
    getBlob: async () => null,
  }),
  getRepository: async () => ({
    headCommitCid: `0x${'1'.repeat(64)}`,
  }),
  getBranch: async () => ({
    tipCommitCid: `0x${'1'.repeat(64)}`,
  }),
}

describe('WorkflowEngine', () => {
  let engine: WorkflowEngine

  beforeEach(() => {
    engine = new WorkflowEngine(
      { rpcUrl: 'http://localhost:6546', dwsUrl: 'http://localhost:4030' },
      mockBackend as never,
      mockRepoManager as never,
    )
  })

  test('parses basic workflow config', () => {
    const yaml = `
name: CI
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: jeju-compute
    steps:
      - uses: jeju/checkout
      - run: bun install
      - run: bun test
`
    const config = engine.parseWorkflowConfig(yaml)

    expect(config.name).toBe('CI')
    expect(config.on.push?.branches).toEqual(['main'])
    expect(Object.keys(config.jobs)).toEqual(['build'])
    expect(config.jobs.build.steps.length).toBe(3)
  })

  test('parses workflow with matrix strategy', () => {
    const yaml = `
name: Matrix Test
on: push
jobs:
  test:
    runs-on: jeju-compute
    strategy:
      matrix:
        node: [18, 20]
        os: [linux, macos]
      fail-fast: false
    steps:
      - run: echo "Node \${{ matrix.node }} on \${{ matrix.os }}"
`
    const config = engine.parseWorkflowConfig(yaml)

    expect(config.jobs.test.strategy?.matrix?.node).toEqual([18, 20])
    expect(config.jobs.test.strategy?.matrix?.os).toEqual(['linux', 'macos'])
    expect(config.jobs.test.strategy?.['fail-fast']).toBe(false)
  })

  test('parses workflow with concurrency', () => {
    const yaml = `
name: Deploy
on: push
concurrency:
  group: deploy-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: jeju-compute
    steps:
      - run: echo "deploy"
`
    const config = engine.parseWorkflowConfig(yaml)

    expect(config.concurrency).toBeDefined()
    expect(typeof config.concurrency).toBe('object')
    if (typeof config.concurrency === 'object') {
      expect(config.concurrency.group).toBe(`deploy-\${{ github.ref }}`)
      expect(config.concurrency['cancel-in-progress']).toBe(true)
    }
  })

  test('parses workflow with environment', () => {
    const yaml = `
name: Deploy
on: push
jobs:
  deploy:
    runs-on: jeju-compute
    environment:
      name: production
      url: https://app.jejunetwork.org
    steps:
      - run: echo "deploy"
`
    const config = engine.parseWorkflowConfig(yaml)

    expect(config.jobs.deploy.environment).toBeDefined()
    if (typeof config.jobs.deploy.environment === 'object') {
      expect(config.jobs.deploy.environment.name).toBe('production')
      expect(config.jobs.deploy.environment.url).toBe(
        'https://app.jejunetwork.org',
      )
    }
  })

  test('parses workflow with services', () => {
    const yaml = `
name: Test
on: push
jobs:
  test:
    runs-on: jeju-compute
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432
    steps:
      - run: pg_isready
`
    const config = engine.parseWorkflowConfig(yaml)

    expect(config.jobs.test.services?.postgres).toBeDefined()
    expect(config.jobs.test.services?.postgres.image).toBe('postgres:15')
  })
})

describe('ActionResolver', () => {
  test('resolves GitHub checkout to Jeju checkout', () => {
    const result = resolveAction('actions/checkout@v4')
    expect(result).toBeDefined()
    expect(result?.isNative).toBe(true)
  })

  test('resolves setup-node action', () => {
    const result = resolveAction('actions/setup-node@v4')
    expect(result).toBeDefined()
  })

  test('resolves setup-python action', () => {
    const result = resolveAction('actions/setup-python@v5')
    expect(result).toBeDefined()
  })

  test('parses action reference with path', () => {
    const result = parseActionRef('owner/repo/path/to/action@v1')
    expect(result.owner).toBe('owner')
    expect(result.repo).toBe('repo')
    expect(result.path).toBe('path/to/action')
    expect(result.ref).toBe('v1')
  })

  test('parses simple action reference', () => {
    const result = parseActionRef('actions/checkout@v4')
    expect(result.owner).toBe('actions')
    expect(result.repo).toBe('checkout')
    expect(result.path).toBeUndefined()
    expect(result.ref).toBe('v4')
  })

  test('native actions have proper structure', () => {
    expect(NATIVE_ACTIONS['jeju/checkout']).toBeDefined()
    expect(NATIVE_ACTIONS['jeju/checkout'].name).toBe('Checkout')
    expect(NATIVE_ACTIONS['jeju/checkout'].runs.using).toBe('composite')

    expect(NATIVE_ACTIONS['jeju/setup-bun']).toBeDefined()
    expect(NATIVE_ACTIONS['jeju/cache']).toBeDefined()
    expect(NATIVE_ACTIONS['jeju/artifact-upload']).toBeDefined()
  })
})

describe('CISecretsStore', () => {
  let store: CISecretsStore

  beforeEach(() => {
    resetCISecretsStore()
    store = new CISecretsStore()
  })

  test('creates and retrieves secret', async () => {
    const secret = await store.createSecret(
      TEST_REPO_ID,
      'API_KEY',
      'secret123',
      TEST_ADDRESS,
    )

    expect(secret.name).toBe('API_KEY')
    expect(secret.repoId).toBe(TEST_REPO_ID)

    const value = await store.getSecretValue(secret.secretId, TEST_ADDRESS)
    expect(value).toBe('secret123')
  })

  test('creates environment-scoped secret', async () => {
    const secret = await store.createSecret(
      TEST_REPO_ID,
      'PROD_KEY',
      'prodvalue',
      TEST_ADDRESS,
      'production',
    )

    expect(secret.environment).toBe('production')

    const secrets = store.listSecrets(TEST_REPO_ID, 'production')
    expect(secrets.length).toBe(1)
    expect(secrets[0].name).toBe('PROD_KEY')
  })

  test('updates secret value', async () => {
    const secret = await store.createSecret(
      TEST_REPO_ID,
      'TOKEN',
      'old',
      TEST_ADDRESS,
    )
    await store.updateSecret(secret.secretId, 'new', TEST_ADDRESS)

    const value = await store.getSecretValue(secret.secretId, TEST_ADDRESS)
    expect(value).toBe('new')
  })

  test('deletes secret', async () => {
    const secret = await store.createSecret(
      TEST_REPO_ID,
      'TEMP',
      'temp',
      TEST_ADDRESS,
    )
    await store.deleteSecret(secret.secretId, TEST_ADDRESS)

    const secrets = store.listSecrets(TEST_REPO_ID)
    expect(secrets.find((s) => s.name === 'TEMP')).toBeUndefined()
  })

  test('creates environment with protection rules', async () => {
    const env = await store.createEnvironment(
      TEST_REPO_ID,
      'staging',
      TEST_ADDRESS,
      {
        url: 'https://staging.jejunetwork.org',
        protectionRules: {
          requiredReviewers: [TEST_ADDRESS],
          waitTimer: 5,
        },
      },
    )

    expect(env.name).toBe('staging')
    expect(env.url).toBe('https://staging.jejunetwork.org')
    expect(env.protectionRules.requiredReviewers).toContain(TEST_ADDRESS)
    expect(env.protectionRules.waitTimer).toBe(5)
  })

  test('adds secret to environment', async () => {
    await store.createEnvironment(TEST_REPO_ID, 'production', TEST_ADDRESS)
    const secret = await store.addEnvironmentSecret(
      TEST_REPO_ID,
      'production',
      'DB_PASSWORD',
      'supersecret',
      TEST_ADDRESS,
    )

    expect(secret.name).toBe('DB_PASSWORD')

    const env = store.getEnvironment(TEST_REPO_ID, 'production')
    expect(env?.secrets.length).toBe(1)
  })

  test('checks environment protection', async () => {
    await store.createEnvironment(TEST_REPO_ID, 'prod', TEST_ADDRESS, {
      protectionRules: {
        deployBranchPolicy: { protectedBranches: true },
      },
    })

    const result1 = await store.checkEnvironmentProtection(
      TEST_REPO_ID,
      'prod',
      TEST_ADDRESS,
      'main',
    )
    expect(result1.allowed).toBe(true)

    const result2 = await store.checkEnvironmentProtection(
      TEST_REPO_ID,
      'prod',
      TEST_ADDRESS,
      'feature',
    )
    expect(result2.allowed).toBe(false)
  })
})

describe('CIScheduler', () => {
  let scheduler: CIScheduler
  let engine: WorkflowEngine

  beforeEach(() => {
    resetCIScheduler()
    engine = new WorkflowEngine(
      { rpcUrl: 'http://localhost:6546' },
      mockBackend as never,
      mockRepoManager as never,
    )
    scheduler = new CIScheduler(engine)
  })

  afterEach(() => {
    scheduler.stop()
  })

  test('adds scheduled job', () => {
    const workflow: Workflow = {
      workflowId: TEST_WORKFLOW_ID,
      repoId: TEST_REPO_ID,
      name: 'Scheduled',
      description: '',
      triggers: [{ type: 'schedule', schedule: '0 0 * * *' }],
      jobs: [],
      env: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      active: true,
      source: 'jeju',
    }

    const job = scheduler.addJob(workflow, workflow.triggers[0])

    expect(job).toBeDefined()
    expect(job?.cron).toBe('0 0 * * *')
    expect(job?.enabled).toBe(true)
  })

  test('calculates next run time', () => {
    const workflow: Workflow = {
      workflowId: TEST_WORKFLOW_ID,
      repoId: TEST_REPO_ID,
      name: 'Every Minute',
      description: '',
      triggers: [{ type: 'schedule', schedule: '* * * * *' }],
      jobs: [],
      env: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      active: true,
      source: 'jeju',
    }

    const job = scheduler.addJob(workflow, workflow.triggers[0])
    expect(job?.nextRun).toBeDefined()
    expect(job?.nextRun).toBeGreaterThan(Date.now())
    expect(job?.nextRun).toBeLessThan(Date.now() + 2 * 60 * 1000)
  })

  test('lists jobs by repo', () => {
    const workflow1: Workflow = {
      workflowId: TEST_WORKFLOW_ID,
      repoId: TEST_REPO_ID,
      name: 'Job1',
      description: '',
      triggers: [{ type: 'schedule', schedule: '0 * * * *' }],
      jobs: [],
      env: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      active: true,
      source: 'jeju',
    }

    const otherRepoId = `0x${'2'.repeat(64)}` as Hex
    const workflow2: Workflow = {
      workflowId: `0x${'3'.repeat(64)}` as Hex,
      repoId: otherRepoId,
      name: 'Job2',
      description: '',
      triggers: [{ type: 'schedule', schedule: '0 0 * * *' }],
      jobs: [],
      env: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      active: true,
      source: 'jeju',
    }

    scheduler.addJob(workflow1, workflow1.triggers[0])
    scheduler.addJob(workflow2, workflow2.triggers[0])

    const jobs = scheduler.listJobs(TEST_REPO_ID)
    expect(jobs.length).toBe(1)

    const allJobs = scheduler.listJobs()
    expect(allJobs.length).toBe(2)
  })

  test('enables and disables jobs', () => {
    const workflow: Workflow = {
      workflowId: TEST_WORKFLOW_ID,
      repoId: TEST_REPO_ID,
      name: 'Toggle',
      description: '',
      triggers: [{ type: 'schedule', schedule: '0 0 * * *' }],
      jobs: [],
      env: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      active: true,
      source: 'jeju',
    }

    const job = scheduler.addJob(workflow, workflow.triggers[0])
    expect(job?.enabled).toBe(true)

    scheduler.disableJob(job?.jobId)
    expect(scheduler.getJob(job?.jobId)?.enabled).toBe(false)

    scheduler.enableJob(job?.jobId)
    expect(scheduler.getJob(job?.jobId)?.enabled).toBe(true)
  })
})

describe('RunnerManager', () => {
  let manager: RunnerManager

  beforeEach(() => {
    resetRunnerManager()
    manager = new RunnerManager('http://localhost:4030')
  })

  test('registers runner', () => {
    const runner = manager.registerRunner({
      runnerId: 'runner-1',
      name: 'test-runner',
      labels: ['linux', 'x64'],
      nodeId: 'node-1',
      nodeAddress: TEST_ADDRESS,
      capabilities: {
        architecture: 'amd64',
        os: 'linux',
        docker: true,
        gpu: false,
        cpuCores: 4,
        memoryMb: 8192,
        storageMb: 50000,
      },
      lastHeartbeat: Date.now(),
      owner: TEST_ADDRESS,
      selfHosted: true,
    })

    expect(runner.runnerId).toBe('runner-1')
    expect(runner.status).toBe('idle')

    const retrieved = manager.getRunner('runner-1')
    expect(retrieved).toBeDefined()
    expect(retrieved?.name).toBe('test-runner')
  })

  test('filters runners by labels', () => {
    manager.registerRunner({
      runnerId: 'linux-runner',
      name: 'Linux Runner',
      labels: ['linux', 'x64', 'docker'],
      nodeId: 'node-1',
      nodeAddress: TEST_ADDRESS,
      capabilities: {
        architecture: 'amd64',
        os: 'linux',
        docker: true,
        gpu: false,
        cpuCores: 4,
        memoryMb: 8192,
        storageMb: 50000,
      },
      lastHeartbeat: Date.now(),
      owner: TEST_ADDRESS,
      selfHosted: false,
    })

    manager.registerRunner({
      runnerId: 'gpu-runner',
      name: 'GPU Runner',
      labels: ['linux', 'x64', 'gpu'],
      nodeId: 'node-2',
      nodeAddress: TEST_ADDRESS,
      capabilities: {
        architecture: 'amd64',
        os: 'linux',
        docker: true,
        gpu: true,
        gpuType: 'A100',
        cpuCores: 8,
        memoryMb: 32768,
        storageMb: 100000,
      },
      lastHeartbeat: Date.now(),
      owner: TEST_ADDRESS,
      selfHosted: false,
    })

    const allRunners = manager.getRunners()
    expect(allRunners.length).toBe(2)

    const gpuRunners = manager.getRunners(['gpu'])
    expect(gpuRunners.length).toBe(1)
    expect(gpuRunners[0].runnerId).toBe('gpu-runner')

    const dockerRunners = manager.getRunners(['docker'])
    expect(dockerRunners.length).toBe(1)
  })

  test('tracks runner heartbeat', () => {
    manager.registerRunner({
      runnerId: 'heartbeat-test',
      name: 'Heartbeat Test',
      labels: ['test'],
      nodeId: 'node-1',
      nodeAddress: TEST_ADDRESS,
      capabilities: {
        architecture: 'amd64',
        os: 'linux',
        docker: false,
        gpu: false,
        cpuCores: 2,
        memoryMb: 4096,
        storageMb: 20000,
      },
      lastHeartbeat: Date.now() - 120000,
      owner: TEST_ADDRESS,
      selfHosted: true,
    })

    const before = manager.getRunner('heartbeat-test')?.lastHeartbeat
    manager.runnerHeartbeat('heartbeat-test')
    const after = manager.getRunner('heartbeat-test')?.lastHeartbeat
    if (before === undefined) throw new Error('before should be defined')

    expect(after).toBeGreaterThan(before)
  })

  test('unregisters runner', () => {
    manager.registerRunner({
      runnerId: 'temp-runner',
      name: 'Temporary',
      labels: [],
      nodeId: 'node-1',
      nodeAddress: TEST_ADDRESS,
      capabilities: {
        architecture: 'amd64',
        os: 'linux',
        docker: false,
        gpu: false,
        cpuCores: 1,
        memoryMb: 2048,
        storageMb: 10000,
      },
      lastHeartbeat: Date.now(),
      owner: TEST_ADDRESS,
      selfHosted: true,
    })

    expect(manager.getRunner('temp-runner')).toBeDefined()
    manager.unregisterRunner('temp-runner')
    expect(manager.getRunner('temp-runner')).toBeUndefined()
  })

  test('reports stats', () => {
    manager.registerRunner({
      runnerId: 'idle-runner',
      name: 'Idle',
      labels: [],
      nodeId: 'node-1',
      nodeAddress: TEST_ADDRESS,
      capabilities: {
        architecture: 'amd64',
        os: 'linux',
        docker: false,
        gpu: false,
        cpuCores: 1,
        memoryMb: 2048,
        storageMb: 10000,
      },
      lastHeartbeat: Date.now(),
      owner: TEST_ADDRESS,
      selfHosted: true,
    })

    const stats = manager.getStats()
    expect(stats.totalRunners).toBe(1)
    expect(stats.idleRunners).toBe(1)
    expect(stats.busyRunners).toBe(0)
  })
})

describe('CIEventBus', () => {
  let eventBus: CIEventBus
  let engine: WorkflowEngine

  beforeEach(() => {
    resetCIEventBus()
    engine = new WorkflowEngine(
      { rpcUrl: 'http://localhost:6546' },
      mockBackend as never,
      mockRepoManager as never,
    )
    eventBus = new CIEventBus(engine)
  })

  test('emits and receives events', async () => {
    const received: string[] = []

    eventBus.on('push', async (event) => {
      received.push(event.type)
    })

    await eventBus.emit({
      type: 'push',
      repoId: TEST_REPO_ID,
      branch: 'main',
      commitSha: 'abc123',
      pusher: TEST_ADDRESS,
    })

    expect(received).toContain('push')
  })

  test('tracks event history', async () => {
    await eventBus.emit({
      type: 'push',
      repoId: TEST_REPO_ID,
      branch: 'main',
      commitSha: 'abc123',
      pusher: TEST_ADDRESS,
    })

    await eventBus.emit({
      type: 'pull_request',
      repoId: TEST_REPO_ID,
      action: 'opened',
      prNumber: 1,
      headSha: 'def456',
      baseBranch: 'main',
      author: TEST_ADDRESS,
    })

    const history = eventBus.getEventHistory()
    expect(history.length).toBe(2)
    expect(history[0].event.type).toBe('push')
    expect(history[1].event.type).toBe('pull_request')
  })

  test('filters history by repo', async () => {
    const otherRepoId = `0x${'9'.repeat(64)}` as Hex

    await eventBus.emit({
      type: 'push',
      repoId: TEST_REPO_ID,
      branch: 'main',
      commitSha: 'abc',
      pusher: TEST_ADDRESS,
    })

    await eventBus.emit({
      type: 'push',
      repoId: otherRepoId,
      branch: 'main',
      commitSha: 'def',
      pusher: TEST_ADDRESS,
    })

    const filtered = eventBus.getEventHistory(TEST_REPO_ID)
    expect(filtered.length).toBe(1)
    expect(filtered[0].event.repoId).toBe(TEST_REPO_ID)
  })

  test('unsubscribes handler', async () => {
    let count = 0

    const unsubscribe = eventBus.on('push', async () => {
      count++
    })

    await eventBus.emit({
      type: 'push',
      repoId: TEST_REPO_ID,
      branch: 'main',
      commitSha: 'abc',
      pusher: TEST_ADDRESS,
    })

    expect(count).toBe(1)

    unsubscribe()

    await eventBus.emit({
      type: 'push',
      repoId: TEST_REPO_ID,
      branch: 'main',
      commitSha: 'def',
      pusher: TEST_ADDRESS,
    })

    expect(count).toBe(1)
  })

  test('clears history', async () => {
    await eventBus.emit({
      type: 'push',
      repoId: TEST_REPO_ID,
      branch: 'main',
      commitSha: 'abc',
      pusher: TEST_ADDRESS,
    })

    expect(eventBus.getEventHistory().length).toBe(1)
    eventBus.clearHistory()
    expect(eventBus.getEventHistory().length).toBe(0)
  })
})

describe('Expression Evaluation', () => {
  let engine: WorkflowEngine

  beforeEach(() => {
    engine = new WorkflowEngine(
      { rpcUrl: 'http://localhost:6546' },
      mockBackend as never,
      mockRepoManager as never,
    )
  })

  test('parses workflow with expressions', () => {
    const yaml = `
name: Conditional
on: push
jobs:
  build:
    runs-on: jeju-compute
    steps:
      - name: Only on main
        if: github.ref == 'refs/heads/main'
        run: echo "main branch"
      - name: Skip on failure
        if: success()
        run: echo "success"
`
    const config = engine.parseWorkflowConfig(yaml)

    expect(config.jobs.build.steps[0].if).toBe(
      "github.ref == 'refs/heads/main'",
    )
    expect(config.jobs.build.steps[1].if).toBe('success()')
  })
})

describe('Matrix Expansion', () => {
  let engine: WorkflowEngine

  beforeEach(() => {
    engine = new WorkflowEngine(
      { rpcUrl: 'http://localhost:6546' },
      mockBackend as never,
      mockRepoManager as never,
    )
  })

  test('parses matrix with include/exclude', () => {
    const yaml = `
name: Matrix
on: push
jobs:
  test:
    runs-on: jeju-compute
    strategy:
      matrix:
        node: [18, 20]
        os: [linux]
        include:
          - node: 22
            os: linux
            experimental: true
        exclude:
          - node: 18
            os: linux
    steps:
      - run: echo test
`
    const config = engine.parseWorkflowConfig(yaml)

    expect(config.jobs.test.strategy?.matrix?.include).toBeDefined()
    expect(config.jobs.test.strategy?.matrix?.exclude).toBeDefined()
  })
})

describe('Workflow Concurrency', () => {
  let engine: WorkflowEngine

  beforeEach(() => {
    engine = new WorkflowEngine(
      { rpcUrl: 'http://localhost:6546' },
      mockBackend as never,
      mockRepoManager as never,
    )
  })

  test('parses string concurrency', () => {
    const yaml = `
name: Deploy
on: push
concurrency: deploy-group
jobs:
  deploy:
    runs-on: jeju-compute
    steps:
      - run: echo deploy
`
    const config = engine.parseWorkflowConfig(yaml)
    expect(config.concurrency).toBe('deploy-group')
  })

  test('parses object concurrency with cancel-in-progress', () => {
    const yaml = `
name: Deploy
on: push
concurrency:
  group: deploy-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: jeju-compute
    steps:
      - run: echo deploy
`
    const config = engine.parseWorkflowConfig(yaml)

    expect(typeof config.concurrency).toBe('object')
    if (typeof config.concurrency === 'object') {
      expect(config.concurrency['cancel-in-progress']).toBe(true)
    }
  })
})

describe('Workflow Triggers', () => {
  let engine: WorkflowEngine

  beforeEach(() => {
    engine = new WorkflowEngine(
      { rpcUrl: 'http://localhost:6546' },
      mockBackend as never,
      mockRepoManager as never,
    )
  })

  test('parses multiple triggers', () => {
    const yaml = `
name: Multi-trigger
on:
  push:
    branches: [main]
  pull_request:
    types: [opened, synchronize]
  schedule:
    - cron: '0 0 * * *'
  workflow_dispatch:
    inputs:
      environment:
        description: Target environment
        required: true
        type: choice
        options:
          - staging
          - production
jobs:
  build:
    runs-on: jeju-compute
    steps:
      - run: echo build
`
    const config = engine.parseWorkflowConfig(yaml)

    expect(config.on.push?.branches).toEqual(['main'])
    expect(config.on.pull_request?.types).toContain('opened')
    expect(config.on.schedule?.[0].cron).toBe('0 0 * * *')
    expect(config.on.workflow_dispatch?.inputs?.environment).toBeDefined()
  })

  test('parses release trigger', () => {
    const yaml = `
name: Release
on:
  release:
    types: [published]
jobs:
  publish:
    runs-on: jeju-compute
    steps:
      - run: echo publish
`
    const config = engine.parseWorkflowConfig(yaml)
    expect(config.on.release?.types).toContain('published')
  })
})
