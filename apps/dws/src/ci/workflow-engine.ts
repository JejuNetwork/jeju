/**
 * Workflow Engine for Jeju CI/CD
 * GitHub Actions-compatible workflow execution with matrix builds and concurrency
 */

import { keccak256, toBytes, type Address, type Hex } from 'viem';
import YAML from 'yaml';
import type { BackendManager } from '../storage/backends';
import type { GitRepoManager } from '../git/repo-manager';
import type {
  Workflow,
  WorkflowRun,
  WorkflowJob,
  WorkflowStep,
  JobRun,
  StepRun,
  JejuWorkflowConfig,
  JejuJobConfig,
  RunStatus,
  MatrixConfig,
  LogEntry,
  ConcurrencyQueue,
  Runner,
  Artifact,
  ConcurrencyConfig,
} from './types';
import { NATIVE_ACTIONS, resolveAction } from './action-resolver';

export interface WorkflowEngineConfig {
  rpcUrl: string;
  privateKey?: Hex;
  dwsUrl?: string;
}

interface WorkflowContext {
  github: {
    repository: string;
    repository_owner: string;
    repository_url: string;
    ref: string;
    ref_name: string;
    sha: string;
    head_ref?: string;
    base_ref?: string;
    event_name: string;
    event: Record<string, unknown>;
    actor: string;
    run_id: string;
    run_number: number;
    workflow: string;
    job: string;
    workspace: string;
    action: string;
    action_path: string;
    action_ref: string;
    action_repository: string;
    server_url: string;
    api_url: string;
    graphql_url: string;
    token: string;
  };
  env: Record<string, string>;
  secrets: Record<string, string>;
  inputs: Record<string, string>;
  needs: Record<string, { outputs: Record<string, string>; result: string }>;
  matrix: Record<string, string | number | boolean>;
  steps: Record<string, { outputs: Record<string, string>; outcome: string; conclusion: string }>;
  runner: { os: string; arch: string; name: string; temp: string; tool_cache: string };
  job: { status: string; container: Record<string, string>; services: Record<string, Record<string, string>> };
  strategy: { 'fail-fast': boolean; 'max-parallel': number; 'job-index': number; 'job-total': number };
}

export class WorkflowEngine {
  private backend: BackendManager;
  private repoManager: GitRepoManager;
  private dwsUrl: string;

  private workflows = new Map<string, Workflow>();
  private runs = new Map<string, WorkflowRun>();
  private runQueue: string[] = [];
  private isProcessing = false;
  private runCounters = new Map<string, number>();
  private concurrencyQueues = new Map<string, ConcurrencyQueue>();
  private runners = new Map<string, Runner>();
  private logSubscribers = new Map<string, Set<(entry: LogEntry) => void>>();

  constructor(
    config: WorkflowEngineConfig,
    backend: BackendManager,
    repoManager: GitRepoManager
  ) {
    this.backend = backend;
    this.repoManager = repoManager;
    this.dwsUrl = config.dwsUrl || process.env.DWS_URL || 'http://localhost:4030';
  }

  async loadRepositoryWorkflows(repoId: Hex): Promise<Workflow[]> {
    const objectStore = this.repoManager.getObjectStore(repoId);
    const repo = await this.repoManager.getRepository(repoId);
    if (!repo || repo.headCommitCid === '0x'.padEnd(66, '0')) return [];

    const headOid = repo.headCommitCid.slice(2);
    const commit = await objectStore.getCommit(headOid);
    if (!commit) return [];

    const tree = await objectStore.getTree(commit.tree);
    if (!tree) return [];

    const workflows: Workflow[] = [];
    const workflowDirs = [
      { path: '.jeju/workflows', source: 'jeju' as const },
      { path: '.github/workflows', source: 'github' as const },
    ];

    for (const { path, source } of workflowDirs) {
      const parts = path.split('/');
      let currentTree = tree;

      for (const part of parts) {
        const entry = currentTree.entries.find((e) => e.name === part && e.type === 'tree');
        if (!entry) break;
        const nextTree = await objectStore.getTree(entry.oid);
        if (!nextTree) break;
        currentTree = nextTree;
      }

      if (currentTree === tree) continue;

      for (const entry of currentTree.entries) {
        if (entry.type !== 'blob' || !(entry.name.endsWith('.yml') || entry.name.endsWith('.yaml'))) continue;

        const blob = await objectStore.getBlob(entry.oid);
        if (!blob) continue;

        const config = this.parseWorkflowConfig(blob.content.toString('utf8'));
        const workflow = this.configToWorkflow(repoId, entry.name, config, source);
        workflows.push(workflow);
        this.workflows.set(workflow.workflowId, workflow);
      }
    }

    return workflows;
  }

