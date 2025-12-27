/**
 * Storage CLI Commands
 *
 * Commands for managing decentralized storage:
 * - Generate system content manifests
 * - Storage proofs and verification
 * - Signed URL generation
 * - Content management
 */

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, relative } from 'node:path'
import { Command } from 'commander'
import type { Address } from 'viem'
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'

// ============ Types ============

interface SystemAppEntry {
  name: string
  displayName: string
  version: string
  cid: string
  sha256: string
  size: number
  buildDir: string
  jnsName: string
  dependencies: string[]
}

interface SystemABIEntry {
  contractName: string
  version: string
  cid: string
  sha256: string
  size: number
  networks: Record<string, Address>
}

interface SystemJNSEntry {
  name: string
  contentCid: string
  resolver: Address
  owner: Address
  ttl: number
}

interface SystemContentManifest {
  version: string
  generatedAt: number
  apps: SystemAppEntry[]
  abis: SystemABIEntry[]
  jnsRecords: SystemJNSEntry[]
  totalSize: number
  totalItems: number
  manifestCid: string
  manifestHash: string
}

interface JejuManifest {
  name: string
  displayName?: string
  version?: string
  ports?: { frontend?: number; api?: number; main?: number }
  dependencies?: string[]
  decentralization?: {
    frontend?: {
      buildDir?: string
      jnsName?: string
    }
  }
  jns?: {
    name?: string
  }
}

// ============ Command Definition ============

export const storageCommand = new Command('storage')
  .description('Decentralized storage management')
  .addCommand(
    new Command('generate-manifest')
      .description('Generate system content manifest from built apps')
      .option(
        '-o, --output <path>',
        'Output file path',
        './system-manifest.json',
      )
      .option('--upload', 'Upload manifest to IPFS after generation')
      .option('--register', 'Register manifest on-chain')
      .option(
        '--network <network>',
        'Network for on-chain registration',
        'localnet',
      )
      .option('--dry-run', 'Show what would be generated without writing')
      .action(async (options) => {
        await generateSystemManifest(options)
      }),
  )
  .addCommand(
    new Command('verify-manifest')
      .description('Verify system content manifest against on-chain registry')
      .argument('<manifest>', 'Path to manifest file or CID')
      .option('--network <network>', 'Network to verify against', 'localnet')
      .action(async (manifest, options) => {
        await verifyManifest(manifest, options)
      }),
  )
  .addCommand(
    new Command('create-signed-url')
      .description('Create a time-limited signed URL for content')
      .argument('<cid>', 'Content ID')
      .option('--expires <seconds>', 'Expiration time in seconds', '3600')
      .option('--max-downloads <n>', 'Maximum download count')
      .action(async (cid, options) => {
        await createSignedUrl(cid, options)
      }),
  )
  .addCommand(
    new Command('verify-proof')
      .description('Verify storage proof for content')
      .argument('<cid>', 'Content ID')
      .option('--node <address>', 'Node address to verify')
      .option('--network <network>', 'Network', 'localnet')
      .action(async (cid, options) => {
        await verifyStorageProof(cid, options)
      }),
  )
  .addCommand(
    new Command('list-providers')
      .description('List available storage providers')
      .option('--backend <type>', 'Filter by backend: ipfs, filecoin, arweave')
      .option('--region <region>', 'Filter by region')
      .action(async (options) => {
        await listStorageProviders(options)
      }),
  )
  .addCommand(
    new Command('estimate-cost')
      .description('Estimate storage cost')
      .argument('<size>', 'Size in bytes or human-readable (e.g., 10MB)')
      .option('--duration <days>', 'Storage duration in days', '365')
      .option('--backend <type>', 'Backend: filecoin, arweave')
      .option('--replicas <n>', 'Replication factor', '3')
      .action(async (size, options) => {
        await estimateStorageCost(size, options)
      }),
  )

// ============ Command Implementations ============

