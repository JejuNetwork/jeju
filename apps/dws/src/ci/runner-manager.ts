/**
 * Runner Manager - Dispatches CI jobs to compute nodes
 */

import { unlink } from 'node:fs/promises'
import type { Address, Hex } from 'viem'
import type { JobRun, Runner, RunnerCapabilities, WorkflowJob } from './types'

interface ComputeNode {
  nodeId: string
  address: Address
  capabilities: RunnerCapabilities
  status: 'available' | 'busy' | 'draining' | 'offline'
  pricePerMinute: bigint
  currentJobs: number
  maxConcurrentJobs: number
  lastHeartbeat: number
  region?: string
}

interface JobDispatch {
  dispatchId: string
  runId: Hex
  jobId: string
  runnerId: string
  nodeId: string
  status: 'dispatched' | 'running' | 'completed' | 'failed' | 'cancelled'
  dispatchedAt: number
  startedAt?: number
  completedAt?: number
  logs: string[]
}

interface DispatchRequest {
  runId: Hex
  job: WorkflowJob
  jobRun: JobRun
  runsOn: string | string[]
  timeout?: number
  environment?: string
  secrets?: Record<string, string>
  matrixValues?: Record<string, string | number | boolean>
}

export class RunnerManager {
  private runners = new Map<string, Runner>()
  private computeNodes = new Map<string, ComputeNode>()
  private dispatches = new Map<string, JobDispatch>()
  private dwsUrl: string
  private pendingJobs: DispatchRequest[] = []
  private isProcessing = false

  constructor(dwsUrl: string = process.env.DWS_URL || 'http://localhost:4030') {
    this.dwsUrl = dwsUrl
    this.startHealthCheck()
  }

  registerRunner(runner: Omit<Runner, 'registeredAt' | 'status'>): Runner {
    const fullRunner: Runner = {
      ...runner,
      status: 'idle',
      registeredAt: Date.now(),
    }
    this.runners.set(runner.runnerId, fullRunner)
    return fullRunner
  }

  unregisterRunner(runnerId: string): void {
    const runner = this.runners.get(runnerId)
    if (runner?.currentRun) {
      this.cancelDispatch(runner.currentRun.runId, runner.currentRun.jobId)
    }
    this.runners.delete(runnerId)
  }

  registerComputeNode(node: ComputeNode): void {
    this.computeNodes.set(node.nodeId, node)
  }

  unregisterComputeNode(nodeId: string): void {
    this.computeNodes.delete(nodeId)
    for (const runner of this.runners.values()) {
      if (runner.nodeId === nodeId) {
        runner.status = 'offline'
      }
    }
  }

  updateNodeStatus(nodeId: string, status: ComputeNode['status']): void {
    const node = this.computeNodes.get(nodeId)
    if (node) {
      node.status = status
      node.lastHeartbeat = Date.now()
    }
  }

  async dispatchJob(request: DispatchRequest): Promise<JobDispatch> {
    const labels = this.parseRunsOn(request.runsOn)
    const node = this.selectCheapestNode(labels, request.job.container)

    if (!node) {
      this.pendingJobs.push(request)
      throw new Error('No available runners matching requirements')
    }

    const runner = this.getOrCreateRunner(node, labels)
    runner.status = 'busy'
    runner.currentRun = { runId: request.runId, jobId: request.job.jobId }

    const dispatch: JobDispatch = {
      dispatchId: crypto.randomUUID(),
      runId: request.runId,
      jobId: request.job.jobId,
      runnerId: runner.runnerId,
      nodeId: node.nodeId,
      status: 'dispatched',
      dispatchedAt: Date.now(),
      logs: [],
    }

    this.dispatches.set(dispatch.dispatchId, dispatch)
    node.currentJobs++

    this.executeJob(dispatch, request, runner, node)

    return dispatch
  }

  private parseRunsOn(runsOn: string | string[]): string[] {
    const labels = Array.isArray(runsOn) ? runsOn : [runsOn]
    const result: string[] = []

    for (const label of labels) {
      if (label === 'jeju-compute') {
        result.push('linux', 'x64')
      } else if (label === 'self-hosted') {
        result.push('self-hosted')
      } else if (label.includes('-')) {
        const parts = label.split('-')
        result.push(...parts)
      } else {
        result.push(label)
      }
    }

    return result
  }

  private selectCheapestNode(
    labels: string[],
    container?: { image: string },
  ): ComputeNode | null {
    const candidates: ComputeNode[] = []

    for (const node of this.computeNodes.values()) {
      if (node.status !== 'available') continue
      if (node.currentJobs >= node.maxConcurrentJobs) continue

      if (!this.nodeMatchesLabels(node, labels)) continue

      if (container && !node.capabilities.docker) continue

      candidates.push(node)
    }

    if (candidates.length === 0) return null

    candidates.sort((a, b) => Number(a.pricePerMinute - b.pricePerMinute))
    return candidates[0]
  }