  parseWorkflowConfig(content: string): JejuWorkflowConfig {
    return YAML.parse(content) as JejuWorkflowConfig;
  }

  private configToWorkflow(
    repoId: Hex,
    filename: string,
    config: JejuWorkflowConfig,
    source: 'jeju' | 'github'
  ): Workflow {
    const workflowId = keccak256(toBytes(`${repoId}-${filename}`));
    const triggers = this.parseTriggers(config.on);
    const jobs = this.parseJobs(config.jobs);

    let concurrency: ConcurrencyConfig | undefined;
    if (config.concurrency) {
      if (typeof config.concurrency === 'string') {
        concurrency = { group: config.concurrency, cancelInProgress: true };
      } else {
        concurrency = {
          group: config.concurrency.group,
          cancelInProgress: config.concurrency.cancelInProgress ?? config.concurrency['cancel-in-progress'] ?? false,
        };
      }
    }

    return {
      workflowId,
      repoId,
      name: config.name,
      description: config.description || '',
      triggers,
      jobs,
      env: config.env || {},
      concurrency,
      defaults: config.defaults,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      active: true,
      source,
    };
  }

  private parseTriggers(on: JejuWorkflowConfig['on']) {
    const triggers: Workflow['triggers'] = [];

    if (on.push) {
      triggers.push({
        type: 'push',
        branches: on.push.branches,
        branchesIgnore: on.push['branches-ignore'],
        tags: on.push.tags,
        tagsIgnore: on.push['tags-ignore'],
        paths: on.push.paths,
        pathsIgnore: on.push['paths-ignore'],
      });
    }

    if (on.pull_request) {
      triggers.push({
        type: 'pull_request',
        branches: on.pull_request.branches,
        branchesIgnore: on.pull_request['branches-ignore'],
        types: on.pull_request.types,
        paths: on.pull_request.paths,
        pathsIgnore: on.pull_request['paths-ignore'],
      });
    }

    if (on.schedule) {
      for (const s of on.schedule) {
        triggers.push({ type: 'schedule', schedule: s.cron });
      }
    }

    if (on.workflow_dispatch) {
      triggers.push({ type: 'workflow_dispatch', inputs: on.workflow_dispatch.inputs });
    }

    if (on.release) {
      triggers.push({ type: 'release', types: on.release.types });
    }

    if (on.workflow_call) {
      triggers.push({ type: 'workflow_call', inputs: on.workflow_call.inputs });
    }

    return triggers;
  }

  private parseJobs(jobs: Record<string, JejuJobConfig>): WorkflowJob[] {
    return Object.entries(jobs).map(([jobId, config]) => ({
      jobId,
      name: config.name || jobId,
      runsOn: config['runs-on'],
      needs: typeof config.needs === 'string' ? [config.needs] : config.needs,
      if: config.if,
      env: config.env,
      timeout: config['timeout-minutes'],
      continueOnError: config['continue-on-error'],
      strategy: config.strategy
        ? {
            matrix: config.strategy.matrix || {},
            failFast: config.strategy['fail-fast'] ?? true,
            maxParallel: config.strategy['max-parallel'],
          }
        : undefined,
      outputs: config.outputs,
      environment:
        typeof config.environment === 'string'
          ? config.environment
          : config.environment
            ? { name: config.environment.name, url: config.environment.url }
            : undefined,
      concurrency:
        typeof config.concurrency === 'string'
          ? { group: config.concurrency, cancelInProgress: true }
          : config.concurrency,
      services: config.services,
      container: typeof config.container === 'string' ? { image: config.container } : config.container,
      steps: config.steps.map((step, i) => ({
        stepId: step.id || `step-${i}`,
        id: step.id,
        name: step.name,
        if: step.if,
        uses: step.uses,
        run: step.run,
        with: step.with,
        env: step.env,
        workingDirectory: step['working-directory'],
        shell: step.shell,
        timeoutMinutes: step['timeout-minutes'],
        continueOnError: step['continue-on-error'],
      })),
    }));
  }

  async triggerRun(
    workflowId: Hex,
    triggerType: 'push' | 'pull_request' | 'schedule' | 'workflow_dispatch' | 'release',
    triggeredBy: Address,
    branch: string,
    commitSha: string,
    inputs: Record<string, string> = {},
    prNumber?: number
  ): Promise<WorkflowRun> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

    const counterKey = `${workflow.repoId}-${workflowId}`;
    const runNumber = (this.runCounters.get(counterKey) || 0) + 1;
    this.runCounters.set(counterKey, runNumber);

    const runId = keccak256(toBytes(`${workflowId}-${runNumber}-${Date.now()}`));

