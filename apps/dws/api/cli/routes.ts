/**
 * CLI API Routes - Endpoints for Jeju CLI
 *
 * Provides Vercel/Wrangler-like APIs:
 * - /auth/wallet - Wallet-based authentication
 * - /account/* - Account management
 * - /workers/* - Worker deployment and management
 * - /secrets/* - Environment secrets
 * - /logs/* - Application logs
 * - /previews/* - Preview deployments
 */

import { Elysia } from 'elysia'
import { type Address, isAddress, verifyMessage } from 'viem'
import { z } from 'zod'
import { x402State } from '../state'

// ============================================================================
// Types
// ============================================================================

export interface AuthSession {
  address: Address
  token: string
  network: string
  createdAt: number
  expiresAt: number
}

export interface DeployedWorker {
  workerId: string
  name: string
  owner: Address
  codeCid: string
  routes: string[]
  memory: number
  timeout: number
  status: 'active' | 'inactive' | 'error'
  version: number
  createdAt: number
  updatedAt: number
  invocations: number
  errors: number
}

export interface Secret {
  key: string
  scope: 'production' | 'preview' | 'development' | 'all'
  createdAt: number
  updatedAt: number
}

export interface SecretValue {
  key: string
  value: string
  scope: string
}

export interface LogEntry {
  timestamp: number
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  message: string
  source: 'worker' | 'frontend' | 'system'
  workerId?: string
  appName?: string
}

export interface PreviewDeployment {
  previewId: string
  appName: string
  branchName: string
  commitSha: string
  status: 'pending' | 'building' | 'deploying' | 'active' | 'sleeping' | 'error'
  previewUrl: string
  apiUrl?: string
  owner: Address
  createdAt: number
  updatedAt: number
  expiresAt: number
}

export interface AccountUsage {
  cpuHoursUsed: number
  cpuHoursLimit: number
  storageUsedGb: number
  storageGbLimit: number
  bandwidthUsedGb: number
  bandwidthGbLimit: number
  deploymentsUsed: number
  deploymentsLimit: number
  invocationsUsed: number
  invocationsLimit: number
}

// ============================================================================
// In-Memory State (Replace with SQLit in production)
// ============================================================================

const sessions = new Map<string, AuthSession>()
const workers = new Map<string, DeployedWorker>()
const secrets = new Map<string, SecretValue>() // key format: `${app}:${key}`
const logs: LogEntry[] = []
const previews = new Map<string, PreviewDeployment>()
const accountUsage = new Map<Address, AccountUsage>()

// ============================================================================
// Schemas
// ============================================================================

const WalletAuthSchema = z.object({
  address: z.string().refine(isAddress, 'Invalid address'),
  signature: z.string(),
  message: z.string(),
  network: z.enum(['localnet', 'testnet', 'mainnet']),
})

const WorkerDeploySchema = z.object({
  name: z.string().min(1).max(63),
  codeCid: z.string().min(1),
  routes: z.array(z.string()).optional(),
  memory: z.number().min(32).max(4096).optional(),
  timeout: z.number().min(1000).max(300000).optional(),
  vars: z.record(z.string(), z.string()).optional(),
})

const SecretSetSchema = z.object({
  app: z.string().min(1),
  key: z.string().min(1).max(128),
  value: z.string().max(65536),
  scope: z.enum(['production', 'preview', 'development', 'all']).optional(),
})

const PreviewCreateSchema = z.object({
  appName: z.string().min(1).max(63),
  branchName: z.string().min(1).max(255),
  commitSha: z.string().length(40),
  type: z.enum(['branch', 'pr', 'commit']).optional(),
  ttlHours: z.number().min(1).max(720).optional(),
})

// ============================================================================
// Helpers
// ============================================================================

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function generateWorkerId(): string {
  return `wkr_${generateToken().slice(0, 24)}`
}

function generatePreviewId(): string {
  return `prv_${generateToken().slice(0, 16)}`
}

