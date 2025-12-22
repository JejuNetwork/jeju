/**
 * Workflow Engine for Jeju CI/CD
 * Executes workflows triggered by git events
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  keccak256,
  toBytes,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { parse as parseYaml } from 'yaml';
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
  RunStatus,
  Runner,
  Artifact,
  LogEntry,
} from './types';
import { BUILTIN_ACTIONS } from './types';

// TriggerRegistry ABI reserved for future on-chain integration

export interface WorkflowEngineConfig {
  rpcUrl: string;
  triggerRegistryAddress: Address;
  privateKey?: Hex;
}

interface WorkflowContext {
  github: {
    repository: string;
    repository_url: string;
    ref: string;
    sha: string;
    event_name: string;
    actor: Address;
    run_id: string;
    run_number: number;
    workflow: string;
    job: string;
  };
  env: Record<string, string>;
  secrets: Record<string, string>;
  inputs: Record<string, string>;
}

export class WorkflowEngine {
  // Reserved for future on-chain integration
  // @ts-expect-error Reserved for future use
  private _backend: BackendManager;
  private repoManager: GitRepoManager;
  // @ts-expect-error Reserved for future use
  private _triggerRegistryAddress: Address;
  // @ts-expect-error Reserved for future use
  private _publicClient: ReturnType<typeof createPublicClient>;
  private walletClient: ReturnType<typeof createWalletClient> | undefined;

  private workflows: Map<string, Workflow> = new Map(); // workflowId -> Workflow
  private runs: Map<string, WorkflowRun> = new Map(); // runId -> WorkflowRun
  private runQueue: string[] = []; // runIds waiting to execute
  private runNumbers: Map<string, number> = new Map(); // workflowId -> last run number
  private isProcessing = false;
  private runners: Map<string, Runner> = new Map(); // runnerId -> Runner
  private artifacts: Map<string, Artifact[]> = new Map(); // runId -> Artifacts
  private logSubscribers: Map<string, Array<(entry: LogEntry) => void>> = new Map(); // runId -> callbacks

  constructor(
    config: WorkflowEngineConfig,
    backend: BackendManager,
    repoManager: GitRepoManager
  ) {
    this._backend = backend;
    this.repoManager = repoManager;
    this._triggerRegistryAddress = config.triggerRegistryAddress;

    const chain = {
      ...foundry,
      rpcUrls: { default: { http: [config.rpcUrl] } },
    };

    this._publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    });

    if (config.privateKey) {
      const account = privateKeyToAccount(config.privateKey);
      this.walletClient = createWalletClient({
        account,
        chain,
        transport: http(config.rpcUrl),
      });
    }
  }

  /**
   * Get the next run number for a workflow
   */
  private getNextRunNumber(workflowId: Hex): number {
    const current = this.runNumbers.get(workflowId) || 0;
    const next = current + 1;
    this.runNumbers.set(workflowId, next);
    return next;
  }

  /**
   * Parse jeju.yml workflow configuration
   */
  parseWorkflowConfig(content: string): JejuWorkflowConfig {
    return parseYaml(content) as JejuWorkflowConfig;
  }

  /**
   * Load workflows from a repository
   */
  async loadRepositoryWorkflows(repoId: Hex): Promise<Workflow[]> {
    const objectStore = this.repoManager.getObjectStore(repoId);

    // Get head commit
    const repo = await this.repoManager.getRepository(repoId);
    if (!repo || repo.headCommitCid === '0x'.padEnd(66, '0')) {
      return [];
    }

    // Decode the bytes32 CID to OID format
    const headOid = repo.headCommitCid.slice(2); // Remove 0x prefix for git OID
    const commit = await objectStore.getCommit(headOid);
    if (!commit) return [];

    const tree = await objectStore.getTree(commit.tree);
    if (!tree) return [];

    // Look for .jeju/workflows directory
    const jejuDir = tree.entries.find((e) => e.name === '.jeju' && e.type === 'tree');
    if (!jejuDir) return [];

    const jejuTree = await objectStore.getTree(jejuDir.oid);
    if (!jejuTree) return [];

    const workflowsDir = jejuTree.entries.find((e) => e.name === 'workflows' && e.type === 'tree');
    if (!workflowsDir) return [];

    const workflowsTree = await objectStore.getTree(workflowsDir.oid);
    if (!workflowsTree) return [];

    const workflows: Workflow[] = [];

    for (const entry of workflowsTree.entries) {
      if (entry.type !== 'blob' || !entry.name.endsWith('.yml')) continue;

      const blob = await objectStore.getBlob(entry.oid);
      if (!blob) continue;

      const config = this.parseWorkflowConfig(blob.content.toString('utf8'));
      const workflow = this.configToWorkflow(repoId, entry.name, config);
      workflows.push(workflow);

      this.workflows.set(workflow.workflowId, workflow);
    }

    return workflows;
  }

  /**
   * Convert config to Workflow
   */
  private configToWorkflow(repoId: Hex, filename: string, config: JejuWorkflowConfig): Workflow {
    const workflowId = keccak256(toBytes(`${repoId}-${filename}`));

    const triggers = [];

    if (config.on.push) {
      triggers.push({
        type: 'push' as const,
        branches: config.on.push.branches,
        paths: config.on.push.paths,
      });
    }

    if (config.on.pull_request) {
      triggers.push({
        type: 'pull_request' as const,
        branches: config.on.pull_request.branches,
        types: config.on.pull_request.types,
      });
    }

    if (config.on.schedule) {
      for (const schedule of config.on.schedule) {
        triggers.push({
          type: 'schedule' as const,
          schedule: schedule.cron,
        });
      }
    }

    if (config.on.workflow_dispatch) {
      triggers.push({
        type: 'workflow_dispatch' as const,
      });
    }

    if (config.on.release) {
      triggers.push({
        type: 'release' as const,
        types: config.on.release.types,
      });
    }

    const jobs: WorkflowJob[] = Object.entries(config.jobs).map(([jobId, jobConfig]) => ({
      jobId,
      name: jobConfig.name || jobId,
      runsOn: jobConfig['runs-on'] as 'jeju-compute' | 'self-hosted',
      needs: typeof jobConfig.needs === 'string' ? [jobConfig.needs] : jobConfig.needs,
      env: jobConfig.env,
      timeout: jobConfig['timeout-minutes'],
      continueOnError: jobConfig['continue-on-error'],
      steps: jobConfig.steps.map((step, i) => ({
        stepId: step.id || `step-${i}`,
        name: step.name,
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

    return {
      workflowId,
      repoId,
      name: config.name,
      description: config.description || '',
      triggers,
      jobs,
      env: config.env || {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      active: true,
      source: 'jeju' as const,
    };
  }

  /**
   * Trigger a workflow run
   */
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
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const runId = keccak256(toBytes(`${workflowId}-${Date.now()}-${Math.random()}`));

    const runNumber = this.getNextRunNumber(workflowId);
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
      jobs: workflow.jobs.map((job) => ({
        jobId: job.jobId,
        name: job.name,
        status: 'queued' as RunStatus,
        steps: job.steps.map((step) => ({
          stepId: step.stepId,
          name: step.name || step.stepId,
          status: 'queued' as RunStatus,
        })),
      })),
      artifacts: [],
      inputs,
      prNumber,
    };

    this.runs.set(runId, run);
    this.runQueue.push(runId);

    // Start processing if not already
    this.processQueue();

    return run;
  }

  /**
   * Get a workflow run
   */
  getRun(runId: string): WorkflowRun | undefined {
    return this.runs.get(runId);
  }

  /**
   * Get all runs for a workflow
   */
  getWorkflowRuns(workflowId: Hex): WorkflowRun[] {
    return Array.from(this.runs.values()).filter((run) => run.workflowId === workflowId);
  }

  /**
   * Get all runs for a repository
   */
  getRepositoryRuns(repoId: Hex): WorkflowRun[] {
    return Array.from(this.runs.values()).filter((run) => run.repoId === repoId);
  }

  /**
   * Cancel a workflow run
   */
  cancelRun(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run) return false;
    if (run.status === 'completed' || run.status === 'cancelled' || run.status === 'failed') {
      return false;
    }
    run.status = 'cancelled';
    run.conclusion = 'cancelled';
    run.completedAt = Date.now();
    return true;
  }

  /**
   * Get all runners, optionally filtered by labels
   */
  getRunners(labels?: string[]): Runner[] {
    const allRunners = Array.from(this.runners.values());
    if (!labels || labels.length === 0) {
      return allRunners;
    }
    return allRunners.filter(runner =>
      labels.every(label => runner.labels.includes(label))
    );
  }

  /**
   * Register a new runner
   */
  registerRunner(runner: Omit<Runner, 'status' | 'registeredAt'> & { status?: Runner['status']; registeredAt?: number }): Runner {
    const fullRunner: Runner = {
      ...runner,
      status: runner.status ?? 'idle',
      registeredAt: runner.registeredAt ?? Date.now(),
    };
    this.runners.set(fullRunner.runnerId, fullRunner);
    return fullRunner;
  }

  /**
   * Update runner heartbeat
   */
  runnerHeartbeat(runnerId: string): void {
    const runner = this.runners.get(runnerId);
    if (runner) {
      runner.lastHeartbeat = Date.now();
      if (runner.status === 'offline') {
        runner.status = 'idle';
      }
    }
  }

  /**
   * Unregister a runner
   */
  unregisterRunner(runnerId: string): boolean {
    return this.runners.delete(runnerId);
  }

  /**
   * Subscribe to logs for a run
   */
  subscribeToLogs(runId: string, callback: (entry: LogEntry) => void): () => void {
    const subscribers = this.logSubscribers.get(runId) ?? [];
    subscribers.push(callback);
    this.logSubscribers.set(runId, subscribers);
    
    // Return unsubscribe function
    return () => {
      const subs = this.logSubscribers.get(runId);
      if (subs) {
        const index = subs.indexOf(callback);
        if (index >= 0) {
          subs.splice(index, 1);
        }
      }
    };
  }

  /**
   * Upload an artifact for a run
   */
  async uploadArtifact(
    runId: string,
    name: string,
    content: Buffer,
    paths: string[],
    retentionDays: number
  ): Promise<Artifact> {
    const artifact: Artifact = {
      artifactId: crypto.randomUUID(),
      name,
      sizeBytes: content.length,
      cid: keccak256(content).slice(0, 46), // Mock CID from hash
      createdAt: Date.now(),
      expiresAt: Date.now() + retentionDays * 24 * 60 * 60 * 1000,
      paths,
    };

    const runArtifacts = this.artifacts.get(runId) ?? [];
    runArtifacts.push(artifact);
    this.artifacts.set(runId, runArtifacts);

    // Also add to run's artifacts list
    const run = this.runs.get(runId);
    if (run) {
      run.artifacts.push(artifact);
    }

    return artifact;
  }

  /**
   * Get artifacts for a run
   */
  getArtifacts(runId: string): Artifact[] {
    return this.artifacts.get(runId) ?? [];
  }

  /**
   * Download an artifact
   */
  async downloadArtifact(runId: string, name: string): Promise<Buffer | null> {
    const artifacts = this.artifacts.get(runId);
    if (!artifacts) return null;
    
    const artifact = artifacts.find(a => a.name === name);
    if (!artifact) return null;

    // In production, this would fetch from storage backend
    // For now, return empty buffer as placeholder
    return Buffer.alloc(0);
  }

  /**
   * Process the run queue
   */
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

  /**
   * Execute a workflow run
   */
  private async executeRun(run: WorkflowRun): Promise<void> {
    run.status = 'in_progress';
    run.startedAt = Date.now();

    const workflow = this.workflows.get(run.workflowId);
    if (!workflow) {
      run.status = 'failed';
      run.conclusion = 'failure';
      return;
    }

    const context = this.createContext(run, workflow);

    // Execute jobs in order, respecting dependencies
    const completedJobs = new Set<string>();
    const failedJobs = new Set<string>();

    for (const jobRun of run.jobs) {
      const jobConfig = workflow.jobs.find((j) => j.jobId === jobRun.jobId);
      if (!jobConfig) continue;

      // Check dependencies
      if (jobConfig.needs) {
        const needsMet = jobConfig.needs.every((dep) => completedJobs.has(dep));
        const needsFailed = jobConfig.needs.some((dep) => failedJobs.has(dep));

        if (needsFailed) {
          jobRun.status = 'skipped';
          jobRun.conclusion = 'skipped';
          continue;
        }

        if (!needsMet) {
          jobRun.status = 'queued';
          continue;
        }
      }

      await this.executeJob(jobRun, jobConfig, context);

      if (jobRun.conclusion === 'success') {
        completedJobs.add(jobRun.jobId);
      } else if (jobRun.conclusion === 'failure' && !jobConfig.continueOnError) {
        failedJobs.add(jobRun.jobId);
      }
    }

    // Determine overall conclusion
    run.completedAt = Date.now();
    run.status = 'completed';

    if (failedJobs.size > 0) {
      run.conclusion = 'failure';
    } else if (run.jobs.every((j) => j.conclusion === 'skipped')) {
      run.conclusion = 'skipped';
    } else {
      run.conclusion = 'success';
    }

    // Record execution on-chain
    await this.recordExecution(run);
  }

  /**
   * Execute a job
   */
  private async executeJob(
    jobRun: JobRun,
    jobConfig: WorkflowJob,
    context: WorkflowContext
  ): Promise<void> {
    jobRun.status = 'in_progress';
    jobRun.startedAt = Date.now();

    const logs: string[] = [];
    logs.push(`Starting job: ${jobRun.name}`);
    logs.push(`Runner: ${jobConfig.runsOn}`);

    let jobSuccess = true;

    for (let i = 0; i < jobRun.steps.length; i++) {
      const stepRun = jobRun.steps[i];
      const stepConfig = jobConfig.steps[i];

      if (!jobSuccess && !stepConfig.continueOnError) {
        stepRun.status = 'skipped';
        stepRun.conclusion = 'skipped';
        continue;
      }

      await this.executeStep(stepRun, stepConfig, context, logs);

      if (stepRun.conclusion === 'failure' && !stepConfig.continueOnError) {
        jobSuccess = false;
      }
    }

    jobRun.completedAt = Date.now();
    jobRun.status = 'completed';
    jobRun.conclusion = jobSuccess ? 'success' : 'failure';
    jobRun.logs = logs.join('\n');
  }

  /**
   * Execute a step
   */
  private async executeStep(
    stepRun: StepRun,
    stepConfig: WorkflowStep,
    context: WorkflowContext,
    logs: string[]
  ): Promise<void> {
    stepRun.status = 'in_progress';
    stepRun.startedAt = Date.now();

    logs.push(`\n=== Step: ${stepRun.name} ===`);

    if (stepConfig.uses) {
      logs.push(`Using action: ${stepConfig.uses}`);
      await this.executeAction(stepRun, stepConfig, context, logs);
    } else if (stepConfig.run) {
      const command = this.interpolateVariables(stepConfig.run, context);
      logs.push(`$ ${command}`);

      const result = await this.executeCommand(
        command,
        stepConfig.shell || 'bash',
        stepConfig.workingDirectory,
        { ...context.env, ...stepConfig.env }
      );

      stepRun.output = result.output;
      stepRun.exitCode = result.exitCode;
      logs.push(result.output);

      stepRun.conclusion = result.exitCode === 0 ? 'success' : 'failure';
    } else {
      stepRun.conclusion = 'skipped';
    }

    stepRun.completedAt = Date.now();
    stepRun.status = 'completed';

    const duration = stepRun.completedAt - stepRun.startedAt!;
    logs.push(`Step completed in ${duration}ms with ${stepRun.conclusion}`);
  }

  /**
   * Execute an action
   */
  private async executeAction(
    stepRun: StepRun,
    stepConfig: WorkflowStep,
    context: WorkflowContext,
    logs: string[]
  ): Promise<void> {
    const actionRef = stepConfig.uses!;

    // Check for built-in actions
    const action = (BUILTIN_ACTIONS as Record<string, unknown>)[actionRef];

    if (!action) {
      logs.push(`Action not found: ${actionRef}`);
      stepRun.conclusion = 'failure';
      return;
    }

    logs.push(`Running action: ${(action as { name: string }).name}`);

    // Execute action steps (for composite actions)
    const runs = (action as { runs: { using: string; steps?: WorkflowStep[] } }).runs;
    if (runs.using === 'composite' && runs.steps) {
      for (const actionStep of runs.steps) {
        if (actionStep.run) {
          const command = this.interpolateVariables(actionStep.run, context, stepConfig.with);
          logs.push(`$ ${command}`);

          const result = await this.executeCommand(command, 'bash', undefined, context.env);
          logs.push(result.output);

          if (result.exitCode !== 0) {
            stepRun.conclusion = 'failure';
            return;
          }
        }
      }
    }

    stepRun.conclusion = 'success';
  }

  /**
   * Execute command using local shell or compute marketplace
   */
  private async executeCommand(
    command: string,
    shell: string,
    workingDir?: string,
    env?: Record<string, string>
  ): Promise<{ output: string; exitCode: number }> {
    // Determine shell executable
    const shellPath = shell === 'pwsh' || shell === 'powershell'
      ? 'pwsh'
      : shell === 'cmd'
        ? 'cmd.exe'
        : '/bin/bash';

    const shellArgs = shell === 'cmd'
      ? ['/c', command]
      : ['-c', command];

    const startTime = Date.now();
    const output: string[] = [];

    const proc = Bun.spawn([shellPath, ...shellArgs], {
      cwd: workingDir || process.cwd(),
      env: {
        ...process.env,
        ...env,
        CI: 'true',
        JEJU_CI: 'true',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Collect stdout
    const stdoutReader = proc.stdout.getReader();
    const stderrReader = proc.stderr.getReader();

    const readStream = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        output.push(text);
      }
    };

    await Promise.all([
      readStream(stdoutReader),
      readStream(stderrReader),
    ]);

    const exitCode = await proc.exited;
    void (Date.now() - startTime); // Duration available if needed

    return {
      output: output.join(''),
      exitCode,
    };
  }

  /**
   * Interpolate variables in a string
   */
  private interpolateVariables(
    template: string,
    context: WorkflowContext,
    inputs: Record<string, string> = {}
  ): string {
    let result = template;

    // Replace ${{ github.* }}
    for (const [key, value] of Object.entries(context.github)) {
      result = result.replace(new RegExp(`\\$\\{\\{\\s*github\\.${key}\\s*\\}\\}`, 'g'), String(value));
    }

    // Replace ${{ env.* }}
    for (const [key, value] of Object.entries(context.env)) {
      result = result.replace(new RegExp(`\\$\\{\\{\\s*env\\.${key}\\s*\\}\\}`, 'g'), value);
    }

    // Replace ${{ inputs.* }}
    for (const [key, value] of Object.entries({ ...context.inputs, ...inputs })) {
      result = result.replace(new RegExp(`\\$\\{\\{\\s*inputs\\.${key}\\s*\\}\\}`, 'g'), value);
    }

    // Replace $VARIABLE and ${VARIABLE}
    for (const [key, value] of Object.entries(context.env)) {
      result = result.replace(new RegExp(`\\$${key}\\b`, 'g'), value);
      result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
    }

    return result;
  }

  /**
   * Create workflow context
   */
  private createContext(run: WorkflowRun, workflow: Workflow): WorkflowContext {
    const baseUrl = process.env.DWS_BASE_URL || 'http://localhost:4030';

    return {
      github: {
        repository: `${run.repoId}`,
        repository_url: `${baseUrl}/git/${run.repoId}`,
        ref: `refs/heads/${run.branch}`,
        sha: run.commitSha,
        event_name: run.triggerType,
        actor: run.triggeredBy,
        run_id: run.runId,
        run_number: this.getWorkflowRuns(run.workflowId).length,
        workflow: workflow.name,
        job: '',
      },
      env: { ...workflow.env, ...(process.env as Record<string, string>) },
      secrets: {},
      inputs: {},
    };
  }

  /**
   * Record execution on-chain
   */
  private async recordExecution(run: WorkflowRun): Promise<void> {
    if (!this.walletClient) return;

    void keccak256(toBytes(JSON.stringify(run))); // Hash available for on-chain recording

    // This would call TriggerRegistry.recordExecution in production
    console.log(`[CI] Recorded execution: ${run.runId} - ${run.conclusion}`);
  }

}