    let concurrencyGroup: string | undefined;
    if (workflow.concurrency) {
      concurrencyGroup = this.interpolateString(workflow.concurrency.group, {
        github: { ref: `refs/heads/${branch}`, head_ref: branch, workflow: workflow.name },
      } as Partial<WorkflowContext>);

      if (workflow.concurrency.cancelInProgress) {
        await this.cancelConcurrentRuns(workflow.repoId, concurrencyGroup);
      }
    }

    const run: WorkflowRun = {
      runId,
      workflowId,
      repoId: workflow.repoId,
      runNumber,
      triggeredBy,
      triggerType,
      branch,
      commitSha,
      status: 'queued',
      startedAt: Date.now(),
      jobs: [],
      artifacts: [],
      concurrencyGroup,
      inputs,
      prNumber,
    };

    for (const job of workflow.jobs) {
      if (job.strategy?.matrix) {
        const combinations = this.expandMatrix(job.strategy.matrix);
        for (let i = 0; i < combinations.length; i++) {
          const matrixName = Object.entries(combinations[i])
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');
          run.jobs.push({
            jobId: `${job.jobId}-${i}`,
            name: `${job.name} (${matrixName})`,
            status: 'queued',
            steps: job.steps.map((step) => ({
              stepId: step.stepId,
              name: step.name || step.stepId,
              status: 'queued',
            })),
            matrixValues: combinations[i],
          });
        }
      } else {
        run.jobs.push({
          jobId: job.jobId,
          name: job.name,
          status: 'queued',
          steps: job.steps.map((step) => ({
            stepId: step.stepId,
            name: step.name || step.stepId,
            status: 'queued',
          })),
        });
      }
    }

    this.runs.set(runId, run);
    this.runQueue.push(runId);
    this.processQueue();

