/**
 * Compute Routes - Job execution and inference API
 */

import type { JobStatus } from '@jejunetwork/types'
import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import { z } from 'zod'

const EnvSchema = z.record(z.string(), z.string())

import {
  getActiveNodes,
  getNodeStats,
  type InferenceNode,
  registerNode,
  unregisterNode,
  updateNodeHeartbeat,
} from '../../compute/inference-node'
import { computeJobState, trainingState } from '../../state'

interface ComputeJob {
  jobId: string
  command: string
  shell: string
  env: Record<string, string>
  workingDir?: string
  timeout: number
  status: JobStatus
  output: string
  exitCode: number | null
  startedAt: number | null
  completedAt: number | null
  submittedBy: Address
}

const activeJobs = new Set<string>()
const MAX_CONCURRENT = 5

const SHELL_CONFIG: Record<
  string,
  { path: string; args: (cmd: string) => string[] }
> = {
  bash: { path: '/bin/bash', args: (cmd) => ['-c', cmd] },
  sh: { path: '/bin/sh', args: (cmd) => ['-c', cmd] },
  pwsh: { path: 'pwsh', args: (cmd) => ['-c', cmd] },
  powershell: { path: 'pwsh', args: (cmd) => ['-c', cmd] },
  cmd: { path: 'cmd.exe', args: (cmd) => ['/c', cmd] },
}

/** Bedrock embedding response */
const BedrockEmbeddingResponseSchema = z.object({
  embedding: z.array(z.number()),
  inputTextTokenCount: z.number(),
})

async function processQueue(): Promise<void> {
  if (activeJobs.size >= MAX_CONCURRENT) return

  const queued = await computeJobState.getQueued()
  const next = queued[0]
  if (!next) return

  const job: ComputeJob = {
    jobId: next.job_id,
    command: next.command,
    shell: next.shell,
    env: EnvSchema.parse(JSON.parse(next.env)),
    workingDir: next.working_dir ?? undefined,
    timeout: next.timeout,
    status: 'in_progress',
    output: '',
    exitCode: null,
    startedAt: Date.now(),
    completedAt: null,
    submittedBy: next.submitted_by as Address,
  }

  activeJobs.add(job.jobId)
  await computeJobState.save(job)

  executeJob(job)
}

async function executeJob(job: ComputeJob): Promise<void> {
  const config = SHELL_CONFIG[job.shell] ?? SHELL_CONFIG.bash
  const output: string[] = []

  const proc = Bun.spawn([config.path, ...config.args(job.command)], {
    cwd: job.workingDir || process.cwd(),
    env: { ...process.env, ...job.env, CI: 'true', JEJU_COMPUTE: 'true' },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const timeoutId = setTimeout(() => {
    proc.kill()
    finishJob(job, `${output.join('')}\n[TIMEOUT]`, 1)
  }, job.timeout)

  const drain = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      output.push(decoder.decode(value))
    }
  }

  await Promise.all([drain(proc.stdout), drain(proc.stderr)])
  clearTimeout(timeoutId)

  finishJob(job, output.join(''), await proc.exited)
}

async function finishJob(
  job: ComputeJob,
  output: string,
  exitCode: number,
): Promise<void> {
  job.output = output
  job.exitCode = exitCode
  job.status = exitCode === 0 ? 'completed' : 'failed'
  job.completedAt = Date.now()

  await computeJobState.save(job)
  activeJobs.delete(job.jobId)
  processQueue()
}

