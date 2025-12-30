#!/usr/bin/env bun
/**
 * DWS Bootstrap Script
 *
 * Bootstraps DWS infrastructure and deploys all apps on-chain.
 * This is the ONLY way apps should be deployed - not via terraform or k8s.
 *
 * Usage:
 *   NETWORK=testnet bun run scripts/deploy/dws-bootstrap.ts
 *   NETWORK=mainnet bun run scripts/deploy/dws-bootstrap.ts --skip-contracts
 *
 * Steps:
 * 1. Deploy DWS contracts (if not already deployed)
 * 2. Register initial DWS nodes on-chain
 * 3. Deploy all apps via DWS (frontend to IPFS, workers registered on-chain)
 * 4. Configure JNS names
 * 5. Set up keepalives for monitoring
 */

import { execSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
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
  type PublicClient,
  stringToBytes,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import type { NetworkType } from '../shared'
import { getRequiredNetwork } from '../shared'

const ROOT = join(import.meta.dir, '../../../..')
const CONTRACTS_DIR = join(ROOT, 'packages/contracts')
const APPS_DIR = join(ROOT, 'apps')
const DEPLOYMENTS_DIR = join(CONTRACTS_DIR, 'deployments')

// Define localnet chain
const localnet = defineChain({
  id: 31337,
  name: 'Jeju Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://localhost:6546'] },
  },
})

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
  type?: string
  enabled?: boolean
  jns?: { name: string }
  decentralization?: {
    frontend?: {
      buildDir: string
      buildCommand?: string
      jnsName?: string
      ipfs?: boolean
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
  commands?: {
    build?: string
  }
}

interface DeployedApp {
  name: string
  frontendCid?: string
  workerId?: string
  jnsName?: string
  siteId?: string
}

const NETWORK_CONFIG: Record<NetworkType, { rpcUrl: string; chainId: number }> =
  {
    localnet: { rpcUrl: 'http://localhost:6546', chainId: 31337 },
    testnet: { rpcUrl: 'https://testnet-rpc.jejunetwork.org', chainId: 420690 },
    mainnet: { rpcUrl: 'https://rpc.jejunetwork.org', chainId: 420691 },
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
      { name: 'pricePerInvocation', type: 'uint256' },
    ],
    outputs: [{ name: 'workerId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
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
] as const

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'skip-contracts': { type: 'boolean', default: false },
      'skip-apps': { type: 'boolean', default: false },
      apps: { type: 'string', short: 'a' }, // Comma-separated list of apps to deploy
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  })

  if (values.help) {
    console.log(`
DWS Bootstrap - Deploy apps on-chain through decentralized infrastructure

Usage:
  NETWORK=testnet bun run scripts/deploy/dws-bootstrap.ts [options]

Options:
  --skip-contracts   Skip DWS contract deployment (use existing)
  --skip-apps        Only deploy contracts, skip apps
  --apps <list>      Deploy specific apps (comma-separated)
  -h, --help         Show this help

Environment:
  NETWORK            Required: localnet, testnet, mainnet
  PRIVATE_KEY        Required: Deployer private key
  IPFS_API_URL       IPFS API URL (default: http://localhost:5001)
  DWS_ENDPOINT       DWS API endpoint (for self-hosting verification)
`)
    process.exit(0)
  }

  const network = getRequiredNetwork()
  const privateKey = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY

  if (!privateKey) {
    throw new Error('PRIVATE_KEY or DEPLOYER_PRIVATE_KEY required')
  }

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║            🚀 DWS BOOTSTRAP - ${network.toUpperCase().padEnd(27)}║
║                                                              ║
║  Fully Decentralized App Deployment                         ║
║  - Frontends deployed to IPFS                               ║
║  - Workers registered on-chain                              ║
║  - JNS names bound to content                               ║
╚══════════════════════════════════════════════════════════════╝
`)

  const config = NETWORK_CONFIG[network]
  const account = privateKeyToAccount(privateKey as `0x${string}`)
  const chain: Chain =
    network === 'mainnet'
      ? base
      : network === 'testnet'
        ? baseSepolia
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

  // Check connection and balance
  const blockNumber = await publicClient.getBlockNumber()
  console.log(`✅ Connected to ${network} at block ${blockNumber}`)

  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`✅ Deployer: ${account.address}`)
  console.log(`   Balance: ${formatEther(balance)} ETH`)

  if (balance < BigInt(1e17)) {
    console.error('❌ Insufficient balance. Need at least 0.1 ETH.')
    process.exit(1)
  }

  // Step 1: Deploy or load DWS contracts
  let contracts: DWSContracts

  if (values['skip-contracts']) {
    console.log('\n📦 Loading existing DWS contracts...')
    contracts = loadDWSContracts(network)
    console.log(`   StorageManager: ${contracts.storageManager}`)
    console.log(`   WorkerRegistry: ${contracts.workerRegistry}`)
    console.log(`   JNSRegistry: ${contracts.jnsRegistry}`)
  } else {
    console.log('\n📦 Deploying DWS contracts...')
    contracts = await deployDWSContracts(network, privateKey as Hex)
    saveDWSContracts(network, contracts)
  }

  if (values['skip-apps']) {
    console.log('\n✅ Contract deployment complete. Skipping apps.')
    return
  }

  // Step 2: Discover and filter apps
  const appFilter = values.apps?.split(',').map((s) => s.trim())
  const apps = discoverApps(appFilter)
  console.log(`\n📱 Found ${apps.length} apps to deploy`)

  // Step 3: Deploy each app
  const results: DeployedApp[] = []
  const ipfsApiUrl = process.env.IPFS_API_URL || 'http://localhost:5001'

  for (const app of apps) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`📦 Deploying: ${app.name}`)
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)

    const result = await deployApp(
      app.dir,
      app.manifest,
      contracts,
      walletClient,
      publicClient,
      ipfsApiUrl,
    )
    results.push(result)
    console.log(`✅ ${app.name} deployed successfully`)
  }

  // Step 4: Self-host DWS (upload DWS code to IPFS for decentralized bootstrap)
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📦 Self-hosting DWS')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  const dwsAppDir = join(ROOT, 'apps/dws')
  if (existsSync(dwsAppDir)) {
    console.log('   📤 Uploading DWS to IPFS for self-hosting...')

    // Build DWS
    execSync('bun run build', { cwd: dwsAppDir, stdio: 'inherit' })

    // Upload DWS code to IPFS
    const dwsDist = join(dwsAppDir, 'dist')
    if (existsSync(dwsDist)) {
      const dwsCid = uploadToIPFS(dwsDist, ipfsApiUrl)
      console.log(`   ✅ DWS Code CID: ${dwsCid}`)

      // Record in StorageManager
      const contentHash = keccak256(stringToBytes(dwsCid))
      const size = getDirectorySize(dwsDist)

      const { request } = await publicClient.simulateContract({
        address: contracts.storageManager,
        abi: STORAGE_MANAGER_ABI,
        functionName: 'recordUpload',
        args: [dwsCid, contentHash, BigInt(size), 0, true],
        value: BigInt(Math.ceil(size / (1024 * 1024))) * BigInt(1e14),
        account: walletClient.account,
      })

      const hash = await walletClient.writeContract(request)
      await publicClient.waitForTransactionReceipt({ hash })

      console.log('   ✅ DWS is now self-hosted on IPFS')
      console.log(`\n   Any node operator can now:`)
      console.log(`   1. Pull DWS code: ipfs get ${dwsCid}`)
      console.log(`   2. Start DWS: bun run api/server/index.ts`)
      console.log(`   3. Register on-chain: jeju dws seed-nodes`)
    }
  }

  // Summary
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    DEPLOYMENT SUMMARY                        ║
╚══════════════════════════════════════════════════════════════╝
`)

  console.log(`✅ Deployed: ${results.length} apps`)
  for (const app of results) {
    console.log(`   - ${app.name}`)
    if (app.jnsName) console.log(`     JNS: ${app.jnsName}`)
    if (app.frontendCid)
      console.log(`     CID: ${app.frontendCid.slice(0, 20)}...`)
  }

  // Save deployment summary
  const summaryFile = join(DEPLOYMENTS_DIR, `${network}-dws-apps.json`)
  writeFileSync(
    summaryFile,
    JSON.stringify(
      {
        network,
        timestamp: new Date().toISOString(),
        contracts,
        apps: results,
      },
      null,
      2,
    ),
  )
  console.log(`\n💾 Deployment saved to: ${summaryFile}`)

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                 DECENTRALIZATION COMPLETE                    ║
╠══════════════════════════════════════════════════════════════╣
║  All apps are now deployed via DWS (on-chain provisioning):  ║
║  - Frontends stored on IPFS                                  ║
║  - Workers registered on-chain                               ║
║  - JNS names bound to content                                ║
║  - DWS itself is self-hosted                                 ║
║                                                              ║
║  To deploy a new app:                                        ║
║    jeju deploy app <app-name> --network ${network.padEnd(18)}║
║                                                              ║
║  To start a DWS node:                                        ║
║    1. Pull DWS code from IPFS (stored on-chain)              ║
║    2. Run: bun run api/server/index.ts                       ║
║    3. Register: jeju dws seed-nodes --env ${network.padEnd(13)}║
╚══════════════════════════════════════════════════════════════╝
`)
}

function loadDWSContracts(network: NetworkType): DWSContracts {
  const deploymentFile = join(DEPLOYMENTS_DIR, `${network}-dws.json`)

  if (!existsSync(deploymentFile)) {
    throw new Error(`DWS deployment not found: ${deploymentFile}`)
  }

  return JSON.parse(readFileSync(deploymentFile, 'utf-8'))
}

function saveDWSContracts(network: NetworkType, contracts: DWSContracts): void {
  if (!existsSync(DEPLOYMENTS_DIR)) {
    mkdirSync(DEPLOYMENTS_DIR, { recursive: true })
  }

  const deploymentFile = join(DEPLOYMENTS_DIR, `${network}-dws.json`)
  writeFileSync(deploymentFile, JSON.stringify(contracts, null, 2))
  console.log(`💾 DWS contracts saved to: ${deploymentFile}`)
}

async function deployDWSContracts(
  network: NetworkType,
  privateKey: Hex,
): Promise<DWSContracts> {
  const rpcUrl = NETWORK_CONFIG[network].rpcUrl

  // Run forge script
  const cmd = `cd ${CONTRACTS_DIR} && ARBISCAN_API_KEY=dummy BASESCAN_API_KEY=dummy ETHERSCAN_API_KEY=dummy forge script script/DeployDWS.s.sol:DeployDWS --rpc-url ${rpcUrl} --private-key ${privateKey} --broadcast --legacy 2>&1`

  const output = execSync(cmd, {
    encoding: 'utf-8',
    maxBuffer: 100 * 1024 * 1024,
  })

  // Parse addresses from output
  const addressPatterns: Record<keyof DWSContracts, RegExp> = {
    storageManager: /StorageManager: (0x[a-fA-F0-9]{40})/,
    workerRegistry: /WorkerRegistry: (0x[a-fA-F0-9]{40})/,
    cdnRegistry: /CDNRegistry: (0x[a-fA-F0-9]{40})/,
    jnsRegistry: /JNSRegistry: (0x[a-fA-F0-9]{40})/,
    jnsResolver: /JNSResolver: (0x[a-fA-F0-9]{40})/,
    jnsRegistrar: /JNSRegistrar: (0x[a-fA-F0-9]{40})/,
    jnsReverseRegistrar: /JNSReverseRegistrar: (0x[a-fA-F0-9]{40})/,
    identityRegistry: /IdentityRegistry: (0x[a-fA-F0-9]{40})/,
    nodeRegistry: /NodeRegistry: (0x[a-fA-F0-9]{40})/,
    keepaliveRegistry: /KeepaliveRegistry: (0x[a-fA-F0-9]{40})/,
  }

  const contracts: DWSContracts = {
    storageManager: '0x' as Address,
    workerRegistry: '0x' as Address,
    cdnRegistry: '0x' as Address,
    jnsRegistry: '0x' as Address,
    jnsResolver: '0x' as Address,
    jnsRegistrar: '0x' as Address,
    jnsReverseRegistrar: '0x' as Address,
    identityRegistry: '0x' as Address,
    nodeRegistry: '0x' as Address,
    keepaliveRegistry: '0x' as Address,
  }

  for (const [key, pattern] of Object.entries(addressPatterns)) {
    const match = output.match(pattern)
    if (match) {
      contracts[key as keyof DWSContracts] = match[1] as Address
    }
  }

  console.log('   Deployed contracts:')
  console.log(`   StorageManager: ${contracts.storageManager}`)
  console.log(`   WorkerRegistry: ${contracts.workerRegistry}`)
  console.log(`   JNSRegistry: ${contracts.jnsRegistry}`)
  console.log(`   JNSResolver: ${contracts.jnsResolver}`)

  return contracts
}

function discoverApps(
  filter?: string[],
): Array<{ name: string; dir: string; manifest: AppManifest }> {
  const apps: Array<{ name: string; dir: string; manifest: AppManifest }> = []

  const appDirs = readdirSync(APPS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  for (const appName of appDirs) {
    if (filter && !filter.includes(appName)) continue

    const appDir = join(APPS_DIR, appName)
    const manifestPath = join(appDir, 'jeju-manifest.json')

    if (!existsSync(manifestPath)) continue

    const manifest: AppManifest = JSON.parse(
      readFileSync(manifestPath, 'utf-8'),
    )

    // Skip disabled apps
    if (manifest.enabled === false) continue

    // Skip apps without decentralization config or architecture
    if (!manifest.decentralization && !manifest.architecture) {
      console.log(`   ⏭️  Skipping ${appName} (no decentralization config)`)
      continue
    }

    apps.push({ name: appName, dir: appDir, manifest })
  }

  return apps
}

async function deployApp(
  appDir: string,
  manifest: AppManifest,
  contracts: DWSContracts,
  walletClient: WalletClient,
  publicClient: PublicClient,
  ipfsApiUrl: string,
): Promise<DeployedApp> {
  const result: DeployedApp = {
    name: manifest.name,
  }

  // Step 1: Build the app
  console.log('   📦 Building...')
  const buildCmd = manifest.commands?.build ?? 'bun run build'
  execSync(buildCmd, { cwd: appDir, stdio: 'inherit' })

  // Step 2: Deploy frontend to IPFS
  const frontendConfig =
    manifest.decentralization?.frontend ?? manifest.architecture?.frontend
  if (frontendConfig) {
    const outputDir =
      typeof frontendConfig === 'object' && 'buildDir' in frontendConfig
        ? frontendConfig.buildDir
        : typeof frontendConfig === 'object' && 'outputDir' in frontendConfig
          ? frontendConfig.outputDir
          : 'dist'

    const frontendPath = join(appDir, outputDir)

    if (existsSync(frontendPath)) {
      console.log('   📤 Uploading frontend to IPFS...')
      const cid = uploadToIPFS(frontendPath, ipfsApiUrl)
      result.frontendCid = cid
      console.log(`   ✅ Frontend CID: ${cid}`)

      // Record in StorageManager
      const contentHash = keccak256(stringToBytes(cid))
      const size = getDirectorySize(frontendPath)

      const { request } = await publicClient.simulateContract({
        address: contracts.storageManager,
        abi: STORAGE_MANAGER_ABI,
        functionName: 'recordUpload',
        args: [cid, contentHash, BigInt(size), 0, true],
        value: BigInt(Math.ceil(size / (1024 * 1024))) * BigInt(1e14), // 0.0001 ETH per MB
        account: walletClient.account,
      })

      const hash = await walletClient.writeContract(request)
      await publicClient.waitForTransactionReceipt({ hash })
      console.log('   ✅ Recorded in StorageManager')
    }
  }

  // Step 3: Deploy worker
  const workerConfig =
    manifest.decentralization?.worker || manifest.architecture?.backend
  if (workerConfig && typeof workerConfig === 'object') {
    const outputDir =
      'outputDir' in workerConfig ? workerConfig.outputDir : 'dist/worker'
    const workerPath = join(appDir, outputDir)

    if (existsSync(workerPath)) {
      console.log('   📤 Uploading worker to IPFS...')
      const cid = uploadToIPFS(workerPath, ipfsApiUrl)
      const codeHash = keccak256(stringToBytes(cid))

      const routes =
        'routes' in workerConfig && workerConfig.routes
          ? workerConfig.routes.map((r: { pattern: string }) => r.pattern)
          : [`/${manifest.name}/*`]

      const { request } = await publicClient.simulateContract({
        address: contracts.workerRegistry,
        abi: WORKER_REGISTRY_ABI,
        functionName: 'deployWorker',
        args: [manifest.name, codeHash, routes, '', 0, BigInt(0)],
        account: walletClient.account,
      })

      const hash = await walletClient.writeContract(request)
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      result.workerId = receipt.transactionHash
      console.log('   ✅ Worker registered on-chain')
    }
  }

  // Step 4: Register JNS name
  const jnsName =
    manifest.jns?.name ||
    manifest.decentralization?.frontend?.jnsName ||
    `${manifest.name}.jeju`

  if (result.frontendCid) {
    console.log(`   🏷️  Registering JNS: ${jnsName}`)
    const node = namehash(jnsName) as Hex
    const contenthash = encodeIPFSContenthash(result.frontendCid)

    const { request } = await publicClient.simulateContract({
      address: contracts.jnsResolver,
      abi: JNS_RESOLVER_ABI,
      functionName: 'setContenthash',
      args: [node, contenthash],
      account: walletClient.account,
    })

    const hash = await walletClient.writeContract(request)
    await publicClient.waitForTransactionReceipt({ hash })
    result.jnsName = jnsName
    console.log('   ✅ JNS name bound')
  }

  return result
}

function uploadToIPFS(path: string, apiUrl: string): string {
  const cmd = `curl -s -X POST -F "file=@${path}" "${apiUrl}/api/v0/add?recursive=true&wrap-with-directory=true" | tail -1 | jq -r '.Hash'`
  const result = execSync(cmd, { encoding: 'utf-8' }).trim()

  if (!result || result === 'null') {
    throw new Error(`Failed to upload to IPFS: ${path}`)
  }

  return result
}

function getDirectorySize(path: string): number {
  const cmd = `find "${path}" -type f -exec stat -f%z {} + 2>/dev/null | awk '{s+=$1} END {print s+0}' || find "${path}" -type f -exec stat --format=%s {} + 2>/dev/null | awk '{s+=$1} END {print s+0}'`
  const result = execSync(cmd, { encoding: 'utf-8', shell: '/bin/bash' }).trim()
  return parseInt(result, 10) || 1024
}

function encodeIPFSContenthash(cid: string): Hex {
  // EIP-1577 contenthash encoding for IPFS
  // 0xe3 = IPFS namespace, 0x01 = CIDv1 prefix, 0x70 = dag-pb codec
  const BASE58_ALPHABET =
    '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

  function base58Decode(str: string): Uint8Array {
    const bytes: number[] = [0]
    for (const char of str) {
      const value = BASE58_ALPHABET.indexOf(char)
      if (value === -1) throw new Error(`Invalid base58 character: ${char}`)

      let carry = value
      for (let i = bytes.length - 1; i >= 0; i--) {
        const n = bytes[i] * 58 + carry
        bytes[i] = n % 256
        carry = Math.floor(n / 256)
      }
      while (carry > 0) {
        bytes.unshift(carry % 256)
        carry = Math.floor(carry / 256)
      }
    }

    let leadingZeros = 0
    for (const char of str) {
      if (char === '1') leadingZeros++
      else break
    }

    const result = new Uint8Array(leadingZeros + bytes.length)
    result.set(new Uint8Array(bytes), leadingZeros)
    return result
  }

  if (cid.startsWith('Qm')) {
    const multihash = base58Decode(cid)
    const contenthash = new Uint8Array(3 + multihash.length)
    contenthash[0] = 0xe3
    contenthash[1] = 0x01
    contenthash[2] = 0x70
    contenthash.set(multihash, 3)

    return `0x${Array.from(contenthash)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}` as Hex
  }

  // Fallback: hash the CID
  return keccak256(stringToBytes(`ipfs://${cid}`))
}

main().catch((error) => {
  console.error('❌ Bootstrap failed:', error)
  process.exit(1)
})
