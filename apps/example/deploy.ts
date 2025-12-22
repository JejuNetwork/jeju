import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Hex } from 'viem'
import type { PrivateKeyAccount } from 'viem/accounts'
import { privateKeyToAccount, signMessage } from 'viem/accounts'
import type { DeployResult } from './src/types'

const NETWORK = process.env.NETWORK || 'localnet'
const DWS_URL = process.env.DWS_URL || 'http://localhost:4030'
const GATEWAY_API = process.env.GATEWAY_API || `${DWS_URL}/cdn`
const STORAGE_API = process.env.STORAGE_API || `${DWS_URL}/storage`
const COMPUTE_API = process.env.COMPUTE_API || `${DWS_URL}/compute`
const CQL_ENDPOINT = process.env.CQL_ENDPOINT || 'http://localhost:4300'

async function getDeployerWallet(): Promise<PrivateKeyAccount> {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY
  if (!privateKey) {
    // Only allow default dev key in localnet - this is Anvil account #0
    // WARNING: This key is publicly known - NEVER use in production
    if (NETWORK === 'localnet') {
      console.warn(
        '[Deploy] Using default Anvil dev key - DO NOT USE IN PRODUCTION',
      )
      // Anvil account #0 - well-known test key
      const ANVIL_DEV_KEY =
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
      return privateKeyToAccount(ANVIL_DEV_KEY as `0x${string}`)
    }
    throw new Error(
      'DEPLOYER_PRIVATE_KEY environment variable is required for non-localnet deployment',
    )
  }

  // Validate the provided key format
  if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    throw new Error(
      'DEPLOYER_PRIVATE_KEY must be a valid 32-byte hex string starting with 0x',
    )
  }

  return privateKeyToAccount(privateKey as `0x${string}`)
}

async function deployDatabase(): Promise<string> {
  console.log('📦 Deploying database schema...')

  const schemaPath = join(import.meta.dir, 'src/db/migrate.ts')

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

  const frontendDir = join(import.meta.dir, 'src/frontend')

  // Bundle with Bun
  const result = await Bun.build({
    entrypoints: [join(frontendDir, 'app.ts')],
    outdir: join(import.meta.dir, 'dist/frontend'),
    target: 'browser',
    minify: true,
  })

  if (!result.success) {
    throw new Error('Frontend build failed')
  }

  console.log('   Frontend built successfully')
  return join(import.meta.dir, 'dist/frontend')
}

async function deployFrontendToIPFS(
  buildDir: string,
  account: PrivateKeyAccount,
): Promise<string> {
  console.log('📤 Uploading frontend to IPFS...')

  const timestamp = Date.now().toString()
  const message = `jeju-storage:${timestamp}`
  const signature = await signMessage(account, { message })

  // Create directory upload
  const formData = new FormData()

  // Add all files from build directory
  const addFilesToFormData = (dir: string, basePath = '') => {
    const files = readdirSync(dir)
    for (const file of files) {
      const filePath = join(dir, file)
      const stat = statSync(filePath)

      if (stat.isDirectory()) {
        addFilesToFormData(filePath, `${basePath}${file}/`)
      } else {
        const content = readFileSync(filePath)
        formData.append('file', new Blob([content]), `${basePath}${file}`)
      }
    }
  }

  // Add HTML and built JS
  const indexHtml = readFileSync(
    join(import.meta.dir, 'src/frontend/index.html'),
  )
  formData.append('file', new Blob([indexHtml]), 'index.html')
  addFilesToFormData(buildDir)

  formData.append('tier', 'permanent')
  formData.append('name', 'todo-dapp-frontend')

  const response = await fetch(`${STORAGE_API}/upload-directory`, {
    method: 'POST',
    headers: {
      'x-jeju-address': account.address,
      'x-jeju-timestamp': timestamp,
      'x-jeju-signature': signature,
    },
    body: formData,
  })

  if (!response.ok) {
    // Fallback to single file upload
    console.log('   Directory upload not available, using single file...')

    const singleResponse = await fetch(`${STORAGE_API}/upload`, {
      method: 'POST',
      headers: {
        'x-jeju-address': account.address,
        'x-jeju-timestamp': timestamp,
        'x-jeju-signature': signature,
      },
      body: formData,
    })

    if (!singleResponse.ok) {
      throw new Error(
        `Failed to upload frontend: ${await singleResponse.text()}`,
      )
    }

    const data = (await singleResponse.json()) as { cid: string }
    return data.cid
  }

  const data = (await response.json()) as { cid: string }
  console.log(`   Frontend CID: ${data.cid}`)

  return data.cid
}

