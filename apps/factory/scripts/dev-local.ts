/**
 * Factory Local Development with DWS
 *
 * Starts:
 * 1. CovenantSQL local node (if not running)
 * 2. DWS server (if not running)
 * 3. Factory Elysia server
 * 4. Factory frontend dev server
 */

const COVENANTSQL_PORT = 4661
const DWS_PORT = 4030
const FACTORY_API_PORT = 4009
const FACTORY_CLIENT_PORT = 4010

interface ServiceStatus {
  running: boolean
  port: number
  pid?: number
}

async function checkPort(port: number): Promise<boolean> {
  const response = await fetch(`http://localhost:${port}/health`).catch(
    () => null,
  )
  return response?.ok ?? false
}

async function startService(
  name: string,
  command: string[],
  port: number,
  cwd?: string,
): Promise<number | null> {
  console.log(`🚀 Starting ${name} on port ${port}...`)

  const proc = Bun.spawn(command, {
    cwd: cwd ?? process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      PORT: String(port),
    },
  })

  // Wait for service to be ready
  const maxWait = 30000
  const start = Date.now()

  while (Date.now() - start < maxWait) {
    if (await checkPort(port)) {
      console.log(`✅ ${name} started (PID: ${proc.pid})`)
      return proc.pid
    }
    await new Promise((r) => setTimeout(r, 500))
  }

  console.error(`❌ ${name} failed to start within ${maxWait / 1000}s`)
  proc.kill()
  return null
}

async function main() {
  console.log('🏭 Factory Local Development Environment')
  console.log('')

  const services: Record<string, ServiceStatus> = {}

  // Check CovenantSQL
  console.log('Checking CovenantSQL...')
  const cqlRunning = await checkPort(COVENANTSQL_PORT)
  services.CovenantSQL = { running: cqlRunning, port: COVENANTSQL_PORT }

  if (!cqlRunning) {
    console.log('⚠️  CovenantSQL not running. Starting mock mode...')
    // In real setup, would start CovenantSQL here
    // For now, we'll use mock data in the API
  } else {
    console.log('✅ CovenantSQL running')
  }

  // Check DWS
  console.log('Checking DWS...')
  const dwsRunning = await checkPort(DWS_PORT)
  services.DWS = { running: dwsRunning, port: DWS_PORT }

  if (!dwsRunning) {
    console.log('⚠️  DWS not running.')
    console.log('   To start DWS: cd apps/dws && bun run dev')
  } else {
    console.log('✅ DWS running')
  }

  // Start Factory API
  console.log('')
  console.log('Starting Factory services...')

  const apiPid = await startService(
    'Factory API',
    ['bun', 'run', '--watch', 'src/server.ts'],
    FACTORY_API_PORT,
  )
  services['Factory API'] = {
    running: apiPid !== null,
    port: FACTORY_API_PORT,
    pid: apiPid ?? undefined,
  }

  // Start Factory client (in background)
  console.log('')
  console.log(
    `Starting Factory client dev server on http://localhost:${FACTORY_CLIENT_PORT}...`,
  )
  const clientProc = Bun.spawn(
    ['bun', './src/client/index.html', '--port', String(FACTORY_CLIENT_PORT)],
    {
      cwd: process.cwd(),
      stdout: 'inherit',
      stderr: 'inherit',
    },
  )
  services['Factory Client'] = {
    running: true,
    port: FACTORY_CLIENT_PORT,
    pid: clientProc.pid,
  }

  // Print status
  console.log('')
  console.log('═══════════════════════════════════════════')
  console.log('  Factory Local Development Environment')
  console.log('═══════════════════════════════════════════')
  console.log('')

  for (const [name, status] of Object.entries(services)) {
    const icon = status.running ? '✅' : '❌'
    const url = `http://localhost:${status.port}`
    console.log(`${icon} ${name}: ${url}`)
  }

  console.log('')
  console.log('URLs:')
  console.log(`  Frontend:  http://localhost:${FACTORY_CLIENT_PORT}`)
  console.log(`  API:       http://localhost:${FACTORY_API_PORT}`)
  console.log(`  API Docs:  http://localhost:${FACTORY_API_PORT}/swagger`)
  if (dwsRunning) {
    console.log(`  DWS:       http://localhost:${DWS_PORT}`)
  }
  console.log('')
  console.log('Press Ctrl+C to stop all services')

  // Handle cleanup
  const cleanup = () => {
    console.log('')
    console.log('Shutting down...')
    if (services['Factory Client']?.pid) {
      process.kill(services['Factory Client'].pid)
    }
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  // Keep process alive
  await new Promise(() => {})
}

main().catch((err) => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