    return run;
  }

  private expandMatrix(matrix: MatrixConfig): Record<string, string | number | boolean>[] {
    const include = matrix.include || [];
    const exclude = matrix.exclude || [];

    const keys = Object.keys(matrix).filter((k) => k !== 'include' && k !== 'exclude');
    if (keys.length === 0) return include;

    const combinations: Record<string, string | number | boolean>[] = [];

    const expand = (index: number, current: Record<string, string | number | boolean>) => {
      if (index === keys.length) {
        const isExcluded = exclude.some((ex) =>
          Object.entries(ex).every(([k, v]) => current[k] === v)
        );
        if (!isExcluded) combinations.push({ ...current });
        return;
      }

      const key = keys[index];
      const values = matrix[key] as (string | number | boolean)[];
      for (const value of values) {
        expand(index + 1, { ...current, [key]: value });
      }
    };

    expand(0, {});

    for (const inc of include) {
      const exists = combinations.some((c) =>
        Object.entries(inc).every(([k, v]) => c[k] === v)
      );
      if (!exists) combinations.push(inc);
    }

    return combinations;
  }

  private async cancelConcurrentRuns(repoId: Hex, group: string): Promise<void> {
    for (const [runId, run] of this.runs) {
      if (
        run.repoId === repoId &&
        run.concurrencyGroup === group &&
        (run.status === 'queued' || run.status === 'in_progress')
      ) {
        run.status = 'cancelled';
        run.conclusion = 'cancelled';
        run.completedAt = Date.now();
        for (const job of run.jobs) {
          if (job.status === 'queued' || job.status === 'in_progress') {
            job.status = 'cancelled';
            job.conclusion = 'cancelled';
          }
        }
        this.log(runId, 'system', 'info', 'Run cancelled by newer run in same concurrency group');
      }
    }
  }

  getRun(runId: string): WorkflowRun | undefined {
    return this.runs.get(runId);
  }

  getWorkflowRuns(workflowId: Hex): WorkflowRun[] {
    return Array.from(this.runs.values()).filter((run) => run.workflowId === workflowId);
  }

  getRepositoryRuns(repoId: Hex): WorkflowRun[] {
    return Array.from(this.runs.values()).filter((run) => run.repoId === repoId);
  }

  cancelRun(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run || run.status === 'completed' || run.status === 'cancelled' || run.status === 'failed') {
      return false;
    }

    run.status = 'cancelled';
    run.conclusion = 'cancelled';
    run.completedAt = Date.now();

    for (const job of run.jobs) {
      if (job.status === 'queued' || job.status === 'in_progress') {
        job.status = 'cancelled';
        job.conclusion = 'cancelled';
        job.completedAt = Date.now();
      }
    }

    this.log(runId, 'system', 'info', 'Run cancelled by user');
    return true;
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.runQueue.length > 0) {
      const runId = this.runQueue.shift();
      if (!runId) continue;

      const run = this.runs.get(runId);
      if (!run || run.status !== 'queued') continue;

      await this.executeRun(run);
    }

    this.isProcessing = false;
  }

  private async executeRun(run: WorkflowRun): Promise<void> {
    run.status = 'in_progress';
    run.startedAt = Date.now();

    const workflow = this.workflows.get(run.workflowId);
    if (!workflow) {
      run.status = 'failed';
      run.conclusion = 'failure';
      return;
    }

    this.log(run.runId, 'system', 'info', `Starting workflow: ${workflow.name}`);

    const completedJobs = new Set<string>();
    const failedJobs = new Set<string>();
    const jobOutputs: Record<string, Record<string, string>> = {};

    const getBaseJobId = (jobId: string) => jobId.replace(/-\d+$/, '');

    for (const jobRun of run.jobs) {
      if (run.status === 'cancelled') break;

      const baseJobId = getBaseJobId(jobRun.jobId);
      const jobConfig = workflow.jobs.find((j) => j.jobId === baseJobId);
      if (!jobConfig) continue;

      if (jobConfig.needs) {
        const needsMet = jobConfig.needs.every((dep) => {
          return run.jobs.some((j) => getBaseJobId(j.jobId) === dep && j.conclusion === 'success');
        });
        const needsFailed = jobConfig.needs.some((dep) => {
          return run.jobs.some(
            (j) => getBaseJobId(j.jobId) === dep && (j.conclusion === 'failure' || j.conclusion === 'cancelled')
          );
        });

        if (needsFailed) {
          jobRun.status = 'skipped';
          jobRun.conclusion = 'skipped';
          continue;
        }

        if (!needsMet) {
          continue;
        }
      }

      const needsContext: Record<string, { outputs: Record<string, string>; result: string }> = {};
      for (const dep of jobConfig.needs || []) {
        needsContext[dep] = {
          outputs: jobOutputs[dep] || {},
          result: run.jobs.find((j) => getBaseJobId(j.jobId) === dep)?.conclusion || 'skipped',
        };
      }

      await this.executeJob(run, jobRun, jobConfig, workflow, needsContext);

      if (jobRun.outputs) {
        jobOutputs[baseJobId] = { ...(jobOutputs[baseJobId] || {}), ...jobRun.outputs };
      }

      if (jobRun.conclusion === 'success') {
        completedJobs.add(baseJobId);
      } else if (jobRun.conclusion === 'failure' && !jobConfig.continueOnError) {
        failedJobs.add(baseJobId);
        if (jobConfig.strategy?.failFast !== false) {
          for (const otherJob of run.jobs) {
            if (
              otherJob.matrixValues &&
              getBaseJobId(otherJob.jobId) === baseJobId &&
              otherJob.status === 'queued'
            ) {
              otherJob.status = 'cancelled';
              otherJob.conclusion = 'cancelled';
            }
          }
        }
      }
    }

    run.completedAt = Date.now();
    run.status = 'completed';

    if (run.jobs.some((j) => j.conclusion === 'failure')) {
      run.conclusion = 'failure';
    } else if (run.jobs.every((j) => j.conclusion === 'skipped' || j.conclusion === 'cancelled')) {
      run.conclusion = 'cancelled';
    } else {
      run.conclusion = 'success';
    }

    this.log(run.runId, 'system', 'info', `Workflow completed: ${run.conclusion}`);
    await this.persistLogs(run);
  }

  private async executeJob(
    run: WorkflowRun,
    jobRun: JobRun,
    jobConfig: WorkflowJob,
    workflow: Workflow,
    needsContext: Record<string, { outputs: Record<string, string>; result: string }>
  ): Promise<void> {
    jobRun.status = 'in_progress';
    jobRun.startedAt = Date.now();

    this.log(run.runId, jobRun.jobId, 'info', `Starting job: ${jobRun.name}`);

    const context = this.createContext(run, workflow, jobRun, needsContext);

    if (jobConfig.if) {
      const shouldRun = this.evaluateExpression(jobConfig.if, context);
      if (!shouldRun) {
        jobRun.status = 'completed';
        jobRun.conclusion = 'skipped';
        jobRun.completedAt = Date.now();
        return;
      }
    }

    const stepsContext: Record<string, { outputs: Record<string, string>; outcome: string; conclusion: string }> = {};
    let jobSuccess = true;

    for (let i = 0; i < jobRun.steps.length; i++) {
      if (run.status === 'cancelled') {
        jobRun.status = 'cancelled';
        jobRun.conclusion = 'cancelled';
        jobRun.completedAt = Date.now();
        return;
      }

      const stepRun = jobRun.steps[i];
      const stepConfig = jobConfig.steps[i];

      context.steps = stepsContext;

      if (!jobSuccess && !stepConfig.continueOnError) {
        if (!stepConfig.if || !this.evaluateExpression(stepConfig.if, context)) {
          stepRun.status = 'skipped';
          stepRun.conclusion = 'skipped';
          continue;
        }
      }

      if (stepConfig.if) {
        const shouldRun = this.evaluateExpression(stepConfig.if, context);
        if (!shouldRun) {
          stepRun.status = 'skipped';
          stepRun.conclusion = 'skipped';
          stepsContext[stepConfig.id || stepConfig.stepId] = {
            outputs: {},
            outcome: 'skipped',
            conclusion: 'skipped',
          };
          continue;
        }
      }

      await this.executeStep(run, jobRun, stepRun, stepConfig, context);

      const stepId = stepConfig.id || stepConfig.stepId;
      stepsContext[stepId] = {
        outputs: stepRun.outputs || {},
        outcome: stepRun.conclusion || 'success',
        conclusion: stepRun.conclusion || 'success',
      };

      if (stepRun.conclusion === 'failure' && !stepConfig.continueOnError) {
        jobSuccess = false;
      }
    }

    jobRun.completedAt = Date.now();
    jobRun.status = 'completed';
    jobRun.conclusion = jobSuccess ? 'success' : 'failure';

    if (jobConfig.outputs) {
      jobRun.outputs = {};
      for (const [key, expr] of Object.entries(jobConfig.outputs)) {
        jobRun.outputs[key] = this.interpolateString(expr, context);
      }
    }

    this.log(run.runId, jobRun.jobId, 'info', `Job completed: ${jobRun.conclusion}`);
  }

  private async executeStep(
    run: WorkflowRun,
    jobRun: JobRun,
    stepRun: StepRun,
    stepConfig: WorkflowStep,
    context: WorkflowContext
  ): Promise<void> {
    stepRun.status = 'in_progress';
    stepRun.startedAt = Date.now();

    this.log(run.runId, jobRun.jobId, 'group', `Run ${stepRun.name}`, stepRun.stepId);

    if (stepConfig.uses) {
      await this.executeAction(run, jobRun, stepRun, stepConfig, context);
    } else if (stepConfig.run) {
      const command = this.interpolateString(stepConfig.run, context);
      this.log(run.runId, jobRun.jobId, 'command', command, stepRun.stepId);

      const result = await this.executeCommand(
        command,
        stepConfig.shell || 'bash',
        stepConfig.workingDirectory,
        { ...context.env, ...this.interpolateEnv(stepConfig.env || {}, context) },
        run.runId,
        jobRun.jobId,
        stepRun.stepId
      );

      stepRun.output = result.output;
      stepRun.exitCode = result.exitCode;
      stepRun.outputs = result.outputs;
      stepRun.conclusion = result.exitCode === 0 ? 'success' : 'failure';
    } else {
      stepRun.conclusion = 'skipped';
    }

    stepRun.completedAt = Date.now();
    stepRun.status = 'completed';

    this.log(run.runId, jobRun.jobId, 'endgroup', '', stepRun.stepId);
  }

  private async executeAction(
    run: WorkflowRun,
    jobRun: JobRun,
    stepRun: StepRun,
    stepConfig: WorkflowStep,
    context: WorkflowContext
  ): Promise<void> {
    const actionRef = stepConfig.uses!;
    this.log(run.runId, jobRun.jobId, 'info', `Using action: ${actionRef}`, stepRun.stepId);

    const resolved = resolveAction(actionRef);
    const action = resolved?.action || NATIVE_ACTIONS[actionRef];

    if (!action) {
      this.log(run.runId, jobRun.jobId, 'warn', `Action not implemented: ${actionRef}`, stepRun.stepId);
      stepRun.conclusion = 'failure';
      return;
    }

    const inputs = this.interpolateEnv(stepConfig.with || {}, context);

    if (action.runs.using === 'composite' && action.runs.steps) {
      for (const actionStep of action.runs.steps) {
        if (actionStep.run) {
          let command = actionStep.run;
          for (const [key, value] of Object.entries(inputs)) {
            command = command.replace(new RegExp(`\\$\\{\\{\\s*inputs\\.${key}\\s*\\}\\}`, 'g'), value);
          }
          command = this.interpolateString(command, context);

          this.log(run.runId, jobRun.jobId, 'command', command, stepRun.stepId);

          const result = await this.executeCommand(
            command,
            'bash',
            stepConfig.workingDirectory,
            { ...context.env, ...this.interpolateEnv(actionStep.env || {}, context) },
            run.runId,
            jobRun.jobId,
            stepRun.stepId
          );

          if (result.outputs) {
            stepRun.outputs = { ...(stepRun.outputs || {}), ...result.outputs };
          }

          if (result.exitCode !== 0) {
            stepRun.conclusion = 'failure';
            return;
          }
        }
      }
    }

    stepRun.conclusion = 'success';
  }

  private async executeCommand(
    command: string,
    shell: string,
    workingDir: string | undefined,
    env: Record<string, string>,
    runId: string,
    jobId: string,
    stepId: string
  ): Promise<{ output: string; exitCode: number; outputs: Record<string, string> }> {
    const outputFile = `/tmp/github_output_${runId}_${jobId}_${stepId}`;
    const envFile = `/tmp/github_env_${runId}_${jobId}_${stepId}`;

    const shellPath = shell === 'pwsh' ? 'pwsh' : shell === 'python' ? 'python3' : '/bin/bash';
    const shellArgs = shell === 'python' ? ['-c', command] : ['-e', '-c', command];

    const outputs: string[] = [];
    const outputsMap: Record<string, string> = {};

    const proc = Bun.spawn([shellPath, ...shellArgs], {
      cwd: workingDir || process.cwd(),
      env: {
        ...process.env,
        ...env,
        CI: 'true',
        JEJU_CI: 'true',
        GITHUB_OUTPUT: outputFile,
        GITHUB_ENV: envFile,
        GITHUB_STEP_SUMMARY: '/tmp/step_summary',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const decoder = new TextDecoder();

    const readStream = async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      stream: 'stdout' | 'stderr'
    ) => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        outputs.push(text);
        this.log(runId, jobId, stream === 'stderr' ? 'error' : 'info', text, stepId, stream);
      }
    };

    await Promise.all([
      readStream(proc.stdout.getReader(), 'stdout'),
      readStream(proc.stderr.getReader(), 'stderr'),
    ]);

    const exitCode = await proc.exited;

    const file = Bun.file(outputFile);
    if (await file.exists()) {
      const content = await file.text();
      for (const line of content.split('\n')) {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
          outputsMap[match[1]] = match[2];
        }
      }
    }

    return { output: outputs.join(''), exitCode, outputs: outputsMap };
  }

  private createContext(
    run: WorkflowRun,
    workflow: Workflow,
    jobRun: JobRun,
    needsContext: Record<string, { outputs: Record<string, string>; result: string }>
  ): WorkflowContext {
    return {
      github: {
        repository: `${run.triggeredBy}/${workflow.name}`,
        repository_owner: run.triggeredBy,
        repository_url: `${this.dwsUrl}/git/${run.repoId}`,
        ref: `refs/heads/${run.branch}`,
        ref_name: run.branch,
        sha: run.commitSha,
        head_ref: run.branch,
        base_ref: 'main',
        event_name: run.triggerType,
        event: {},
        actor: run.triggeredBy,
        run_id: run.runId,
        run_number: run.runNumber,
        workflow: workflow.name,
        job: jobRun.jobId,
        workspace: '/workspace',
        action: '',
        action_path: '',
        action_ref: '',
        action_repository: '',
        server_url: this.dwsUrl,
        api_url: `${this.dwsUrl}/api`,
        graphql_url: `${this.dwsUrl}/graphql`,
        token: '',
      },
      env: { ...workflow.env, ...process.env as Record<string, string> },
      secrets: {},
      inputs: run.inputs || {},
      needs: needsContext,
      matrix: jobRun.matrixValues || {},
      steps: {},
      runner: {
        os: 'Linux',
        arch: process.arch === 'arm64' ? 'ARM64' : 'X64',
        name: jobRun.runnerName || 'jeju-runner',
        temp: '/tmp',
        tool_cache: '/opt/hostedtoolcache',
      },
      job: { status: jobRun.status, container: {}, services: {} },
      strategy: {
        'fail-fast': true,
        'max-parallel': 1,
        'job-index': 0,
        'job-total': 1,
      },
    };
  }

  private interpolateString(template: string, context: Partial<WorkflowContext>): string {
    return template.replace(/\$\{\{\s*([^}]+)\s*\}\}/g, (_, expr) => {
      return this.evaluateExpression(expr.trim(), context as WorkflowContext);
    });
  }

  private interpolateEnv(
    env: Record<string, string>,
    context: WorkflowContext
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      result[key] = this.interpolateString(value, context);
    }
    return result;
  }

  private evaluateExpression(expr: string, context: WorkflowContext): string {
    const originalExpr = expr;

    expr = expr.replace(/\bsuccess\(\)/g, `"${context.job?.status === 'success' || !context.job?.status ? 'true' : 'false'}"`);
    expr = expr.replace(/\bfailure\(\)/g, `"${context.job?.status === 'failure' ? 'true' : 'false'}"`);
    expr = expr.replace(/\bcancelled\(\)/g, `"${context.job?.status === 'cancelled' ? 'true' : 'false'}"`);
    expr = expr.replace(/\balways\(\)/g, '"true"');

    expr = expr.replace(/\bcontains\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, (_, arr, val) => {
      const arrVal = this.resolveValue(arr.trim(), context);
      const valVal = this.resolveValue(val.trim(), context);
      if (Array.isArray(arrVal)) {
        return arrVal.includes(valVal) ? 'true' : 'false';
      }
      if (typeof arrVal === 'string' && typeof valVal === 'string') {
        return arrVal.includes(valVal) ? 'true' : 'false';
      }
      return 'false';
    });

    expr = expr.replace(/\bstartsWith\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, (_, str, prefix) => {
      const strVal = String(this.resolveValue(str.trim(), context));
      const prefixVal = String(this.resolveValue(prefix.trim(), context));
      return strVal.startsWith(prefixVal) ? 'true' : 'false';
    });

    expr = expr.replace(/\bendsWith\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, (_, str, suffix) => {
      const strVal = String(this.resolveValue(str.trim(), context));
      const suffixVal = String(this.resolveValue(suffix.trim(), context));
      return strVal.endsWith(suffixVal) ? 'true' : 'false';
    });

    expr = expr.replace(/\bformat\s*\(\s*'([^']+)'\s*(?:,\s*([^)]+))?\s*\)/g, (_, fmt, args) => {
      let result = fmt;
      if (args) {
        const argList = args.split(',').map((a: string) => this.resolveValue(a.trim(), context));
        argList.forEach((arg: string | number | boolean, i: number) => {
          result = result.replace(`{${i}}`, String(arg));
        });
      }
      return `'${result}'`;
    });

    expr = expr.replace(/\bjoin\s*\(\s*([^,]+)\s*(?:,\s*([^)]+))?\s*\)/g, (_, arr, sep) => {
      const arrVal = this.resolveValue(arr.trim(), context);
      const sepVal = sep ? this.resolveValue(sep.trim(), context) : ',';
      if (Array.isArray(arrVal)) {
        return `'${arrVal.join(String(sepVal))}'`;
      }
      return `'${String(arrVal)}'`;
    });

    expr = expr.replace(/\btoJSON\s*\(\s*([^)]+)\s*\)/g, (_, val) => {
      const resolved = this.resolveValue(val.trim(), context);
      return `'${JSON.stringify(resolved)}'`;
    });

    expr = expr.replace(/\bfromJSON\s*\(\s*([^)]+)\s*\)/g, (_, val) => {
      const resolved = this.resolveValue(val.trim(), context);
      return JSON.stringify(JSON.parse(String(resolved)));
    });

    const pathMatch = expr.match(/^(github|env|secrets|inputs|needs|matrix|steps|runner|job|strategy)\.(.+)$/);
    if (pathMatch) {
      const resolved = this.resolveValue(expr, context);
      return String(resolved);
    }

    if (expr.includes('==') || expr.includes('!=') || expr.includes('&&') || expr.includes('||')) {
      const boolExpr = expr
        .replace(/([a-zA-Z_.][a-zA-Z0-9_.]*)/g, (match) => {
          if (['true', 'false', 'null'].includes(match)) return match;
          const resolved = this.resolveValue(match, context);
          return typeof resolved === 'string' ? `'${resolved}'` : String(resolved);
        });

      const result = this.evalBooleanExpression(boolExpr);
      return result ? 'true' : 'false';
    }

    return originalExpr;
  }

  private resolveValue(path: string, context: WorkflowContext): string | number | boolean | Record<string, unknown> | unknown[] {
    if (path.startsWith("'") && path.endsWith("'")) {
      return path.slice(1, -1);
    }
    if (path.startsWith('"') && path.endsWith('"')) {
      return path.slice(1, -1);
    }
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return '';
    if (/^\d+$/.test(path)) return parseInt(path);
    if (/^\d+\.\d+$/.test(path)) return parseFloat(path);

    const parts = path.split('.');
    let current: unknown = context;

    for (const part of parts) {
      if (current === null || current === undefined) return '';
      if (typeof current !== 'object') return '';

      const bracketMatch = part.match(/^([^\[]+)\[['"]?([^\]'"]+)['"]?\]$/);
      if (bracketMatch) {
        current = (current as Record<string, unknown>)[bracketMatch[1]];
        if (current === null || current === undefined) return '';
        current = (current as Record<string, unknown>)[bracketMatch[2]];
      } else {
        current = (current as Record<string, unknown>)[part];
      }
    }

    if (current === undefined || current === null) return '';
    return current as string | number | boolean | Record<string, unknown> | unknown[];
  }

  private evalBooleanExpression(expr: string): boolean {
    expr = expr.trim();

    if (expr.includes('||')) {
      const parts = expr.split('||');
      return parts.some((p) => this.evalBooleanExpression(p));
    }

    if (expr.includes('&&')) {
      const parts = expr.split('&&');
      return parts.every((p) => this.evalBooleanExpression(p));
    }

    if (expr.startsWith('!')) {
      return !this.evalBooleanExpression(expr.slice(1));
    }

    if (expr.includes('==')) {
      const [left, right] = expr.split('==').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
      return left === right;
    }

    if (expr.includes('!=')) {
      const [left, right] = expr.split('!=').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
      return left !== right;
    }

    return expr === 'true' || expr === "'true'" || (expr !== 'false' && expr !== "'false'" && expr !== '' && expr !== "''");
  }

  private log(
    runId: string,
    jobId: string,
    level: LogEntry['level'],
    message: string,
    stepId?: string,
    stream: 'stdout' | 'stderr' = 'stdout'
  ): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      runId,
      jobId,
      stepId,
      level,
      message,
      stream,
    };

    const subscribers = this.logSubscribers.get(runId);
    if (subscribers) {
      for (const callback of subscribers) {
        callback(entry);
      }
    }
  }

  subscribeToLogs(runId: string, callback: (entry: LogEntry) => void): () => void {
    let subscribers = this.logSubscribers.get(runId);
    if (!subscribers) {
      subscribers = new Set();
      this.logSubscribers.set(runId, subscribers);
    }
    subscribers.add(callback);

    return () => {
      subscribers?.delete(callback);
      if (subscribers?.size === 0) {
        this.logSubscribers.delete(runId);
      }
    };
  }

  private async persistLogs(run: WorkflowRun): Promise<void> {
    const logs: LogEntry[] = [];
    for (const job of run.jobs) {
      if (job.logs) {
        logs.push({
          timestamp: job.startedAt || run.startedAt,
          runId: run.runId,
          jobId: job.jobId,
          level: 'info',
          message: job.logs,
          stream: 'stdout',
        });
      }
    }

    if (logs.length > 0) {
      const logBuffer = Buffer.from(logs.map((l) => JSON.stringify(l)).join('\n'));
      const result = await this.backend.upload(logBuffer, {
        filename: `ci-logs/${run.runId}.jsonl`,
      });
      run.logsCid = result.cid;
    }
  }

  registerRunner(runner: Omit<Runner, 'registeredAt' | 'status'>): Runner {
    const fullRunner: Runner = {
      ...runner,
      status: 'idle',
      registeredAt: Date.now(),
    };
    this.runners.set(runner.runnerId, fullRunner);
    return fullRunner;
  }

  unregisterRunner(runnerId: string): void {
    this.runners.delete(runnerId);
  }

  getRunner(runnerId: string): Runner | undefined {
    return this.runners.get(runnerId);
  }

  getRunners(labels?: string[]): Runner[] {
    const runners = Array.from(this.runners.values());
    if (!labels || labels.length === 0) return runners;
    return runners.filter((r) => labels.every((l) => r.labels.includes(l)));
  }

  runnerHeartbeat(runnerId: string): void {
    const runner = this.runners.get(runnerId);
    if (runner) {
      runner.lastHeartbeat = Date.now();
      if (runner.status === 'offline') {
        runner.status = 'idle';
      }
    }
  }

  async uploadArtifact(
    runId: string,
    name: string,
    content: Buffer,
    paths: string[],
    retentionDays: number
  ): Promise<Artifact> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);

    const result = await this.backend.upload(content, {
      filename: `artifacts/${runId}/${name}.tar.gz`,
    });

    const artifact: Artifact = {
      artifactId: `${runId}-${name}`,
      name,
      sizeBytes: content.length,
      cid: result.cid,
      createdAt: Date.now(),
      expiresAt: Date.now() + retentionDays * 24 * 60 * 60 * 1000,
      paths,
    };

    run.artifacts.push(artifact);
    return artifact;
  }

  async downloadArtifact(runId: string, name: string): Promise<Buffer | null> {
    const run = this.runs.get(runId);
    if (!run) return null;

    const artifact = run.artifacts.find((a) => a.name === name);
    if (!artifact) return null;

    const result = await this.backend.download(artifact.cid);
    return result.content;
  }

  getArtifacts(runId: string): Artifact[] {
    const run = this.runs.get(runId);
    return run?.artifacts || [];
  }
}
