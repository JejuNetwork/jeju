/**
 * CI/CD Routes
 * API for workflow management and execution
 */

import { Hono } from 'hono';
import type { Address, Hex } from 'viem';
import type { BackendManager } from '../../storage/backends';
import type { GitRepoManager } from '../../git/repo-manager';
import { WorkflowEngine } from '../../ci/workflow-engine';

interface CIContext {
  workflowEngine: WorkflowEngine;
  repoManager: GitRepoManager;
  backend: BackendManager;
}

export function createCIRouter(ctx: CIContext): Hono {
  const router = new Hono();
  const { workflowEngine, repoManager } = ctx;

  // ============ Health Check ============

  router.get('/health', (c) => {
    return c.json({ service: 'dws-ci', status: 'healthy' });
  });

  // ============ Workflow Management ============

  /**
   * GET /workflows/:repoId - List workflows for a repository
   */
  router.get('/workflows/:repoId', async (c) => {
    const repoId = c.req.param('repoId') as Hex;

    const workflows = await workflowEngine.loadRepositoryWorkflows(repoId);

    return c.json({
      workflows: workflows.map((w) => ({
        workflowId: w.workflowId,
        name: w.name,
        description: w.description,
        triggers: w.triggers,
        jobs: w.jobs.map((j) => ({
          jobId: j.jobId,
          name: j.name,
          runsOn: j.runsOn,
          stepCount: j.steps.length,
        })),
        active: w.active,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      })),
    });
  });

  /**
   * GET /workflows/:repoId/:workflowId - Get workflow details
   */
  router.get('/workflows/:repoId/:workflowId', async (c) => {
    const repoId = c.req.param('repoId') as Hex;
    const workflowId = c.req.param('workflowId') as Hex;

    // Load workflows if not already loaded
    await workflowEngine.loadRepositoryWorkflows(repoId);
    const runs = workflowEngine.getWorkflowRuns(workflowId);

    return c.json({
      workflowId,
      runs: runs.map((r) => ({
        runId: r.runId,
        status: r.status,
        conclusion: r.conclusion,
        triggerType: r.triggerType,
        branch: r.branch,
        commitSha: r.commitSha,
        triggeredBy: r.triggeredBy,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
      })),
    });
  });

  // ============ Workflow Runs ============

  /**
   * POST /runs/:repoId/:workflowId - Trigger a workflow run
   */
  router.post('/runs/:repoId/:workflowId', async (c) => {
    const repoId = c.req.param('repoId') as Hex;
    const workflowId = c.req.param('workflowId') as Hex;
    const triggeredBy = c.req.header('x-jeju-address') as Address;

    if (!triggeredBy) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const body = await c.req.json<{
      branch?: string;
      inputs?: Record<string, string>;
    }>();

    // Load workflows
    await workflowEngine.loadRepositoryWorkflows(repoId);

    // Get branch info
    const branch = body.branch || 'main';
    const branchData = await repoManager.getBranch(repoId, branch);

    if (!branchData) {
      return c.json({ error: `Branch not found: ${branch}` }, 404);
    }

    const commitSha = branchData.tipCommitCid.slice(2, 42);

    const run = await workflowEngine.triggerRun(
      workflowId,
      'workflow_dispatch',
      triggeredBy,
      branch,
      commitSha,
      body.inputs || {}
    );

    return c.json({
      runId: run.runId,
      status: run.status,
      workflowId: run.workflowId,
      branch: run.branch,
      commitSha: run.commitSha,
      startedAt: run.startedAt,
    });
  });

  /**
   * GET /runs/:runId - Get run details
   */
  router.get('/runs/:runId', async (c) => {
    const runId = c.req.param('runId');

    const run = workflowEngine.getRun(runId);
    if (!run) {
      return c.json({ error: 'Run not found' }, 404);
    }

    return c.json({
      runId: run.runId,
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
      jobs: run.jobs.map((j) => ({
        jobId: j.jobId,
        name: j.name,
        status: j.status,
        conclusion: j.conclusion,
        startedAt: j.startedAt,
        completedAt: j.completedAt,
        steps: j.steps.map((s) => ({
          stepId: s.stepId,
          name: s.name,
          status: s.status,
          conclusion: s.conclusion,
          startedAt: s.startedAt,
          completedAt: s.completedAt,
          exitCode: s.exitCode,
        })),
      })),
    });
  });

  /**
   * GET /runs/:runId/logs - Get run logs
   */
  router.get('/runs/:runId/logs', async (c) => {
    const runId = c.req.param('runId');

    const run = workflowEngine.getRun(runId);
    if (!run) {
      return c.json({ error: 'Run not found' }, 404);
    }

    const logs: string[] = [];
    logs.push(`=== Workflow Run: ${run.runId} ===`);
    logs.push(`Status: ${run.status}`);
    logs.push(`Conclusion: ${run.conclusion || 'pending'}`);
    logs.push(`Branch: ${run.branch}`);
    logs.push(`Commit: ${run.commitSha}`);
    logs.push('');

    for (const job of run.jobs) {
      logs.push(`--- Job: ${job.name} ---`);
      if (job.logs) {
        logs.push(job.logs);
      }
      logs.push('');
    }

    return new Response(logs.join('\n'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });

  /**
   * POST /runs/:runId/cancel - Cancel a run
   */
  router.post('/runs/:runId/cancel', async (c) => {
    const runId = c.req.param('runId');
    const triggeredBy = c.req.header('x-jeju-address') as Address;

    if (!triggeredBy) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const run = workflowEngine.getRun(runId);
    if (!run) {
      return c.json({ error: 'Run not found' }, 404);
    }

    if (run.status === 'completed' || run.status === 'cancelled' || run.status === 'failed') {
      return c.json({ error: 'Run already finished' }, 400);
    }

    // Mark as cancelled
    run.status = 'cancelled';
    run.conclusion = 'cancelled';
    run.completedAt = Date.now();

    return c.json({ success: true, runId: run.runId, status: run.status });
  });

  // ============ Repository Runs ============

  /**
   * GET /repos/:repoId/runs - Get all runs for a repository
   */
  router.get('/repos/:repoId/runs', async (c) => {
    const repoId = c.req.param('repoId') as Hex;
    const limit = parseInt(c.req.query('limit') || '20');
    const status = c.req.query('status');

    let runs = workflowEngine.getRepositoryRuns(repoId);

    if (status) {
      runs = runs.filter((r) => r.status === status);
    }

    // Sort by startedAt descending
    runs.sort((a, b) => b.startedAt - a.startedAt);

    return c.json({
      runs: runs.slice(0, limit).map((r) => ({
        runId: r.runId,
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
      })),
      total: runs.length,
    });
  });

  // ============ Status Badge ============

  /**
   * GET /badge/:repoId/:workflowId - Get status badge SVG
   */
  router.get('/badge/:repoId/:workflowId', async (c) => {
    const repoId = c.req.param('repoId') as Hex;
    const workflowId = c.req.param('workflowId') as Hex;

    const runs = workflowEngine.getWorkflowRuns(workflowId);
    const latestRun = runs.sort((a, b) => b.startedAt - a.startedAt)[0];

    let color = '#9ca3af'; // gray
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

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="90" height="20">
        <linearGradient id="b" x2="0" y2="100%">
          <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
          <stop offset="1" stop-opacity=".1"/>
        </linearGradient>
        <mask id="a">
          <rect width="90" height="20" rx="3" fill="#fff"/>
        </mask>
        <g mask="url(#a)">
          <rect width="45" height="20" fill="#555"/>
          <rect x="45" width="45" height="20" fill="${color}"/>
          <rect width="90" height="20" fill="url(#b)"/>
        </g>
        <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
          <text x="22.5" y="15" fill="#010101" fill-opacity=".3">build</text>
          <text x="22.5" y="14">build</text>
          <text x="67.5" y="15" fill="#010101" fill-opacity=".3">${status}</text>
          <text x="67.5" y="14">${status}</text>
        </g>
      </svg>
    `.trim();

    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'no-cache',
      },
    });
  });

  return router;
}