function validateAuth(
  headers: Record<string, string | undefined>,
): AuthSession | null {
  const authHeader = headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)
  const session = sessions.get(token)

  if (!session) return null
  if (session.expiresAt < Date.now()) {
    sessions.delete(token)
    return null
  }

  return session
}

function requireAuth(headers: Record<string, string | undefined>): AuthSession {
  const session = validateAuth(headers)
  if (!session) {
    throw new Error('Unauthorized')
  }
  return session
}

function getDefaultUsage(): AccountUsage {
  return {
    cpuHoursUsed: 0,
    cpuHoursLimit: 100,
    storageUsedGb: 0,
    storageGbLimit: 1,
    bandwidthUsedGb: 0,
    bandwidthGbLimit: 10,
    deploymentsUsed: 0,
    deploymentsLimit: 3,
    invocationsUsed: 0,
    invocationsLimit: 100_000,
  }
}

function addLog(entry: Omit<LogEntry, 'timestamp'>): void {
  logs.push({ ...entry, timestamp: Date.now() })
  // Keep only last 10000 logs
  if (logs.length > 10000) {
    logs.splice(0, logs.length - 10000)
  }
}

// ============================================================================
// Routes
// ============================================================================

export function createCLIRoutes() {
  return (
    new Elysia()
      // ========================================
      // Authentication Routes
      // ========================================
      .group('/auth', (auth) =>
        auth
          .post('/wallet', async ({ body }) => {
            const parsed = WalletAuthSchema.safeParse(body)
            if (!parsed.success) {
              return { error: 'Invalid request', details: parsed.error.issues }
            }

            const { address, signature, message, network } = parsed.data

            // Verify signature
            const isValid = await verifyMessage({
              address: address as Address,
              message,
              signature: signature as `0x${string}`,
            })

            if (!isValid) {
              return { error: 'Invalid signature' }
            }

            // Create session
            const token = generateToken()
            const session: AuthSession = {
              address: address as Address,
              token,
              network,
              createdAt: Date.now(),
              expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
            }

            sessions.set(token, session)

            addLog({
              level: 'info',
              message: `User ${address} authenticated on ${network}`,
              source: 'system',
            })

            return {
              token,
              expiresAt: session.expiresAt,
              address,
              network,
            }
          })
          .post('/logout', ({ headers }) => {
            const authHeader = headers.authorization
            if (authHeader?.startsWith('Bearer ')) {
              sessions.delete(authHeader.slice(7))
            }
            return { success: true }
          })
          .get('/verify', ({ headers }) => {
            const session = validateAuth(headers)
            if (!session) {
              return { valid: false }
            }
            return {
              valid: true,
              address: session.address,
              network: session.network,
              expiresAt: session.expiresAt,
            }
          }),
      )

      // ========================================
      // Account Routes
      // ========================================
      .group('/account', (account) =>
        account
          .get('/info', async ({ headers }) => {
            const session = requireAuth(headers)
            const credits = await x402State.getCredits(session.address)
            const usage = accountUsage.get(session.address) ?? getDefaultUsage()

            return {
              address: session.address,
              credits: credits.toString(),
              tier: 'free',
              usage,
              billing: {
                periodStart: Date.now() - 30 * 24 * 60 * 60 * 1000,
                periodEnd: Date.now(),
                estimatedCost: '0',
              },
            }
          })
          .get('/usage', ({ headers, query }) => {
            const session = requireAuth(headers)
            const days = parseInt(String(query.days ?? '30'), 10)
            const usage = accountUsage.get(session.address) ?? getDefaultUsage()

            // Generate daily usage data
            const daily: Array<{
              date: string
              cpuHours: number
              storageGb: number
              invocations: number
            }> = []
            for (let i = 0; i < days; i++) {
              const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
              daily.push({
                date: date.toISOString().split('T')[0],
                cpuHours: Math.random() * (usage.cpuHoursUsed / days),
                storageGb: usage.storageUsedGb,
                invocations: Math.floor(
                  Math.random() * (usage.invocationsUsed / days),
                ),
              })
            }

            return { daily: daily.reverse() }
          })
          .get('/transactions', ({ headers }) => {
            requireAuth(headers)

            // Return empty for now - would be populated from x402 state
            return { transactions: [] }
          })
          .post('/upgrade', async ({ headers, body }) => {
            const session = requireAuth(headers)
            const tier = (body as { tier: string }).tier

            addLog({
              level: 'info',
              message: `User ${session.address} upgraded to ${tier}`,
              source: 'system',
            })

            return { success: true, tier }
          }),
      )

      // ========================================
      // Worker Routes
      // ========================================
      .group('/workers', (workerRoutes) =>
        workerRoutes
          .get('/list', ({ headers }) => {
            const session = requireAuth(headers)
            const userWorkers = Array.from(workers.values()).filter(
              (w) => w.owner.toLowerCase() === session.address.toLowerCase(),
            )

            return { workers: userWorkers }
          })
          .get('/:workerId', ({ params, headers }) => {
            requireAuth(headers)
            const worker = workers.get(params.workerId)
            if (!worker) {
              return { error: 'Worker not found' }
            }
            return worker
          })
          .post('/deploy', async ({ body, headers }) => {
            const session = requireAuth(headers)
            const parsed = WorkerDeploySchema.safeParse(body)

            if (!parsed.success) {
              return { error: 'Invalid request', details: parsed.error.issues }
            }

            const { name, codeCid, routes, memory, timeout } = parsed.data

            // Check if worker already exists
            const existing = Array.from(workers.values()).find(
              (w) =>
                w.name === name &&
                w.owner.toLowerCase() === session.address.toLowerCase(),
            )

            const workerId = existing?.workerId ?? generateWorkerId()
            const version = existing ? existing.version + 1 : 1

            const worker: DeployedWorker = {
              workerId,
              name,
              owner: session.address,
              codeCid,
              routes: routes ?? [`/${name}/*`],
              memory: memory ?? 128,
              timeout: timeout ?? 30000,
              status: 'active',
              version,
              createdAt: existing?.createdAt ?? Date.now(),
              updatedAt: Date.now(),
              invocations: existing?.invocations ?? 0,
              errors: existing?.errors ?? 0,
            }

            workers.set(workerId, worker)

            // Update usage
            const usage = accountUsage.get(session.address) ?? getDefaultUsage()
            usage.deploymentsUsed++
            accountUsage.set(session.address, usage)

            addLog({
              level: 'info',
              message: `Worker ${name} deployed (v${version})`,
              source: 'worker',
              workerId,
            })

            return worker
          })
          .delete('/:workerId', ({ params, headers }) => {
            const session = requireAuth(headers)
            const worker = workers.get(params.workerId)

            if (!worker) {
              return { error: 'Worker not found' }
            }

            if (worker.owner.toLowerCase() !== session.address.toLowerCase()) {
              return { error: 'Not authorized' }
            }

            workers.delete(params.workerId)

            addLog({
              level: 'info',
              message: `Worker ${worker.name} deleted`,
              source: 'worker',
              workerId: params.workerId,
            })

            return { success: true }
          })
          .post('/:workerId/rollback', async ({ params, headers, body }) => {
            const session = requireAuth(headers)
            const worker = workers.get(params.workerId)

            if (!worker) {
              return { error: 'Worker not found' }
            }

            if (worker.owner.toLowerCase() !== session.address.toLowerCase()) {
              return { error: 'Not authorized' }
            }

            const targetVersion =
              (body as { version?: number }).version ?? worker.version - 1

            // In real impl, would restore from version history
            worker.version = targetVersion
            worker.updatedAt = Date.now()

            addLog({
              level: 'info',
              message: `Worker ${worker.name} rolled back to v${targetVersion}`,
              source: 'worker',
              workerId: params.workerId,
            })

            return { success: true, version: targetVersion }
          })
          .get('/:workerId/logs', ({ params, headers, query }) => {
            requireAuth(headers)
            const since = query.since
              ? parseInt(String(query.since), 10)
              : Date.now() - 60 * 60 * 1000
            const limit = parseInt(String(query.limit ?? '100'), 10)

            const workerLogs = logs
              .filter(
                (l) => l.workerId === params.workerId && l.timestamp >= since,
              )
              .slice(-limit)

            return { logs: workerLogs }
          }),
      )

      // ========================================
      // Secrets Routes
      // ========================================
      .group('/secrets', (secretRoutes) =>
        secretRoutes
          .get('/list', ({ headers, query }) => {
            requireAuth(headers)
            const app = query.app as string

            if (!app) {
              return { error: 'App name required' }
            }

            const appSecrets: Secret[] = []
            for (const [key, value] of secrets.entries()) {
              if (key.startsWith(`${app}:`)) {
                appSecrets.push({
                  key: key.split(':')[1],
                  scope: value.scope as Secret['scope'],
                  createdAt: 0, // Would be stored in SQLit
                  updatedAt: Date.now(),
                })
              }
            }

            return { secrets: appSecrets }
          })
          .get('/get', ({ headers, query }) => {
            requireAuth(headers)
            const app = query.app as string
            const key = query.key as string

            if (!app || !key) {
              return { error: 'App and key required' }
            }

            const secret = secrets.get(`${app}:${key}`)
            if (!secret) {
              return { error: 'Secret not found' }
            }

            return { value: secret.value }
          })
          .post('/set', async ({ body, headers }) => {
            requireAuth(headers)
            const parsed = SecretSetSchema.safeParse(body)

            if (!parsed.success) {
              return { error: 'Invalid request', details: parsed.error.issues }
            }

            const { app, key, value, scope } = parsed.data

            secrets.set(`${app}:${key}`, {
              key,
              value,
              scope: scope ?? 'all',
            })

            addLog({
              level: 'info',
              message: `Secret ${key} set for ${app}`,
              source: 'system',
              appName: app,
            })

            return { success: true }
          })
          .delete('/delete', async ({ body, headers }) => {
            requireAuth(headers)
            const { app, key } = body as { app: string; key: string }

            if (!app || !key) {
              return { error: 'App and key required' }
            }

            secrets.delete(`${app}:${key}`)

            addLog({
              level: 'info',
              message: `Secret ${key} deleted for ${app}`,
              source: 'system',
              appName: app,
            })

            return { success: true }
          }),
      )

      // ========================================
      // Logs Routes
      // ========================================
      .group('/logs', (logRoutes) =>
        logRoutes
          .get('/query', ({ headers, query }) => {
            requireAuth(headers)
            const app = query.app as string
            const since = query.since
              ? parseInt(String(query.since), 10)
              : Date.now() - 60 * 60 * 1000
            const limit = parseInt(String(query.limit ?? '100'), 10)
            const level = query.level as string | undefined
            const source = query.source as string | undefined

            let filteredLogs = logs.filter((l) => l.timestamp >= since)

            if (app) {
              filteredLogs = filteredLogs.filter((l) => l.appName === app)
            }
            if (level) {
              filteredLogs = filteredLogs.filter((l) => l.level === level)
            }
            if (source) {
              filteredLogs = filteredLogs.filter((l) => l.source === source)
            }

            return { logs: filteredLogs.slice(-limit) }
          })
          .get('/stream', async ({ headers, set }) => {
            requireAuth(headers)

            // Set SSE headers
            set.headers['content-type'] = 'text/event-stream'
            set.headers['cache-control'] = 'no-cache'
            set.headers.connection = 'keep-alive'

            // For now, return a simple response - real impl would use SSE
            return { message: 'Use WebSocket for real-time logs' }
          }),
      )

      // ========================================
      // Preview Routes
      // ========================================
      .group('/previews', (previewRoutes) =>
        previewRoutes
          .get('/list', ({ headers, query }) => {
            const session = requireAuth(headers)
            const app = query.app as string | undefined

            let userPreviews = Array.from(previews.values()).filter(
              (p) => p.owner.toLowerCase() === session.address.toLowerCase(),
            )

            if (app) {
              userPreviews = userPreviews.filter((p) => p.appName === app)
            }

            return { previews: userPreviews }
          })
          .get('/:previewId', ({ params, headers }) => {
            requireAuth(headers)
            const preview = previews.get(params.previewId)

            if (!preview) {
              return { error: 'Preview not found' }
            }

            return preview
          })
          .post('/create', async ({ body, headers }) => {
            const session = requireAuth(headers)
            const parsed = PreviewCreateSchema.safeParse(body)

            if (!parsed.success) {
              return { error: 'Invalid request', details: parsed.error.issues }
            }

            const { appName, branchName, commitSha, ttlHours } = parsed.data

            const previewId = generatePreviewId()
            const ttl = (ttlHours ?? 72) * 60 * 60 * 1000

            // Generate preview URL
            const sanitizedBranch = branchName
              .toLowerCase()
              .replace(/[^a-z0-9-]/g, '-')
              .slice(0, 20)
            const previewUrl = `https://${sanitizedBranch}.${appName}.preview.dws.jejunetwork.org`

            const preview: PreviewDeployment = {
              previewId,
              appName,
              branchName,
              commitSha,
              status: 'pending',
              previewUrl,
              owner: session.address,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              expiresAt: Date.now() + ttl,
            }

            previews.set(previewId, preview)

            addLog({
              level: 'info',
              message: `Preview created for ${appName}/${branchName}`,
              source: 'system',
              appName,
            })

            // Simulate async build/deploy
            setTimeout(() => {
              const p = previews.get(previewId)
              if (p) {
                p.status = 'active'
                p.updatedAt = Date.now()
              }
            }, 5000)

            return preview
          })
          .delete('/:previewId', ({ params, headers }) => {
            const session = requireAuth(headers)
            const preview = previews.get(params.previewId)

            if (!preview) {
              return { error: 'Preview not found' }
            }

            if (preview.owner.toLowerCase() !== session.address.toLowerCase()) {
              return { error: 'Not authorized' }
            }

            previews.delete(params.previewId)

            addLog({
              level: 'info',
              message: `Preview ${params.previewId} deleted`,
              source: 'system',
              appName: preview.appName,
            })

            return { success: true }
          }),
      )

      // ========================================
      // JNS Routes (for CLI)
      // ========================================
      .group('/jns', (jnsRoutes) =>
        jnsRoutes.post('/register', async ({ body, headers }) => {
          requireAuth(headers)
          const { name, contentCid, workerId } = body as {
            name: string
            contentCid?: string
            workerId?: string
          }

          // In real impl, would register on-chain via JNS contract
          addLog({
            level: 'info',
            message: `JNS name ${name} registered`,
            source: 'system',
          })

          return {
            success: true,
            name,
            contentCid,
            workerId,
          }
        }),
      )

      // ========================================
      // Funding Routes (CLI-specific)
      // ========================================
      .group('/funding', (fundingRoutes) =>
        fundingRoutes
          .get('/info', () => ({
            paymentAddress: '0x4242424242424242424242424242424242424242',
            acceptedTokens: ['ETH', 'JEJU'],
            minAmount: '0.001',
          }))
          .post('/topup', async ({ body, headers }) => {
            const session = requireAuth(headers)
            const { txHash, amount } = body as {
              txHash: string
              amount: string
            }

            // In real impl, would verify tx on-chain and add credits
            const amountBigInt = BigInt(amount)
            await x402State.addCredits(session.address, amountBigInt)

            const newBalance = await x402State.getCredits(session.address)

            addLog({
              level: 'info',
              message: `User ${session.address} topped up ${amount} wei`,
              source: 'system',
            })

            return {
              success: true,
              txHash,
              amount,
              newBalance: newBalance.toString(),
            }
          }),
      )
  )
}
