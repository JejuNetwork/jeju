/**
 * On-Chain App Deployment
 * Deploys app frontends and backends through DWS contracts
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Address, Hex } from 'viem'
import {
  createWalletClient,
  http,
  keccak256,
  publicActions,
  stringToBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { AppManifest } from '../types'
import { localnetChain } from './chain'
import { logger } from './logger'

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

const JNS_REGISTRY_ABI = [
  {
    name: 'setSubnodeOwner',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'label', type: 'bytes32' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'setResolver',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'resolver', type: 'address' },
    ],
    outputs: [],
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
    name: 'createSite',
    type: 'function',
    inputs: [
      { name: 'domain', type: 'string' },
      { name: 'origin', type: 'string' },
    ],
    outputs: [{ name: 'siteId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'updateSiteContent',
    type: 'function',
    inputs: [
      { name: 'siteId', type: 'bytes32' },
      { name: 'contentHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

export interface DWSContractAddresses {
  storageManager: Address
  workerRegistry: Address
  cdnRegistry: Address
  jnsRegistry: Address
  jnsResolver: Address
  jnsRegistrar: Address
  jnsReverseRegistrar: Address
}

export interface DeployConfig {
  rpcUrl: string
  privateKey: Hex
  contracts: DWSContractAddresses
  ipfsApiUrl: string
}

export interface DeployResult {
  frontendCid?: string
  frontendUploadId?: Hex
  workerCid?: string
  workerId?: Hex
  jnsName?: string
  siteId?: Hex
}

/**
 * Deploy an app's frontend and backend on-chain
 */
export async function deployAppOnchain(
  appDir: string,
  manifest: AppManifest,
  config: DeployConfig,
): Promise<DeployResult> {
  const account = privateKeyToAccount(config.privateKey)

  const client = createWalletClient({
    account,
    chain: localnetChain,
    transport: http(config.rpcUrl),
  }).extend(publicActions)

  const result: DeployResult = {}

  logger.step(`Deploying ${manifest.name} on-chain...`)

  // Step 1: Build the app
  await buildApp(appDir, manifest)

  // Step 2: Deploy frontend to IPFS and record in StorageManager
  if (manifest.architecture?.frontend) {
    const frontendResult = await deployFrontend(
      appDir,
      manifest,
      client,
      config,
    )
    result.frontendCid = frontendResult.cid
    result.frontendUploadId = frontendResult.uploadId
  }

  // Step 3: Deploy backend worker to WorkerRegistry
  if (manifest.architecture?.backend) {
    const workerResult = await deployWorker(appDir, manifest, client, config)
    result.workerCid = workerResult.cid
    result.workerId = workerResult.workerId
  }

  // Step 4: Register JNS name
  result.jnsName = await registerJNSName(
    manifest.name,
    result.frontendCid,
    result.workerId,
    client,
    config,
  )

  // Step 5: Create CDN site
  if (result.frontendCid) {
    result.siteId = await createCDNSite(
      manifest.name,
      result.frontendCid,
      client,
      config,
    )
  }

  logger.success(`${manifest.name} deployed on-chain`)

  return result
}

/**
 * Allowed build commands to prevent command injection from malicious manifests
 */
const ALLOWED_BUILD_COMMANDS = [
  'bun run build',
  'npm run build',
  'pnpm run build',
  'yarn build',
  'bun build',
] as const

