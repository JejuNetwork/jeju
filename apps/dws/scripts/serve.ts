import type { Subprocess } from 'bun'
import { spawn } from 'bun'

const DWS_DIR = import.meta.dir.replace('/scripts', '')

interface ProcessInfo {
  name: string
  process: Subprocess
}

const processes: ProcessInfo[] = []

async function waitForPort(port: number, timeout = 30000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      })
      if (response.ok) return true
    } catch {
      // Port not ready yet
    }
    await Bun.sleep(500)
  }
  return false
}

async function startAPIServer(): Promise<boolean> {
  console.log('[DWS] Starting API server on port 4030...')

  const proc = spawn(['bun', 'run', 'api/server/index.ts'], {
    cwd: DWS_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env,
  })
  processes.push({ name: 'api', process: proc })

  const ready = await waitForPort(4030, 30000)
  if (!ready) {
    console.error('[DWS] Failed to start API server')
    return false
  }

  console.log('[DWS] API server started on port 4030')
  return true
}

async function startFrontend(): Promise<boolean> {
  console.log('[DWS] Starting frontend on port 4031...')

  const proc = spawn(['bun', 'run', 'scripts/dev-frontend.ts'], {
    cwd: DWS_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      API_URL: 'http://127.0.0.1:4030',
      PORT: '4031',
    },
  })
  processes.push({ name: 'frontend', process: proc })

  // Frontend doesn't have health endpoint, wait for port to be listening
  const start = Date.now()
  while (Date.now() - start < 30000) {
    try {
      const response = await fetch('http://127.0.0.1:4031/', {
        signal: AbortSignal.timeout(1000),
      })
      if (response.ok) {
        console.log('[DWS] Frontend started on port 4031')
        return true
      }
    } catch {
      await Bun.sleep(500)
    }
  }

  console.error('[DWS] Failed to start frontend')
  return false
}

function cleanup() {
  console.log('[DWS] Shutting down servers...')
  for (const { name, process } of processes) {
    if (process.exitCode === null) {
      console.log(`[DWS] Stopping ${name}...`)
      process.kill()
    }
  }
}

process.on('SIGINT', () => {
  cleanup()
  process.exit(0)
})

process.on('SIGTERM', () => {
  cleanup()
  process.exit(0)
})

async function main() {
  console.log('[DWS] Starting combined server (API + Frontend)...')

  // Start API first
  if (!(await startAPIServer())) {
    cleanup()
    process.exit(1)
  }

  // Start frontend
  if (!(await startFrontend())) {
    cleanup()
    process.exit(1)
  }

  console.log('[DWS] All servers started successfully')
  console.log('[DWS] API:      http://127.0.0.1:4030')
  console.log('[DWS] Frontend: http://127.0.0.1:4031')

  // Keep running until interrupted
  await Promise.all(processes.map((p) => p.process.exited))
}

main().catch((error) => {
  console.error('[DWS] Fatal error:', error)
  cleanup()
  process.exit(1)
})