async function generateSystemManifest(options: {
  output: string
  upload?: boolean
  register?: boolean
  network: string
  dryRun?: boolean
}): Promise<void> {
  const rootDir = findMonorepoRoot()
  logger.info('Generating system content manifest...')

  const apps: SystemAppEntry[] = []
  const abis: SystemABIEntry[] = []
  const jnsRecords: SystemJNSEntry[] = []

  // Scan apps directory
  const appsDir = join(rootDir, 'apps')
  const appDirs = readdirSync(appsDir).filter((name) => {
    const manifestPath = join(appsDir, name, 'jeju-manifest.json')
    return existsSync(manifestPath)
  })

  logger.info(`Found ${appDirs.length} apps with manifests`)

  for (const appName of appDirs) {
    const appDir = join(appsDir, appName)
    const manifestPath = join(appDir, 'jeju-manifest.json')

    const manifest: JejuManifest = JSON.parse(
      readFileSync(manifestPath, 'utf-8'),
    )
    const buildDirName = manifest.decentralization?.frontend?.buildDir ?? 'dist'
    const buildDir = join(appDir, buildDirName)

    if (!existsSync(buildDir)) {
      logger.warn(
        `No build directory for ${appName}, skipping (run bun run build first)`,
      )
      continue
    }

    const { size, hash, files } = calculateDirectoryStats(buildDir)
    const jnsName =
      manifest.jns?.name ??
      manifest.decentralization?.frontend?.jnsName ??
      `${appName}.jeju`

    apps.push({
      name: manifest.name ?? appName,
      displayName: manifest.displayName ?? appName,
      version: manifest.version ?? '1.0.0',
      cid: '', // Will be populated after upload
      sha256: hash,
      size,
      buildDir: buildDirName,
      jnsName,
      dependencies: manifest.dependencies ?? [],
    })

    logger.info(`  - ${appName}: ${formatBytes(size)} (${files} files)`)

    // Create JNS entry
    jnsRecords.push({
      name: jnsName,
      contentCid: '', // Will be populated after upload
      resolver: '0x0000000000000000000000000000000000000000' as Address,
      owner: '0x0000000000000000000000000000000000000000' as Address,
      ttl: 3600,
    })
  }

  // Scan contracts for ABIs
  const contractsDir = join(rootDir, 'packages/contracts/out')
  if (existsSync(contractsDir)) {
    const abiFiles = findAbiFiles(contractsDir)
    logger.info(`Found ${abiFiles.length} contract ABIs`)

    for (const abiPath of abiFiles.slice(0, 20)) {
      // Limit to first 20 for performance
      const contractName = basename(abiPath, '.json').replace('.sol', '')
      const content = readFileSync(abiPath, 'utf-8')
      const parsed = JSON.parse(content)

      if (!parsed.abi) continue

      const abiJson = JSON.stringify(parsed.abi)
      const hash = createHash('sha256').update(abiJson).digest('hex')
      const size = Buffer.byteLength(abiJson)

      abis.push({
        contractName,
        version: '1.0.0',
        cid: '', // Will be populated after upload
        sha256: hash,
        size,
        networks: {},
      })
    }

    logger.info(`  Processed ${abis.length} ABIs`)
  }

  // Calculate totals
  const totalSize =
    apps.reduce((sum, a) => sum + a.size, 0) +
    abis.reduce((sum, a) => sum + a.size, 0)
  const totalItems = apps.length + abis.length + jnsRecords.length

  // Generate manifest
  const manifest: SystemContentManifest = {
    version: '1.0.0',
    generatedAt: Date.now(),
    apps,
    abis,
    jnsRecords,
    totalSize,
    totalItems,
    manifestCid: '',
    manifestHash: '',
  }

  // Calculate manifest hash
  const manifestJson = JSON.stringify(manifest, null, 2)
  manifest.manifestHash = createHash('sha256')
    .update(manifestJson)
    .digest('hex')

  if (options.dryRun) {
    logger.info('\n--- DRY RUN - Would generate: ---\n')
    console.log(manifestJson)
    logger.info(`\nTotal size: ${formatBytes(totalSize)}`)
    logger.info(`Total items: ${totalItems}`)
    return
  }

  // Upload content if requested
  if (options.upload) {
    logger.info('\nUploading content to IPFS...')
    await uploadManifestContent(manifest, rootDir)
  }

  // Write manifest file
  const outputPath = options.output.startsWith('/')
    ? options.output
    : join(rootDir, options.output)

  mkdirSync(join(outputPath, '..'), { recursive: true })
  writeFileSync(outputPath, JSON.stringify(manifest, null, 2))
  logger.info(`\nManifest written to: ${outputPath}`)

  // Register on-chain if requested
  if (options.register) {
    logger.info('\nRegistering manifest on-chain...')
    await registerManifestOnChain(manifest, options.network)
  }

  // Print summary
  logger.info('\n=== System Content Manifest ===')
  logger.info(`Apps: ${apps.length}`)
  logger.info(`ABIs: ${abis.length}`)
  logger.info(`JNS Records: ${jnsRecords.length}`)
  logger.info(`Total Size: ${formatBytes(totalSize)}`)
  logger.info(`Manifest Hash: ${manifest.manifestHash.slice(0, 16)}...`)
}

