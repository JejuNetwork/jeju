#!/usr/bin/env bun
/**
 * Deploy App Script
 *
 * Deploys a single app via DWS (frontend to IPFS, worker registered on-chain).
 * This is the permissionless app deployment script.
 *
 * Usage:
 *   NETWORK=localnet bun run scripts/deploy/deploy-app.ts --name autocrat --jns autocrat
 *   NETWORK=testnet bun run scripts/deploy/deploy-app.ts --name bazaar --dir apps/bazaar/dist
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  type Hex,
  http,
  keccak256,
  namehash,
  stringToBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { NetworkType } from '../shared'
import { getRequiredNetwork } from '../shared'

const ROOT = join(import.meta.dir, '../../../..')
const APPS_DIR = join(ROOT, 'apps')
const VENDOR_DIR = join(ROOT, 'vendor')
const CONTRACTS_DIR = join(ROOT, 'packages/contracts')
const DEPLOYMENTS_DIR = join(CONTRACTS_DIR, 'deployments')

// Define Jeju chains
const localnet = defineChain({
  id: 31337,
  name: 'Jeju Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://localhost:6546'] },
  },
})

const jejuTestnet = defineChain({
  id: 420690,
  name: 'Jeju Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.jejunetwork.org'] },
  },
})

const jejuMainnet = defineChain({
  id: 420691,
  name: 'Jeju Mainnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.jejunetwork.org'] },
  },
})

const NETWORK_CONFIG: Record<NetworkType, { rpcUrl: string; chainId: number }> =
  {
    localnet: { rpcUrl: 'http://localhost:6546', chainId: 31337 },
    testnet: { rpcUrl: 'https://testnet-rpc.jejunetwork.org', chainId: 420690 },
    mainnet: { rpcUrl: 'https://rpc.jejunetwork.org', chainId: 420691 },
  }

interface DWSContracts {
  storageManager: Address
  workerRegistry: Address
  cdnRegistry: Address
  jnsRegistry: Address
  jnsResolver: Address
  jnsRegistrar: Address
  jnsReverseRegistrar: Address
  identityRegistry: Address
  nodeRegistry: Address
  keepaliveRegistry: Address
}

interface AppManifest {
  name: string
  displayName?: string
  jns?: { name: string }
  decentralization?: {
    frontend?: {
      buildDir: string
      jnsName?: string
    }
    worker?: {
      name: string
      entrypoint: string
      runtime?: string
      routes?: Array<{ pattern: string }>
    }
  }
  architecture?: {
    frontend?: { outputDir: string } | string
    backend?: { outputDir: string; entrypoint: string } | string
  }
  dws?: {
    backend?: {
      runtime?: string
      entrypoint?: string
      routes?: Array<{ pattern: string }>
    }
    database?: {
      type?: string
      name?: string
      consistency?: string
    }
  }
  commands?: {
    build?: string
  }
}

// Contract ABIs
const STORAGE_MANAGER_ABI = [
  {
    name: 'recordUpload',
    type: 'function',
    inputs: [
      { name: 'cid', type: 'string' },
      { name: 'contentHash', type: 'bytes32' },
      { name: 'size', type: 'uint256' },
      { name: 'backend', type: 'uint8' },
      { name: 'permanent', type: 'bool' },
    ],
    outputs: [{ name: 'uploadId', type: 'bytes32' }],
    stateMutability: 'payable',
  },
] as const

const WORKER_REGISTRY_ABI = [
  {
    name: 'deployWorker',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'codeHash', type: 'bytes32' },
      { name: 'routes', type: 'string[]' },
      { name: 'cronSchedule', type: 'string' },
      { name: 'paymentMode', type: 'uint8' },
      { name: 'initialFunding', type: 'uint256' },
    ],
    outputs: [{ name: 'workerId', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    name: 'WorkerDeployed',
    type: 'event',
    inputs: [
      { name: 'workerId', type: 'bytes32', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'name', type: 'string', indexed: false },
      { name: 'codeHash', type: 'bytes32', indexed: false },
    ],
  },
] as const

const JNS_RESOLVER_ABI = [
  {
    name: 'setContenthash',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'hash', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'setText',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

const CDN_REGISTRY_ABI = [
  {
    name: 'registerSite',
    type: 'function',
    inputs: [
      { name: 'cid', type: 'string' },
      { name: 'hostname', type: 'string' },
      { name: 'routes', type: 'string[]' },
    ],
    outputs: [{ name: 'siteId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
] as const

// Parse CLI arguments
const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    name: { type: 'string' },
    dir: { type: 'string' },
    jns: { type: 'string' },
    network: { type: 'string' },
    'skip-worker': { type: 'boolean' },
    'skip-frontend': { type: 'boolean' },
    help: { type: 'boolean' },
  },
  allowPositionals: true,
})

if (values.help) {
  console.log(`
Usage: NETWORK=<network> bun run deploy-app.ts --name <app> [options]

Options:
  --name <app>        App name (required)
  --dir <path>        Frontend directory (default: apps/<name>/dist)
  --jns <name>        JNS name (default: from manifest)
  --network <net>     Network: localnet | testnet | mainnet
  --skip-worker       Skip worker deployment
  --skip-frontend     Skip frontend deployment
  --help              Show this help
`)
  process.exit(0)
}

async function main() {
  const network = (values.network as NetworkType) ?? getRequiredNetwork()
  const appName = values.name ?? positionals[0]

  if (!appName) {
    console.error('❌ App name required. Use --name <app>')
    process.exit(1)
  }

  const privateKey = process.env.PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY

  if (!privateKey) {
    throw new Error('PRIVATE_KEY or DEPLOYER_PRIVATE_KEY required')
  }

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║            🚀 DEPLOY APP - ${appName.toUpperCase().padEnd(30)}║
║            Network: ${network.padEnd(39)}║
╚══════════════════════════════════════════════════════════════╝
`)

  // Find app directory and manifest
  let appDir = join(APPS_DIR, appName)
  if (!existsSync(appDir)) {
    appDir = join(VENDOR_DIR, appName)
  }
  if (!existsSync(appDir)) {
    console.error(`❌ App not found: ${appName}`)
    console.error(`   Checked: apps/${appName}, vendor/${appName}`)
    process.exit(1)
  }

  const manifestPath = join(appDir, 'jeju-manifest.json')
  if (!existsSync(manifestPath)) {
    console.error(`❌ No jeju-manifest.json found in ${appDir}`)
    process.exit(1)
  }

  const manifest: AppManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  const jnsName =
    values.jns ??
    manifest.jns?.name ??
    manifest.decentralization?.frontend?.jnsName ??
    appName

  // Determine frontend directory
  const frontendConfig = manifest.architecture?.frontend
  const outputDir =
    values.dir ??
    (typeof frontendConfig === 'object' ? frontendConfig.outputDir : 'dist')
  const frontendDir = values.dir ?? join(appDir, outputDir)

  console.log(`📦 App: ${manifest.name}`)
  console.log(`📂 Directory: ${appDir}`)
  console.log(`🌐 JNS Name: ${jnsName}`)
  console.log(`📁 Frontend: ${frontendDir}`)

  // Load DWS contracts
  const contracts = loadDWSContracts(network)

  // Setup viem clients
  const config = NETWORK_CONFIG[network]
  const account = privateKeyToAccount(privateKey as `0x${string}`)
  const chain: Chain =
    network === 'mainnet'
      ? jejuMainnet
      : network === 'testnet'
        ? jejuTestnet
        : localnet

  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  })

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  })

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`\n✅ Deployer: ${account.address}`)
  console.log(`   Balance: ${formatEther(balance)} ETH`)

  if (balance < BigInt(1e16)) {
    console.error('❌ Insufficient balance. Need at least 0.01 ETH.')
    process.exit(1)
  }

  // Get IPFS API URL
  const defaultIpfsApi: Record<NetworkType, string> = {
    localnet: 'http://localhost:5001',
    testnet: 'https://ipfs-api.testnet.jejunetwork.org',
    mainnet: 'https://ipfs-api.jejunetwork.org',
  }
  const ipfsApiUrl = process.env.IPFS_API_URL ?? defaultIpfsApi[network]

  // Deploy frontend
  let frontendCid: string | undefined
  let staticFiles: Record<string, string> | undefined
  if (!values['skip-frontend'] && existsSync(frontendDir)) {
    console.log(`\n📤 Uploading frontend to IPFS...`)
    const uploadResult = await uploadDirectoryToIPFS(frontendDir, ipfsApiUrl)
    frontendCid = uploadResult.cid
    staticFiles = uploadResult.files
    console.log(`   ✅ Frontend CID: ${frontendCid}`)

    // Record upload on-chain
    console.log(`   ⛓️  Recording upload on-chain...`)
    const contentHash = keccak256(stringToBytes(frontendCid))
    const size = getDirectorySize(frontendDir)

    const uploadHash = await walletClient.writeContract({
      address: contracts.storageManager,
      abi: STORAGE_MANAGER_ABI,
      functionName: 'recordUpload',
      args: [frontendCid, contentHash, BigInt(size), 0, false],
      value: BigInt(0),
    })
    await publicClient.waitForTransactionReceipt({ hash: uploadHash })
    console.log(`   ✅ Upload recorded: ${uploadHash}`)
  }

  // Deploy worker
  let workerId: Hex | undefined
  let workerCid: string | undefined
  if (!values['skip-worker']) {
    const workerConfig =
      manifest.decentralization?.worker ?? manifest.dws?.backend
    const backendConfig = manifest.architecture?.backend
    const entrypoint =
      typeof workerConfig === 'object'
        ? workerConfig.entrypoint
        : typeof backendConfig === 'object'
          ? backendConfig.entrypoint
          : 'api/worker.ts'

    if (entrypoint) {
      const workerPath = join(appDir, entrypoint)
      if (existsSync(workerPath)) {
        console.log(`\n📤 Deploying worker...`)
        console.log(`   Entrypoint: ${entrypoint}`)

        let bundledCode: string

        // Check for pre-built worker first (e.g., dist/worker/worker.js)
        const prebuiltWorkerPath = join(appDir, 'dist', 'worker', 'worker.js')
        const allowPrebuilt = process.env.FORCE_BUNDLE_WORKER !== '1'
        if (allowPrebuilt && existsSync(prebuiltWorkerPath)) {
          console.log(`   Using pre-built worker bundle...`)
          bundledCode = readFileSync(prebuiltWorkerPath, 'utf-8')
          console.log(
            `   ✅ Bundle size: ${(bundledCode.length / 1024).toFixed(2)} KB`,
          )
        } else {
          // Bundle the worker using Bun.build for workerd compatibility
          console.log(`   Building worker bundle...`)
          const buildResult = await Bun.build({
            entrypoints: [workerPath],
            target: 'browser', // workerd uses browser-compatible bundles
            minify: true,
            format: 'esm',
            external: ['node:*', 'cloudflare:*'], // workerd built-ins
          })

          if (!buildResult.success) {
            const errors = buildResult.logs.map((log) => log.message).join('\n')
            throw new Error(`Worker bundle failed: ${errors}`)
          }

          // Get the bundled code
          bundledCode = await buildResult.outputs[0].text()
          console.log(
            `   ✅ Bundle size: ${(bundledCode.length / 1024).toFixed(2)} KB`,
          )
        }

        // Upload bundled worker code to IPFS
        workerCid = await uploadToIPFS(bundledCode, ipfsApiUrl)
        console.log(`   ✅ Worker CID: ${workerCid}`)

        // Deploy worker on-chain
        const codeHash = keccak256(stringToBytes(bundledCode))
        const routes =
          typeof workerConfig === 'object' && workerConfig.routes
            ? workerConfig.routes.map((r) => r.pattern)
            : [`/${appName}/*`]

        console.log(`   ⛓️  Registering worker on-chain...`)
        const deployHash = await walletClient.writeContract({
          address: contracts.workerRegistry,
          abi: WORKER_REGISTRY_ABI,
          functionName: 'deployWorker',
          args: [
            manifest.name,
            codeHash,
            routes,
            '', // No cron
            0, // FREE payment mode
            BigInt(0),
          ],
          value: BigInt(0),
        })

        // Wait for receipt and extract workerId from event logs
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: deployHash,
        })

        // Find WorkerDeployed event
        const deployedEvent = receipt.logs.find((log) => {
          // Topic 0 is event signature hash
          const eventSignature = keccak256(
            stringToBytes('WorkerDeployed(bytes32,address,string,bytes32)'),
          )
          return log.topics[0] === eventSignature
        })

        if (deployedEvent?.topics[1]) {
          workerId = deployedEvent.topics[1] as Hex
          console.log(`   ✅ Worker deployed: ${workerId}`)
        } else {
          console.warn(
            `   ⚠️  Worker deployed but could not extract workerId from logs`,
          )
          console.log(`   Transaction: ${deployHash}`)
        }
      }
    }
  }

  // Provision database if needed
  let databaseId: string | undefined
  const dbConfig = manifest.dws?.database as
    | { type?: string; name?: string; consistency?: string }
    | undefined
  if (dbConfig) {
    console.log(`\n💾 Provisioning SQLit database...`)
    const dbName = dbConfig.name ?? `${appName}-db`

    // Get DWS endpoint for SQLit provisioning (uses /sqlit/v1/admin/create)
    const defaultDwsEndpoint: Record<NetworkType, string> = {
      localnet: 'http://localhost:4030',
      testnet: 'https://dws.testnet.jejunetwork.org',
      mainnet: 'https://dws.jejunetwork.org',
    }
    const dwsEndpoint = process.env.DWS_ENDPOINT ?? defaultDwsEndpoint[network]

    try {
      const provisionResponse = await fetch(
        `${dwsEndpoint}/sqlit/v1/admin/create`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            databaseId: dbName,
          }),
        },
      )

      if (provisionResponse.ok) {
        const result = (await provisionResponse.json()) as {
          data: { database: string }
          status: string
          success: boolean
        }
        databaseId = result.data.database
        console.log(`   ✅ Database provisioned: ${databaseId}`)

        const initResponse = await fetch(`${dwsEndpoint}/sqlit/v1/exec`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            database: databaseId,
            query:
              'CREATE TABLE IF NOT EXISTS __sqlit_init (id INTEGER PRIMARY KEY)',
            args: [],
          }),
        })

        if (!initResponse.ok) {
          console.warn(
            `   ⚠️  Database init failed: ${await initResponse.text()}`,
          )
        }
      } else if (provisionResponse.status === 409) {
        // Database already exists
        databaseId = dbName
        console.log(`   ✅ Using existing database: ${databaseId}`)
      } else {
        console.warn(
          `   ⚠️  Database provisioning failed: ${await provisionResponse.text()}`,
        )
      }
    } catch (error) {
      console.warn(`   ⚠️  Database provisioning error: ${error}`)
    }
  }

  // Update JNS records
  if (jnsName && (frontendCid ?? workerCid ?? databaseId)) {
    console.log(`\n🔗 Updating JNS records for ${jnsName}...`)
    const appNode = namehash(`${jnsName}.jeju`)

    // Set contenthash for frontend
    if (frontendCid) {
      const ipfsHash = cidToContentHash(frontendCid)
      const contentHashTx = await walletClient.writeContract({
        address: contracts.jnsResolver,
        abi: JNS_RESOLVER_ABI,
        functionName: 'setContenthash',
        args: [appNode, ipfsHash],
      })
      await publicClient.waitForTransactionReceipt({ hash: contentHashTx })
      console.log(`   ✅ Contenthash set: ipfs://${frontendCid}`)
    }

    // Set dws.worker text record with CID (not workerId)
    if (workerCid) {
      const runtime =
        typeof manifest.dws?.backend === 'object'
          ? manifest.dws.backend.runtime
          : 'bun'
      const workerRecord = `${runtime}:${workerCid}`
      const workerTextTx = await walletClient.writeContract({
        address: contracts.jnsResolver,
        abi: JNS_RESOLVER_ABI,
        functionName: 'setText',
        args: [appNode, 'dws.worker', workerRecord],
      })
      await publicClient.waitForTransactionReceipt({ hash: workerTextTx })
      console.log(`   ✅ dws.worker set: ${workerRecord}`)
    }

    // Set dws.workerId text record if we have an on-chain workerId
    if (workerId) {
      const workerIdTextTx = await walletClient.writeContract({
        address: contracts.jnsResolver,
        abi: JNS_RESOLVER_ABI,
        functionName: 'setText',
        args: [appNode, 'dws.workerId', workerId],
      })
      await publicClient.waitForTransactionReceipt({ hash: workerIdTextTx })
      console.log(`   ✅ dws.workerId set: ${workerId}`)
    }

    // Set dws.databaseId text record if we provisioned a database
    if (databaseId) {
      const dbIdTextTx = await walletClient.writeContract({
        address: contracts.jnsResolver,
        abi: JNS_RESOLVER_ABI,
        functionName: 'setText',
        args: [appNode, 'dws.databaseId', databaseId],
      })
      await publicClient.waitForTransactionReceipt({ hash: dbIdTextTx })
      console.log(`   ✅ dws.databaseId set: ${databaseId}`)
    }
  }

  // Register with CDN
  if (frontendCid && jnsName) {
    console.log(`\n📡 Registering with CDN...`)
    const siteHash = await walletClient.writeContract({
      address: contracts.cdnRegistry,
      abi: CDN_REGISTRY_ABI,
      functionName: 'registerSite',
      args: [frontendCid, `${jnsName}.jeju`, ['/*']],
    })
    await publicClient.waitForTransactionReceipt({ hash: siteHash })
    console.log(`   ✅ CDN site registered`)
  }

  // Register with DWS app router
  const defaultDwsAppEndpoint: Record<NetworkType, string> = {
    localnet: 'http://localhost:4030',
    testnet: 'https://dws.testnet.jejunetwork.org',
    mainnet: 'https://dws.jejunetwork.org',
  }
  const dwsEndpoint = process.env.DWS_ENDPOINT ?? defaultDwsAppEndpoint[network]

  console.log(`\n📱 Registering with DWS app router...`)

  // Determine the index.html CID for frontendCid
  const indexHtmlCid =
    staticFiles?.['web/index.html'] ?? staticFiles?.['index.html'] ?? null

  const appEnv: Record<string, string> = {}
  if (databaseId) {
    appEnv.SQLIT_DATABASE_ID = databaseId
  }

  const appRegistration = {
    name: appName,
    jnsName: `${jnsName}.jeju`,
    frontendCid: indexHtmlCid,
    staticFiles: staticFiles ?? null,
    backendWorkerId: workerCid ?? null,
    backendEndpoint: null,
    env: appEnv,
    apiPaths: manifest.decentralization?.worker?.routes?.map(
      (r: { pattern: string }) => r.pattern,
    ) ??
      manifest.dws?.backend?.routes?.map(
        (r: { pattern: string }) => r.pattern,
      ) ?? ['/api/*', '/health', '/a2a/*', '/mcp/*'],
    spa: manifest.dws?.frontend?.spa ?? true,
    enabled: true,
  }

  const appRegResponse = await fetch(`${dwsEndpoint}/apps/deployed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(appRegistration),
  })

  if (appRegResponse.ok) {
    console.log(`   ✅ App registered with DWS`)
  } else {
    console.warn(
      `   ⚠️  DWS registration failed: ${await appRegResponse.text()}`,
    )
  }

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    ✅ DEPLOYMENT COMPLETE                    ║
╠══════════════════════════════════════════════════════════════╣
║  App: ${manifest.name.padEnd(54)}║
║  JNS: ${jnsName.padEnd(54)}║
${frontendCid ? `║  Frontend: ${frontendCid.substring(0, 48).padEnd(49)}║\n` : ''}${workerCid ? `║  Worker: ${workerCid.substring(0, 50).padEnd(51)}║\n` : ''}╚══════════════════════════════════════════════════════════════╝
`)

  console.log(`\n🌐 Access via:`)
  console.log(`   https://${jnsName}.jeju.network`)
  console.log(`   ipfs://${frontendCid}`)
}

function loadDWSContracts(network: NetworkType): DWSContracts {
  const deploymentFile = join(DEPLOYMENTS_DIR, `${network}-dws.json`)

  if (!existsSync(deploymentFile)) {
    throw new Error(
      `DWS contracts not found for ${network}. Run: bun run deploy dws --network ${network}`,
    )
  }

  const raw = JSON.parse(readFileSync(deploymentFile, 'utf-8'))

  // Handle both flat format and { contracts: { ... } } format
  const data = raw.contracts ?? raw

  // Map PascalCase to camelCase (JSON may use either)
  const getAddr = (pascal: string, camel: string): Address => {
    return (data[pascal] ??
      data[camel] ??
      '0x0000000000000000000000000000000000000000') as Address
  }

  const contracts: DWSContracts = {
    storageManager: getAddr('StorageManager', 'storageManager'),
    workerRegistry: getAddr('WorkerRegistry', 'workerRegistry'),
    cdnRegistry: getAddr('CDNRegistry', 'cdnRegistry'),
    jnsRegistry: getAddr('JNSRegistry', 'jnsRegistry'),
    jnsResolver: getAddr('JNSResolver', 'jnsResolver'),
    jnsRegistrar: getAddr('JNSRegistrar', 'jnsRegistrar'),
    jnsReverseRegistrar: getAddr('JNSReverseRegistrar', 'jnsReverseRegistrar'),
    // These are optional - not all networks have them deployed yet
    identityRegistry: getAddr('IdentityRegistry', 'identityRegistry'),
    nodeRegistry: getAddr('NodeRegistry', 'nodeRegistry'),
    keepaliveRegistry: getAddr('KeepaliveRegistry', 'keepaliveRegistry'),
  }

  // Validate required contracts for app deployment
  const required: (keyof DWSContracts)[] = [
    'storageManager',
    'workerRegistry',
    'jnsRegistry',
    'jnsResolver',
  ]

  const ZERO = '0x0000000000000000000000000000000000000000'
  for (const key of required) {
    if (!contracts[key] || contracts[key] === ZERO) {
      throw new Error(`Missing required contract ${key} in ${deploymentFile}`)
    }
  }

  return contracts
}

async function uploadDirectoryToIPFS(
  dir: string,
  ipfsApiUrl: string,
): Promise<string> {
  // Determine DWS storage URL based on the IPFS API URL
  let dwsStorageUrl: string
  if (ipfsApiUrl.includes('testnet')) {
    dwsStorageUrl = 'https://dws.testnet.jejunetwork.org'
  } else if (ipfsApiUrl.includes('jejunetwork.org')) {
    dwsStorageUrl = 'https://dws.jejunetwork.org'
  } else {
    // Localnet - assume DWS is on port 4030
    dwsStorageUrl = 'http://localhost:4030'
  }

  // Collect all files into a map for the manifest
  const files: Record<string, string> = {}
  const uploadQueue: { path: string; content: Buffer }[] = []

  const collectFiles = (currentDir: string, prefix: string) => {
    const entries = readdirSync(currentDir)
    for (const entry of entries) {
      const fullPath = join(currentDir, entry)
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        collectFiles(fullPath, `${prefix}${entry}/`)
      } else {
        uploadQueue.push({
          path: `${prefix}${entry}`,
          content: readFileSync(fullPath),
        })
      }
    }
  }

  collectFiles(dir, '')

  // Upload each file individually to DWS storage with retry logic
  console.log(`   Uploading ${uploadQueue.length} files...`)
  const maxRetries = 5
  for (const file of uploadQueue) {
    let lastError: Error | null = null
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const formData = new FormData()
        formData.append('file', new Blob([file.content]), file.path)

        const response = await fetch(`${dwsStorageUrl}/storage/upload`, {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error')
          throw new Error(
            `Failed to upload ${file.path}: ${response.status} - ${errorText}`,
          )
        }

        const result = (await response.json()) as { cid: string }
        files[file.path] = result.cid
        console.log(`   ✓ ${file.path} -> ${result.cid.substring(0, 12)}...`)
        lastError = null
        break
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attempt < maxRetries) {
          console.log(
            `   ⚠️  Retry ${attempt}/${maxRetries} for ${file.path}...`,
          )
          await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
        }
      }
    }
    if (lastError) {
      throw lastError
    }
  }

  // Create a manifest with all file CIDs
  const manifest = { files, createdAt: new Date().toISOString() }
  const manifestBlob = new Blob([JSON.stringify(manifest)])
  const manifestFormData = new FormData()
  manifestFormData.append('file', manifestBlob, 'manifest.json')

  const manifestResponse = await fetch(`${dwsStorageUrl}/storage/upload`, {
    method: 'POST',
    body: manifestFormData,
  })

  if (!manifestResponse.ok) {
    throw new Error(`Failed to upload manifest: ${manifestResponse.status}`)
  }

  const manifestResult = (await manifestResponse.json()) as { cid: string }
  console.log(`   ✅ Manifest CID: ${manifestResult.cid}`)

  return { cid: manifestResult.cid, files }
}

async function uploadToIPFS(
  content: string,
  ipfsApiUrl: string,
): Promise<string> {
  // Determine DWS storage URL
  let dwsStorageUrl: string
  if (ipfsApiUrl.includes('testnet')) {
    dwsStorageUrl = 'https://dws.testnet.jejunetwork.org'
  } else if (ipfsApiUrl.includes('jejunetwork.org')) {
    dwsStorageUrl = 'https://dws.jejunetwork.org'
  } else {
    dwsStorageUrl = 'http://localhost:4030'
  }

  const formData = new FormData()
  // Always provide a filename to avoid undefined filename issues on DWS
  formData.append('file', new Blob([content]), 'worker.js')

  const response = await fetch(`${dwsStorageUrl}/storage/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`IPFS upload failed: ${response.status} - ${errorText}`)
  }

  const result = (await response.json()) as { cid: string }
  return result.cid
}

function getDirectorySize(dir: string): number {
  let size = 0
  const entries = readdirSync(dir)
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      size += getDirectorySize(fullPath)
    } else {
      size += stat.size
    }
  }
  return size
}

function cidToContentHash(cid: string): Hex {
  // Convert CIDv0/v1 to IPFS contenthash format (0xe3...)
  // For simplicity, we encode the CID string directly
  // In production, this should properly encode the multihash
  const encoder = new TextEncoder()
  const cidBytes = encoder.encode(cid)

  // IPFS namespace: 0xe3 + 0x01 (codec) + length + multihash
  const result = new Uint8Array(cidBytes.length + 2)
  result[0] = 0xe3 // IPFS
  result[1] = 0x01 // Codec (dag-pb)
  result.set(cidBytes, 2)

  return `0x${Buffer.from(result).toString('hex')}`
}

main().catch((error) => {
  console.error('❌ Deployment failed:', error)
  process.exit(1)
})
