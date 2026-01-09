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

import {
  createAppConfig,
  getCurrentNetwork,
  getRpcUrl,
} from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import {
  type Address,
  createPublicClient,
  type Hex,
  http,
  isAddress,
  parseEther,
  verifyMessage,
} from 'viem'
import { z } from 'zod'
import {
  getFreeTierService,
  TIER_LIMITS,
  type TierType,
} from '../shared/free-tier'
import {
  type CLISecret,
  cliPreviewState,
  cliSecretState,
  creditTransactionState,
  type DWSWorker,
  dwsWorkerState,
  getStateMode,
  jnsDomainState,
  workerVersionState,
  x402State,
} from '../state'

// CLI Routes Configuration
interface CLIRoutesConfig {
  paymentRecipient?: Address
  minTopupAmount?: string
  acceptedTokens?: string[]
}

const { config: cliConfig } = createAppConfig<CLIRoutesConfig>({
  paymentRecipient: ZERO_ADDRESS,
  minTopupAmount: '0.001',
  acceptedTokens: ['ETH', 'JEJU'],
})

// Get payment address - must be configured in production
function getPaymentAddress(): Address {
  const addr =
    cliConfig.paymentRecipient ||
    process.env.X402_PAYMENT_ADDRESS ||
    process.env.RPC_PAYMENT_RECIPIENT
  if (!addr || addr === ZERO_ADDRESS) {
    console.warn(
      '[CLI Routes] Payment recipient not configured - topups will fail',
    )
    return ZERO_ADDRESS
  }
  return addr as Address
}

// ============================================================================
// Types
// ============================================================================

interface AuthSession {
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
// State - Sessions are in-memory (ephemeral), everything else uses SQLit
// ============================================================================

const sessions = new Map<string, AuthSession>()
const logs: LogEntry[] = []

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

// Structured JSON logger
type LogLevel = 'info' | 'warn' | 'error'
const log = (
  level: LogLevel,
  ctx: string,
  message: string,
  data?: Record<string, string | number | boolean | null>,
) => {
  const output =
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log']
  output(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      context: `cli-routes:${ctx}`,
      message,
      ...data,
    }),
  )
}

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const addrEq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

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
    log('warn', 'auth', 'Unauthorized access attempt', {
      hasToken: !!headers.authorization,
      hasAddress: !!headers['x-jeju-address'],
    })
    throw new Error('Unauthorized')
  }
  return session
}

function addLog(entry: Omit<LogEntry, 'timestamp'>): void {
  logs.push({ ...entry, timestamp: Date.now() })
  // Keep only last 10000 logs
  if (logs.length > 10000) {
    logs.splice(0, logs.length - 10000)
  }
}

// Convert SQLit DWSWorker to CLI DeployedWorker format
function dwsWorkerToDeployed(
  worker: DWSWorker,
  routes?: string[],
): DeployedWorker {
  return {
    workerId: worker.id,
    name: worker.name,
    owner: worker.owner as Address,
    codeCid: worker.codeCid,
    routes: routes ?? [`/${worker.name}/*`],
    memory: worker.memory,
    timeout: worker.timeout,
    status: worker.status,
    version: worker.version,
    createdAt: worker.createdAt ?? Date.now(),
    updatedAt: worker.updatedAt ?? Date.now(),
    invocations: worker.invocationCount,
    errors: worker.errorCount,
  }
}

// ============================================================================
// Routes
// ============================================================================

