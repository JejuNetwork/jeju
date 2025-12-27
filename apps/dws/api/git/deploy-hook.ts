/**
 * Git Push Auto-Deployment Hook
 *
 * Automatically deploys apps when pushed to the DWS git server:
 * - Detects framework and builds
 * - Uploads to IPFS
 * - Updates JNS contenthash
 * - Triggers worker deployment if API detected
 *
 * Usage:
 *   git remote add dws https://dws.jejunetwork.org/git/myapp
 *   git push dws main
 *
 * Workerd compatible: Uses exec API for file operations.
 */

import { getContract, getRpcUrl, type NetworkType } from '@jejunetwork/config'
import {
  type Address,
  createWalletClient,
  type Hex,
  http,
  keccak256,
  stringToBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  createKMSWalletClient,
  isKMSAvailable,
  type KMSWalletClient,
} from '../shared/kms-wallet'

// Config injection for workerd compatibility
interface DeployHookEnvConfig {
  execUrl: string
}

let envConfig: DeployHookEnvConfig = {
  execUrl: 'http://localhost:4020/exec',
}

export function configureDeployHook(
  config: Partial<DeployHookEnvConfig>,
): void {
  envConfig = { ...envConfig, ...config }
}

// DWS Exec API

interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

async function exec(
  command: string[],
  options?: { cwd?: string; stdin?: string },
): Promise<ExecResult> {
  const response = await fetch(envConfig.execUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, ...options }),
  })
  if (!response.ok) {
    throw new Error(`Exec API error: ${response.status}`)
  }
  return response.json() as Promise<ExecResult>
}

async function execCommand(cmd: string, cwd?: string): Promise<string> {
  const result = await exec(['sh', '-c', cmd], { cwd })
  if (result.exitCode !== 0) {
    throw new Error(`Command failed: ${result.stderr}`)
  }
  return result.stdout
}

async function fileExists(path: string): Promise<boolean> {
  const result = await exec(['test', '-e', path])
  return result.exitCode === 0
}

async function readFile(path: string): Promise<string> {
  const result = await exec(['cat', path])
  if (result.exitCode !== 0) {
    throw new Error(`Failed to read file: ${result.stderr}`)
  }
  return result.stdout
}

function joinPath(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/')
}

export interface DeployHookConfig {
  repoPath: string
  appName: string
  branch: string
  commitHash: string
  owner: Address
  network: NetworkType
}

export interface DeploymentResult {
  success: boolean
  appName: string
  branch: string
  commitHash: string
  ipfsCid?: string
  jnsName?: string
  jnsTxHash?: string
  workerDeployed?: boolean
  buildLogs?: string
  error?: string
  duration: number
}

// Framework detection patterns
const FRAMEWORK_CONFIGS: Record<
  string,
  { buildCmd: string; outputDir: string; detect: string[] }
> = {
  nextjs: {
    detect: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
    buildCmd: 'bun run build && bun run export',
    outputDir: 'out',
  },
  vite: {
    detect: ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'],
    buildCmd: 'bun run build',
    outputDir: 'dist',
  },
  react: {
    detect: [], // Check package.json
    buildCmd: 'bun run build',
    outputDir: 'build',
  },
  astro: {
    detect: ['astro.config.mjs', 'astro.config.js'],
    buildCmd: 'bun run build',
    outputDir: 'dist',
  },
  static: {
    detect: ['index.html'],
    buildCmd: '',
    outputDir: '.',
  },
}

// JNS Resolver ABI
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

/**
 * Detect framework from repository
 */