  private nodeMatchesLabels(node: ComputeNode, labels: string[]): boolean {
    for (const label of labels) {
      if (label === 'linux' && node.capabilities.os !== 'linux') return false
      if (label === 'macos' && node.capabilities.os !== 'macos') return false
      if (label === 'windows' && node.capabilities.os !== 'windows')
        return false
      if (label === 'x64' && node.capabilities.architecture !== 'amd64')
        return false
      if (label === 'arm64' && node.capabilities.architecture !== 'arm64')
        return false
      if (label === 'gpu' && !node.capabilities.gpu) return false
    }
    return true
  }

  private getOrCreateRunner(node: ComputeNode, labels: string[]): Runner {
    for (const runner of this.runners.values()) {
      if (runner.nodeId === node.nodeId && runner.status === 'idle') {
        return runner
      }
    }

    return this.registerRunner({
      runnerId: `runner-${node.nodeId}-${Date.now()}`,
      name: `${node.nodeId}-runner`,
      labels,
      nodeId: node.nodeId,
      nodeAddress: node.address,
      capabilities: node.capabilities,
      lastHeartbeat: Date.now(),
      owner: node.address,
      selfHosted: false,
    })
  }

  private async executeJob(
    dispatch: JobDispatch,
    request: DispatchRequest,
    runner: Runner,
    node: ComputeNode,
  ): Promise<void> {
    dispatch.status = 'running'
    dispatch.startedAt = Date.now()
    request.jobRun.status = 'in_progress'
    request.jobRun.startedAt = Date.now()
    request.jobRun.runnerId = runner.runnerId
    request.jobRun.runnerName = runner.name

    const containerImage = this.getRunnerImage(runner.capabilities.architecture)

    dispatch.logs.push(
      `[${new Date().toISOString()}] Pulling runner image: ${containerImage}`,
    )

    const workflowPayload = {
      runId: request.runId,
      jobId: request.job.jobId,
      job: request.job,
      secrets: request.secrets || {},
      env: {
        CI: 'true',
        JEJU_CI: 'true',
        GITHUB_ACTIONS: 'true',
        DWS_URL: this.dwsUrl,
        ...(request.matrixValues || {}),
      },
    }

    // SECURITY: Pass secrets through environment variables using --env-file
    // to avoid exposing them in process lists or command history
    const envFile = `/tmp/jeju-runner-${dispatch.dispatchId}.env`
    const envContent: string[] = [
      `JEJU_WORKFLOW=${Buffer.from(JSON.stringify(workflowPayload)).toString('base64')}`,
    ]
    if (request.secrets) {
      for (const [k, v] of Object.entries(request.secrets)) {
        // Escape values for env file format (newlines and special chars)
        const escapedValue = v
          .replace(/\\/g, '\\\\')
          .replace(/'/g, "\\'")
          .replace(/\n/g, '\\n')
        envContent.push(`${k}='${escapedValue}'`)
      }
    }
    await Bun.write(envFile, envContent.join('\n'))

    const runCommand = [
      'docker',
      'run',
      '--rm',
      '-v',
      '/var/run/docker.sock:/var/run/docker.sock',
      '--env-file',
      envFile,
      containerImage,
    ]

    dispatch.logs.push(
      `[${new Date().toISOString()}] Starting runner with ${request.secrets ? Object.keys(request.secrets).length : 0} secrets`,
    )

    const proc = Bun.spawn(runCommand, {
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const decoder = new TextDecoder()

    const readStream = async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      prefix: string,
    ) => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)
        for (const line of text.split('\n').filter((l) => l)) {
          dispatch.logs.push(`[${prefix}] ${line}`)
        }
      }
    }

    await Promise.all([
      readStream(proc.stdout.getReader(), 'stdout'),
      readStream(proc.stderr.getReader(), 'stderr'),
    ])

    const exitCode = await proc.exited

    // Clean up env file containing secrets
    try {
      await unlink(envFile)
    } catch {
      // Ignore errors during cleanup
    }

    dispatch.status = exitCode === 0 ? 'completed' : 'failed'
    dispatch.completedAt = Date.now()

    request.jobRun.status = 'completed'
    request.jobRun.conclusion = exitCode === 0 ? 'success' : 'failure'
    request.jobRun.completedAt = Date.now()

    runner.status = 'idle'
    runner.currentRun = undefined
    node.currentJobs--

    dispatch.logs.push(
      `[${new Date().toISOString()}] Job completed with exit code: ${exitCode}`,
    )

