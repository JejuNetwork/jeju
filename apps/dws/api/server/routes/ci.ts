/**
 * CI/CD Routes - workflow management, execution, logs, artifacts, secrets
 */

import { expectValid } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import { z } from 'zod'
import { getCIEventBus } from '../../ci/event-bus'
import { getCIScheduler } from '../../ci/scheduler'
import { getCISecretsStore } from '../../ci/secrets-store'
import type { CIEvent, LogEntry } from '../../ci/types'
import type { WorkflowEngine } from '../../ci/workflow-engine'
import { decodeBytes32ToOid } from '../../git/oid-utils'
import type { GitRepoManager } from '../../git/repo-manager'
import {
  artifactParamsSchema,
  badgeParamsSchema,
  badgeQuerySchema,
  createEnvironmentRequestSchema,
  createSecretRequestSchema,
  createTriggerRequestSchema,
  createWorkflowRunRequestSchema,
  environmentNameParamsSchema,
  jejuAddressHeaderSchema,
  logEntrySchema,
  logsQuerySchema,
  runIdParamsSchema,
  runnerParamsSchema,
  runnerRegistrationRequestSchema,
  secretIdParamsSchema,
  strictHexSchema,
  triggerParamsSchema,
  updateEnvironmentRequestSchema,
  updateSecretRequestSchema,
  workflowDetailParamsSchema,
  workflowListParamsSchema,
  workflowRunListQuerySchema,
  workflowRunParamsSchema,
} from '../../shared'
import type { BackendManager } from '../../storage/backends'

interface CIContext {
  workflowEngine: WorkflowEngine
  repoManager: GitRepoManager
  backend: BackendManager
}

function extractHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })
  return headers
}

// Simple Triggers API (standalone cron/webhook triggers)

interface SimpleTrigger {
  id: string
  name: string
  type: 'cron' | 'webhook' | 'event'
  schedule?: string
  target: string
  enabled: boolean
  owner: Address
  createdAt: number
  lastRun?: number
  lastStatus?: 'success' | 'failure'
}

const simpleTriggers = new Map<string, SimpleTrigger>()