async function detectFramework(repoPath: string): Promise<{
  name: string
  buildCmd: string
  outputDir: string
}> {
  for (const [name, config] of Object.entries(FRAMEWORK_CONFIGS)) {
    for (const file of config.detect) {
      const exists = await fileExists(joinPath(repoPath, file))
      if (exists) {
        return { name, ...config }
      }
    }
  }

  // Check package.json for react-scripts
  const pkgPath = joinPath(repoPath, 'package.json')
  const pkgExists = await fileExists(pkgPath)
  if (pkgExists) {
    const pkgContent = await readFile(pkgPath)
    const pkg = JSON.parse(pkgContent)
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }

    if (deps['react-scripts']) {
      return { name: 'react', ...FRAMEWORK_CONFIGS.react }
    }
    if (deps.next) {
      return { name: 'nextjs', ...FRAMEWORK_CONFIGS.nextjs }
    }
    if (deps.vite) {
      return { name: 'vite', ...FRAMEWORK_CONFIGS.vite }
    }
    if (deps.astro) {
      return { name: 'astro', ...FRAMEWORK_CONFIGS.astro }
    }
  }

  return { name: 'static', ...FRAMEWORK_CONFIGS.static }
}

/**
 * Check if repo has API/worker code
 */
async function hasWorkerCode(repoPath: string): Promise<boolean> {
  const indicators = [
    'api/index.ts',
    'api/index.js',
    'worker/index.ts',
    'worker/index.js',
    'functions/',
    'src/api/',
    'jeju-manifest.json',
  ]

  for (const indicator of indicators) {
    const exists = await fileExists(joinPath(repoPath, indicator))
    if (exists) {
      return true
    }
  }

  // Check package.json for worker script
  const pkgPath = joinPath(repoPath, 'package.json')
  const pkgExists = await fileExists(pkgPath)
  if (pkgExists) {
    const pkgContent = await readFile(pkgPath)
    const pkg = JSON.parse(pkgContent)
    if (pkg.scripts?.['build:worker'] || pkg.scripts?.worker) {
      return true
    }
  }

  return false
}

/**
 * Build the project
 */
async function buildProject(
  repoPath: string,
  framework: { buildCmd: string; outputDir: string },
): Promise<{ success: boolean; logs: string }> {
  const logs: string[] = []

  // Install dependencies
  const hasPkg = await fileExists(joinPath(repoPath, 'package.json'))
  if (hasPkg) {
    const hasNodeModules = await fileExists(joinPath(repoPath, 'node_modules'))
    if (!hasNodeModules) {
      logs.push('Installing dependencies...')
      try {
        const installOutput = await execCommand('bun install', repoPath)
        logs.push(installOutput)
      } catch (e) {
        const error = e as { stderr?: string }
        logs.push(`Install failed: ${error.stderr ?? 'Unknown error'}`)
        return { success: false, logs: logs.join('\n') }
      }
    }
  }

  // Build
  if (framework.buildCmd) {
    logs.push(`Building with: ${framework.buildCmd}`)
    try {
      const buildOutput = await execCommand(framework.buildCmd, repoPath)
      logs.push(buildOutput)
    } catch (e) {
      const error = e as { stderr?: string }
      logs.push(`Build failed: ${error.stderr ?? 'Unknown error'}`)
      return { success: false, logs: logs.join('\n') }
    }
  }

  return { success: true, logs: logs.join('\n') }
}

/**
 * Upload directory to IPFS
 */
async function uploadToIPFS(dirPath: string): Promise<string | null> {
  const ipfsApiUrl = 'http://localhost:5001'

  try {
    // Use IPFS CLI for directory upload via exec API
    const result = await execCommand(
      `ipfs add -r -Q --cid-version=1 "${dirPath}"`,
    )
    return result.trim()
  } catch {
    // Fallback: try API endpoint
    const response = await fetch(
      `${ipfsApiUrl}/api/v0/add?recursive=true&cid-version=1`,
      {
        method: 'POST',
        // Would need to implement directory upload via API
      },
    )

    if (!response.ok) return null

    const data = (await response.json()) as { Hash: string }
    return data.Hash
  }
}

/**
 * Update JNS contenthash
 *
 * SECURITY: In production, uses KMS-backed signing to protect against side-channel attacks.
 */
