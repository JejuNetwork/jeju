/**
 * jeju compute - DWS compute operations
 *
 * Manage compute jobs on DWS (Decentralized Web Services).
 *
 * Security notes:
 * - Shell commands are validated before execution
 * - User inputs are sanitized
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'bun'
import { Command } from 'commander'
import { getChainStatus } from '../lib/chain'
import { logger } from '../lib/logger'
import {
  sanitizeErrorMessage,
  validateAddress,
  validatePort,
  validateShellCommand,
} from '../lib/security'
import {
  ComputeHealthResponseSchema,
  InferenceResponseSchema,
  JobDetailsResponseSchema,
  JobSubmitResponseSchema,
  JobsListResponseSchema,
  validate,
} from '../schemas'
import { DEFAULT_PORTS } from '../types'

function getDwsPort(): number {
  const portStr = process.env.DWS_PORT || '4030'
  return validatePort(portStr)
}

function getDwsUrl(): string {
  if (process.env.DWS_URL) {
    // Basic URL validation
    const url = process.env.DWS_URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error('DWS_URL must start with http:// or https://')
    }
    return url
  }
  return `http://localhost:${getDwsPort()}`
}

export const computeCommand = new Command('compute')
  .description('DWS compute operations')
  .addCommand(
    new Command('status')
      .description('Check DWS compute services status')
      .action(async () => {
        await checkStatus()
      }),
  )
  .addCommand(
    new Command('start')
      .description('Start DWS server')
      .option(
        '--network <network>',
        'Network: localnet, testnet, mainnet',
        'localnet',
      )
      .option('--port <port>', 'Server port', '4030')
      .action(async (options) => {
        await startDws(options)
      }),
  )
  .addCommand(
    new Command('node')
      .description('Start DWS provider node (storage + compute)')
      .option(
        '--network <network>',
        'Network: localnet, testnet, mainnet',
        'localnet',
      )
      .option('--port <port>', 'Node port', '4031')
      .action(async (options) => {
        await startNode(options)
      }),
  )
  .addCommand(
    new Command('submit')
      .description('Submit a compute job')
      .argument('<command>', 'Shell command to execute')
      .option('--shell <shell>', 'Shell to use: bash, sh, pwsh', 'bash')
      .option('--timeout <ms>', 'Timeout in milliseconds', '300000')
      .option('--address <address>', 'Submitter address')
      .action(async (command, options) => {
        await submitJob(command, options)
      }),
  )
  .addCommand(
    new Command('jobs')
      .description('List compute jobs')
      .option(
        '--status <status>',
        'Filter by status: queued, running, completed, failed',
      )
      .option('--limit <limit>', 'Max results', '20')
      .action(async (options) => {
        await listJobs(options)
      }),
  )
  .addCommand(
    new Command('job')
      .description('Get job details')
      .argument('<job-id>', 'Job ID')
      .action(async (jobId) => {
        await getJob(jobId)
      }),
  )
  .addCommand(
    new Command('cancel')
      .description('Cancel a running job')
      .argument('<job-id>', 'Job ID')
      .action(async (jobId) => {
        await cancelJob(jobId)
      }),
  )
  .addCommand(
    new Command('inference')
      .description('Run inference request')
      .argument('<prompt>', 'The prompt to send')
      .option('--model <model>', 'Model name', 'default')
      .option('--system <system>', 'System prompt')
      .action(async (prompt, options) => {
        await runInference(prompt, options)
      }),
  )

async function checkStatus(): Promise<void> {
  logger.header('DWS COMPUTE STATUS')

  const chain = await getChainStatus('localnet')
  logger.table([
    {
      label: 'Chain',
      value: chain.running ? `Block ${chain.blockNumber}` : 'Not running',
      status: chain.running ? 'ok' : 'error',
    },
  ])

  const dwsUrl = getDwsUrl()
  let dwsOk = false

  try {
    const response = await fetch(`${dwsUrl}/compute/health`, {
      signal: AbortSignal.timeout(3000),
    })
    if (response.ok) {
      dwsOk = true
      const rawStatus = await response.json()
      const status = validate(
        rawStatus,
        ComputeHealthResponseSchema,
        'compute health response',
      )

      logger.newline()
      logger.subheader('Compute Service')
      logger.table([
        {
          label: 'Status',
          value: status.status,
          status: status.status === 'healthy' ? 'ok' : 'error',
        },
        {
          label: 'Active Jobs',
          value: String(status.activeJobs ?? 0),
          status: 'ok',
        },
        {
          label: 'Queued Jobs',
          value: String(status.queuedJobs ?? 0),
          status: 'ok',
        },
        {
          label: 'Max Concurrent',
          value: String(status.maxConcurrent ?? 0),
          status: 'ok',
        },
      ])
    }
  } catch {
    // DWS not running
  }

  logger.newline()
  logger.table([
    {
      label: 'DWS Server',
      value: dwsOk ? dwsUrl : 'Not running',
      status: dwsOk ? 'ok' : 'error',
    },
  ])

  if (!dwsOk) {
    logger.newline()
    logger.info('Start DWS with: jeju compute start')
  }
}

async function startDws(options: {
  network: string
  port: string
}): Promise<void> {
  logger.header('DWS SERVER')

  const rootDir = process.cwd()
  const dwsDir = join(rootDir, 'apps/dws')

  if (!existsSync(dwsDir)) {
    logger.error('DWS app not found')
    process.exit(1)
  }

  const chain = await getChainStatus(
    options.network as 'localnet' | 'testnet' | 'mainnet',
  )
  if (!chain.running && options.network === 'localnet') {
    logger.warn('Chain not running. Start with: jeju dev')
    process.exit(1)
  }

  const rpcUrl =
    options.network === 'localnet'
      ? `http://localhost:${DEFAULT_PORTS.l2Rpc}`
      : options.network === 'testnet'
        ? 'https://testnet-rpc.jejunetwork.org'
        : 'https://rpc.jejunetwork.org'

  logger.step(`Starting DWS server on port ${options.port}...`)
  logger.keyValue('Network', options.network)
  logger.keyValue('RPC URL', rpcUrl)

  const proc = spawn({
    cmd: ['bun', 'run', 'start'],
    cwd: dwsDir,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      PORT: options.port,
      DWS_PORT: options.port,
      NETWORK: options.network,
      RPC_URL: rpcUrl,
      JEJU_RPC_URL: rpcUrl,
    },
  })

  process.on('SIGINT', () => {
    proc.kill('SIGTERM')
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    proc.kill('SIGTERM')
    process.exit(0)
  })

  await proc.exited
}

async function startNode(options: {
  network: string
  port: string
}): Promise<void> {
  logger.header('DWS PROVIDER NODE')

  const rootDir = process.cwd()
  const dwsDir = join(rootDir, 'apps/dws')

  if (!existsSync(dwsDir)) {
    logger.error('DWS app not found')
    process.exit(1)
  }

  const chain = await getChainStatus(
    options.network as 'localnet' | 'testnet' | 'mainnet',
  )
  if (!chain.running && options.network === 'localnet') {
    logger.warn('Chain not running. Start with: jeju dev')
    process.exit(1)
  }

  const rpcUrl =
    options.network === 'localnet'
      ? `http://localhost:${DEFAULT_PORTS.l2Rpc}`
      : options.network === 'testnet'
        ? 'https://testnet-rpc.jejunetwork.org'
        : 'https://rpc.jejunetwork.org'

  logger.step(`Starting DWS provider node on port ${options.port}...`)
  logger.keyValue('Network', options.network)
  logger.keyValue('RPC URL', rpcUrl)

  const proc = spawn({
    cmd: ['bun', 'run', 'node'],
    cwd: dwsDir,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      DWS_NODE_PORT: options.port,
      NETWORK: options.network,
      RPC_URL: rpcUrl,
    },
  })

  process.on('SIGINT', () => {
    proc.kill('SIGTERM')
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    proc.kill('SIGTERM')
    process.exit(0)
  })

  await proc.exited
}

async function submitJob(
  command: string,
  options: { shell: string; timeout: string; address?: string },
): Promise<void> {
  logger.header('SUBMIT COMPUTE JOB')

  // Validate shell command to prevent obvious injection attempts
  const validCommand = validateShellCommand(command)

  // Validate shell type
  const validShells = ['bash', 'sh', 'pwsh', 'zsh']
  if (!validShells.includes(options.shell)) {
    logger.error(
      `Invalid shell: ${options.shell}. Must be one of: ${validShells.join(', ')}`,
    )
    process.exit(1)
  }

  // Validate timeout
  const timeout = parseInt(options.timeout, 10)
  if (Number.isNaN(timeout) || timeout < 1000 || timeout > 3600000) {
    logger.error('Timeout must be between 1000ms and 3600000ms (1 hour)')
    process.exit(1)
  }

  const dwsUrl = getDwsUrl()
  const address = options.address
    ? validateAddress(options.address)
    : process.env.DEPLOYER_ADDRESS
      ? validateAddress(process.env.DEPLOYER_ADDRESS)
      : '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

  logger.keyValue(
    'Command',
    validCommand.slice(0, 100) + (validCommand.length > 100 ? '...' : ''),
  )
  logger.keyValue('Shell', options.shell)
  logger.keyValue('Timeout', `${timeout}ms`)
  logger.newline()

  try {
    const response = await fetch(`${dwsUrl}/compute/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': address,
      },
      body: JSON.stringify({
        command: validCommand,
        shell: options.shell,
        timeout,
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(sanitizeErrorMessage(error))
    }

    const rawResult = await response.json()
    const result = validate(
      rawResult,
      JobSubmitResponseSchema,
      'job submit response',
    )
    logger.success('Job submitted')
    logger.keyValue('Job ID', result.jobId)
    logger.keyValue('Status', result.status)
    logger.newline()
    logger.info(`Track with: jeju compute job ${result.jobId}`)
  } catch (error) {
    logger.error(
      `Failed to submit job: ${sanitizeErrorMessage(error as Error)}`,
    )
    process.exit(1)
  }
}

async function listJobs(options: {
  status?: string
  limit: string
}): Promise<void> {
  logger.header('COMPUTE JOBS')

  const dwsUrl = getDwsUrl()

  try {
    const params = new URLSearchParams()
    if (options.status) params.set('status', options.status)
    params.set('limit', options.limit)

    const url = `${dwsUrl}/compute/jobs?${params}`
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) })

    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const rawData = await response.json()
    const data = validate(rawData, JobsListResponseSchema, 'jobs list response')

    if (data.jobs.length === 0) {
      logger.info('No jobs found')
      return
    }

    logger.info(`Found ${data.jobs.length} of ${data.total} jobs:\n`)

    for (const job of data.jobs) {
      const statusIcon =
        job.status === 'completed'
          ? '✅'
          : job.status === 'running'
            ? '🔄'
            : job.status === 'queued'
              ? '⏳'
              : job.status === 'failed'
                ? '❌'
                : '⛔'
      console.log(`  ${statusIcon} ${job.jobId}`)
      console.log(`     Status: ${job.status}`)
      if (job.exitCode !== null) console.log(`     Exit Code: ${job.exitCode}`)
      if (job.startedAt)
        console.log(`     Started: ${new Date(job.startedAt).toISOString()}`)
      if (job.completedAt)
        console.log(
          `     Completed: ${new Date(job.completedAt).toISOString()}`,
        )
      console.log('')
    }
  } catch (error) {
    logger.error(`Failed to list jobs: ${error}`)
    process.exit(1)
  }
}

async function getJob(jobId: string): Promise<void> {
  const dwsUrl = getDwsUrl()

  try {
    const response = await fetch(`${dwsUrl}/compute/jobs/${jobId}`, {
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      if (response.status === 404) {
        logger.error(`Job not found: ${jobId}`)
      } else {
        logger.error(`HTTP ${response.status}`)
      }
      process.exit(1)
    }

    const rawJob = await response.json()
    const job = validate(
      rawJob,
      JobDetailsResponseSchema,
      'job details response',
    )

    logger.header('JOB DETAILS')
    logger.keyValue('Job ID', job.jobId)
    logger.keyValue('Status', job.status)
    if (job.exitCode !== null)
      logger.keyValue('Exit Code', String(job.exitCode))
    if (job.startedAt)
      logger.keyValue('Started', new Date(job.startedAt).toISOString())
    if (job.completedAt)
      logger.keyValue('Completed', new Date(job.completedAt).toISOString())
    if (job.duration !== null) logger.keyValue('Duration', `${job.duration}ms`)

    if (job.output) {
      logger.newline()
      logger.subheader('Output')
      console.log(job.output)
    }
  } catch (error) {
    logger.error(`Failed to get job: ${error}`)
    process.exit(1)
  }
}

async function cancelJob(jobId: string): Promise<void> {
  logger.header('CANCEL JOB')

  const dwsUrl = getDwsUrl()

  try {
    const response = await fetch(`${dwsUrl}/compute/jobs/${jobId}/cancel`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(error)
    }

    logger.success(`Cancelled job ${jobId}`)
  } catch (error) {
    logger.error(`Failed to cancel job: ${error}`)
    process.exit(1)
  }
}

async function runInference(
  prompt: string,
  options: { model: string; system?: string },
): Promise<void> {
  logger.header('INFERENCE')

  const dwsUrl = getDwsUrl()

  const messages: Array<{ role: string; content: string }> = []
  if (options.system) {
    messages.push({ role: 'system', content: options.system })
  }
  messages.push({ role: 'user', content: prompt })

  logger.keyValue('Model', options.model)
  logger.keyValue(
    'Prompt',
    prompt.length > 50 ? `${prompt.slice(0, 50)}...` : prompt,
  )
  logger.newline()

  try {
    const response = await fetch(`${dwsUrl}/compute/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        messages,
      }),
      signal: AbortSignal.timeout(60000),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(error)
    }

    const rawResult = await response.json()
    const result = validate(
      rawResult,
      InferenceResponseSchema,
      'inference response',
    )

    logger.subheader('Response')
    console.log(result.choices[0]?.message?.content || 'No response')
    logger.newline()
    logger.keyValue(
      'Tokens',
      `${result.usage.prompt_tokens} + ${result.usage.completion_tokens} = ${result.usage.total_tokens}`,
    )
  } catch (error) {
    logger.error(`Inference failed: ${error}`)
    process.exit(1)
  }
}