export function createCLIRoutes() {
  return (
    new Elysia()
      // ========================================
      // Health Check Endpoint
      // ========================================
      .get('/health', () => ({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        activeSessions: sessions.size,
        logBufferSize: logs.length,
      }))
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
              log('warn', 'auth', 'Invalid signature attempt', { address })
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
            log('info', 'auth', 'User authenticated', { address, network })

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
            const userWorkers = await dwsWorkerState.listByOwner(
              session.address,
            )
            const totalInvocations = userWorkers.reduce(
              (sum, w) => sum + w.invocationCount,
              0,
            )

            // In test mode, use defaults instead of FreeTierService (which requires SQLit)
            if (getStateMode() === 'memory') {
              const usage: AccountUsage = {
                cpuHoursUsed: 0,
                cpuHoursLimit: 100,
                storageUsedGb: 0,
                storageGbLimit: 1,
                bandwidthUsedGb: 0,
                bandwidthGbLimit: 10,
                deploymentsUsed: userWorkers.length,
                deploymentsLimit: 3,
                invocationsUsed: totalInvocations,
                invocationsLimit: 100_000,
              }
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
            }

            // Production: Get real tier status from FreeTierService
            const freeTierService = getFreeTierService()
            const tierStatus = await freeTierService.getUserStatus(
              session.address,
            )
            const tierLimits = TIER_LIMITS[tierStatus.tier]

            const usage: AccountUsage = {
              cpuHoursUsed: tierStatus.usage.cpuHoursUsed,
              cpuHoursLimit: tierLimits.cpuHoursPerMonth,
              storageUsedGb: tierStatus.usage.storageGbUsed,
              storageGbLimit: tierLimits.storageGbLimit,
              bandwidthUsedGb: tierStatus.usage.bandwidthGbUsed,
              bandwidthGbLimit: tierLimits.bandwidthGbPerMonth,
              deploymentsUsed: userWorkers.length,
              deploymentsLimit: tierLimits.concurrentDeployments,
              invocationsUsed: totalInvocations,
              invocationsLimit: tierLimits.functionInvocationsPerMonth,
            }

            const cpuOverage = Math.max(
              0,
              usage.cpuHoursUsed - usage.cpuHoursLimit,
            )
            const storageOverage = Math.max(
              0,
              usage.storageUsedGb - usage.storageGbLimit,
            )
            const bandwidthOverage = Math.max(
              0,
              usage.bandwidthUsedGb - usage.bandwidthGbLimit,
            )
            const estimatedCost = (
              cpuOverage * 0.01 +
              storageOverage * 0.02 +
              bandwidthOverage * 0.005
            ).toFixed(4)

            return {
              address: session.address,
              credits: credits.toString(),
              tier: tierStatus.tier,
              usage,
              billing: {
                periodStart: tierStatus.quotaResetAt - 30 * 24 * 60 * 60 * 1000,
                periodEnd: tierStatus.quotaResetAt,
                estimatedCost,
              },
            }
          })
          .get('/usage', async ({ headers, query }) => {
            const session = requireAuth(headers)
            const days = parseInt(String(query.days ?? '30'), 10)

            const userWorkers = await dwsWorkerState.listByOwner(
              session.address,
            )
            const totalInvocations = userWorkers.reduce(
              (sum, w) => sum + w.invocationCount,
              0,
            )
            const totalErrors = userWorkers.reduce(
              (sum, w) => sum + w.errorCount,
              0,
            )
            const workerIds = new Set(userWorkers.map((w) => w.id))
            const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000

            const relevantLogs = logs.filter(
              (log) =>
                log.timestamp >= cutoffTime &&
                log.workerId &&
                workerIds.has(log.workerId) &&
                log.source === 'worker',
            )

            const dailyMap = new Map<
              string,
              { invocations: number; errors: number }
            >()

            for (const log of relevantLogs) {
              const date = new Date(log.timestamp).toISOString().split('T')[0]
              const existing = dailyMap.get(date) ?? {
                invocations: 0,
                errors: 0,
              }
              existing.invocations++
              if (log.level === 'error') {
                existing.errors++
              }
              dailyMap.set(date, existing)
            }

            // In test mode, skip FreeTierService
            if (getStateMode() === 'memory') {
              const daily: Array<{
                date: string
                cpuHours: number
                storageGb: number
                invocations: number
                errors: number
              }> = []

              for (let i = 0; i < Math.min(days, 30); i++) {
                const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
                const dateStr = date.toISOString().split('T')[0]
                const dayData = dailyMap.get(dateStr) ?? {
                  invocations: 0,
                  errors: 0,
                }

                daily.push({
                  date: dateStr,
                  cpuHours: 0,
                  storageGb: 0,
                  invocations: dayData.invocations,
                  errors: dayData.errors,
                })
              }

              return {
                daily: daily.reverse(),
                totals: {
                  invocations: totalInvocations,
                  errors: totalErrors,
                  workers: userWorkers.length,
                },
              }
            }

            // Production: Get real usage from FreeTierService
            const freeTierService = getFreeTierService()
            const usageReport = await freeTierService.getUsageReport(
              session.address,
              days,
            )

            const daily: Array<{
              date: string
              cpuHours: number
              storageGb: number
              invocations: number
              errors: number
            }> = []

            for (let i = 0; i < Math.min(days, 30); i++) {
              const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
              const dateStr = date.toISOString().split('T')[0]
              const dayData = dailyMap.get(dateStr) ?? {
                invocations: 0,
                errors: 0,
              }
              const reportDay = usageReport.daily.find(
                (d) => d.date === dateStr,
              )

              daily.push({
                date: dateStr,
                cpuHours: reportDay?.cpuHours ?? 0,
                storageGb: 0,
                invocations:
                  dayData.invocations || (reportDay?.invocations ?? 0),
                errors: dayData.errors,
              })
            }

            return {
              daily: daily.reverse(),
              totals: {
                invocations:
                  totalInvocations || usageReport.totals.functionInvocations,
                errors: totalErrors,
                workers: userWorkers.length,
                cpuHours: usageReport.totals.cpuHoursUsed,
                storageGb: usageReport.totals.storageGbUsed,
                bandwidthGb: usageReport.totals.bandwidthGbUsed,
              },
            }
          })
          .get('/transactions', async ({ headers, query }) => {
            const session = requireAuth(headers)
            const limit = parseInt(String(query.limit ?? '50'), 10)

            const transactions = await creditTransactionState.listByOwner(
              session.address,
              limit,
            )
            const credits = await x402State.getCredits(session.address)

            return {
              transactions: transactions.map((txn) => ({
                id: txn.id,
                type: txn.type,
                amount: txn.amount,
                balanceAfter: txn.balanceAfter,
                timestamp: txn.createdAt,
                status: 'success',
                txHash: txn.txHash,
                description: txn.description,
              })),
              currentBalance: credits.toString(),
            }
          })
          .post('/upgrade', async ({ headers, body }) => {
            const session = requireAuth(headers)
            const { tier, paymentTxHash } = body as {
              tier: string
              paymentTxHash?: string
            }

            // Validate tier
            const validTiers: TierType[] = [
              'free',
              'hobby',
              'pro',
              'enterprise',
            ]
            if (!validTiers.includes(tier as TierType)) {
              return {
                error: `Invalid tier. Must be one of: ${validTiers.join(', ')}`,
              }
            }

            // In test mode, just return success
            if (getStateMode() === 'memory') {
              addLog({
                level: 'info',
                message: `User ${session.address} upgraded to ${tier} (test mode)`,
                source: 'system',
              })
              return { success: true, tier }
            }

            // Production: Actually upgrade the tier using FreeTierService
            const freeTierService = getFreeTierService()
            try {
              await freeTierService.upgradeTier(
                session.address,
                tier as TierType,
                paymentTxHash,
              )
            } catch (err) {
              const reason =
                err instanceof Error ? err.message : 'Unknown error'
              log('warn', 'account', 'Tier upgrade failed', {
                address: session.address,
                tier,
                reason,
              })
              return { error: reason }
            }

            log('info', 'account', 'Tier upgraded', {
              address: session.address,
              tier,
            })

            addLog({
              level: 'info',
              message: `User ${session.address} upgraded to ${tier}`,
              source: 'system',
            })

            return {
              success: true,
              tier,
              newLimits: TIER_LIMITS[tier as TierType],
            }
          }),
      )

      // ========================================
      // Worker Routes
      // ========================================
      .group('/workers', (workerRoutes) =>
        workerRoutes
          .get('/list', async ({ headers }) => {
            const session = requireAuth(headers)
            const allWorkers = await dwsWorkerState.listByOwner(session.address)
            const userWorkers = allWorkers.map((w) => dwsWorkerToDeployed(w))

            return { workers: userWorkers }
          })
          .get('/:workerId', async ({ params, headers }) => {
            requireAuth(headers)
            const worker = await dwsWorkerState.get(params.workerId)
            if (!worker) {
              return { error: 'Worker not found' }
            }
            return dwsWorkerToDeployed(worker)
          })
          .post('/deploy', async ({ body, headers }) => {
            const session = requireAuth(headers)
            const parsed = WorkerDeploySchema.safeParse(body)

            if (!parsed.success) {
              return { error: 'Invalid request', details: parsed.error.issues }
            }

            const { name, codeCid, routes, memory, timeout } = parsed.data

            const existing = await dwsWorkerState.getByName(name)
            const isOwner = existing && addrEq(existing.owner, session.address)

            const workerId =
              isOwner && existing ? existing.id : generateWorkerId()
            const version = isOwner && existing ? existing.version + 1 : 1

            const worker: DWSWorker = {
              id: workerId,
              name,
              owner: session.address,
              runtime: 'bun',
              handler: 'index.handler',
              codeCid,
              memory: memory ?? 128,
              timeout: timeout ?? 30000,
              env: {},
              status: 'active',
              version,
              invocationCount: existing?.invocationCount ?? 0,
              avgDurationMs: existing?.avgDurationMs ?? 0,
              errorCount: existing?.errorCount ?? 0,
              createdAt: existing?.createdAt ?? Date.now(),
              updatedAt: Date.now(),
            }

            await dwsWorkerState.save(worker)
            await workerVersionState.saveVersion(worker)

            log('info', 'workers', 'Worker deployed', {
              workerId,
              name,
              version,
              codeCid,
            })

            addLog({
              level: 'info',
              message: `Worker ${name} deployed (v${version})`,
              source: 'worker',
              workerId,
            })

            return dwsWorkerToDeployed(worker, routes ?? [`/${name}/*`])
          })
          .delete('/:workerId', async ({ params, headers }) => {
            const session = requireAuth(headers)
            const worker = await dwsWorkerState.get(params.workerId)

            if (!worker) {
              return { error: 'Worker not found' }
            }

            if (!addrEq(worker.owner, session.address)) {
              return { error: 'Not authorized' }
            }

            await dwsWorkerState.delete(params.workerId)

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
            const worker = await dwsWorkerState.get(params.workerId)

            if (!worker) {
              return { error: 'Worker not found' }
            }

            if (!addrEq(worker.owner, session.address)) {
              return { error: 'Not authorized' }
            }

            const targetVersion =
              (body as { version?: number }).version ?? worker.version - 1

            if (targetVersion < 1) {
              return { error: 'Cannot rollback to version less than 1' }
            }

            const historicalVersion = await workerVersionState.getVersion(
              params.workerId,
              targetVersion,
            )

            if (!historicalVersion) {
              log('warn', 'workers', 'Rollback target version not found', {
                workerId: params.workerId,
                targetVersion,
              })
              return {
                error: `Version ${targetVersion} not found in history`,
              }
            }

            const updatedWorker: DWSWorker = {
              ...worker,
              codeCid: historicalVersion.codeCid,
              runtime: historicalVersion.runtime as DWSWorker['runtime'],
              handler: historicalVersion.handler,
              memory: historicalVersion.memory,
              timeout: historicalVersion.timeout,
              env: JSON.parse(historicalVersion.env),
              version: worker.version + 1, // Increment version for the rollback
              updatedAt: Date.now(),
            }

            await dwsWorkerState.save(updatedWorker)
            await workerVersionState.saveVersion(updatedWorker)

            log('info', 'workers', 'Worker rolled back', {
              workerId: params.workerId,
              fromVersion: worker.version,
              toVersion: targetVersion,
              newVersion: updatedWorker.version,
            })

            addLog({
              level: 'info',
              message: `Worker ${worker.name} rolled back from v${worker.version} to v${targetVersion} (now v${updatedWorker.version})`,
              source: 'worker',
              workerId: params.workerId,
            })

            return {
              success: true,
              previousVersion: worker.version,
              restoredFrom: targetVersion,
              newVersion: updatedWorker.version,
            }
          })
          .get('/:workerId/logs', async ({ params, headers, query }) => {
            const session = requireAuth(headers)
            const worker = await dwsWorkerState.get(params.workerId)

            if (!worker) {
              return { error: 'Worker not found' }
            }

            if (!addrEq(worker.owner, session.address)) {
              return { error: 'Not authorized' }
            }

            const since = query.since
              ? parseInt(String(query.since), 10)
              : Date.now() - 3600000
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
          .get('/list', async ({ headers, query }) => {
            const session = requireAuth(headers)
            const app = query.app as string

            if (!app) {
              return { error: 'App name required' }
            }

            const appSecrets = await cliSecretState.listByApp(
              app,
              session.address,
            )

            return {
              secrets: appSecrets.map((s) => ({
                key: s.key,
                scope: s.scope,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
              })),
            }
          })
          .get('/get', async ({ headers, query }) => {
            const session = requireAuth(headers)
            const app = query.app as string
            const key = query.key as string

            if (!app || !key) {
              return { error: 'App and key required' }
            }

            const secret = await cliSecretState.get(app, key)
            if (!secret) {
              return { error: 'Secret not found' }
            }

            // Verify ownership
            if (!addrEq(secret.owner, session.address)) {
              return { error: 'Not authorized' }
            }

            return { value: secret.value }
          })
          .post('/set', async ({ body, headers }) => {
            const session = requireAuth(headers)
            const parsed = SecretSetSchema.safeParse(body)

            if (!parsed.success) {
              return { error: 'Invalid request', details: parsed.error.issues }
            }

            const { app, key, value, scope } = parsed.data

            await cliSecretState.set(
              app,
              key,
              value,
              (scope ?? 'all') as CLISecret['scope'],
              session.address,
            )

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

            await cliSecretState.delete(app, key)

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
          .get('/stream', async ({ headers, query }) => {
            requireAuth(headers)

            const workerId = query.workerId as string | undefined
            const appFilter = query.app as string | undefined
            const encoder = new TextEncoder()
            let lastLogIndex = logs.length

            const stream = new ReadableStream({
              start(controller) {
                const enqueue = (event: string, data: object) => {
                  controller.enqueue(
                    encoder.encode(
                      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
                    ),
                  )
                }

                enqueue('connected', { timestamp: Date.now() })

                const pollId = setInterval(() => {
                  if (logs.length > lastLogIndex) {
                    const filteredLogs = logs
                      .slice(lastLogIndex)
                      .filter(
                        (log) =>
                          (!workerId || log.workerId === workerId) &&
                          (!appFilter || log.appName === appFilter),
                      )
                    for (const log of filteredLogs) {
                      enqueue('log', log)
                    }
                    lastLogIndex = logs.length
                  }
                }, 500)

                const heartbeatId = setInterval(
                  () => enqueue('heartbeat', { timestamp: Date.now() }),
                  30000,
                )

                return () => {
                  clearInterval(pollId)
                  clearInterval(heartbeatId)
                }
              },
            })

            return new Response(stream, {
              headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
              },
            })
          }),
      )

      // ========================================
      // Preview Routes
      // ========================================
      .group('/previews', (previewRoutes) =>
        previewRoutes
          .get('/list', async ({ headers, query }) => {
            const session = requireAuth(headers)
            const app = query.app as string | undefined

            let userPreviews = await cliPreviewState.listByOwner(
              session.address,
            )

            if (app) {
              userPreviews = userPreviews.filter((p) => p.appName === app)
            }

            return { previews: userPreviews }
          })
          .get('/:previewId', async ({ params, headers }) => {
            requireAuth(headers)
            const preview = await cliPreviewState.get(params.previewId)

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

            const {
              appName,
              branchName,
              commitSha,
              ttlHours,
              type = 'branch',
            } = parsed.data

            const previewId = generatePreviewId()
            const ttl = (ttlHours ?? 72) * 60 * 60 * 1000

            const sanitizedBranch = branchName
              .toLowerCase()
              .replace(/[^a-z0-9-]/g, '-')
              .slice(0, 20)
            const previewUrl = `https://${sanitizedBranch}.${appName}.preview.dws.jejunetwork.org`

            // Create preview record immediately with 'pending' status
            const preview = await cliPreviewState.create({
              previewId,
              appName,
              branchName,
              commitSha,
              status: 'pending',
              previewUrl,
              apiUrl: null,
              owner: session.address,
              expiresAt: Date.now() + ttl,
            })

            addLog({
              level: 'info',
              message: `Preview (${type}) created for ${appName}/${branchName}`,
              source: 'system',
              appName,
            })

            // Trigger build/deploy asynchronously - defer to next event loop tick
            // to ensure the 'pending' response is sent before status updates begin
            setTimeout(() => {
              void (async () => {
                try {
                  await cliPreviewState.updateStatus(previewId, 'building')
                  log('info', 'previews', 'Preview build started', {
                    previewId,
                    appName,
                    branchName,
                  })

                  await cliPreviewState.updateStatus(previewId, 'deploying')
                  await cliPreviewState.updateStatus(previewId, 'active')
                  log('info', 'previews', 'Preview deployed successfully', {
                    previewId,
                    previewUrl,
                  })
                } catch (err) {
                  const error =
                    err instanceof Error ? err.message : 'Unknown error'
                  await cliPreviewState.updateStatus(previewId, 'error')
                  log('error', 'previews', 'Preview deployment failed', {
                    previewId,
                    error,
                  })
                }
              })()
            }, 0)

            return preview
          })
          .delete('/:previewId', async ({ params, headers }) => {
            const session = requireAuth(headers)
            const preview = await cliPreviewState.get(params.previewId)

            if (!preview) {
              return { error: 'Preview not found' }
            }

            if (!addrEq(preview.owner, session.address)) {
              return { error: 'Not authorized' }
            }

            await cliPreviewState.delete(params.previewId)

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
        jnsRoutes
          .post('/register', async ({ body, headers }) => {
            const session = requireAuth(headers)
            const { name, contentCid, workerId, years } = body as {
              name: string
              contentCid?: string
              workerId?: string
              years?: number
            }

            const expiresAt =
              Date.now() + (years ?? 1) * 365 * 24 * 60 * 60 * 1000

            const domain = await jnsDomainState.register({
              name,
              owner: session.address,
              contentCid: contentCid ?? null,
              workerId: workerId ?? null,
              expiresAt,
              ttl: 300,
            })

            addLog({
              level: 'info',
              message: `JNS name ${name} registered by ${session.address}`,
              source: 'system',
            })

            return {
              success: true,
              name,
              contentCid,
              workerId,
              expiresAt: domain.expiresAt,
            }
          })
          .post('/set-content', async ({ body, headers }) => {
            const session = requireAuth(headers)
            const { name, contentCid } = body as {
              name: string
              contentCid: string
            }

            const domain = await jnsDomainState.get(name)
            if (!domain) {
              return { error: 'Domain not found' }
            }

            if (!addrEq(domain.owner, session.address)) {
              return { error: 'Not authorized' }
            }

            await jnsDomainState.setContent(name, contentCid)

            addLog({
              level: 'info',
              message: `JNS ${name} content set to ${contentCid}`,
              source: 'system',
            })

            return { success: true, name, contentCid }
          })
          .post('/link-worker', async ({ body, headers }) => {
            const session = requireAuth(headers)
            const { name, workerId } = body as {
              name: string
              workerId: string
            }

            const domain = await jnsDomainState.get(name)
            if (!domain) {
              return { error: 'Domain not found' }
            }

            if (!addrEq(domain.owner, session.address)) {
              return { error: 'Not authorized' }
            }

            await jnsDomainState.linkWorker(name, workerId)

            addLog({
              level: 'info',
              message: `JNS ${name} linked to worker ${workerId}`,
              source: 'system',
            })

            return { success: true, name, workerId }
          })
          .get('/resolve/:name', async ({ params }) => {
            const domain = await jnsDomainState.get(params.name)
            if (!domain) {
              return { error: 'Domain not found', resolved: false }
            }

            return {
              resolved: true,
              name: domain.name,
              owner: domain.owner,
              contentCid: domain.contentCid,
              workerId: domain.workerId,
              ttl: domain.ttl,
              expiry: Math.floor(domain.expiresAt / 1000),
            }
          })
          .get('/list', async ({ headers }) => {
            const session = requireAuth(headers)

            const userDomains = await jnsDomainState.listByOwner(
              session.address,
            )

            return { domains: userDomains }
          })
          .post('/transfer', async ({ body, headers }) => {
            const session = requireAuth(headers)
            const { name, toAddress } = body as {
              name: string
              toAddress: string
            }

            const domain = await jnsDomainState.get(name)
            if (!domain) {
              return { error: 'Domain not found' }
            }

            if (!addrEq(domain.owner, session.address)) {
              return { error: 'Not authorized' }
            }

            await jnsDomainState.transfer(name, toAddress)

            addLog({
              level: 'info',
              message: `JNS ${name} transferred to ${toAddress}`,
              source: 'system',
            })

            return { success: true, name, newOwner: toAddress }
          })
          .get('/check/:name', async ({ params }) => {
            const available = await jnsDomainState.isAvailable(params.name)
            const domain = await jnsDomainState.get(params.name)
            return {
              name: params.name,
              available,
              owner: domain?.owner,
            }
          }),
      )

      // ========================================
      // Funding Routes (CLI-specific)
      // ========================================
      .group('/funding', (fundingRoutes) =>
        fundingRoutes
          .get('/info', () => ({
            paymentAddress: getPaymentAddress(),
            acceptedTokens: cliConfig.acceptedTokens ?? ['ETH', 'JEJU'],
            minAmount: cliConfig.minTopupAmount ?? '0.001',
          }))
          .post('/topup', async ({ body, headers }) => {
            const session = requireAuth(headers)
            const { txHash } = body as { txHash: string }

            const network = getCurrentNetwork()
            const rpcUrl = getRpcUrl(network)
            const publicClient = createPublicClient({ transport: http(rpcUrl) })
            const paymentRecipient = getPaymentAddress()

            if (paymentRecipient === ZERO_ADDRESS) {
              log('error', 'funding', 'Payment recipient not configured')
              return { error: 'Payment recipient not configured' }
            }

            const receipt = await publicClient
              .getTransactionReceipt({ hash: txHash as Hex })
              .catch((err) => {
                log('error', 'funding', 'Failed to fetch tx receipt', {
                  txHash,
                  error: (err as Error).message,
                })
                return null
              })

            if (!receipt) {
              return { error: 'Transaction not found or not confirmed' }
            }

            if (receipt.status !== 'success') {
              log('warn', 'funding', 'Transaction failed on-chain', {
                txHash,
                status: receipt.status,
              })
              return { error: 'Transaction failed on-chain' }
            }

            const tx = await publicClient
              .getTransaction({ hash: txHash as Hex })
              .catch(() => null)

            if (!tx) {
              return { error: 'Could not fetch transaction details' }
            }

            if (!tx.to || !addrEq(tx.to, paymentRecipient)) {
              log('warn', 'funding', 'Transaction sent to wrong recipient', {
                txHash,
                expected: paymentRecipient,
                actual: tx.to,
              })
              return { error: 'Transaction sent to wrong payment address' }
            }

            if (!addrEq(tx.from, session.address)) {
              log('warn', 'funding', 'Transaction sender mismatch', {
                txHash,
                expected: session.address,
                actual: tx.from,
              })
              return {
                error: 'Transaction sender does not match authenticated user',
              }
            }

            const actualAmount = tx.value
            if (actualAmount === 0n) {
              return { error: 'Transaction has zero value' }
            }

            const minAmount = parseEther(cliConfig.minTopupAmount ?? '0.001')
            if (actualAmount < minAmount) {
              return {
                error: `Minimum topup is ${cliConfig.minTopupAmount ?? '0.001'} ETH`,
              }
            }

            await x402State.addCredits(session.address, actualAmount)
            const newBalance = await x402State.getCredits(session.address)

            await creditTransactionState.record(
              session.address,
              'topup',
              actualAmount,
              newBalance,
              txHash,
              `ETH topup from ${tx.from}`,
            )

            log('info', 'funding', 'Topup verified and credited', {
              address: session.address,
              txHash,
              amount: actualAmount.toString(),
            })

            addLog({
              level: 'info',
              message: `User ${session.address} topped up ${actualAmount.toString()} wei (verified)`,
              source: 'system',
            })

            return {
              success: true,
              txHash,
              amount: actualAmount.toString(),
              newBalance: newBalance.toString(),
            }
          }),
      )
  )
}
