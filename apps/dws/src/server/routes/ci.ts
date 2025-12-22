/**
 * CI/CD Routes - workflow management, execution, logs, artifacts, secrets
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Address, Hex } from 'viem';
import type { BackendManager } from '../../storage/backends';
import type { GitRepoManager } from '../../git/repo-manager';
import { WorkflowEngine } from '../../ci/workflow-engine';
import { getCISecretsStore } from '../../ci/secrets-store';
import { getCIEventBus } from '../../ci/event-bus';
import { getCIScheduler } from '../../ci/scheduler';
import { decodeBytes32ToOid } from '../../git/oid-utils';
import type { LogEntry, CIEvent, Runner } from '../../ci/types';
import { validateBody, validateParams, validateQuery, validateHeaders, expectValid, jejuAddressHeaderSchema, workflowListParamsSchema, workflowDetailParamsSchema, createWorkflowRunRequestSchema, workflowRunParamsSchema, workflowRunListQuerySchema, jobRunParamsSchema, stepRunParamsSchema, logsQuerySchema, artifactListParamsSchema, artifactDownloadParamsSchema, runnerRegistrationRequestSchema, runnerParamsSchema, createSecretRequestSchema, updateSecretRequestSchema, secretParamsSchema, createEnvironmentRequestSchema, updateEnvironmentRequestSchema, environmentParamsSchema, createWebhookRequestSchema, webhookParamsSchema, webhookDeliveryParamsSchema, runIdParamsSchema, artifactParamsSchema, secretIdParamsSchema, environmentNameParamsSchema, createTriggerRequestSchema, triggerParamsSchema, badgeParamsSchema, badgeQuerySchema, z, strictHexSchema } from '../../shared';

interface CIContext {
  workflowEngine: WorkflowEngine;
  repoManager: GitRepoManager;
  backend: BackendManager;
}

export function createCIRouter(ctx: CIContext): Hono {
  const router = new Hono();
  const { workflowEngine, repoManager, backend } = ctx;
  const secretsStore = getCISecretsStore();
  const eventBus = getCIEventBus(workflowEngine);
  const scheduler = getCIScheduler(workflowEngine);

  router.get('/health', (c) => {
    const runners = workflowEngine.getRunners?.()?.length ?? 0;
    const scheduledJobs = scheduler.listJobs?.()?.length ?? 0;
    return c.json({
      service: 'dws-ci',
      status: 'healthy',
      runners,
      scheduledJobs,
    });
  });

  router.get('/workflows/:repoId', async (c) => {
    const { repoId } = validateParams(workflowListParamsSchema, c);
    const workflows = await workflowEngine.loadRepositoryWorkflows(repoId);

    return c.json({
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
    });
  });

  router.get('/workflows/:repoId/:workflowId', async (c) => {
    const { repoId, workflowId } = validateParams(workflowDetailParamsSchema, c);

    await workflowEngine.loadRepositoryWorkflows(repoId);
    const runs = workflowEngine.getWorkflowRuns(workflowId);

    return c.json({
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
    });
  });

  router.post('/runs/:repoId/:workflowId', async (c) => {
    const { repoId, workflowId } = validateParams(workflowDetailParamsSchema, c);
    const { 'x-jeju-address': triggeredBy } = validateHeaders(jejuAddressHeaderSchema, c);

    const body = await validateBody(createWorkflowRunRequestSchema, c);

    await workflowEngine.loadRepositoryWorkflows(repoId);

    const branch = body.branch;
    const branchData = await repoManager.getBranch(repoId, branch);
    if (!branchData) {
      throw new Error(`Branch not found: ${branch}`);
    }

    const run = await workflowEngine.triggerRun(
      workflowId,
      'workflow_dispatch',
      triggeredBy,
      branch,
      decodeBytes32ToOid(branchData.tipCommitCid),
      body.inputs || {}
    );

    return c.json({
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
    });
  });

  router.get('/runs/:runId', async (c) => {
    const { runId } = validateParams(workflowRunParamsSchema, c);
    const run = workflowEngine.getRun(runId);
    if (!run) {
      throw new Error('Run not found');
    }

    return c.json({
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
      duration: run.completedAt ? run.completedAt - run.startedAt : Date.now() - run.startedAt,
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
        duration: j.completedAt && j.startedAt ? j.completedAt - j.startedAt : undefined,
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
    });
  });

  router.get('/runs/:runId/logs', async (c) => {
    const { runId } = validateParams(runIdParamsSchema, c);
    const run = workflowEngine.getRun(runId);
    if (!run) throw new Error('Run not found');

    const { jobId, stepId } = validateQuery(logsQuerySchema, c);

    if (run.logsCid) {
      const result = await backend.download(run.logsCid);
      let logs: LogEntry[] = result.content
        .toString()
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as LogEntry);

      if (jobId) logs = logs.filter((l) => l.jobId === jobId);
      if (stepId) logs = logs.filter((l) => l.stepId === stepId);

      return c.json({ logs });
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
    ];

    return new Response(logs.join('\n'), { headers: { 'Content-Type': 'text/plain' } });
  });

  router.get('/runs/:runId/logs/stream', async (c) => {
    const { runId } = validateParams(z.object({ runId: z.string().min(1) }), c);
    const run = workflowEngine.getRun(runId);
    if (!run) throw new Error('Run not found');

    return streamSSE(c, async (stream) => {
      const unsubscribe = workflowEngine.subscribeToLogs(runId, (entry: LogEntry) => {
        stream.writeSSE({ data: JSON.stringify(entry), event: 'log' });
      });

      stream.writeSSE({ data: JSON.stringify({ status: run.status }), event: 'status' });

      const checkInterval = setInterval(() => {
        const currentRun = workflowEngine.getRun(runId);
        if (!currentRun || currentRun.status === 'completed' || currentRun.status === 'cancelled' || currentRun.status === 'failed') {
          stream.writeSSE({ data: JSON.stringify({ status: currentRun?.status || 'unknown', conclusion: currentRun?.conclusion }), event: 'complete' });
          clearInterval(checkInterval);
          unsubscribe();
        }
      }, 1000);

      c.req.raw.signal.addEventListener('abort', () => {
        clearInterval(checkInterval);
        unsubscribe();
      });

      await new Promise(() => {});
    });
  });

  router.post('/runs/:runId/cancel', async (c) => {
    const { 'x-jeju-address': triggeredBy } = validateHeaders(jejuAddressHeaderSchema, c);
    const { runId } = validateParams(runIdParamsSchema, c);
    const success = workflowEngine.cancelRun(runId);

    if (!success) {
      const run = workflowEngine.getRun(runId);
      if (!run) throw new Error('Run not found');
      throw new Error('Run already finished');
    }

    return c.json({ success: true, runId, status: 'cancelled' });
  });

  router.get('/repos/:repoId/runs', async (c) => {
    const { repoId } = validateParams(z.object({ repoId: strictHexSchema }), c);
    const { limit, status: statusFilter, branch } = validateQuery(workflowRunListQuerySchema.extend({
      branch: z.string().optional(),
    }), c);

    let runs = workflowEngine.getRepositoryRuns(repoId);
    if (statusFilter) runs = runs.filter((r) => r.status === statusFilter);
    if (branch) runs = runs.filter((r) => r.branch === branch);
    runs.sort((a, b) => b.startedAt - a.startedAt);

    return c.json({
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
        duration: r.completedAt ? r.completedAt - r.startedAt : Date.now() - r.startedAt,
        jobCount: r.jobs.length,
        successCount: r.jobs.filter((j) => j.conclusion === 'success').length,
        failedCount: r.jobs.filter((j) => j.conclusion === 'failure').length,
      })),
      total: runs.length,
    });
  });

  router.post('/artifacts', async (c) => {
    const { 'x-jeju-address': triggeredBy } = validateHeaders(jejuAddressHeaderSchema, c);

    const formData = await c.req.formData();
    const file = formData.get('file');
    const name = formData.get('name');
    const runId = formData.get('runId');
    const retentionStr = formData.get('retention');
    
    if (!(file instanceof File) || !name || !runId) {
      throw new Error('Missing required fields: file, name, runId');
    }
    
    const retention = retentionStr ? parseInt(retentionStr as string, 10) : 7;

    const content = Buffer.from(await file.arrayBuffer());
    const artifact = await workflowEngine.uploadArtifact(runId, name, content, [], retention);

    return c.json({ artifactId: artifact.artifactId, name: artifact.name, sizeBytes: artifact.sizeBytes });
  });

  router.get('/artifacts/:runId', async (c) => {
    const { runId } = validateParams(runIdParamsSchema, c);
    const artifacts = workflowEngine.getArtifacts(runId);
    return c.json({ artifacts });
  });

  router.get('/artifacts/:runId/:name', async (c) => {
    const { runId, name } = validateParams(artifactParamsSchema, c);

    const content = await workflowEngine.downloadArtifact(runId, name);
    if (!content) throw new Error('Artifact not found');

    return new Response(content, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${name}.tar.gz"`,
      },
    });
  });

  router.get('/secrets/:repoId', async (c) => {
    const { repoId } = validateParams(z.object({ repoId: strictHexSchema }), c);
    const { 'x-jeju-address': triggeredBy } = validateHeaders(jejuAddressHeaderSchema, c);

    const secrets = secretsStore.listSecrets(repoId);
    return c.json({
      secrets: secrets.map((s) => ({
        secretId: s.secretId,
        name: s.name,
        environment: s.environment,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    });
  });

  router.post('/secrets/:repoId', async (c) => {
    const { repoId } = validateParams(z.object({ repoId: strictHexSchema }), c);
    const { 'x-jeju-address': triggeredBy } = validateHeaders(jejuAddressHeaderSchema, c);
    const body = await validateBody(createSecretRequestSchema, c);

    const secret = await secretsStore.createSecret(repoId, body.name, body.value, triggeredBy, body.environment);
    return c.json({ secretId: secret.secretId, name: secret.name });
  });

  router.put('/secrets/:secretId', async (c) => {
    const { secretId } = validateParams(secretIdParamsSchema, c);
    const { 'x-jeju-address': triggeredBy } = validateHeaders(jejuAddressHeaderSchema, c);
    const body = await validateBody(updateSecretRequestSchema, c);

    const secret = await secretsStore.updateSecret(secretId, body.value, triggeredBy);
    return c.json({ secretId: secret.secretId, updatedAt: secret.updatedAt });
  });

  router.delete('/secrets/:secretId', async (c) => {
    const { secretId } = validateParams(secretIdParamsSchema, c);
    const { 'x-jeju-address': triggeredBy } = validateHeaders(jejuAddressHeaderSchema, c);

    await secretsStore.deleteSecret(secretId, triggeredBy);
    return c.json({ success: true });
  });

  router.get('/environments/:repoId', async (c) => {
    const { repoId } = validateParams(z.object({ repoId: strictHexSchema }), c);
    const environments = secretsStore.listEnvironments(repoId);

    return c.json({
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
    });
  });

  router.post('/environments/:repoId', async (c) => {
    const { repoId } = validateParams(z.object({ repoId: strictHexSchema }), c);
    const { 'x-jeju-address': triggeredBy } = validateHeaders(jejuAddressHeaderSchema, c);
    const body = await validateBody(createEnvironmentRequestSchema, c);

    const env = await secretsStore.createEnvironment(repoId, body.name, triggeredBy, {
      url: body.url,
      protectionRules: body.protectionRules,
      variables: body.variables,
    });

    return c.json({ environmentId: env.environmentId, name: env.name });
  });

  router.get('/environments/:repoId/:name', async (c) => {
    const { repoId, name } = validateParams(environmentNameParamsSchema, c);

    const env = secretsStore.getEnvironment(repoId, name);
    if (!env) throw new Error('Environment not found');

    return c.json({
      environmentId: env.environmentId,
      name: env.name,
      url: env.url,
      protectionRules: env.protectionRules,
      secrets: env.secrets.map((s) => ({ name: s.name, createdAt: s.createdAt })),
      variables: env.variables,
      createdAt: env.createdAt,
      updatedAt: env.updatedAt,
    });
  });

  router.put('/environments/:repoId/:name', async (c) => {
    const { repoId, name } = validateParams(z.object({
      repoId: strictHexSchema,
      name: z.string().min(1),
    }), c);
    const { 'x-jeju-address': triggeredBy } = validateHeaders(jejuAddressHeaderSchema, c);
    const body = await validateBody(updateEnvironmentRequestSchema, c);

    const env = await secretsStore.updateEnvironment(repoId, name, body);
    return c.json({ environmentId: env.environmentId, updatedAt: env.updatedAt });
  });

  router.delete('/environments/:repoId/:name', async (c) => {
    const { repoId, name } = validateParams(environmentNameParamsSchema, c);
    const { 'x-jeju-address': triggeredBy } = validateHeaders(jejuAddressHeaderSchema, c);

    secretsStore.deleteEnvironment(repoId, name);
    return c.json({ success: true });
  });

  router.post('/environments/:repoId/:name/secrets', async (c) => {
    const { repoId, name: envName } = validateParams(environmentNameParamsSchema, c);
    const { 'x-jeju-address': triggeredBy } = validateHeaders(jejuAddressHeaderSchema, c);
    const body = await validateBody(z.object({
      name: z.string().min(1),
      value: z.string().min(1),
    }), c);

    const secret = await secretsStore.addEnvironmentSecret(repoId, envName, body.name, body.value, triggeredBy);
    return c.json({ secretId: secret.secretId, name: secret.name });
  });

  router.get('/runners', async (c) => {
    const { labels: labelsStr } = validateQuery(z.object({ labels: z.string().optional() }), c);
    const labels = labelsStr ? labelsStr.split(',').filter(Boolean) : undefined;
    const runners = workflowEngine.getRunners(labels);

    return c.json({
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
    });
  });

  router.post('/runners', async (c) => {
    const { 'x-jeju-address': triggeredBy } = validateHeaders(jejuAddressHeaderSchema, c);
    const body = await validateBody(runnerRegistrationRequestSchema.extend({
      nodeId: z.string().min(1),
      selfHosted: z.boolean().optional(),
    }), c);

    const runner = workflowEngine.registerRunner({
      runnerId: crypto.randomUUID(),
      name: body.name,
      labels: body.labels,
      nodeId: body.nodeId,
      nodeAddress: triggeredBy,
      capabilities: body.capabilities,
      lastHeartbeat: Date.now(),
      owner: triggeredBy,
      selfHosted: body.selfHosted ?? true,
    });

    return c.json({ runnerId: runner.runnerId, name: runner.name });
  });

  router.post('/runners/:runnerId/heartbeat', async (c) => {
    const { runnerId } = validateParams(runnerParamsSchema, c);
    workflowEngine.runnerHeartbeat(runnerId);
    return c.json({ success: true });
  });

  router.delete('/runners/:runnerId', async (c) => {
    const { runnerId } = validateParams(runnerParamsSchema, c);
    const { 'x-jeju-address': triggeredBy } = validateHeaders(jejuAddressHeaderSchema, c);

    workflowEngine.unregisterRunner(runnerId);
    return c.json({ success: true });
  });

  router.post('/webhooks/:repoId', async (c) => {
    const { repoId } = validateParams(z.object({ repoId: strictHexSchema }), c);
    const { 'x-jeju-event': jejuEvent, 'x-github-event': githubEvent, 'x-jeju-signature': jejuSig, 'x-hub-signature-256': hubSig } = validateHeaders(z.object({
      'x-jeju-event': z.string().optional(),
      'x-github-event': z.string().optional(),
      'x-jeju-signature': z.string().optional(),
      'x-hub-signature-256': z.string().optional(),
    }), c);
    const event = jejuEvent || githubEvent;
    const signature = jejuSig || hubSig;

    if (!event) throw new Error('Missing event header');

    const body = await validateBody(z.record(z.string(), z.unknown()), c);

    let ciEvent: CIEvent;

    switch (event) {
      case 'push':
        ciEvent = {
          type: 'push',
          repoId,
          branch: (body.ref as string).replace('refs/heads/', ''),
          commitSha: body.after as string,
          pusher: (body.pusher as { email: string }).email as Address,
        };
        break;
      case 'pull_request':
        ciEvent = {
          type: 'pull_request',
          repoId,
          action: body.action as string,
          prNumber: (body.pull_request as { number: number }).number,
          headSha: (body.pull_request as { head: { sha: string } }).head.sha,
          baseBranch: (body.pull_request as { base: { ref: string } }).base.ref,
          author: (body.pull_request as { user: { login: string } }).user.login as Address,
        };
        break;
      case 'release':
        ciEvent = {
          type: 'release',
          repoId,
          action: body.action as string,
          tagName: (body.release as { tag_name: string }).tag_name,
          author: (body.sender as { login: string }).login as Address,
        };
        break;
      default:
        throw new Error(`Unsupported event: ${event}`);
    }

    await eventBus.emit(ciEvent);
    return c.json({ success: true, event: ciEvent.type });
  });

  router.get('/schedule', async (c) => {
    const jobs = scheduler.listJobs();
    const nextRuns = scheduler.getNextRuns(20);

    return c.json({
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
    });
  });

  router.post('/schedule/start', async (c) => {
    scheduler.start();
    return c.json({ success: true, message: 'Scheduler started' });
  });

  router.post('/schedule/stop', async (c) => {
    scheduler.stop();
    return c.json({ success: true, message: 'Scheduler stopped' });
  });

  // ============================================================================
  // Simple Triggers API (standalone cron/webhook triggers)
  // ============================================================================
  
  interface SimpleTrigger {
    id: string;
    name: string;
    type: 'cron' | 'webhook' | 'event';
    schedule?: string;
    target: string;
    enabled: boolean;
    owner: Address;
    createdAt: number;
    lastRun?: number;
    lastStatus?: 'success' | 'failure';
  }
  
  const simpleTriggers = new Map<string, SimpleTrigger>();
  
  router.get('/triggers', (c) => {
    const { 'x-jeju-address': owner } = validateHeaders(z.object({ 'x-jeju-address': z.string().optional() }), c);
    let triggers = Array.from(simpleTriggers.values());
    
    if (owner) {
      triggers = triggers.filter(t => t.owner === owner);
    }
    
    return c.json({ triggers });
  });
  
  router.get('/triggers/:id', (c) => {
    const { id } = validateParams(triggerParamsSchema, c);
    const trigger = simpleTriggers.get(id);
    if (!trigger) {
      throw new Error('Trigger not found');
    }
    return c.json({ trigger });
  });
  
  router.post('/triggers', async (c) => {
    const { 'x-jeju-address': owner } = validateHeaders(jejuAddressHeaderSchema, c);
    const body = await validateBody(createTriggerRequestSchema, c);
    
    const trigger: SimpleTrigger = {
      id: crypto.randomUUID(),
      name: body.name,
      type: body.type,
      schedule: body.schedule,
      target: body.target,
      enabled: body.enabled ?? true,
      owner,
      createdAt: Date.now(),
    };
    
    simpleTriggers.set(trigger.id, trigger);
    
    return c.json({ trigger }, 201);
  });
  
  router.put('/triggers/:id', async (c) => {
    const { id } = validateParams(triggerParamsSchema, c);
    const { 'x-jeju-address': owner } = validateHeaders(jejuAddressHeaderSchema, c);
    
    const trigger = simpleTriggers.get(id);
    if (!trigger) {
      throw new Error('Trigger not found');
    }
    
    if (trigger.owner !== owner) {
      throw new Error('Not authorized');
    }
    
    const body = await validateBody(createTriggerRequestSchema.partial(), c);
    const updated = { ...trigger, ...body, id, owner };
    simpleTriggers.set(id, updated);
    
    return c.json({ trigger: updated });
  });
  
  router.delete('/triggers/:id', (c) => {
    const { id } = validateParams(triggerParamsSchema, c);
    const { 'x-jeju-address': owner } = validateHeaders(jejuAddressHeaderSchema, c);
    
    const trigger = simpleTriggers.get(id);
    if (!trigger) {
      throw new Error('Trigger not found');
    }
    
    if (trigger.owner !== owner) {
      throw new Error('Not authorized');
    }
    
    simpleTriggers.delete(id);
    return c.json({ success: true });
  });
  
  router.post('/triggers/:id/run', async (c) => {
    const { id } = validateParams(triggerParamsSchema, c);
    const trigger = simpleTriggers.get(id);
    if (!trigger) {
      throw new Error('Trigger not found');
    }
    
    // Execute the trigger
    const response = await fetch(trigger.target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ triggerId: trigger.id, timestamp: Date.now() }),
    }).catch((err: Error) => ({ error: err.message }));
    
    trigger.lastRun = Date.now();
    
    if ('error' in response) {
      trigger.lastStatus = 'failure';
      return c.json({ success: false, error: response.error });
    }
    
    trigger.lastStatus = response.ok ? 'success' : 'failure';
    return c.json({ success: response.ok, status: response.status });
  });

  router.get('/badge/:repoId/:workflowId', async (c) => {
    const { repoId, workflowId } = validateParams(badgeParamsSchema, c);
    const { branch } = validateQuery(badgeQuerySchema, c);
    let runs = workflowEngine.getWorkflowRuns(workflowId);

    if (branch) {
      runs = runs.filter((r) => r.branch === branch);
    }

    const latestRun = runs.sort((a, b) => b.startedAt - a.startedAt)[0];

    let color = '#9ca3af';
    let status = 'unknown';

    if (latestRun) {
      switch (latestRun.conclusion) {
        case 'success':
          color = '#10b981';
          status = 'passing';
          break;
        case 'failure':
          color = '#ef4444';
          status = 'failing';
          break;
        case 'cancelled':
          color = '#f59e0b';
          status = 'cancelled';
          break;
        default:
          if (latestRun.status === 'in_progress') {
            color = '#3b82f6';
            status = 'running';
          } else if (latestRun.status === 'queued') {
            color = '#6366f1';
            status = 'queued';
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
      </g></svg>`;

    return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' } });
  });

  return router;
}
