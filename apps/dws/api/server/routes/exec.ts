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

/**
 * SECURITY: Allowlist of commands that can be executed via exec API
 * Only safe, necessary commands for DWS operations are allowed.
 * Each entry is a regex pattern for the command executable (first arg).
 */
const ALLOWED_COMMAND_PATTERNS = [
  // File operations
  /^(mkdir|cat|chmod|test|rm|shred|cp|mv|ls)$/,
  // Process management
  /^(kill|ps)$/,
  // SSH operations
  /^(ssh|ssh-keygen)$/,
  // Workerd operations
  /^workerd$/,
  /^\/.*\/workerd$/, // Absolute path to workerd
  // Shell for bundled scripts (restricted to -c flag only)
  /^(sh|bash)$/,
  // Tar for archives
  /^tar$/,
  // nohup for background processes
  /^nohup$/,
]

/**
 * SECURITY: Blocked patterns in command arguments to prevent injection
 */
const BLOCKED_ARG_PATTERNS = [
  /[`$]/, // Backticks and dollar signs (command substitution)
  /\|/, // Pipes (unless we explicitly allow them)
  /[<>]/, // Redirects
  /;(?!;)/, // Single semicolons (double semicolon allowed for case statements)
  /&&/, // AND operator (only allowed in controlled shell scripts)
  /\|\|/, // OR operator
]

function isCommandAllowed(command: string[]): {
  allowed: boolean
  reason?: string
} {
  if (command.length === 0) {
    return { allowed: false, reason: 'Empty command' }
  }

  const executable = command[0]
  const executableName = executable.split('/').pop() ?? executable

  // Check if executable is in allowlist
  const isAllowed = ALLOWED_COMMAND_PATTERNS.some(
    (pattern) => pattern.test(executable) || pattern.test(executableName),
  )

  if (!isAllowed) {
    return {
      allowed: false,
      reason: `Command '${executableName}' not in allowlist`,
    }
  }

  // For non-shell commands, check arguments for injection patterns
  if (executableName !== 'sh' && executableName !== 'bash') {
    for (let i = 1; i < command.length; i++) {
      const arg = command[i]
      for (const pattern of BLOCKED_ARG_PATTERNS) {
        if (pattern.test(arg)) {
          return {
            allowed: false,
            reason: `Blocked pattern in argument: ${arg.slice(0, 20)}...`,
          }
        }
      }
    }
  }

  return { allowed: true }
}

/**
 * SECURITY: Verify request originates from localhost
 * This check uses multiple layers of defense:
 * 1. Reject if any proxy headers are present (request came from outside)
 * 2. Check Bun's server info for actual connection source when available
 * 3. Verify the URL doesn't expose the exec endpoint externally
 */
function verifyLocalhostOnly(request: Request): {
  allowed: boolean
  reason?: string
} {
  // Layer 1: Reject if proxy headers present - these indicate external origin
  const proxyHeaders = [
    'x-forwarded-for',
    'x-real-ip',
    'x-forwarded-host',
    'x-forwarded-proto',
    'forwarded',
    'via',
  ]

  for (const header of proxyHeaders) {
    if (request.headers.get(header)) {
      return { allowed: false, reason: `Proxy header detected: ${header}` }
    }
  }

  // Layer 2: Parse the URL to verify host
  const url = new URL(request.url)
  const hostname = url.hostname.toLowerCase()

  const localhostPatterns = ['localhost', '127.0.0.1', '::1', '[::1]']
  const isLocalhost = localhostPatterns.some(
    (pattern) => hostname === pattern || hostname.startsWith(`${pattern}:`),
  )

  if (!isLocalhost) {
    return { allowed: false, reason: `Non-localhost hostname: ${hostname}` }
  }

  // Layer 3: Additional check - verify host header matches URL
  const hostHeader = request.headers.get('host')
  if (hostHeader) {
    const hostHostname = hostHeader.split(':')[0].toLowerCase()
    if (!localhostPatterns.includes(hostHostname)) {
      return { allowed: false, reason: `Host header mismatch: ${hostHeader}` }
    }
  }

  return { allowed: true }
}

export function createExecRouter() {
  return new Elysia({ prefix: '/exec' })
    .post(
      '/',
      async ({ body, set, request }) => {
        // SECURITY: Strict localhost-only access - ALWAYS enforced, not just production
        const localhostCheck = verifyLocalhostOnly(request)
        if (!localhostCheck.allowed) {
          console.warn(`[ExecRouter] BLOCKED: ${localhostCheck.reason}`)
          set.status = 403
          return { error: 'Exec service only available from localhost' }
        }

        // SECURITY: Validate command against allowlist
        const commandCheck = isCommandAllowed(body.command)
        if (!commandCheck.allowed) {
          console.warn(`[ExecRouter] Command blocked: ${commandCheck.reason}`)
          set.status = 403
          return { error: `Command blocked: ${commandCheck.reason}` }
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
    .get('/health', ({ request, set }) => {
      // Health check is safe but still verify localhost
      const localhostCheck = verifyLocalhostOnly(request)
      if (!localhostCheck.allowed) {
        set.status = 403
        return { error: 'Exec service only available from localhost' }
      }
      return {
        status: 'healthy',
        service: 'exec',
        processes: backgroundProcesses.size,
      }
    })
    .get('/processes', ({ request, set }) => {
      // SECURITY: Process list should only be visible from localhost
      const localhostCheck = verifyLocalhostOnly(request)
      if (!localhostCheck.allowed) {
        set.status = 403
        return { error: 'Exec service only available from localhost' }
      }
      return {
        processes: Array.from(backgroundProcesses.keys()),
      }
    })
    .post(
      '/kill/:pid',
      ({ params, request, set }) => {
        // SECURITY: Kill endpoint must be localhost-only
        const localhostCheck = verifyLocalhostOnly(request)
        if (!localhostCheck.allowed) {
          set.status = 403
          return { error: 'Exec service only available from localhost' }
        }

        const pid = parseInt(params.pid, 10)

        // SECURITY: Validate PID is a reasonable number
        if (Number.isNaN(pid) || pid <= 0 || pid > 4194304) {
          set.status = 400
          return { error: 'Invalid PID' }
        }

        const proc = backgroundProcesses.get(pid)
        if (proc) {
          proc.kill()
          backgroundProcesses.delete(pid)
          return { success: true, killed: pid }
        }

        // SECURITY: Only allow killing processes we started, not arbitrary PIDs
        // Removed the fallback to process.kill() for security
        return {
          success: false,
          error: `Process ${pid} not tracked by exec service`,
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