export function createComputeRouter() {
  return (
    new Elysia({ prefix: '/compute' })
      // Health check
      .get('/health', async () => {
        let queuedCount = 0
        let sqlitStatus = 'connected'
        try {
          const queued = await computeJobState.getQueued()
          queuedCount = queued.length
        } catch {
          sqlitStatus = 'unavailable'
        }
        return {
          service: 'dws-compute',
          status: 'healthy' as const,
          activeJobs: activeJobs.size,
          maxConcurrent: MAX_CONCURRENT,
          queuedJobs: queuedCount,
          sqlitStatus,
        }
      })

      // Chat completions
      .post(
        '/chat/completions',
        async ({ body, set }) => {
          const activeNodes = await getActiveNodes()
          const modelLower = (body.model ?? '').toLowerCase()
          let selectedNode: InferenceNode | null = null

          for (const node of activeNodes) {
            if (node.currentLoad >= node.maxConcurrent) continue

            const nodeModels = node.models.map((m: string) => m.toLowerCase())
            if (
              nodeModels.includes('*') ||
              nodeModels.some(
                (m: string) =>
                  modelLower.includes(m) ||
                  m.includes(modelLower.split('-')[0]),
              )
            ) {
              selectedNode = node
              break
            }
          }

          if (!selectedNode) {
            selectedNode =
              activeNodes.find(
                (n: InferenceNode) => n.currentLoad < n.maxConcurrent,
              ) ?? null
          }

          if (!selectedNode) {
            set.status = 503
            return {
              error: 'No inference nodes available',
              message:
                'Register an inference node with DWS. For local dev: bun run src/compute/local-inference-server.ts',
              activeNodes: activeNodes.length,
              stats: getNodeStats(),
            }
          }

          const response = await fetch(
            `${selectedNode.endpoint}/v1/chat/completions`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(60000),
            },
          )

          if (!response.ok) {
            const errorText = await response.text()
            set.status = response.status as 400 | 500
            return {
              error: `Node ${selectedNode.address} error: ${errorText}`,
              node: selectedNode.address,
            }
          }

          const result: unknown = await response.json()
          const resultObj =
            typeof result === 'object' && result !== null ? result : {}
          return {
            ...(resultObj as Record<string, unknown>),
            node: selectedNode.address,
            provider: selectedNode.provider,
          }
        },
        {
          body: t.Object({
            model: t.Optional(t.String()),
            messages: t.Array(
              t.Object({
                role: t.String(),
                content: t.String(),
              }),
            ),
            temperature: t.Optional(t.Number()),
            max_tokens: t.Optional(t.Number()),
            stream: t.Optional(t.Boolean()),
          }),
        },
      )

      // Embeddings
      .post(
        '/embeddings',
        async ({ body, set }) => {
          const bedrockEnabled =
            process.env.AWS_BEDROCK_ENABLED === 'true' ||
            !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_REGION)

          interface EmbeddingProvider {
            id: string
            url: string
            env: string
            isBedrock?: boolean
            key?: string
          }

          const providers: EmbeddingProvider[] = [
            ...(bedrockEnabled
              ? [
                  {
                    id: 'bedrock',
                    url: 'bedrock',
                    env: 'AWS_BEDROCK_ENABLED',
                    isBedrock: true,
                  },
                ]
              : []),
            {
              id: 'openai',
              url: 'https://api.openai.com/v1',
              env: 'OPENAI_API_KEY',
            },
            {
              id: 'together',
              url: 'https://api.together.xyz/v1',
              env: 'TOGETHER_API_KEY',
            },
            {
              id: 'custom',
              url: process.env.INFERENCE_API_URL ?? '',
              env: 'INFERENCE_API_KEY',
            },
          ]

          let selectedProvider: EmbeddingProvider | null = null
          for (const p of providers) {
            if (p.isBedrock && bedrockEnabled) {
              selectedProvider = { ...p, key: 'bedrock' }
              break
            }
            const key = process.env[p.env]
            if (key && p.url) {
              selectedProvider = { ...p, key }
              break
            }
          }

          if (!selectedProvider) {
            set.status = 503
            return {
              error: 'No embedding provider configured',
              message:
                'Set AWS_BEDROCK_ENABLED=true or OPENAI_API_KEY for embeddings',
              configured: providers.map((p) => p.id),
            }
          }

          if (selectedProvider.isBedrock) {
            const region = process.env.AWS_REGION ?? 'us-east-1'
            const modelId = body.model ?? 'amazon.titan-embed-text-v2:0'
            const inputs = Array.isArray(body.input) ? body.input : [body.input]

            const { BedrockRuntimeClient, InvokeModelCommand } = await import(
              '@aws-sdk/client-bedrock-runtime'
            )
            const client = new BedrockRuntimeClient({ region })

            const embeddings: number[][] = []
            let totalTokens = 0

            for (const text of inputs) {
              const command = new InvokeModelCommand({
                modelId,
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify({ inputText: text }),
              })

              const response = await client.send(command)
              const responseBody = BedrockEmbeddingResponseSchema.parse(
                JSON.parse(new TextDecoder().decode(response.body)),
              )

              embeddings.push(responseBody.embedding)
              totalTokens += responseBody.inputTextTokenCount
            }

            return {
              object: 'list' as const,
              data: embeddings.map((embedding, i) => ({
                object: 'embedding' as const,
                index: i,
                embedding,
              })),
              model: modelId,
              provider: 'bedrock',
              usage: { prompt_tokens: totalTokens, total_tokens: totalTokens },
            }
          }

          const response = await fetch(`${selectedProvider.url}/embeddings`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${selectedProvider.key}`,
            },
            body: JSON.stringify({
              ...body,
              model: body.model ?? 'text-embedding-3-small',
            }),
          })

          if (!response.ok) {
            const errorText = await response.text()
            set.status = response.status as 400 | 401 | 403 | 500
            return {
              error: `${selectedProvider.id} embeddings error: ${errorText}`,
              provider: selectedProvider.id,
            }
          }

          const result = await response.json()
          return { ...result, provider: selectedProvider.id }
        },
        {
          body: t.Object({
            input: t.Union([t.String(), t.Array(t.String())]),
            model: t.Optional(t.String()),
          }),
        },
      )

      // Submit job
      .post(
        '/jobs',
        async ({ body, request, set }) => {
          const submitterHeader = request.headers.get('x-jeju-address')
          if (!submitterHeader) {
            set.status = 401
            return { error: 'x-jeju-address header required' }
          }
          const submitter = submitterHeader as Address

          const jobId = crypto.randomUUID()
          const job: ComputeJob = {
            jobId,
            command: body.command,
            shell: body.shell ?? 'bash',
            env: body.env ?? {},
            workingDir: body.workingDir,
            timeout: body.timeout ?? 30000,
            status: 'queued',
            output: '',
            exitCode: null,
            startedAt: null,
            completedAt: null,
            submittedBy: submitter,
          }

          await computeJobState.save(job)
          processQueue()

          set.status = 201
          return { jobId, status: job.status }
        },
        {
          body: t.Object({
            command: t.String(),
            shell: t.Optional(t.String()),
            env: t.Optional(t.Record(t.String(), t.String())),
            workingDir: t.Optional(t.String()),
            timeout: t.Optional(t.Number()),
          }),
        },
      )

      // Get job
      .get('/jobs/:jobId', async ({ params, set }) => {
        const row = await computeJobState.get(params.jobId)
        if (!row) {
          set.status = 404
          return { error: 'Job not found' }
        }

        return {
          jobId: row.job_id,
          status: row.status,
          output: row.output,
          exitCode: row.exit_code,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          duration:
            row.completed_at && row.started_at
              ? row.completed_at - row.started_at
              : null,
        }
      })

      // Cancel job
      .post('/jobs/:jobId/cancel', async ({ params, set }) => {
        const row = await computeJobState.get(params.jobId)
        if (!row) {
          set.status = 404
          return { error: 'Job not found' }
        }
        if (row.status === 'completed' || row.status === 'failed') {
          set.status = 400
          return { error: 'Job already finished' }
        }

        const job: ComputeJob = {
          jobId: row.job_id,
          command: row.command,
          shell: row.shell,
          env: EnvSchema.parse(JSON.parse(row.env)),
          workingDir: row.working_dir ?? undefined,
          timeout: row.timeout,
          status: 'cancelled',
          output: row.output,
          exitCode: row.exit_code,
          startedAt: row.started_at,
          completedAt: Date.now(),
          submittedBy: row.submitted_by as Address,
        }

        await computeJobState.save(job)
        activeJobs.delete(row.job_id)

        return { jobId: row.job_id, status: 'cancelled' }
      })

      // List jobs
      .get(
        '/jobs',
        async ({ query, request }) => {
          const submitter = request.headers.get('x-jeju-address')
          const limit = query.limit ?? 100

          const rows = await computeJobState.list({
            submittedBy: submitter ?? undefined,
            status: query.status,
            limit,
          })

          return {
            jobs: rows.map((j) => ({
              jobId: j.job_id,
              status: j.status,
              exitCode: j.exit_code,
              startedAt: j.started_at,
              completedAt: j.completed_at,
            })),
            total: rows.length,
          }
        },
        {
          query: t.Object({
            status: t.Optional(t.String()),
            limit: t.Optional(t.Number({ default: 100 })),
          }),
        },
      )

      // Training runs
      .get('/training/runs', async ({ query }) => {
        const status = query.status as
          | 'active'
          | 'completed'
          | 'paused'
          | undefined
        const runs = await trainingState.listRuns(status)

        return runs.map((r) => ({
          runId: r.run_id,
          model: r.model,
          state: r.state,
          clients: r.clients,
          step: r.step,
          totalSteps: r.total_steps,
          createdAt: r.created_at,
        }))
      })

      .get('/training/runs/:runId', async ({ params, set }) => {
        const run = await trainingState.getRun(params.runId)

        if (!run) {
          set.status = 404
          return { error: 'Run not found' }
        }

        return {
          runId: run.run_id,
          model: run.model,
          state: run.state,
          clients: run.clients,
          step: run.step,
          totalSteps: run.total_steps,
          createdAt: run.created_at,
        }
      })

      // Nodes - returns compute nodes for dashboard
      .get('/nodes', async () => {
        const trainingNodes = await trainingState.listNodes(true)

        // Transform training nodes to ComputeNode format expected by frontend
        const nodes = trainingNodes.map((n) => ({
          id: `node-${n.address.slice(2, 10)}`,
          address: n.address as Address,
          region: 'global',
          zone: 'default',
          status: (n.is_active === 1 ? 'online' : 'offline') as
            | 'online'
            | 'offline'
            | 'maintenance',
          resources: {
            totalCpu: 8,
            availableCpu: n.is_active === 1 ? 6 : 0,
            totalMemoryMb: 16384,
            availableMemoryMb: n.is_active === 1 ? 12288 : 0,
          },
          containers: 0,
          cachedImages: 0,
          reputation: n.score,
          lastHeartbeat: Date.now() - (n.is_active === 1 ? 0 : 300000),
        }))

        return { nodes }
      })

      .get('/nodes/stats', async () => {
        const inferenceStats = getNodeStats()
        const trainingStats = await trainingState.getStats()

        return {
          inference: inferenceStats,
          training: {
            totalNodes: trainingStats.totalNodes,
            activeNodes: trainingStats.activeNodes,
            totalRuns: trainingStats.totalRuns,
            activeRuns: trainingStats.activeRuns,
          },
        }
      })

      .get('/nodes/inference', async () => await getActiveNodes())

      .get('/nodes/:address', async ({ params, set }) => {
        const node = await trainingState.getNode(params.address)

        if (!node) {
          set.status = 404
          return { error: 'Node not found' }
        }

        return {
          address: node.address,
          gpuTier: node.gpu_tier,
          score: node.score,
          latencyMs: node.latency_ms,
          bandwidthMbps: node.bandwidth_mbps,
          isActive: node.is_active === 1,
        }
      })

      .post(
        '/nodes/register',
        async ({ body }) => {
          const address = body.address.toLowerCase() as Address

          await trainingState.saveNode({
            address,
            gpuTier: body.gpuTier,
            score: 100,
            latencyMs: 50,
            bandwidthMbps: 1000,
            isActive: true,
          })

          if (body.endpoint && body.capabilities?.includes('inference')) {
            registerNode({
              address,
              name: body.name ?? `node-${address.slice(0, 8)}`,
              endpoint: body.endpoint,
              capabilities: body.capabilities ?? ['inference'],
              models: body.models ?? ['*'],
              provider: body.provider ?? 'local',
              region: body.region ?? 'unknown',
              gpuTier: body.gpuTier,
              maxConcurrent: body.maxConcurrent ?? 10,
              isActive: true,
              teeProvider: body.teeProvider,
            })
          }

          console.log(
            `[Compute] Registered node ${address} with GPU tier ${body.gpuTier}`,
            {
              capabilities: body.capabilities,
              teeProvider: body.teeProvider,
              region: body.region,
              provider: body.provider,
            },
          )

          return {
            success: true,
            address,
            gpuTier: body.gpuTier,
            capabilities: body.capabilities,
          }
        },
        {
          body: t.Object({
            address: t.String(),
            gpuTier: t.Number(),
            name: t.Optional(t.String()),
            endpoint: t.Optional(t.String()),
            capabilities: t.Optional(t.Array(t.String())),
            models: t.Optional(t.Array(t.String())),
            provider: t.Optional(t.String()),
            region: t.Optional(t.String()),
            maxConcurrent: t.Optional(t.Number()),
            teeProvider: t.Optional(t.String()),
          }),
        },
      )

      .post(
        '/nodes/heartbeat',
        async ({ body }) => {
          const address = body.address.toLowerCase()

          await trainingState.updateHeartbeat(address)
          const updated = updateNodeHeartbeat(address, body.load)

          return { success: updated }
        },
        {
          body: t.Object({
            address: t.String(),
            load: t.Optional(t.Number()),
          }),
        },
      )

      .delete('/nodes/:address', async ({ params }) => {
        const address = params.address.toLowerCase()

        await trainingState.deleteNode(address)
        unregisterNode(address)

        return { success: true }
      })

      .post(
        '/training/webhook',
        async ({ body }) => {
          await trainingState.saveRun({
            runId: body.runId,
            model: body.model,
            state: body.state,
            clients: body.clients,
            step: body.step,
            totalSteps: body.totalSteps,
          })

          return { success: true }
        },
        {
          body: t.Object({
            runId: t.String(),
            model: t.String(),
            state: t.Number(),
            clients: t.Number(),
            step: t.Number(),
            totalSteps: t.Number(),
          }),
        },
      )
  )
}