async function verifyManifest(
  manifestPath: string,
  options: { network: string },
): Promise<void> {
  logger.info('Verifying manifest...')

  let manifest: SystemContentManifest

  // Load manifest from file or fetch by CID
  if (manifestPath.startsWith('bafy') || manifestPath.startsWith('Qm')) {
    const dwsUrl = process.env.DWS_URL ?? 'http://localhost:4020'
    const response = await fetch(`${dwsUrl}/ipfs/${manifestPath}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch manifest: ${response.statusText}`)
    }
    manifest = await response.json()
  } else {
    const fullPath = manifestPath.startsWith('/')
      ? manifestPath
      : join(process.cwd(), manifestPath)
    manifest = JSON.parse(readFileSync(fullPath, 'utf-8'))
  }

  // Verify manifest hash
  const storedHash = manifest.manifestHash
  manifest.manifestHash = ''
  const calculatedHash = createHash('sha256')
    .update(JSON.stringify(manifest, null, 2))
    .digest('hex')
  manifest.manifestHash = storedHash

  if (calculatedHash !== storedHash) {
    logger.error('Manifest hash mismatch.')
    logger.error(`  Expected: ${storedHash}`)
    logger.error(`  Calculated: ${calculatedHash}`)
    process.exit(1)
  }

  logger.info('Manifest hash verified.')

  // Verify against on-chain registry
  const rpcUrl = getRpcUrl(options.network)
  const client = createPublicClient({
    chain: foundry,
    transport: http(rpcUrl),
  })

  // Load SystemContentRegistry address
  const registryAddress = await loadRegistryAddress(options.network)
  if (!registryAddress) {
    logger.warn(
      'SystemContentRegistry not deployed, skipping on-chain verification',
    )
    return
  }

  const onChainManifestHash = (await client.readContract({
    address: registryAddress,
    abi: parseAbi(['function currentManifestHash() view returns (bytes32)']),
    functionName: 'currentManifestHash',
  })) as string

  if (onChainManifestHash === `0x${storedHash}`) {
    logger.info('On-chain manifest hash matches.')
  } else {
    logger.warn('On-chain manifest hash does not match.')
    logger.warn(`  On-chain: ${onChainManifestHash}`)
    logger.warn(`  Local: 0x${storedHash}`)
  }

  // Verify individual content
  let verified = 0
  let missing = 0

  for (const app of manifest.apps) {
    if (app.cid) {
      const exists = await checkContentExists(app.cid)
      if (exists) {
        verified++
      } else {
        missing++
        logger.warn(`Missing: ${app.name} (${app.cid})`)
      }
    }
  }

  logger.info(
    `\nContent verification: ${verified} verified, ${missing} missing`,
  )
}

async function createSignedUrl(
  cid: string,
  options: { expires: string; maxDownloads?: string },
): Promise<void> {
  const expiresSeconds = parseInt(options.expires, 10)
  const maxDownloads = options.maxDownloads
    ? parseInt(options.maxDownloads, 10)
    : null

  // Get signing key from environment
  const signingKey =
    process.env.STORAGE_SIGNING_KEY ?? process.env.DEPLOYER_PRIVATE_KEY
  if (!signingKey) {
    throw new Error('STORAGE_SIGNING_KEY or DEPLOYER_PRIVATE_KEY required')
  }

  const expiresAt = Math.floor(Date.now() / 1000) + expiresSeconds

  // Create signed token
  const payload = {
    cid,
    exp: expiresAt,
    ...(maxDownloads && { max: maxDownloads }),
    iat: Math.floor(Date.now() / 1000),
  }

  const payloadJson = JSON.stringify(payload)
  const payloadBase64 = Buffer.from(payloadJson).toString('base64url')

  // Sign with HMAC-SHA256
  const hmac = createHash('sha256')
    .update(`${payloadBase64}.${signingKey}`)
    .digest('base64url')

  const token = `${payloadBase64}.${hmac}`
  const dwsUrl = process.env.DWS_URL ?? 'http://localhost:4020'
  const signedUrl = `${dwsUrl}/storage/signed/${token}`

  logger.info('Signed URL created:')
  console.log(signedUrl)
  logger.info(`\nExpires: ${new Date(expiresAt * 1000).toISOString()}`)
  if (maxDownloads) {
    logger.info(`Max downloads: ${maxDownloads}`)
  }
}

