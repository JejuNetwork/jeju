import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getCQLBlockProducerUrl } from '@jejunetwork/config'
import { expectHex } from '@jejunetwork/types'
import type { Hex } from 'viem'
import type { PrivateKeyAccount } from 'viem/accounts'
import { privateKeyToAccount } from 'viem/accounts'
import { setupDAppJNS } from './api/services/jns'
import { getStorageService } from './api/services/storage'
import {
  isValidHex,
  parseJsonResponse,
  triggerIdResponseSchema,
} from './lib/schemas'
import type { DeployResult } from './lib/types'

const NETWORK = process.env.NETWORK || 'localnet'
const DWS_URL = process.env.DWS_URL || 'http://localhost:4030'
const COMPUTE_API = process.env.COMPUTE_API || `${DWS_URL}/compute`
const CQL_ENDPOINT = process.env.CQL_ENDPOINT || getCQLBlockProducerUrl()

interface ComputeClient {
  registerService(config: ServiceConfig): Promise<{ success: boolean }>
  registerCron(config: CronConfig): Promise<{ triggerId: Hex }>
  health(): Promise<boolean>
}

interface ServiceConfig {
  name: string
  endpoint: string
  type: 'http' | 'grpc' | 'websocket'
  ports: Record<string, number>
}

interface CronConfig {
  name: string
  type: 'cron'
  expression: string
  webhook: string
}