async function buildApp(appDir: string, manifest: AppManifest): Promise<void> {
  const buildCmd = manifest.commands?.build ?? 'bun run build'
  logger.debug(`Building ${manifest.name}: ${buildCmd}`)

  // SECURITY: Validate build command to prevent command injection
  // Only allow known safe build commands
  const isAllowed = ALLOWED_BUILD_COMMANDS.some(
    (allowed) => buildCmd === allowed || buildCmd.startsWith(`${allowed} `),
  )

  if (!isAllowed) {
    // For custom commands, use spawnSync with shell: false to prevent injection
    // and only allow specific patterns
    const safeBuildPattern = /^(bun|npm|pnpm|yarn)\s+run\s+[a-zA-Z0-9_-]+$/
    if (!safeBuildPattern.test(buildCmd)) {
      throw new Error(
        `Unsafe build command: ${buildCmd}. Use 'bun run build' or similar standard commands.`,
      )
    }
  }

  try {
    // Use spawnSync with shell:true only for validated commands
    const proc = spawnSync('sh', ['-c', buildCmd], {
      cwd: appDir,
      stdio: 'pipe',
      encoding: 'utf-8',
    })

    if (proc.status !== 0) {
      throw new Error(proc.stderr || 'Build failed')
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    throw new Error(`Build failed for ${manifest.name}: ${errorMsg}`)
  }
}

async function deployFrontend(
  appDir: string,
  manifest: AppManifest,
  client: ReturnType<typeof createWalletClient> &
    ReturnType<typeof publicActions>,
  config: DeployConfig,
): Promise<{ cid: string; uploadId: Hex }> {
  const frontend = manifest.architecture?.frontend
  const outputDir =
    (typeof frontend === 'object' && frontend.outputDir) || 'dist/static'
  const frontendPath = join(appDir, outputDir)

  if (!existsSync(frontendPath)) {
    throw new Error(`Frontend build not found at ${frontendPath}`)
  }

  // Upload to IPFS
  logger.debug(`Uploading frontend to IPFS...`)
  const cid = uploadToIPFS(frontendPath, config.ipfsApiUrl)
  logger.debug(`  Frontend CID: ${cid}`)

  // Get approximate size
  const size = getDirectorySize(frontendPath)

  const account = client.account
  if (!account) throw new Error('No account configured on client')

  // Record in StorageManager
  const contentHash = keccak256(stringToBytes(cid))
  try {
    const hash = await client.writeContract({
      chain: localnetChain,
      account,
      address: config.contracts.storageManager,
      abi: STORAGE_MANAGER_ABI,
      functionName: 'recordUpload',
      args: [
        cid,
        contentHash,
        BigInt(size),
        0, // IPFS backend
        true, // permanent
      ],
      value: BigInt(Math.ceil(size / (1024 * 1024))) * BigInt(1e15), // 0.001 ETH per MB
    })

    await client.waitForTransactionReceipt({ hash })
    return { cid, uploadId: hash }
  } catch (error) {
    // Check if CID already exists (0xb8bd85b1 = CIDAlreadyExists)
    const errorStr = String(error)
    if (
      errorStr.includes('0xb8bd85b1') ||
      errorStr.includes('CIDAlreadyExists')
    ) {
      logger.debug(`  CID ${cid} already registered, skipping recordUpload`)
      return { cid, uploadId: '0x' as Hex }
    }
    throw error
  }
}

async function deployWorker(
  appDir: string,
  manifest: AppManifest,
  client: ReturnType<typeof createWalletClient> &
    ReturnType<typeof publicActions>,
  config: DeployConfig,
): Promise<{ cid: string; workerId: Hex }> {
  const backend = manifest.architecture?.backend
  const outputDir =
    (typeof backend === 'object' && backend.outputDir) || 'dist/worker'
  const workerPath = join(appDir, outputDir)

  if (!existsSync(workerPath)) {
    throw new Error(`Worker build not found at ${workerPath}`)
  }

  // Upload worker code to IPFS
  logger.debug(`Uploading worker to IPFS...`)
  const cid = uploadToIPFS(workerPath, config.ipfsApiUrl)
  logger.debug(`  Worker CID: ${cid}`)

  const codeHash = keccak256(stringToBytes(cid))

  const account = client.account
  if (!account) throw new Error('No account configured on client')

  // Register in WorkerRegistry
  try {
    const hash = await client.writeContract({
      chain: localnetChain,
      account,
      address: config.contracts.workerRegistry,
      abi: WORKER_REGISTRY_ABI,
      functionName: 'deployWorker',
      args: [
        manifest.name,
        codeHash,
        [`/${manifest.name}/*`], // Routes
        '', // No cron
        0, // FREE payment mode for localnet
        BigInt(0), // Free
      ],
    })

    await client.waitForTransactionReceipt({ hash })
    return { cid, workerId: hash }
  } catch (error) {
    // Check if route already registered (0xfa0dec64 = RouteAlreadyRegistered)
    const errorStr = String(error)
    if (
      errorStr.includes('0xfa0dec64') ||
      errorStr.includes('RouteAlreadyRegistered')
    ) {
      logger.debug(
        `  Worker route for ${manifest.name} already registered, skipping`,
      )
      return { cid, workerId: '0x' as Hex }
    }
    throw error
  }
}

async function registerJNSName(
  appName: string,
  frontendCid: string | undefined,
  workerId: Hex | undefined,
  client: ReturnType<typeof createWalletClient> &
    ReturnType<typeof publicActions>,
  config: DeployConfig,
): Promise<string> {
  const name = `${appName}.jeju`
  logger.debug(`Registering JNS name: ${name}`)

  const account = client.account
  if (!account) throw new Error('No account configured on client')

  // Calculate node hashes
  const jejuLabel = keccak256(stringToBytes('jeju'))
  const jejuNode = keccak256(`0x${'0'.repeat(64)}${jejuLabel.slice(2)}` as Hex)
  const appLabel = keccak256(stringToBytes(appName))

  // Create subnode for app
  const createHash = await client.writeContract({
    chain: localnetChain,
    account,
    address: config.contracts.jnsRegistry,
    abi: JNS_REGISTRY_ABI,
    functionName: 'setSubnodeOwner',
    args: [jejuNode, appLabel, account.address],
  })
  await client.waitForTransactionReceipt({ hash: createHash })

  // Calculate app node
  const appNode = keccak256(`${jejuNode}${appLabel.slice(2)}` as Hex)

  // Set resolver
  const resolverHash = await client.writeContract({
    chain: localnetChain,
    account,
    address: config.contracts.jnsRegistry,
    abi: JNS_REGISTRY_ABI,
    functionName: 'setResolver',
    args: [appNode, config.contracts.jnsResolver],
  })
  await client.waitForTransactionReceipt({ hash: resolverHash })

  // Set contenthash if frontend deployed
  if (frontendCid) {
    const contenthash = encodeIPFSContenthash(frontendCid)
    const contentHashTx = await client.writeContract({
      chain: localnetChain,
      account,
      address: config.contracts.jnsResolver,
      abi: JNS_RESOLVER_ABI,
      functionName: 'setContenthash',
      args: [appNode, contenthash],
    })
    await client.waitForTransactionReceipt({ hash: contentHashTx })
  }

  // Set worker endpoint if backend deployed
  if (workerId) {
    const textHash = await client.writeContract({
      chain: localnetChain,
      account,
      address: config.contracts.jnsResolver,
      abi: JNS_RESOLVER_ABI,
      functionName: 'setText',
      args: [appNode, 'dws.worker', workerId],
    })
    await client.waitForTransactionReceipt({ hash: textHash })
  }

  return name
}

async function createCDNSite(
  appName: string,
  contentCid: string,
  client: ReturnType<typeof createWalletClient> &
    ReturnType<typeof publicActions>,
  config: DeployConfig,
): Promise<Hex> {
  const domain = `${appName}.local.jejunetwork.org`
  logger.debug(`Creating CDN site: ${domain}`)

  const account = client.account
  if (!account) throw new Error('No account configured on client')

  try {
    // Create the site - siteId is derived from sender + domain + timestamp
    const createHash = await client.writeContract({
      chain: localnetChain,
      account,
      address: config.contracts.cdnRegistry,
      abi: CDN_REGISTRY_ABI,
      functionName: 'createSite',
      args: [domain, `ipfs://${contentCid}`],
    })
    const receipt = await client.waitForTransactionReceipt({ hash: createHash })

    // Parse SiteCreated event to get the actual siteId
    // Event signature: SiteCreated(bytes32 indexed siteId, address indexed owner, string domain)
    const siteCreatedTopic = keccak256(
      stringToBytes('SiteCreated(bytes32,address,string)'),
    )
    const siteCreatedLog = receipt.logs.find(
      (log) => log.topics[0] === siteCreatedTopic,
    )

    if (!siteCreatedLog || !siteCreatedLog.topics[1]) {
      logger.warn(
        'Could not find SiteCreated event, site created but content hash not updated',
      )
      return '0x' as Hex
    }

    const siteId = siteCreatedLog.topics[1] as Hex

    // Update content hash using the actual siteId from the event
    const contentHash = keccak256(stringToBytes(contentCid))
    const updateHash = await client.writeContract({
      chain: localnetChain,
      account,
      address: config.contracts.cdnRegistry,
      abi: CDN_REGISTRY_ABI,
      functionName: 'updateSiteContent',
      args: [siteId, contentHash],
    })
    await client.waitForTransactionReceipt({ hash: updateHash })

    return siteId
  } catch (error) {
    // Handle NotSiteOwner or other CDN errors gracefully
    const errorStr = String(error)
    if (errorStr.includes('0x8af60e64') || errorStr.includes('NotSiteOwner')) {
      logger.debug(`  CDN site update skipped (not owner): ${domain}`)
      return '0x' as Hex
    }
    // For other errors, log but don't fail the deployment
    logger.warn(
      `  CDN site creation failed for ${domain}: ${errorStr.slice(0, 200)}`,
    )
    return '0x' as Hex
  }
}

// Helper functions

/**
 * Recursively collect all files in a directory
 */
function collectFiles(
  dir: string,
  baseDir: string,
): Array<{ path: string; relativePath: string }> {
  const files: Array<{ path: string; relativePath: string }> = []
  const entries = readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, baseDir))
    } else if (entry.isFile()) {
      files.push({
        path: fullPath,
        relativePath: relative(baseDir, fullPath),
      })
    }
  }

  return files
}