async function deployBackendToCompute(
  account: PrivateKeyAccount,
): Promise<string> {
  console.log('🚀 Deploying backend to compute network...')

  // For now, we'll use the local backend endpoint
  // In production, this would deploy to a compute provider
  const backendEndpoint = process.env.BACKEND_URL || 'http://localhost:4500'

  // Register with compute network (if available)
  const timestamp = Date.now().toString()
  const message = `jeju-compute:${timestamp}`
  const signature = await signMessage(account, { message })

  const response = await fetch(`${COMPUTE_API}/register-service`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': account.address,
      'x-jeju-timestamp': timestamp,
      'x-jeju-signature': signature,
    },
    body: JSON.stringify({
      name: 'todo-dapp-backend',
      endpoint: backendEndpoint,
      type: 'http',
      ports: { main: 4500 },
    }),
  }).catch(() => null)

  if (response?.ok) {
    console.log('   Backend registered with compute network')
  } else {
    console.log('   Using local backend (compute registration skipped)')
  }

  return backendEndpoint
}

async function registerJNS(
  account: PrivateKeyAccount,
  config: { name: string; frontendCid: string; backendUrl: string },
): Promise<void> {
  console.log('🌐 Registering JNS name...')

  const timestamp = Date.now().toString()
  const message = `jeju-jns:${timestamp}`
  const signature = await signMessage(account, { message })

  const headers = {
    'Content-Type': 'application/json',
    'x-jeju-address': account.address,
    'x-jeju-timestamp': timestamp,
    'x-jeju-signature': signature,
  }

  // Check availability
  const availableResponse = await fetch(
    `${GATEWAY_API}/jns/available/${config.name}`,
  ).catch(() => null)

  if (availableResponse?.ok) {
    const data = (await availableResponse.json()) as { available: boolean }

    if (data.available) {
      // Register name
      const registerResponse = await fetch(`${GATEWAY_API}/jns/register`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: config.name,
          owner: account.address,
          durationYears: 1,
        }),
      })

      if (registerResponse.ok) {
        console.log(`   Registered ${config.name}`)
      }
    }
  }

  // Set records
  const records = {
    address: account.address,
    contentHash: `ipfs://${config.frontendCid}`,
    a2aEndpoint: `${config.backendUrl}/a2a`,
    mcpEndpoint: `${config.backendUrl}/mcp`,
    restEndpoint: `${config.backendUrl}/api/v1`,
    description: 'Decentralized Todo Application',
  }

  const recordsResponse = await fetch(
    `${GATEWAY_API}/jns/records/${config.name}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(records),
    },
  ).catch(() => null)

  if (recordsResponse?.ok) {
    console.log('   JNS records updated')
  } else {
    console.log('   JNS records update skipped (gateway not available)')
  }
}

async function setupCronTriggers(
  account: PrivateKeyAccount,
  backendUrl: string,
): Promise<Hex | null> {
  console.log('⏰ Setting up cron triggers...')

  const timestamp = Date.now().toString()
  const message = `jeju-cron:${timestamp}`
  const signature = await signMessage(account, { message })

  const response = await fetch(`${COMPUTE_API}/cron/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': account.address,
      'x-jeju-timestamp': timestamp,
      'x-jeju-signature': signature,
    },
    body: JSON.stringify({
      name: 'todo-cleanup',
      type: 'cron',
      expression: '0 0 * * *', // Daily at midnight
      webhook: `${backendUrl}/webhooks/cleanup`,
    }),
  }).catch(() => null)

  if (response?.ok) {
    const data = (await response.json()) as { triggerId: Hex }
    console.log(`   Trigger ID: ${data.triggerId}`)
    return data.triggerId
  }

  console.log('   Cron triggers skipped (compute not available)')
  return null
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

  const result: DeployResult = {
    jnsName,
    frontendCid,
    backendEndpoint,
    a2aEndpoint: `${backendEndpoint}/a2a`,
    mcpEndpoint: `${backendEndpoint}/mcp`,
    databaseId,
    triggerId: triggerId || ('0x0' as Hex),
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