function createComputeClient(baseUrl: string): ComputeClient {
  const url = baseUrl.replace(/\/$/, '')

  return {
    async registerService(
      config: ServiceConfig,
    ): Promise<{ success: boolean }> {
      const response = await fetch(`${url}/register-service`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
        signal: AbortSignal.timeout(10000),
      })
      return { success: response.ok }
    },

    async registerCron(config: CronConfig): Promise<{ triggerId: Hex }> {
      const response = await fetch(`${url}/cron/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) {
        throw new Error(`Cron registration failed: ${response.status}`)
      }
      return parseJsonResponse(
        response,
        triggerIdResponseSchema,
        'Cron register response',
      )
    },

    async health(): Promise<boolean> {
      const response = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(5000),
      })
      return response.ok
    },
  }
}

const computeClient = createComputeClient(COMPUTE_API)

// Validated Anvil dev key constant
const ANVIL_DEV_KEY = expectHex(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  'ANVIL_DEV_KEY',
)

async function getDeployerWallet(): Promise<PrivateKeyAccount> {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY
  if (!privateKey) {
    // Only allow default dev key in localnet - this is Anvil account #0
    // WARNING: This key is publicly known - NEVER use in production
    if (NETWORK === 'localnet') {
      console.warn(
        '[Deploy] Using default Anvil dev key - DO NOT USE IN PRODUCTION',
      )
      return privateKeyToAccount(ANVIL_DEV_KEY)
    }
    throw new Error(
      'DEPLOYER_PRIVATE_KEY environment variable is required for non-localnet deployment',
    )
  }

  // Validate the provided key format using type guard
  if (!isValidHex(privateKey) || privateKey.length !== 66) {
    throw new Error(
      'DEPLOYER_PRIVATE_KEY must be a valid 32-byte hex string starting with 0x',
    )
  }

  return privateKeyToAccount(privateKey)
}

async function deployDatabase(): Promise<string> {
  console.log('📦 Deploying database schema...')

  const schemaPath = join(import.meta.dir, 'api/db/migrate.ts')

  // Run migration
  const proc = Bun.spawn(['bun', 'run', schemaPath], {
    env: { ...process.env, CQL_BLOCK_PRODUCER_ENDPOINT: CQL_ENDPOINT },
    stdout: 'inherit',
    stderr: 'inherit',
  })

  await proc.exited

  const databaseId = process.env.CQL_DATABASE_ID || 'todo-experimental'
  console.log(`   Database ID: ${databaseId}`)

  return databaseId
}

async function buildFrontend(): Promise<string> {
  console.log('🏗️  Building frontend...')

  const frontendDir = join(import.meta.dir, 'web')

  // Bundle with Bun
  const result = await Bun.build({
    entrypoints: [join(frontendDir, 'app.ts')],
    outdir: join(import.meta.dir, 'dist/web'),
    target: 'browser',
    minify: true,
  })

  if (!result.success) {
    throw new Error('Frontend build failed')
  }

  console.log('   Frontend built successfully')
  return join(import.meta.dir, 'dist/web')
}

async function deployFrontendToIPFS(
  buildDir: string,
  account: PrivateKeyAccount,
): Promise<string> {
  console.log('📤 Uploading frontend to IPFS...')

  // Collect all files
  const files: Array<{ name: string; content: Uint8Array }> = []

  const addFilesFromDir = (dir: string, basePath = '') => {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      const filePath = join(dir, entry)
      const stat = statSync(filePath)

      if (stat.isDirectory()) {
        addFilesFromDir(filePath, `${basePath}${entry}/`)
      } else {
        const content = readFileSync(filePath)
        files.push({
          name: `${basePath}${entry}`,
          content: new Uint8Array(content),
        })
      }
    }
  }

  // Add HTML
  const indexHtml = readFileSync(join(import.meta.dir, 'web/index.html'))
  files.push({ name: 'index.html', content: new Uint8Array(indexHtml) })

  // Add built JS files
  addFilesFromDir(buildDir)

  // Upload primary file (index.html with bundled JS reference)
  const storageService = getStorageService()
  const cid = await storageService.upload(
    files[0].content,
    files[0].name,
    account.address,
  )

  console.log(`   Frontend CID: ${cid}`)
  return cid
}

async function deployBackendToCompute(
  _account: PrivateKeyAccount,
): Promise<string> {
  console.log('🚀 Deploying backend to compute network...')

  // For now, we'll use the local backend endpoint
  // In production, this would deploy to a compute provider
  const backendEndpoint = process.env.BACKEND_URL || 'http://localhost:4500'

  // Register with compute network (if available)
  const result = await computeClient.registerService({
    name: 'todo-dapp-backend',
    endpoint: backendEndpoint,
    type: 'http',
    ports: { main: 4500 },
  })

  if (result.success) {
    console.log('   Backend registered with compute network')
  }

  return backendEndpoint
}

async function registerJNS(
  account: PrivateKeyAccount,
  config: { name: string; frontendCid: string; backendUrl: string },
): Promise<void> {
  console.log('🌐 Registering JNS name...')

  // Use the setupDAppJNS helper which handles registration and records
  await setupDAppJNS(account.address, {
    name: config.name,
    backendUrl: config.backendUrl,
    frontendCid: config.frontendCid,
    description: 'Example Application',
  })

  console.log(`   Registered ${config.name}`)
}

async function setupCronTriggers(
  _account: PrivateKeyAccount,
  backendUrl: string,
): Promise<Hex | null> {
  console.log('⏰ Setting up cron triggers...')

  const result = await computeClient.registerCron({
    name: 'todo-cleanup',
    type: 'cron',
    expression: '0 0 * * *', // Daily at midnight
    webhook: `${backendUrl}/webhooks/cleanup`,
  })

  console.log(`   Trigger ID: ${result.triggerId}`)
  return result.triggerId
}

async function seedOAuth3Registry(): Promise<boolean> {
  console.log('🔐 Seeding OAuth3 registry...')

  // Run the seed script
  const seedPath = join(import.meta.dir, 'scripts/seed.ts')

  const proc = Bun.spawn(['bun', 'run', seedPath], {
    env: process.env,
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const exitCode = await proc.exited

  if (exitCode === 0) {
    console.log('   OAuth3 registry seeded successfully')
    return true
  }

  console.log('   OAuth3 seeding skipped or failed')
  return false
}

async function deploy(): Promise<DeployResult> {
  console.log('\n🚀 DEPLOYING DECENTRALIZED APP TEMPLATE\n')
  console.log(`Network: ${NETWORK}`)
  console.log('')

  const account = await getDeployerWallet()
  console.log(`Deployer: ${account.address}\n`)

  // Deploy database
  const databaseId = await deployDatabase()

  // Build and deploy frontend
  const buildDir = await buildFrontend()
  const frontendCid = await deployFrontendToIPFS(buildDir, account)

  // Deploy backend
  const backendEndpoint = await deployBackendToCompute(account)

  // Register JNS
  const jnsName = process.env.JNS_NAME || 'template.jeju'
  await registerJNS(account, {
    name: jnsName,
    frontendCid,
    backendUrl: backendEndpoint,
  })

  // Setup cron triggers
  const triggerId = await setupCronTriggers(account, backendEndpoint)

  // Seed OAuth3 registry (for localnet/testnet)
  if (NETWORK === 'localnet' || NETWORK === 'testnet') {
    await seedOAuth3Registry()
  }

  const ZERO_HEX = expectHex('0x0', 'Zero hex')
  const result: DeployResult = {
    jnsName,
    frontendCid,
    backendEndpoint,
    a2aEndpoint: `${backendEndpoint}/a2a`,
    mcpEndpoint: `${backendEndpoint}/mcp`,
    databaseId,
    triggerId: triggerId ?? ZERO_HEX,
  }

  console.log('\n✅ DEPLOYMENT COMPLETE\n')
  console.log('📊 Deployment Summary:')
  console.log('═══════════════════════════════════════')
  console.log(`JNS Name:        ${result.jnsName}`)
  console.log(`Frontend CID:    ${result.frontendCid}`)
  console.log(`Backend:         ${result.backendEndpoint}`)
  console.log(`A2A Endpoint:    ${result.a2aEndpoint}`)
  console.log(`MCP Endpoint:    ${result.mcpEndpoint}`)
  console.log(`Auth Endpoint:   ${result.backendEndpoint}/auth`)
  console.log(`Database ID:     ${result.databaseId}`)
  console.log(`Trigger ID:      ${result.triggerId}`)
  console.log('═══════════════════════════════════════\n')

  if (NETWORK === 'localnet') {
    console.log('🔗 Access your dApp:')
    console.log(`   Frontend: http://localhost:4180/ipfs/${result.frontendCid}`)
    console.log(`   API:      ${result.backendEndpoint}`)
    console.log(
      `   A2A:      ${result.a2aEndpoint}/.well-known/agent-card.json`,
    )
    console.log(`   MCP:      ${result.mcpEndpoint}`)
    console.log(`   Auth:     ${result.backendEndpoint}/auth/providers`)
  }

  return result
}

deploy().catch(console.error)