    this.processQueue()
  }

  private getRunnerImage(arch: 'amd64' | 'arm64'): string {
    const registry = process.env.JEJU_REGISTRY_URL || 'ghcr.io/jeju-labs'
    const tag = arch === 'arm64' ? 'arm64' : 'amd64'
    return `${registry}/jeju-runner:${tag}`
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.pendingJobs.length === 0) return
    this.isProcessing = true

    while (this.pendingJobs.length > 0) {
      const request = this.pendingJobs[0]
      const labels = this.parseRunsOn(request.runsOn)
      const node = this.selectCheapestNode(labels, request.job.container)

      if (!node) break

      this.pendingJobs.shift()
      await this.dispatchJob(request)
    }

    this.isProcessing = false
  }

  cancelDispatch(runId: Hex, jobId: string): void {
    for (const dispatch of this.dispatches.values()) {
      if (dispatch.runId === runId && dispatch.jobId === jobId) {
        if (dispatch.status === 'dispatched' || dispatch.status === 'running') {
          dispatch.status = 'cancelled'
          dispatch.completedAt = Date.now()

          const runner = this.runners.get(dispatch.runnerId)
          if (runner) {
            runner.status = 'idle'
            runner.currentRun = undefined
          }

          const node = this.computeNodes.get(dispatch.nodeId)
          if (node) {
            node.currentJobs--
          }
        }
      }
    }
  }

  getDispatch(dispatchId: string): JobDispatch | undefined {
    return this.dispatches.get(dispatchId)
  }

  getDispatchesForRun(runId: Hex): JobDispatch[] {
    return Array.from(this.dispatches.values()).filter((d) => d.runId === runId)
  }

  getRunner(runnerId: string): Runner | undefined {
    return this.runners.get(runnerId)
  }

  getRunners(labels?: string[]): Runner[] {
    const runners = Array.from(this.runners.values())
    if (!labels || labels.length === 0) return runners
    return runners.filter((r) => labels.every((l) => r.labels.includes(l)))
  }

  getIdleRunners(): Runner[] {
    return Array.from(this.runners.values()).filter((r) => r.status === 'idle')
  }

  getAvailableNodes(): ComputeNode[] {
    return Array.from(this.computeNodes.values()).filter(
      (n) => n.status === 'available' && n.currentJobs < n.maxConcurrentJobs,
    )
  }

  runnerHeartbeat(runnerId: string): void {
    const runner = this.runners.get(runnerId)
    if (runner) {
      runner.lastHeartbeat = Date.now()
      if (runner.status === 'offline') {
        runner.status = 'idle'
      }
    }
  }

  nodeHeartbeat(nodeId: string): void {
    const node = this.computeNodes.get(nodeId)
    if (node) {
      node.lastHeartbeat = Date.now()
      if (node.status === 'offline') {
        node.status = 'available'
      }
    }
  }

  private startHealthCheck(): void {
    setInterval(() => {
      const now = Date.now()
      const staleThreshold = 60000

      for (const runner of this.runners.values()) {
        if (
          now - runner.lastHeartbeat > staleThreshold &&
          runner.status !== 'offline'
        ) {
          runner.status = 'offline'
        }
      }

      for (const node of this.computeNodes.values()) {
        if (
          now - node.lastHeartbeat > staleThreshold &&
          node.status !== 'offline'
        ) {
          node.status = 'offline'
        }
      }
    }, 30000)
  }

  getStats(): {
    totalRunners: number
    idleRunners: number
    busyRunners: number
    offlineRunners: number
    totalNodes: number
    availableNodes: number
    pendingJobs: number
    activeDispatches: number
  } {
    const runners = Array.from(this.runners.values())
    const nodes = Array.from(this.computeNodes.values())
    const dispatches = Array.from(this.dispatches.values())

    return {
      totalRunners: runners.length,
      idleRunners: runners.filter((r) => r.status === 'idle').length,
      busyRunners: runners.filter((r) => r.status === 'busy').length,
      offlineRunners: runners.filter((r) => r.status === 'offline').length,
      totalNodes: nodes.length,
      availableNodes: nodes.filter((n) => n.status === 'available').length,
      pendingJobs: this.pendingJobs.length,
      activeDispatches: dispatches.filter((d) => d.status === 'running').length,
    }
  }
}

let runnerManagerInstance: RunnerManager | null = null

export function getRunnerManager(dwsUrl?: string): RunnerManager {
  if (!runnerManagerInstance) {
    runnerManagerInstance = new RunnerManager(dwsUrl)
  }
  return runnerManagerInstance
}

export function resetRunnerManager(): void {
  runnerManagerInstance = null
}