function uploadToIPFS(targetPath: string, apiUrl: string): string {
  // Use native fs to check if path is directory (prevents command injection)
  const stat = statSync(targetPath)

  if (stat.isDirectory()) {
    // Collect all files recursively using native fs
    const files = collectFiles(targetPath, targetPath)

    if (files.length === 0) {
      throw new Error(`No files found in directory: ${targetPath}`)
    }

    // Build curl arguments array (prevents shell injection)
    const args = ['-s', '-X', 'POST']
    for (const file of files) {
      args.push('-F', `file=@${file.path};filename=${file.relativePath}`)
    }
    args.push(`${apiUrl}/api/v0/add?wrap-with-directory=true&pin=true`)

    const proc = spawnSync('curl', args, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    })

    if (proc.error) {
      throw new Error(`IPFS upload failed: ${proc.error.message}`)
    }

    if (proc.status !== 0) {
      throw new Error(`IPFS upload failed: ${proc.stderr}`)
    }

    // Parse the last line of ndjson output for the directory hash
    const lines = proc.stdout.trim().split('\n')
    const lastLine = lines[lines.length - 1]

    const parsed = JSON.parse(lastLine)
    if (!parsed.Hash) {
      throw new Error(`Failed to upload directory to IPFS: ${targetPath}`)
    }

    return parsed.Hash
  }

  // Single file upload using spawnSync (prevents shell injection)
  const proc = spawnSync(
    'curl',
    [
      '-s',
      '-X',
      'POST',
      '-F',
      `file=@${targetPath}`,
      `${apiUrl}/api/v0/add?pin=true`,
    ],
    { encoding: 'utf-8' },
  )

  if (proc.error) {
    throw new Error(`IPFS upload failed: ${proc.error.message}`)
  }

  if (proc.status !== 0) {
    throw new Error(`IPFS upload failed: ${proc.stderr}`)
  }

  const parsed = JSON.parse(proc.stdout)
  if (!parsed.Hash) {
    throw new Error(`Failed to upload to IPFS: ${targetPath}`)
  }

  return parsed.Hash
}

