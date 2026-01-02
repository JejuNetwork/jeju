/**
 * Exec Service
 * Provides secure shell command execution for workerd and other DWS components
 *
 * This is a critical service that enables:
 * - Workerd executor to manage worker processes
 * - File operations for TUS uploads, CDN, media optimization
 * - Git operations for CI/CD
 * - K3s/Helm provider operations
 *
 * Security: This service should only be accessible from localhost
 */

import type { Subprocess } from 'bun'
import { Elysia, t } from 'elysia'

// Track background processes
const backgroundProcesses = new Map<number, Subprocess>()

// Request/Response schemas
const ExecRequestSchema = t.Object({
  command: t.Array(t.String()),
  stdin: t.Optional(t.String()),
  env: t.Optional(t.Record(t.String(), t.String())),
  cwd: t.Optional(t.String()),
  background: t.Optional(t.Boolean()),
  timeout: t.Optional(t.Number()),
})

interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
  pid?: number
}

async function executeCommand(
  command: string[],
  options: {
    stdin?: string
    env?: Record<string, string>
    cwd?: string
    background?: boolean
    timeout?: number
  } = {},
): Promise<ExecResult> {
  const { stdin, env, cwd, background, timeout = 30000 } = options

  // Build spawn options - only pass minimal env for security
  const spawnEnv: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    ...env,
  }

  const proc = Bun.spawn(command, {
    cwd: cwd ?? process.cwd(),
    env: spawnEnv,
    stdin: stdin ? 'pipe' : undefined,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  // Handle stdin if provided
  if (stdin && proc.stdin) {
    // If stdin looks like base64, try to decode it
    const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(stdin) && stdin.length > 50
    const data = isBase64
      ? Buffer.from(stdin, 'base64')
      : new TextEncoder().encode(stdin)
    proc.stdin.write(data)
    proc.stdin.end()
  }

  // For background processes, return immediately
  if (background) {
    const pid = proc.pid
    backgroundProcesses.set(pid, proc)

    // Auto-cleanup on exit
    proc.exited.then(() => {
      backgroundProcesses.delete(pid)
    })

    return {
      exitCode: 0,
      stdout: '',
      stderr: '',
      pid,
    }
  }

  // Read stdout and stderr
  const decoder = new TextDecoder()
  let stdout = ''
  let stderr = ''

  // Create timeout promise
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    setTimeout(() => resolve('timeout'), timeout)
  })

  // Read streams
  const readStream = async (
    stream: ReadableStream<Uint8Array>,
    target: 'stdout' | 'stderr',
  ) => {
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value)
      if (target === 'stdout') stdout += text
      else stderr += text
    }
  }

  try {
    const result = await Promise.race([
      Promise.all([
        readStream(proc.stdout, 'stdout'),
        readStream(proc.stderr, 'stderr'),
        proc.exited,
      ]).then(([, , exitCode]) => ({ exitCode, stdout, stderr })),
      timeoutPromise,
    ])

    if (result === 'timeout') {
      proc.kill()
      return {
        exitCode: 124, // Standard timeout exit code
        stdout,
        stderr: `${stderr}\n[TIMEOUT]`,
      }
    }

    return result
  } catch (error) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    }
  }
}

export function createExecRouter() {
  return new Elysia({ prefix: '/exec' })
    .post(
      '/',
      async ({ body, set, request }) => {
        // Security: Only allow requests from localhost
        const host = request.headers.get('host')
        const forwardedFor = request.headers.get('x-forwarded-for')

        // In production, we might want to restrict this more
        // For now, allow localhost access
        const isLocalhost =
          host?.startsWith('localhost') ||
          host?.startsWith('127.0.0.1') ||
          host?.startsWith('0.0.0.0') ||
          !forwardedFor

        if (!isLocalhost && process.env.NODE_ENV === 'production') {
          set.status = 403
          return { error: 'Exec service only available from localhost' }
        }

        const result = await executeCommand(body.command, {
          stdin: body.stdin,
          env: body.env,
          cwd: body.cwd,
          background: body.background,
          timeout: body.timeout,
        })

        return result
      },
      {
        body: ExecRequestSchema,
      },
    )
    .get('/health', () => ({
      status: 'healthy',
      service: 'exec',
      processes: backgroundProcesses.size,
    }))
    .get('/processes', () => ({
      processes: Array.from(backgroundProcesses.keys()),
    }))
    .post(
      '/kill/:pid',
      ({ params }) => {
        const pid = parseInt(params.pid, 10)
        const proc = backgroundProcesses.get(pid)
        if (proc) {
          proc.kill()
          backgroundProcesses.delete(pid)
          return { success: true, killed: pid }
        }

        // Try to kill by PID directly (for processes started before tracking)
        try {
          process.kill(pid, 'SIGTERM')
          return { success: true, killed: pid, note: 'killed via process.kill' }
        } catch {
          return { success: false, error: `Process ${pid} not found` }
        }
      },
      {
        params: t.Object({
          pid: t.String(),
        }),
      },
    )
}

// Export executeCommand for direct use in same-process scenarios
export { executeCommand }