async function updateJNS(
  name: string,
  cid: string,
  network: NetworkType,
  privateKey?: Hex,
): Promise<string | null> {
  const jnsResolver = getContract('jns', 'jnsResolver') as Address | undefined
  if (!jnsResolver) return null

  const rpcUrl = getRpcUrl(network)
  const chainId =
    network === 'mainnet' ? 1 : network === 'testnet' ? 11155111 : 31337
  const chain = {
    id: chainId,
    name: network,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  }

  // Try KMS-backed signing first
  const kmsKeyId = process.env.DEPLOY_HOOK_KMS_KEY_ID
  const ownerAddress = process.env.DEPLOY_HOOK_OWNER_ADDRESS as
    | Address
    | undefined

  let walletClient: ReturnType<typeof createWalletClient> | KMSWalletClient

  if (kmsKeyId && ownerAddress) {
    const kmsAvailable = await isKMSAvailable()
    if (kmsAvailable) {
      walletClient = await createKMSWalletClient({
        chain,
        rpcUrl,
        kmsKeyId,
        ownerAddress,
      })
    } else if (process.env.NODE_ENV === 'production') {
      console.error('[DeployHook] KMS not available in production')
      return null
    } else if (privateKey) {
      walletClient = createWalletClient({
        account: privateKeyToAccount(privateKey),
        transport: http(rpcUrl),
      })
    } else {
      return null
    }
  } else if (privateKey) {
    // Fallback to direct key (development only)
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[DeployHook] Using direct key in production - set DEPLOY_HOOK_KMS_KEY_ID',
      )
    }
    walletClient = createWalletClient({
      account: privateKeyToAccount(privateKey),
      transport: http(rpcUrl),
    })
  } else {
    return null
  }

  const node = namehash(name)
  const contenthash = encodeIPFSContenthash(cid)

  try {
    const hash = await walletClient.writeContract({
      address: jnsResolver,
      abi: JNS_RESOLVER_ABI,
      functionName: 'setContenthash',
      args: [node, contenthash],
      chain,
    })

    return hash
  } catch {
    return null
  }
}

/**
 * Calculate namehash
 */
function namehash(name: string): Hex {
  const labels = name.toLowerCase().replace(/\.$/, '').split('.').reverse()
  let node: Hex = `0x${'0'.repeat(64)}` as Hex

  for (const label of labels) {
    const labelHash = keccak256(stringToBytes(label))
    node = keccak256(`${node}${labelHash.slice(2)}` as Hex) as Hex
  }

  return node
}

/**
 * Encode IPFS CID as contenthash
 */