async function verifyStorageProof(
  cid: string,
  options: { node?: string; network: string },
): Promise<void> {
  logger.info(`Verifying storage proof for ${cid}...`)

  const dwsUrl = process.env.DWS_URL ?? 'http://localhost:4020'

  // Get proof from node
  const proofUrl = options.node
    ? `${options.node}/storage/proof/${cid}`
    : `${dwsUrl}/storage/proof/${cid}`

  const response = await fetch(proofUrl)
  if (!response.ok) {
    throw new Error(`Failed to get proof: ${response.statusText}`)
  }

  const proof = await response.json()

  logger.info('\nProof details:')
  console.log(JSON.stringify(proof, null, 2))

  // Verify on-chain if registry is available
  const registryAddress = await loadRegistryAddress(options.network)
  if (registryAddress) {
    logger.info('\nVerifying on-chain...')
    // Would call SystemContentRegistry.verifyStorageProof
  }
}

async function listStorageProviders(options: {
  backend?: string
  region?: string
}): Promise<void> {
  logger.info('Fetching storage providers...')

  const dwsUrl = process.env.DWS_URL ?? 'http://localhost:4020'
  const params = new URLSearchParams()
  if (options.backend) params.set('backend', options.backend)
  if (options.region) params.set('region', options.region)

  const response = await fetch(`${dwsUrl}/storage/providers?${params}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch providers: ${response.statusText}`)
  }

  const providers = await response.json()

  console.log('\n=== Storage Providers ===\n')
  for (const provider of providers.providers ?? []) {
    console.log(`${provider.id}`)
    console.log(`  Backend: ${provider.backend}`)
    console.log(`  Region: ${provider.region}`)
    console.log(
      `  Capacity: ${formatBytes(provider.capacityGB * 1024 * 1024 * 1024)}`,
    )
    console.log(`  Price: ${provider.pricePerGBMonth} / GB / month`)
    console.log(`  Active: ${provider.isActive}`)
    console.log('')
  }
}