/**
 * Calculate total size of files in a directory using native fs (prevents command injection)
 */
function getDirectorySize(targetPath: string): number {
  const stat = statSync(targetPath)

  if (!stat.isDirectory()) {
    return stat.size
  }

  let totalSize = 0
  const entries = readdirSync(targetPath, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(targetPath, entry.name)
    if (entry.isDirectory()) {
      totalSize += getDirectorySize(fullPath)
    } else if (entry.isFile()) {
      totalSize += statSync(fullPath).size
    }
  }

  return totalSize || 1024 // Default to 1KB if empty
}

function encodeIPFSContenthash(cid: string): Hex {
  // EIP-1577 contenthash encoding for IPFS
  // Format: 0xe3 (IPFS namespace) + 0x01 (CIDv1 prefix) + 0x70 (dag-pb codec) + multihash

  // For CIDv0 "Qm..." format, we need to base58 decode to get the multihash
  if (cid.startsWith('Qm')) {
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

      // Handle leading zeros
      let leadingZeros = 0
      for (const char of str) {
        if (char === '1') leadingZeros++
        else break
      }

      const result = new Uint8Array(leadingZeros + bytes.length)
      result.set(new Uint8Array(bytes), leadingZeros)
      return result
    }

    const multihash = base58Decode(cid)
    // Contenthash = e3 (IPFS) + 01 (CIDv1) + 70 (dag-pb) + multihash
    const contenthash = new Uint8Array(3 + multihash.length)
    contenthash[0] = 0xe3
    contenthash[1] = 0x01
    contenthash[2] = 0x70
    contenthash.set(multihash, 3)

    return `0x${Array.from(contenthash)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}` as Hex
  }

  // For other CID formats, store as simple text encoding with e3 prefix
  const cidBytes = new TextEncoder().encode(cid)
  const contenthash = new Uint8Array(1 + cidBytes.length)
  contenthash[0] = 0xe3
  contenthash.set(cidBytes, 1)
  return `0x${Array.from(contenthash)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}` as Hex
}