export function createCIRouter(ctx: CIContext) {
  const { workflowEngine, repoManager, backend } = ctx
  const secretsStore = getCISecretsStore()
  const eventBus = getCIEventBus(workflowEngine)
  const scheduler = getCIScheduler(workflowEngine)

  return (
    new Elysia({ prefix: '/ci' })
      .get('/health', () => {
        const runners = workflowEngine.getRunners?.()?.length ?? 0
        const scheduledJobs = scheduler.listJobs?.()?.length ?? 0
        return {
          service: 'dws-ci',
          status: 'healthy',
          runners,
          scheduledJobs,
        }
      })

      .get('/workflows/:repoId', async ({ params }) => {
        const { repoId } = expectValid(workflowListParamsSchema, params)
        const workflows = await workflowEngine.loadRepositoryWorkflows(repoId)

        return {
          workflows: workflows.map((w) => ({
            workflowId: w.workflowId,
            name: w.name,
            description: w.description,
            source: w.source,
            triggers: w.triggers.map((t) => ({
              type: t.type,
              branches: t.branches,
              schedule: t.schedule,
            })),
            jobs: w.jobs.map((j) => ({
              jobId: j.jobId,
              name: j.name,
              runsOn: j.runsOn,
              stepCount: j.steps.length,
              hasMatrix: !!j.strategy?.matrix,
            })),
            concurrency: w.concurrency,
            active: w.active,
            createdAt: w.createdAt,
            updatedAt: w.updatedAt,
          })),
        }
      })

      .get('/workflows/:repoId/:workflowId', async ({ params }) => {
        const { repoId, workflowId } = expectValid(
          workflowDetailParamsSchema,
          params,
        )

        await workflowEngine.loadRepositoryWorkflows(repoId)
        const runs = workflowEngine.getWorkflowRuns(workflowId)

        return {
          workflowId,
          runs: runs
            .sort((a, b) => b.startedAt - a.startedAt)
            .slice(0, 50)
            .map((r) => ({
              runId: r.runId,
              runNumber: r.runNumber,
              status: r.status,
              conclusion: r.conclusion,
              triggerType: r.triggerType,
              branch: r.branch,
              commitSha: r.commitSha.slice(0, 7),
              triggeredBy: r.triggeredBy,
              startedAt: r.startedAt,
              completedAt: r.completedAt,
              duration: r.completedAt ? r.completedAt - r.startedAt : undefined,
              jobCount: r.jobs.length,
              environment: r.environment,
            })),
        }
      })

      .post(
        '/trigger/:repoId/:workflowId',
        async ({ params, body, request }) => {
          const { repoId, workflowId } = expectValid(
            workflowDetailParamsSchema,
            params,
          )
          const headers = extractHeaders(request)
          const { 'x-jeju-address': triggeredBy } = expectValid(
            jejuAddressHeaderSchema,
            headers,
          )

          const validBody = expectValid(createWorkflowRunRequestSchema, body)

          await workflowEngine.loadRepositoryWorkflows(repoId)

          const branch = validBody.branch
          const branchData = await repoManager.getBranch(repoId, branch)
          if (!branchData) {
            throw new Error(`Branch not found: ${branch}`)
          }

          const run = await workflowEngine.triggerRun(
            workflowId,
            'workflow_dispatch',
            triggeredBy,
            branch,
            decodeBytes32ToOid(branchData.tipCommitCid),
            validBody.inputs || {},
          )

          return {
            runId: run.runId,
            runNumber: run.runNumber,
            status: run.status,
            workflowId: run.workflowId,
            branch: run.branch,
            commitSha: run.commitSha,
            startedAt: run.startedAt,
            jobs: run.jobs.map((j) => ({
              jobId: j.jobId,
              name: j.name,
              status: j.status,
              matrixValues: j.matrixValues,
            })),
          }
        },
      )

      .get('/runs/:runId', async ({ params }) => {
        const { runId } = expectValid(workflowRunParamsSchema, params)
        const run = workflowEngine.getRun(runId)
        if (!run) {
          throw new Error('Run not found')
        }

        return {
          runId: run.runId,
          runNumber: run.runNumber,
          workflowId: run.workflowId,
          repoId: run.repoId,
          status: run.status,
          conclusion: run.conclusion,
          triggerType: run.triggerType,
          branch: run.branch,
          commitSha: run.commitSha,
          triggeredBy: run.triggeredBy,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          duration: run.completedAt
            ? run.completedAt - run.startedAt
            : Date.now() - run.startedAt,
          environment: run.environment,
          concurrencyGroup: run.concurrencyGroup,
          inputs: run.inputs,
          prNumber: run.prNumber,
          jobs: run.jobs.map((j) => ({
            jobId: j.jobId,
            name: j.name,
            status: j.status,
            conclusion: j.conclusion,
            startedAt: j.startedAt,
            completedAt: j.completedAt,
            duration:
              j.completedAt && j.startedAt
                ? j.completedAt - j.startedAt
                : undefined,
            runnerName: j.runnerName,
            matrixValues: j.matrixValues,
            outputs: j.outputs,
            steps: j.steps.map((s) => ({
              stepId: s.stepId,
              name: s.name,
              status: s.status,
              conclusion: s.conclusion,
              startedAt: s.startedAt,
              completedAt: s.completedAt,
              exitCode: s.exitCode,
              outputs: s.outputs,
            })),
          })),
          artifacts: run.artifacts,
        }
      })

      .get('/runs/:runId/logs', async ({ params, query }) => {
        const { runId } = expectValid(runIdParamsSchema, params)
        const run = workflowEngine.getRun(runId)
        if (!run) throw new Error('Run not found')

        const { jobId, stepId } = expectValid(logsQuerySchema, query)

        if (run.logsCid) {
          const result = await backend.download(run.logsCid)
          let logs: LogEntry[] = result.content
            .toString()
            .split('\n')
            .filter((l) => l.trim())
            .map((l) => expectValid(logEntrySchema, JSON.parse(l), 'log entry'))

          if (jobId) logs = logs.filter((l) => l.jobId === jobId)
          if (stepId) logs = logs.filter((l) => l.stepId === stepId)

          return { logs }
        }

        const logs = [
          `=== Workflow Run: ${run.runId} ===`,
          `Status: ${run.status}`,
          `Conclusion: ${run.conclusion || 'pending'}`,
          `Branch: ${run.branch}`,
          `Commit: ${run.commitSha}`,
          '',
          ...run.jobs
            .filter((j) => !jobId || j.jobId === jobId)
            .flatMap((job) => [
              `--- Job: ${job.name} (${job.status}) ---`,
              job.logs || '(no logs)',
              '',
            ]),
        ]

        return new Response(logs.join('\n'), {
          headers: { 'Content-Type': 'text/plain' },
        })
      })

      .get('/runs/:runId/logs/stream', async ({ params, request }) => {
        const { runId } = expectValid(
          z.object({ runId: z.string().min(1) }),
          params,
        )
        const run = workflowEngine.getRun(runId)
        if (!run) throw new Error('Run not found')

        // SSE stream using native ReadableStream
        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder()

            const unsubscribe = workflowEngine.subscribeToLogs(
              runId,
              (entry: LogEntry) => {
                controller.enqueue(
                  encoder.encode(
                    `event: log\ndata: ${JSON.stringify(entry)}\n\n`,
                  ),
                )
              },
            )

            // Send initial status
            controller.enqueue(
              encoder.encode(
                `event: status\ndata: ${JSON.stringify({ status: run.status })}\n\n`,
              ),
            )

            const checkInterval = setInterval(() => {
              const currentRun = workflowEngine.getRun(runId)
              if (
                !currentRun ||
                currentRun.status === 'completed' ||
                currentRun.status === 'cancelled' ||
                currentRun.status === 'failed'
              ) {
                controller.enqueue(
                  encoder.encode(
                    `event: complete\ndata: ${JSON.stringify({
                      status: currentRun?.status || 'unknown',
                      conclusion: currentRun?.conclusion,
                    })}\n\n`,
                  ),
                )
                clearInterval(checkInterval)
                unsubscribe()
                controller.close()
              }
            }, 1000)

            request.signal.addEventListener('abort', () => {
              clearInterval(checkInterval)
              unsubscribe()
              controller.close()
            })
          },
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        })
      })

      .post('/runs/:runId/cancel', async ({ params, request }) => {
        const headers = extractHeaders(request)
        expectValid(jejuAddressHeaderSchema, headers)
        const { runId } = expectValid(runIdParamsSchema, params)
        const success = workflowEngine.cancelRun(runId)

        if (!success) {
          const run = workflowEngine.getRun(runId)
          if (!run) throw new Error('Run not found')
          throw new Error('Run already finished')
        }

        return { success: true, runId, status: 'cancelled' }
      })

      .get('/repos/:repoId/runs', async ({ params, query }) => {
        const { repoId } = expectValid(
          z.object({ repoId: strictHexSchema }),
          params,
        )
        const {
          limit,
          status: statusFilter,
          branch,
        } = expectValid(
          workflowRunListQuerySchema.extend({
            branch: z.string().optional(),
          }),
          query,
        )

        let runs = workflowEngine.getRepositoryRuns(repoId)
        if (statusFilter) runs = runs.filter((r) => r.status === statusFilter)
        if (branch) runs = runs.filter((r) => r.branch === branch)
        runs.sort((a, b) => b.startedAt - a.startedAt)

        return {
          runs: runs.slice(0, limit).map((r) => ({
            runId: r.runId,
            runNumber: r.runNumber,
            workflowId: r.workflowId,
            status: r.status,
            conclusion: r.conclusion,
            triggerType: r.triggerType,
            branch: r.branch,
            commitSha: r.commitSha.slice(0, 7),
            triggeredBy: r.triggeredBy,
            startedAt: r.startedAt,
            completedAt: r.completedAt,
            duration: r.completedAt
              ? r.completedAt - r.startedAt
              : Date.now() - r.startedAt,
            jobCount: r.jobs.length,
            successCount: r.jobs.filter((j) => j.conclusion === 'success')
              .length,
            failedCount: r.jobs.filter((j) => j.conclusion === 'failure')
              .length,
          })),
          total: runs.length,
        }
      })

      .post('/artifacts', async ({ request }) => {
        const headers = extractHeaders(request)
        expectValid(jejuAddressHeaderSchema, headers)

        const formData = await request.formData()
        const file = formData.get('file')
        const name = formData.get('name')
        const runId = formData.get('runId')
        const retentionStr = formData.get('retention')

        if (
          !(file instanceof File) ||
          typeof name !== 'string' ||
          typeof runId !== 'string'
        ) {
          throw new Error('Missing required fields: file, name, runId')
        }

        const retention =
          typeof retentionStr === 'string' ? parseInt(retentionStr, 10) : 7

        const content = Buffer.from(await file.arrayBuffer())
        const artifact = await workflowEngine.uploadArtifact(
          runId,
          name,
          content,
          [],
          retention,
        )

        return {
          artifactId: artifact.artifactId,
          name: artifact.name,
          sizeBytes: artifact.sizeBytes,
        }
      })

      .get('/artifacts/:runId', async ({ params }) => {
        const { runId } = expectValid(runIdParamsSchema, params)
        const artifacts = workflowEngine.getArtifacts(runId)
        return { artifacts }
      })

      .get('/artifacts/:runId/:name', async ({ params }) => {
        const { runId, name } = expectValid(artifactParamsSchema, params)

        const content = await workflowEngine.downloadArtifact(runId, name)
        if (!content) throw new Error('Artifact not found')

        return new Response(new Uint8Array(content), {
          headers: {
            'Content-Type': 'application/gzip',
            'Content-Disposition': `attachment; filename="${name}.tar.gz"`,
          },
        })
      })

      .get('/secrets/:repoId', async ({ params, request }) => {
        const { repoId } = expectValid(
          z.object({ repoId: strictHexSchema }),
          params,
        )
        const headers = extractHeaders(request)
        expectValid(jejuAddressHeaderSchema, headers)

        const secrets = secretsStore.listSecrets(repoId)
        return {
          secrets: secrets.map((s) => ({
            secretId: s.secretId,
            name: s.name,
            environment: s.environment,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
          })),
        }
      })

      .post('/secrets/:repoId', async ({ params, body, request }) => {
        const { repoId } = expectValid(
          z.object({ repoId: strictHexSchema }),
          params,
        )
        const headers = extractHeaders(request)
        const { 'x-jeju-address': triggeredBy } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )
        const validBody = expectValid(createSecretRequestSchema, body)

        const secret = await secretsStore.createSecret(
          repoId,
          validBody.name,
          validBody.value,
          triggeredBy,
          validBody.environment,
        )
        return { secretId: secret.secretId, name: secret.name }
      })

      .put('/secrets/:secretId', async ({ params, body, request }) => {
        const { secretId } = expectValid(secretIdParamsSchema, params)
        const headers = extractHeaders(request)
        const { 'x-jeju-address': triggeredBy } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )
        const validBody = expectValid(updateSecretRequestSchema, body)

        const secret = await secretsStore.updateSecret(
          secretId,
          validBody.value,
          triggeredBy,
        )
        return { secretId: secret.secretId, updatedAt: secret.updatedAt }
      })

      .delete('/secrets/:secretId', async ({ params, request }) => {
        const { secretId } = expectValid(secretIdParamsSchema, params)
        const headers = extractHeaders(request)
        const { 'x-jeju-address': triggeredBy } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )

        await secretsStore.deleteSecret(secretId, triggeredBy)
        return { success: true }
      })

      .get('/environments/:repoId', async ({ params }) => {
        const { repoId } = expectValid(
          z.object({ repoId: strictHexSchema }),
          params,
        )
        const environments = secretsStore.listEnvironments(repoId)

        return {
          environments: environments.map((e) => ({
            environmentId: e.environmentId,
            name: e.name,
            url: e.url,
            protectionRules: e.protectionRules,
            secretCount: e.secrets.length,
            variableCount: Object.keys(e.variables).length,
            createdAt: e.createdAt,
            updatedAt: e.updatedAt,
          })),
        }
      })

      .post('/environments/:repoId', async ({ params, body, request }) => {
        const { repoId } = expectValid(
          z.object({ repoId: strictHexSchema }),
          params,
        )
        const headers = extractHeaders(request)
        const { 'x-jeju-address': triggeredBy } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )
        const validBody = expectValid(createEnvironmentRequestSchema, body)

        const env = await secretsStore.createEnvironment(
          repoId,
          validBody.name,
          triggeredBy,
          {
            url: validBody.url,
            protectionRules: validBody.protectionRules,
            variables: validBody.variables,
          },
        )

        return { environmentId: env.environmentId, name: env.name }
      })

      .get('/environments/:repoId/:name', async ({ params }) => {
        const { repoId, name } = expectValid(
          environmentNameParamsSchema,
          params,
        )

        const env = secretsStore.getEnvironment(repoId, name)
        if (!env) throw new Error('Environment not found')

        return {
          environmentId: env.environmentId,
          name: env.name,
          url: env.url,
          protectionRules: env.protectionRules,
          secrets: env.secrets.map((s) => ({
            name: s.name,
            createdAt: s.createdAt,
          })),
          variables: env.variables,
          createdAt: env.createdAt,
          updatedAt: env.updatedAt,
        }
      })

      .put('/environments/:repoId/:name', async ({ params, body, request }) => {
        const { repoId, name } = expectValid(
          z.object({
            repoId: strictHexSchema,
            name: z.string().min(1),
          }),
          params,
        )
        const headers = extractHeaders(request)
        expectValid(jejuAddressHeaderSchema, headers)
        const validBody = expectValid(updateEnvironmentRequestSchema, body)

        const env = await secretsStore.updateEnvironment(
          repoId,
          name,
          validBody,
        )
        return {
          environmentId: env.environmentId,
          updatedAt: env.updatedAt,
        }
      })

      .delete('/environments/:repoId/:name', async ({ params, request }) => {
        const { repoId, name } = expectValid(
          environmentNameParamsSchema,
          params,
        )
        const headers = extractHeaders(request)
        expectValid(jejuAddressHeaderSchema, headers)

        secretsStore.deleteEnvironment(repoId, name)
        return { success: true }
      })

      .post(
        '/environments/:repoId/:name/secrets',
        async ({ params, body, request }) => {
          const { repoId, name: envName } = expectValid(
            environmentNameParamsSchema,
            params,
          )
          const headers = extractHeaders(request)
          const { 'x-jeju-address': triggeredBy } = expectValid(
            jejuAddressHeaderSchema,
            headers,
          )
          const validBody = expectValid(
            z.object({
              name: z.string().min(1),
              value: z.string().min(1),
            }),
            body,
          )

          const secret = await secretsStore.addEnvironmentSecret(
            repoId,
            envName,
            validBody.name,
            validBody.value,
            triggeredBy,
          )
          return { secretId: secret.secretId, name: secret.name }
        },
      )

      .get('/runners', async ({ query }) => {
        const { labels: labelsStr } = expectValid(
          z.object({ labels: z.string().optional() }),
          query,
        )
        const labels = labelsStr
          ? labelsStr.split(',').filter(Boolean)
          : undefined
        const runners = workflowEngine.getRunners(labels)

        return {
          runners: runners.map((r) => ({
            runnerId: r.runnerId,
            name: r.name,
            labels: r.labels,
            status: r.status,
            selfHosted: r.selfHosted,
            capabilities: r.capabilities,
            currentRun: r.currentRun,
            lastHeartbeat: r.lastHeartbeat,
            registeredAt: r.registeredAt,
          })),
        }
      })

      .post('/runners', async ({ body, request }) => {
        const headers = extractHeaders(request)
        const { 'x-jeju-address': triggeredBy } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )
        const validBody = expectValid(
          runnerRegistrationRequestSchema.extend({
            nodeId: z.string().min(1),
            selfHosted: z.boolean().optional(),
          }),
          body,
        )

        const runner = workflowEngine.registerRunner({
          runnerId: crypto.randomUUID(),
          name: validBody.name,
          labels: validBody.labels,
          nodeId: validBody.nodeId,
          nodeAddress: triggeredBy,
          capabilities: validBody.capabilities,
          lastHeartbeat: Date.now(),
          owner: triggeredBy,
          selfHosted: validBody.selfHosted ?? true,
        })

        return { runnerId: runner.runnerId, name: runner.name }
      })

      .post('/runners/:runnerId/heartbeat', async ({ params }) => {
        const { runnerId } = expectValid(runnerParamsSchema, params)
        workflowEngine.runnerHeartbeat(runnerId)
        return { success: true }
      })

      .delete('/runners/:runnerId', async ({ params, request }) => {
        const { runnerId } = expectValid(runnerParamsSchema, params)
        const headers = extractHeaders(request)
        expectValid(jejuAddressHeaderSchema, headers)

        workflowEngine.unregisterRunner(runnerId)
        return { success: true }
      })

      .post('/webhooks/:repoId', async ({ params, body, request }) => {
        const { repoId } = expectValid(
          z.object({ repoId: strictHexSchema }),
          params,
        )
        const headers = extractHeaders(request)
        const { 'x-jeju-event': jejuEvent, 'x-github-event': githubEvent } =
          expectValid(
            z.object({
              'x-jeju-event': z.string().optional(),
              'x-github-event': z.string().optional(),
              'x-jeju-signature': z.string().optional(),
              'x-hub-signature-256': z.string().optional(),
            }),
            headers,
          )
        const event = jejuEvent || githubEvent

        if (!event) throw new Error('Missing event header')

        const validBody = expectValid(z.record(z.string(), z.unknown()), body)

        let ciEvent: CIEvent

        switch (event) {
          case 'push':
            ciEvent = {
              type: 'push',
              repoId,
              branch: (validBody.ref as string).replace('refs/heads/', ''),
              commitSha: validBody.after as string,
              pusher: (validBody.pusher as { email: string }).email as Address,
            }
            break
          case 'pull_request':
            ciEvent = {
              type: 'pull_request',
              repoId,
              action: validBody.action as string,
              prNumber: (validBody.pull_request as { number: number }).number,
              headSha: (validBody.pull_request as { head: { sha: string } })
                .head.sha,
              baseBranch: (validBody.pull_request as { base: { ref: string } })
                .base.ref,
              author: (validBody.pull_request as { user: { login: string } })
                .user.login as Address,
            }
            break
          case 'release':
            ciEvent = {
              type: 'release',
              repoId,
              action: validBody.action as string,
              tagName: (validBody.release as { tag_name: string }).tag_name,
              author: (validBody.sender as { login: string }).login as Address,
            }
            break
          default:
            throw new Error(`Unsupported event: ${event}`)
        }

        await eventBus.emit(ciEvent)
        return { success: true, event: ciEvent.type }
      })

      .get('/schedule', async () => {
        const jobs = scheduler.listJobs()
        const nextRuns = scheduler.getNextRuns(20)

        return {
          jobs: jobs.map((j) => ({
            jobId: j.jobId,
            workflowId: j.workflowId,
            repoId: j.repoId,
            cron: j.cron,
            enabled: j.enabled,
            nextRun: new Date(j.nextRun).toISOString(),
            lastRun: j.lastRun ? new Date(j.lastRun).toISOString() : null,
          })),
          nextRuns: nextRuns.map((r) => ({
            jobId: r.job.jobId,
            nextRun: r.nextRun.toISOString(),
          })),
        }
      })

      .post('/schedule/start', async () => {
        scheduler.start()
        return { success: true, message: 'Scheduler started' }
      })

      .post('/schedule/stop', async () => {
        scheduler.stop()
        return { success: true, message: 'Scheduler stopped' }
      })

      // Simple Triggers API

      .get('/triggers', ({ request }) => {
        const headers = extractHeaders(request)
        const { 'x-jeju-address': owner } = expectValid(
          z.object({ 'x-jeju-address': z.string().optional() }),
          headers,
        )
        let triggers = Array.from(simpleTriggers.values())

        if (owner) {
          triggers = triggers.filter((t) => t.owner === owner)
        }

        return { triggers }
      })

      .get('/triggers/:id', ({ params }) => {
        const { id } = expectValid(triggerParamsSchema, params)
        const trigger = simpleTriggers.get(id)
        if (!trigger) {
          throw new Error('Trigger not found')
        }
        return { trigger }
      })

      .post('/triggers', async ({ body, request, set }) => {
        const headers = extractHeaders(request)
        const { 'x-jeju-address': owner } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )
        const validBody = expectValid(createTriggerRequestSchema, body)

        const trigger: SimpleTrigger = {
          id: crypto.randomUUID(),
          name: validBody.name,
          type: validBody.type,
          schedule: validBody.schedule,
          target: validBody.target,
          enabled: validBody.enabled ?? true,
          owner,
          createdAt: Date.now(),
        }

        simpleTriggers.set(trigger.id, trigger)

        set.status = 201
        return { trigger }
      })

      .put('/triggers/:id', async ({ params, body, request }) => {
        const { id } = expectValid(triggerParamsSchema, params)
        const headers = extractHeaders(request)
        const { 'x-jeju-address': owner } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )

        const trigger = simpleTriggers.get(id)
        if (!trigger) {
          throw new Error('Trigger not found')
        }

        if (trigger.owner !== owner) {
          throw new Error('Not authorized')
        }

        const validBody = expectValid(
          createTriggerRequestSchema.partial(),
          body,
        )
        const updated = { ...trigger, ...validBody, id, owner }
        simpleTriggers.set(id, updated)

        return { trigger: updated }
      })

      .delete('/triggers/:id', ({ params, request }) => {
        const { id } = expectValid(triggerParamsSchema, params)
        const headers = extractHeaders(request)
        const { 'x-jeju-address': owner } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )

        const trigger = simpleTriggers.get(id)
        if (!trigger) {
          throw new Error('Trigger not found')
        }

        if (trigger.owner !== owner) {
          throw new Error('Not authorized')
        }

        simpleTriggers.delete(id)
        return { success: true }
      })

      .post('/triggers/:id/run', async ({ params }) => {
        const { id } = expectValid(triggerParamsSchema, params)
        const trigger = simpleTriggers.get(id)
        if (!trigger) {
          throw new Error('Trigger not found')
        }

        // Execute the trigger
        const response = await fetch(trigger.target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            triggerId: trigger.id,
            timestamp: Date.now(),
          }),
        }).catch((err: Error) => ({ error: err.message }))

        trigger.lastRun = Date.now()

        if ('error' in response) {
          trigger.lastStatus = 'failure'
          return { success: false, error: response.error }
        }

        trigger.lastStatus = response.ok ? 'success' : 'failure'
        return { success: response.ok, status: response.status }
      })

      .get('/badge/:repoId/:workflowId', async ({ params, query }) => {
        const { workflowId } = expectValid(badgeParamsSchema, params)
        const { branch } = expectValid(badgeQuerySchema, query)
        let runs = workflowEngine.getWorkflowRuns(workflowId)

        if (branch) {
          runs = runs.filter((r) => r.branch === branch)
        }

        const latestRun = runs.sort((a, b) => b.startedAt - a.startedAt)[0]

        let color = '#9ca3af'
        let status = 'unknown'

        if (latestRun) {
          switch (latestRun.conclusion) {
            case 'success':
              color = '#10b981'
              status = 'passing'
              break
            case 'failure':
              color = '#ef4444'
              status = 'failing'
              break
            case 'cancelled':
              color = '#f59e0b'
              status = 'cancelled'
              break
            default:
              if (latestRun.status === 'in_progress') {
                color = '#3b82f6'
                status = 'running'
              } else if (latestRun.status === 'queued') {
                color = '#6366f1'
                status = 'queued'
              }
          }
        }

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="90" height="20">
      <linearGradient id="b" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
      <mask id="a"><rect width="90" height="20" rx="3" fill="#fff"/></mask>
      <g mask="url(#a)"><rect width="45" height="20" fill="#555"/><rect x="45" width="45" height="20" fill="${color}"/><rect width="90" height="20" fill="url(#b)"/></g>
      <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
        <text x="22.5" y="15" fill="#010101" fill-opacity=".3">build</text><text x="22.5" y="14">build</text>
        <text x="67.5" y="15" fill="#010101" fill-opacity=".3">${status}</text><text x="67.5" y="14">${status}</text>
      </g></svg>`

        return new Response(svg, {
          headers: {
            'Content-Type': 'image/svg+xml',
            'Cache-Control': 'no-cache',
          },
        })
      })
  )
}

export type CIRoutes = ReturnType<typeof createCIRouter>