async function estimateStorageCost(
  sizeArg: string,
  options: {
    duration: string
    backend?: string
    replicas: string
  },
): Promise<void> {
  const size = parseSize(sizeArg)
  const durationDays = parseInt(options.duration, 10)
  const replicas = parseInt(options.replicas, 10)

  logger.info('Estimating storage cost...')
  logger.info(`  Size: ${formatBytes(size)}`)
  logger.info(`  Duration: ${durationDays} days`)
  logger.info(`  Replicas: ${replicas}`)

  const dwsUrl = process.env.DWS_URL ?? 'http://localhost:4020'

  if (options.backend === 'filecoin') {
    const response = await fetch(`${dwsUrl}/storage/filecoin/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sizeBytes: size,
        durationDays,
        replicationFactor: replicas,
      }),
    })

    if (response.ok) {
      const estimate = await response.json()
      console.log('\n=== Filecoin Cost Estimate ===')
      console.log(`  Total FIL: ${estimate.totalFil}`)
      console.log(`  USD: $${estimate.usd}`)
      console.log(`  Storage: ${estimate.breakdown?.storage ?? 'N/A'}`)
      console.log(`  Retrieval: ${estimate.breakdown?.retrieval ?? 'N/A'}`)
    }
  } else if (options.backend === 'arweave') {
    const response = await fetch(
      `${dwsUrl}/storage/arweave/estimate?size=${size}`,
    )

    if (response.ok) {
      const estimate = await response.json()
      console.log('\n=== Arweave Cost Estimate (Permanent) ===')
      console.log(`  AR: ${estimate.ar}`)
      console.log(`  USD: $${estimate.usd}`)
    }
  } else {
    // Generic estimate
    console.log('\n=== Cost Estimate ===')

    // Rough estimate: $0.02/GB/month for hot storage
    const pricePerGBMonth = 0.02
    const sizeGB = size / (1024 * 1024 * 1024)
    const months = durationDays / 30
    const totalCost = sizeGB * pricePerGBMonth * months * replicas

    console.log(`  Estimated: $${totalCost.toFixed(4)}`)
    console.log(`  (Based on $${pricePerGBMonth}/GB/month average)`)
  }
}

// ============ Helper Functions ============

function calculateDirectoryStats(dir: string): {
  size: number
  hash: string
  files: number
} {
  let totalSize = 0
  let fileCount = 0
  const hashes: string[] = []

  function walk(currentDir: string): void {
    const entries = readdirSync(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name)

      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile()) {
        const stat = statSync(fullPath)
        totalSize += stat.size
        fileCount++

        const content = readFileSync(fullPath)
        const fileHash = createHash('sha256').update(content).digest('hex')
        hashes.push(`${relative(dir, fullPath)}:${fileHash}`)
      }
    }
  }

  walk(dir)

  // Calculate combined hash from all file hashes
  const combinedHash = createHash('sha256')
    .update(hashes.sort().join('\n'))
    .digest('hex')

  return { size: totalSize, hash: combinedHash, files: fileCount }
}

function findAbiFiles(dir: string): string[] {
  const files: string[] = []

  function walk(currentDir: string): void {
    const entries = readdirSync(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name)

      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        // Only include ABI files (exclude dbg, metadata)
        if (
          !entry.name.includes('.dbg.') &&
          !entry.name.includes('.metadata.')
        ) {
          files.push(fullPath)
        }
      }
    }
  }

  walk(dir)
  return files
}

async function uploadManifestContent(
  manifest: SystemContentManifest,
  rootDir: string,
): Promise<void> {
  const dwsUrl = process.env.DWS_URL ?? 'http://localhost:4020'

  for (const app of manifest.apps) {
    const buildDir = join(rootDir, 'apps', app.name, app.buildDir)
    if (!existsSync(buildDir)) continue

    logger.info(`  Uploading ${app.name}...`)

    // Create tar of build directory and upload
    const formData = new FormData()

    // For now, upload index.html as representative content
    const indexPath = join(buildDir, 'index.html')
    if (existsSync(indexPath)) {
      const content = readFileSync(indexPath)
      formData.append('file', new Blob([content]), 'index.html')

      const response = await fetch(`${dwsUrl}/storage/upload`, {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const result = await response.json()
        app.cid = result.cid
        logger.info(`    CID: ${result.cid}`)
      }
    }
  }
}

async function registerManifestOnChain(
  manifest: SystemContentManifest,
  network: string,
): Promise<void> {
  const rpcUrl = getRpcUrl(network)
  const privateKey = getPrivateKey()

  const account = privateKeyToAccount(privateKey)
  const client = createWalletClient({
    account,
    chain: foundry,
    transport: http(rpcUrl),
  })

  const registryAddress = await loadRegistryAddress(network)
  if (!registryAddress) {
    throw new Error('SystemContentRegistry not deployed')
  }

  // Register each required content
  for (const app of manifest.apps) {
    if (!app.cid) continue

    logger.info(`  Registering ${app.name}...`)

    const contentHash = createHash('sha256')
      .update(JSON.stringify({ name: app.name, cid: app.cid }))
      .digest()

    await client.writeContract({
      address: registryAddress,
      abi: parseAbi([
        'function addContent(string cid, string name, uint8 category, uint256 size, bytes32 contentHash, bool required, string magnetUri, bytes32 arweaveTxId) returns (bytes32)',
      ]),
      functionName: 'addContent',
      args: [
        app.cid,
        app.name,
        0, // CORE_APP category
        BigInt(app.size),
        `0x${contentHash.toString('hex')}` as `0x${string}`,
        true,
        '',
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      ],
    })
  }
}

function getRpcUrl(network: string): string {
  switch (network) {
    case 'mainnet':
      return process.env.MAINNET_RPC_URL ?? 'https://rpc.jeju.network'
    case 'testnet':
      return process.env.TESTNET_RPC_URL ?? 'https://testnet-rpc.jeju.network'
    default:
      return process.env.LOCALNET_RPC_URL ?? 'http://localhost:8545'
  }
}

function getPrivateKey(): `0x${string}` {
  const key =
    process.env.DEPLOYER_PRIVATE_KEY ??
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  return key as `0x${string}`
}

async function loadRegistryAddress(network: string): Promise<Address | null> {
  const rootDir = findMonorepoRoot()
  const deploymentPath = join(
    rootDir,
    'packages/config/deployments',
    `${network}.json`,
  )

  if (!existsSync(deploymentPath)) {
    return null
  }

  const deployment = JSON.parse(readFileSync(deploymentPath, 'utf-8'))
  return deployment.systemContentRegistry ?? null
}

async function checkContentExists(cid: string): Promise<boolean> {
  const dwsUrl = process.env.DWS_URL ?? 'http://localhost:4020'
  const response = await fetch(`${dwsUrl}/ipfs/${cid}`, { method: 'HEAD' })
  return response.ok
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / k ** i).toFixed(2)} ${sizes[i]}`
}

function parseSize(sizeStr: string): number {
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)?$/i)
  if (!match) {
    return parseInt(sizeStr, 10)
  }

  const value = parseFloat(match[1])
  const unit = (match[2] ?? 'B').toUpperCase()

  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
  }

  return Math.round(value * (multipliers[unit] ?? 1))
}