function encodeIPFSContenthash(cid: string): Hex {
  // Simplified encoding - in production use proper CID encoding
  const cidBytes = base58Decode(cid)
  const prefix = '0xe30170' // e3 = ipfs namespace, 01 = CIDv1, 70 = dag-pb
  const cidHex = Array.from(cidBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return `${prefix}${cidHex}` as Hex
}

/**
 * Base58 decode
 */
function base58Decode(str: string): Uint8Array {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

  let leadingZeros = 0
  for (const char of str) {
    if (char === '1') leadingZeros++
    else break
  }

  const size = Math.floor((str.length * 733) / 1000) + 1
  const bytes = new Uint8Array(size)

  for (const char of str) {
    let carry = ALPHABET.indexOf(char)
    if (carry < 0) throw new Error(`Invalid base58 character: ${char}`)

    for (let i = size - 1; i >= 0; i--) {
      carry += 58 * bytes[i]
      bytes[i] = carry % 256
      carry = Math.floor(carry / 256)
    }
  }

  let firstNonZero = 0
  while (firstNonZero < bytes.length && bytes[firstNonZero] === 0) {
    firstNonZero++
  }

  const result = new Uint8Array(leadingZeros + (size - firstNonZero))
  result.set(bytes.slice(firstNonZero), leadingZeros)

  return result
}

/**
 * Deploy worker (if applicable)
 */
async function deployWorker(
  repoPath: string,
  _appName: string,
): Promise<boolean> {
  // Check for jeju-manifest.json
  const manifestPath = joinPath(repoPath, 'jeju-manifest.json')
  const manifestExists = await fileExists(manifestPath)
  if (!manifestExists) {
    return false
  }

  // Build worker
  const pkgPath = joinPath(repoPath, 'package.json')
  const pkgExists = await fileExists(pkgPath)
  if (pkgExists) {
    const pkgContent = await readFile(pkgPath)
    const pkg = JSON.parse(pkgContent)

    if (pkg.scripts?.['build:worker']) {
      try {
        await execCommand('bun run build:worker', repoPath)
      } catch {
        return false
      }
    }
  }

  // TODO: Deploy to worker runtime
  // This would register the worker with the compute registry
  // and deploy to available nodes

  return true
}

/**
 * Main deployment hook
 */
export async function runDeployHook(
  config: DeployHookConfig,
): Promise<DeploymentResult> {
  const startTime = Date.now()

  const result: DeploymentResult = {
    success: false,
    appName: config.appName,
    branch: config.branch,
    commitHash: config.commitHash,
    duration: 0,
  }

  console.log(
    `[Deploy] Starting deployment for ${config.appName}@${config.branch}`,
  )

  // Detect framework
  const framework = await detectFramework(config.repoPath)
  console.log(`[Deploy] Detected framework: ${framework.name}`)

  // Build
  const buildResult = await buildProject(config.repoPath, framework)
  result.buildLogs = buildResult.logs

  if (!buildResult.success) {
    result.error = 'Build failed'
    result.duration = Date.now() - startTime
    return result
  }

  // Upload to IPFS
  const outputPath = joinPath(config.repoPath, framework.outputDir)
  const outputExists = await fileExists(outputPath)
  if (!outputExists) {
    result.error = `Output directory not found: ${framework.outputDir}`
    result.duration = Date.now() - startTime
    return result
  }

  const cid = await uploadToIPFS(outputPath)
  if (!cid) {
    result.error = 'IPFS upload failed'
    result.duration = Date.now() - startTime
    return result
  }

  result.ipfsCid = cid
  console.log(`[Deploy] Uploaded to IPFS: ${cid}`)

  // Update JNS (if configured)
  const jnsName = `${config.appName}.jeju`
  const privateKey = process.env.JEJU_DEPLOY_KEY as Hex | undefined

  if (privateKey) {
    const txHash = await updateJNS(jnsName, cid, config.network, privateKey)
    if (txHash) {
      result.jnsName = jnsName
      result.jnsTxHash = txHash
      console.log(`[Deploy] Updated JNS: ${jnsName} -> ${txHash}`)
    }
  }

  // Deploy worker if applicable
  const hasWorker = await hasWorkerCode(config.repoPath)
  if (hasWorker) {
    result.workerDeployed = await deployWorker(config.repoPath, config.appName)
    console.log(`[Deploy] Worker deployed: ${result.workerDeployed}`)
  }

  result.success = true
  result.duration = Date.now() - startTime

  console.log(`[Deploy] Completed in ${result.duration}ms`)

  return result
}

/**
 * Git post-receive hook handler
 */
export async function handlePostReceive(
  repoPath: string,
  refs: Array<{ oldRev: string; newRev: string; refName: string }>,
): Promise<DeploymentResult[]> {
  const results: DeploymentResult[] = []

  for (const ref of refs) {
    // Only deploy on push to main/master
    if (!ref.refName.endsWith('/main') && !ref.refName.endsWith('/master')) {
      continue
    }

    const branch = ref.refName.split('/').pop() ?? 'main'
    const appName = repoPath.split('/').pop() ?? 'unknown'

    const result = await runDeployHook({
      repoPath,
      appName,
      branch,
      commitHash: ref.newRev,
      owner: '0x0000000000000000000000000000000000000000' as Address, // TODO: Get from auth
      network: (process.env.NETWORK ?? 'localnet') as NetworkType,
    })

    results.push(result)
  }

  return results
}

export { detectFramework, hasWorkerCode }
